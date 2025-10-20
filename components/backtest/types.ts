import type { BacktestParams, RunBacktestResult } from '../../lib/backtest';

export type StrategyConfigInput = {
  id: string;
  label: string;
  targetDelta: number;
  reinvestPremium: boolean;
  roundStrikeToInt: boolean;
  skipEarningsWeek: boolean;
  dynamicContracts: boolean;
  enableRoll: boolean;
  rollDeltaThreshold: number;
  rollDaysBeforeExpiry: number;
};

export type StrategyRunResult = {
  id: string;
  label: string;
  config: StrategyConfigInput;
  params: BacktestParams;
  result: RunBacktestResult;
};

const createRandomId = () => Math.random().toString(36).slice(2, 10);

export const createStrategyConfig = (overrides?: Partial<Omit<StrategyConfigInput, 'id'>>) => ({
  id: createRandomId(),
  label: overrides?.label ?? '策略',
  targetDelta: overrides?.targetDelta ?? 0.3,
  reinvestPremium: overrides?.reinvestPremium ?? true,
  roundStrikeToInt: overrides?.roundStrikeToInt ?? true,
  skipEarningsWeek: overrides?.skipEarningsWeek ?? false,
  dynamicContracts: overrides?.dynamicContracts ?? true,
  enableRoll: overrides?.enableRoll ?? true,
  rollDeltaThreshold: overrides?.rollDeltaThreshold ?? 0.7,
  rollDaysBeforeExpiry: overrides?.rollDaysBeforeExpiry ?? 0,
}) satisfies StrategyConfigInput;

export const cloneStrategyConfig = (config: StrategyConfigInput, overrides?: Partial<Omit<StrategyConfigInput, 'id'>>) => ({
  ...config,
  ...overrides,
  id: createRandomId(),
});
