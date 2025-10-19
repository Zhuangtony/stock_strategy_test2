"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import type { DotProps, LineProps } from "recharts";
import { runBacktest } from "../lib/backtest";
import ChartErrorBoundary from "../components/ChartErrorBoundary";

type BacktestResult = ReturnType<typeof runBacktest>;

type SeriesConfig = {
  key: "buyAndHold" | "coveredCall" | "underlying" | "callStrike";
  label: string;
  color: string;
  dataKey: "BuyAndHold" | "CoveredCall" | "UnderlyingPrice" | "CallStrike";
  axis: "value" | "price";
  strokeDasharray?: string;
};

const SERIES_CONFIG: readonly SeriesConfig[] = [
  { key: "buyAndHold", label: "Buy & Hold", color: "#2563eb", dataKey: "BuyAndHold", axis: "value" },
  { key: "coveredCall", label: "Covered Call", color: "#f97316", dataKey: "CoveredCall", axis: "value" },
  { key: "underlying", label: "標的股價", color: "#0ea5e9", dataKey: "UnderlyingPrice", axis: "price" },
  {
    key: "callStrike",
    label: "賣出履約價",
    color: "#16a34a",
    dataKey: "CallStrike",
    axis: "price",
    strokeDasharray: "6 3",
  },
];

const settlementDotRenderer: NonNullable<LineProps["dot"]> = props => {
  const { cx, cy } = props as DotProps;
  if (typeof cx !== "number" || typeof cy !== "number") return null;
  const settlement = (props as any)?.payload?.settlement;
  if (!settlement || settlement.type !== "expiry") return null;
  const color = settlement.pnl >= 0 ? "#22c55e" : "#ef4444";
  return <circle cx={cx} cy={cy} r={6} fill={color} stroke="white" strokeWidth={1.5} />;
};

const panelClass =
  "rounded-3xl border border-slate-200/80 bg-white/95 shadow-[0_20px_45px_-28px_rgb(15_23_42_/_55%)] backdrop-blur-sm";

type SummaryCard = {
  label: string;
  value: string;
  footnote?: string;
};

