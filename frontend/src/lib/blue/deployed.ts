import { encodeAbiParameters, keccak256, parseAbi, parseAbiParameters, type Address, type PublicClient } from 'viem';
import { BlueOracleAbi, BlueRouterAbi } from './abi.generated';
import { REGIMES, type Regime } from './math';

export type MarketIdentity = {
  chainId: number; router: Address; morpho: Address; registry: Address;
  loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint;
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Every read is pinned to the same block. A read failure never substitutes declared demo defaults. */
export async function readDeployedParameters(client: PublicClient, identity: MarketIdentity) {
  if (await client.getChainId() !== identity.chainId) throw new Error('Deployment chain mismatch');
  const blockNumber = await client.getBlockNumber();
  const marketId = keccak256(encodeAbiParameters(parseAbiParameters('address,address,address,address,uint256'),
    [identity.loanToken, identity.collateralToken, identity.oracle, identity.irm, identity.lltv]));
  const [morpho, registry, config, actual, asset, oracleRegistry] = await Promise.all([
    client.readContract({address:identity.router, abi:BlueRouterAbi,functionName:'MORPHO',blockNumber}),
    client.readContract({address:identity.router, abi:BlueRouterAbi,functionName:'REGISTRY',blockNumber}),
    client.readContract({address:identity.router, abi:BlueRouterAbi,functionName:'marketConfig',args:[marketId],blockNumber}),
    client.readContract({address:identity.morpho, abi:parseAbi(['function idToMarketParams(bytes32) view returns (address,address,address,address,uint256)']),functionName:'idToMarketParams',args:[marketId],blockNumber}),
    client.readContract({address:identity.oracle, abi:BlueOracleAbi,functionName:'ASSET',blockNumber}),
    client.readContract({address:identity.oracle, abi:BlueOracleAbi,functionName:'REGISTRY',blockNumber}),
  ]);
  if (!same(morpho,identity.morpho) || !same(registry,identity.registry) || !same(asset,identity.collateralToken)
      || !same(oracleRegistry,identity.registry) || !config.listed || actual[4] !== identity.lltv
      || ![identity.loanToken,identity.collateralToken,identity.oracle,identity.irm].every((a,i) => same(a,String(actual[i]))))
    throw new Error('Deployment market identity mismatch');
  const [haircuts,staleness,loanDecimals,collateralDecimals,oracleLoanDecimals,oracleCollateralDecimals] = await Promise.all([
    Promise.all(REGIMES.map((_,i) => client.readContract({address:identity.oracle,abi:BlueOracleAbi,functionName:'haircutBps',args:[i],blockNumber}))),
    Promise.all(REGIMES.map((_,i) => client.readContract({address:identity.oracle,abi:BlueOracleAbi,functionName:'stalenessSec',args:[i],blockNumber}))),
    client.readContract({address:identity.loanToken,abi:parseAbi(['function decimals() view returns (uint8)']),functionName:'decimals',blockNumber}),
    client.readContract({address:identity.collateralToken,abi:parseAbi(['function decimals() view returns (uint8)']),functionName:'decimals',blockNumber}),
    client.readContract({address:identity.oracle,abi:BlueOracleAbi,functionName:'LOAN_DECIMALS',blockNumber}),
    client.readContract({address:identity.oracle,abi:BlueOracleAbi,functionName:'COLLATERAL_DECIMALS',blockNumber}),
  ]);
  if (loanDecimals !== oracleLoanDecimals || collateralDecimals !== oracleCollateralDecimals) throw new Error('Oracle decimal mismatch');
  const routineMax = Math.max(...haircuts.slice(0,4));
  if (config.hMaxBps !== routineMax || config.targetLtvWad !== identity.lltv*BigInt(10000-routineMax)/10000n-BigInt(config.marginBps)*10n**14n)
    throw new Error('Deployed target LTV is inconsistent');
  return {blockNumber,marketId,config,loanDecimals,collateralDecimals, params:{lltv:Number(identity.lltv)/1e18,
    margin:config.marginBps/10000, haircut:Object.fromEntries(REGIMES.map((r,i) => [r,haircuts[i]/10000])) as Record<Regime,number>},
    staleness:Object.fromEntries(REGIMES.map((r,i) => [r,staleness[i]])) as Record<Regime,number>};
}
