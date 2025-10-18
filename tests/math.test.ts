import { describe, it, expect } from 'vitest';
import { normCDF, bsCallPrice, bsCallDelta, findStrikeForTargetDelta, estimateHV } from '../lib/optionMath';
import { generateCycleBoundaries, runBacktest } from '../lib/backtest';

describe('math/option helpers', () => {
  it('normCDF is within [0,1] and symmetric-ish', () => {
    expect(normCDF(0)).toBeGreaterThan(0.49);
    expect(normCDF(0)).toBeLessThan(0.51);
    expect(normCDF(5)).toBeGreaterThan(0.999);
    expect(normCDF(-5)).toBeLessThan(0.0015);
  });

  it('call price increases with S and decreases with K', () => {
    const S1 = 100, S2 = 110, K1 = 100, K2 = 110, r = 0.03, q = 0, sigma = 0.3, T = 0.5;
    const p1 = bsCallPrice(S1, K1, r, q, sigma, T);
    const p2 = bsCallPrice(S2, K1, r, q, sigma, T);
    const p3 = bsCallPrice(S1, K2, r, q, sigma, T);
    expect(p2).toBeGreaterThan(p1);
    expect(p3).toBeLessThan(p1);
  });

  it('delta is between 0 and 1, grows with S', () => {
    const r = 0.03, q = 0, sigma = 0.3, T = 0.25;
    const d1 = bsCallDelta(90, 100, r, q, sigma, T);
    const d2 = bsCallDelta(110, 100, r, q, sigma, T);
    expect(d1).toBeGreaterThanOrEqual(0);
    expect(d2).toBeLessThanOrEqual(1);
    expect(d2).toBeGreaterThan(d1);
  });

  it('strike solver roughly hits target delta', () => {
    const S = 100, r = 0.03, q = 0, sigma = 0.3, T = 0.2, target = 0.3;
    const K = findStrikeForTargetDelta(S, target, r, q, sigma, T);
    const d = bsCallDelta(S, K, r, q, sigma, T);
    expect(Math.abs(d - target)).toBeLessThan(0.02);
  });

  it('cycle boundaries weekly/monthly produce pairs', () => {
    const dates = ['2024-12-30','2024-12-31','2025-01-02','2025-01-03','2025-01-06','2025-01-07'];
    const w = generateCycleBoundaries(dates, 'weekly');
    const m = generateCycleBoundaries(dates, 'monthly');
    expect(w.length % 2).toBe(0);
    expect(m.length % 2).toBe(0);
  });

  it('HV returns a sane positive value', () => {
    const series = [100, 101, 99, 100, 102, 103, 101, 100, 104, 105];
    const hv = estimateHV(series);
    expect(hv).toBeGreaterThan(0);
    expect(hv).toBeLessThan(2);
  });

  it('backtest produces curves and summary', () => {
    const rows = [
      { date: '2025-01-02', close: 100, adjClose: 100 },
      { date: '2025-01-03', close: 101, adjClose: 101 },
      { date: '2025-01-06', close: 99, adjClose: 99 },
      { date: '2025-01-07', close: 100, adjClose: 100 },
      { date: '2025-01-08', close: 102, adjClose: 102 },
      { date: '2025-01-09', close: 104, adjClose: 104 }
    ];
    const res = runBacktest(rows as any, { initialCapital: 0, shares: 100, r: 0.03, q: 0, targetDelta: 0.3, freq: 'weekly', ivOverride: 0.3, reinvestPremium: true });
    expect(res.curve.length).toBe(rows.length);
    expect(Number.isFinite(res.hv)).toBe(true);
    expect(Number.isFinite(res.ivUsed)).toBe(true);
  });
});
