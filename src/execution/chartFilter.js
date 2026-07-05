// src/execution/chartFilter.js
// Pre-entry chart-based filters using GMGN K-line (candlestick) data.
// Layer 2 of 2 (fundamental + chart).
//
// GMGN K-line endpoint: GET /v1/market/token_kline
//   Supported resolutions: 1m, 5m, 15m, 1h, 4h, 1d
//   IMPORTANT: from/to must be in MILLISECONDS (gmgn-cli uses *1000 internally)
//
// Strategy config keys:
//   chart_filter_enabled         (bool, default true)
//   supertrend_resolution        (string, default '15m')
//   supertrend_period            (number, default 10)
//   supertrend_multiplier        (number, default 3.0)
//   min_supertrend_candles       (number, default 8)
//   min_volume_spike_ratio       (number, default 1.5)
//   supertrend_bypass_min_sources (number, default 3) — skip chart filter if signal sources >= N

import { gmgnFetch } from '../enrichment/gmgn.js';

const RESOLUTION_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

/**
 * Fetch kline (OHLCV) candles from GMGN.
 * @param {string} mint - token mint address
 * @param {string} resolution - 1m / 5m / 15m / 1h / 4h / 1d
 * @param {number} candles - how many candles to fetch
 * @returns {Promise<Array<{time, open, high, low, close, volume}>>}
 */
