import { describe, expect, it } from "vitest";
import { createDawnClient, derivePosition, hMax } from "./client";
import { targetLtv } from "./params";
import { MARKETS } from "../../../app/app/markets";
import { regimeAt, STEPS_PER_DAY } from "../../../app/components/regimes";

describe("Dawn deployment and demo parity", () => {
  it("keeps special haircuts out of routine hMax and uses the same NVDAb borrow ceiling", async () => {
    const client = createDawnClient(), s = await client.getSnapshot();
    expect(s.params.haircut.HALTED).toBe(.25);
    expect(s.params.haircut.CORP_ACTION).toBe(.10);
    expect(hMax(s.params)).toBe(.15);
    expect(derivePosition(s).target).toBeCloseTo(.51125);
    expect(MARKETS[0].maxLtv).toBe(targetLtv());
    // The README explicitly documents that routine safety does not cover a halt.
    const debt = derivePosition(s).available + s.debt;
    expect(derivePosition({ ...s, debt, regime: "WEEKEND", calendarRegime: "WEEKEND" }).healthNow).toBeGreaterThan(1);
    expect(derivePosition({ ...s, debt, regime: "HALTED" }).healthNow).toBeLessThan(1);
  });

  it("retains calendar and freeze floors when entering a less severe corporate-action haircut", async () => {
    const client = createDawnClient();
    client.demo.setRegime("WEEKEND");
    client.demo.announceSplit(2);
    const split = await client.getSnapshot();
    expect(derivePosition(split).haircutNow).toBe(.15);
    client.demo.setRegime("HALTED");
    client.demo.setRegime("CORP_ACTION");
    const held = derivePosition(await client.getSnapshot());
    expect(held.haircutNow).toBe(.25);
    expect(held.healthWeekend).toBe(held.healthNow);
    expect(derivePosition(split).borrowBlocked).toBe(true);
  });

  it("uses the Sunday 20:00 boundary and closes Monday before pre-market", () => {
    expect(regimeAt(6 * STEPS_PER_DAY + 39)).toBe("weekend");
    expect(regimeAt(6 * STEPS_PER_DAY + 40)).toBe("closed");
    expect(regimeAt(0)).toBe("closed");
  });
});
