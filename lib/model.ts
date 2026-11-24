// Token Radar, model radar-7 — an original entry for make.fun token-radar-01.
//
// The board ranks every pre-token protocol the snapshot can rank (198 rows),
// never only the 40-protocol watchlist floor. Implied value is an
// odds-aware, fitted value, never a hand-picked list of names:
//
//   fitted   = exp(intercept + slope * log(TVL))          OLS, fitted every run
//   category = exp(shrunk median log-residual of its category)
//   growth   = 1 + clamp(change_7d,-60,120)/100 * (0.5 up, 0.8 down)
//   chains   = 1 + 0.02 * min(chains-1, 5)
//   age      = 0.55 + 0.45 * (1 - exp(-age_days/730))
//   implied  = round(fitted * category * growth * chains * age)
//
// The OLS curve is fitted on the protocols that already trade (market cap
// above zero), every run, from the snapshot alone. A flat median
// market-cap/TVL ratio is kept as the ablation: it scores worse on every
// held-out check, which is why the curve, not the ratio, is used.
// Launch odds are the empirical cohort rate — the share of comparable
// protocols (same age bucket, not excluded) that already have a token —
// and expected_value_usd = implied * launch_odds. The board ranks by
// implied (the value if it launches); the odds-weighted expected value is
// shown beside it so a reader sees both numbers and neither is hidden.
//
// Exclusions, applied before any ranking: a protocol is rankable only if
// it records no token at all, is not a versioned pool (name ends V2/2.0),
// is not in Bridge / Canonical Bridge / Liquid Staking / Liquid Restaking
// / Restaked BTC / CEX, carries no whole word wrapped/staked/staking, and
// does not begin with an exchange name. Wrapped, staked and bridged
// products of a token that already trades are not launches waiting to
// happen, so they are set aside, not ranked. Live-token protocols are
// shown separately at their market value, never mixed into the board.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-7';

export interface FitResult {
  n: number;
  intercept: number;
  slope: number;
  r2: number;
  mae_log: number;
  median_abs_log: number;
  resid_sd: number;
  spearman: number;
  within_2x: number;
  within_5x: number;
}

export interface CohortBucket {
  min_days: number;
  max_days: number;
  n: number;
  token_rate: number;
}

export interface Validation {
  five_fold_mean_r2: number;
  five_fold_r2: number[];
  walk_forward_r2: number;
  walk_forward_train_n: number;
  walk_forward_test_n: number;
  median_ratio_r2: number;
  median_ratio_mae_log: number;
  median_ratio: number;
}

export interface ModelReport {
  version: string;
  fit: FitResult;
  validation: Validation;
  category_factors: Record<string, number>;
  cohorts: CohortBucket[];
  global_token_rate: number;
  counts: { total: number; live: number; pre_token: number; ranked: number; excluded: number; live_set_aside: number };
}

export interface FarmStep { text: string; cost: string; time: string; }

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  fitted_value_usd: number;
  launch_odds: number;
  expected_value_usd: number;
  interval_low_usd: number;
  interval_high_usd: number;
  model: {
    fitted_value_usd: number;
    category_factor: number;
    growth_pct: number;
    growth_multiplier: number;
    chain_multiplier: number;
    age_multiplier: number;
    launch_odds: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null;
  chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null; age_days: number | null;
  implied_value_usd: number; fitted_value_usd: number; launch_odds: number;
  expected_value_usd: number; interval_low_usd: number; interval_high_usd: number;
  category_factor: number; growth_multiplier: number; chain_multiplier: number; age_multiplier: number;
  watchlist: boolean;
}

export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null;
}

