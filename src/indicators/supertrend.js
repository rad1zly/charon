// Standard Supertrend indicator (ATR bands + trend-following direction flip).
// Pure function: no I/O, no config imports — takes chronological OHLCV candles in, returns trend state out.

function trueRange(candle, prevClose) {
  const { high, low } = candle;
  if (prevClose == null) return high - low;
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

// Wilder's smoothing (the standard ATR used by Supertrend implementations).
function wilderAtr(candles, period) {
  const atr = new Array(candles.length).fill(null);
  const trs = candles.map((c, i) => trueRange(c, i > 0 ? candles[i - 1].close : null));
  if (candles.length < period) return atr;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += trs[i];
  atr[period - 1] = seed / period;
  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + trs[i]) / period;
  }
  return atr;
}

// candles: chronological array of { time, open, high, low, close, volume } (oldest first).
export function computeSupertrend(candles, { period = 10, multiplier = 3 } = {}) {
  const minCandles = period * 3;
  if (!Array.isArray(candles) || candles.length < minCandles) {
    return { available: false, reason: 'insufficient_candles', candleCount: candles?.length || 0, required: minCandles };
  }

  const atr = wilderAtr(candles, period);
  const firstValid = period - 1;
  const finalUpper = new Array(candles.length).fill(null);
  const finalLower = new Array(candles.length).fill(null);
  const direction = new Array(candles.length).fill(null);
  const supertrend = new Array(candles.length).fill(null);

  for (let i = firstValid; i < candles.length; i++) {
    const { high, low, close } = candles[i];
    const hl2 = (high + low) / 2;
    const basicUpper = hl2 + multiplier * atr[i];
    const basicLower = hl2 - multiplier * atr[i];

    if (i === firstValid) {
      finalUpper[i] = basicUpper;
      finalLower[i] = basicLower;
      direction[i] = close <= finalUpper[i] ? -1 : 1;
      supertrend[i] = direction[i] === 1 ? finalLower[i] : finalUpper[i];
      continue;
    }

    const prevClose = candles[i - 1].close;
    finalUpper[i] = (basicUpper < finalUpper[i - 1] || prevClose > finalUpper[i - 1]) ? basicUpper : finalUpper[i - 1];
    finalLower[i] = (basicLower > finalLower[i - 1] || prevClose < finalLower[i - 1]) ? basicLower : finalLower[i - 1];

    if (direction[i - 1] === -1) {
      direction[i] = close > finalUpper[i] ? 1 : -1;
    } else {
      direction[i] = close < finalLower[i] ? -1 : 1;
    }
    supertrend[i] = direction[i] === 1 ? finalLower[i] : finalUpper[i];
  }

  const last = candles.length - 1;
  const prev = last - 1;
  const lastDirection = direction[last];
  const prevDirection = direction[prev];

  return {
    available: true,
    reason: null,
    candleCount: candles.length,
    direction: lastDirection,
    trend: lastDirection === 1 ? 'bullish' : 'bearish',
    justFlippedBullish: lastDirection === 1 && prevDirection === -1,
    justFlippedBearish: lastDirection === -1 && prevDirection === 1,
    value: supertrend[last],
    atr: atr[last],
    lastClose: candles[last].close,
    lastTime: candles[last].time,
  };
}
