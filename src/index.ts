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

export default {
  async fetch(request: Request, { PUBLIC_KEY }: { PUBLIC_KEY: string }): Promise<Response> {
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

    return fetch(requestedUrl.toString());
  }
};
