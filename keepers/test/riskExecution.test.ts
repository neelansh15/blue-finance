import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { type Address, type Hex, type PublicClient } from 'viem';
import { approvalTypes, inspectDeployment, prepareRiskUpdate, verifyApplied, type Deployment, type Review } from '../src/riskExecution.js';

const addr=(n:string)=>`0x${n.repeat(40)}` as Address;
const reviewer=privateKeyToAccount(`0x${'1'.repeat(64)}`); // public fixture key, never a deployment signer
const now=1795190400n;
const d:Deployment={chainId:56,asset:'BNB_STOCK_NVDA',router:addr('1'),morpho:addr('2'),registry:addr('3'),
  executor:addr('4'),governance:addr('5'),guardian:addr('6'),reviewer:reviewer.address,loanDecimals:18,collateralDecimals:18,
  market:{loanToken:addr('7'),collateralToken:addr('8'),oracle:addr('9'),irm:addr('a'),lltv:625000000000000000n}};
const configHash=`0x${'b'.repeat(64)}` as Hex;
const haircuts=[0,400,1000,1500,2500,1000];
const stale=[3600,3600,14400,21600,3600,3600];
const regimes=['OPEN','EXTENDED','CLOSED','WEEKEND','HALTED','CORP_ACTION'];

function client(overrides:Record<string,unknown>={}) {
  return {getChainId:async()=>56,getBlock:async()=>({number:123n,timestamp:now}),
    readContract:async({functionName,args=[]}:{functionName:string;args?:unknown[]})=>{
      if(functionName in overrides)return overrides[functionName];
      const values:Record<string,unknown>={marketConfig:{listed:true,managed:true,permission:addr('c'),marginBps:200,hMaxBps:1500,
        targetLtvWad:511250000000000000n,totalCap:1000000n*10n**18n,regimeCaps:[1000000n,500000n,250000n,250000n,0n,0n].map(x=>x*10n**18n)},
        configHash,admin:d.executor,MORPHO:d.morpho,REGISTRY:d.registry,ROUTER:d.router,GOVERNANCE:d.governance,GUARDIAN:d.guardian,
        ASSET:d.market.collateralToken,decimals:18,idToMarketParams:[d.market.loanToken,d.market.collateralToken,d.market.oracle,d.market.irm,d.market.lltv],
        MAX_FREEZE:43200n,CONTINUITY_BAND_BPS:500,JUMP_BAND_BPS:3000,EXPIRED_FREEZE_HAIRCUT_BPS:1000,
        MAX_ATTESTATION_TTL:900n,MAX_OVERRIDE:259200n,keeperCanClear:false,FEED_PER_UI_SHARE:true,supplyCap:100000n*10n**18n,uiMultiplier:10n**18n,LOAN_DECIMALS:18,COLLATERAL_DECIMALS:18,DELAY:86400n,nonceUsed:false};
      if(functionName==='haircutBps')return haircuts[Number(args[0])];
      if(functionName==='stalenessSec')return stale[Number(args[0])];
      if(!(functionName in values))throw new Error(`Unexpected read ${functionName}`);
      return values[functionName];
    }} as unknown as PublicClient;
}

async function envelope(c=client(),change:Record<string,unknown>={}) {
  const observed=await inspectDeployment(c,d);
  const evidence=`sha256:${'d'.repeat(64)}`;
  const document=JSON.stringify({assessment:{simulated:false,evidence_hash:evidence,as_of:new Date(Number(now)*1000).toISOString()},
    recommendation:{simulated:false,evidence_hash:evidence,recommendation_id:'fixture',
      timestamp:new Date(Number(now)*1000).toISOString(),expires_at:new Date(Number(now+900n)*1000).toISOString()},
    blue_proposal:{chain_id:56,asset:d.asset,market_id:observed.id,recommendation_id:'fixture',evidence_hash:evidence,
      managed_supply_cap_tokens:'1000',market_lltv:.625,expires_at:new Date(Number(now+900n)*1000).toISOString(),
      configured:{loan_decimals:18,collateral_decimals:18,max_freeze_seconds:43200,continuity_band_bps:500,jump_band_bps:3000,expired_freeze_haircut_bps:1000,eligibility_ttl_seconds:900,max_override_seconds:259200,keeper_can_clear:false,profile:'MOCK_UI_SHARE',haircuts_bps:Object.fromEntries(regimes.map((r,i)=>[r,haircuts[i]])),
        staleness_seconds:Object.fromEntries(regimes.map((r,i)=>[r,stale[i]]))},
      router:{margin_bps:300,total_cap_assets:'1000',regime_order:regimes,regime_cap_assets:['1000','700','500','200','0','0']},...change}});
  const message={documentHash:`0x${createHash('sha256').update(document).digest('hex')}` as Hex,configHash,expiresAt:now+900n,multiplier:observed.multiplier,live:true,calibrated:true};
  const signature=await reviewer.signTypedData({domain:{name:'BlueRiskReview',version:'1',chainId:56,verifyingContract:d.executor},types:approvalTypes,primaryType:'RiskReview',message});
  return {document,review:{...message,signature} as Review};
}