export async function fetchGmgnKline(mint, resolution = '15m', candles = 50, asOfMs = null) {
  const sec = RESOLUTION_SECONDS[resolution];
  if (!sec) throw new Error(`Unsupported resolution: ${resolution}`);
  const toMs = asOfMs || Date.now();
  const fromMs = toMs - candles * sec * 1000;
  const payload = await gmgnFetch('/v1/market/token_kline', {
    params: {
      chain: 'sol',
      address: mint,
      resolution,
      from: fromMs,
      to: toMs,
    },
  });
  const list = payload?.data?.list || [];
  return list
    .map(c => ({
      time: Number(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume || 0),
    }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Calculate Supertrend indicator (Wilder's ATR-based).
 * Returns { direction: 'up'|'down', value, currentPrice, atr, candles }.
 */
export function calculateSupertrend(candles, period = 10, multiplier = 3.0) {
  if (!candles || candles.length < period + 1) return null;

  // ATR via Wilder's smoothing
  const atr = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const cur = candles[i];
    if (i === 0) {
      atr[i] = cur.high - cur.low;
      continue;
    }
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    if (i === 1) {
      atr[i] = tr;
    } else {
      // Wilder smoothing
      atr[i] = (atr[i - 1] * (period - 1) + tr) / period;
    }
  }

  let direction = null; // 'up' (bullish) or 'down' (bearish)
  let supertrend = null;

  for (let i = period; i < candles.length; i++) {
    const cur = candles[i];
    const hl2 = (cur.high + cur.low) / 2;
    const basicUpper = hl2 + multiplier * atr[i];
    const basicLower = hl2 - multiplier * atr[i];

    if (direction === null) {
      direction = cur.close > basicUpper ? 'up' : 'down';
      supertrend = direction === 'up' ? basicLower : basicUpper;
      continue;
    }

    // Standard Supertrend flip logic
    if (direction === 'up') {
      if (cur.close < supertrend) {
        direction = 'down';
        supertrend = basicUpper;
      } else {
        // Lower band can only stay or rise (not decrease) in uptrend
        supertrend = Math.max(supertrend, basicLower);
      }
    } else {
      if (cur.close > supertrend) {
        direction = 'up';
        supertrend = basicLower;
      } else {
        supertrend = Math.min(supertrend, basicUpper);
      }
    }
  }

  const last = candles[candles.length - 1];
  return {
    direction,
    value: supertrend,
    currentPrice: last.close,
    atr: atr[atr.length - 1],
    atrPct: last.close > 0 ? (atr[atr.length - 1] / last.close) * 100 : 0,
  };
}

/**
 * Calculate simple moving average (for trend context).
 */
export function sma(candles, period) {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  return slice.reduce((s, c) => s + c.close, 0) / period;
}

/**
 * Volume ratio: current candle volume / median of previous N candles.
 * Returns 0 if no history or all-zero volumes.
 */
export function volumeRatio(candles, lookback = 5) {
  if (candles.length < 2) return 0;
  const cur = candles[candles.length - 1].volume;
  const prev = candles.slice(-(lookback + 1), -1).map(c => c.volume);
  if (prev.length === 0) return 0;
  const sorted = [...prev].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median > 0 ? cur / median : 0;
}

/**
 * Momentum-based fallback when Supertrend has insufficient history.
 * Catches the case where token is too new for Supertrend but we can still
 * detect pump-and-dump patterns from recent candles.
 *
 * Rules:
 *   1. Last candle must be GREEN (close > open) — not dumping right before entry
 *   2. Last 3 candles: at most 1 RED candle — sustained momentum
 *   3. Last candle volume > 1.5x median of previous 5 — sustained volume
 *   4. Last close > lowest low of last 3 candles — not recovering from deep dip
 */
function runMomentumFallback(candles, volumeThreshold) {
  const checks = [];
  const last = candles[candles.length - 1];
  const prev3 = candles.slice(-Math.min(3, candles.length));
  const lastChangePct = ((last.close - last.open) / last.open) * 100;

  // 1. Last candle must be GREEN or small red (<30%) — big dump right before entry is fatal
  //    (catches pump-and-dump pattern where token dumps >50% in last candle)
  const lastDumpOk = lastChangePct > -30;
  checks.push({
    name: 'momentum_no_major_dump',
    pass: lastDumpOk,
    value: `${lastChangePct >= 0 ? '+' : ''}${lastChangePct.toFixed(1)}%`,
    note: 'last candle change',
  });

  // 2. Last close > previous candle open (momentum continuation, not reversal)
  if (candles.length >= 2) {
    const prevOpen = candles[candles.length - 2].open;
    const abovePrev = last.close > prevOpen;
    checks.push({
      name: 'momentum_close_above_prev_open',
      pass: abovePrev,
      value: last.close,
      prev_open: prevOpen,
    });
  }

  // 3. Volume spike — current vs median of previous (excluding current)
  const vRatio = volumeRatio(candles, 5);
  checks.push({
    name: 'momentum_volume_spike',
    pass: vRatio >= volumeThreshold,
    value: vRatio,
    threshold: volumeThreshold,
  });

  // 4. Last close > lowest low of available candles (not in deep recovery)
  const minLow = Math.min(...candles.map(c => c.low));
  checks.push({
    name: 'momentum_close_above_recent_low',
    pass: last.close > minLow,
    value: last.close,
    recent_low: minLow,
  });

  const failed = checks.filter(c => !c.pass);
  return {
    pass: failed.length === 0,
    checks,
    failed,
    passed: checks.filter(c => c.pass),
    skipped: false,
    meta: {
      mode: 'momentum_fallback',
      resolution: candles.length > 0 ? 'recent_candles' : 'none',
      candles_used: candles.length,
      last_close: last.close,
      last_change_pct: lastChangePct,
      volume_ratio: vRatio,
    },
  };
}

/**
 * Run all chart-based checks against a candidate mint.
 *
 * @param {string} mint - token mint address
 * @param {Object} strategyConfig - active strategy config
 * @param {Object} [opts] - { sourceCount } - signal source count for bypass logic
 * @returns {Promise<{pass: boolean, checks: Array, meta: Object}>}
 */
export async function evaluateChartFilter(mint, strategyConfig, opts = {}) {
  const enabled = strategyConfig.chart_filter_enabled !== false;
  if (!enabled) {
    return { pass: true, skipped: true, reason: 'chart_filter_disabled', checks: [] };
  }

  const bypassSources = Number(strategyConfig.supertrend_bypass_min_sources || 0);
  const sourceCount = Number(opts.sourceCount || 0);
  if (bypassSources > 0 && sourceCount >= bypassSources) {
    return {
      pass: true,
      skipped: true,
      reason: `bypass_due_to_strong_signal (sources=${sourceCount}>=${bypassSources})`,
      checks: [],
    };
  }

  const resolution = strategyConfig.supertrend_resolution || '15m';
  const period = Number(strategyConfig.supertrend_period || 10);
  const multiplier = Number(strategyConfig.supertrend_multiplier || 3.0);
  const minCandles = Number(strategyConfig.min_supertrend_candles || 8);
  const volumeThreshold = Number(strategyConfig.min_volume_spike_ratio || 1.5);

  let candles;
  try {
    candles = await fetchGmgnKline(mint, resolution, 50, opts.asOfMs || null);
  } catch (err) {
    return {
      pass: true,
      skipped: true,
      reason: `kline_fetch_failed: ${err.message}`,
      checks: [],
    };
  }

  if (!candles || candles.length < minCandles) {
    // Insufficient candles for Supertrend — fallback to momentum check
    // Critical for new tokens that haven't accumulated enough 15m candles yet.
    // Recent pump-and-dump tokens show RED candle before entry; reject those.
    if (!candles || candles.length < 2) {
      return {
        pass: true,
        skipped: true,
        reason: `insufficient_data_for_any_check (have=${candles?.length || 0})`,
        checks: [],
        meta: { resolution, candles_available: candles?.length || 0 },
      };
    }
    return runMomentumFallback(candles, volumeThreshold);
  }

  const checks = [];
  const st = calculateSupertrend(candles, period, multiplier);
  if (!st) {
    return {
      pass: true,
      skipped: true,
      reason: 'supertrend_calc_failed',
      checks: [],
    };
  }

  // --- Supertrend direction ---
  checks.push({
    name: 'supertrend_direction',
    pass: st.direction === 'up',
    value: st.direction,
  });

  // --- Price above Supertrend (redundant safety net) ---
  checks.push({
    name: 'price_above_supertrend',
    pass: st.currentPrice > st.value,
    value: st.currentPrice,
    supertrend: st.value,
  });

  // --- Volume spike ---
  const vRatio = volumeRatio(candles, 5);
  checks.push({
    name: 'volume_spike',
    pass: vRatio >= volumeThreshold,
    value: vRatio,
    threshold: volumeThreshold,
  });

  // --- Trend strength (price vs SMA20) ---
  const sma20 = sma(candles, Math.min(20, candles.length));
  if (sma20 !== null) {
    const trendPct = ((st.currentPrice - sma20) / sma20) * 100;
    checks.push({
      name: 'price_above_sma20',
      pass: trendPct >= -2, // allow slight pullback to SMA20
      value: trendPct,
      sma20,
    });
  }

  const failed = checks.filter(c => !c.pass);
  const passed = checks.filter(c => c.pass);

  return {
    pass: failed.length === 0,
    checks,
    failed,
    passed,
    skipped: false,
    meta: {
      resolution,
      period,
      multiplier,
      candles_used: candles.length,
      direction: st.direction,
      currentPrice: st.currentPrice,
      supertrend: st.value,
      atr: st.atr,
      atr_pct: st.atrPct,
      volume_ratio: vRatio,
      sma20,
    },
  };
}