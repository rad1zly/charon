import { numSetting } from '../db/settings.js';
import { activeStrategy } from '../db/settings.js';

// Deterministic, hard-coded candidate scoring. Replaces the old LLM screener.
// Every rule adds or subtracts points from a base of 50; the final score is
// clamped to 0-100 and compared against the strategy's min_score gate.

const NEAR_ATH_PERCENT = -10;
const DIP_ZONE_MIN = -60;
const DIP_ZONE_MAX = -25;

export function scoreCandidate(candidate) {
  const reasons = [];
  const risks = [];
  let score = 50;
  const add = (points, label) => {
    score += points;
    if (points > 0) reasons.push(`+${points} ${label}`);
    else risks.push(`${points} ${label}`);
  };

  const m = candidate.metrics || {};
  const t = candidate.trending || null;
  const holders = candidate.holders || {};
  const holderCount = Number(m.holderCount || 0);
  const maxHolder = Number(holders.maxHolderPercent);
  const top20 = Number(holders.top20Percent);
  const bundlerRate = t ? Number(t.bundler_rate ?? NaN) : NaN;
  const rugRatio = t ? Number(t.rug_ratio ?? NaN) : NaN;
  const volume = Math.max(Number(m.trendingVolumeUsd || 0), Number(m.graduatedVolumeUsd || 0));
  const swaps = Number(m.trendingSwaps || 0);
  const smartDegens = Number(m.trendingSmartDegenCount || 0);
  const hotLevel = Number(m.trendingHotLevel || 0);
  const feeClaimSol = Number(candidate.feeClaim?.distributedSol || 0);
  const totalFeesSol = Number(m.gmgnTotalFeesSol || 0);
  const liquidity = Number(m.liquidityUsd || 0);
  const mcap = Number(m.marketCapUsd || 0);
  const savedHolders = Number(candidate.savedWalletExposure?.holderCount || 0);
  const sourceCount = ['hasFeeClaim', 'hasGraduated', 'hasTrending'].filter(key => candidate.signals?.[key]).length;

  const sniperCount = Number(candidate.graduation?.sniperCount ?? NaN);

  // Holder distribution — dry-run showed a sweet spot at 500-1200, not "more is better".
  // >1500 holders underperformed (late/topped tokens), <300 was thin.
  if (holderCount >= 500 && holderCount <= 1200) add(10, `holders ${holderCount} (sweet spot)`);
  else if (holderCount > 1200 && holderCount <= 1600) add(3, `holders ${holderCount}`);
  else if (holderCount > 1600) add(-6, `holders ${holderCount} (likely late/topped)`);
  else if (holderCount >= 300) add(4, `holders ${holderCount}`);
  else if (holderCount > 0) add(-6, `thin holder base (${holderCount})`);

  if (Number.isFinite(maxHolder)) {
    if (maxHolder <= 5) add(8, `max holder ${maxHolder.toFixed(1)}%`);
    else if (maxHolder <= 10) add(4, `max holder ${maxHolder.toFixed(1)}%`);
    else if (maxHolder > 25) add(-15, `whale holds ${maxHolder.toFixed(1)}%`);
    else if (maxHolder > 15) add(-8, `top holder ${maxHolder.toFixed(1)}%`);
  }
  if (Number.isFinite(top20)) {
    if (top20 <= 40) add(6, `top20 ${top20.toFixed(0)}%`);
    else if (top20 >= 70) add(-10, `top20 concentration ${top20.toFixed(0)}%`);
  }

  // Bundler / rug signals
  if (Number.isFinite(bundlerRate)) {
    if (bundlerRate <= 0.10) add(8, `bundler rate ${(bundlerRate * 100).toFixed(0)}%`);
    else if (bundlerRate <= 0.20) add(4, `bundler rate ${(bundlerRate * 100).toFixed(0)}%`);
    else if (bundlerRate > 0.50) add(-20, `bundler rate ${(bundlerRate * 100).toFixed(0)}%`);
    else if (bundlerRate > 0.35) add(-10, `bundler rate ${(bundlerRate * 100).toFixed(0)}%`);
  }
  if (Number.isFinite(rugRatio)) {
    if (rugRatio <= 0.10) add(6, `rug ratio ${(rugRatio * 100).toFixed(0)}%`);
    else if (rugRatio > 0.30) add(-12, `rug ratio ${(rugRatio * 100).toFixed(0)}%`);
  }
  if (t && (t.is_wash_trading === true || t.is_wash_trading === 1)) add(-30, 'wash trading flag');

  // Swaps — the strongest discriminator in the dry-run. 500-1500 was the sweet spot
  // (59% win, +3.4% avg). Under 500 = illiquid churn; over 1500 = already pumped/late.
  if (swaps >= 500 && swaps <= 1500) add(10, `${swaps} swaps (sweet spot)`);
  else if (swaps > 1500 && swaps <= 2200) add(-4, `${swaps} swaps (late)`);
  else if (swaps > 2200) add(-8, `${swaps} swaps (overheated)`);
  else if (swaps >= 250) add(-2, `${swaps} swaps (thin)`);
  else if (t) add(-6, `${swaps} swaps (illiquid)`);

  // Volume — flat/no edge across buckets in the dry-run, so keep it light.
  if (volume >= 20_000 && volume <= 60_000) add(3, `volume $${Math.round(volume / 1000)}k`);
  else if (volume > 0 && volume < 10_000 && t) add(-3, `low volume $${Math.round(volume / 1000)}k`);

  // Sniper count (graduated tokens) — 30-90 snipers was the best band (up to 65% win).
  // Too few = no interest; too many = bundled snipers that dump together.
  if (Number.isFinite(sniperCount)) {
    if (sniperCount >= 30 && sniperCount <= 90) add(8, `${sniperCount} snipers (sweet spot)`);
    else if (sniperCount > 90 && sniperCount <= 130) add(-6, `${sniperCount} snipers (crowded)`);
    else if (sniperCount > 130) add(-3, `${sniperCount} snipers`);
    else if (sniperCount < 25) add(-8, `${sniperCount} snipers (low interest)`);
  }

  if (smartDegens >= 3) add(6, `${smartDegens} smart degens`);
  else if (smartDegens >= 1) add(3, `${smartDegens} smart degen`);
  if (hotLevel >= 2) add(3, `hot level ${hotLevel}`);

  // Entry mcap — buying above ~$110k was consistently late (36% win, -8.8% avg).
  if (mcap > 120_000) add(-10, `entry mcap $${Math.round(mcap / 1000)}k (late)`);
  else if (mcap > 100_000) add(-4, `entry mcap $${Math.round(mcap / 1000)}k`);

  // Creator conviction (fee claims)
  if (feeClaimSol >= 5) add(8, `fee claim ${feeClaimSol.toFixed(1)} SOL`);
  else if (feeClaimSol >= 1) add(5, `fee claim ${feeClaimSol.toFixed(1)} SOL`);
  if (totalFeesSol >= 10) add(4, `total fees ${totalFeesSol.toFixed(0)} SOL`);

  // Liquidity depth relative to market cap
  if (liquidity > 0 && mcap > 0) {
    const ratio = liquidity / mcap;
    if (ratio >= 0.15) add(5, `liq/mcap ${(ratio * 100).toFixed(0)}%`);
    else if (ratio < 0.05) add(-8, `thin liquidity ${(ratio * 100).toFixed(0)}% of mcap`);
  }

  // Entry timing vs ATH
  const athDistance = Number(candidate.chart?.distanceFromAthPercent ?? candidate.chart?.belowRangeHighPercent ?? NaN);
  if (Number.isFinite(athDistance)) {
    if (athDistance > NEAR_ATH_PERCENT) add(-8, `near ATH (${athDistance.toFixed(0)}%)`);
    else if (athDistance >= DIP_ZONE_MIN && athDistance <= DIP_ZONE_MAX) add(4, `dip zone (${athDistance.toFixed(0)}% from ATH)`);
  }
  if (candidate.chart?.topBlastRisk) add(-10, 'top blast risk');

  // Confluence
  if (sourceCount >= 3) add(10, 'triple signal confluence');
  else if (sourceCount === 2) add(6, 'double signal confluence');
  if (savedHolders >= 1) add(5, `${savedHolders} saved wallet(s) holding`);

  // Supertrend (GeckoTerminal OHLCV) — soft signal by default; only hard-gated when a
  // strategy sets require_supertrend_bullish. Missing data (common pre-graduation, since
  // bonding-curve tokens have no AMM pool yet) is scored neutral, not penalized.
  const st = candidate.supertrend;
  if (st?.available) {
    if (st.trend === 'bullish' && st.justFlippedBullish) add(12, 'supertrend just flipped bullish');
    else if (st.trend === 'bullish') add(5, 'supertrend bullish');
    else if (st.trend === 'bearish' && st.justFlippedBearish) add(-6, 'supertrend just flipped bearish');
    else if (st.trend === 'bearish') add(-10, 'supertrend bearish');
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    risks,
  };
}

