"use client";
import {useState} from 'react';
type Result={protocol:string;simulated:boolean;executable:boolean;shared_new_borrow_budget_usdt:string;total_accrued_debt_usdt:string;aggregate_shortfall_usdt:string;supplier_loss_fraction:string|null;stocks:{stock:string;health_factor:string|null;individual_borrow_headroom_usdt:string;economic_shortfall_usdt:string}[]};
const usd=(n:string)=>Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
export default function AaveRiskWorkspace(){
 const [shock,setShock]=useState(20),[result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function analyse(){setBusy(true);setError('');setResult(null);try{
  const response=await fetch('/api/risk/aave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({price_drop:shock/100})});
  if(!response.ok)throw new Error('Shared reserve analysis is unavailable.');
  const data=await response.json();if(data.protocol!=='AAVE_V3'||data.simulated!==true||data.executable!==false||!Array.isArray(data.stocks))throw new Error('Unexpected analysis response');setResult(data);
 }catch(e){setError(e instanceof Error?e.message:'Analysis failed');}finally{setBusy(false);}}
 return <main className="app-main"><section className="risk-panel"><h1>Aave V3 shared reserve risk</h1>
 <p>One USDT reserve funds all five stock collaterals. Lenders share losses across those stocks; stock limits reduce concentration without creating isolated liquidity pools.</p>
 <p>Synthetic scenario: $1,500 supplier claims, $500 available cash, $1,000 total debt and a $100 liquidity buffer. Each stock has $1,000 collateral and $200 debt. No wallet transaction is sent.</p>
 <label>Joint stock price decline: {shock}% <input aria-label="Joint stock price decline" type="range" min="0" max="95" value={shock} onChange={e=>{setShock(Number(e.target.value));setResult(null);}}/></label>
 <button className="btn" disabled={busy} onClick={analyse}>{busy?'Analysing…':'Stress shared USDT reserve'}</button>
 {error&&<p role="alert">{error}</p>}{result&&<div aria-live="polite"><h2>Shared lender exposure</h2>
 <p>Accrued debt: {usd(result.total_accrued_debt_usdt)}. Shared new borrowing budget: {usd(result.shared_new_borrow_budget_usdt)}.</p>
 <p>Joint economic shortfall: {usd(result.aggregate_shortfall_usdt)}. Supplier claims at risk: {(Number(result.supplier_loss_fraction||0)*100).toFixed(2)}%.</p>
 <table><thead><tr><th>Stock</th><th>Stressed health</th><th>Individual headroom</th><th>Shortfall</th></tr></thead><tbody>{result.stocks.map(s=><tr key={s.stock}><td>{s.stock}</td><td>{s.health_factor===null?'No debt':Number(s.health_factor).toFixed(2)}</td><td>{usd(s.individual_borrow_headroom_usdt)}</td><td>{usd(s.economic_shortfall_usdt)}</td></tr>)}</tbody></table>
 <p>Individual headrooms compete for the same cash and reserve debt budget. They cannot be added together. Regime discounts change borrowing power, not liquidation thresholds.</p>
 <p>Uncalibrated, simulated advice requiring review. Economic shortfalls do not reproduce Aave liquidation ordering or deficit accounting.</p></div>}</section></main>;
}
