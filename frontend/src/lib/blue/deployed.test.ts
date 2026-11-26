import { describe, expect, it, vi } from 'vitest';
import type { Address, PublicClient } from 'viem';
import { readDeployedParameters, type MarketIdentity } from './deployed';

const address=(n:string)=>`0x${n.repeat(40)}` as Address;
const identity:MarketIdentity={chainId:56,router:address('1'),morpho:address('2'),registry:address('3'),
  loanToken:address('4'),collateralToken:address('5'),oracle:address('6'),irm:address('7'),lltv:625000000000000000n};

function client(overrides:Record<string,unknown>={}) {
  const readContract=vi.fn(async({functionName,args=[]}:{functionName:string;args?:unknown[]})=>{
    if(functionName in overrides)return overrides[functionName];
    const values:Record<string,unknown>={MORPHO:identity.morpho,REGISTRY:identity.registry,ASSET:identity.collateralToken,
      marketConfig:{listed:true,managed:true,marginBps:200,hMaxBps:1500,targetLtvWad:511250000000000000n},
      idToMarketParams:[identity.loanToken,identity.collateralToken,identity.oracle,identity.irm,identity.lltv],decimals:18,LOAN_DECIMALS:18,COLLATERAL_DECIMALS:18};
    if(functionName==='haircutBps')return [0,400,1000,1500,2500,1000][Number(args[0])];
    if(functionName==='stalenessSec')return [3600,3600,14400,21600,3600,3600][Number(args[0])];
    if(!(functionName in values))throw new Error('RPC unavailable');
    return values[functionName];
  });
  return {getChainId:async()=>56,getBlockNumber:async()=>123n,readContract} as unknown as PublicClient;
}

describe('deployed parameter reader',()=>{
  it('reads all regimes at one block and retains the special-regime settings',async()=>{
    const c=client();const result=await readDeployedParameters(c,identity);
    expect(result.params.haircut.HALTED).toBe(.25);
    expect(result.config.targetLtvWad).toBe(511250000000000000n);
    expect(vi.mocked(c.readContract).mock.calls.every(([call])=>call.blockNumber===123n)).toBe(true);
  });
  it('rejects market identity and target mismatches',async()=>{
    await expect(readDeployedParameters(client({ASSET:address('e')}),identity)).rejects.toThrow(/identity mismatch/);
    await expect(readDeployedParameters(client({marketConfig:{listed:true,hMaxBps:2500,targetLtvWad:448750000000000000n,marginBps:200}}),identity)).rejects.toThrow(/inconsistent/);
  });
  it('propagates failed reads instead of substituting demo values',async()=>{
    const c=client();c.readContract=vi.fn().mockRejectedValue(new Error('RPC unavailable'));
    await expect(readDeployedParameters(c,identity)).rejects.toThrow('RPC unavailable');
  });
});
