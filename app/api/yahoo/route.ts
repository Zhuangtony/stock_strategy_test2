import { NextResponse } from 'next/server';

function toDate(ts: number) {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol')?.trim();
  const start = searchParams.get('start')?.trim();
  const end = searchParams.get('end')?.trim();

  if (!symbol || !start || !end) {
    return NextResponse.json({ error: 'Missing symbol/start/end' }, { status: 400 });
  }
  const startTs = Math.floor(new Date(start).getTime() / 1000);
  const endTs = Math.floor(new Date(end).getTime() / 1000);
  if (!(endTs > startTs)) {
    return NextResponse.json({ error: 'Invalid time range' }, { status: 400 });
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${startTs}&period2=${endTs}&interval=1d&includePrePost=false&events=div,splits`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ error: `Yahoo status ${res.status}` }, { status: 502 });
    }
    const json = await res.json();
    const r = json?.chart?.result?.[0];
    if (!r) return NextResponse.json({ error: 'No data' }, { status: 404 });

    const ts: number[] = r.timestamp || [];
    const close: number[] = r.indicators?.quote?.[0]?.close || [];
    const open: number[] = r.indicators?.quote?.[0]?.open || [];
    const high: number[] = r.indicators?.quote?.[0]?.high || [];
    const low: number[] = r.indicators?.quote?.[0]?.low || [];
    const adjClose: number[] = r.indicators?.adjclose?.[0]?.adjclose || close;

    const rows = [] as { date: string; open: number; high: number; low: number; close: number; adjClose: number }[];
    for (let i = 0; i < ts.length; i++) {
      if (close[i] == null || !Number.isFinite(close[i])) continue;
      rows.push({ date: toDate(ts[i]), open: open[i], high: high[i], low: low[i], close: close[i], adjClose: adjClose[i] ?? close[i] });
    }
    return NextResponse.json({ rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'fetch failed' }, { status: 500 });
  }
}
