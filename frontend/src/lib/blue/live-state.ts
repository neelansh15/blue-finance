import { zeroAddress, type Address, type PublicClient } from "viem";
import {
  BLUE, calendarContract, controlsContract, dataProviderContract, liveStocks, oracleContract,
  poolContract, priceSourceAbi, tokenContract,
} from "./mainnet";

export async function readLiveState(client: PublicClient, account?: Address) {
  const viewer = account ?? zeroAddress;
  const userReserve = (asset: Address) => ({
    ...dataProviderContract, functionName: "getUserReserveData", args: [asset, viewer],
  } as const);
  const walletBalance = (asset: Address) => ({
    ...tokenContract(asset), functionName: "balanceOf", args: [viewer],
  } as const);

  // Oracle and risk-limit calls can revert as part of normal safety behavior.
  const [overview, prices, statuses, limits, reserves, balances, stockDebt, eligibility, sourceHealth] = await Promise.all([
    client.multicall({ contracts: [
      { ...poolContract, functionName: "getVirtualUnderlyingBalance", args: [BLUE.usdt] },
      { ...dataProviderContract, functionName: "getReserveCaps", args: [BLUE.usdt] },
      { ...poolContract, functionName: "getUserAccountData", args: [viewer] },
      { ...controlsContract, functionName: "keeper" },
      { ...controlsContract, functionName: "signer" },
      { ...poolContract, functionName: "debtStock", args: [viewer] },
      { ...dataProviderContract, functionName: "getReserveData", args: [BLUE.usdt] },
    ] }),
    client.multicall({ contracts: liveStocks.map(stock => ({
      ...oracleContract, functionName: "getAssetPrice", args: [stock.address],
    } as const)) }),
    client.multicall({ contracts: liveStocks.map(stock => ({
      ...calendarContract, functionName: "status", args: [stock.address],
    } as const)) }),
    client.multicall({ contracts: liveStocks.map(stock => ({
      ...controlsContract, functionName: "riskLimits", args: [stock.address],
    } as const)) }),
    client.multicall({ contracts: [userReserve(BLUE.usdt), ...liveStocks.map(stock => userReserve(stock.address))] }),
    client.multicall({ contracts: [walletBalance(BLUE.usdt), ...liveStocks.map(stock => walletBalance(stock.address))] }),
    client.multicall({ contracts: liveStocks.map(stock => ({
      ...poolContract, functionName: "stockDebt", args: [stock.address],
    } as const)) }),
    client.multicall({ contracts: liveStocks.map(stock => ({
      ...controlsContract, functionName: "eligibleUntil", args: [viewer, stock.address],
    } as const)) }),
    client.multicall({ contracts: [BLUE.usdtSource, ...liveStocks.map(stock => stock.source)].map(address => ({
      address, abi: priceSourceAbi, functionName: "usableForBorrow",
    } as const)) }),
  ]);

  const [liquidity, caps, user, keeper, signer, debtStock, sharedReserve] = overview;
  if (liquidity.status !== "success" || caps.status !== "success" ||
      keeper.status !== "success" || signer.status !== "success" ||
      debtStock.status !== "success" || balances.some(read => read.status !== "success") ||
      reserves.some(read => read.status !== "success")) {
    throw new Error("The BNB Chain RPC could not load the pool. Try refreshing.");
  }

  return {
    liquidity: liquidity.result,
    caps: caps.result,
    sharedReserve: sharedReserve.result ? {
      supplied: sharedReserve.result[2],
      borrowed: sharedReserve.result[4],
      supplyRate: sharedReserve.result[5],
      borrowRate: sharedReserve.result[6],
    } : undefined,
    keeper: keeper.result,
    signer: signer.result,
    debtStock: debtStock.result,
    user: user.result,
    usdt: { wallet: balances[0].result!, reserve: reserves[0].result!, sourceReady: sourceHealth[0].result },
    stocks: liveStocks.map((stock, i) => ({
      ...stock,
      price: prices[i].result,
      market: statuses[i].result,
      limits: limits[i].result,
      wallet: balances[i + 1].result!,
      reserve: reserves[i + 1].result!,
      debt: stockDebt[i].result,
      eligibleUntil: eligibility[i].result,
      sourceReady: sourceHealth[i + 1].result,
    })),
  };
}
