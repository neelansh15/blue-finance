import { RISK_PARAMETERS } from './generated';
import type { Regime } from './math';

/** Declared demo values. Deployed values must be read from the contracts. */
export const BLUE_PARAMS = {
  lltv: Number(RISK_PARAMETERS.market.lltv_wad) / 1e18,
  margin: RISK_PARAMETERS.blue.margin_bps / 10000,
  continuityBand: RISK_PARAMETERS.blue.continuity_band_bps / 10000,
  haircut: Object.fromEntries(RISK_PARAMETERS.regime_order.map(r =>
    [r, RISK_PARAMETERS.blue.haircuts_bps[r] / 10000])) as Record<Regime, number>,
};
