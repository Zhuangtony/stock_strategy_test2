import { bsCallPrice, bsCallDelta, findStrikeForTargetDelta, estimateHV } from './optionMath';

function getISOWeek(date: Date) {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp.valueOf() - yearStart.valueOf()) / 86400000) + 1) / 7);
}

export function generateCycleBoundaries(dates: string[], freq: 'weekly' | 'monthly') {
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

export function runBacktest(
  ohlc: { date: string; close: number; adjClose: number }[],
  params: {
    initialCapital: number;
    shares: number;
    r: number;
    q: number;
    targetDelta: number;
    freq: 'weekly' | 'monthly';
    ivOverride?: number | null;
    reinvestPremium: boolean;
  },
) {
  const dates = ohlc.map(d => d.date);
  const prices = ohlc.map(d => d.adjClose ?? d.close);
  const hv = estimateHV(prices);
  const iv = params.ivOverride && params.ivOverride > 0 ? params.ivOverride : hv;
  const boundaries = generateCycleBoundaries(dates, params.freq);

  const bh_value: number[] = [];
  for (let i = 0; i < prices.length; i++) bh_value.push(params.initialCapital + params.shares * (prices[i] - prices[0]));

  let cash = params.initialCapital;
  let shares = params.shares;
  let openCall: null | { strike: number; premium: number; qty: number; sellIdx: number; expIdx: number } = null;
  const cc_value: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    for (let b = 0; b < boundaries.length; b += 2) {
      if (boundaries[b] === i) {
        const T = (boundaries[b + 1] - boundaries[b] + 1) / 252;
        const S = prices[i];
        const K = findStrikeForTargetDelta(S, params.targetDelta, params.r, params.q, iv, T);
        const premium = bsCallPrice(S, K, params.r, params.q, iv, T);
        openCall = { strike: K, premium, qty: Math.floor(shares / 100), sellIdx: i, expIdx: boundaries[b + 1] };
        const premiumCash = premium * (openCall.qty * 100);
        cash += premiumCash;
        if (params.reinvestPremium) {
          const lotShares = Math.floor(premiumCash / S);
          if (lotShares > 0) { shares += lotShares; cash -= lotShares * S; }
        }
      }
    }
    for (let b = 0; b < boundaries.length; b += 2) {
      if (boundaries[b + 1] === i && openCall && openCall.expIdx === i) {
        const Sexp = prices[i];
        const assignedLots = Sexp > openCall.strike ? openCall.qty : 0;
        if (assignedLots > 0) {
          const deliver = assignedLots * 100;
          const deliverable = Math.min(deliver, shares);
          shares -= deliverable;
          cash += deliverable * openCall.strike;
          const rebuy = deliverable;
          if (rebuy > 0) { cash -= rebuy * Sexp; shares += rebuy; }
        }
        openCall = null;
      }
    }
    const total = cash + shares * prices[i];
    cc_value.push(total);
  }

  const out = dates.map((d, idx) => ({ date: d, BuyAndHold: bh_value[idx], CoveredCall: cc_value[idx] }));
  const bhReturn = (bh_value.at(-1)! / bh_value[0] - 1);
  const ccReturn = (cc_value.at(-1)! / cc_value[0] - 1);
  return {
    curve: out,
    bhReturn,
    ccReturn,
    hv,
    ivUsed: iv,
    bhShares: params.shares,
    ccShares: shares,
  };
}
