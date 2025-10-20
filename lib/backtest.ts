import { bsCallDelta, bsCallPrice, findStrikeForTargetDelta, estimateHV } from './optionMath';

export type BacktestFrequency = 'weekly' | 'monthly';

export type OhlcRow = {
  date: string;
  close: number;
  adjClose: number;
};

export interface BacktestParams {
  initialCapital: number;
  shares: number;
  r: number;
  q: number;
  targetDelta: number;
  freq: BacktestFrequency;
  ivOverride?: number | null;
  reinvestPremium: boolean;
  roundStrikeToInt: boolean;
  skipEarningsWeek: boolean;
  dynamicContracts: boolean;
  enableRoll: boolean;
  earningsDates?: string[];
  rollDeltaThreshold?: number;
  rollDaysBeforeExpiry?: number;
}

export interface SettlementEvent {
  date: string;
  totalValue: number;
  pnl: number;
  strike: number;
  underlying: number;
  premium: number;
  qty: number;
  type: 'roll' | 'expiry';
  delta?: number;
  rollReason?: 'delta' | 'scheduled';
}

export interface BacktestCurvePoint {
  date: string;
  BuyAndHold: number;
  CoveredCall: number;
  UnderlyingPrice: number;
  CallStrike: number | null;
  CallDelta: number | null;
  settlement: null | {
    pnl: number;
    strike: number;
    underlying: number;
    premium: number;
    qty: number;
    type: 'roll' | 'expiry';
    delta?: number;
    rollReason?: 'delta' | 'scheduled';
  };
}

export interface RunBacktestResult {
  curve: BacktestCurvePoint[];
  bhReturn: number;
  ccReturn: number;
  hv: number;
  ivUsed: number;
  bhShares: number;
  ccShares: number;
  settlements: SettlementEvent[];
  rollEvents: SettlementEvent[];
  ccWinRate: number;
  ccSettlementCount: number;
  effectiveTargetDelta: number;
  rollDeltaTrigger: number;
}

function getISOWeek(date: Date) {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp.valueOf() - yearStart.valueOf()) / 86400000) + 1) / 7);
}

export function generateCycleBoundaries(dates: string[], freq: BacktestFrequency) {
  const boundaries: number[] = [];
  if (dates.length === 0) return boundaries;
  const dObjs = dates.map(d => new Date(d + 'T00:00:00Z'));
  if (freq === 'weekly') {
    let prevWeek = -1;
    for (let i = 0; i < dObjs.length; i++) {
      const week = getISOWeek(dObjs[i]);
      if (prevWeek !== week) {
        boundaries.push(i);
        let j = i;
        while (j + 1 < dObjs.length && getISOWeek(dObjs[j + 1]) === week) j++;
        boundaries.push(j);
        prevWeek = week;
      }
    }
  } else {
    for (let i = 0; i < dObjs.length;) {
      const startIdx = i;
      let j = i;
      while (j + 1 < dObjs.length && dObjs[j + 1].getUTCMonth() === dObjs[i].getUTCMonth()) j++;
      const endIdx = j;
      boundaries.push(startIdx, endIdx);
      i = j + 1;
    }
  }
  return boundaries;
}

