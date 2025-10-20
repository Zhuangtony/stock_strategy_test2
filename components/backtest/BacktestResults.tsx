'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotProps,
  type LineProps,
  type TooltipProps,
} from 'recharts';
import ChartErrorBoundary from '../../components/ChartErrorBoundary';
import type { BacktestCurvePoint, RunBacktestResult } from '../../lib/backtest';
import { COMPARISON_SERIES_COLORS } from './constants';
import type { ComparisonDeltaInput, ComparisonResultEntry } from './types';

const settlementDotRenderer: NonNullable<LineProps['dot']> = props => {
  const { cx, cy } = props as DotProps;
  if (typeof cx !== 'number' || typeof cy !== 'number') return <g />;
  const settlement = (props as any)?.payload?.settlement;
  if (!settlement || settlement.type !== 'expiry') return <g />;
  const color = settlement.pnl >= 0 ? '#22c55e' : '#ef4444';
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill={color} stroke="white" strokeWidth={1.5} />
    </g>
  );
};

const RollMarkerLabel = ({
  viewBox,
  x,
}: {
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
  x?: number;
}) => {
  if (!viewBox && typeof x !== 'number') return null;
  const baseX = typeof x === 'number' ? x : viewBox?.x ?? 0;
  const chartTop = viewBox?.y ?? 0;
  const chartLeft = viewBox && viewBox.width && viewBox.width > 0 ? viewBox?.x ?? 0 : 0;
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
        opacity={0.95}
      />
      <text x={textX} y={textY} textAnchor="middle" fill="#4c1d95" fontSize={10} fontWeight={600}>
        Delta Roll-up
      </text>
    </g>
  );
};

const formatCurrency = (value: number, fractionDigits = 0) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: fractionDigits }).format(value);

const formatPnL = (value: number) =>
  `${value >= 0 ? '+' : ''}${formatCurrency(value, Math.abs(value) >= 1000 ? 0 : 2)}`;

type SeriesConfig = {
  key: string;
  label: string;
  color: string;
  dataKey: string;
  axis: 'value' | 'price';
  strokeDasharray?: string;
};

type SeriesKey = SeriesConfig['key'];

type SummaryCard = {
  label: string;
  value: string;
  footnote?: string;
};

type ChartDatum = BacktestCurvePoint & {
  [key: string]: BacktestCurvePoint[keyof BacktestCurvePoint] | number | null;
};

type BacktestResultsProps = {
  result: RunBacktestResult;
  comparisonDeltas: ComparisonDeltaInput[];
  comparisonResults: ComparisonResultEntry[];
  ticker: string;
  start: string;
  end: string;
  panelClass: string;
};