describe('reviewed parameter planner',()=>{
  it('produces unsigned calldata only after exact deployment and reviewer checks',async()=>{
    const {document,review}=await envelope();const plan=await prepareRiskUpdate(client(),d,document,review,1n);
    expect(plan.method).toBe('tighten');expect(plan.update.marginBps).toBe(300);expect(plan.data).toMatch(/^0x/);
  });
  it('rejects chain, role, decimals and Morpho identity mismatches',async()=>{
    for(const override of [{admin:addr('e')},{decimals:6},{idToMarketParams:[addr('e'),d.market.collateralToken,d.market.oracle,d.market.irm,d.market.lltv]}])
      await expect(inspectDeployment(client(override),d)).rejects.toThrow(/mismatch/);
    const wrong=client();wrong.getChainId=async()=>1;await expect(inspectDeployment(wrong,d)).rejects.toThrow('Wrong chain');
  });
  it('rejects synthetic review, expired review, changed bytes, stale configuration and invalid signatures',async()=>{
    const {document,review}=await envelope();
    await expect(prepareRiskUpdate(client(),d,document,{...review,live:false},1n)).rejects.toThrow(/Synthetic/);
    await expect(prepareRiskUpdate(client(),d,document,{...review,expiresAt:now},1n)).rejects.toThrow(/expired/);
    await expect(prepareRiskUpdate(client(),d,document+' ',review,1n)).rejects.toThrow(/mismatch/);
    await expect(prepareRiskUpdate(client({configHash:`0x${'e'.repeat(64)}`}),d,document,review,1n)).rejects.toThrow(/mismatch/);
    await expect(prepareRiskUpdate(client(),{...d,reviewer:addr('e')},document,review,1n)).rejects.toThrow(/signature/);
  });
  it('rejects wrong immutable settings, invalid special caps and reused nonces',async()=>{
    const immutable=await envelope(client({haircutBps:100})).catch(()=>null);
    // The deployed routine hMax check must itself fail before preparing a plan.
    expect(immutable).toBeNull();
    const {document,review}=await envelope();
    await expect(prepareRiskUpdate(client({nonceUsed:true}),d,document,review,1n)).rejects.toThrow(/Nonce/);
    const invalid=await envelope(client(),{router:{margin_bps:300,total_cap_assets:'1000',regime_order:regimes,regime_cap_assets:['1','1','1','1','1','0']}});
    await expect(prepareRiskUpdate(client(),d,invalid.document,invalid.review,1n)).rejects.toThrow(/regime caps/);
  });
  it('does not extend a short review to bypass the governance relaxation delay',async()=>{
    const {document,review}=await envelope(client(),{router:{margin_bps:100,total_cap_assets:'1000',regime_order:regimes,regime_cap_assets:['1','1','1','1','0','0']}});
    await expect(prepareRiskUpdate(client(),d,document,review,1n)).rejects.toThrow(/governance delay/);
  });
  it('converts normalized supply advice once, with a reviewed live multiplier',async()=>{
    const c=client({uiMultiplier:8n*10n**18n});const {document,review}=await envelope(c);
    const plan=await prepareRiskUpdate(c,d,document,review,1n);
    expect(plan.update.supplyCap).toBe(125n*10n**18n);
    await expect(prepareRiskUpdate(client(),d,document,review,1n)).rejects.toThrow(/mismatch/);
  });
  it('does not accept a successful transaction without this executor application event',async()=>{
    const c=client({updateHash:configHash});const {document,review}=await envelope(c);const plan=await prepareRiskUpdate(c,d,document,review,1n);
    c.getTransactionReceipt=async()=>({status:'success',blockNumber:123n,logs:[]}) as never;
    await expect(verifyApplied(c,d,plan.update,`0x${'f'.repeat(64)}`)).rejects.toThrow(/application/);
  });
});
