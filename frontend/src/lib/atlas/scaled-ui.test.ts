import { describe, expect, it } from "vitest";
import { pricePerDisplayedShare, rawToDisplayed } from "./scaled-ui";

describe("scaled UI units", () => {
  it("converts a split-adjusted raw price to the displayed share price", () => {
    expect(pricePerDisplayedShare(606_00000000n, 8, 8n * 10n ** 18n)).toBe(75.75);
    expect(rawToDisplayed(3n * 10n ** 18n, 8n * 10n ** 18n)).toBe(24n * 10n ** 18n);
  });
  it("rejects missing and invalid input", () => {
    expect(() => pricePerDisplayedShare(1n, 8, 0n)).toThrow();
    expect(() => pricePerDisplayedShare(0n, 8, 10n ** 18n)).toThrow();
  });
});