export function minScoreFor(strat) {
  return Number(strat.min_score ?? strat.llm_min_confidence ?? numSetting('min_score', 60));
}

// Same decision shape the orchestrator used with the LLM screener.
export function decideCandidateBatch(rows, triggerCandidateId) {
  const strat = activeStrategy();
  const minScore = minScoreFor(strat);
  const scored = rows
    .filter(row => row.candidate?.filters?.passed)
    .map(row => ({ row, ...scoreCandidate(row.candidate) }))
    .sort((a, b) => b.score - a.score);

  const empty = {
    selected_candidate_id: null,
    selected_mint: null,
    selected_row: null,
    suggested_tp_percent: strat.tp_percent ?? numSetting('default_tp_percent', 50),
    suggested_sl_percent: strat.sl_percent ?? numSetting('default_sl_percent', -25),
  };

  if (!scored.length) {
    return {
      ...empty,
      verdict: 'PASS',
      confidence: 0,
      reason: 'No candidates passed strategy filters.',
      risks: [],
      raw: { engine: 'rules', minScore, scored: [] },
    };
  }

  const best = scored[0];
  const summary = `Score ${best.score}/${minScore} — ${best.reasons.slice(0, 5).join(', ') || 'no positive signals'}`;
  const raw = {
    engine: 'rules',
    minScore,
    triggerCandidateId,
    scored: scored.map(item => ({ candidateId: item.row.id, mint: item.row.candidate.token?.mint, score: item.score })),
  };

  if (best.score >= minScore) {
    return {
      ...empty,
      verdict: 'BUY',
      confidence: best.score,
      selected_candidate_id: best.row.id,
      selected_mint: best.row.candidate.token.mint,
      selected_row: best.row,
      reason: summary,
      risks: best.risks,
      raw,
    };
  }

  return {
    ...empty,
    verdict: best.score >= minScore - 15 ? 'WATCH' : 'PASS',
    confidence: best.score,
    reason: `Best candidate below min score. ${summary}`,
    risks: best.risks,
    raw,
  };
}
