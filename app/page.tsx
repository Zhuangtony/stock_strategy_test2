'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
  ReferenceDot,
  Brush,
  TooltipProps,
} from 'recharts';
import { runBacktest } from '../lib/backtest';

async function fetchYahooDailyViaApi(ticker: string, start: string, end: string) {
  const u = `/api/yahoo?symbol=${encodeURIComponent(ticker)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const res = await fetch(u, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const json = await res.json();
  if (!json?.rows?.length) throw new Error('沒有資料（檢查代碼/日期）');
  return json.rows as { date: string; open: number; high: number; low: number; close: number; adjClose: number }[];
}

export default function Page() {
  const [ticker, setTicker] = useState('AAPL');
  const [start, setStart] = useState('2018-01-01');
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [initialCapital, setInitialCapital] = useState(0);
  const [shares, setShares] = useState(100);
  const [targetDelta, setTargetDelta] = useState(0.3);
  const [freq, setFreq] = useState<'weekly' | 'monthly'>('weekly');
  const [ivOverride, setIvOverride] = useState<number | null>(null);
  const [reinvestPremium, setReinvestPremium] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const r = 0.03;
  const q = 0.00;

  async function run() {
    setBusy(true); setError(null); setResult(null);
    try {
      const data = await fetchYahooDailyViaApi(ticker.trim(), start, end);
      if (data.length < 30) throw new Error('資料太少，請放大日期區間。');
      const res = runBacktest(data, { initialCapital, shares, r, q, targetDelta, freq, ivOverride, reinvestPremium });
      setResult(res);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally { setBusy(false); }
  }

  const chartData = result?.curve || [];
  const chartLength = chartData.length;
  const settlementPoints = useMemo(() => (result?.settlements || []).filter((s: any) => s.qty > 0), [result]);

  const MAX_VISIBLE_POINTS = 10;
  const [visibleCount, setVisibleCount] = useState<number>(MAX_VISIBLE_POINTS);
  const [startIndex, setStartIndex] = useState(0);

  useEffect(() => {
    if (chartLength > 0) {
      const nextCount = Math.min(MAX_VISIBLE_POINTS, chartLength);
      setVisibleCount(nextCount);
      setStartIndex(0);
    } else {
      setVisibleCount(MAX_VISIBLE_POINTS);
      setStartIndex(0);
    }
  }, [chartLength]);

  useEffect(() => {
    if (chartLength === 0) return;
    const maxStart = Math.max(chartLength - visibleCount, 0);
    if (startIndex > maxStart) {
      setStartIndex(maxStart);
    }
  }, [chartLength, visibleCount, startIndex]);

  const endIndex = chartLength > 0 ? Math.min(startIndex + visibleCount - 1, chartLength - 1) : -1;

  const visibleData = useMemo(
    () => (chartLength > 0 && endIndex >= startIndex ? chartData.slice(startIndex, endIndex + 1) : []),
    [chartData, chartLength, endIndex, startIndex]
  );

  const visibleRangeLabel = useMemo(() => {
    if (!visibleData.length) return '';
    const first = visibleData[0]?.date;
    const last = visibleData[visibleData.length - 1]?.date;
    return first === last ? first : `${first} ~ ${last}`;
  }, [visibleData]);

  const visibleSettlements = useMemo(() => {
    if (!visibleData.length) return [] as any[];
    const dateSet = new Set(visibleData.map((point: any) => point.date));
    return settlementPoints.filter((point: any) => dateSet.has(point.date));
  }, [settlementPoints, visibleData]);

  const maxStartIndex = Math.max(chartLength - visibleCount, 0);
  const maxSelectableCount = Math.min(MAX_VISIBLE_POINTS, chartLength > 0 ? chartLength : MAX_VISIBLE_POINTS);

  const formatCurrency = (value: number, fractionDigits = 2) =>
    value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: fractionDigits });
  const formatPnL = (value: number) => `${value >= 0 ? '+' : ''}${formatCurrency(value, 0)}`;

  const CustomTooltip = ({ active, payload, label }: TooltipProps<number | string, string>) => {
    if (!active || !payload || payload.length === 0) return null;
    const settlement = (payload[0].payload as any)?.settlement;
    return (
      <div className="rounded-xl border bg-white p-3 text-xs shadow-lg">
        <div className="mb-2 text-sm font-semibold">{label}</div>
        <div className="space-y-1">
          {payload.map(item => (
            <div key={item.dataKey} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color || '#000' }} />
                {item.name}
              </span>
              <span>
                {(() => {
                  const rawValue = item.value;
                  if (typeof rawValue === 'number') {
                    return rawValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
                  }
                  if (Array.isArray(rawValue)) {
                    return rawValue
                      .map(v => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v))
                      .join(', ');
                  }
                  return rawValue ?? '';
                })()}
              </span>
            </div>
          ))}
        </div>
        {settlement && settlement.qty > 0 && (
          <div className="mt-3 border-t pt-2">
            <div className="font-semibold">Covered Call 結算</div>
            <div className="mt-1 space-y-1">
              <div>盈虧：{formatPnL(settlement.pnl)} USD</div>
              <div>履約價：{settlement.strike.toFixed(2)}</div>
              <div>標的價格：{settlement.underlying.toFixed(2)}</div>
              <div>賣出權利金：{formatCurrency(settlement.premium * settlement.qty * 100, 2)} USD</div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <main className="p-6 md:p-10">
      <div className="max-w-6xl mx-auto grid gap-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold">Covered Call 策略回測器（Next.js 版）</h1>
          <div className="text-sm opacity-70">資料來源：Yahoo Finance（經由伺服器端代理）</div>
        </header>

        <section className="rounded-2xl border bg-white shadow-sm p-4 md:p-6">
          <h2 className="font-semibold mb-4">參數設定</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <div className="text-sm">股票代碼（美股）</div>
              <input className="w-full rounded-xl border p-2" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="如 AAPL、TSLA" />
            </label>
            <label className="space-y-2">
              <div className="text-sm">開始日期</div>
              <input type="date" className="w-full rounded-xl border p-2" value={start} onChange={e => setStart(e.target.value)} />
            </label>
            <label className="space-y-2">
              <div className="text-sm">結束日期</div>
              <input type="date" className="w-full rounded-xl border p-2" value={end} onChange={e => setEnd(e.target.value)} />
            </label>
            <label className="space-y-2">
              <div className="text-sm">初始現金（USD，可為0）</div>
              <input type="number" className="w-full rounded-xl border p-2" value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))} />
            </label>
            <label className="space-y-2">
              <div className="text-sm">持有股數（covered shares）</div>
              <input type="number" className="w-full rounded-xl border p-2" value={shares} onChange={e => setShares(Number(e.target.value))} />
            </label>
            <label className="space-y-2">
              <div className="text-sm">標的 Delta 目標：{targetDelta.toFixed(2)}</div>
              <input type="range" min={0.1} max={0.6} step={0.01} value={targetDelta} onChange={e => setTargetDelta(Number(e.target.value))} />
            </label>
            <label className="space-y-2">
              <div className="text-sm">到期頻率</div>
              <select className="w-full rounded-xl border p-2" value={freq} onChange={e => setFreq(e.target.value as any)}>
                <option value="weekly">週選擇權</option>
                <option value="monthly">月選擇權</option>
              </select>
            </label>
            <label className="space-y-2">
              <div className="text-sm">覆寫 IV（年化，選填）</div>
              <input type="number" step="0.01" className="w-full rounded-xl border p-2" placeholder="例如 0.35" value={ivOverride ?? ''} onChange={e => setIvOverride(e.target.value === '' ? null : Number(e.target.value))} />
            </label>
            <label className="flex items-center gap-3 mt-6">
              <input type="checkbox" checked={reinvestPremium} onChange={e => setReinvestPremium(e.target.checked)} />
              <span>權利金再投入增持股票</span>
            </label>
            <div className="md:col-span-3">
              <button onClick={run} disabled={busy} className="rounded-xl bg-black text-white px-4 py-2 shadow">
                {busy ? '計算中…' : '開始回測'}
              </button>
            </div>
            {error && <div className="md:col-span-3 text-red-600 text-sm">{error}</div>}
          </div>
        </section>

        {result && (
          <>
            <section className="rounded-2xl border bg-white shadow-sm p-4 md:p-6">
              <h2 className="font-semibold mb-4">資產曲線（USD）</h2>
              <div className="mb-4 grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-xs md:text-sm">
                  <span className="font-medium">顯示資料筆數：{visibleData.length}</span>
                  <input
                    type="range"
                    min={1}
                    max={Math.max(1, maxSelectableCount)}
                    value={visibleCount > 0 ? Math.min(visibleCount, maxSelectableCount || 1) : 1}
                    disabled={chartLength <= 1}
                    onChange={e => {
                      const nextCount = Number(e.target.value);
                      if (Number.isNaN(nextCount) || chartLength === 0) return;
                      const clampedCount = Math.max(1, Math.min(MAX_VISIBLE_POINTS, Math.min(chartLength, nextCount)));
                      const maxStart = Math.max(chartLength - clampedCount, 0);
                      setVisibleCount(clampedCount);
                      setStartIndex(prev => Math.min(prev, maxStart));
                    }}
                  />
                </label>
                <label className="flex flex-col gap-2 text-xs md:text-sm">
                  <span className="font-medium">
                    瀏覽位置：{visibleRangeLabel || '—'}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, maxStartIndex)}
                    value={Math.min(startIndex, Math.max(0, maxStartIndex))}
                    disabled={chartLength === 0 || chartLength <= visibleCount}
                    onChange={e => {
                      const nextStart = Number(e.target.value);
                      if (Number.isNaN(nextStart)) return;
                      setStartIndex(Math.max(0, Math.min(nextStart, Math.max(0, maxStartIndex))));
                    }}
                  />
                </label>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={visibleData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={30} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Brush
                      data={chartData}
                      dataKey="date"
                      height={24}
                      travellerWidth={12}
                      stroke="#94a3b8"
                      startIndex={chartLength > 0 ? startIndex : undefined}
                      endIndex={endIndex >= 0 ? endIndex : undefined}
                      onChange={range => {
                        if (!range || typeof range.startIndex !== 'number' || typeof range.endIndex !== 'number') return;
                        if (chartLength === 0) return;
                        let nextStart = Math.max(0, range.startIndex);
                        let nextEnd = Math.min(chartLength - 1, range.endIndex);
                        if (nextEnd < nextStart) {
                          [nextStart, nextEnd] = [nextEnd, nextStart];
                        }
                        let requestedCount = nextEnd - nextStart + 1;
                        if (requestedCount > MAX_VISIBLE_POINTS) {
                          requestedCount = MAX_VISIBLE_POINTS;
                          nextEnd = Math.min(chartLength - 1, nextStart + requestedCount - 1);
                        }
                        const nextCount = Math.max(1, requestedCount);
                        const maxStart = Math.max(chartLength - nextCount, 0);
                        if (nextStart > maxStart) {
                          nextStart = maxStart;
                          nextEnd = Math.min(chartLength - 1, nextStart + nextCount - 1);
                        }
                        setVisibleCount(nextCount);
                        setStartIndex(nextStart);
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="BuyAndHold"
                      dot={false}
                      strokeWidth={2}
                      stroke="#2563eb"
                    />
                    <Line
                      type="monotone"
                      dataKey="CoveredCall"
                      dot={false}
                      strokeWidth={2}
                      stroke="#f97316"
                    />
                    {visibleSettlements.map((point: any, idx: number) => (
                      <ReferenceDot
                        key={`${point.date}-${idx}`}
                        x={point.date}
                        y={point.totalValue}
                        r={6}
                        fill={point.pnl >= 0 ? '#22c55e' : '#ef4444'}
                        stroke="white"
                        strokeWidth={1.5}
                        label={{
                          value: formatPnL(point.pnl),
                          position: 'top',
                          fill: point.pnl >= 0 ? '#16a34a' : '#dc2626',
                          fontSize: 11,
                        }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-2xl border bg-white shadow-sm p-4 md:p-6">
              <h2 className="font-semibold mb-4">回測摘要</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
                <div className="p-3 rounded-xl bg-slate-50 border">
                  <div className="opacity-60">估計歷史波動（HV，年化）</div>
                  <div className="text-lg font-semibold">{(result.hv * 100).toFixed(1)}%</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border">
                  <div className="opacity-60">使用 IV（年化）</div>
                  <div className="text-lg font-semibold">{(result.ivUsed * 100).toFixed(1)}%</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border">
                  <div className="opacity-60">Buy&Hold 總報酬</div>
                  <div className="text-lg font-semibold">{(result.bhReturn * 100).toFixed(1)}%</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border">
                  <div className="opacity-60">Covered Call 總報酬</div>
                  <div className="text-lg font-semibold">{(result.ccReturn * 100).toFixed(1)}%</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border">
                  <div className="opacity-60">Buy&Hold 最後持有股數</div>
                  <div className="text-lg font-semibold">{result.bhShares.toLocaleString()}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border">
                  <div className="opacity-60">Covered Call 最後持有股數</div>
                  <div className="text-lg font-semibold">{result.ccShares.toLocaleString()}</div>
                </div>
              </div>
            </section>
          </>
        )}

        {!result && (
          <section className="rounded-2xl border bg-white shadow-sm p-4 md:p-6">
            <h2 className="font-semibold mb-3">如何操作？</h2>
            <p className="text-sm leading-7">輸入美股代碼（如 AAPL、TSLA）、日期區間與參數，點擊「開始回測」。系統會透過伺服器端 API 代理 Yahoo，計算買入持有與不同週期的 covered call 策略資產曲線並比較。</p>
            <p className="text-sm leading-7">可調整 Delta 目標（常見 0.2–0.4）、週/月選擇權，以及是否將權利金再投入。若想更貼近實務市場報價，可覆寫年化隱含波動（IV）。</p>
          </section>
        )}

        <footer className="text-xs text-center opacity-60 pt-4">此工具僅供教育研究，不構成投資建議。</footer>
      </div>
    </main>
  );
}
