import { describe, expect, it, vi } from 'vitest';
import { recordMonitoringPermission, type TickDeps } from '../src/regimeKeeper.js';
import type { KeeperAsset } from '../src/config.js';
import type { Decision } from '../src/halt/combiner.js';

const asset:KeeperAsset={symbol:'NVDAB',ticker:'NVDA',token:`0x${'1'.repeat(40)}`,oracle:`0x${'2'.repeat(40)}`,permission:`0x${'3'.repeat(40)}`};
const clean:Decision={state:'ok',signals:{a:{state:'ok',detail:'healthy'},b:{state:'ok',detail:'healthy'}},cleared:false,reasons:[]};

function deps(dryRun=false,oracle={price:1n,frozen:false,live:true,frozenSince:0}) {
  return {cfg:{dryRun},chain:{readOracle:vi.fn().mockResolvedValue(oracle),recordPermission:vi.fn().mockResolvedValue('0xproof')},log:vi.fn()} as unknown as TickDeps;
}

describe('expiring permission reporting',()=>{
  it('renews only the conjunction of all healthy sources and a live unfrozen oracle',async()=>{
    const d=deps();await recordMonitoringPermission(d,asset,clean);
    expect(d.chain.recordPermission).toHaveBeenCalledWith(asset.permission,asset.token,true);
  });
  it.each(['unknown','halted','corp_action'] as const)('immediately records unhealthy on %s before any halt timeout',async state=>{
    const d=deps();await recordMonitoringPermission(d,asset,{...clean,signals:{a:{state,detail:'test'}}});
    expect(d.chain.recordPermission).toHaveBeenCalledWith(asset.permission,asset.token,false);
  });
  it('cannot turn empty sources, a stale oracle or a read failure into proof',async()=>{
    const empty=deps();await recordMonitoringPermission(empty,asset,{...clean,signals:{}});
    expect(empty.chain.recordPermission).toHaveBeenLastCalledWith(asset.permission,asset.token,false);
    const stale=deps(false,{price:1n,frozen:false,live:false,frozenSince:0});await recordMonitoringPermission(stale,asset,clean);
    expect(stale.chain.recordPermission).toHaveBeenLastCalledWith(asset.permission,asset.token,false);
    const failed=deps();vi.mocked(failed.chain.readOracle).mockRejectedValue(new Error('RPC unavailable'));
    await recordMonitoringPermission(failed,asset,clean);
    expect(failed.chain.recordPermission).toHaveBeenLastCalledWith(asset.permission,asset.token,false);
  });
  it('never writes in dry run or reports a failed write as success',async()=>{
    const dry=deps(true);await recordMonitoringPermission(dry,asset,clean);expect(dry.chain.recordPermission).not.toHaveBeenCalled();
    const failed=deps();vi.mocked(failed.chain.recordPermission!).mockRejectedValue(new Error('reverted'));
    await recordMonitoringPermission(failed,asset,clean);
    expect(failed.log).toHaveBeenCalledWith('permission_failed',expect.anything());
    expect(failed.log).not.toHaveBeenCalledWith('permission_recorded',expect.anything());
  });
});
