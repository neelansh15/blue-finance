const headers={"Content-Type":"application/json","Cache-Control":"no-store"};
const error=(detail:string,status:number)=>Response.json({detail},{status,headers});
/** A bounded synthetic demo request, never a live portfolio or execution authorization. */
export async function POST(request:Request) {
  let drop:number;
  try {
    const reader=request.body?.getReader();if(!reader)return error('Scenario required',400);
    let text='',size=0;const decoder=new TextDecoder();
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>1024){await reader.cancel();return error('Scenario too large',413);}text+=decoder.decode(value,{stream:true});}
    const body=JSON.parse(text+decoder.decode());drop=body.price_drop;
    if(Object.keys(body).length!==1 || typeof drop!=='number' || !Number.isFinite(drop) || drop<0 || drop>1)return error('Invalid price shock',400);
  }catch{return error('Invalid scenario',400);}
  try {
    const base=new URL(process.env.RISK_API_URL||'');
    if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)return error('Invalid service configuration',503);
    const snapshot={as_of:new Date().toISOString(),available_usdt:500,supplier_claims_usdt:1500,reserve_debt_cap_usdt:1500,liquidity_buffer_usdt:100,
      stocks:['TSLAB','NVDAB','QQQb','SPCXb','GOOGLb'].map(stock=>({stock,collateral_usd:1000,scaled_debt:'200000000000000000000',stock_debt_cap:600,price_drop:drop,executable_recovery_fraction:.8}))};
    const response=await fetch(new URL('/risk/aave/shared-reserve',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)return error('Shared reserve analysis unavailable',503);
    return Response.json(await response.json(),{headers});
  }catch{return error('Shared reserve service unavailable',503);}
}
