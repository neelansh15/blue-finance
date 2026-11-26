/** Read-only planning and post-execution verification. Only governance/guardian submit transactions. */
import { createHash } from 'node:crypto';
import { decodeEventLog, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters,
  verifyTypedData, type Address, type Hex, type PublicClient } from 'viem';
import { BlueRouterAbi, BlueOracleAbi, BlueRiskExecutorAbi } from './generated/blueAbi.js';
import { REGIME_NAMES, regimeRegistryAbi } from './abi.js';

export type Deployment = {
  chainId: number; asset: string; router: Address; morpho: Address; registry: Address; executor: Address;
  governance: Address; guardian: Address; reviewer: Address; loanDecimals: number; collateralDecimals: number;
  market: {loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint};
};
export const approvalTypes = {RiskReview:[
  {name:'documentHash',type:'bytes32'}, {name:'configHash',type:'bytes32'},
  {name:'expiresAt',type:'uint64'}, {name:'multiplier',type:'uint256'}, {name:'live',type:'bool'}, {name:'calibrated',type:'bool'},
]} as const;
export type Review = {documentHash: Hex; configHash: Hex; expiresAt: bigint; multiplier: bigint; live: boolean; calibrated: boolean; signature: Hex};
const same = (a: string,b: string) => a.toLowerCase() === b.toLowerCase();
function need(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

export async function inspectDeployment(client: PublicClient, d: Deployment) {
  need(await client.getChainId() === d.chainId,'Wrong chain');
  const block = await client.getBlock();
  const blockNumber = block.number;
  const id = keccak256(encodeAbiParameters(parseAbiParameters('address,address,address,address,uint256'),
    [d.market.loanToken,d.market.collateralToken,d.market.oracle,d.market.irm,d.market.lltv]));
  const [config,configHash,admin,routerMorpho,routerRegistry,executorRouter,governance,guardian,asset,registry,ld,cd] = await Promise.all([
    client.readContract({address:d.router,abi:BlueRouterAbi,functionName:'marketConfig',args:[id],blockNumber}),
    client.readContract({address:d.executor,abi:BlueRiskExecutorAbi,functionName:'configHash',args:[id],blockNumber}),
    client.readContract({address:d.router,abi:BlueRouterAbi,functionName:'admin',blockNumber}),
    client.readContract({address:d.router,abi:BlueRouterAbi,functionName:'MORPHO',blockNumber}),
    client.readContract({address:d.router,abi:BlueRouterAbi,functionName:'REGISTRY',blockNumber}),
    client.readContract({address:d.executor,abi:BlueRiskExecutorAbi,functionName:'ROUTER',blockNumber}),
    client.readContract({address:d.executor,abi:BlueRiskExecutorAbi,functionName:'GOVERNANCE',blockNumber}),
    client.readContract({address:d.executor,abi:BlueRiskExecutorAbi,functionName:'GUARDIAN',blockNumber}),
    client.readContract({address:d.market.oracle,abi:BlueOracleAbi,functionName:'ASSET',blockNumber}),
    client.readContract({address:d.market.oracle,abi:BlueOracleAbi,functionName:'REGISTRY',blockNumber}),
    client.readContract({address:d.market.loanToken,abi:parseAbi(['function decimals() view returns(uint8)']),functionName:'decimals',blockNumber}),
    client.readContract({address:d.market.collateralToken,abi:parseAbi(['function decimals() view returns(uint8)']),functionName:'decimals',blockNumber}),
  ]);
  need(config.listed && config.managed,'Execution requires a listed managed market');
  need(same(admin,d.executor) && same(executorRouter,d.router) && same(routerMorpho,d.morpho)
    && same(routerRegistry,d.registry) && same(registry,d.registry) && same(asset,d.market.collateralToken)
    && same(governance,d.governance) && same(guardian,d.guardian),'Deployment identity/authority mismatch');
  need(ld === d.loanDecimals && cd === d.collateralDecimals,'Token decimal mismatch');
  const actual = await client.readContract({address:d.morpho,abi:parseAbi([
    'function idToMarketParams(bytes32) view returns(address,address,address,address,uint256)']),
    functionName:'idToMarketParams',args:[id],blockNumber});
  need([d.market.loanToken,d.market.collateralToken,d.market.oracle,d.market.irm].every((a,i)=>same(a,String(actual[i])))
    && actual[4] === d.market.lltv,'Morpho MarketParams mismatch');
  const [haircuts,staleness,oracleLoanDecimals,oracleCollateralDecimals] = await Promise.all([
    Promise.all(REGIME_NAMES.map((_,i)=>client.readContract({address:d.market.oracle,abi:BlueOracleAbi,functionName:'haircutBps',args:[i],blockNumber}))),
    Promise.all(REGIME_NAMES.map((_,i)=>client.readContract({address:d.market.oracle,abi:BlueOracleAbi,functionName:'stalenessSec',args:[i],blockNumber}))),
    client.readContract({address:d.market.oracle,abi:BlueOracleAbi,functionName:'LOAN_DECIMALS',blockNumber}),
    client.readContract({address:d.market.oracle,abi:BlueOracleAbi,functionName:'COLLATERAL_DECIMALS',blockNumber}),
  ]);
  need(oracleLoanDecimals===ld && oracleCollateralDecimals===cd,'Oracle decimal mismatch');
  need(config.hMaxBps===Math.max(...haircuts.slice(0,4)), 'Cached routine haircut mismatch');
  const [supplyCap,multiplier]=await Promise.all([
    client.readContract({address:d.market.collateralToken,abi:parseAbi(['function supplyCap() view returns(uint256)']),functionName:'supplyCap',blockNumber}),
    client.readContract({address:d.market.collateralToken,abi:parseAbi(['function uiMultiplier() view returns(uint256)']),functionName:'uiMultiplier',blockNumber}),
  ]);
  need(multiplier>0n,'Invalid UI multiplier');
  const [maxFreeze,continuity,jump,expiredFreeze,ttl,maxOverride,keeperCanClear,feedPerUi]=await Promise.all([
    client.readContract({address:d.market.oracle,abi:BlueOracleAbi,functionName:'MAX_FREEZE',blockNumber}),
    client.readContract({address:d.market.oracle,abi:BlueOracleAbi,functionName:'CONTINUITY_BAND_BPS',blockNumber}),
    client.readContract({address:d.market.oracle,abi:BlueOracleAbi,functionName:'JUMP_BAND_BPS',blockNumber}),
    client.readContract({address:d.market.oracle,abi:BlueOracleAbi,functionName:'EXPIRED_FREEZE_HAIRCUT_BPS',blockNumber}),
    client.readContract({address:d.router,abi:BlueRouterAbi,functionName:'MAX_ATTESTATION_TTL',blockNumber}),
    client.readContract({address:d.registry,abi:regimeRegistryAbi,functionName:'MAX_OVERRIDE',blockNumber}),
    client.readContract({address:d.registry,abi:regimeRegistryAbi,functionName:'keeperCanClear',blockNumber}),
    client.readContract({address:d.market.oracle,abi:BlueOracleAbi,functionName:'FEED_PER_UI_SHARE',blockNumber}),
  ]);
  return {id,blockNumber,timestamp:block.timestamp,config,configHash,haircuts,staleness,supplyCap,multiplier,
    controls:{maxFreeze,continuity,jump,expiredFreeze,ttl,maxOverride,keeperCanClear,feedPerUi}};
}

/** Review signs SHA-256 of the exact UTF-8 advisory document, avoiding cross-language float canonicalisation. */
export async function prepareRiskUpdate(client: PublicClient, d: Deployment, document: string, review: Review, nonce: bigint) {
  const observed = await inspectDeployment(client,d);
  need(review.expiresAt>observed.timestamp && review.expiresAt<=observed.timestamp+7n*86400n,'Review expired or too long');
  need(review.live && review.calibrated,'Synthetic or uncalibrated evidence cannot authorize a live plan');
  const documentHash = `0x${createHash('sha256').update(document,'utf8').digest('hex')}` as Hex;
  need(documentHash===review.documentHash && review.configHash===observed.configHash && review.multiplier===observed.multiplier,'Review/document/configuration mismatch');
  const {signature,...message}=review;
  need(await verifyTypedData({address:d.reviewer,domain:{name:'BlueRiskReview',version:'1',chainId:d.chainId,verifyingContract:d.executor},
    primaryType:'RiskReview',types:approvalTypes,message,signature}),'Review signature invalid');
  const bundle=JSON.parse(document);
  const proposal=bundle.blue_proposal, assessment=bundle.assessment, recommendation=bundle.recommendation;
  need(assessment?.simulated===false && recommendation?.simulated===false,'Live source evidence required');
  need(proposal?.chain_id===d.chainId && same(proposal.market_id,observed.id) && proposal.asset===d.asset
    && proposal.recommendation_id===recommendation.recommendation_id
    && recommendation.timestamp===assessment.as_of && proposal.expires_at===recommendation.expires_at
    && proposal.evidence_hash===assessment.evidence_hash && proposal.evidence_hash===recommendation.evidence_hash,
    'Advisory identity/evidence mismatch');
  const expires=BigInt(Math.floor(Date.parse(proposal.expires_at)/1000));
  need(expires>observed.timestamp && expires>=review.expiresAt,'Proposal expired before the review');
  need(BigInt(Math.floor(Date.parse(assessment.as_of)/1000))<=observed.timestamp,'Future evidence');
  need(proposal.market_lltv===Number(d.market.lltv)/1e18 && proposal.configured.loan_decimals===d.loanDecimals
    && proposal.configured.collateral_decimals===d.collateralDecimals,'LLTV/decimals differ from deployment');
  const declared=proposal.configured, controls=observed.controls;
  need(BigInt(declared.max_freeze_seconds)===controls.maxFreeze && declared.continuity_band_bps===controls.continuity
    && declared.jump_band_bps===controls.jump && declared.expired_freeze_haircut_bps===controls.expiredFreeze
    && BigInt(declared.eligibility_ttl_seconds)===controls.ttl && BigInt(declared.max_override_seconds)===controls.maxOverride
    && declared.keeper_can_clear===controls.keeperCanClear
    && ['MOCK_UI_SHARE','ATLAS_RAW_TOKEN'].includes(declared.profile)
    && (declared.profile==='MOCK_UI_SHARE')===controls.feedPerUi,'Declared oracle/operational controls differ from deployment');
  for(let i=0;i<6;i++) {
    const regime=REGIME_NAMES[i]!;
    need(proposal.configured.haircuts_bps[regime]===observed.haircuts[i]
      && proposal.configured.staleness_seconds[regime]===observed.staleness[i],'Immutable oracle configuration changed; create a new market');
  }
  const margin=proposal.router.margin_bps;
  need(Number.isInteger(margin) && margin>=0 && margin<=5000,'Invalid margin');
  const total=BigInt(proposal.router.total_cap_assets);
  const normalizedSupply=proposal.managed_supply_cap_tokens;
  need(typeof normalizedSupply==='string' && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(normalizedSupply),'Invalid normalized supply cap');
  const [whole='0',fraction='']=normalizedSupply.split('.');
  const normalizedUnits=BigInt(whole)*10n**BigInt(d.collateralDecimals)+BigInt((fraction.slice(0,d.collateralDecimals).padEnd(d.collateralDecimals,'0'))||'0');
  const supplyCap=normalizedUnits*10n**18n/observed.multiplier;
  need(supplyCap<2n**128n,'Invalid raw supply cap');
  need(total>=0n && total<2n**128n,'Invalid total cap');
  need(JSON.stringify(proposal.router.regime_order)===JSON.stringify(REGIME_NAMES),'Regime order mismatch');
  const caps=proposal.router.regime_cap_assets.map((c:string)=>BigInt(c)) as [bigint,bigint,bigint,bigint,bigint,bigint];
  need(caps.length===6 && caps.every(c=>c>=0n && c<=total) && caps[4]===0n && caps[5]===0n,'Invalid regime caps');
  const target=d.market.lltv*BigInt(10000-observed.config.hMaxBps)/10000n-BigInt(margin)*10n**14n;
  need(target>0n,'Margin eliminates borrowing capacity');
  const evidence=proposal.evidence_hash;
  need(/^sha256:[a-f0-9]{64}$/.test(evidence),'Invalid evidence digest');
  const update={chainId:BigInt(d.chainId),market:d.market,expectedConfigHash:observed.configHash,
    evidenceHash:`0x${evidence.slice(7)}` as Hex,marginBps:margin,totalCap:total,supplyCap,expectedMultiplier:observed.multiplier,regimeCaps:caps,expiresAt:review.expiresAt,nonce};
  const tightening=margin>=observed.config.marginBps && total<=observed.config.totalCap && supplyCap<=observed.supplyCap
    && caps.every((c,i)=>c<=observed.config.regimeCaps[i]!);
  const method=tightening?'tighten':'schedule';
  if (!tightening) {
    const delay=await client.readContract({address:d.executor,abi:BlueRiskExecutorAbi,functionName:'DELAY',blockNumber:observed.blockNumber});
    need(observed.timestamp+delay<review.expiresAt,'Relaxation review must remain valid through governance delay');
  }
  need(!await client.readContract({address:d.executor,abi:BlueRiskExecutorAbi,functionName:'nonceUsed',args:[nonce],blockNumber:observed.blockNumber}),'Nonce already used');
  return {to:d.executor,method,update,observed,documentHash,
    data:encodeFunctionData({abi:BlueRiskExecutorAbi,functionName:method,args:[update]}),
    authorization:'Governance/guardian must independently sign and submit; this planner never sends a transaction'};
}

export async function verifyApplied(client: PublicClient, d: Deployment, update: Awaited<ReturnType<typeof prepareRiskUpdate>>['update'], hash: Hex) {
  const receipt=await client.getTransactionReceipt({hash});
  need(receipt.status==='success','Execution reverted');
  const expected = await client.readContract({address:d.executor,abi:BlueRiskExecutorAbi,functionName:'updateHash',args:[update],blockNumber:receipt.blockNumber});
  const applied = receipt.logs.some(log => {
    if (!same(log.address,d.executor)) return false;
    try {
      const event=decodeEventLog({abi:BlueRiskExecutorAbi,data:log.data,topics:log.topics});
      return event.eventName==='Applied' && event.args.updateHash===expected;
    } catch { return false; }
  });
  need(applied,'Receipt does not contain this executor/update application');
  const config=await client.readContract({address:d.router,abi:BlueRouterAbi,functionName:'marketConfig',
    args:[keccak256(encodeAbiParameters(parseAbiParameters('address,address,address,address,uint256'),
      [d.market.loanToken,d.market.collateralToken,d.market.oracle,d.market.irm,d.market.lltv]))],blockNumber:receipt.blockNumber});
  need(config.marginBps===update.marginBps && config.totalCap===update.totalCap
    && config.regimeCaps.every((c,i)=>c===update.regimeCaps[i]),'Resulting on-chain configuration differs from proposal');
  const supplyCap=await client.readContract({address:d.market.collateralToken,abi:parseAbi(['function supplyCap() view returns(uint256)']),functionName:'supplyCap',blockNumber:receipt.blockNumber});
  need(supplyCap===update.supplyCap,'Resulting supply cap differs from proposal');
  return {transactionHash:hash,blockNumber:receipt.blockNumber,verified:true};
}