export function BacktestResults({
  result,
  comparisonDeltas,
  comparisonResults,
  ticker,
  start,
  end,
  panelClass,
}: BacktestResultsProps) {
  const [pointDensity, setPointDensity] = useState<'dense' | 'normal' | 'sparse'>('normal');
  const [seriesVisibility, setSeriesVisibility] = useState<Record<SeriesKey, boolean>>(() => ({
    buyAndHold: true,
    coveredCall: true,
    underlying: true,
    callStrike: true,
  }));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [brushRange, setBrushRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollerTrackRef = useRef<HTMLDivElement | null>(null);
  const [scrollerWidth, setScrollerWidth] = useState(0);
  const scrollerDragState = useRef<{ pointerId: number | null; offset: number; active: boolean; element: HTMLElement | null }>({
    pointerId: null,
    offset: 0,
    active: false,
    element: null,
  });
  const [isScrollerDragging, setIsScrollerDragging] = useState(false);

  const BASE_SERIES_CONFIG: readonly SeriesConfig[] = useMemo(
    () => [
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
    ],
    [],
  );

  const comparisonSeriesList = useMemo(
    () =>
      comparisonDeltas.map((delta, index) => {
        const entry = comparisonResults.find(item => item.id === delta.id);
        const normalized = delta.value.toFixed(2);
        const slugBase = normalized.replace('.', 'p');
        const slug = `${slugBase}_${delta.id}`;
        const config: SeriesConfig = {
          key: `coveredCall-${delta.id}`,
          label: `Covered Call Δ${normalized}`,
          color: COMPARISON_SERIES_COLORS[index % COMPARISON_SERIES_COLORS.length],
          dataKey: `CoveredCall_${slug}`,
          axis: 'value',
          strokeDasharray: '5 3',
        };
        const curveSource = entry?.result?.curve;
        return { config, curve: Array.isArray(curveSource) ? curveSource : [] };
      }),
    [comparisonDeltas, comparisonResults],
  );

  const chartData = useMemo(() => {
    const base = result.curve.map(point => ({ ...point })) as ChartDatum[];
    if (!comparisonSeriesList.length) return base;
    comparisonSeriesList.forEach(series => {
      const { curve, config } = series;
      if (!Array.isArray(curve) || !curve.length) return;
      for (let i = 0; i < base.length; i++) {
        const value = curve[i]?.CoveredCall;
        base[i][config.dataKey] = value ?? null;
      }
    });
    return base;
  }, [comparisonSeriesList, result.curve]);

  const seriesConfig = useMemo(() => {
    const base = BASE_SERIES_CONFIG.map(series => {
      if (series.key === 'coveredCall') {
        const effectiveDelta = result.effectiveTargetDelta;
        const label = typeof effectiveDelta === 'number' ? `Covered Call Δ${effectiveDelta.toFixed(2)}` : series.label;
        return { ...series, label } as SeriesConfig;
      }
      return { ...series } as SeriesConfig;
    });
    const dynamic = comparisonSeriesList.map(series => series.config);
    return [...base, ...dynamic];
  }, [BASE_SERIES_CONFIG, comparisonSeriesList, result.effectiveTargetDelta]);

  useEffect(() => {
    setSeriesVisibility(prev => {
      const next = { ...prev } as Record<SeriesKey, boolean>;
      let changed = false;
      const keys = new Set(seriesConfig.map(series => series.key));
      seriesConfig.forEach(series => {
        if (!(series.key in next)) {
          next[series.key] = true;
          changed = true;
        }
      });
      Object.keys(next).forEach(key => {
        if (!keys.has(key)) {
          delete next[key as SeriesKey];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [seriesConfig]);

  const toggleSeries = useCallback((key: SeriesKey) => {
    setSeriesVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const chartLength = chartData.length;

  useEffect(() => {
    setBrushRange(null);
  }, [chartLength]);

  useEffect(() => {
    setSeriesVisibility(prev => ({
      ...prev,
      buyAndHold: prev.buyAndHold ?? true,
      coveredCall: prev.coveredCall ?? true,
      underlying: prev.underlying ?? true,
      callStrike: prev.callStrike ?? true,
    }));
  }, []);

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
  }, [chartLength]);

  useEffect(() => {
    if (!result) {
      setIsFullscreen(false);
    }
  }, [result]);

  useEffect(() => {
    const track = scrollerTrackRef.current;
    if (!track) return;

    const updateWidth = () => {
      const rect = track.getBoundingClientRect();
      setScrollerWidth(rect.width);
    };

    updateWidth();

    const observer = new ResizeObserver(entries => {
      if (!entries.length) return;
      const entry = entries[0];
      setScrollerWidth(entry.contentRect.width);
    });
    observer.observe(track);

    return () => observer.disconnect();
  }, [chartLength, isFullscreen]);

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
  }, [isFullscreen]);

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

  const scrollerMetrics = useMemo(() => {
    const fallback = {
      hasWindow: false,
      thumbWidth: scrollerWidth,
      thumbPosition: 0,
      maxPosition: 0,
      windowSize: chartLength > 0 ? chartLength : 0,
      panRange: 0,
    };

    if (chartLength === 0 || scrollerWidth <= 0) {
      return fallback;
    }

    const windowSize = Math.max(1, activeBrushRange.endIndex - activeBrushRange.startIndex + 1);
    if (windowSize >= chartLength) {
      return { ...fallback, thumbWidth: scrollerWidth, windowSize: chartLength };
    }

    const ratio = windowSize / chartLength;
    const thumbWidth = Math.max(32, scrollerWidth * ratio);
    const maxPosition = scrollerWidth - thumbWidth;
    const panRange = chartLength - windowSize;
    const startRatio = activeBrushRange.startIndex / Math.max(1, chartLength - windowSize);
    const thumbPosition = maxPosition * startRatio;

    return {
      hasWindow: true,
      thumbWidth,
      thumbPosition,
      maxPosition,
      windowSize,
      panRange,
    };
  }, [activeBrushRange, chartLength, scrollerWidth]);

  const settlementPoints = useMemo(() => result.settlements ?? [], [result.settlements]);
  const rollPoints = useMemo(
    () => settlementPoints.filter(point => point.type === 'roll' && point.rollReason === 'delta'),
    [settlementPoints],
  );
  const expirationSettlements = useMemo(
    () => settlementPoints.filter(point => point.type === 'expiry' && point.qty > 0),
    [settlementPoints],
  );

  const applyPanFromPosition = useCallback(
    (positionPx: number) => {
      if (!scrollerMetrics.hasWindow) {
        return { applied: false, thumbPosition: 0 };
      }

      const clamped = Math.max(0, Math.min(scrollerMetrics.maxPosition, positionPx));
      const effectiveMax = scrollerMetrics.maxPosition <= 0 ? 0 : scrollerMetrics.maxPosition;
      const ratio = effectiveMax === 0 ? 0 : clamped / effectiveMax;
      const tentativeStart = Math.round(ratio * scrollerMetrics.panRange);
      const maxStart = Math.max(0, chartLength - scrollerMetrics.windowSize);
      const startIndex = Math.max(0, Math.min(maxStart, tentativeStart));
      const endIndex = Math.min(chartLength - 1, startIndex + scrollerMetrics.windowSize - 1);

      if (startIndex <= 0 && endIndex >= chartLength - 1) {
        setBrushRange(null);
      } else {
        setBrushRange({ startIndex, endIndex });
      }

      return { applied: true, thumbPosition: clamped };
    },
    [chartLength, scrollerMetrics],
  );

  const handleScrollerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const state = scrollerDragState.current;
      if (!state.active || (state.pointerId != null && state.pointerId !== event.pointerId)) return;
      const track = scrollerTrackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const positionPx = event.clientX - rect.left - state.offset;
      applyPanFromPosition(positionPx);
    },
    [applyPanFromPosition],
  );

  const stopScrollerDrag = useCallback((pointerId?: number | null) => {
    const state = scrollerDragState.current;
    if (!state.active) return;
    if (pointerId != null && state.pointerId != null && state.pointerId !== pointerId) {
      return;
    }
    if (state.pointerId != null) {
      try {
        state.element?.releasePointerCapture?.(state.pointerId);
      } catch {
        // ignore pointer capture release errors
      }
    }
    scrollerDragState.current = { pointerId: null, offset: 0, active: false, element: null };
    setIsScrollerDragging(false);
  }, []);

  const handleScrollerPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      stopScrollerDrag(event.pointerId);
    },
    [stopScrollerDrag],
  );

  const handleScrollerPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      stopScrollerDrag(event.pointerId);
    },
    [stopScrollerDrag],
  );

  const handleThumbPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!scrollerMetrics.hasWindow) return;
      const track = scrollerTrackRef.current;
      if (!track) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = track.getBoundingClientRect();
      scrollerDragState.current = {
        pointerId: event.pointerId,
        offset: event.clientX - (rect.left + scrollerMetrics.thumbPosition),
        active: true,
        element: event.currentTarget,
      };
      setIsScrollerDragging(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore pointer capture errors (e.g., unsupported environments)
      }
    },
    [scrollerMetrics],
  );

  const handleTrackPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!scrollerMetrics.hasWindow) return;
      const track = scrollerTrackRef.current;
      if (!track) return;
      event.preventDefault();
      const rect = track.getBoundingClientRect();
      const desiredPosition = event.clientX - rect.left - scrollerMetrics.thumbWidth / 2;
      const result = applyPanFromPosition(desiredPosition);
      if (!result.applied) return;
      scrollerDragState.current = {
        pointerId: event.pointerId,
        offset: event.clientX - (rect.left + result.thumbPosition),
        active: true,
        element: event.currentTarget,
      };
      setIsScrollerDragging(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore pointer capture errors
      }
    },
    [applyPanFromPosition, scrollerMetrics],
  );

  const handleDownloadCsv = useCallback(() => {
    if (!Array.isArray(result.curve) || result.curve.length === 0) return;

    const serialize = (value: string | number | null | undefined) => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) return '';
        return String(value);
      }
      const str = String(value);
      if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const baseRows = result.curve;
    const comparisonColumns = comparisonResults
      .filter(entry => Array.isArray(entry.result?.curve) && entry.result!.curve.length > 0)
      .map(entry => {
        const label = `Covered Call Value (Δ${entry.value.toFixed(2)})`;
        const map = new Map<string, number | null>();
        entry.result!.curve.forEach(point => {
          const value = typeof point.CoveredCall === 'number' ? point.CoveredCall : point.CoveredCall ?? null;
          map.set(point.date, value);
        });
        return { label, map };
      });

    const headers = [
      'Date',
      'Buy & Hold Value',
      'Covered Call Value',
      'Underlying Price',
      'Call Strike',
      'Call Delta',
      'Settlement Type',
      'Settlement PnL',
      'Settlement Strike',
      'Settlement Underlying',
      'Settlement Premium',
      'Settlement Qty',
      ...comparisonColumns.map(col => col.label),
    ];

    const rows = [headers.map(serialize).join(',')];

    for (const point of baseRows as any[]) {
      const settlement = point.settlement ?? null;
      const rowValues: (string | number | null | undefined)[] = [
        point.date,
        typeof point.BuyAndHold === 'number' ? point.BuyAndHold : point.BuyAndHold ?? null,
        typeof point.CoveredCall === 'number' ? point.CoveredCall : point.CoveredCall ?? null,
        typeof point.UnderlyingPrice === 'number' ? point.UnderlyingPrice : point.UnderlyingPrice ?? null,
        typeof point.CallStrike === 'number' ? point.CallStrike : point.CallStrike ?? null,
        typeof point.CallDelta === 'number' ? point.CallDelta : point.CallDelta ?? null,
        settlement?.type ?? null,
        typeof settlement?.pnl === 'number' ? settlement.pnl : settlement?.pnl ?? null,
        typeof settlement?.strike === 'number' ? settlement.strike : settlement?.strike ?? null,
        typeof settlement?.underlying === 'number' ? settlement.underlying : settlement?.underlying ?? null,
        typeof settlement?.premium === 'number' ? settlement.premium : settlement?.premium ?? null,
        typeof settlement?.qty === 'number' ? settlement.qty : settlement?.qty ?? null,
      ];

      comparisonColumns.forEach(col => {
        const value = col.map.get(point.date);
        rowValues.push(typeof value === 'number' ? value : value ?? null);
      });

      rows.push(rowValues.map(serialize).join(','));
    }

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `${ticker.trim() || 'backtest'}_${start}_${end}_results.csv`;
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [comparisonResults, end, result.curve, start, ticker]);

  useEffect(() => {
    if (!scrollerMetrics.hasWindow) {
      stopScrollerDrag(null);
    }
  }, [scrollerMetrics.hasWindow, stopScrollerDrag]);

  const handleWheelZoom = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (chartLength === 0) return;
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();

      const baseRange = brushRange ? activeBrushRange : { startIndex: 0, endIndex: chartLength - 1 };
      let startIdx = Math.min(baseRange.startIndex, baseRange.endIndex);
      let endIdx = Math.max(baseRange.startIndex, baseRange.endIndex);
      const zoomAmount = event.deltaY > 0 ? 1 : -1;
      const zoomStep = Math.max(1, Math.round(chartLength * 0.02));
      const newWindow = Math.max(3, endIdx - startIdx + 1 + zoomAmount * zoomStep);

      if (newWindow >= chartLength) {
        setBrushRange(null);
        return;
      }

      const pointerX = event.nativeEvent.offsetX / Math.max(1, (event.currentTarget as HTMLElement).clientWidth);
      const focusIndex = Math.max(0, Math.min(chartLength - 1, Math.round(pointerX * chartLength)));

      startIdx = Math.max(0, Math.min(focusIndex, chartLength - newWindow));
      endIdx = Math.min(chartLength - 1, startIdx + newWindow - 1);
      setBrushRange({ startIndex: startIdx, endIndex: endIdx });
    },
    [activeBrushRange, brushRange, chartLength],
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const startX = event.clientX;
      const track = scrollerTrackRef.current;
      const rect = track?.getBoundingClientRect();
      const initialRange = brushRange ? { ...brushRange } : { startIndex: 0, endIndex: chartLength - 1 };

      const onMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        if (!rect) return;
        const ratio = delta / rect.width;
        const windowSize = initialRange.endIndex - initialRange.startIndex + 1;
        if (windowSize >= chartLength) return;
        let startIndex = Math.round(initialRange.startIndex - ratio * chartLength);
        startIndex = Math.max(0, Math.min(chartLength - windowSize, startIndex));
        const endIndex = Math.min(chartLength - 1, startIndex + windowSize - 1);
        setBrushRange({ startIndex, endIndex });
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [brushRange, chartLength],
  );

  const formatValueTick = useCallback((value: number) => formatCurrency(value, 0), []);
  const formatPriceTick = useCallback((value: number) => value.toFixed(2), []);

  const CustomTooltip = useCallback(
    ({ active, payload, label }: TooltipProps<number, string>) => {
      if (!active || !payload || !payload.length) return null;
      const point = payload[0].payload as any;
      const settlement = point.settlement;
      const callDelta = point.CallDelta;
      const rollMarks = rollPoints.filter(event => event.date === point.date);
      return (
        <div className="min-w-[220px] rounded-xl border border-slate-200 bg-white/95 p-3 text-xs text-slate-600 shadow-xl">
          <div className="text-sm font-semibold text-slate-900">{label}</div>
          <div className="mt-2 space-y-1">
            <div>Buy &amp; Hold：{formatCurrency(point.BuyAndHold)}</div>
            <div>Covered Call：{formatCurrency(point.CoveredCall)}</div>
            <div>標的股價：{formatCurrency(point.UnderlyingPrice, 2)}</div>
            {typeof point.CallStrike === 'number' && <div>履約價：{point.CallStrike.toFixed(2)}</div>}
            {rollMarks.length > 0 && (
              <div className="rounded-lg bg-indigo-50/80 px-2 py-1 text-[11px] font-medium text-indigo-700">
                Delta 閾值觸發 Roll-up
              </div>
            )}
            {settlement && (
              <div className="mt-2 rounded-lg border border-slate-200/70 bg-white/80 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {settlement.type === 'roll' ? '提前換倉紀錄' : '到期結算'}
                </div>
                <div className="mt-1 space-y-1 text-[11px] text-slate-600">
                  <div>盈虧：{formatPnL(settlement.pnl)} USD</div>
                  <div>履約價：{settlement.strike.toFixed(2)}</div>
                  <div>標的價格：{settlement.underlying.toFixed(2)}</div>
                  {typeof settlement.qty === 'number' && settlement.qty > 0 && (
                    <div>賣出權利金：{formatCurrency(settlement.premium * settlement.qty * 100, 2)} USD</div>
                  )}
                  {typeof settlement.delta === 'number' && <div>Delta：{settlement.delta.toFixed(2)}</div>}
                  {settlement.type === 'roll' && (
                    <div className="text-[11px] text-slate-500">
                      {settlement.rollReason === 'delta'
                        ? '因 Delta 達到設定閾值提前換倉'
                        : '例行提前換倉至下一期合約'}
                    </div>
                  )}
                </div>
              </div>
            )}
            {typeof callDelta === 'number' && (
              <div className="mt-3 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600">當日 Delta：{callDelta.toFixed(2)}</div>
            )}
          </div>
        </div>
      );
    },
    [rollPoints],
  );

  const renderedData = useMemo(() => {
    if (pointDensity === 'dense') {
      return visibleData;
    }
    const step = pointDensity === 'sparse' ? 5 : 2;
    return visibleData.filter((_, idx) => idx % step === 0 || idx === visibleData.length - 1);
  }, [pointDensity, visibleData]);

  const chartMargin = useMemo(() => ({ top: 20, right: 24, bottom: 30, left: 16 }), []);
  const canDownloadCsv = useMemo(() => result.curve.length > 0, [result.curve.length]);

  const summaryCards: SummaryCard[] = useMemo(() => {
    const formatPct = (value: number) => `${(value * 100).toFixed(2)}%`;
    const annualized = (value: number) => {
      const years = Math.max(1 / 12, result.curve.length / 252);
      return `${(((1 + value) ** (1 / years) - 1) * 100).toFixed(2)}%`;
    };
    return [
      {
        label: 'Buy & Hold 報酬率',
        value: formatPct(result.bhReturn),
        footnote: `年化：約 ${annualized(result.bhReturn)}`,
      },
      {
        label: 'Covered Call 報酬率',
        value: formatPct(result.ccReturn),
        footnote: `年化：約 ${annualized(result.ccReturn)}`,
      },
      {
        label: 'Covered Call 勝率',
        value: `${(result.ccWinRate * 100).toFixed(1)}%`,
        footnote: `樣本數：${result.ccSettlementCount} 次結算`,
      },
      {
        label: '隱含波動率 (IV)',
        value: `${(result.ivUsed * 100).toFixed(2)}%`,
        footnote: `歷史波動率估計：${(result.hv * 100).toFixed(2)}%`,
      },
    ];
  }, [result]);

  const summaryCardsWithRoll = useMemo(() => {
    if (!result.rollEvents.length) return summaryCards;
    const averageRollDelta =
      result.rollEvents.reduce((acc, cur) => acc + (typeof cur.delta === 'number' ? cur.delta : 0), 0) /
      Math.max(1, result.rollEvents.length);
    return [
      ...summaryCards,
      {
        label: '平均 Roll Delta',
        value: averageRollDelta ? averageRollDelta.toFixed(2) : '—',
        footnote: `設定閾值：${result.rollDeltaTrigger.toFixed(2)}（僅統計 Delta 閾值觸發換倉）`,
      },
    ];
  }, [result.rollDeltaTrigger, result.rollEvents, summaryCards]);

  return (
    <React.Fragment>
      <section className={`${panelClass} p-6 md:p-8`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">資產曲線</h2>
            <p className="text-xs text-slate-500">透過下方工具列調整顯示密度、序列可見性與滾動範圍。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setPointDensity('dense')}
              className={`rounded-lg px-3 py-1 font-medium transition ${pointDensity === 'dense' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-indigo-50'}`}
            >
              高密度
            </button>
            <button
              type="button"
              onClick={() => setPointDensity('normal')}
              className={`rounded-lg px-3 py-1 font-medium transition ${pointDensity === 'normal' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-indigo-50'}`}
            >
              標準
            </button>
            <button
              type="button"
              onClick={() => setPointDensity('sparse')}
              className={`rounded-lg px-3 py-1 font-medium transition ${pointDensity === 'sparse' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-indigo-50'}`}
            >
              低密度
            </button>
            <div className="ml-2 flex items-center gap-2">
              <span className="text-slate-500">顯示序列</span>
              <div className="flex items-center gap-2">
                {seriesConfig.map(series => {
                  const active = seriesVisibility[series.key] ?? true;
                  return (
                    <button
                      key={series.key}
                      type="button"
                      onClick={() => toggleSeries(series.key)}
                      className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition ${
                        active
                          ? 'border-indigo-300 bg-indigo-50/80 text-indigo-600'
                          : 'border-slate-200 bg-white text-slate-400 hover:border-indigo-200 hover:text-indigo-500'
                      }`}
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: series.color }}
                      />
                      {series.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {canDownloadCsv && (
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-medium text-slate-600 transition hover:bg-indigo-50"
                >
                  匯出 CSV
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsFullscreen(true)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-medium text-slate-600 transition hover:bg-indigo-50"
              >
                全螢幕
              </button>
            </div>
          </div>
        </div>
        <ChartErrorBoundary>
          <div
            ref={chartContainerRef}
            className={`relative h-[420px] w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-indigo-50/40 p-4 shadow-inner shadow-slate-200/60 ${
              isFullscreen ? 'fixed inset-8 z-50 h-[calc(100vh-4rem)] w-[calc(100vw-4rem)] bg-white/95 p-6' : ''
            }`}
            onWheel={handleWheelZoom}
            onMouseDown={handleMouseDown}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={renderedData} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5f5" strokeOpacity={0.7} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fontWeight: 600 }} minTickGap={30} />
                <YAxis
                  yAxisId="value"
                  tick={{ fontSize: 12, fontWeight: 600 }}
                  tickFormatter={formatValueTick}
                  width={80}
                  domain={['auto', 'auto']}
                />
                <YAxis
                  yAxisId="price"
                  orientation="right"
                  tick={{ fontSize: 12, fontWeight: 600 }}
                  tickFormatter={formatPriceTick}
                  width={72}
                  domain={['auto', 'auto']}
                />
                <Tooltip content={<CustomTooltip />} />
                {seriesConfig.map(series => (
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
                    hide={seriesVisibility[series.key] === false}
                    strokeDasharray={series.strokeDasharray}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
                {rollPoints.map((point, idx) => (
                  <ReferenceLine
                    key={`roll-${point.date}-${idx}`}
                    x={point.date}
                    stroke="#6366f1"
                    strokeDasharray="4 2"
                    strokeOpacity={0.6}
                    yAxisId="value"
                    label={<RollMarkerLabel />}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-4">
              <div
                ref={scrollerTrackRef}
                className="relative h-3 w-full select-none rounded-full bg-slate-200/70 shadow-inner shadow-slate-300/40 touch-none cursor-pointer"
                onPointerDown={handleTrackPointerDown}
                onPointerMove={handleScrollerPointerMove}
                onPointerUp={handleScrollerPointerUp}
                onPointerCancel={handleScrollerPointerCancel}
              >
                {scrollerMetrics.hasWindow ? (
                  <div
                    className={`absolute top-0 h-full rounded-full bg-indigo-400/80 transition-[background-color] duration-150 hover:bg-indigo-400 touch-none ${
                      isScrollerDragging ? 'cursor-grabbing' : 'cursor-grab'
                    }`}
                    style={{
                      width: `${scrollerMetrics.thumbWidth}px`,
                      transform: `translateX(${scrollerMetrics.thumbPosition}px)`,
                    }}
                    onPointerDown={handleThumbPointerDown}
                    onPointerMove={handleScrollerPointerMove}
                    onPointerUp={handleScrollerPointerUp}
                    onPointerCancel={handleScrollerPointerCancel}
                  />
                ) : (
                  <div className="absolute top-0 h-full w-full rounded-full bg-slate-300/60" />
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsFullscreen(false)}
              className={`${
                isFullscreen ? 'absolute right-6 top-6 rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-slate-600 shadow-lg shadow-indigo-200 transition hover:bg-indigo-50' : 'hidden'
              }`}
            >
              關閉全螢幕
            </button>
          </div>
        </ChartErrorBoundary>
      </section>

      <section className={`${panelClass} p-6 md:p-8`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">回測總結</h2>
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Summary</span>
        </div>
        <div className="grid grid-cols-1 gap-4 text-sm [grid-auto-rows:1fr] sm:grid-cols-2 lg:grid-cols-4">
          {summaryCardsWithRoll.map(card => (
            <div key={card.label} className="flex h-full flex-col rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{card.label}</div>
              <div className="mt-3 text-2xl font-semibold leading-tight text-slate-900">{card.value}</div>
              {card.footnote && <div className="mt-auto text-xs text-slate-400">{card.footnote}</div>}
            </div>
          ))}
        </div>
      </section>
    </React.Fragment>
  );
}
