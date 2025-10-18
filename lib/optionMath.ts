// --- Math helpers: Black–Scholes (european call), normal CDF, delta ---
export function normCDF(x: number) {
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const a1 = 0.319381530, a2 = -0.356563782, a3 = 1.781477937, a4 = -1.821255978, a5 = 1.330274429;
  const m = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x) * (a1 * k + a2 * Math.pow(k, 2) + a3 * Math.pow(k, 3) + a4 * Math.pow(k, 4) + a5 * Math.pow(k, 5));
  return x >= 0 ? m : 1 - m;
}

export function bsCallPrice(S: number, K: number, r: number, q: number, sigma: number, T: number) {
  if (sigma <= 0 || T <= 0) return Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T));
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return S * Math.exp(-q * T) * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
}

export function bsCallDelta(S: number, K: number, r: number, q: number, sigma: number, T: number) {
  if (sigma <= 0 || T <= 0) return S > K ? 1 : 0;
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return Math.exp(-q * T) * normCDF(d1);
}

export function findStrikeForTargetDelta(S: number, targetDelta: number, r: number, q: number, sigma: number, T: number) {
  let low = 0.5 * S, high = 2.0 * S;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    const d = bsCallDelta(S, mid, r, q, sigma, T);
    if (d > targetDelta) { low = mid; } else { high = mid; }
  }
  return (low + high) / 2;
}

export function estimateHV(close: number[], tradingDays = 252) {
  const rets: number[] = [];
  for (let i = 1; i < close.length; i++) {
    const r = Math.log(close[i] / close[i - 1]);
    if (Number.isFinite(r)) rets.push(r);
  }
  if (rets.length < 2) return 0.2;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1);
  const dailyVol = Math.sqrt(v);
  return dailyVol * Math.sqrt(tradingDays);
}
