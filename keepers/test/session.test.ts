import { describe, expect, it } from "vitest";
import { etParts, sessionRegime } from "../src/session.js";

const r = (iso: string) => sessionRegime(new Date(iso));

describe("etParts", () => {
  it("converts UTC to ET across DST", () => {
    expect(etParts(new Date("2026-06-02T13:30:00Z"))).toEqual({ date: "2026-06-02", minutes: 570, weekday: 2 });
    expect(etParts(new Date("2026-12-01T14:30:00Z"))).toEqual({ date: "2026-12-01", minutes: 570, weekday: 2 });
  });
  it("handles midnight as 00:xx (h23)", () => {
    expect(etParts(new Date("2026-06-03T04:05:00Z")).minutes).toBe(5);
  });
});

describe("regular weekday boundaries (Tue 2026-06-02, EDT = UTC-4)", () => {
  it.each([
    ["2026-06-02T03:59:00Z", "CLOSED"], // 23:59 Mon ET -> Monday overnight
    ["2026-06-02T07:59:00Z", "CLOSED"], // 03:59
    ["2026-06-02T08:00:00Z", "EXTENDED"], // 04:00
    ["2026-06-02T13:29:00Z", "EXTENDED"], // 09:29
    ["2026-06-02T13:30:00Z", "OPEN"], // 09:30
    ["2026-06-02T19:59:00Z", "OPEN"], // 15:59
    ["2026-06-02T20:00:00Z", "EXTENDED"], // 16:00
    ["2026-06-02T23:59:00Z", "EXTENDED"], // 19:59
    ["2026-06-03T00:00:00Z", "CLOSED"], // 20:00
  ])("%s -> %s", (iso, exp) => expect(r(iso)).toBe(exp));
});

describe("weekend block (Fri 20:00 -> Sun 20:00 ET)", () => {
  it("Fri 19:59 ET is EXTENDED, Fri 20:00 ET is WEEKEND", () => {
    expect(r("2026-06-05T23:59:00Z")).toBe("EXTENDED");
    expect(r("2026-06-06T00:00:00Z")).toBe("WEEKEND");
  });
  it("Saturday and Sunday day are WEEKEND", () => {
    expect(r("2026-06-06T16:00:00Z")).toBe("WEEKEND");
    expect(r("2026-06-07T16:00:00Z")).toBe("WEEKEND");
  });
  it("Sun 19:59 ET WEEKEND, Sun 20:00 ET CLOSED, Mon 04:00 ET EXTENDED", () => {
    expect(r("2026-06-07T23:59:00Z")).toBe("WEEKEND");
    expect(r("2026-06-08T00:00:00Z")).toBe("CLOSED");
    expect(r("2026-06-08T07:59:00Z")).toBe("CLOSED");
    expect(r("2026-06-08T08:00:00Z")).toBe("EXTENDED");
  });
});

describe("DST transitions", () => {
  it("spring forward Sun 2026-03-08: Fri EST, Sun->Mon EDT", () => {
    expect(r("2026-03-07T00:59:00Z")).toBe("EXTENDED"); // Fri 19:59 EST
    expect(r("2026-03-07T01:00:00Z")).toBe("WEEKEND"); // Fri 20:00 EST
    expect(r("2026-03-08T23:59:00Z")).toBe("WEEKEND"); // Sun 19:59 EDT
    expect(r("2026-03-09T00:00:00Z")).toBe("CLOSED"); // Sun 20:00 EDT
    expect(r("2026-03-09T08:00:00Z")).toBe("EXTENDED"); // Mon 04:00 EDT
    expect(r("2026-03-09T13:29:00Z")).toBe("EXTENDED");
    expect(r("2026-03-09T13:30:00Z")).toBe("OPEN"); // 09:30 EDT (would be 08:30 EST)
  });
  it("fall back Sun 2026-11-01: Fri EDT, Sun->Mon EST", () => {
    expect(r("2026-10-30T23:59:00Z")).toBe("EXTENDED"); // Fri 19:59 EDT
    expect(r("2026-10-31T00:00:00Z")).toBe("WEEKEND"); // Fri 20:00 EDT
    expect(r("2026-11-02T00:59:00Z")).toBe("WEEKEND"); // Sun 19:59 EST
    expect(r("2026-11-02T01:00:00Z")).toBe("CLOSED"); // Sun 20:00 EST
    expect(r("2026-11-02T09:00:00Z")).toBe("EXTENDED"); // Mon 04:00 EST
    expect(r("2026-11-02T14:29:00Z")).toBe("EXTENDED");
    expect(r("2026-11-02T14:30:00Z")).toBe("OPEN"); // 09:30 EST
  });
  it("2027 transitions (Mar 14, Nov 7)", () => {
    expect(r("2027-03-15T13:29:00Z")).toBe("EXTENDED");
    expect(r("2027-03-15T13:30:00Z")).toBe("OPEN");
    expect(r("2027-11-08T14:29:00Z")).toBe("EXTENDED");
    expect(r("2027-11-08T14:30:00Z")).toBe("OPEN");
  });
  it("day-of-week test on a DST day itself: Sun 2026-03-08 02:30 ET gap is WEEKEND", () => {
    expect(r("2026-03-08T07:30:00Z")).toBe("WEEKEND");
  });
});

