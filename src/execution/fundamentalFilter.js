// src/execution/fundamentalFilter.js
// Pre-entry fundamental checks for token quality.
// Layer 1 of 2 (fundamental + chart).
//
// Data sources:
//   - candidate.trending.organicScore (Jupiter toptrending hot_level proxy)
//   - candidate.trending.numOrganicBuyers (smart degen count)
//   - candidate.graduation.sniperCount
//   - candidate.graduation.topHoldersPercent (top 10 holders %)
//   - candidate.graduation.devHoldingsPercent
//   - candidate.metrics.{liquidityUsd, holderCount, marketCapUsd}
//   - candidate.trending.{trendingVolumeUsd, swaps}
//
// Strategy config keys:
//   min_organic_score             (number, default 50)
//   organic_score_null_fallback   (bool, default true)
//   avoid_sniper_range_low        (number, default 5)
//   avoid_sniper_range_high       (number, default 20)
//   min_holders                   (existing)
//   max_top20_holder_percent      (existing)
//   min_mcap_usd / max_mcap_usd   (existing)
//   min_liquidity_usd             (existing)
//   trending_min_volume_usd       (existing)
//   trending_min_swaps            (existing)

import { fetchGmgnTokenInfo } from '../enrichment/gmgn.js';

/**
 * Run all fundamental checks against a candidate.
 * @param {Object} candidate - normalized candidate with metrics/trending/graduation blocks
 * @param {Object} strategyConfig - active strategy config
 * @returns {Promise<{pass: boolean, checks: Array, summary: Object}>}
 */
export async function evaluateFundamentalFilters(candidate, strategyConfig) {
  const checks = [];

  const metrics = candidate.metrics || candidate || {};
  const trending = candidate.trending || {};
  const graduation = candidate.graduation || {};

  // --- MCap range ---
  const mcap = Number(metrics.marketCapUsd ?? metrics.market_cap ?? metrics.mcap ?? 0);
  const minMcap = Number(strategyConfig.min_mcap_usd ?? 15000);
  const maxMcap = Number(strategyConfig.max_mcap_usd ?? 150000);
  checks.push({
    name: 'mcap_range',
    pass: mcap >= minMcap && mcap <= maxMcap,
    value: mcap,
    bounds: [minMcap, maxMcap],
  });

  // --- Holders ---
  const holders = Number(metrics.holderCount ?? metrics.holder_count ?? graduation.numHolders ?? 0);
  const minHolders = Number(strategyConfig.min_holders ?? 100);
  checks.push({
    name: 'min_holders',
    pass: holders >= minHolders,
    value: holders,
    threshold: minHolders,
  });

  // --- Top 20 holders ---
  // candidate.graduation.topHoldersPercent is in percent units (0-100)
  const top20 = Number(graduation.topHoldersPercent ?? metrics.top_20_holder_rate * 100 ?? 0);
  const maxTop20 = Number(strategyConfig.max_top20_holder_percent ?? 60);
  checks.push({
    name: 'max_top20_holder_percent',
    pass: top20 <= maxTop20,
    value: top20,
    threshold: maxTop20,
  });

  // --- Organic score (with NULL fallback per Option B) ---
  // organicScore comes from Jupiter toptrending hot_level proxy.
  // When source is NOT Jupiter (e.g. Axiom), field is NULL.
  // Configurable: allow NULL to pass (fallback) or strict reject.
  const organicRaw = trending.organicScore;
  const organic = organicRaw == null ? null : Number(organicRaw);
  const minOrganic = Number(strategyConfig.min_organic_score ?? 50);
  const nullFallback = strategyConfig.organic_score_null_fallback !== false; // default true

  let organicPass;
  if (organic === null || organic === undefined || !Number.isFinite(organic)) {
    organicPass = nullFallback;
  } else {
    organicPass = organic >= minOrganic;
  }
  checks.push({
    name: 'min_organic_score',
    pass: organicPass,
    value: organic ?? 'NULL',
    threshold: minOrganic,
    null_fallback: nullFallback,
  });

  // --- Sniper pump-and-dump zone avoidance ---
  // Counterintuitive finding: tokens with sniper_count in 5-20 range have 40% WR (worst).
  // Extreme low (< 5) or extreme high (> 20) = 67% WR (best).
  // So we reject tokens in the "dead zone" 5 <= sniper <= 20.
  const sniperCount = Number(graduation.sniperCount ?? metrics.sniper_count ?? 0);
  const snipeLow = Number(strategyConfig.avoid_sniper_range_low ?? 5);
  const snipeHigh = Number(strategyConfig.avoid_sniper_range_high ?? 20);
  const inDeadZone = sniperCount >= snipeLow && sniperCount <= snipeHigh;
  checks.push({
    name: 'sniper_pump_dump_zone',
    pass: !inDeadZone,
    value: sniperCount,
    dead_zone: [snipeLow, snipeHigh],
  });

  // --- Liquidity ---
  const liquidity = Number(metrics.liquidityUsd ?? metrics.liquidity ?? 0);
  const minLiquidity = Number(strategyConfig.min_liquidity_usd ?? 10000);
  checks.push({
    name: 'min_liquidity',
    pass: liquidity >= minLiquidity,
    value: liquidity,
    threshold: minLiquidity,
  });

  // --- Trending volume (existing config) ---
  const trendingVol = Number(metrics.trendingVolumeUsd ?? metrics.volume ?? 0);
  const minTrendingVol = Number(strategyConfig.trending_min_volume_usd ?? 15000);
  checks.push({
    name: 'trending_min_volume',
    pass: trendingVol >= minTrendingVol,
    value: trendingVol,
    threshold: minTrendingVol,
  });

  // --- Trending swaps ---
  const trendingSwaps = Number(metrics.trendingSwaps ?? metrics.swaps ?? 0);
  const minSwaps = Number(strategyConfig.trending_min_swaps ?? 250);
  checks.push({
    name: 'trending_min_swaps',
    pass: trendingSwaps >= minSwaps,
    value: trendingSwaps,
    threshold: minSwaps,
  });

  return {
    pass: checks.every(c => c.pass),
    checks,
    failed: checks.filter(c => !c.pass),
    passed: checks.filter(c => c.pass),
    summary: {
      mcap,
      holders,
      top20,
      organic: organic ?? null,
      sniper: sniperCount,
      liquidity,
      trendingVol,
      trendingSwaps,
    },
  };
}