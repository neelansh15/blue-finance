/** Placeholder deployment values, matching protocol/script/DawnDeploy.sol. */
export const ROUTINE_REGIMES = ["OPEN", "EXTENDED", "CLOSED", "WEEKEND"] as const;
export const DAWN_PARAMS = {
  lltv: 0.625,
  margin: 0.02,
  haircut: { OPEN: 0, EXTENDED: 0.04, CLOSED: 0.10, WEEKEND: 0.15, HALTED: 0.25, CORP_ACTION: 0.10 },
  continuityBand: 0.05,
};
export const targetLtv = (lltv = DAWN_PARAMS.lltv) =>
  lltv * (1 - Math.max(...ROUTINE_REGIMES.map(r => DAWN_PARAMS.haircut[r]))) - DAWN_PARAMS.margin;
