import { describe, expect, it } from "vitest";
import { createDawnClient, derivePosition, liquidationOutcome } from "./client";

describe("Dawn demo client", () => {
  it("updates the position when a mock borrow succeeds and tightens the limit over the weekend", async () => {
    const client = createDawnClient();
    let updates = 0;
    const unsubscribe = client.subscribe(() => { updates += 1; });
    const before = await client.getSnapshot();
    const initial = derivePosition(before);

    expect((await client.borrow(initial.available + 1)).ok).toBe(false);
    expect((await client.borrow(100)).ok).toBe(true);
    expect((await client.getSnapshot()).debt).toBe(before.debt + 100);
    const open = derivePosition(await client.getSnapshot());
    client.demo.setRegime("WEEKEND");
    const weekend = derivePosition(await client.getSnapshot());
    expect(weekend.available).toBeLessThan(open.available);
    expect(weekend.healthNow).toBeLessThan(open.healthNow);
    expect(weekend.healthNow).toBeGreaterThan(1);
    unsubscribe();
    client.demo.reset();
    expect(updates).toBe(2);
  });

  it("freezes the price across a split and clears only after the feed matches the new multiplier", async () => {
    const client = createDawnClient();
    const initial = derivePosition(await client.getSnapshot());
    client.demo.announceSplit(2);
    expect((await client.borrow(1)).ok).toBe(false);
    client.demo.applyScheduledMultiplier();
    const split = derivePosition(await client.getSnapshot());
    expect(split.uiBalance).toBe(initial.uiBalance * 2n);
    expect(split.oracle).toEqual({ frozen: true, pricePerRaw: initial.oracle.pricePerRaw });
    expect(client.demo.tryClearCorpAction().ok).toBe(false);
    client.demo.feedPrintsPostSplit();
    expect(client.demo.tryClearCorpAction().ok).toBe(true);
    expect(derivePosition(await client.getSnapshot()).oracle).toEqual(initial.oracle);
  });

  it("liquidates an unhealthy mock position after a price gap", async () => {
    const client = createDawnClient();
    expect(client.demo.runLiquidationBot().ok).toBe(false);
    client.demo.movePrice(-0.45);
    expect(liquidationOutcome(await client.getSnapshot()).liquidatable).toBe(true);
    expect(client.demo.runLiquidationBot().ok).toBe(true);
    expect((await client.getSnapshot()).debt).toBe(0);
  });
});
