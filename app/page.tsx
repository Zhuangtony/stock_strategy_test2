'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Brush,
  TooltipProps,
} from 'recharts';
import type { DotProps, LineProps } from 'recharts';
import { runBacktest } from '../lib/backtest';

async function fetchYahooDailyViaApi(ticker: string, start: string, end: string) {
  const u = `/api/yahoo?symbol=${encodeURIComponent(ticker)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const res = await fetch(u, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const json = await res.json();
  if (!json?.rows?.length) throw new Error('沒有資料（檢查代碼/日期）');
  return {
    rows: json.rows as { date: string; open: number; high: number; low: number; close: number; adjClose: number }[],
    earningsDates: Array.isArray(json.earningsDates) ? (json.earningsDates as string[]) : [],
  };
}

type RollLabelViewBox = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

const RollMarkerLabel = ({ viewBox, x }: { viewBox?: RollLabelViewBox; x?: number }) => {
  if (!viewBox && typeof x !== 'number') return null;
  const baseX = typeof x === 'number' ? x : viewBox?.x ?? 0;
  const chartTop = viewBox?.y ?? 0;
  const chartLeft = viewBox && viewBox.width && viewBox.width > 0 ? viewBox.x ?? 0 : 0;
  const chartRight = viewBox && viewBox.width && viewBox.width > 0 ? chartLeft + viewBox.width : null;
  const labelWidth = 92;
  const labelHeight = 22;
  const offsetY = 10;

  let rectX = baseX - labelWidth / 2;
  if (chartRight != null) {
    rectX = Math.min(rectX, chartRight - labelWidth - 4);
  }
  rectX = Math.max(chartLeft + 4, rectX);
  const rectY = chartTop + offsetY;
  const textX = rectX + labelWidth / 2;
  const textY = rectY + labelHeight / 2 + 4;

  return (
    <g>
      <rect
        x={rectX}
        y={rectY}
        width={labelWidth}
        height={labelHeight}
        rx={labelHeight / 2}
        fill="#ede9fe"
        stroke="#5b21b6"
        strokeWidth={1}
      />
      <text x={textX} y={textY} textAnchor="middle" fill="#4c1d95" fontSize={10} fontWeight={600}>
        Roll up &amp; out
      </text>
    </g>
  );
};

type SeriesConfig = {
  key: 'buyAndHold' | 'coveredCall' | 'underlying' | 'callStrike';
  label: string;
  color: string;
  dataKey: 'BuyAndHold' | 'CoveredCall' | 'UnderlyingPrice' | 'CallStrike';
  axis: 'value' | 'price';
  strokeDasharray?: string;
};

const SERIES_CONFIG: readonly SeriesConfig[] = [
  { key: 'buyAndHold', label: 'Buy & Hold', color: '#2563eb', dataKey: 'BuyAndHold', axis: 'value' },
  { key: 'coveredCall', label: 'Covered Call', color: '#f97316', dataKey: 'CoveredCall', axis: 'value' },
  { key: 'underlying', label: '標的股價', color: '#0ea5e9', dataKey: 'UnderlyingPrice', axis: 'price' },
  {
    key: 'callStrike',
    label: '賣出履約價',
    color: '#16a34a',
    dataKey: 'CallStrike',
    axis: 'price',
    strokeDasharray: '6 3',
  },
];

type SeriesKey = SeriesConfig['key'];

const settlementDotRenderer: NonNullable<LineProps['dot']> = props => {
  const { cx, cy } = props as DotProps;
  if (typeof cx !== 'number' || typeof cy !== 'number') return <></>;
  const settlement = (props as any)?.payload?.settlement;
  if (!settlement || settlement.type !== 'expiry') return <></>;
  const color = settlement.pnl >= 0 ? '#22c55e' : '#ef4444';
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill={color} stroke="white" strokeWidth={1.5} />
    </g>
  );
};

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
  const [roundStrikeToInt, setRoundStrikeToInt] = useState(true);
  const [skipEarningsWeek, setSkipEarningsWeek] = useState(false);
  const [dynamicContracts, setDynamicContracts] = useState(true);
  const [enableRoll, setEnableRoll] = useState(true);
  const [rollDeltaThreshold, setRollDeltaThreshold] = useState(0.7);
  const [pointDensity, setPointDensity] = useState<'dense' | 'normal' | 'sparse'>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [seriesVisibility, setSeriesVisibility] = useState<Record<SeriesKey, boolean>>({
    buyAndHold: true,
    coveredCall: true,
    underlying: true,
    callStrike: true,
  });

  const r = 0.03;
  const q = 0.00;

  const run = useCallback(async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const payload = await fetchYahooDailyViaApi(ticker.trim(), start, end);
      if (payload.rows.length < 30) throw new Error('資料太少，請放大日期區間。');
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
    } catch (e: any) {
      setError(e.message || String(e));
    } finally { setBusy(false); }
  }, [
    dynamicContracts,
    enableRoll,
    end,
    freq,
    initialCapital,
    ivOverride,
    r,
    q,
    reinvestPremium,
    roundStrikeToInt,
    shares,
    skipEarningsWeek,
    start,
    targetDelta,
    ticker,
    rollDeltaThreshold,
  ]);

  const toggleSeries = useCallback((key: SeriesKey) => {
    setSeriesVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const chartData = useMemo(() => {
    if (!Array.isArray(result?.curve)) return [] as any[];
    return result.curve.map((point: any) => ({ ...point }));
  }, [result]);
  const chartLength = chartData.length;
  const settlementPoints = useMemo(() => Array.isArray(result?.settlements) ? result.settlements : [], [result]);
  const rollPoints = useMemo(
    () => settlementPoints.filter((point: any) => point.type === 'roll'),
    [settlementPoints],
  );
  const expirationSettlements = useMemo(
    () => settlementPoints.filter((point: any) => point.type === 'expiry' && point.qty > 0),
    [settlementPoints],
  );

  const [brushRange, setBrushRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setBrushRange(null);
  }, [chartLength]);

  useEffect(() => {
    setBrushRange(current => {
      if (!current || chartLength === 0) return current;
      const startIdx = Math.max(0, Math.min(chartLength - 1, Math.round(current.startIndex)));
      const endIdx = Math.max(0, Math.min(chartLength - 1, Math.round(current.endIndex)));
      const nextStart = Math.min(startIdx, endIdx);
      const nextEnd = Math.max(startIdx, endIdx);
      if (nextStart === current.startIndex && nextEnd === current.endIndex) {
        return current;
      }
      return { startIndex: nextStart, endIndex: nextEnd };
    });
  }, [chartLength, brushRange]);

  useEffect(() => {
    if (!result) {
      setIsFullscreen(false);
    }
  }, [result]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    let isPointerInside = false;

    const preventWheelScroll = (event: WheelEvent) => {
      if (!isPointerInside) return;
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
    };

    const handlePointerEnter = () => {
      isPointerInside = true;
      window.addEventListener('wheel', preventWheelScroll, { passive: false });
    };

    const handlePointerLeave = () => {
      isPointerInside = false;
      window.removeEventListener('wheel', preventWheelScroll);
    };

    container.addEventListener('pointerenter', handlePointerEnter);
    container.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      isPointerInside = false;
      window.removeEventListener('wheel', preventWheelScroll);
      container.removeEventListener('pointerenter', handlePointerEnter);
      container.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [result, isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = originalOverflow;
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
  }, [brushRange, chartData, chartLength]);

  const activeBrushRange = useMemo(() => {
    if (chartLength === 0) {
      return { startIndex: 0, endIndex: 0 };
    }
    if (!brushRange) {
      return { startIndex: 0, endIndex: chartLength - 1 };
    }
    const startIdx = Math.max(0, Math.min(chartLength - 1, Math.min(brushRange.startIndex, brushRange.endIndex)));
    const endIdx = Math.max(startIdx, Math.min(chartLength - 1, Math.max(brushRange.startIndex, brushRange.endIndex)));
    return { startIndex: startIdx, endIndex: endIdx };
  }, [brushRange, chartLength]);

  const brushStartIndex = activeBrushRange.startIndex;
  const brushEndIndex = activeBrushRange.endIndex;

  const brushUpdateId = useMemo(
    () => `${chartLength}-${brushStartIndex}-${brushEndIndex}`,
    [chartLength, brushStartIndex, brushEndIndex],
  );

  const visibleRangeLabel = useMemo(() => {
    if (!visibleData.length) return '';
    const first = visibleData[0]?.date;
    const last = visibleData[visibleData.length - 1]?.date;
    return first === last ? first : `${first} ~ ${last}`;
  }, [visibleData]);

  const visibleExpirations = useMemo(() => {
    if (!visibleData.length) return [] as any[];
    const dateSet = new Set(visibleData.map((point: any) => point.date));
    return expirationSettlements.filter((point: any) => dateSet.has(point.date));
  }, [expirationSettlements, visibleData]);

  const visibleRolls = useMemo(() => {
    if (!visibleData.length) return [] as any[];
    const dateSet = new Set(visibleData.map((point: any) => point.date));
    return rollPoints.filter((point: any) => dateSet.has(point.date));
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

    if (step <= 1) {
      return points.map(point => ({ ...point }));
    }

    const sampled: any[] = [];
    for (let i = 0; i < points.length; i += step) {
      sampled.push({ ...points[i] });
    }

    const lastPoint = points[points.length - 1];
    if (sampled[sampled.length - 1]?.date !== lastPoint.date) {
      sampled.push({ ...lastPoint });
    }

    const settlementDates = new Set([
      ...visibleExpirations.map((point: any) => point.date),
      ...visibleRolls.map((point: any) => point.date),
    ]);
    if (settlementDates.size > 0) {
      points.forEach(point => {
        if (settlementDates.has(point.date) && !sampled.some(item => item.date === point.date)) {
          sampled.push({ ...point });
        }
      });
    }

    sampled.sort((a, b) => {
      if (a.date === b.date) return 0;
      return a.date > b.date ? 1 : -1;
    });

    return sampled;
  }, [pointDensity, visibleData, visibleExpirations, visibleRolls]);

  const formatCurrency = useCallback(
    (value: number, fractionDigits = 2) =>
      value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: fractionDigits }),
    [],
  );
  const formatPnL = useCallback((value: number) => `${value >= 0 ? '+' : ''}${formatCurrency(value, 0)}`, [formatCurrency]);
  const formatValueTick = useCallback((value: number) => formatCurrency(value, 0), [formatCurrency]);
  const formatPriceTick = useCallback(
    (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    [],
  );

  const CustomTooltip = ({ active, payload, label }: TooltipProps<number | string, string>) => {
    if (!active || !payload || payload.length === 0) return null;
    const settlement = (payload[0].payload as any)?.settlement;
    const callDelta = (payload[0].payload as any)?.CallDelta;
    const settlementTitle = settlement
      ? settlement.type === 'roll'
        ? 'Roll up & out'
        : 'Covered Call 結算'
      : null;
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
                    if (item.dataKey === 'UnderlyingPrice' || item.dataKey === 'CallStrike') {
                      return rawValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
                    }
                    return formatCurrency(rawValue, 0);
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
        {settlement && settlementTitle && (
          <div className="mt-3 border-t pt-2">
            <div className="font-semibold">{settlementTitle}</div>
            <div className="mt-1 space-y-1">
              <div>盈虧：{formatPnL(settlement.pnl)} USD</div>
              <div>履約價：{settlement.strike.toFixed(2)}</div>
              <div>標的價格：{settlement.underlying.toFixed(2)}</div>
              {typeof settlement.qty === 'number' && settlement.qty > 0 && (
                <div>賣出權利金：{formatCurrency(settlement.premium * settlement.qty * 100, 2)} USD</div>
              )}
              {typeof settlement.delta === 'number' && (
                <div>Delta：Δ {settlement.delta.toFixed(2)}</div>
              )}
              {settlement.type === 'roll' && (
                <div className="text-[11px] text-slate-500">已提前展期至更遠到期日</div>
              )}
            </div>
          </div>
        )}
        {typeof callDelta === 'number' && (
          <div className="mt-3 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
            當前 Delta：Δ {callDelta.toFixed(2)}
          </div>
        )}
      </div>
    );
  };

  const handleBrushChange = useCallback(
    (range: any) => {
      if (!range || typeof range.startIndex !== 'number' || typeof range.endIndex !== 'number') return;
      if (chartLength === 0) return;
      const startIdx = Math.max(0, Math.min(chartLength - 1, Math.round(range.startIndex)));
      const endIdx = Math.max(0, Math.min(chartLength - 1, Math.round(range.endIndex)));
      const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      if (lo === 0 && hi === chartLength - 1) {
        setBrushRange(null);
        return;
      }
      setBrushRange({ startIndex: lo, endIndex: hi });
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

  const summaryCards = useMemo(() => {
    if (!result) return [] as {
      label: string;
      value: string;
      footnote?: string;
    }[];
    return [
      {
        label: '估計歷史波動（HV，年化）',
        value: `${(result.hv * 100).toFixed(1)}%`,
      },
      {
        label: '使用 IV（年化）',
        value: `${(result.ivUsed * 100).toFixed(1)}%`,
      },
      {
        label: 'Call Delta 目標',
        value: result.effectiveTargetDelta != null ? `Δ ${result.effectiveTargetDelta.toFixed(2)}` : 'Δ --',
      },
      {
        label: 'Roll Delta 門檻',
        value: enableRoll
          ? result.rollDeltaTrigger != null
            ? `Δ ${result.rollDeltaTrigger.toFixed(2)}`
            : `Δ ${rollDeltaThreshold.toFixed(2)}`
          : '未啟用',
      },
      {
        label: 'Buy&Hold 總報酬',
        value: `${(result.bhReturn * 100).toFixed(1)}%`,
      },
      {
        label: 'Covered Call 總報酬',
        value: `${(result.ccReturn * 100).toFixed(1)}%`,
      },
      {
        label: 'Buy&Hold 最後持有股數',
        value: result.bhShares.toLocaleString(),
      },
      {
        label: 'Covered Call 最後持有股數',
        value: result.ccShares.toLocaleString(),
      },
      {
        label: 'Covered Call 勝率',
        value: `${((result.ccWinRate ?? 0) * 100).toFixed(1)}%`,
        footnote: `${result.ccSettlementCount ?? 0} 次結算`,
      },
    ];
  }, [enableRoll, result, rollDeltaThreshold]);

  return (
    <main className="p-6 md:p-10">
      <div className="mx-auto grid max-w-7xl gap-6 lg:gap-8">
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
            <div className="md:col-span-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={roundStrikeToInt} onChange={e => setRoundStrikeToInt(e.target.checked)} />
                <span>Call 履約價取整數</span>
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={skipEarningsWeek} onChange={e => setSkipEarningsWeek(e.target.checked)} />
                <span>避開財報週（不賣 Call）</span>
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={dynamicContracts} onChange={e => setDynamicContracts(e.target.checked)} />
                <span>股數每滿 100 股自動增加張數</span>
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={enableRoll} onChange={e => setEnableRoll(e.target.checked)} />
                <span>Delta 達閾值且距到期 &gt; 2 天時 Roll up &amp; out</span>
              </label>
            </div>
            {enableRoll && (
              <div className="md:col-span-3 flex flex-col gap-3 rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 text-xs md:text-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <span className="font-semibold text-indigo-900">Roll Delta 門檻：Δ {rollDeltaThreshold.toFixed(2)}</span>
                  <div className="flex flex-1 items-center gap-3 md:max-w-md">
                    <input
                      type="range"
                      min={0.3}
                      max={0.95}
                      step={0.01}
                      value={rollDeltaThreshold}
                      onChange={e => setRollDeltaThreshold(Number(e.target.value))}
                      className="flex-1"
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
                        setRollDeltaThreshold(Math.min(0.95, Math.max(0.3, next)));
                      }}
                      className="w-20 rounded-lg border px-2 py-1 text-right"
                    />
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-indigo-900/70 md:text-xs">
                  當持有部位的 Delta 達到或超過此閾值，且距離到期超過兩個交易日時，系統會提前 Roll up &amp; out。
                </p>
              </div>
            )}
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
            <section
              className={`${
                isFullscreen
                  ? 'fixed inset-0 z-50 m-0 flex h-screen w-screen flex-col overflow-hidden bg-white p-4 shadow-xl md:p-8'
                  : 'rounded-2xl border bg-white shadow-sm p-4 md:p-6 flex flex-col'
              }`}
            >
              <h2 className="font-semibold mb-4">資產曲線（USD）</h2>
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between text-xs md:text-sm text-slate-600">
                <div>
                  目前顯示區間：{visibleRangeLabel || '全部資料'}。可透過下方拖曳選擇區間，當選擇整段資料時會自動顯示全部資料點。
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                  <label className="flex items-center gap-2 whitespace-nowrap text-xs md:text-sm">
                    <span>數據點密度</span>
                    <select
                      className="rounded-lg border px-2 py-1 text-xs md:text-sm"
                      value={pointDensity}
                      onChange={e => setPointDensity(e.target.value as typeof pointDensity)}
                    >
                      <option value="dense">高</option>
                      <option value="normal">中</option>
                      <option value="sparse">低</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsFullscreen(current => !current)}
                    className="inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 md:text-sm"
                  >
                    {isFullscreen ? '退出全螢幕 (Esc)' : '全螢幕檢視'}
                  </button>
                </div>
              </div>
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600 md:text-sm">
                {SERIES_CONFIG.map(series => {
                  const active = seriesVisibility[series.key];
                  return (
                    <button
                      key={series.key}
                      type="button"
                      onClick={() => toggleSeries(series.key)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                        active ? 'border-transparent bg-slate-100 text-slate-800' : 'border-slate-200 text-slate-400'
                      }`}
                      aria-pressed={active}
                    >
                      <span
                        className="h-1.5 w-10 rounded-full"
                        style={
                          series.strokeDasharray
                            ? {
                                backgroundImage: `repeating-linear-gradient(90deg, ${series.color}, ${series.color} 10px, transparent 10px, transparent 18px)`,
                                opacity: active ? 1 : 0.3,
                              }
                            : {
                                backgroundColor: series.color,
                                opacity: active ? 1 : 0.3,
                              }
                        }
                      />
                      <span>{series.label}</span>
                    </button>
                  );
                })}
              </div>
              <div
                className={isFullscreen ? 'flex-1 min-h-0' : 'h-[32rem]'}
                style={{ overscrollBehavior: 'contain' }}
                ref={chartContainerRef}
                onWheel={handleWheelZoom}
                onMouseDown={handleMouseDown}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={renderedData} margin={{ top: 48, right: 32, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={30} />
                    <YAxis yAxisId="value" tick={{ fontSize: 12 }} tickFormatter={formatValueTick} width={80} />
                    <YAxis
                      yAxisId="price"
                      orientation="right"
                      tick={{ fontSize: 12 }}
                      tickFormatter={formatPriceTick}
                      width={72}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Brush
                      key={brushUpdateId}
                      dataKey="CoveredCall"
                      data={chartData}
                      height={24}
                      travellerWidth={12}
                      stroke="#94a3b8"
                      startIndex={brushStartIndex}
                      endIndex={brushEndIndex}
                      updateId={brushUpdateId}
                      onChange={handleBrushChange}
                    >
                      <LineChart data={chartData}>
                        <Line type="monotone" dataKey="BuyAndHold" dot={false} stroke="#2563eb" strokeWidth={1} />
                        <Line type="monotone" dataKey="CoveredCall" dot={false} stroke="#f97316" strokeWidth={1} />
                      </LineChart>
                    </Brush>
                    {SERIES_CONFIG.map(series => (
                      <Line
                        key={series.key}
                        type="monotone"
                        dataKey={series.dataKey}
                        dot={series.key === 'coveredCall' ? settlementDotRenderer : false}
                        activeDot={series.key === 'coveredCall' ? { r: 6 } : undefined}
                        strokeWidth={series.axis === 'value' ? 2.5 : 1.8}
                        stroke={series.color}
                        name={series.label}
                        yAxisId={series.axis}
                        hide={!seriesVisibility[series.key]}
                        strokeDasharray={series.strokeDasharray}
                        isAnimationActive={false}
                        connectNulls
                      />
                    ))}
                    {visibleRolls.map((point: any, idx: number) => (
                      <ReferenceLine
                        key={`roll-${point.date}-${idx}`}
                        x={point.date}
                        stroke="#6366f1"
                        strokeDasharray="4 2"
                        strokeOpacity={0.6}
                        label={<RollMarkerLabel />}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-2xl border bg-white shadow-sm p-4 md:p-6">
              <h2 className="font-semibold mb-4">回測摘要</h2>
              <div className="grid grid-cols-2 gap-4 text-sm [grid-auto-rows:1fr] md:grid-cols-3 lg:grid-cols-9">
                {summaryCards.map(card => (
                  <div key={card.label} className="flex h-full flex-col rounded-xl border bg-slate-50 p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</div>
                    <div className="mt-2 text-xl font-semibold leading-snug text-slate-800">{card.value}</div>
                    {card.footnote && <div className="mt-auto text-xs text-slate-500">{card.footnote}</div>}
                  </div>
                ))}
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
