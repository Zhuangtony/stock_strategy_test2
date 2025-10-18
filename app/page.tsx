'use client';

import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
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
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={30} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v: any) => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v)} />
                    <Legend />
                    <Line type="monotone" dataKey="BuyAndHold" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="CoveredCall" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-2xl border bg-white shadow-sm p-4 md:p-6">
              <h2 className="font-semibold mb-4">回測摘要</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
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