async function fetchYahooDailyViaApi(ticker: string, start: string, end: string) {
  const u = `/api/yahoo?symbol=${encodeURIComponent(ticker)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const json = await res.json();
  if (!json?.rows?.length) throw new Error("沒有資料（請檢查代碼或日期範圍）");
  return {
    rows: json.rows as {
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      adjClose: number;
    }[],
    earningsDates: Array.isArray(json.earningsDates) ? (json.earningsDates as string[]) : [],
  };
}

export default function Page() {
  const [ticker, setTicker] = useState("AAPL");
  const [start, setStart] = useState("2018-01-01");
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [initialCapital, setInitialCapital] = useState(0);
  const [shares, setShares] = useState(100);
  const [targetDelta, setTargetDelta] = useState(0.3);
  const [freq, setFreq] = useState<"weekly" | "monthly">("weekly");
  const [ivOverride, setIvOverride] = useState<number | null>(null);
  const [reinvestPremium, setReinvestPremium] = useState(true);
  const [roundStrikeToInt, setRoundStrikeToInt] = useState(true);
  const [skipEarningsWeek, setSkipEarningsWeek] = useState(false);
  const [dynamicContracts, setDynamicContracts] = useState(true);
  const [enableRoll, setEnableRoll] = useState(true);
  const [rollDeltaThreshold, setRollDeltaThreshold] = useState(0.7);
  const [pointDensity, setPointDensity] = useState<"dense" | "normal" | "sparse">("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chartRenderKey, setChartRenderKey] = useState(0);
  const [seriesVisibility, setSeriesVisibility] = useState<Record<SeriesConfig["key"], boolean>>({
    buyAndHold: true,
    coveredCall: true,
    underlying: true,
    callStrike: true,
  });

  const r = 0.03;
  const q = 0.0;

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const payload = await fetchYahooDailyViaApi(ticker.trim(), start, end);
      if (payload.rows.length < 30) throw new Error("資料點太少，請調整日期範圍再試");
      const res = runBacktest(payload.rows, {
        initialCapital,
        shares,
        r,
        q,
        targetDelta,
        freq,
        ivOverride,
        reinvestPremium,
        roundStrikeToInt,
        skipEarningsWeek,
        dynamicContracts,
        enableRoll,
        rollDeltaThreshold,
        earningsDates: payload.earningsDates,
      });
      setResult(res);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [
    ticker,
    start,
    end,
    initialCapital,
    shares,
    targetDelta,
    freq,
    ivOverride,
    reinvestPremium,
    roundStrikeToInt,
    skipEarningsWeek,
    dynamicContracts,
    enableRoll,
    rollDeltaThreshold,
  ]);

  const toggleSeries = useCallback((key: SeriesConfig["key"]) => {
    setSeriesVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const chartData = useMemo(() => result?.curve ?? [], [result]);
  const chartLength = chartData.length;

  const settlementPoints = useMemo(() => (Array.isArray(result?.settlements) ? result.settlements : []), [result]);
  const rollPoints = useMemo(() => settlementPoints.filter(point => point.type === "roll"), [settlementPoints]);
  const expirationSettlements = useMemo(
    () => settlementPoints.filter(point => point.type === "expiry" && point.qty > 0),
    [settlementPoints],
  );

  const [brushRange, setBrushRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setBrushRange(null);
  }, [chartLength]);

  useEffect(() => {
    if (!result) setIsFullscreen(false);
  }, [result]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    let pointerInside = false;
    const preventWheelScroll = (event: WheelEvent) => {
      if (!pointerInside) return;
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
    };
    const handleEnter = () => {
      pointerInside = true;
      window.addEventListener("wheel", preventWheelScroll, { passive: false });
    };
    const handleLeave = () => {
      pointerInside = false;
      window.removeEventListener("wheel", preventWheelScroll);
    };

    container.addEventListener("pointerenter", handleEnter);
    container.addEventListener("pointerleave", handleLeave);
    return () => {
      pointerInside = false;
      window.removeEventListener("wheel", preventWheelScroll);
      container.removeEventListener("pointerenter", handleEnter);
      container.removeEventListener("pointerleave", handleLeave);
    };
  }, [result, isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  useEffect(() => {
    const original = document.body.style.overflow;
    if (isFullscreen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isFullscreen]);

  const visibleData = useMemo(() => {
    if (chartLength === 0) return [];
    if (!brushRange) return chartData;
    const normalizedStart = Math.max(0, Math.min(chartLength - 1, Math.min(brushRange.startIndex, brushRange.endIndex)));
    const normalizedEnd = Math.max(
      normalizedStart,
      Math.max(0, Math.min(chartLength - 1, Math.max(brushRange.startIndex, brushRange.endIndex))),
    );
    return chartData.slice(normalizedStart, normalizedEnd + 1);
  }, [chartData, chartLength, brushRange]);

  const activeBrushRange = useMemo(() => {
    if (chartLength === 0) return { startIndex: 0, endIndex: 0 };
    if (!brushRange) return { startIndex: 0, endIndex: chartLength - 1 };
    const startIdx = Math.max(0, Math.min(chartLength - 1, Math.min(brushRange.startIndex, brushRange.endIndex)));
    const endIdx = Math.max(startIdx, Math.min(chartLength - 1, Math.max(brushRange.startIndex, brushRange.endIndex)));
    return { startIndex: startIdx, endIndex: endIdx };
  }, [chartLength, brushRange]);

  const brushStartIndex = activeBrushRange.startIndex;
  const brushEndIndex = activeBrushRange.endIndex;
  const brushUpdateId = useMemo(() => `${chartLength}-${brushStartIndex}-${brushEndIndex}`, [chartLength, brushStartIndex, brushEndIndex]);

  const visibleRangeLabel = useMemo(() => {
    if (!visibleData.length) return "";
    const first = visibleData[0]?.date;
    const last = visibleData[visibleData.length - 1]?.date;
    return first === last ? first : `${first} ~ ${last}`;
  }, [visibleData]);

  const visibleExpirations = useMemo(() => {
    if (!visibleData.length) return [] as any[];
    const dateSet = new Set(visibleData.map((point: any) => point.date));
    return expirationSettlements.filter(point => dateSet.has(point.date));
  }, [expirationSettlements, visibleData]);

  const visibleRolls = useMemo(() => {
    if (!visibleData.length) return [] as any[];
    const dateSet = new Set(visibleData.map((point: any) => point.date));
    return rollPoints.filter(point => dateSet.has(point.date));
  }, [rollPoints, visibleData]);

  const renderedData = useMemo(() => {
    const points: any[] = Array.isArray(visibleData) ? visibleData : [];
    if (points.length === 0) return [];

    const targetPointsMap: Record<typeof pointDensity, number> = {
      dense: 1400,
      normal: 900,
      sparse: 500,
    };

    const target = targetPointsMap[pointDensity];
    const step = Math.max(1, Math.ceil(points.length / target));
    if (step <= 1) return points;

    const sampled: any[] = [];
    for (let i = 0; i < points.length; i += step) sampled.push(points[i]);

    const lastPoint = points[points.length - 1];
    if (sampled[sampled.length - 1]?.date !== lastPoint.date) sampled.push(lastPoint);

    const settlementDates = new Set([
      ...visibleExpirations.map(point => point.date),
      ...visibleRolls.map(point => point.date),
    ]);
    if (settlementDates.size > 0) {
      points.forEach(point => {
        if (settlementDates.has(point.date) && !sampled.some(item => item.date === point.date)) sampled.push(point);
      });
    }

    sampled.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
    return sampled;
  }, [pointDensity, visibleData, visibleExpirations, visibleRolls]);

  const formatCurrency = useCallback(
    (value: number, fractionDigits = 2) =>
      value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: fractionDigits }),
    [],
  );
  const formatPnL = useCallback((value: number) => `${value >= 0 ? "+" : ""}${formatCurrency(value, 0)}`, [formatCurrency]);
  const formatValueTick = useCallback((value: number) => formatCurrency(value, 0), [formatCurrency]);
  const formatPriceTick = useCallback((value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 }), []);

  const CustomTooltip = ({ active, payload, label }: TooltipProps<number | string, string>) => {
    if (!active || !payload || payload.length === 0) return null;
    const datum = payload[0]?.payload as any;
    const settlement = datum?.settlement;
    const settlementTitle = settlement
      ? settlement.type === "roll"
        ? "Roll up & out"
        : "Covered Call 結算"
      : null;
    const callDelta = typeof datum?.CallDelta === "number" ? datum.CallDelta : null;

    return (
      <div className="rounded-xl border bg-white p-3 text-xs shadow-lg">
        <div className="mb-2 text-sm font-semibold">{label}</div>
        <div className="space-y-1">
          {payload.map(item => (
            <div key={item.dataKey} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color || "#000" }} />
                {item.name}
              </span>
              <span>
                {typeof item.value === "number"
                  ? item.value.toLocaleString(undefined, {
                      maximumFractionDigits:
                        item.dataKey === "UnderlyingPrice" || item.dataKey === "CallStrike" ? 2 : 0,
                    })
                  : item.value}
              </span>
            </div>
          ))}
        </div>
        {settlement && (
          <div className="mt-3 border-t pt-2">
            <div className="font-semibold">{settlementTitle}</div>
            <div className="mt-1 space-y-1">
              <div>盈虧：{formatPnL(settlement.pnl)} USD</div>
              <div>履約價：{settlement.strike.toFixed(2)}</div>
              <div>標的價格：{settlement.underlying.toFixed(2)}</div>
              {typeof settlement.qty === "number" && settlement.qty > 0 && (
                <div>權利金：{formatCurrency(settlement.premium * settlement.qty * 100, 2)} USD</div>
              )}
              {typeof settlement.delta === "number" && <div>Delta：{settlement.delta.toFixed(2)}</div>}
              {settlement.type === "roll" && (
                <div className="text-[11px] text-slate-500">已提前平倉並換至下一期合約</div>
              )}
            </div>
          </div>
        )}
        {callDelta != null && (
          <div className="mt-3 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
            當日 Delta：{callDelta.toFixed(2)}
          </div>
        )}
      </div>
    );
  };

  const summaryCards = useMemo<SummaryCard[]>(() => {
    if (!result) return [];
    return [
      { label: "歷史波動（HV，年化）", value: `${(result.hv * 100).toFixed(1)}%` },
      { label: "使用 IV（年化）", value: `${(result.ivUsed * 100).toFixed(1)}%` },
      { label: "Buy & Hold 總報酬", value: `${(result.bhReturn * 100).toFixed(1)}%` },
      { label: "Covered Call 總報酬", value: `${(result.ccReturn * 100).toFixed(1)}%` },
      { label: "Buy & Hold 期末持股數", value: (result.bhShares ?? 0).toLocaleString() },
      { label: "Covered Call 期末持股數", value: (result.ccShares ?? 0).toLocaleString() },
    ];
  }, [result]);

  const handleBrushChange = useCallback(
    (range: any) => {
      if (!range || typeof range.startIndex !== "number" || typeof range.endIndex !== "number") return;
      if (chartLength === 0) return;
      const startIdx = Math.max(0, Math.min(chartLength - 1, Math.round(range.startIndex)));
      const endIdx = Math.max(0, Math.min(chartLength - 1, Math.round(range.endIndex)));
      const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      if (lo === 0 && hi === chartLength - 1) {
        setBrushRange(null);
      } else {
        setBrushRange({ startIndex: lo, endIndex: hi });
      }
    },
    [chartLength],
  );

  const handleWheelZoom = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (chartLength === 0) return;
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();

      const baseRange = brushRange ? activeBrushRange : { startIndex: 0, endIndex: chartLength - 1 };
      let startIdx = Math.min(baseRange.startIndex, baseRange.endIndex);
      let endIdx = Math.max(baseRange.startIndex, baseRange.endIndex);

      const currentSize = endIdx - startIdx + 1;
      const zoomIn = event.deltaY < 0;
      const zoomFactor = zoomIn ? 0.85 : 1.15;
      const minWindow = Math.min(Math.max(5, Math.round(chartLength * 0.05)), chartLength);

      let newSize = Math.round(currentSize * zoomFactor);
      newSize = Math.max(minWindow, Math.min(chartLength, newSize));

      if (newSize >= chartLength) {
        setBrushRange(null);
        return;
      }

      const center = (startIdx + endIdx) / 2;
      let newStart = Math.round(center - newSize / 2);
      newStart = Math.max(0, Math.min(chartLength - newSize, newStart));
      const newEnd = newStart + newSize - 1;

      if (newStart <= 0 && newEnd >= chartLength - 1) {
        setBrushRange(null);
      } else {
        setBrushRange({ startIndex: newStart, endIndex: newEnd });
      }
    },
    [activeBrushRange, brushRange, chartLength],
  );

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-200 px-6 py-8 md:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 pb-12 lg:gap-12">
        <header className="flex flex-col gap-3 border-b border-slate-200/80 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">Covered Call 策略回測器（Next.js 版）</h1>
            <p className="text-sm text-slate-500">資料來源：Yahoo Finance（伺服器端代理避免 CORS）</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>顯示線條：</span>
            {SERIES_CONFIG.map(series => (
              <button
                key={series.key}
                type="button"
                onClick={() => toggleSeries(series.key)}
                className={`rounded-full border px-3 py-1 transition ${
                  seriesVisibility[series.key]
                    ? "border-slate-700 bg-slate-800 text-white"
                    : "border-slate-300 bg-white text-slate-400"
                }`}
              >
                {series.label}
              </button>
            ))}
          </div>
        </header>

        <section className={`${panelClass} space-y-6 p-6 md:p-8`}>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-900">回測參數</h2>
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Simulation Inputs</span>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex flex-col gap-2 text-sm">
              <span>股票代號（美股）</span>
              <input
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-base shadow-sm focus:border-slate-500 focus:outline-none"
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                placeholder="例如 AAPL 或 TSLA"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span>開始日期</span>
              <input
                type="date"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-base shadow-sm focus:border-slate-500 focus:outline-none"
                value={start}
                onChange={e => setStart(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span>結束日期</span>
              <input
                type="date"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-base shadow-sm focus:border-slate-500 focus:outline-none"
                value={end}
                onChange={e => setEnd(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-2 text-sm">
              <span>初始現金（USD，可為 0）</span>
              <input
                type="number"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-base shadow-sm focus:border-slate-500 focus:outline-none"
                value={initialCapital}
                onChange={e => setInitialail?"
