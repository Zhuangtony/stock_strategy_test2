import type { RunBacktestResult } from '../../lib/backtest';

export type ComparisonDeltaInput = {
  id: string;
  value: number;
};

export type ComparisonResultEntry = {
  id: string;
  value: number;
  result: RunBacktestResult | null;
};

export const createDeltaId = () => Math.random().toString(36).slice(2, 10);
