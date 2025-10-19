import { NextResponse } from 'next/server';

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
        }>;
        adjclose?: Array<{
          adjclose?: Array<number | null>;
        }>;
      };
      events?: {
        earnings?: Record<
          string,
          {
            date?: number;
            earningsDate?: Array<{ raw?: number } | number>;
          }
        >;
      };
    }>;
  };
};

function toISODate(timestampSeconds: number) {
  const date = new Date(timestampSeconds * 1000);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  return Number.isFinite(value) ? value : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.trim();
  const start = searchParams.get('start')?.trim();
  const end = searchParams.get('end')?.trim();

  if (!symbol || !start || !end) {
    return NextResponse.json({ error: 'Missing symbol/start/end' }, { status: 400 });
  }

  const startEpoch = Math.floor(new Date(start).getTime() / 1000);
  const endEpoch = Math.floor(new Date(end).getTime() / 1000);
  if (!Number.isFinite(startEpoch) || !Number.isFinite(endEpoch) || endEpoch <= startEpoch) {
    return NextResponse.json({ error: 'Invalid time range' }, { status: 400 });
  }
  const yahooUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  yahooUrl.searchParams.set('period1', String(startEpoch));
  yahooUrl.searchParams.set('period2', String(endEpoch));
  yahooUrl.searchParams.set('interval', '1d');
  yahooUrl.searchParams.set('includePrePost', 'false');
  yahooUrl.searchParams.set('events', 'div,splits,earnings');

  try {
    const response = await fetch(yahooUrl, { cache: 'no-store' });
    if (!response.ok) {
      return NextResponse.json({ error: `Yahoo status ${response.status}` }, { status: 502 });
    }

    const payload = (await response.json()) as YahooChartResponse;
    const result = payload.chart?.result?.[0];
    if (!result) {
      return NextResponse.json({ error: 'No data' }, { status: 404 });
    }

    const timestamps = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0];
    const adj = result.indicators?.adjclose?.[0];

    const rows: Array<{
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      adjClose: number;
    }> = [];

    for (let i = 0; i < timestamps.length; i++) {
      const close = normalizeNumber(quote?.close?.[i] ?? null);
      const open = normalizeNumber(quote?.open?.[i] ?? null);
      const high = normalizeNumber(quote?.high?.[i] ?? null);
      const low = normalizeNumber(quote?.low?.[i] ?? null);
      if (close == null || open == null || high == null || low == null) {
        continue;
      }
      const adjusted = normalizeNumber(adj?.adjclose?.[i] ?? close) ?? close;
      rows.push({
        date: toISODate(timestamps[i]),
        open,
        high,
        low,
        close,
        adjClose: adjusted,
      });
    }

    const earningsDates = new Set<string>();
    const earnings = result.events?.earnings;
    if (earnings) {
      for (const entry of Object.values(earnings)) {
        const directDate = normalizeNumber(entry?.date);
        if (directDate != null) {
          earningsDates.add(toISODate(directDate));
        }
        for (const item of entry?.earningsDate ?? []) {
          const raw = typeof item === 'number' ? item : normalizeNumber(item?.raw ?? null);
          if (raw != null) {
            earningsDates.add(toISODate(raw));
          }
        }
      }
    }

    return NextResponse.json({ rows, earningsDates: Array.from(earningsDates) });
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
