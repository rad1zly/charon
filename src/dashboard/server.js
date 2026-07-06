import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/connection.js';
import { DASHBOARD_ENABLED, DASHBOARD_HOST, DASHBOARD_PORT, DASHBOARD_TOKEN } from '../config.js';
import { activeStrategy, setting, boolSetting, numSetting } from '../db/settings.js';
import { safeJson } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = path.join(__dirname, '..', '..', 'public', 'dashboard.html');

function authorized(req, url) {
  if (!DASHBOARD_TOKEN) return true;
  const header = req.headers.authorization || '';
  if (header === `Bearer ${DASHBOARD_TOKEN}`) return true;
  return url.searchParams.get('token') === DASHBOARD_TOKEN;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function overview() {
  const closed = db.prepare(`
    SELECT id, mint, symbol, strategy_id, execution_mode, size_sol, pnl_percent, pnl_sol,
           exit_reason, opened_at_ms, closed_at_ms
    FROM dry_run_positions
    WHERE status = 'closed'
    ORDER BY closed_at_ms ASC
  `).all();
  const open = db.prepare(`
    SELECT id, mint, symbol, strategy_id, execution_mode, size_sol, entry_mcap, high_water_mcap,
           pnl_percent, pnl_sol, tp_percent, sl_percent, trailing_enabled, trailing_percent,
           trailing_armed, opened_at_ms
    FROM dry_run_positions
    WHERE status = 'open'
    ORDER BY opened_at_ms DESC
  `).all();

  const wins = closed.filter(p => Number(p.pnl_percent || 0) > 0);
  const losses = closed.filter(p => Number(p.pnl_percent || 0) < 0);
  const realizedPnlSol = closed.reduce((sum, p) => sum + Number(p.pnl_sol || 0), 0);
  const unrealizedPnlSol = open.reduce((sum, p) => sum + Number(p.pnl_sol || 0), 0);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const pnl24hSol = closed.filter(p => Number(p.closed_at_ms || 0) >= dayAgo)
    .reduce((sum, p) => sum + Number(p.pnl_sol || 0), 0);
  const sortedByPnl = [...closed].sort((a, b) => Number(b.pnl_percent || 0) - Number(a.pnl_percent || 0));

  let cumulative = 0;
  const equity = closed.map(p => {
    cumulative += Number(p.pnl_sol || 0);
    return { t: p.closed_at_ms, pnlSol: Number(cumulative.toFixed(6)) };
  });

  const strat = activeStrategy();
  return {
    now: Date.now(),
    mode: setting('trading_mode', 'dry_run'),
    agentEnabled: boolSetting('agent_enabled', true),
    strategy: {
      id: strat.id,
      name: strat.name,
      minScore: strat.min_score ?? numSetting('min_score', 60),
      positionSizeSol: strat.position_size_sol,
      maxOpenPositions: strat.max_open_positions,
      tpPercent: strat.tp_percent,
      slPercent: strat.sl_percent,
      trailingEnabled: Boolean(strat.trailing_enabled),
      trailingPercent: strat.trailing_percent,
      partialTp: Boolean(strat.partial_tp),
      partialTpAtPercent: strat.partial_tp_at_percent,
      partialTpSellPercent: strat.partial_tp_sell_percent,
      maxHoldMs: strat.max_hold_ms,
    },
    pnl: {
      realizedPnlSol,
      unrealizedPnlSol,
      totalPnlSol: realizedPnlSol + unrealizedPnlSol,
      pnl24hSol,
      closedCount: closed.length,
      openCount: open.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length ? (wins.length / closed.length) * 100 : null,
      avgPnlPercent: closed.length
        ? closed.reduce((sum, p) => sum + Number(p.pnl_percent || 0), 0) / closed.length
        : null,
      best: sortedByPnl[0] || null,
      worst: sortedByPnl.length > 1 ? sortedByPnl[sortedByPnl.length - 1] : null,
    },
    equity,
    openPositions: open,
  };
}

function positions(url) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
  const status = url.searchParams.get('status');
  const rows = status
    ? db.prepare('SELECT * FROM dry_run_positions WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM dry_run_positions ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map(row => ({ ...row, snapshot_json: undefined }));
}

function candidates(url) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 30)));
  const rows = db.prepare(`
    SELECT id, mint, status, created_at_ms, filter_result_json, candidate_json
    FROM candidates
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
  return rows.map(row => {
    const candidate = safeJson(row.candidate_json, {});
    const filters = safeJson(row.filter_result_json, {});
    return {
      id: row.id,
      mint: row.mint,
      status: row.status,
      createdAtMs: row.created_at_ms,
      symbol: candidate.token?.symbol || '',
      name: candidate.token?.name || '',
      route: candidate.signals?.label || candidate.signals?.route || '',
      marketCapUsd: candidate.metrics?.marketCapUsd ?? null,
      liquidityUsd: candidate.metrics?.liquidityUsd ?? null,
      holderCount: candidate.metrics?.holderCount ?? null,
      passed: Boolean(filters.passed),
      failures: filters.failures || [],
      supertrend: candidate.supertrend?.available
        ? { trend: candidate.supertrend.trend, justFlipped: Boolean(candidate.supertrend.justFlippedBullish || candidate.supertrend.justFlippedBearish), source: candidate.supertrend.source }
        : { trend: null, reason: candidate.supertrend?.reason || 'no data' },
    };
  });
}

export function startDashboard() {
  if (!DASHBOARD_ENABLED) return null;
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (!authorized(req, url)) return sendJson(res, 401, { error: 'unauthorized' });

      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(readFileSync(PAGE_PATH));
      }
      if (url.pathname === '/api/overview') return sendJson(res, 200, overview());
      if (url.pathname === '/api/positions') return sendJson(res, 200, positions(url));
      if (url.pathname === '/api/candidates') return sendJson(res, 200, candidates(url));
      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      console.log(`[dashboard] ${err.message}`);
      return sendJson(res, 500, { error: err.message });
    }
  });
  server.listen(DASHBOARD_PORT, DASHBOARD_HOST, () => {
    console.log(`[dashboard] listening on http://${DASHBOARD_HOST}:${DASHBOARD_PORT}${DASHBOARD_TOKEN ? ' (token required)' : ''}`);
  });
  server.on('error', err => console.log(`[dashboard] server error: ${err.message}`));
  return server;
}
