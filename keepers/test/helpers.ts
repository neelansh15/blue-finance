import type { AssetRef, HaltSource, Signal } from "../src/halt/types.js";

export const ASSET: AssetRef = { symbol: "TSLAB", ticker: "TSLA", token: "0x5b1910eaad6450e50f816082aa078c41f10c292f" };

export class FakeSource implements HaltSource {
  next: Signal | Error = { state: "ok", detail: "fake ok" };
  calls = 0;
  constructor(public readonly name: string) {}
  set(state: Signal["state"], detail = state) {
    this.next = { state, detail };
  }
  fail() {
    this.next = new Error("boom");
  }
  async check(): Promise<Signal> {
    this.calls++;
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}
