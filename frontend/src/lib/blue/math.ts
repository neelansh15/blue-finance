export const REGIMES = ["OPEN", "EXTENDED", "CLOSED", "WEEKEND", "HALTED", "CORP_ACTION"] as const;
export type Regime = (typeof REGIMES)[number];

type Params = {
  lltv: number;
  margin: number;
  haircut: Record<Regime, number>;
  continuityBand: number;
};

export type BlueSnapshot = {
  symbol: string;
  loanSymbol: string;
  params: Params;
  regime: Regime;
  feedPricePerUI: number;
  collateralRaw: bigint;
  uiMultiplier: bigint;
  debt: number;
  pendingMultiplier: { newMultiplier: bigint } | null;
  frozenPricePerRaw: number | null;
};

export function isRegime(value: string): value is Regime {
  return REGIMES.some((regime) => regime === value);
}

const WAD = 10n ** 18n;
export const wadToNumber = (wad: bigint) => Number(wad) / Number(WAD);
export const numberToWad = (value: number) => BigInt(Math.round(value * Number(WAD)));
export const hMax = (params: Params) => Math.max(...Object.values(params.haircut));

export const naivePricePerRaw = (feedPricePerUI: number) => feedPricePerUI;
export const collateralValue = (raw: bigint, pricePerRaw: number, haircut: number) =>
  wadToNumber(raw) * pricePerRaw * (1 - haircut);

export const healthFactor = (value: number, lltv: number, debt: number) =>
  debt > 0 ? value * lltv / debt : Infinity;

export function healthStatus(value: number) {
  if (value < 1) return "liquidatable";
  if (value < 1.1) return "risk";
  if (value < 1.3) return "caution";
  return "healthy";
}

export function derivePosition(s: BlueSnapshot) {
  const multiplier = wadToNumber(s.uiMultiplier);
  const pricePerRaw = s.frozenPricePerRaw ?? s.feedPricePerUI * multiplier;
  const haircutNow = s.params.haircut[s.regime];
  const grossValue = collateralValue(s.collateralRaw, pricePerRaw, 0);
  const valueNow = grossValue * (1 - haircutNow);
  const valueWeekend = grossValue * (1 - s.params.haircut.WEEKEND);
  const target = s.params.lltv * (1 - hMax(s.params)) - s.params.margin;
  const borrowBlocked = s.regime === "HALTED" || s.regime === "CORP_ACTION";
  const liquidationDenominator = wadToNumber(s.collateralRaw) * multiplier * (1 - haircutNow) * s.params.lltv;

  return {
    multiplier,
    oracle: { pricePerRaw, frozen: s.frozenPricePerRaw !== null },
    haircutNow,
    grossValue,
    valueNow,
    valueWeekend,
    target,
    borrowBlocked,
    uiBalance: s.collateralRaw * s.uiMultiplier / WAD,
    available: borrowBlocked ? 0 : Math.max(0, valueNow * target - s.debt),
    ltvNow: s.debt === 0 ? 0 : s.debt / valueNow,
    healthNow: healthFactor(valueNow, s.params.lltv, s.debt),
    healthWeekend: healthFactor(valueWeekend, s.params.lltv, s.debt),
    liquidationPriceUI: liquidationDenominator > 0 ? s.debt / liquidationDenominator : 0,
  };
}

export function validateBorrow(s: BlueSnapshot, amount: number) {
  const p = derivePosition(s);
  const validAmount = Number.isFinite(amount) && amount > 0;
  const newDebt = s.debt + (validAmount ? amount : 0);
  const reason = p.borrowBlocked ? "New borrows are paused."
    : !validAmount ? "Enter a positive amount."
    : amount > p.available ? "Amount exceeds the borrowing limit."
    : undefined;

  return {
    ok: reason === undefined,
    reason,
    newDebt,
    newLtv: newDebt === 0 ? 0 : newDebt / p.valueNow,
    newHealthNow: healthFactor(p.valueNow, s.params.lltv, newDebt),
    newHealthWeekend: healthFactor(p.valueWeekend, s.params.lltv, newDebt),
  };
}

export function liquidationOutcome(s: BlueSnapshot) {
  const p = derivePosition(s);
  const incentive = Math.min(1.15, 1 / (0.3 * s.params.lltv + 0.7));
  const liquidatable = p.healthNow < 1;
  const repaid = liquidatable ? Math.min(s.debt, p.valueNow / incentive) : 0;
  const seized = p.valueNow > 0
    ? s.collateralRaw * numberToWad(Math.min(1, repaid * incentive / p.valueNow)) / WAD
    : 0n;
  return { liquidatable, repaid, seized };
}
