import { zeroAddress, type Address, type PublicClient } from "viem";
import {
  BLUE, calendarContract, controlsContract, dataProviderContract, liveStocks, oracleContract,
  poolContract, priceSourceAbi, stockTokenAbi, tokenContract,
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
  const [overview, prices, statuses, limits, reserves, balances, stockDebt, eligibility, sourceHealth,
    market, withdrawLimits, configs, paused, multipliers] = await Promise.all([
    client.multicall({ contracts: [
      { ...poolContract, functionName: "getVirtualUnderlyingBalance", args: [BLUE.usdt] },
      { ...dataProviderContract, functionName: "getReserveCaps", args: [BLUE.usdt] },
      { ...poolContract, functionName: "getUserAccountData", args: [viewer] },
      { ...controlsContract, functionName: "keeper" },
      { ...controlsContract, functionName: "signer" },
      { ...poolContract, functionName: "debtStock", args: [viewer] },
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
    client.multicall({ contracts: [
      { ...dataProviderContract, functionName: "getReserveData", args: [BLUE.usdt] },
      { ...oracleContract, functionName: "getAssetPrice", args: [BLUE.usdt] },
    ] }),
    client.multicall({ contracts: liveStocks.map(stock => ({
      ...controlsContract, functionName: "withdrawLimit", args: [stock.address],
    } as const)) }),
    client.multicall({ contracts: liveStocks.map(stock => ({
      ...dataProviderContract, functionName: "getReserveConfigurationData", args: [stock.address],
    } as const)) }),
    client.multicall({ contracts: [BLUE.usdt, ...liveStocks.map(stock => stock.address)].map(asset => ({
      ...dataProviderContract, functionName: "getPaused", args: [asset],
    } as const)) }),
    client.multicall({ contracts: liveStocks.map(stock => ({
      address: stock.address, abi: stockTokenAbi, functionName: "uiMultiplier",
    } as const)) }),
  ]);

  const [reserveData, usdtPrice] = market;
  const [liquidity, caps, user, keeper, signer, debtStock] = overview;
  if (liquidity.status !== "success" || caps.status !== "success" ||
      keeper.status !== "success" || signer.status !== "success" ||
      debtStock.status !== "success" || balances.some(read => read.status !== "success") ||
      reserves.some(read => read.status !== "success") || reserveData.status !== "success") {
    throw new Error("The BNB Chain RPC could not load the pool. Try refreshing.");
  }

  return {
    account,
    totalSupplied: reserveData.result[2],
    totalBorrowed: reserveData.result[4],
    /** Annual rates in ray (1e27). */
    supplyRate: reserveData.result[5],
    borrowRate: reserveData.result[6],
    liquidity: liquidity.result,
    caps: caps.result,
    keeper: keeper.result,
    signer: signer.result,
    debtStock: debtStock.result,
    user: user.result,
    usdt: {
      wallet: balances[0].result!, reserve: reserves[0].result!, sourceReady: sourceHealth[0].result,
      price: usdtPrice.result, paused: paused[0].result,
    },
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
      /** Reverts during a halt, corporate action or guardian hold. */
      withdrawLtv: withdrawLimits[i].result,
      liquidationThreshold: configs[i].result?.[2],
      liquidationBonus: configs[i].result?.[3],
      frozen: configs[i].result?.[9],
      paused: paused[i + 1].result,
      multiplier: multipliers[i].result,
    })),
  };
}
