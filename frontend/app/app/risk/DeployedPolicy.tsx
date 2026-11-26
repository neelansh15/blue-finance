"use client";

import { useState } from 'react';
import { createPublicClient, http, isAddress, type PublicClient } from 'viem';
import { readDeployedParameters, type MarketIdentity } from '../../../src/lib/blue/deployed';
import { BLUE_PARAMS } from '../../../src/lib/blue/params';

/** Optional, read-only deployment verification; demo values never stand in for a failed read. */
export default function DeployedPolicy() {
  const [result,setResult]=useState<Awaited<ReturnType<typeof readDeployedParameters>>|null>(null);
  const [error,setError]=useState('');
  const [pending,setPending]=useState(false);
  const configured=process.env.NEXT_PUBLIC_BLUE_MARKET_IDENTITY;
  if (!configured) return null;
  async function refresh() {
    setPending(true); setError(''); setResult(null);
    try {
      const raw=JSON.parse(configured!);
      if (!Number.isSafeInteger(raw.chainId) || raw.chainId<=0 ||
          !['router','morpho','registry','loanToken','collateralToken','oracle','irm'].every(k=>isAddress(raw[k])) ||
          !/^\d+$/.test(raw.lltv)) throw new Error('Invalid deployment configuration');
      const identity={...raw,lltv:BigInt(raw.lltv)} as MarketIdentity;
      const client=createPublicClient({transport:http(process.env.NEXT_PUBLIC_BLUE_RPC_URL,{timeout:10000})}) as PublicClient;
      setResult(await readDeployedParameters(client,identity));
    } catch(e) {setError(e instanceof Error?e.message:'Deployed limits unavailable');}
    finally {setPending(false);}
  }
  const differs=result && (result.params.margin!==BLUE_PARAMS.margin || result.params.lltv!==BLUE_PARAMS.lltv ||
    Object.entries(result.params.haircut).some(([r,h])=>h!==BLUE_PARAMS.haircut[r as keyof typeof BLUE_PARAMS.haircut]));
  return <details><summary>Verify deployed market limits</summary>
    <p>Read the configured market’s limits directly from one blockchain snapshot.</p>
    <button className="btn dashboard-secondary" type="button" disabled={pending} onClick={refresh}>{pending?'Reading contracts…':'Read deployed limits'}</button>
    {error && <p className="app-message" role="alert">{error}. Deployed limits are unverified.</p>}
    {result && <div aria-live="polite">
      <p>Verified at block {result.blockNumber.toString()}. Target LTV: {(Number(result.config.targetLtvWad)/1e16).toFixed(3)}%.
        {result.config.managed?' Managed positions.':' Legacy market: router controls are bypassable.'}</p>
      {differs && <p className="app-message">Deployed settings differ from the declared demo. Demo previews do not represent this deployment.</p>}
      <dl className="risk-metrics">{Object.entries(result.params.haircut).map(([regime,haircut])=><div key={regime}>
        <dt>{regime.toLowerCase().replaceAll('_',' ')}</dt><dd>{(haircut*100).toFixed(2)}% haircut · {result.staleness[regime as keyof typeof result.staleness]}s maximum feed age</dd>
      </div>)}</dl>
      <p className="risk-note">This verifies settings at that block. Monitoring permission, current prices, cap headroom and pool liquidity still determine whether borrowing is available.</p>
    </div>}
  </details>;
}
