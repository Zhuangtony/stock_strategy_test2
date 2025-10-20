'use client';

import React from 'react';
import { COMPARISON_SERIES_COLORS } from './constants';
import type { StrategyConfigInput } from './types';

export type StrategyConfigManagerProps = {
  configs: StrategyConfigInput[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<Omit<StrategyConfigInput, 'id'>>) => void;
};

const formatStrategyLabel = (label: string, index: number) => label || `策略 ${index + 1}`;

export function StrategyConfigManager({ configs, onAdd, onRemove, onChange }: StrategyConfigManagerProps) {
  return (
    <div className="md:col-span-3 rounded-2xl border border-dashed border-slate-200/70 bg-white/60 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium text-slate-700">策略設定組合</div>
          <p className="mt-1 text-xs text-slate-500">為不同 Delta、Roll 閾值或換倉日建立多組設定，一次比較多種 Covered Call 策略。</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        >
          新增組合
        </button>
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[720px] space-y-3">
          <div className="hidden grid-cols-[1fr_repeat(4,minmax(100px,1fr))] items-center gap-3 rounded-xl bg-slate-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:grid">
            <div>標籤</div>
            <div>目標 Δ</div>
            <div>Delta Roll 閾值</div>
            <div>提前換倉日</div>
            <div>其他選項</div>
          </div>
          {configs.length === 0 ? (
            <div className="rounded-xl border border-slate-200/70 bg-white/80 px-4 py-6 text-center text-xs text-slate-400 shadow-sm">
              尚未建立策略組合。
            </div>
          ) : (
            configs.map((config, idx) => {
              const color = idx === 0 ? '#f97316' : COMPARISON_SERIES_COLORS[(idx - 1 + COMPARISON_SERIES_COLORS.length) % COMPARISON_SERIES_COLORS.length];
              const label = formatStrategyLabel(config.label, idx);
              const approxWeekday = ['週五', '週四', '週三', '週二', '週一'][Math.max(0, Math.min(4, config.rollDaysBeforeExpiry))];
              return (
                <div
                  key={config.id}
                  className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200/80 bg-white/80 p-4 text-sm shadow-sm md:grid-cols-[1fr_repeat(4,minmax(100px,1fr))] md:items-center"
                  title={label}
                >
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">標籤</label>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                      <input
                        type="text"
                        value={config.label}
                        placeholder={`策略 ${idx + 1}`}
                        onChange={e => onChange(config.id, { label: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>
                    <button
                      type="button"
                      className="text-xs text-red-500 transition hover:text-red-600"
                      onClick={() => onRemove(config.id)}
                      disabled={configs.length === 1}
                    >
                      移除
                    </button>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">目標 Delta</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0.1}
                        max={0.6}
                        step={0.01}
                        value={config.targetDelta}
                        onChange={e => onChange(config.id, { targetDelta: Number(e.target.value) })}
                        className="flex-1 accent-violet-500"
                      />
                      <input
                        type="number"
                        min={0.1}
                        max={0.6}
                        step={0.01}
                        value={config.targetDelta}
                        onChange={e => {
                          const next = Number(e.target.value);
                          if (!Number.isNaN(next)) {
                            onChange(config.id, { targetDelta: next });
                          }
                        }}
                        className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delta Roll 閾值</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0.3}
                        max={0.95}
                        step={0.01}
                        value={config.rollDeltaThreshold}
                        onChange={e => onChange(config.id, { rollDeltaThreshold: Number(e.target.value) })}
                        disabled={!config.enableRoll}
                        className="flex-1 accent-violet-500 disabled:opacity-40"
                      />
                      <input
                        type="number"
                        min={0.3}
                        max={0.95}
                        step={0.01}
                        value={config.rollDeltaThreshold}
                        onChange={e => {
                          const next = Number(e.target.value);
                          if (!Number.isNaN(next)) {
                            onChange(config.id, { rollDeltaThreshold: next });
                          }
                        }}
                        disabled={!config.enableRoll}
                        className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">提前換倉日</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={4}
                        step={1}
                        value={config.rollDaysBeforeExpiry}
                        onChange={e => onChange(config.id, { rollDaysBeforeExpiry: Number(e.target.value) })}
                        disabled={!config.enableRoll}
                        className="flex-1 accent-violet-500 disabled:opacity-40"
                      />
                      <input
                        type="number"
                        min={0}
                        max={4}
                        step={1}
                        value={config.rollDaysBeforeExpiry}
                        onChange={e => {
                          const next = Number(e.target.value);
                          if (!Number.isNaN(next)) {
                            onChange(config.id, { rollDaysBeforeExpiry: Math.max(0, Math.min(4, Math.round(next))) });
                          }
                        }}
                        disabled={!config.enableRoll}
                        className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {config.rollDaysBeforeExpiry === 0
                        ? '到期日 (週五) 換倉'
                        : `到期前 ${config.rollDaysBeforeExpiry} 個交易日 (約${approxWeekday})`}
                    </p>
                  </div>
                  <div className="space-y-2 text-xs text-slate-600">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">選項</label>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={config.enableRoll}
                          onChange={e => onChange(config.id, { enableRoll: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>啟用自動 Roll</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={config.reinvestPremium}
                          onChange={e => onChange(config.id, { reinvestPremium: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>權利金再投資</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={config.dynamicContracts}
                          onChange={e => onChange(config.id, { dynamicContracts: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>合約張數動態調整</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={config.skipEarningsWeek}
                          onChange={e => onChange(config.id, { skipEarningsWeek: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>跳過財報週</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={config.roundStrikeToInt}
                          onChange={e => onChange(config.id, { roundStrikeToInt: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>履約價取整數</span>
                      </label>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
