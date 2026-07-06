// Orchestrates the Supertrend data source: DexPaprika first (richer pool metadata,
// no API key, 10k req/day free), falling back to GeckoTerminal per-request whenever
// DexPaprika's OHLCV is too sparse to trust for ATR/Supertrend math.
//
// Why a fallback is needed at all: DexPaprika only returns candles where a trade
// actually happened (no forward-fill for quiet minutes). On deep pools (e.g.
// SOL/USDC) that's a non-issue — verified live at 29/30 one-minute candles in a
// 30-minute window. On typical trench-sized pools it gets gappy — verified live
// at 5/60 candles for a real ~$5k-liquidity PumpSwap pool over the same window.
// GeckoTerminal forward-fills flat candles for quiet minutes (60/60 on the same
// pool/window), which is the shape Supertrend's True-Range math actually needs.
// Both APIs report the same on-chain pool address, so the fallback re-uses the
// pool DexPaprika resolved instead of doing a second pool lookup.

import {
  SUPERTREND_TIMEFRAME, SUPERTREND_AGGREGATE, SUPERTREND_CANDLE_LIMIT,
  SUPERTREND_PERIOD, SUPERTREND_MULTIPLIER, SUPERTREND_MIN_DENSITY_RATIO, SUPERTREND_MAX_GAP_MULTIPLE,
  DEXPAPRIKA_ENABLED, GECKOTERMINAL_ENABLED,
} from '../config.js';
import { computeSupertrend } from '../indicators/supertrend.js';
import * as dexpaprika from './dexpaprika.js';
import * as geckoterminal from './geckoterminal.js';

const TIMEFRAME_SECONDS = { minute: 60, hour: 3600, day: 86400 };

function intervalSeconds() {
  return (TIMEFRAME_SECONDS[SUPERTREND_TIMEFRAME] || 60) * Math.max(1, SUPERTREND_AGGREGATE);
}

function isSparse(candles) {
  if (!candles.length) return true;
  if (candles.length < SUPERTREND_CANDLE_LIMIT * SUPERTREND_MIN_DENSITY_RATIO) return true;
  const step = intervalSeconds();
  const maxGap = step * SUPERTREND_MAX_GAP_MULTIPLE;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time - candles[i - 1].time > maxGap) return true;
  }
  return false;
}

async function resolvePool(mint, { useCache = true } = {}) {
  if (DEXPAPRIKA_ENABLED) {
    const pool = await dexpaprika.resolvePoolAddress(mint, { useCache });
    if (pool?.address) return { ...pool, source: 'dexpaprika' };
  }
  if (GECKOTERMINAL_ENABLED) {
    const pool = await geckoterminal.resolvePoolAddress(mint, { useCache });
    if (pool?.address) return { ...pool, source: 'geckoterminal' };
  }
  return null;
}

async function fetchSupertrendContext(mint, { useCache = true } = {}) {
  if (!DEXPAPRIKA_ENABLED && !GECKOTERMINAL_ENABLED) return { available: false, reason: 'disabled' };

  const pool = await resolvePool(mint, { useCache });
  if (!pool?.address) return { available: false, reason: 'no_pool' };

  let candles = [];
  let source = pool.source;

  if (DEXPAPRIKA_ENABLED) {
    candles = await dexpaprika.fetchOhlcv(pool.address, { timeframe: SUPERTREND_TIMEFRAME, limit: SUPERTREND_CANDLE_LIMIT, useCache });
    source = 'dexpaprika';
  }

  if (isSparse(candles) && GECKOTERMINAL_ENABLED) {
    const fallbackCandles = await geckoterminal.fetchOhlcv(pool.address, { timeframe: SUPERTREND_TIMEFRAME, aggregate: SUPERTREND_AGGREGATE, limit: SUPERTREND_CANDLE_LIMIT, useCache });
    if (!isSparse(fallbackCandles) || fallbackCandles.length > candles.length) {
      candles = fallbackCandles;
      source = 'geckoterminal_fallback';
    }
  }

  if (!candles.length) return { available: false, reason: 'no_candles', poolAddress: pool.address, dex: pool.dex };

  const trend = computeSupertrend(candles, { period: SUPERTREND_PERIOD, multiplier: SUPERTREND_MULTIPLIER });
  return {
    ...trend,
    source,
    poolAddress: pool.address,
    dex: pool.dex,
    timeframe: SUPERTREND_TIMEFRAME,
    aggregate: SUPERTREND_AGGREGATE,
  };
}

export { resolvePool, fetchSupertrendContext, isSparse };
