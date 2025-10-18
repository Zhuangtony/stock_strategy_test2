/*
  Simple smoke test to exercise runBacktest with real Yahoo data.
  Usage: npm run smoke -- [SYMBOL] [START] [END]
*/
import { runBacktest } from '../lib/backtest';

async function fetchYahooDaily(symbol: string, start: string, end: string) {
  const startTs = Math.floor(new Date(start).getTime() / 1000);
  const endTs = Math.floor(new Date(end).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${startTs}&period2=${endTs}&interval=1d&includePrePost=false&events=div,splits,earnings`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo status ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error('No data');

  const ts: number[] = r.timestamp || [];
  const close: number[] = r.indicators?.quote?.[0]?.close || [];
  const open: number[] = r.indicators?.quote?.[0]?.open || [];
  const high: number[] = r.indicators?.quote?.[0]?.high || [];
  const low: number[] = r.indicators?.quote?.[0]?.low || [];
  const adjClose: number[] = r.indicators?.adjclose?.[0]?.adjclose || close;

  const toDate = (ts: number) => {
    const d = new Date(ts * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const rows = [] as { date: string; open: number; high: number; low: number; close: number; adjClose: number }[];
  for (let i = 0; i < ts.length; i++) {
    if (close[i] == null || !Number.isFinite(close[i])) continue;
    rows.push({ date: toDate(ts[i]), open: open[i], high: high[i], low: low[i], close: close[i], adjClose: adjClose[i] ?? close[i] });
  }

  const earningsRaw = r.events?.earnings;
  const earningsDatesSet = new Set<string>();
  if (earningsRaw && typeof earningsRaw === 'object') {
    for (const key of Object.keys(earningsRaw)) {
      const entry = earningsRaw[key];
      if (!entry) continue;
      const dates = Array.isArray(entry.earningsDate) ? entry.earningsDate : [];
      for (const item of dates) {
        const raw = typeof item?.raw === 'number' ? item.raw : typeof item === 'number' ? item : null;
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          earningsDatesSet.add(toDate(raw));
        }
      }
      if (typeof entry?.date === 'number' && Number.isFinite(entry.date)) {
        earningsDatesSet.add(toDate(entry.date));
      }
    }
  }

  return { rows, earningsDates: Array.from(earningsDatesSet) };
}

async function main() {
  const symbol = process.argv[2] || 'AAPL';
  const start = process.argv[3] || '2018-01-01';
  const end = process.argv[4] || new Date().toISOString().slice(0, 10);
  console.log(`Fetching ${symbol} ${start} ~ ${end} ...`);
  const payload = await fetchYahooDaily(symbol, start, end);
  if (!payload.rows.length) throw new Error('No rows from Yahoo');

  const params = {
    initialCapital: 0,
    shares: 100,
    r: 0.03,
    q: 0,
    targetDelta: 0.3,
    freq: 'weekly' as const,
    ivOverride: null as number | null,
    reinvestPremium: true,
    roundStrikeToInt: true,
    skipEarningsWeek: false,
    dynamicContracts: true,
    enableRoll: true,
    earningsDates: payload.earningsDates,
    rollDeltaThreshold: 0.7,
  };

  console.log('Running backtest ...');
  const result = runBacktest(payload.rows as any, params);
  console.log('Done.');
  console.log({
    points: result.curve.length,
    hv: result.hv,
    ivUsed: result.ivUsed,
    bhReturn: result.bhReturn,
    ccReturn: result.ccReturn,
  });
}

main().catch((e) => {
  console.error('Smoke failed:', e?.message || e);
  process.exit(1);
});
