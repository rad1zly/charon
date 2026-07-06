import axios from 'axios';
import {
  DEXPAPRIKA_ENABLED, DEXPAPRIKA_BASE_URL, DEXPAPRIKA_NETWORK, DEXPAPRIKA_REQUEST_DELAY_MS,
  DEXPAPRIKA_POOL_CACHE_TTL_MS, DEXPAPRIKA_POOL_MISS_TTL_MS, DEXPAPRIKA_OHLCV_CACHE_TTL_MS,
} from '../config.js';
import { now, sleep } from '../utils.js';

const poolCache = new Map(); // mint -> { at, pool: { address, dex } | null }
const ohlcvCache = new Map(); // `${pool}:${interval}` -> { at, candles }
let lastRequestAt = 0;
let queue = Promise.resolve();
let backoffUntil = 0;

const INTERVAL_MAP = { minute: '1m', hour: '1h', day: '24h' };

function enqueue(work) {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

async function pace() {
  const delayMs = Math.max(0, DEXPAPRIKA_REQUEST_DELAY_MS);
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
  console.log(`[dexpaprika] backing off until ${new Date(backoffUntil).toISOString()} (429)`);
}

async function dpFetch(pathname, params = {}) {
  if (!DEXPAPRIKA_ENABLED) throw new Error('DexPaprika disabled');
  if (backoffActive()) throw new Error('DexPaprika rate-limited (backing off)');
  return enqueue(async () => {
    await pace();
    const url = new URL(`${DEXPAPRIKA_BASE_URL.replace(/\/$/, '')}${pathname}`);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    const res = await axios.get(url.toString(), { timeout: 10_000 });
    return res.data;
  });
}

// Picks the highest-volume pool among the token's known pools (DexPaprika doesn't
// expose a direct liquidity/reserve field, so volume_usd is the closest proxy).
async function resolvePoolAddress(mint, { useCache = true } = {}) {
  const cached = poolCache.get(mint);
  if (useCache && cached) {
    const ttl = cached.pool ? DEXPAPRIKA_POOL_CACHE_TTL_MS : DEXPAPRIKA_POOL_MISS_TTL_MS;
    if (now() - cached.at < ttl) return cached.pool;
  }
  try {
    const payload = await dpFetch(`/networks/${DEXPAPRIKA_NETWORK}/tokens/${mint}/pools`, { limit: 10, order_by: 'volume_usd', sort: 'desc' });
    const rows = Array.isArray(payload?.pools) ? payload.pools : [];
    const best = rows[0] ? { address: rows[0].id, dex: rows[0].dex_name || rows[0].dex_id || null, volumeUsd: Number(rows[0].volume_usd || 0) } : null;
    poolCache.set(mint, { at: now(), pool: best });
    return best;
  } catch (err) {
    setBackoff(err);
    if (err.response?.status !== 404 && err.response?.status !== 429) {
      console.log(`[dexpaprika] pools ${mint.slice(0, 8)}... ${err.response?.status || ''} ${err.message}`);
    }
    poolCache.set(mint, { at: now(), pool: null });
    return null;
  }
}

// timeframe: 'minute'|'hour'|'day' (matches the GeckoTerminal-style values used elsewhere).
async function fetchOhlcv(poolAddress, { timeframe = 'minute', limit = 60, useCache = true } = {}) {
  const interval = INTERVAL_MAP[timeframe] || '1m';
  const key = `${poolAddress}:${interval}:${limit}`;
  const cached = ohlcvCache.get(key);
  if (useCache && cached && now() - cached.at < DEXPAPRIKA_OHLCV_CACHE_TTL_MS) return cached.candles;

  // DexPaprika requires a `start`; only returns candles where a trade happened
  // (no forward-fill), so request a generous window to absorb quiet gaps.
  const intervalMs = { '1m': 60_000, '1h': 3_600_000, '24h': 86_400_000 }[interval] || 60_000;
  const start = Math.floor((now() - intervalMs * limit * 2) / 1000);
  try {
    const payload = await dpFetch(`/networks/${DEXPAPRIKA_NETWORK}/pools/${poolAddress}/ohlcv`, {
      start, interval, limit: Math.min(366, limit * 2),
    });
    const rows = Array.isArray(payload) ? payload : [];
    const candles = rows
      .map(row => ({
        time: Math.floor(Date.parse(row.time_open) / 1000),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume || 0),
      }))
      .sort((a, b) => a.time - b.time);
    ohlcvCache.set(key, { at: now(), candles });
    return candles;
  } catch (err) {
    setBackoff(err);
    if (err.response?.status !== 429) {
      console.log(`[dexpaprika] ohlcv ${poolAddress.slice(0, 8)}... ${err.response?.status || ''} ${err.message}`);
    }
    return cached?.candles || [];
  }
}

export { resolvePoolAddress, fetchOhlcv };
