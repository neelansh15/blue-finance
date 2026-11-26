import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAddress, isAddressEqual, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BinanceBapiSource } from "../halt/binanceBapi.js";
import { NasdaqHaltSource } from "../halt/nasdaq.js";
import { createChainOperations, makeReader, verifyRoles } from "./chain.js";
import { stocks } from "./contracts.js";
import { EligibilityError, makeEligibilitySigner } from "./eligibility.js";
import { createKeeper, errorSummary } from "./keeper.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

function account(name: string) {
  const value = required(name);
  if (/^0x[\da-fA-F]{64}$/.test(value)) {
    try {
      return privateKeyToAccount(value as Hex);
    } catch {
      // Keep invalid secret contents out of logs.
    }
  }
  throw new Error(`Set ${name} to a valid 32-byte account key.`);
}

function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 2_048) throw new EligibilityError(413, "Request too large.");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new EligibilityError(400, "Invalid JSON.");
  }
}

export async function start() {
  const rpcUrl = required("BLUE_BSC_RPC_URL");
  const apiToken = Buffer.from(required("BLUE_ELIGIBILITY_API_TOKEN"));
  if (apiToken.length < 32) throw new Error("Use a random eligibility API token of at least 32 characters.");
  const keeper = account("BLUE_KEEPER_PRIVATE_KEY");
  const signer = account("BLUE_SIGNER_PRIVATE_KEY");
  if (isAddressEqual(keeper.address, signer.address)) throw new Error("Use distinct keeper and signer accounts.");
  const allowed = required("BLUE_ELIGIBLE_ACCOUNTS").split(",").map(value => value.trim());
  if (!allowed.every(value => isAddress(value))) throw new Error("BLUE_ELIGIBLE_ACCOUNTS contains an invalid address.");
  const allowlist = new Set(allowed.map(value => value.toLowerCase()));
  const enabled = process.env.BLUE_KEEPER_MARKETS?.trim().split(",").map(value => value.trim().toUpperCase());
  const markets = enabled ? stocks.filter(stock => enabled.includes(stock.symbol)) : stocks;
  if (!markets.length || enabled?.some(symbol => !stocks.some(stock => stock.symbol === symbol))) {
    throw new Error("BLUE_KEEPER_MARKETS contains an invalid symbol.");
  }

  const interval = 240_000;
  const reader = makeReader(rpcUrl);
  await verifyRoles(reader, keeper.address, signer.address, markets, interval);
  const lifecycle = new AbortController();
  const exchange = new NasdaqHaltSource();
  const issuer = new BinanceBapiSource();
  const tick = createKeeper({
    ...createChainOperations(reader, rpcUrl, keeper, lifecycle.signal),
    signals: stock => Promise.all([exchange.check(stock, Date.now()), issuer.check(stock)]),
  });
  const sign = makeEligibilitySigner(reader, signer, allowlist, markets);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let updatedAt = Date.now();

  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method === "GET" && request.url === "/healthz") {
      const healthy = Date.now() - updatedAt < 600_000;
      return json(response, healthy ? 200 : 503, { keeperLoop: healthy ? "running" : "late" });
    }
    if (request.method !== "POST" || request.url !== "/eligibility") return json(response, 404, { error: "Not found." });
    const provided = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.concat([Buffer.from("Bearer "), apiToken]);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return json(response, 401, { error: "Unauthorized." });
    }
    try {
      json(response, 200, await sign(await readBody(request)));
    } catch (error) {
      if (error instanceof EligibilityError) return json(response, error.status, { error: error.message });
      console.error(`Eligibility signing failed: ${errorSummary(error)}`);
      json(response, 503, { error: "Eligibility is temporarily unavailable." });
    }
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch(error => {
      console.error(`HTTP request failed: ${errorSummary(error)}`);
      if (!response.headersSent) json(response, 503, { error: "Service is temporarily unavailable." });
    });
  });
  server.requestTimeout = 15_000;
  server.listen(Number(process.env.PORT || 8080), "0.0.0.0", () => {
    console.log(`Blue automation starts for ${markets.map(asset => asset.symbol).join(", ")}. Keeper ${keeper.address}, signer ${signer.address}.`);
  });

  async function run() {
    const started = Date.now();
    try {
      await tick(markets);
      updatedAt = Date.now();
    } catch (error) {
      console.error(`Keeper cycle failed: ${errorSummary(error)}`);
    } finally {
      if (!lifecycle.signal.aborted) timer = setTimeout(() => void run(), Math.max(1_000, interval - (Date.now() - started)));
    }
  }
  // Render can overlap instances during deploys. Give the prior instance time to exit before signing.
  timer = setTimeout(() => void run(), interval);

  function stop() {
    lifecycle.abort();
    clearTimeout(timer);
    server.close();
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

void start().catch(error => {
  console.error(errorSummary(error));
  process.exitCode = 1;
});