describe("holidays and early closes", () => {
  it("Thanksgiving Thu 2026-11-26 is WEEKEND all day", () => {
    expect(r("2026-11-26T05:00:00Z")).toBe("WEEKEND"); // 00:00 EST
    expect(r("2026-11-26T09:00:00Z")).toBe("WEEKEND"); // 04:00
    expect(r("2026-11-26T15:00:00Z")).toBe("WEEKEND"); // 10:00
    expect(r("2026-11-27T00:59:00Z")).toBe("WEEKEND"); // 19:59
    expect(r("2026-11-27T04:59:00Z")).toBe("CLOSED"); // 23:59, holiday overnight (Fri is not a holiday) as in RegimeRegistry
  });
  it("Wed before Thanksgiving is normal, evening WEEKEND (next day holiday)", () => {
    expect(r("2026-11-25T15:00:00Z")).toBe("OPEN");
    expect(r("2026-11-26T00:59:00Z")).toBe("EXTENDED"); // Wed 19:59
    expect(r("2026-11-26T01:00:00Z")).toBe("WEEKEND"); // Wed 20:00
    expect(r("2026-11-26T04:59:00Z")).toBe("WEEKEND"); // Wed 23:59
  });
  it("Fri 2026-11-27 early close at 13:00 ET", () => {
    expect(r("2026-11-27T09:00:00Z")).toBe("EXTENDED"); // 04:00
    expect(r("2026-11-27T14:30:00Z")).toBe("OPEN"); // 09:30
    expect(r("2026-11-27T17:59:00Z")).toBe("OPEN"); // 12:59
    expect(r("2026-11-27T18:00:00Z")).toBe("EXTENDED"); // 13:00
    expect(r("2026-11-27T21:59:00Z")).toBe("EXTENDED"); // 16:59
    expect(r("2026-11-27T22:00:00Z")).toBe("WEEKEND"); // 17:00, Friday overnight is WEEKEND
    expect(r("2026-11-28T01:00:00Z")).toBe("WEEKEND"); // Fri 20:00
  });
  it("Sunday 20:00 before a Monday holiday stays WEEKEND; Dec 24 2026 early close ends in WEEKEND (Dec 25 holiday)", () => {
    expect(r("2027-01-18T01:00:00Z")).toBe("WEEKEND"); // Sun Jan 17 20:00 ET, Mon is MLK
    expect(r("2026-12-24T22:00:00Z")).toBe("WEEKEND"); // Dec 24 17:00 ET
  });
  it("other holidays are WEEKEND", () => {
    expect(r("2026-04-03T15:00:00Z")).toBe("WEEKEND"); // Good Friday
    expect(r("2026-07-03T15:00:00Z")).toBe("WEEKEND"); // Independence observed
    expect(r("2026-12-25T15:00:00Z")).toBe("WEEKEND");
    expect(r("2027-01-18T15:00:00Z")).toBe("WEEKEND"); // MLK 2027
    expect(r("2027-11-25T15:00:00Z")).toBe("WEEKEND"); // Thanksgiving 2027
    expect(r("2027-07-05T15:00:00Z")).toBe("WEEKEND");
  });
  it("Thu 2026-12-24 early close", () => {
    expect(r("2026-12-24T17:59:00Z")).toBe("OPEN");
    expect(r("2026-12-24T18:00:00Z")).toBe("EXTENDED");
  });
  it("Fri 2027-11-26 early close", () => {
    expect(r("2027-11-26T17:59:00Z")).toBe("OPEN");
    expect(r("2027-11-26T18:00:00Z")).toBe("EXTENDED");
  });
  it("custom tables are honored", () => {
    const t = { holidays: new Set(["2026-06-02"]), earlyCloses: new Set<string>() };
    expect(sessionRegime(new Date("2026-06-02T15:00:00Z"), t)).toBe("WEEKEND");
  });
  it("accepts epoch ms", () => {
    expect(sessionRegime(Date.parse("2026-06-02T15:00:00Z"))).toBe("OPEN");
  });
});