export function runBacktest(ohlc: OhlcRow[], params: BacktestParams): RunBacktestResult {
  const dates = ohlc.map(d => d.date);
  const prices = ohlc.map(d => d.adjClose ?? d.close);
  const hv = estimateHV(prices);
  const iv = params.ivOverride && params.ivOverride > 0 ? params.ivOverride : hv;
  const clampDelta = (d: number) => Math.min(0.95, Math.max(0.05, d));
  const baseDelta = typeof params.targetDelta === 'number' && Number.isFinite(params.targetDelta) ? params.targetDelta : 0.3;
  const strikeTargetDelta = clampDelta(baseDelta);
  const rollDeltaTrigger = clampDelta(
    typeof params.rollDeltaThreshold === 'number' && Number.isFinite(params.rollDeltaThreshold)
      ? params.rollDeltaThreshold
      : 0.7,
  );
  const scheduledRollOffset =
    typeof params.rollDaysBeforeExpiry === 'number' && Number.isFinite(params.rollDaysBeforeExpiry)
      ? Math.max(0, Math.min(4, Math.floor(params.rollDaysBeforeExpiry)))
      : null;
  const boundaries = generateCycleBoundaries(dates, params.freq);

  const dateToIndex = new Map<string, number>();
  for (let i = 0; i < dates.length; i++) dateToIndex.set(dates[i], i);
  const earningsIndices = new Set<number>();
  for (const d of params.earningsDates || []) {
    const idx = dateToIndex.get(d);
    if (idx != null) earningsIndices.add(idx);
  }
  const hasEarningsInCycle = (startIdx: number, endIdx: number) => {
    if (!params.skipEarningsWeek) return false;
    for (let i = startIdx; i <= endIdx; i++) {
      if (earningsIndices.has(i)) return true;
    }
    return false;
  };

  const bh_value: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    bh_value.push(params.initialCapital + params.shares * prices[i]);
  }

  let cash = params.initialCapital;
  let shares = params.shares;
  const baseContractQty = Math.floor(params.shares / 100);
  let openCall: null | {
    strike: number;
    premium: number;
    qty: number;
    sellIdx: number;
    expIdx: number;
  } = null;
  const cc_value: number[] = [];
  const callStrikeSeries: (number | null)[] = [];
  const callDeltaSeries: (number | null)[] = [];
  const settlements: {
    index: number;
    date: string;
    totalValue: number;
    pnl: number;
    strike: number;
    underlying: number;
    premium: number;
    qty: number;
    type: 'roll' | 'expiry';
    delta?: number;
    rollReason?: 'delta' | 'scheduled';
  }[] = [];
  const rollEvents: {
    index: number;
    date: string;
    totalValue: number;
    pnl: number;
    strike: number;
    underlying: number;
    premium: number;
    qty: number;
    type: 'roll';
    delta?: number;
    rollReason: 'delta' | 'scheduled';
  }[] = [];

  for (let i = 0; i < prices.length; i++) {
    const S = prices[i];

    if (params.enableRoll && openCall) {
      const daysToExpiry = openCall.expIdx - i;
      if (daysToExpiry >= 0) {
        const timeToExpiry = Math.max(daysToExpiry / 252, 1 / 252);
        const currentDelta = bsCallDelta(S, openCall.strike, params.r, params.q, iv, timeToExpiry);
        const meetsDeltaTrigger = daysToExpiry > 2 && currentDelta >= rollDeltaTrigger;
        let meetsScheduledRoll = false;
        if (scheduledRollOffset !== null) {
          const targetIndex = Math.max(openCall.sellIdx, openCall.expIdx - scheduledRollOffset);
          meetsScheduledRoll = i >= targetIndex;
        }
        if (meetsDeltaTrigger || meetsScheduledRoll) {
          const closeValue = bsCallPrice(S, openCall.strike, params.r, params.q, iv, timeToExpiry);
          const closeCost = closeValue * (openCall.qty * 100);
          cash -= closeCost;
          const rollPnl = (openCall.premium - closeValue) * (openCall.qty * 100);
          const totalAfterClose = cash + shares * S;
          const rollReason: 'delta' | 'scheduled' = meetsDeltaTrigger ? 'delta' : 'scheduled';
          const rollRecord = {
            index: i,
            date: dates[i],
            totalValue: totalAfterClose,
            pnl: rollPnl,
            strike: openCall.strike,
            underlying: S,
            premium: openCall.premium,
            qty: openCall.qty,
            type: 'roll' as const,
            delta: currentDelta,
            rollReason,
          };
          settlements.push(rollRecord);
          if (meetsDeltaTrigger) {
            rollEvents.push({ ...rollRecord, rollReason: 'delta' });
          }

          let newExpIdx = Math.min(prices.length - 1, openCall.expIdx + 5);
          if (newExpIdx <= i) newExpIdx = Math.min(prices.length - 1, i + 1);
          const newTerm = Math.max((newExpIdx - i) / 252, 1 / 252);
          let newStrike = findStrikeForTargetDelta(S, strikeTargetDelta, params.r, params.q, iv, newTerm);
          if (params.roundStrikeToInt) newStrike = Math.round(newStrike);
          if (meetsDeltaTrigger) {
            const minIncrement = params.roundStrikeToInt ? 1 : Math.max(0.5, newStrike * 0.01);
            if (newStrike <= openCall.strike) {
              newStrike = openCall.strike + minIncrement;
              if (params.roundStrikeToInt) newStrike = Math.round(newStrike);
            }
          }
          const newQty = params.dynamicContracts ? Math.floor(shares / 100) : baseContractQty;
          if (newQty > 0) {
            const newPremium = bsCallPrice(S, newStrike, params.r, params.q, iv, newTerm);
            openCall = { strike: newStrike, premium: newPremium, qty: newQty, sellIdx: i, expIdx: newExpIdx };
            const premiumCash = newPremium * (newQty * 100);
            cash += premiumCash;
            if (params.reinvestPremium) {
              const lotShares = Math.floor(premiumCash / S);
              if (lotShares > 0) {
                shares += lotShares;
                cash -= lotShares * S;
              }
            }
          } else {
            openCall = null;
          }
        }
      }
    }

    if (!openCall) {
      for (let b = 0; b < boundaries.length; b += 2) {
        if (boundaries[b] === i) {
          const expIdx = boundaries[b + 1];
          if (hasEarningsInCycle(boundaries[b], expIdx)) break;
          const T = Math.max((expIdx - boundaries[b] + 1) / 252, 1 / 252);
          const qty = params.dynamicContracts ? Math.floor(shares / 100) : baseContractQty;
          if (qty > 0) {
            const S = prices[i];
            let strike = findStrikeForTargetDelta(S, strikeTargetDelta, params.r, params.q, iv, T);
            if (params.roundStrikeToInt) strike = Math.max(1, Math.round(strike));
            const premium = bsCallPrice(S, strike, params.r, params.q, iv, T);
            openCall = { strike, premium, qty, sellIdx: i, expIdx };
            const premiumCash = premium * (qty * 100);
            cash += premiumCash;
            if (params.reinvestPremium) {
              const lotShares = Math.floor(premiumCash / S);
              if (lotShares > 0) {
                shares += lotShares;
                cash -= lotShares * S;
              }
            }
          }
          break;
        }
      }
    }

    let settlementNote: null | {
      pnl: number;
      strike: number;
      underlying: number;
      premium: number;
      qty: number;
      delta?: number;
    } = null;

    const isLastDay = i === prices.length - 1;
    if (openCall && (openCall.expIdx === i || (isLastDay && openCall.expIdx > i))) {
      const Sexp = prices[i];
      const assignedLots = Sexp > openCall.strike ? openCall.qty : 0;
      if (assignedLots > 0) {
        const deliver = assignedLots * 100;
        const deliverable = Math.min(deliver, shares);
        shares -= deliverable;
        cash += deliverable * openCall.strike;
        const rebuy = deliverable;
        if (rebuy > 0) {
          cash -= rebuy * Sexp;
          shares += rebuy;
        }
      }
      const intrinsic = Math.max(0, Sexp - openCall.strike);
      const pnl = (openCall.premium - intrinsic) * (openCall.qty * 100);
      settlementNote = {
        pnl,
        strike: openCall.strike,
        underlying: Sexp,
        premium: openCall.premium,
        qty: openCall.qty,
        delta: intrinsic > 0 ? 1 : 0,
      };
      openCall = null;
    }

    const total = cash + shares * prices[i];
    cc_value.push(total);
    if (openCall) {
      const remainingDays = Math.max(openCall.expIdx - i, 0);
      const remainingTerm = Math.max(remainingDays / 252, 1 / 252);
      callDeltaSeries.push(bsCallDelta(S, openCall.strike, params.r, params.q, iv, remainingTerm));
      callStrikeSeries.push(openCall.strike);
    } else {
      callDeltaSeries.push(null);
      callStrikeSeries.push(null);
    }
    if (settlementNote) {
      settlements.push({
        index: i,
        date: dates[i],
        totalValue: total,
        pnl: settlementNote.pnl,
        strike: settlementNote.strike,
        underlying: settlementNote.underlying,
        premium: settlementNote.premium,
        qty: settlementNote.qty,
        type: 'expiry',
        delta: settlementNote.delta,
      });
    }
  }

  const out = dates.map((d, idx) => ({
    date: d,
    BuyAndHold: bh_value[idx],
    CoveredCall: cc_value[idx],
    UnderlyingPrice: prices[idx],
    CallStrike: callStrikeSeries[idx],
    CallDelta: callDeltaSeries[idx],
    settlement: null as null | {
      pnl: number;
      strike: number;
      underlying: number;
      premium: number;
      qty: number;
      type: 'roll' | 'expiry';
      delta?: number;
      rollReason?: 'delta' | 'scheduled';
    },
  }));

  for (const s of settlements) {
    out[s.index].settlement = {
      pnl: s.pnl,
      strike: s.strike,
      underlying: s.underlying,
      premium: s.premium,
      qty: s.qty,
      type: s.type,
      delta: s.delta,
      rollReason: s.rollReason,
    };
  }
  const bhReturn = (bh_value.at(-1)! / bh_value[0] - 1);
  const ccReturn = (cc_value.at(-1)! / cc_value[0] - 1);
  const settlementTrades = settlements.filter(s => s.qty > 0);
  const winningTrades = settlementTrades.filter(s => s.pnl > 0).length;
  const ccWinRate = settlementTrades.length > 0 ? winningTrades / settlementTrades.length : 0;
  return {
    curve: out,
    bhReturn,
    ccReturn,
    hv,
    ivUsed: iv,
    bhShares: params.shares,
    ccShares: shares,
    settlements: settlements.map(({ index: _index, ...rest }) => rest),
    rollEvents: rollEvents.map(({ index: _index, ...rest }) => rest),
    ccWinRate,
    ccSettlementCount: settlementTrades.length,
    effectiveTargetDelta: strikeTargetDelta,
    rollDeltaTrigger,
  };
}
