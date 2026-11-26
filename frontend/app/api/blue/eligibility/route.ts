import { isAddress, isAddressEqual } from "viem";
import { liveStocks } from "../../../../src/lib/blue/mainnet";

const response = (status: number, data: unknown) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function readInput(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body");
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return JSON.parse(body + decoder.decode()) as { account?: unknown; stock?: unknown };
    size += value.byteLength;
    if (size > 1024) {
      await reader.cancel();
      throw new Error("Request body too large");
    }
    body += decoder.decode(value, { stream: true });
  }
}

export async function POST(request: Request) {
  const base = process.env.BLUE_ELIGIBILITY_URL?.trim();
  const token = process.env.BLUE_ELIGIBILITY_API_TOKEN?.trim();
  if (!base || !token) return response(503, { error: "The eligibility service is not configured." });

  let input;
  try {
    input = await readInput(request);
  } catch {
    return response(400, { error: "Invalid eligibility request." });
  }
  if (!input || typeof input.account !== "string" || !isAddress(input.account) ||
      typeof input.stock !== "string" || !isAddress(input.stock)) {
    return response(400, { error: "Provide a valid wallet and stock address." });
  }

  const account = input.account;
  const stock = liveStocks.find(item => item.address.toLowerCase() === String(input.stock).toLowerCase())?.address;
  if (!stock) return response(400, { error: "This stock is outside the pool." });

  try {
    const target = new URL("/eligibility", base);
    if (target.protocol !== "https:" && !(
      target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname)
    )) return response(503, { error: "Eligibility requires an HTTPS service URL." });
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ account, stock }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (upstream.status === 403) return response(403, { error: "This wallet is outside the demo allowlist." });
    if (upstream.status === 400) return response(400, { error: "Eligibility is unavailable for the selected stock." });
    if (!upstream.ok) return response(503, { error: "Eligibility is temporarily unavailable." });

    const signed = await upstream.json();
    if (typeof signed?.account !== "string" || !isAddress(signed.account) || !isAddressEqual(signed.account, account) ||
        typeof signed.stock !== "string" || !isAddress(signed.stock) || !isAddressEqual(signed.stock, stock) ||
        typeof signed.expiry !== "string" || !/^\d{1,16}$/.test(signed.expiry) ||
        typeof signed.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signed.signature)) {
      return response(503, { error: "Eligibility returned an invalid signature." });
    }
    return response(200, { expiry: signed.expiry, signature: signed.signature });
  } catch {
    return response(503, { error: "Eligibility is temporarily unavailable." });
  }
}
