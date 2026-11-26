import { BSTOCK_FEEDS, type BStockSymbol } from "../../../../../src/lib/atlas/prices";
import { getAtlasPrice } from "../../../../../src/lib/atlas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await context.params;
  if (!Object.hasOwn(BSTOCK_FEEDS, symbol)) return Response.json({ detail: "Unsupported asset" }, { status: 404, headers });
  try {
    return Response.json(await getAtlasPrice(symbol as BStockSymbol), { headers });
  } catch {
    return Response.json({ detail: "Atlas price unavailable" }, { status: 503, headers });
  }
}
