# Charon

Charon is a Telegram trench agent for Solana Pump-token flow. It screens noisy signals with overlap detection, strategy gates, and a deterministic **rule engine** (no LLM), then routes buys through dry-run, confirm, or live execution — with TP / SL / trailing-stop / partial-TP exit management and a built-in web dashboard.

# ALERT
This codebase is in a testing period. The developer does not guarantee any result. Start in `dry_run`, and only trade money you can afford to lose.

## How it works

1. Charon polls the Charon signal server every `SIGNAL_POLL_MS` for fee-claim, graduated, and trending signals.
2. The active strategy **hard-filters** each candidate: market cap band, holders, top-holder concentration, liquidity floor, volume, swaps, bundler rate, rug ratio, wash-trading flag, fee claims, ATH distance, and position caps.
3. Passing candidates are enriched with token info, Jupiter asset/holders/chart data, saved-wallet exposure, and fxtwitter narrative.
4. The **rule engine** scores recent candidates 0–100 with hard-coded rules and picks at most one `BUY` when the best score clears the strategy's `min_score`.
5. Approved buys route through `dry_run`, `confirm`, or `live` mode.
6. Open positions are monitored every `POSITION_CHECK_MS` for stop loss, take profit, trailing stop, partial TP, and max hold time.

## Rule engine (no LLM)

Screening is fully deterministic — no API keys, no latency, no non-reproducible decisions. Every candidate starts at a base score of 50 and hard-coded rules add or subtract points:

| Signal | Effect |
|---|---|
| Holder count (≥500 / ≥250 / ≥100 / <100) | +10 / +6 / +2 / −6 |
| Max single holder (≤5% / ≤10% / >15% / >25%) | +8 / +4 / −8 / −15 |
| Top-20 concentration (≤40% / ≥70%) | +6 / −10 |
| Bundler rate (≤10% / ≤20% / >35% / >50%) | +8 / +4 / −10 / −20 |
| Rug ratio (≤10% / >30%) | +6 / −12 |
| Wash-trading flag | −30 |
| Volume ($50k+ / $20k+ / $10k+ / <$5k) | +8 / +5 / +2 / −4 |
| Swaps (≥500 / ≥200) | +5 / +2 |
| Smart degens holding (≥3 / ≥1) | +6 / +3 |
| Creator fee claim (≥5 SOL / ≥1 SOL) | +8 / +5 |
| Total trading fees ≥10 SOL | +4 |
| Liquidity/mcap ratio (≥15% / <5%) | +5 / −8 |
| Near ATH (within 10%) / top-blast risk | −8 / −10 |
| Dip zone (25–60% below ATH) | +4 |
| Signal confluence (3 sources / 2 sources) | +10 / +6 |
| Saved wallet holding | +5 |

The final score is clamped to 0–100. A candidate buys only when its score ≥ the strategy's `min_score`, so every decision is explainable — the scoring reasons are logged with each decision and shown in the Telegram alert.

The scoring rules live in [src/pipeline/ruleEngine.js](src/pipeline/ruleEngine.js); `min_score` is tunable per strategy (`/stratset trencher min_score 70`).

## Strategies

Switch with `/strategy <id>` in Telegram. Tune any key with `/stratset <id> <key> <value>`. Configs are stored in SQLite and hot-read — menu changes apply without restart.

| | trencher (default) | sniper | dip_buy | smart_money | degen |
|---|---|---|---|---|---|
| Mcap band | $15k–150k | $7k–200k | $25k–500k | $10k–1M | $5k–100k |
| Min holders | 200 | – | – | 1000 | – |
| Max top holder | 15% | – | – | 50% | – |
| Min liquidity | $10k | $5k | $5k | $10k | – |
| Min trend volume / swaps | $15k / 250 | – | – | $5k / 100 | – |
| Max bundler rate | 30% | 50% | 50% | 30% | 70% |
| Max rug ratio | 25% | 30% | 30% | 20% | 50% |
| Min score | 65 | 60 | 60 | 70 | 55 |
| Size | 0.05 SOL | 0.1 SOL | 0.05 SOL | 0.1 SOL | 0.05 SOL |
| TP (arms trailing) | +40% | +50% | +30% | +100% | +30% |
| SL | −20% | −25% | −20% | −25% | −15% |
| Trailing stop | 15% | 20% | 15% | off | 10% |
| Partial TP | 50% @ +60% | off | off | 50% @ +100% | off |
| Max hold | 45m | off | off | off | off |

### Trencher exit logic

The default `trencher` strategy is tuned for post-graduation Pump runners with real holder distribution and volume:

- **Entry gates**: ≥200 holders, no single wallet above 15%, ≥$10k liquidity, ≥$15k trending volume with ≥250 swaps, bundler rate ≤30%, rug ratio ≤25%, mcap $15k–150k, at least 2 overlapping signals.
- **SL −20%** — thesis is wrong, cut fast. Trench tokens rarely recover a −20% dump.
- **TP +40% arms the trailing stop** — it does not sell; from there the position rides the trend.
- **Trailing 15%** — sells when price drops 15% from its high-water mark, capturing runners without round-tripping back to zero.
- **Partial TP: sell 50% at +60%** — de-risks the position; the remainder is house money riding the trailing stop.
- **Max hold 45m** — in the trenches, dead momentum is an exit signal; capital rotates to the next candidate.

## Access

Charon requires a signal server URL and API key. The signal server aggregates fee-claim, graduated, and trending data from Pump.fun in real time — without it Charon has nothing to screen. To get access, contact the maintainer.

## Install

Requires Node.js 20+.

```bash
git clone git@github.com:yunus-0x/charon.git
cd charon
npm install
cp .env.example .env
# edit .env, then:
npm start
```

