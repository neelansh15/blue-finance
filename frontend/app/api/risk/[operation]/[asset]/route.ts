import { proxyRisk } from "../../../../../src/lib/risk/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ operation: string; asset: string }> };
export async function GET(request: Request, context: Context) {
  const { operation, asset } = await context.params;
  return proxyRisk(request, operation, asset);
}
export async function POST(request: Request, context: Context) { return GET(request, context); }
