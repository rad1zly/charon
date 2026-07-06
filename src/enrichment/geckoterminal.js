import axios from 'axios';
import {
  GECKOTERMINAL_ENABLED, GECKOTERMINAL_BASE_URL, GECKOTERMINAL_NETWORK,
  GECKOTERMINAL_REQUEST_DELAY_MS, GECKOTERMINAL_POOL_CACHE_TTL_MS, GECKOTERMINAL_POOL_MISS_TTL_MS,
  GECKOTERMINAL_OHLCV_CACHE_TTL_MS, SUPERTREND_TIMEFRAME, SUPERTREND_AGGREGATE, SUPERTREND_CANDLE_LIMIT,
} from '../config.js';
import { now, sleep } from '../utils.js';

const GT_HEADERS = { Accept: 'application/json;version=20230302' };

const poolCache = new Map(); // mint -> { at, pool: { address, dex } | null }
const ohlcvCache = new Map(); // `${pool}:${timeframe}:${aggregate}` -> { at, candles }
let lastRequestAt = 0;
let queue = Promise.resolve();
let backoffUntil = 0;

function enqueue(work) {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

async function pace() {
  const delayMs = Math.max(0, GECKOTERMINAL_REQUEST_DELAY_MS);
  if (!delayMs) return;
  const elapsed = now() - lastRequestAt;
  if (elapsed < delayMs) await sleep(delayMs - elapsed);
  lastRequestAt = now();
}

function backoffActive() {
  return now() < backoffUntil;
}

function setBackoff(err) {
  if (err.response?.status !== 429) return;
  const retryAfter = Number(err.response?.headers?.['retry-after']);
  backoffUntil = Number.isFinite(retryAfter) ? now() + retryAfter * 1000 : now() + 30_000;
  console.log(`[geckoterminal] backing off until ${new Date(backoffUntil).toISOString()} (429)`);
}

async function gtFetch(pathname, params = {}) {
  if (!GECKOTERMINAL_ENABLED) throw new Error('GeckoTerminal disabled');
  if (backoffActive()) throw new Error('GeckoTerminal rate-limited (backing off)');
  return enqueue(async () => {
    await pace();
    const url = new URL(`${GECKOTERMINAL_BASE_URL.replace(/\/$/, '')}${pathname}`);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    const res = await axios.get(url.toString(), { timeout: 10_000, headers: GT_HEADERS });
    return res.data;
  });
}

// Picks the deepest pool (by liquidity) among the candidate's known pools.
async function resolvePoolAddress(mint, { useCache = true } = {}) {
  const cached = poolCache.get(mint);
  if (useCache && cached) {
    const ttl = cached.pool ? GECKOTERMINAL_POOL_CACHE_TTL_MS : GECKOTERMINAL_POOL_MISS_TTL_MS;
    if (now() - cached.at < ttl) return cached.pool;
  }
  try {
    const payload = await gtFetch(`/networks/${GECKOTERMINAL_NETWORK}/tokens/${mint}/pools`, { page: 1 });
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    let best = null;
    for (const row of rows) {
      const liquidity = Number(row?.attributes?.reserve_in_usd || 0);
      if (!best || liquidity > best.liquidity) {
        best = { address: row?.attributes?.address, dex: row?.relationships?.dex?.data?.id || null, liquidity };
      }
    }
    poolCache.set(mint, { at: now(), pool: best });
    return best;
  } catch (err) {
    setBackoff(err);
    if (err.response?.status !== 404 && err.response?.status !== 429) {
      console.log(`[geckoterminal] pools ${mint.slice(0, 8)}... ${err.response?.status || ''} ${err.message}`);
    }
    poolCache.set(mint, { at: now(), pool: null });
    return null;
  }
}

async function fetchOhlcv(poolAddress, { timeframe = SUPERTREND_TIMEFRAME, aggregate = SUPERTREND_AGGREGATE, limit = SUPERTREND_CANDLE_LIMIT, useCache = true } = {}) {
  const key = `${poolAddress}:${timeframe}:${aggregate}`;
  const cached = ohlcvCache.get(key);
  if (useCache && cached && now() - cached.at < GECKOTERMINAL_OHLCV_CACHE_TTL_MS) return cached.candles;
  try {
    const payload = await gtFetch(`/networks/${GECKOTERMINAL_NETWORK}/pools/${poolAddress}/ohlcv/${timeframe}`, {
      aggregate, limit, currency: 'usd',
    });
    const rows = Array.isArray(payload?.data?.attributes?.ohlcv_list) ? payload.data.attributes.ohlcv_list : [];
    // API returns newest-first; indicator math needs chronological (oldest-first).
    const candles = rows
      .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
      .reverse();
    ohlcvCache.set(key, { at: now(), candles });
    return candles;
  } catch (err) {
    setBackoff(err);
    if (err.response?.status !== 429) {
      console.log(`[geckoterminal] ohlcv ${poolAddress.slice(0, 8)}... ${err.response?.status || ''} ${err.message}`);
    }
    return cached?.candles || [];
  }
}

// Used directly as the primary source's fallback (see supertrendSource.js), which
// orchestrates pool resolution + OHLCV fetch + Supertrend computation across both
// GeckoTerminal and DexPaprika.
export { resolvePoolAddress, fetchOhlcv };
