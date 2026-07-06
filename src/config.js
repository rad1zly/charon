import dotenv from 'dotenv';

dotenv.config();

export const APP_NAME = 'Charon';
export const DB_PATH = process.env.DB_PATH || './charon.sqlite';
export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const DISC_DIST_FEES = Buffer.from('a537817004b3ca28', 'hex');
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const SOL_MINT = 'So11111111111111111111111111111111111111111';

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
export const TELEGRAM_TOPIC_ID = process.env.TELEGRAM_TOPIC_ID;
export const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
export const GMGN_API_KEY = process.env.GMGN_API_KEY;
export const GMGN_ENABLED = process.env.GMGN_ENABLED !== 'false';
export const JUPITER_API_KEY = process.env.JUPITER_API_KEY || '';
export const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY || process.env.PRIVATE_KEY || '';
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
export const SOLANA_WS_URL = process.env.SOLANA_WS_URL || `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
export const JUPITER_SWAP_BASE_URL = process.env.JUPITER_SWAP_BASE_URL || 'https://api.jup.ag/swap/v2';
export const JUPITER_SLIPPAGE_BPS = Number(process.env.JUPITER_SLIPPAGE_BPS || 300);
export const LIVE_MIN_SOL_RESERVE_LAMPORTS = Math.floor(Number(process.env.LIVE_MIN_SOL_RESERVE || 0.02) * 1_000_000_000);

export const GRADUATED_POLL_MS = Number(process.env.GRADUATED_POLL_MS || 30_000);
export const GRADUATED_LOOKBACK_MS = Number(process.env.GRADUATED_LOOKBACK_MS || 2 * 60 * 60 * 1000);
export const TRENDING_POLL_MS = Number(process.env.TRENDING_POLL_MS || 60_000);
export const TRENDING_LOOKBACK_MS = Number(process.env.TRENDING_LOOKBACK_MS || 10 * 60 * 1000);
export const GMGN_CACHE_TTL_MS = Number(process.env.GMGN_CACHE_TTL_MS || 5 * 60 * 1000);
export const POSITION_CHECK_MS = Number(process.env.POSITION_CHECK_MS || 10_000);
export const SIGNAL_SERVER_URL = process.env.SIGNAL_SERVER_URL || 'http://localhost:3456';
export const SIGNAL_SERVER_KEY = process.env.SIGNAL_SERVER_KEY || '';
export const SIGNAL_POLL_MS = Number(process.env.SIGNAL_POLL_MS || 30_000);

export const DASHBOARD_ENABLED = process.env.DASHBOARD_ENABLED !== 'false';
export const DASHBOARD_HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
export const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || 8787);
export const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || '';

// DexPaprika (DexPaprika by CoinPaprika) — primary OHLCV source. Public, no key
// required, 10,000 req/day free tier, richer pool metadata than GeckoTerminal.
// Its OHLCV only returns candles where a trade happened (no forward-fill), which
// gets sparse/gappy on low-volume trench pools — see GECKOTERMINAL_* below for
// the automatic fallback used when that happens.
export const DEXPAPRIKA_ENABLED = process.env.DEXPAPRIKA_ENABLED !== 'false';
export const DEXPAPRIKA_BASE_URL = process.env.DEXPAPRIKA_BASE_URL || 'https://api.dexpaprika.com';
export const DEXPAPRIKA_NETWORK = process.env.DEXPAPRIKA_NETWORK || 'solana';
export const DEXPAPRIKA_REQUEST_DELAY_MS = Number(process.env.DEXPAPRIKA_REQUEST_DELAY_MS || 300);
export const DEXPAPRIKA_POOL_CACHE_TTL_MS = Number(process.env.DEXPAPRIKA_POOL_CACHE_TTL_MS || 15 * 60 * 1000);
export const DEXPAPRIKA_POOL_MISS_TTL_MS = Number(process.env.DEXPAPRIKA_POOL_MISS_TTL_MS || 2 * 60 * 1000);
export const DEXPAPRIKA_OHLCV_CACHE_TTL_MS = Number(process.env.DEXPAPRIKA_OHLCV_CACHE_TTL_MS || 30_000);

// GeckoTerminal DEX API — fallback OHLCV source only, used when DexPaprika's
// candles are too sparse for reliable ATR/Supertrend math (see supertrendSource.js).
// Public, no key required. Free tier is rate-limited to ~30 req/min.
export const GECKOTERMINAL_ENABLED = process.env.GECKOTERMINAL_ENABLED !== 'false';
export const GECKOTERMINAL_BASE_URL = process.env.GECKOTERMINAL_BASE_URL || 'https://api.geckoterminal.com/api/v2';
export const GECKOTERMINAL_NETWORK = process.env.GECKOTERMINAL_NETWORK || 'solana';
export const GECKOTERMINAL_REQUEST_DELAY_MS = Number(process.env.GECKOTERMINAL_REQUEST_DELAY_MS || 2200);
export const GECKOTERMINAL_POOL_CACHE_TTL_MS = Number(process.env.GECKOTERMINAL_POOL_CACHE_TTL_MS || 15 * 60 * 1000);
export const GECKOTERMINAL_POOL_MISS_TTL_MS = Number(process.env.GECKOTERMINAL_POOL_MISS_TTL_MS || 2 * 60 * 1000);
export const GECKOTERMINAL_OHLCV_CACHE_TTL_MS = Number(process.env.GECKOTERMINAL_OHLCV_CACHE_TTL_MS || 30_000);

// Supertrend — computed from 1-minute candles by default (DexPaprika primary,
// GeckoTerminal fallback on sparse data).
export const SUPERTREND_TIMEFRAME = process.env.SUPERTREND_TIMEFRAME || 'minute';
export const SUPERTREND_AGGREGATE = Number(process.env.SUPERTREND_AGGREGATE || 1);
export const SUPERTREND_CANDLE_LIMIT = Number(process.env.SUPERTREND_CANDLE_LIMIT || 60);
export const SUPERTREND_PERIOD = Number(process.env.SUPERTREND_PERIOD || 10);
export const SUPERTREND_MULTIPLIER = Number(process.env.SUPERTREND_MULTIPLIER || 3);
// A source is considered too sparse if it returns fewer than this fraction of the
// candles requested, or if any gap between consecutive candles exceeds this many
// interval-widths (e.g. a 1m interval with a 15-minute gap is treated as broken).
export const SUPERTREND_MIN_DENSITY_RATIO = Number(process.env.SUPERTREND_MIN_DENSITY_RATIO || 0.6);
export const SUPERTREND_MAX_GAP_MULTIPLE = Number(process.env.SUPERTREND_MAX_GAP_MULTIPLE || 3);

export const JSON_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

export function validateConfig() {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required.');
  if (!TELEGRAM_CHAT_ID) throw new Error('TELEGRAM_CHAT_ID is required.');
  if (!HELIUS_API_KEY && (!process.env.SOLANA_RPC_URL || !process.env.SOLANA_WS_URL)) {
    throw new Error('HELIUS_API_KEY is required unless SOLANA_RPC_URL and SOLANA_WS_URL are set.');
  }
  if (GMGN_ENABLED && !GMGN_API_KEY) throw new Error('GMGN_API_KEY is required unless GMGN_ENABLED=false.');
}