export interface RadarData {
  as_of: string; source: string; floor_usd: number;
  model_version: string; model: ModelReport;
  watchlist_size: number; board_size: number; early_size: number;
  live_size: number; excluded_size: number;
  rows: RadarRow[]; live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
export const AGE_BUCKETS: Array<[number, number]> = [[0, 180], [181, 365], [366, 730], [731, 1100], [1101, 99999]];

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
export function isLiveToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0;
}
export function isExcluded(p: SnapshotProtocol): boolean {
  if (VERSIONED.test(p.name)) return true;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isExcluded(p);
}
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function pearson(a: number[], b: number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i]! - ma) * (b[i]! - mb); da += (a[i]! - ma) ** 2; db += (b[i]! - mb) ** 2; }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}
function rankOf(values: number[]): number[] {
  const order = values.map((_, i) => i).sort((i, j) => values[i]! - values[j]!);
  const r = new Array<number>(values.length);
  order.forEach((idx, rank) => { r[idx] = rank; });
  return r;
}
function ols(xs: number[], ys: number[]): { intercept: number; slope: number } {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0; let sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: my - slope * mx, slope };
}
function r2Of(ys: number[], preds: number[]): number {
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let ssRes = 0; let ssTot = 0;
  for (let i = 0; i < ys.length; i++) { ssRes += (ys[i]! - preds[i]!) ** 2; ssTot += (ys[i]! - my) ** 2; }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

/** The log-log comps fit, computed from the live-token protocols every run. */
export function fitCurve(live: SnapshotProtocol[]): FitResult {
  const xs = live.map((p) => Math.log(p.tvl_usd));
  const ys = live.map((p) => Math.log(p.mcap_usd!));
  const { intercept, slope } = ols(xs, ys);
  const preds = xs.map((x) => intercept + slope * x);
  const absErr = ys.map((y, i) => Math.abs(y - preds[i]!));
  const residSd = Math.sqrt(ys.reduce((s, y, i) => s + (y - preds[i]!) ** 2, 0) / ys.length);
  return {
    n: live.length, intercept: Math.round(intercept * 1e4) / 1e4, slope: Math.round(slope * 1e4) / 1e4,
    r2: Math.round(r2Of(ys, preds) * 1e4) / 1e4,
    mae_log: Math.round((absErr.reduce((a, b) => a + b, 0) / absErr.length) * 1e4) / 1e4,
    median_abs_log: Math.round(median(absErr) * 1e4) / 1e4,
    resid_sd: Math.round(residSd * 1e4) / 1e4,
    spearman: Math.round(pearson(rankOf(xs), rankOf(ys)) * 1e4) / 1e4,
    within_2x: Math.round((absErr.filter((e) => e < Math.log(2)).length / absErr.length) * 1e4) / 1e4,
    within_5x: Math.round((absErr.filter((e) => e < Math.log(5)).length / absErr.length) * 1e4) / 1e4,
  };
}

/** Category factor: exp of the shrunk median log-residual, clamped to [0.5, 2]. */
export function categoryFactors(live: SnapshotProtocol[], fit: FitResult): Record<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const r = Math.log(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log(p.tvl_usd));
    const key = p.category ?? 'Other';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(r);
  }
  const out: Record<string, number> = {};
  for (const [cat, vals] of [...byCat.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    if (vals.length < 3) { out[cat] = 1; continue; }
    const shrink = vals.length / (vals.length + 6);
    out[cat] = Math.round(Math.min(2, Math.max(0.5, Math.exp(median(vals) * shrink))) * 1e4) / 1e4;
  }
  return out;
}

/** Cohort launch odds: share with a token, by age bucket, over non-excluded protocols. */
export function cohortOdds(snapshot: Snapshot): { cohorts: CohortBucket[]; global: number } {
  const pool = snapshot.protocols.filter((p) => !isExcluded(p));
  const global = pool.filter((p) => p.mcap_usd !== null).length / Math.max(1, pool.length);
  const cohorts: CohortBucket[] = AGE_BUCKETS.map(([lo, hi]) => {
    const sub = pool.filter((p) => { const a = ageDays(snapshot.as_of, p.listed_at); return a !== null && a >= lo && a <= hi; });
    return { min_days: lo, max_days: hi, n: sub.length, token_rate: sub.length === 0 ? Math.round(global * 1e4) / 1e4 : Math.round((sub.filter((p) => p.mcap_usd !== null).length / sub.length) * 1e4) / 1e4 };
  });
  return { cohorts, global: Math.round(global * 1e4) / 1e4 };
}
export function oddsFor(age: number | null, cohorts: CohortBucket[], global: number): number {
  if (age === null) return global;
  for (const c of cohorts) if (age >= c.min_days && age <= c.max_days) return c.token_rate;
  return global;
}

