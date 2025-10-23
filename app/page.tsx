'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { BacktestResults } from '../components/backtest/BacktestResults';
import { StrategyConfigManager } from '../components/backtest/StrategyConfigManager';
import {
  cloneStrategyConfig,
  createStrategyConfig,
  type StrategyConfigInput,
  type StrategyRunResult,
} from '../components/backtest/types';
import { runBacktest, type BacktestParams } from '../lib/backtest';

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

const clampRange = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const floorToTwoDecimals = (value: number) => Math.floor(value * 100) / 100;
const clampDelta = (value: number) => clampRange(value, 0.1, 0.6);

export default function Page() {
  const [ticker, setTicker] = useState('AAPL');
  const [start, setStart] = useState('2018-01-01');
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [initialCapital, setInitialCapital] = useState(0);
  const [shares, setShares] = useState(100);
  const [freq, setFreq] = useState<BacktestParams['freq']>('weekly');
  const [ivOverride, setIvOverride] = useState<number | null>(null);
  const [riskFreeRate, setRiskFreeRate] = useState(0.03);
  const [dividendYield, setDividendYield] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strategyConfigs, setStrategyConfigs] = useState<StrategyConfigInput[]>(() => [
    createStrategyConfig({ label: '策略 1' }),
  ]);
  const [strategyResults, setStrategyResults] = useState<StrategyRunResult[]>([]);

  const trimmedTicker = useMemo(() => ticker.trim().toUpperCase(), [ticker]);

  const validationError = useMemo(() => {
    if (!trimmedTicker) return '請輸入股票代號';
    if (!start || !end) return '請選擇完整的日期範圍';
    if (start > end) return '結束日期需晚於開始日期';
    if (shares <= 0 && initialCapital <= 0) return '請至少設定初始資金或持有股數（兩者其一即可）';
    if (!Number.isFinite(riskFreeRate) || riskFreeRate < -0.05 || riskFreeRate > 0.5)
      return '無風險利率請介於 -5% 至 50% 之間';
    if (!Number.isFinite(dividendYield) || dividendYield < 0 || dividendYield > 0.4)
      return '股利殖利率請介於 0% 至 40%';
    if (!strategyConfigs.length) return '請至少新增一組策略設定';
    for (let i = 0; i < strategyConfigs.length; i++) {
      const config = strategyConfigs[i];
      const name = config.label.trim() || `策略 ${i + 1}`;
      if (!Number.isFinite(config.targetDelta) || config.targetDelta < 0.1 || config.targetDelta > 0.6) {
        return `${name} 的 Delta 需介於 0.10 ~ 0.60`;
      }
      if (config.reinvestPremium) {
        if (
          !Number.isFinite(config.premiumReinvestShareThreshold) ||
          config.premiumReinvestShareThreshold < 1 ||
          config.premiumReinvestShareThreshold > 1000
        ) {
          return `${name} 的權利金再投資門檻需介於 1 ~ 1000 股`;
        }
      }
      if (config.enableRoll) {
        if (
          !Number.isFinite(config.rollDeltaThreshold) ||
          config.rollDeltaThreshold < 0.3 ||
          config.rollDeltaThreshold > 0.95
        ) {
          return `${name} 的 Roll 閾值需介於 0.30 ~ 0.95`;
        }
        if (
          !Number.isFinite(config.rollDaysBeforeExpiry) ||
          config.rollDaysBeforeExpiry < 0 ||
          config.rollDaysBeforeExpiry > 4
        ) {
          return `${name} 的提前換倉日需介於 0 ~ 4`;
        }
      }
    }
    return null;
  }, [
    dividendYield,
    initialCapital,
    riskFreeRate,
    shares,
    start,
    strategyConfigs,
    trimmedTicker,
    end,
  ]);

  const handleAddStrategy = useCallback(() => {
    setStrategyConfigs(prev => {
      const template = prev.length ? prev[prev.length - 1] : createStrategyConfig({ label: '策略 1' });
      const nextLabel = `策略 ${prev.length + 1}`;
      const cloned = cloneStrategyConfig(template, { label: nextLabel });
      return [...prev, cloned];
    });
  }, []);

  const handleStrategyChange = useCallback(
    (id: string, patch: Partial<Omit<StrategyConfigInput, 'id'>>) => {
      setStrategyConfigs(prevConfigs =>
        prevConfigs.map(config => {
          if (config.id !== id) return config;
          const next: StrategyConfigInput = { ...config, ...patch };
          if (typeof patch.targetDelta === 'number') {
            const clamped = clampDelta(patch.targetDelta);
            next.targetDelta = floorToTwoDecimals(clamped);
          }
          if (typeof patch.rollDeltaThreshold === 'number') {
            const clamped = clampRange(patch.rollDeltaThreshold, 0.3, 0.95);
            next.rollDeltaThreshold = floorToTwoDecimals(clamped);
          }
          if (typeof patch.rollDaysBeforeExpiry === 'number') {
            const floored = Math.floor(patch.rollDaysBeforeExpiry);
            next.rollDaysBeforeExpiry = clampRange(floored, 0, 4);
          }
          if (typeof patch.premiumReinvestShareThreshold === 'number') {
            const floored = Math.floor(patch.premiumReinvestShareThreshold);
            next.premiumReinvestShareThreshold = clampRange(floored, 1, 1000);
          }
          if (typeof patch.label === 'string') {
            next.label = patch.label.slice(0, 40);
          }
          return next;
        }),
      );
    },
    [],
  );

  const handleRemoveStrategy = useCallback((id: string) => {
    setStrategyConfigs(prev => {
      if (prev.length <= 1) return prev;
      return prev.filter(item => item.id !== id);
    });
  }, []);

  const run = useCallback(async () => {
    const validationMessage = validationError;
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setBusy(true);
    setError(null);
    setStrategyResults([]);

    try {
      const payload = await fetchYahooDailyViaApi(trimmedTicker, start, end);
      if (payload.rows.length < 30) throw new Error('資料太少，請擴大日期範圍');

      const results: StrategyRunResult[] = strategyConfigs.map(config => {
        const params: BacktestParams = {
          initialCapital,
          shares,
          r: riskFreeRate,
          q: dividendYield,
          freq,
          ivOverride,
          earningsDates: payload.earningsDates,
          reinvestPremium: config.reinvestPremium,
          premiumReinvestShareThreshold: config.premiumReinvestShareThreshold,
          roundStrikeToInt: config.roundStrikeToInt,
          skipEarningsWeek: config.skipEarningsWeek,
          dynamicContracts: config.dynamicContracts,
          enableRoll: config.enableRoll,
          targetDelta: config.targetDelta,
          rollDeltaThreshold: config.enableRoll ? config.rollDeltaThreshold : undefined,
          rollDaysBeforeExpiry: config.enableRoll ? config.rollDaysBeforeExpiry : undefined,
        };
        return {
          id: config.id,
          label: config.label,
          config,
          params,
          result: runBacktest(payload.rows, params),
        };
      });

      setStrategyResults(results);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [
    dividendYield,
    end,
    freq,
    initialCapital,
    ivOverride,
    riskFreeRate,
    shares,
    start,
    strategyConfigs,
    trimmedTicker,
    validationError,
  ]);

  const summaryCards = useMemo(() => {
    const primaryConfig = strategyConfigs[0];
    const rollFootnote = primaryConfig
      ? primaryConfig.enableRoll
        ? `Roll 閾值：${primaryConfig.rollDeltaThreshold.toFixed(2)} · ${
            primaryConfig.rollDaysBeforeExpiry === 0
              ? '到期日換倉'
              : `到期前 ${primaryConfig.rollDaysBeforeExpiry} 個交易日`
          }`
        : '已停用自動 Roll'
      : '—';
    const strategyLabel = primaryConfig
      ? `Δ ${primaryConfig.targetDelta.toFixed(2)} · ${freq === 'weekly' ? '每週換倉' : '每月換倉'}`
      : `${freq === 'weekly' ? '每週換倉' : '每月換倉'}`;

    return [
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
        value: strategyLabel,
        footnote: rollFootnote,
      },
      {
        label: '利率假設',
        value: `r=${(riskFreeRate * 100).toFixed(1)}% · q=${(dividendYield * 100).toFixed(1)}%`,
        footnote: '可依市場狀況調整無風險利率與股利殖利率',
      },
    ];
  }, [dividendYield, end, freq, initialCapital, riskFreeRate, shares, start, strategyConfigs]);

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
            <StrategyConfigManager
              configs={strategyConfigs}
              onAdd={handleAddStrategy}
              onChange={handleStrategyChange}
              onRemove={handleRemoveStrategy}
            />
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

        {strategyResults.length > 0 ? (
          <BacktestResults
            strategies={strategyResults}
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
              可調整賣方 Delta、換倉頻率與是否將權利金再投資；亦可覆寫 IV、設定利率假設，或新增多組策略組合並與 Buy &amp; Hold 同場比較。
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
