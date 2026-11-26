"use client";
import {useState} from 'react';

type Result={analysis:string;simulated:boolean;executable:boolean;total_accrued_debt_usdt:string;aggregate_shortfall_usdt:string;cash_plus_stressed_recovery_usdt:string;supplier_loss_fraction:string|null;stocks:{stock:string;health_factor:string|null;economic_shortfall_usdt:string}[]};
const usd=(n:string)=>Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
export default function JointStressDemo(){
 const [shock,setShock]=useState(20),[result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function analyse(){setBusy(true);setError('');setResult(null);try{
  const response=await fetch('/api/research/joint-stress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({price_drop:shock/100})});
  if(!response.ok)throw new Error('Joint stress research service is unavailable.');
  const data=await response.json();if(data.analysis!=='JOINT_STRESS_RESEARCH'||data.simulated!==true||data.executable!==false||!Array.isArray(data.stocks))throw new Error('Unexpected research response');setResult(data);
 }catch(e){setError(e instanceof Error?e.message:'Analysis failed');}finally{setBusy(false);}}
 return <main id="app-main" tabIndex={-1}><section className="risk-panel wrap"><p className="app-demo-label">Research demo · synthetic data</p><h1>Joint stress analysis</h1>
 <p>Estimate how simultaneous stock losses could affect all USDT suppliers in one shared Aave V3 reserve.</p>
 <p>Synthetic portfolio: $1,500 supplier claims, $500 cash and $1,000 total debt. Each of five stocks has $1,000 collateral and $200 debt. Recovery assumes an 80% executable fraction and a 5% liquidation bonus.</p>
 <label>Simultaneous stock price decline: {shock}% <input aria-label="Simultaneous stock price decline" type="range" min="0" max="95" value={shock} onChange={e=>{setShock(Number(e.target.value));setResult(null);}}/></label>
 <button className="btn" disabled={busy} onClick={analyse}>{busy?'Analysing…':'Run joint stress scenario'}</button>
 {error&&<p role="alert">{error}</p>}{result&&<div aria-live="polite"><h2>Shared supplier exposure</h2>
 <p>Accrued debt: {usd(result.total_accrued_debt_usdt)}. Cash plus stressed debt recovery: {usd(result.cash_plus_stressed_recovery_usdt)}.</p>
 <p>Joint economic shortfall: {usd(result.aggregate_shortfall_usdt)} — equivalent to {(Number(result.supplier_loss_fraction||0)*100).toFixed(2)}% of supplier claims.</p>
 <div className="risk-table-scroll"><table className="risk-table"><caption>Aggregate stock books under the same price shock</caption><thead><tr><th>Stock</th><th>Aggregate health proxy</th><th>Economic shortfall</th></tr></thead><tbody>{result.stocks.map(s=><tr key={s.stock}><td>{s.stock}</td><td>{s.health_factor===null?'No debt':Number(s.health_factor).toFixed(2)}</td><td>{usd(s.economic_shortfall_usdt)}</td></tr>)}</tbody></table></div>
 <p>All stocks expose the same USDT suppliers. The percentage is a stress estimate, not a realized or automatically allocated supplier loss.</p>
 </div>}
 <p>Research only. This is not a live wallet, lending recommendation or transaction tool. Parameters are uncalibrated; liquidation order, reserve buffers and deficit resolution can change realized outcomes.</p></section></main>;
}
