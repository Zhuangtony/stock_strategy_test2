'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { BacktestResults } from '../components/backtest/BacktestResults';
import { ComparisonDeltaManager } from '../components/backtest/ComparisonDeltaManager';
import { createDeltaId, type ComparisonDeltaInput, type ComparisonResultEntry } from '../components/backtest/types';
import { runBacktest, type BacktestParams, type RunBacktestResult } from '../lib/backtest';

async function fetchYahooDailyViaApi(ticker: string, start: string, end: string) {
  const u = `/api/yahoo?symbol=${encodeURIComponent(ticker)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const res = await fetch(u, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const json = await res.json();
  if (!json?.rows?.length) throw new Error('沒有資料（請檢查代碼或日期範圍）');
  return {
    rows: json.rows as { date: string; open: number; high: number; low: number; close: number; adjClose: number }[],
    earningsDates: Array.isArray(json.earningsDates) ? (json.earningsDates as string[]) : [],
  };
}

const panelClass =
  'rounded-3xl border border-slate-200/80 bg-white/95 shadow-[0_20px_45px_-28px_rgb(15_23_42_/_55%)] backdrop-blur-sm';

const clampDelta = (value: number) => Math.max(0.05, Math.min(0.95, value));

export default function Page() {
  const [ticker, setTicker] = useState('AAPL');
  const [start, setStart] = useState('2018-01-01');
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [initialCapital, setInitialCapital] = useState(0);
  const [shares, setShares] = useState(100);
  const [targetDelta, setTargetDelta] = useState(0.3);
  const [freq, setFreq] = useState<BacktestParams['freq']>('weekly');
  const [ivOverride, setIvOverride] = useState<number | null>(null);
  const [reinvestPremium, setReinvestPremium] = useState(true);
  const [roundStrikeToInt, setRoundStrikeToInt] = useState(true);
  const [skipEarningsWeek, setSkipEarningsWeek] = useState(false);
  const [dynamicContracts, setDynamicContracts] = useState(true);
  const [enableRoll, setEnableRoll] = useState(true);
  const [rollDeltaThreshold, setRollDeltaThreshold] = useState(0.7);
  const [rollDaysBeforeExpiry, setRollDaysBeforeExpiry] = useState(0);
  const [riskFreeRate, setRiskFreeRate] = useState(0.03);
  const [dividendYield, setDividendYield] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunBacktestResult | null>(null);
  const [comparisonDeltas, setComparisonDeltas] = useState<ComparisonDeltaInput[]>([]);
  const [comparisonResults, setComparisonResults] = useState<ComparisonResultEntry[]>([]);

  const trimmedTicker = useMemo(() => ticker.trim().toUpperCase(), [ticker]);

  const validationError = useMemo(() => {
    if (!trimmedTicker) return '請輸入股票代號';
    if (!start || !end) return '請選擇完整的日期範圍';
    if (start > end) return '結束日期需晚於開始日期';
    if (!Number.isFinite(targetDelta) || targetDelta < 0.1 || targetDelta > 0.6) return '目標 Delta 建議介於 0.10 ~ 0.60';
    if (shares <= 0 && initialCapital <= 0) return '請至少設定初始資金或持有股數（兩者其一即可）';
    if (!Number.isFinite(riskFreeRate) || riskFreeRate < -0.05 || riskFreeRate > 0.5)
      return '無風險利率請介於 -5% 至 50% 之間';
    if (!Number.isFinite(dividendYield) || dividendYield < 0 || dividendYield > 0.4)
      return '股利殖利率請介於 0% 至 40%';
    return null;
  }, [dividendYield, end, initialCapital, riskFreeRate, shares, start, targetDelta, trimmedTicker]);

  const handleAddComparisonDelta = useCallback(() => {
    setComparisonDeltas(prev => {
      const lastValue = prev.length > 0 ? prev[prev.length - 1].value : targetDelta;
      const suggested = lastValue + 0.05;
      const clamped = clampDelta(Math.max(0.1, Math.min(0.6, suggested)));
      const nextValue = Number(clamped.toFixed(2));
      const id = createDeltaId();
      setComparisonResults(prevResults => [...prevResults, { id, value: nextValue, result: null }]);
      return [...prev, { id, value: nextValue }];
    });
  }, [targetDelta]);

  const handleComparisonDeltaChange = useCallback((id: string, value: number) => {
    const clamped = Math.max(0.1, Math.min(0.6, value));
    const nextValue = Number(clamped.toFixed(2));
    setComparisonDeltas(prev => prev.map(item => (item.id === id ? { ...item, value: nextValue } : item)));
    setComparisonResults(prev => prev.map(item => (item.id === id ? { ...item, value: nextValue, result: null } : item)));
  }, []);

  const handleRemoveComparisonDelta = useCallback((id: string) => {
    setComparisonDeltas(prev => prev.filter(item => item.id !== id));
    setComparisonResults(prev => prev.filter(item => item.id !== id));
  }, []);

  const run = useCallback(async () => {
    const validationMessage = validationError;
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    setComparisonResults(prev => prev.map(item => ({ ...item, result: null })));

    try {
      const payload = await fetchYahooDailyViaApi(trimmedTicker, start, end);
      if (payload.rows.length < 30) throw new Error('資料太少，請擴大日期範圍');

      const params: BacktestParams = {
        initialCapital,
        shares,
        r: riskFreeRate,
        q: dividendYield,
        targetDelta,
        freq,
        ivOverride,
        reinvestPremium,
        roundStrikeToInt,
        skipEarningsWeek,
        dynamicContracts,
        enableRoll,
        rollDeltaThreshold,
        rollDaysBeforeExpiry,
        earningsDates: payload.earningsDates,
      };

      const res = runBacktest(payload.rows, params);
      const extra = comparisonDeltas.map(deltaInput => ({
        id: deltaInput.id,
        value: deltaInput.value,
        result: runBacktest(payload.rows, {
          ...params,
          targetDelta: deltaInput.value,
        }),
      }));
      setResult(res);
      setComparisonResults(extra);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [
    comparisonDeltas,
    dividendYield,
    dynamicContracts,
    enableRoll,
    end,
    freq,
    initialCapital,
    ivOverride,
    reinvestPremium,
    riskFreeRate,
    rollDaysBeforeExpiry,
    rollDeltaThreshold,
    roundStrikeToInt,
    shares,
    skipEarningsWeek,
    start,
    targetDelta,
    trimmedTicker,
    validationError,
  ]);

  const summaryCards = useMemo(
    () => [
      {
        label: '資料期間',
        value: `${start} → ${end}`,
        footnote: '請確保至少包含 30 個交易日以取得穩定結果',
      },
      {
        label: '投入資金',
        value:
          initialCapital > 0
            ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
                initialCapital,
              )
            : '—',
        footnote: shares > 0 ? `現股部位：${shares} 股` : '建議至少保留現金或持股其一',
      },
      {
        label: '策略參數',
        value: `Δ ${targetDelta.toFixed(2)} · ${freq === 'weekly' ? '每週換倉' : '每月換倉'}`,
        footnote: enableRoll ? `Roll 閾值：${rollDeltaThreshold.toFixed(2)}` : '已停用自動 Roll',
      },
      {
        label: '利率假設',
        value: `r=${(riskFreeRate * 100).toFixed(1)}% · q=${(dividendYield * 100).toFixed(1)}%`,
        footnote: '可依市場狀況調整無風險利率與股利殖利率',
      },
    ],
    [dividendYield, enableRoll, end, freq, initialCapital, riskFreeRate, rollDeltaThreshold, shares, start, targetDelta],
  );

  const runDisabled = busy || Boolean(validationError);

  return (
    <main className="bg-gradient-to-br from-slate-100 via-indigo-100/60 to-white min-h-screen py-10 text-slate-800">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 md:px-6 lg:px-8">
        <header className="flex flex-col gap-4 text-center md:text-left">
          <span className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-500">Covered Call Lab</span>
          <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">美股 Covered Call 回測工作坊</h1>
          <p className="text-sm text-slate-600 md:text-base">
            輸入任意美股代號與期間，即時比較 Buy &amp; Hold 與 Covered Call 策略的績效、Roll up &amp; out 行為與
            結算勝率。
          </p>
        </header>

        <section className={`${panelClass} p-6 md:p-8`}>
          <h2 className="text-lg font-semibold text-slate-900">回測參數</h2>
          <p className="mt-1 text-xs text-slate-500 md:text-sm">
            以 Yahoo Finance 歷史資料為基礎估算 Black-Scholes 價格；您可調整 Delta、換倉頻率與利率假設。
          </p>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <label className="space-y-2">
              <div className="text-sm">股票代號</div>
              <input
                type="text"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                placeholder="如：AAPL"
                maxLength={12}
              />
            </label>
            <label className="space-y-2">
              <div className="text-sm">開始日期</div>
              <input
                type="date"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={start}
                onChange={e => setStart(e.target.value)}
              />
            </label>
            <label className="space-y-2">
              <div className="text-sm">結束日期</div>
              <input
                type="date"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={end}
                onChange={e => setEnd(e.target.value)}
                min={start}
              />
            </label>
            <label className="space-y-2">
              <div className="text-sm">初始資金 (USD)</div>
              <input
                type="number"
                min={0}
                step={100}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={initialCapital}
                onChange={e => setInitialCapital(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label className="space-y-2">
              <div className="text-sm">持有股數</div>
              <input
                type="number"
                min={0}
                step={10}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={shares}
                onChange={e => setShares(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>目標 Delta</span>
                <span className="text-xs text-slate-500">{targetDelta.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={0.6}
                step={0.01}
                value={targetDelta}
                onChange={e => setTargetDelta(Number(e.target.value))}
                className="accent-indigo-500"
              />
            </label>
            <ComparisonDeltaManager
              deltas={comparisonDeltas}
              onAdd={handleAddComparisonDelta}
              onChange={handleComparisonDeltaChange}
              onRemove={handleRemoveComparisonDelta}
            />
            <label className="space-y-2">
              <div className="text-sm">換倉頻率</div>
              <select
                className="w-full rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={freq}
                onChange={e => setFreq(e.target.value as BacktestParams['freq'])}
              >
                <option value="weekly">每週換倉</option>
                <option value="monthly">每月換倉</option>
              </select>
            </label>
            <label className="space-y-2">
              <div className="text-sm">覆寫 IV（年化，選填）</div>
              <input
                type="number"
                step={0.01}
                min={0}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                placeholder="例如 0.35"
                value={ivOverride ?? ''}
                onChange={e => setIvOverride(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
              />
            </label>
            <label className="space-y-2">
              <div className="text-sm">無風險利率 r</div>
              <input
                type="number"
                step={0.005}
                min={-0.05}
                max={0.5}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={riskFreeRate}
                onChange={e => setRiskFreeRate(Number(e.target.value))}
              />
              <p className="text-xs text-slate-500">預設為 3%（0.03）。</p>
            </label>
            <label className="space-y-2">
              <div className="text-sm">股利殖利率 q</div>
              <input
                type="number"
                step={0.005}
                min={0}
                max={0.4}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={dividendYield}
                onChange={e => setDividendYield(Math.max(0, Number(e.target.value)))}
              />
              <p className="text-xs text-slate-500">預設為 0（無股利）。</p>
            </label>
            <label className="mt-6 flex items-center gap-3 rounded-2xl bg-slate-50/80 px-4 py-3">
              <input
                type="checkbox"
                checked={reinvestPremium}
                onChange={e => setReinvestPremium(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm">權利金滾入再投資 (買股)</span>
            </label>
            <div className="grid gap-3 text-sm md:col-span-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm">
                <input
                  type="checkbox"
                  checked={roundStrikeToInt}
                  onChange={e => setRoundStrikeToInt(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Call 履約價取整數</span>
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm">
                <input
                  type="checkbox"
                  checked={skipEarningsWeek}
                  onChange={e => setSkipEarningsWeek(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>跳過財報週 (不賣 Call)</span>
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm">
                <input
                  type="checkbox"
                  checked={dynamicContracts}
                  onChange={e => setDynamicContracts(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>合約張數依持股動態調整</span>
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm">
                <input
                  type="checkbox"
                  checked={enableRoll}
                  onChange={e => setEnableRoll(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Delta 觸價時 Roll up &amp; out</span>
              </label>
            </div>
            {enableRoll && (
              <div className="md:col-span-3 flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5 text-xs md:text-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <span className="font-semibold text-indigo-900">Roll Delta 閾值： {rollDeltaThreshold.toFixed(2)}</span>
                  <div className="flex flex-1 items-center gap-3 md:max-w-md">
                    <input
                      type="range"
                      min={0.3}
                      max={0.95}
                      step={0.01}
                      value={rollDeltaThreshold}
                      onChange={e => setRollDeltaThreshold(clampDelta(Number(e.target.value)))}
                      className="flex-1 accent-indigo-500"
                    />
                    <input
                      type="number"
                      min={0.3}
                      max={0.95}
                      step={0.01}
                      value={rollDeltaThreshold}
                      onChange={e => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        setRollDeltaThreshold(clampDelta(next));
                      }}
                      className="w-24 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-right shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <span className="font-semibold text-indigo-900">
                    預設換倉日：到期前 {rollDaysBeforeExpiry + 1} 天
                  </span>
                  <div className="flex flex-1 items-center gap-3 md:max-w-md">
                    <input
                      type="range"
                      min={0}
                      max={4}
                      step={1}
                      value={rollDaysBeforeExpiry}
                      onChange={e => setRollDaysBeforeExpiry(Math.max(0, Math.min(4, Number(e.target.value))))}
                      className="flex-1 accent-indigo-500"
                    />
                    <input
                      type="number"
                      min={0}
                      max={4}
                      step={1}
                      value={rollDaysBeforeExpiry}
                      onChange={e => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        setRollDaysBeforeExpiry(Math.max(0, Math.min(4, Math.round(next))));
                      }}
                      className="w-24 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-right shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-indigo-900/70 md:text-xs">
                  Delta 達到閾值時會執行 Roll up &amp; out；亦可設定固定換倉日前（最多提前 5 天）。
                </p>
              </div>
            )}
            <div className="md:col-span-3 flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {summaryCards.map(card => (
                  <div key={card.label} className="flex flex-col rounded-2xl border border-slate-200/70 bg-white/70 p-4 shadow-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{card.label}</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">{card.value}</div>
                    <div className="mt-auto text-xs text-slate-400">{card.footnote}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  onClick={run}
                  disabled={runDisabled}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? '計算中…' : '開始回測'}
                </button>
                {(error || validationError) && (
                  <div className="text-xs text-red-600 md:text-sm">{error ?? validationError}</div>
                )}
              </div>
            </div>
          </div>
        </section>

        {result ? (
          <BacktestResults
            result={result}
            comparisonDeltas={comparisonDeltas}
            comparisonResults={comparisonResults}
            ticker={trimmedTicker}
            start={start}
            end={end}
            panelClass={panelClass}
          />
        ) : (
          <section className={`${panelClass} p-6 md:p-8`}>
            <h2 className="font-semibold mb-3">如何使用？</h2>
            <p className="text-sm leading-7">
              輸入美股代號（如 AAPL、TSLA）與日期範圍，點擊「開始回測」。系統會透過伺服器端 API 抓取 Yahoo 股價，
              比較 Buy &amp; Hold 與 Covered Call 策略的資產變化。
            </p>
            <p className="text-sm leading-7">
              可調整賣方 Delta、換倉頻率與是否將權利金再投資；亦可覆寫 IV、設定利率假設，或新增多組 Delta 用於比較。
            </p>
          </section>
        )}

        <footer className="pt-4 pb-6 text-center text-xs text-slate-400">
          此工具僅供學術研究與策略模擬，不構成任何投資建議。
        </footer>
      </div>
    </main>
  );
}
