import { parseRiskRequest } from "./contracts";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const error = (message: string, status: number) => new Response(JSON.stringify({ detail: message }), { status, headers });

export async function proxyRisk(request: Request, operation: string, asset: string,
  baseUrl = process.env.RISK_API_URL, upstreamFetch: typeof fetch = fetch): Promise<Response> {
  const overview = operation === "overview" && asset === "all" && request.method === "GET";
  if (!overview && !["NVDAB", "NVDA", "BNB_STOCK_NVDA"].includes(asset.toUpperCase()))
    return error("This market is not supported by the risk backend.", 404);
  if (!(overview || operation === "advisory" && request.method === "POST" || operation === "market-status" && request.method === "GET"))
    return error("Unsupported risk operation.", 405);
  if (!baseUrl) return error("Advisory service is not configured. Demo borrowing remains available.", 503);
  let url: URL;
  try {
    url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        (url.pathname !== "/" && url.pathname !== ""))
      return error("Advisory service configuration is invalid.", 503);
    url = new URL(overview ? "/risk/overview" : `/risk/${operation}/NVDA`, url);
  } catch { return error("Advisory service configuration is invalid.", 503); }
  let body: string | undefined;
  if (request.method === "POST") {
    // Bound the read even when Content-Length is missing or forged.
    const reader = request.body?.getReader();
    if (!reader) return error("A demo position is required.", 400);
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); return error("Risk request is too large.", 413); }
      chunks.push(value);
    }
    try {
      const input = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.byteLength; }
      body = JSON.stringify(parseRiskRequest(JSON.parse(new TextDecoder().decode(input))));
    } catch { return error("Invalid scenario or demo position.", 400); }
  }
  try {
    const response = await upstreamFetch(url, { method: request.method, body, cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", Accept: "application/json" }, signal: AbortSignal.timeout(45_000) });
    // Never forward upstream headers, credentials or diagnostic error bodies.
    if (!response.ok)
      return error("The risk service could not complete this request. Try again.", response.status >= 500 ? 503 : response.status);
    const data: unknown = await response.json();
    return new Response(JSON.stringify(data), { status: response.status, headers });
  } catch { return error("The risk service is unavailable or timed out. Try again.", 503); }
}