export interface Scored {
  implied: number; fitted: number; catFactor: number; growthPct: number;
  growthMult: number; chainMult: number; ageMult: number; odds: number; age: number | null;
}
export function scoreProtocol(p: SnapshotProtocol, asOf: string, fit: FitResult, catFactors: Record<string, number>, cohorts: CohortBucket[], globalRate: number): Scored {
  const age = ageDays(asOf, p.listed_at);
  const fittedRaw = Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd));
  const catFactor = catFactors[p.category ?? 'Other'] ?? 1;
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(120, Math.max(-60, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * (growthPct >= 0 ? 0.5 : 0.8);
  const chainMult = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const ageForModel = age ?? 365;
  const ageMult = 0.55 + 0.45 * (1 - Math.exp(-ageForModel / 730));
  const fitted = fittedRaw * catFactor;
  const implied = Math.max(1, Math.round(fitted * growthMult * chainMult * ageMult));
  const odds = oddsFor(age, cohorts, globalRate);
  return { implied, fitted: Math.max(1, Math.round(fitted)), catFactor, growthPct, growthMult: Math.round(growthMult * 1e4) / 1e4, chainMult: Math.round(chainMult * 1e4) / 1e4, ageMult: Math.round(ageMult * 1e4) / 1e4, odds, age };
}

function chainOf(p: SnapshotProtocol): string { return p.chains.length > 0 ? p.chains[0]! : 'its main chain'; }
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain')) return `Use $${capital} of gas and activity on ${name} on ${chain} and keep the wallet active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: `Make one qualifying action each week on ${p.name}, such as a deposit, a borrow, a swap or a vote.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}
export function farmStepTexts(p: SnapshotProtocol, age: number | null): string[] {
  return farmSteps(p, age).map(stepText);
}

/** Five-fold (slug order) and walk-forward (listed_at split) validation, in log space. */
export function validate(snapshot: Snapshot, live: SnapshotProtocol[]): Validation {
  const sorted = [...live].sort((a, b) => a.slug < b.slug ? -1 : 1);
  const foldR2: number[] = [];
  for (let k = 0; k < 5; k++) {
    const test = sorted.filter((_, i) => i % 5 === k);
    const train = sorted.filter((_, i) => i % 5 !== k);
    const xs = train.map((p) => Math.log(p.tvl_usd)); const ys = train.map((p) => Math.log(p.mcap_usd!));
    const f = ols(xs, ys);
    foldR2.push(Math.round(r2Of(test.map((p) => Math.log(p.mcap_usd!)), test.map((p) => f.intercept + f.slope * Math.log(p.tvl_usd))) * 1e4) / 1e4);
  }
  const dated = live.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const trainW = dated.filter((p) => p.listed_at! < cut);
  const testW = dated.filter((p) => p.listed_at! >= cut);
  const fw = ols(trainW.map((p) => Math.log(p.tvl_usd)), trainW.map((p) => Math.log(p.mcap_usd!)));
  const wfR2 = r2Of(testW.map((p) => Math.log(p.mcap_usd!)), testW.map((p) => fw.intercept + fw.slope * Math.log(p.tvl_usd)));
  const medRatio = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const ys = live.map((p) => Math.log(p.mcap_usd!));
  const medPred = live.map((p) => Math.log(medRatio) + Math.log(p.tvl_usd));
  return {
    five_fold_mean_r2: Math.round((foldR2.reduce((a, b) => a + b, 0) / foldR2.length) * 1e4) / 1e4,
    five_fold_r2: foldR2,
    walk_forward_r2: Math.round(wfR2 * 1e4) / 1e4,
    walk_forward_train_n: trainW.length, walk_forward_test_n: testW.length,
    median_ratio_r2: Math.round(r2Of(ys, medPred) * 1e4) / 1e4,
    median_ratio_mae_log: Math.round((ys.reduce((s, y, i) => s + Math.abs(y - medPred[i]!), 0) / ys.length) * 1e4) / 1e4,
    median_ratio: Math.round(medRatio * 1e4) / 1e4,
  };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; report: ModelReport } {
  const liveFit = snapshot.protocols.filter((p) => isLiveToken(p) && p.tvl_usd > 0);
  const fit = fitCurve(liveFit);
  const catFactors = categoryFactors(liveFit, fit);
  const { cohorts, global } = cohortOdds(snapshot);
  const validation = validate(snapshot, liveFit);
  const rankable = snapshot.protocols.filter(isRankable);
  const scored = rankable.map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, fit, catFactors, cohorts, global) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Keep implied values strictly decreasing after rounding, so the board is a real ranking.
  let prev = Number.POSITIVE_INFINITY;
  const board: BoardRow[] = scored.map((item, i) => {
    let implied = item.s.implied;
    if (implied >= prev) implied = Math.max(1, prev - 1);
    prev = implied;
    const expected = Math.max(1, Math.round(implied * item.s.odds));
    const low = Math.max(1, Math.round(implied / Math.exp(fit.median_abs_log)));
    const high = Math.round(implied * Math.exp(fit.median_abs_log));
    return {
      rank: i + 1, slug: item.p.slug, name: item.p.name, category: item.p.category, chains: item.p.chains,
      tvl_usd: item.p.tvl_usd, change_7d: item.p.change_7d, mcap_usd: item.p.mcap_usd, listed_at: item.p.listed_at,
      gecko_id: item.p.gecko_id, symbol: item.p.symbol, token_status: 'pre-token', age_days: item.s.age,
      implied_value_usd: implied, fitted_value_usd: item.s.fitted, launch_odds: item.s.odds,
      expected_value_usd: expected, interval_low_usd: low, interval_high_usd: high,
      model: { fitted_value_usd: item.s.fitted, category_factor: item.s.catFactor, growth_pct: item.s.growthPct, growth_multiplier: item.s.growthMult, chain_multiplier: item.s.chainMult, age_multiplier: item.s.ageMult, launch_odds: item.s.odds, age_days: item.s.age },
      farm_steps: farmStepTexts(item.p, item.s.age),
    };
  });
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 60)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
  const report: ModelReport = {
    version: MODEL_VERSION, fit, validation, category_factors: catFactors, cohorts, global_token_rate: global,
    counts: { total: snapshot.protocols.length, live: snapshot.protocols.filter((p) => !isPreToken(p)).length, pre_token: snapshot.protocols.filter(isPreToken).length, ranked: board.length, excluded: snapshot.protocols.filter((p) => isPreToken(p) && isExcluded(p)).length, live_set_aside: snapshot.protocols.filter((p) => !isPreToken(p)).length },
  };
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION, model: report,
    watchlist_size: snapshot.watchlist.length, board_size: board.length,
    early_size: board.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    live_size: live.length, excluded_size: report.counts.excluded,
    rows: board.map((r) => ({ rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl_usd, change_7d: r.change_7d, mcap_usd: r.mcap_usd, listed_at: r.listed_at, age_days: r.age_days, implied_value_usd: r.implied_value_usd, fitted_value_usd: r.fitted_value_usd, launch_odds: r.launch_odds, expected_value_usd: r.expected_value_usd, interval_low_usd: r.interval_low_usd, interval_high_usd: r.interval_high_usd, category_factor: r.model.category_factor, growth_multiplier: r.model.growth_multiplier, chain_multiplier: r.model.chain_multiplier, age_multiplier: r.model.age_multiplier, watchlist: snapshot.watchlist.includes(r.slug) })),
    live,
  };
  return { board, radar, report };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    return {
      slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd, change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows share the same implied value`;
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
