import { escapeCSS } from "@bots-gg/markup";

const parseHex = (hex: string) => {
  const buf = new ArrayBuffer(hex.length / 2);
  const bufView = new Uint8Array(buf);

  for (let i = 0; i < hex.length; i += 2) {
    const int = parseInt(hex.substring(i, i + 2), 16);
    if (isNaN(int)) return new ArrayBuffer(0);

    bufView[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }

  return buf;
}

const parseB64 = (b64: string) => {
  // https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey#subjectpublickeyinfo_import
  const parsed = atob(b64);
  const buf = new ArrayBuffer(parsed.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0; i < parsed.length; i++) {
    bufView[i] = parsed.charCodeAt(i);
  }

  return buf;
}

const getMimeType = (contentType: string | undefined) =>
  contentType?.includes(";")
  ? contentType.split(";")[0].trim()
  : contentType?.trim();

export default {
  async fetch(request: Request, { PUBLIC_KEY }: { PUBLIC_KEY: string }): Promise<Response> {
    const userAgent = request.headers.get('User-Agent');
    if (!userAgent) {
      return new Response("Expected a `User-Agent` header.", { status: 403 });
    }

    const url = new URL(request.url);
    const subUrl = url.searchParams.get("url");
    if (!subUrl) {
      return new Response("`url` expected as a query parameter.", { status: 400 });
    }

    // validate request
    const botId = url.searchParams.get("botId");
    const signed = url.searchParams.get("signed");

    if (!botId || !signed || isNaN(parseInt(botId))) {
      return new Response("Need signing parameters (`botId` and `signed`).", { status: 401 });
    }

    // ed25519 verification
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      parseB64(PUBLIC_KEY),
      { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
      false,
      ["verify"]
    );

    const ok =  await crypto.subtle.verify(
      "NODE-ED25519",
      cryptoKey,
      parseHex(signed),
      new TextEncoder().encode(BigInt(botId).toString() + subUrl)
    );

    if (!ok) {
      return new Response("Failed signature check.", { status: 403 });
    }

    const requestedUrl = new URL(subUrl, url.origin);

    const resp = await fetch(requestedUrl.toString(), { headers: new Headers({ 'User-Agent': userAgent }) });

    let body: Response['body'] | string = resp.body;
    if (getMimeType(resp.headers.get("Content-Type")?.toLowerCase()) === "text/css") {
      // this sucks...
      const text = await resp.text();
      const urls: string[] = [];
      escapeCSS(text, (url: string) => {
        urls.push(url);
        return url;
      });

      let giveUp = false;
      const responses = await Promise.all(urls.map(async (url) => {
        const otherResp = await fetch((new URL(url, request.url)));
        const mimeType = getMimeType(otherResp.headers.get("Content-Type")?.toLowerCase());
        if (mimeType === "text/css") {
          giveUp = true;
        }
        // *smug smirk*
        return `data:${mimeType};base64,${btoa(await otherResp.text())}`;
      }));

      if (giveUp) {
        return new Response("You suck.");
      }

      const urlMap = Object.fromEntries(urls.map((url, i) => [url, i]));

      body = escapeCSS(text, (url: string) => responses[urlMap[url]]);
    }

    const newResp = new Response(body, resp);  // :(
    newResp.headers.set("Content-Security-Policy", "default-src: 'self';");
    newResp.headers.set("X-Content-Type-Options", "nosniff");

    return newResp;
  }
};