### Required config

```env
TELEGRAM_BOT_TOKEN=        # from @BotFather
TELEGRAM_CHAT_ID=          # chat/group ID that controls the bot
SIGNAL_SERVER_URL=https://api.thecharon.xyz/api
SIGNAL_SERVER_KEY=         # see Access above
HELIUS_API_KEY=            # or set SOLANA_RPC_URL + SOLANA_WS_URL
```

GMGN enrichment is optional — set `GMGN_ENABLED=false` to fall back to Jupiter/server data.

## Execution modes

```env
TRADING_MODE=dry_run
```

- `dry_run`: stores simulated buys/sells in SQLite. No wallet needed.
- `confirm`: sends a Telegram trade intent with approve/reject buttons. Executes live only after you confirm.
- `live`: signs and executes Jupiter Ultra swaps immediately after strategy and rule-engine approval.

Live and confirm modes require:

```env
SOLANA_PRIVATE_KEY=
JUPITER_API_KEY=
JUPITER_SWAP_BASE_URL=https://api.jup.ag/swap/v2
LIVE_MIN_SOL_RESERVE=0.02
```

`LIVE_MIN_SOL_RESERVE` is the minimum SOL kept in the wallet after any buy — Charon refuses to execute if the balance would fall below it. Swaps use Jupiter Ultra mode; slippage and routing are handled by Jupiter.

## Dashboard

Charon serves a web dashboard: a PnL card (total / realized / unrealized / 24h PnL, win rate, trade counts), an equity curve, open positions with live PnL and TP/SL/trailing state, recent closed trades, the candidate feed with filter-failure reasons, and the active strategy config. Auto-refreshes every 10 seconds.

```env
DASHBOARD_ENABLED=true
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=8787
DASHBOARD_TOKEN=           # required if you expose it publicly
```

By default it binds to `127.0.0.1`. From your machine, reach a VPS dashboard through an SSH tunnel:

```bash
ssh -L 8787:127.0.0.1:8787 user@your-vps
# then open http://localhost:8787
```

To expose it directly instead, set `DASHBOARD_HOST=0.0.0.0` **and** a strong `DASHBOARD_TOKEN`, then open `http://your-vps:8787/?token=YOUR_TOKEN`.

JSON API: `/api/overview`, `/api/positions?status=open|closed&limit=50`, `/api/candidates?limit=30` (same token rules).

## Telegram commands

| Command | Description |
|---|---|
| `/menu` | Main menu with inline controls |
| `/strategy [id]` | Show or switch strategy |
| `/stratset <id> <key> <value>` | Set a strategy key (e.g. `/stratset trencher sl_percent -15`) |
| `/positions` | List positions |
| `/candidate <mint>` | Inspect a candidate |
| `/filters` · `/setfilter <key> <value>` | Show / set global filters |
| `/pnl` | Saved-wallet PnL |
| `/learn [window]` · `/lessons` | Heuristic report over closed trades |
| `/walletadd` · `/walletremove` · `/wallets` | Saved wallets for exposure tracking |

Trading mode, agent on/off, position caps, batch size, and per-position TP/SL/trailing are all adjustable from `/menu`.

## VPS deployment

Tested on Ubuntu 22.04/24.04; any Linux with Node 20+ works.

### 1. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

### 2. Set up Charon

```bash
git clone git@github.com:yunus-0x/charon.git
cd charon
npm install --omit=dev
cp .env.example .env
nano .env      # fill in tokens/keys; keep TRADING_MODE=dry_run at first
chmod 600 .env
```

### 3a. Run with PM2 (recommended)

```bash
sudo npm install -g pm2
pm2 start index.js --name charon
pm2 save
pm2 startup    # run the printed command so charon survives reboots
```

Day-to-day:

```bash
pm2 logs charon        # follow logs
pm2 restart charon     # restart after .env/code changes
pm2 monit              # live process monitor
```

### 3b. Or run with systemd

```ini
# /etc/systemd/system/charon.service
[Unit]
Description=Charon trench agent
After=network-online.target

[Service]
WorkingDirectory=/home/ubuntu/charon
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
User=ubuntu

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now charon
journalctl -u charon -f
```

### 4. Updating

```bash
cd charon && git pull && npm install --omit=dev
pm2 restart charon     # or: sudo systemctl restart charon
```

### 5. Backup

All state (settings, strategies, candidates, positions, trades) lives in one SQLite file. Open positions resume monitoring after restart.

```bash
mkdir -p backups && cp charon.sqlite backups/charon-$(date +%F).sqlite
```

## Security notes

- `SOLANA_PRIVATE_KEY` sits in plaintext in `.env` — use a dedicated hot wallet holding only what the bot trades, and `chmod 600 .env`.
- Keep the dashboard on `127.0.0.1` + SSH tunnel unless you set a strong `DASHBOARD_TOKEN`.
- Only messages from `TELEGRAM_CHAT_ID` are processed; keep that chat private.
- Go live in steps: `dry_run` → `confirm` (manual approval per trade) → `live`, and verify dry-run stats on the dashboard first.

## API usage notes

- **GMGN**: rate-limited. Keep `GMGN_REQUEST_DELAY_MS=2500` or higher; lowering it or running many instances will get your key banned.
- **Jupiter**: called per candidate and per position refresh. At high throughput you may hit 429s — Charon backs off and retries from cache.
- **Helius RPC**: position monitoring polls every `POSITION_CHECK_MS` (default 10s). Use a paid plan for live trading; the free tier throttles under load.

## Config reloading

SQLite/menu settings (strategies, filters, mode) are hot-read. API keys, wallet key, RPC URLs, dashboard settings, and polling intervals are `.env` values and require a restart.

## Verification

```bash
npm run check
```
