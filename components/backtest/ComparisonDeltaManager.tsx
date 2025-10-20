'use client';

import React from 'react';
import { COMPARISON_SERIES_COLORS } from './constants';
import type { ComparisonDeltaInput } from './types';

export type ComparisonDeltaManagerProps = {
  deltas: ComparisonDeltaInput[];
  onAdd: () => void;
  onChange: (id: string, value: number) => void;
  onRemove: (id: string) => void;
};

export function ComparisonDeltaManager({ deltas, onAdd, onChange, onRemove }: ComparisonDeltaManagerProps) {
  return (
    <div className="md:col-span-3 rounded-2xl border border-dashed border-slate-200/70 bg-white/60 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium text-slate-700">比較 Delta 設定</div>
          <p className="mt-1 text-xs text-slate-500">新增不同 Delta 值以在同一張圖上比較 Covered Call 策略。</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        >
          Add
        </button>
      </div>
      {deltas.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">尚未新增比較 Delta。</p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {deltas.map((delta, idx) => (
            <div key={delta.id} className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: COMPARISON_SERIES_COLORS[idx % COMPARISON_SERIES_COLORS.length] }}
                  />
                  <span>Δ {idx + 1}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(delta.id)}
                  className="text-[11px] text-slate-400 transition hover:text-red-500"
                >
                  移除
                </button>
              </div>
              <div className="text-sm font-semibold text-slate-700">目標 Delta：{delta.value.toFixed(2)}</div>
              <input
                type="range"
                min={0.1}
                max={0.6}
                step={0.01}
                value={delta.value}
                onChange={e => onChange(delta.id, Number(e.target.value))}
                className="accent-violet-500"
              />
              <input
                type="number"
                min={0.1}
                max={0.6}
                step={0.01}
                value={delta.value}
                onChange={e => {
                  const next = Number(e.target.value);
                  if (!Number.isNaN(next)) {
                    onChange(delta.id, next);
                  }
                }}
                className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
