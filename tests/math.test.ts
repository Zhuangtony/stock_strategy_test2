import { describe, it, expect } from 'vitest';
import { normCDF, bsCallPrice, bsCallDelta, findStrikeForTargetDelta, estimateHV } from '../lib/optionMath';
import { generateCycleBoundaries, runBacktest, type BacktestParams } from '../lib/backtest';

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

  it('cycle boundaries weekly/monthly produce ordered pairs and handle year crossover', () => {
    const dates = ['2024-12-30', '2024-12-31', '2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07'];
    const weekly = generateCycleBoundaries(dates, 'weekly');
    const monthly = generateCycleBoundaries(dates, 'monthly');
    expect(weekly.length % 2).toBe(0);
    expect(monthly.length % 2).toBe(0);
    expect(weekly[0]).toBe(0);
    expect(weekly[1]).toBe(1);
    expect(monthly[2]).toBe(2);
  });

  it('HV returns a sane positive value', () => {
    const series = [100, 101, 99, 100, 102, 103, 101, 100, 104, 105];
    const hv = estimateHV(series);
    expect(hv).toBeGreaterThan(0);
    expect(hv).toBeLessThan(2);
  });

  const baseParams: BacktestParams = {
    initialCapital: 0,
    shares: 100,
    r: 0.03,
    q: 0,
    targetDelta: 0.3,
    freq: 'weekly',
    ivOverride: 0.3,
    reinvestPremium: true,
    premiumReinvestShareThreshold: 1,
    roundStrikeToInt: true,
    skipEarningsWeek: false,
    dynamicContracts: true,
    enableRoll: true,
    earningsDates: [],
    rollDeltaThreshold: 0.7,
    rollDaysBeforeExpiry: 0,
  };

  it('backtest produces curves and summary', () => {
    const rows = [
      { date: '2025-01-02', close: 100, adjClose: 100 },
      { date: '2025-01-03', close: 101, adjClose: 101 },
      { date: '2025-01-06', close: 99, adjClose: 99 },
      { date: '2025-01-07', close: 100, adjClose: 100 },
      { date: '2025-01-08', close: 102, adjClose: 102 },
      { date: '2025-01-09', close: 104, adjClose: 104 },
    ];
    const res = runBacktest(rows, baseParams);
    expect(res.curve.length).toBe(rows.length);
    expect(Number.isFinite(res.hv)).toBe(true);
    expect(Number.isFinite(res.ivUsed)).toBe(true);
    expect(res.settlements.length).toBeGreaterThan(0);
  });

  it('skips opening positions during earnings week when configured', () => {
    const rows = [
      { date: '2024-01-02', close: 100, adjClose: 100 },
      { date: '2024-01-03', close: 101, adjClose: 101 },
      { date: '2024-01-04', close: 102, adjClose: 102 },
      { date: '2024-01-05', close: 103, adjClose: 103 },
      { date: '2024-01-08', close: 104, adjClose: 104 },
      { date: '2024-01-09', close: 105, adjClose: 105 },
      { date: '2024-01-10', close: 106, adjClose: 106 },
      { date: '2024-01-11', close: 107, adjClose: 107 },
    ];
    const normal = runBacktest(rows, { ...baseParams, earningsDates: [] });
    const skipped = runBacktest(rows, { ...baseParams, skipEarningsWeek: true, earningsDates: ['2024-01-04'] });
    const firstWeekStrikeNormal = normal.curve.slice(0, 4).some(point => typeof point.CallStrike === 'number');
    const firstWeekStrikeSkipped = skipped.curve.slice(0, 4).some(point => typeof point.CallStrike === 'number');
    expect(firstWeekStrikeNormal).toBe(true);
    expect(firstWeekStrikeSkipped).toBe(false);
  });

  it('schedules roll events when delta threshold is reached', () => {
    const rows: { date: string; close: number; adjClose: number }[] = [];
    let price = 100;
    for (let i = 0; i < 40; i++) {
      price += i < 20 ? 1.5 : -0.5;
      rows.push({ date: `2024-02-${String(i + 1).padStart(2, '0')}`, close: price, adjClose: price });
    }
    const res = runBacktest(rows, { ...baseParams, enableRoll: true, rollDeltaThreshold: 0.55 });
    expect(res.rollEvents.length).toBeGreaterThan(0);
  });

  it('waits until premium can buy configured share lots before reinvesting', () => {
    const rows: { date: string; close: number; adjClose: number }[] = [];
    for (let i = 0; i < 80; i++) {
      const d = new Date(Date.UTC(2024, 0, 2 + i));
      const iso = d.toISOString().slice(0, 10);
      rows.push({ date: iso, close: 100, adjClose: 100 });
    }
    const immediate = runBacktest(rows, {
      ...baseParams,
      enableRoll: false,
      premiumReinvestShareThreshold: 1,
    });
    const batched = runBacktest(rows, {
      ...baseParams,
      enableRoll: false,
      premiumReinvestShareThreshold: 5,
    });
    const initialShares = baseParams.shares;
    const firstImmediate = immediate.curve.findIndex(point => point.CoveredCallShares > initialShares);
    const firstBatched = batched.curve.findIndex(point => point.CoveredCallShares > initialShares);
    expect(firstImmediate).toBeGreaterThanOrEqual(0);
    expect(firstBatched).toBeGreaterThan(firstImmediate);
  });
});
