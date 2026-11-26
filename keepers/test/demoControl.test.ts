import { describe, expect, it } from "vitest";
import { buildCall } from "../src/demoControl.js";

const REG = "0x0000000000000000000000000000000000000001";
const A = "0x5b1910eaad6450e50f816082aa078c41f10c292f";

describe("demoControl.buildCall", () => {
  it("regime set", () => {
    const c = buildCall(["regime", "set", A, "WEEKEND", "--duration", "120"], REG);
    expect(c).toMatchObject({ functionName: "setOverride", args: [A, 3, 120n] });
  });
  it("regime clear", () => expect(buildCall(["regime", "clear", A], REG)).toMatchObject({ functionName: "clearOverride", args: [A] }));
  it("multiplier decimal and raw", () => {
    expect(buildCall(["multiplier", A, "2"])).toMatchObject({ functionName: "setUIMultiplierNow", args: [2n * 10n ** 18n] });
    expect(buildCall(["multiplier", A, "2", "--at", "1800000000"])).toMatchObject({ functionName: "setUIMultiplier", args: [2n * 10n ** 18n, 1800000000n] });
    expect(buildCall(["multiplier", A, "1000000000000000000", "--raw"]).args).toEqual([10n ** 18n]);
  });
  it("global override uses address(0)", () => {
    expect(buildCall(["regime", "set", "global", "HALTED"], REG)).toMatchObject({ args: ["0x0000000000000000000000000000000000000000", 4, 3600n] });
    expect(buildCall(["regime", "clear", "global"], REG)).toMatchObject({ args: ["0x0000000000000000000000000000000000000000"] });
  });
  it("oracle update", () => expect(buildCall(["oracle", "update", A])).toMatchObject({ functionName: "update", args: [] }));
  it("price with decimals", () => {
    expect(buildCall(["price", A, "245.5"]).args).toEqual([24_550_000_000n]);
    expect(buildCall(["price", A, "1", "--decimals", "18"]).args).toEqual([10n ** 18n]);
  });
  it("rejects bad input", () => {
    expect(() => buildCall(["regime", "set", A, "NOPE"], REG)).toThrow();
    expect(() => buildCall(["regime", "set", A, "WEEKEND"])).toThrow(/REGIME_REGISTRY/);
    expect(() => buildCall(["regime", "set", A, "OPEN"], REG)).toThrow(/OPEN/);
    expect(() => buildCall(["bogus"])).toThrow();
  });
});
