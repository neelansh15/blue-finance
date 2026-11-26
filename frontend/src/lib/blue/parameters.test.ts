import { describe, expect, it } from 'vitest';
import { BLUE_PARAMS } from './params';
import { createBlueClient, derivePosition, hMax, numberToWad } from './client';

describe('declared parameter parity',()=>{
  it('retains special haircuts while excluding them from the routine hMax',async()=>{
    const snapshot=await createBlueClient().getSnapshot();
    expect(snapshot.params.haircut.HALTED).toBe(.25);
    expect(snapshot.params.haircut.CORP_ACTION).toBe(.10);
    expect(hMax(snapshot.params)).toBe(.15);
    expect(derivePosition(snapshot).target).toBeCloseTo(.51125,12);
  });
  it('matches contract OPEN/WEEKEND limits and the halt liquidation boundary',async()=>{
    const snapshot={...await createBlueClient().getSnapshot(),collateralRaw:numberToWad(100),feedPricePerUI:100,debt:0};
    expect(derivePosition(snapshot).available).toBeCloseTo(5112.5,8);
    expect(derivePosition({...snapshot,regime:'WEEKEND'}).available).toBeCloseTo(4345.625,8);
    const atLimit={...snapshot,debt:5112.5};
    expect(derivePosition({...atLimit,regime:'WEEKEND'}).healthNow).toBeGreaterThan(1);
    expect(derivePosition({...atLimit,regime:'HALTED'}).healthNow).toBeLessThan(1);
    expect(derivePosition({...atLimit,regime:'HALTED'}).available).toBe(0);
    expect(BLUE_PARAMS.haircut.HALTED).toBe(.25);
  });
});
