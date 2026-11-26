import {afterEach,expect,it,vi} from 'vitest';
import {POST} from '../../../app/api/research/joint-stress/route';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('sends one synthetic five-stock reserve snapshot with exact debt strings',async()=>{
 vi.stubEnv('RISK_API_URL','http://localhost:8000');
 const upstream=vi.fn().mockResolvedValue(Response.json({analysis:'JOINT_STRESS_RESEARCH',simulated:true,executable:false}));vi.stubGlobal('fetch',upstream);
 const response=await POST(new Request('http://local/api/research/joint-stress',{method:'POST',body:JSON.stringify({price_drop:.2})}));
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
 const snapshot=JSON.parse(upstream.mock.calls[0][1].body);
 expect(snapshot.stocks).toHaveLength(5);expect(snapshot.available_usdt).toBe(500);expect(snapshot).not.toHaveProperty("reserve_debt_cap_usdt");
 expect(snapshot.stocks[0].scaled_debt).toBe('200000000000000000000');
 expect(upstream.mock.calls[0][0].pathname).toBe('/research/joint-stress');
});
it('rejects invalid or oversized scenarios before calling the service',async()=>{
 const upstream=vi.fn();vi.stubGlobal('fetch',upstream);
 for(const price_drop of [-1,2,'0.2'])expect((await POST(new Request('http://local',{method:'POST',body:JSON.stringify({price_drop})}))).status).toBe(400);
 expect((await POST(new Request('http://local',{method:'POST',body:' '.repeat(2048)}))).status).toBe(413);
 expect(upstream).not.toHaveBeenCalled();
});
