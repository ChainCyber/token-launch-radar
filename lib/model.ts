// Token Launch Radar — comps-based implied-value model.
//
// MODEL (documented here and in README.md; no protocol name is ever special-cased):
//
//   Universe: every watchlist slug (40) plus the next 160 pre-token
//   protocols (gecko_id null AND symbol null) by TVL descending that also
//   pass the launch-candidate screen (isLaunchCandidate): the watchlist's
//   own exclusion rule applied to the whole universe — no Bridge /
//   Canonical Bridge / Liquid Staking / Liquid Restaking / Restaked BTC /
//   CEX category, no name starting with an exchange's name, no whole word
//   wrapped / staked / staking in the name, no trailing version marker.
//   A wrapped, staked or bridged product of a token that already trades is
//   not a protocol still waiting on a launch of its own. 198 rows result
//   (40 watchlist + 158 screened early candidates).
//   "Pre-token" means the snapshot's record carries no token (gecko_id and
//   symbol both null). DefiLlama's record is not proof: say a protocol
//   "records no token", never that it has none.
//
//   Category comps: for each category, ratio = median(mcap_usd / tvl_usd)
//   over TOKENIZED protocols in that category (mcap_usd not null, tvl_usd > 0).
//   A category with fewer than 3 comps falls back to the global median over
//   all tokenized protocols. The ratio is what the market already pays, per
//   dollar of TVL, for tokens in the same line of business.
//
//   implied_value_usd = round(TVL * category_ratio * growth_factor
//                             * age_factor * chain_factor)
//     growth_factor = 1 + clamp(change_7d, -50, 100) / 400
//                     (null change_7d -> 1; a +100% week adds 25%, a -50% week cuts 12.5%)
//     age_factor    = 0.9 + min(age_days, 1825) / 1825 * 0.2   (0.9..1.1; older /
//                     longer-tracked protocols score slightly higher; null listed_at -> 1.0)
//     chain_factor  = min(1 + 0.02 * (num_chains - 1), 1.10)
//
//   Rows sort by implied value desc (ties: TVL desc, then slug asc) and the
//   board enforces STRICTLY decreasing implied_value_usd down the ranks
//   (decrement by $1 where needed, never below $1), so rank 1 is the most
//   valuable and no two rows tie.
//
//   Farm plans are generated from the protocol's own record (name, category,
//   chains, TVL, age): concrete on-chain actions with a cost and a time each,
//   ending with a step that the token is unconfirmed and must be verified
//   through the protocol's official channels. No URLs are invented.

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

export const MODEL_VERSION = 'comps-2';
export const EARLY_ROWS = 160;
export const MAX_IMPLIED = 100_000_000_000_000;

export interface ModelBreakdown {
  category_ratio: number;
  comps_used: number;
  ratio_source: string; // category name, or "global" when the fallback applied
  growth_factor: number;
  growth_pct_used: number | null;
  age_factor: number;
  age_days: number | null;
  chain_factor: number;
  num_chains: number;
}

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
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  median_ratio_global: number;
  categories: { category: string; ratio: number; comps: number }[];
  rows: BoardRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Whole days from listed_at to as_of; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token when both its CoinGecko id and its symbol are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * The launch-candidate screen: the watchlist's own exclusion rule, applied to
 * the whole universe. A wrapped, staked or bridged product of a token that
 * already trades is not a protocol still waiting on a launch of its own, so
 * these are out: a Bridge / Canonical Bridge / Liquid Staking / Liquid
 * Restaking / Restaked BTC / CEX category; a name starting with an exchange's
 * name; a name carrying a whole word wrapped, staked or staking; a name
 * ending in a version marker (a space followed by V2, v2, 2.0 or the like).
 * The watchlist's 40 slugs all pass this screen by construction.
 */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  return true;
}

export interface CompTable {
  byCategory: Map<string, { ratio: number; comps: number }>;
  global: number;
}

/** Median mcap/TVL per category over tokenized protocols; <3 comps -> global median. */
export function buildCompTable(protocols: SnapshotProtocol[]): CompTable {
  const perCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(r) || r < 0) continue;
    all.push(r);
    const key = p.category ?? 'Uncategorized';
    const list = perCat.get(key) ?? [];
    list.push(r);
    perCat.set(key, list);
  }
  const global = all.length > 0 ? median(all) : 0;
  const byCategory = new Map<string, { ratio: number; comps: number }>();
  for (const [cat, vals] of perCat) {
    byCategory.set(cat, vals.length >= 3 ? { ratio: median(vals), comps: vals.length } : { ratio: global, comps: vals.length });
  }
  return { byCategory, global };
}

export function growthFactor(change7d: number | null): { factor: number; pctUsed: number | null } {
  if (change7d === null) return { factor: 1, pctUsed: null };
  const pct = clamp(change7d, -50, 100);
  return { factor: 1 + pct / 400, pctUsed: pct };
}

export function ageFactor(age: number | null): number {
  if (age === null) return 1;
  return 0.9 + (Math.min(age, 1825) / 1825) * 0.2;
}

export function chainFactor(numChains: number): number {
  return Math.min(1 + 0.02 * Math.max(0, numChains - 1), 1.1);
}

/** The full comps breakdown and implied value for one protocol. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  comps: CompTable,
): { implied: number; breakdown: ModelBreakdown } {
  const catKey = p.category ?? 'Uncategorized';
  const entry = comps.byCategory.get(catKey);
  const ratio = entry !== undefined ? entry.ratio : comps.global;
  const compsUsed = entry !== undefined ? entry.comps : 0;
  const ratioSource = entry !== undefined && entry.comps >= 3 ? catKey : 'global';
  const age = ageDays(asOf, p.listed_at);
  const growth = growthFactor(p.change_7d);
  const af = ageFactor(age);
  const cf = chainFactor(p.chains.length);
  const implied = Math.max(1, Math.round(p.tvl_usd * ratio * growth.factor * af * cf));
  return {
    implied,
    breakdown: {
      category_ratio: round4(ratio),
      comps_used: compsUsed,
      ratio_source: ratioSource,
      growth_factor: round4(growth.factor),
      growth_pct_used: growth.pctUsed,
      age_factor: round4(af),
      age_days: age,
      chain_factor: round4(cf),
      num_chains: p.chains.length,
    },
  };
}

// ---------------------------------------------------------------- farm plans ---

/** Capital for one farm position, scaled to the protocol's TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Hold window: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

interface Step {
  text: string;
  cost: string;
  time: string;
}

function render(step: Step): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  return s;
}

function chainList(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains.slice(0, 3).join(', ') : 'its main chain';
}

function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/**
 * Category template bank. Each entry is a function of the protocol that
 * returns the middle (action) steps; the first step (set up safely) and the
 * last step (the token is unconfirmed) wrap every plan. Matching is by
 * category keyword so no protocol name is ever special-cased.
 */
type PlanFn = (p: SnapshotProtocol, capital: number, hold: number) => Step[];

const PLANS: { match: RegExp; plan: PlanFn }[] = [
  {
    match: /lend|cdp|collateral/i,
    plan: (p, capital, hold) => [
      { text: `Supply $${capital} of USDC to ${p.name} on ${firstChain(p)} as a lender and leave the deposit earning`, cost: `$${capital} of capital plus about $4 of gas`, time: '15 minutes to set up' },
      { text: `Borrow a small amount against the deposit, for example $20 of a stablecoin, to register as an active borrower on ${p.name}`, cost: 'about $2 of gas and the borrow interest', time: '10 minutes' },
      { text: `Repay the borrow and re-supply once a week so the position shows repeated use across several weeks`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: `Hold the supply position for at least ${hold} days, and use ${p.name} on ${chainList(p)} rather than a single chain where it runs on more than one`, cost: `the $${capital} stays supplied`, time: `${hold} days` },
    ],
  },
  {
    match: /dex|swap|aggregator/i,
    plan: (p, capital, hold) => [
      { text: `Swap $25 of ETH for a stablecoin through ${p.name} on ${firstChain(p)} to open a trading history`, cost: '$25 of volume plus about $3 of gas', time: '10 minutes' },
      { text: `Provide $${capital} of liquidity to ${p.name}'s largest pool on ${firstChain(p)} and keep the position in range`, cost: `$${capital} of capital plus about $5 of gas`, time: '20 minutes to set up' },
      { text: `Swap or add liquidity once a week, rotating between the pools ${p.name} runs on ${chainList(p)}`, cost: 'about $3 of gas a week', time: '15 minutes a week' },
      { text: `Hold the liquidity position for at least ${hold} days and collect the trading fees it earns`, cost: `the $${capital} stays in the pool`, time: `${hold} days` },
    ],
  },
  {
    match: /bridge|canonical bridge|cross chain/i,
    plan: (p, capital, hold) => [
      { text: `Bridge $${capital} of USDC through ${p.name} to ${firstChain(p)} and use the bridged funds in an app there`, cost: `$${capital} moved plus about $6 of gas and the bridge fee`, time: '20 minutes, plus the bridge wait' },
      { text: `Bridge back a smaller amount, about $25, a week later so the record shows two-way use of ${p.name}`, cost: 'about $6 of gas and the bridge fee', time: '20 minutes' },
      { text: `Repeat a bridge of $25 or more every two weeks for at least ${hold} days, varying the destination chain among ${chainList(p)}`, cost: 'about $6 of gas per bridge', time: `20 minutes every two weeks for ${hold} days` },
      { text: `Keep the receipts of every bridge in a farm log with the dates, amounts and chains`, cost: 'nothing but the log', time: '5 minutes per bridge' },
    ],
  },
  {
    match: /liquid staking|restak|staking/i,
    plan: (p, capital, hold) => [
      { text: `Stake $${capital} of the chain's staking asset through ${p.name} on ${firstChain(p)} and keep the receipt token`, cost: `$${capital} staked plus about $4 of gas`, time: '15 minutes to set up' },
      { text: `Deposit the receipt token into a lending or liquidity pool that accepts it, so the stake is used and not idle`, cost: 'about $3 of gas', time: '15 minutes' },
      { text: `Top up the stake by $10 or more once a month while the position runs for at least ${hold} days`, cost: '$10 a month plus about $3 of gas', time: `10 minutes a month for ${hold} days` },
      { text: `Do not unstake early: keep the position open for the full ${hold}-day window so it counts in more than one snapshot`, cost: `the $${capital} stays staked`, time: `${hold} days` },
    ],
  },
  {
    match: /yield|leveraged farm|farm/i,
    plan: (p, capital, hold) => [
      { text: `Deposit $${capital} into ${p.name}'s highest-TVL vault on ${firstChain(p)} and note the vault's name and entry date`, cost: `$${capital} of capital plus about $4 of gas`, time: '15 minutes to set up' },
      { text: `Claim or compound the vault's yield once a week instead of leaving it untouched for months`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: `Try a second vault on another chain ${p.name} runs on, such as ${chainList(p)}, with $25 so the activity spans chains`, cost: '$25 plus about $4 of gas', time: '20 minutes' },
      { text: `Hold the main vault deposit for at least ${hold} days before withdrawing anything`, cost: `the $${capital} stays deposited`, time: `${hold} days` },
    ],
  },
  {
    match: /perpetual|derivative|options/i,
    plan: (p, capital, hold) => [
      { text: `Deposit $${capital} of USDC as margin on ${p.name} on ${firstChain(p)} and open one small hedged position`, cost: `$${capital} of margin plus about $4 of gas`, time: '20 minutes to set up' },
      { text: `Close the position after a day and open a second small one the following week, keeping sizes small`, cost: 'about $3 of gas per trade', time: '15 minutes a week' },
      { text: `Trade at least once a week for ${hold} days so the account shows steady use rather than a single trade`, cost: 'trading fees on small size plus gas', time: `15 minutes a week for ${hold} days` },
      { text: `Keep total exposure below the $${capital} deposit and never use maximum leverage on ${p.name}`, cost: 'no extra cost', time: 'ongoing while the position runs' },
    ],
  },
  {
    match: /rwa|real world|treasuries|tokenized/i,
    plan: (p, capital, hold) => [
      { text: `Mint or buy $${capital} of ${p.name}'s yield-bearing asset on ${firstChain(p)} and hold it in the farming wallet`, cost: `$${capital} plus about $5 of gas`, time: '20 minutes to set up' },
      { text: `Check the asset's yield accrual weekly and record the balance in a farm log`, cost: 'nothing to check', time: '5 minutes a week' },
      { text: `Add $25 more after a month to show continued use of ${p.name} rather than a one-off mint`, cost: '$25 plus about $4 of gas', time: '15 minutes' },
      { text: `Hold the asset for at least ${hold} days; a real-world-asset position is a slow position, not a quick flip`, cost: `the $${capital} stays invested`, time: `${hold} days` },
    ],
  },
  {
    match: /stable|cdp/i,
    plan: (p, capital, hold) => [
      { text: `Mint $${capital} of the stable asset through ${p.name} on ${firstChain(p)} against a deposit you can afford to lock`, cost: `$${capital} of collateral plus about $4 of gas`, time: '20 minutes to set up' },
      { text: `Use the minted stablecoins in a pool or payment on ${firstChain(p)} instead of leaving them idle`, cost: 'about $3 of gas', time: '15 minutes' },
      { text: `Repay part of the mint and mint again once a month for at least ${hold} days`, cost: 'about $3 of gas a month', time: `15 minutes a month for ${hold} days` },
      { text: `Keep the collateral ratio well above the liquidation line for the whole ${hold}-day window`, cost: 'no extra cost', time: `ongoing for ${hold} days` },
    ],
  },
  {
    match: /prediction|gaming|betting/i,
    plan: (p, capital, hold) => [
      { text: `Fund a ${p.name} account on ${firstChain(p)} with $${capital} and place one small market position`, cost: `$${capital} funded plus about $3 of gas`, time: '15 minutes to set up' },
      { text: `Place one position a week on different markets so the account shows varied use over ${hold} days`, cost: 'small stakes plus about $2 of gas a week', time: `10 minutes a week for ${hold} days` },
      { text: `Withdraw winnings back to the farming wallet and record each market, stake and outcome`, cost: 'about $2 of gas per withdrawal', time: '10 minutes a week' },
      { text: `Cap weekly stakes at $25 so the farm stays cheap even if every position loses`, cost: 'at most $25 a week at risk', time: `ongoing for ${hold} days` },
    ],
  },
  {
    match: /insurance|risk|curator|allocator|vault/i,
    plan: (p, capital, hold) => [
      { text: `Deposit $${capital} into a ${p.name} vault on ${firstChain(p)} and keep the vault shares in the farming wallet`, cost: `$${capital} of capital plus about $4 of gas`, time: '15 minutes to set up' },
      { text: `Vote on a ${p.name} governance or allocation proposal if one is open, using the position you hold`, cost: 'about $2 of gas', time: '10 minutes' },
      { text: `Check the vault's allocation monthly and add $25 if the strategy still fits, for at least ${hold} days`, cost: '$25 plus about $3 of gas', time: `15 minutes a month for ${hold} days` },
      { text: `Hold the vault shares for the full ${hold}-day window before withdrawing`, cost: `the $${capital} stays deposited`, time: `${hold} days` },
    ],
  },
];

const GENERIC_PLAN: PlanFn = (p, capital, hold) => [
  { text: `Deposit $${capital} of USDC into ${p.name} on ${firstChain(p)} and keep the position open in the farming wallet`, cost: `$${capital} of capital plus about $4 of gas`, time: '15 minutes to set up' },
  { text: `Use the protocol a second way, such as a swap, a deposit on another chain among ${chainList(p)}, or a vote if one is open`, cost: 'about $3 of gas', time: '15 minutes' },
  { text: `Repeat one qualifying action each week for at least ${hold} days so the activity spans several weeks`, cost: 'about $2 of gas a week', time: `10 minutes a week for ${hold} days` },
  { text: `Keep a farm log of the wallet, the dates and every transaction on ${p.name}`, cost: 'nothing but the log', time: '5 minutes a week' },
];

/** A protocol's farm plan: 6 steps (set-up, 4 category actions, token warning). */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const cat = p.category ?? '';
  const found = PLANS.find((entry) => entry.match.test(cat));
  const middle = (found ?? { plan: GENERIC_PLAN }).plan(p, capital, hold);
  const steps: Step[] = [
    {
      text: `Set up a fresh wallet holding only the funds you plan to farm on ${p.name}, keep its seed phrase offline, and fund it with a little gas on ${firstChain(p)}`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    ...middle,
    {
      text: `${p.name} records no token, so no token launch is confirmed: never pay anyone for an early token, and verify any launch only through ${p.name}'s official channels before acting`,
      cost: 'nothing to verify, and never pay to claim',
      time: '10 minutes to check',
    },
  ];
  return steps.map(render);
}

// ------------------------------------------------------------------- board ---

/** The ranked board: 198 rows, watchlist first in coverage, then by value. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const comps = buildCompTable(snapshot.protocols);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token launch candidates below the floor, by TVL, capped at 160.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isPreToken(p) && isLaunchCandidate(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = scoreProtocol(p, snapshot.as_of, comps);
    return { p, implied, breakdown };
  });
  scored.sort(
    (a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  // Strictly decreasing implied values down the ranks: shave $1 where a tie would stand.
  let prev = Number.POSITIVE_INFINITY;
  const rows: BoardRow[] = scored.map((s, i) => {
    let value = Math.min(s.implied, prev - 1);
    if (value < 1) value = 1;
    prev = value;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      watchlist: snapshot.watchlist.includes(s.p.slug),
      age_days: s.breakdown.age_days,
      implied_value_usd: value,
      model: s.breakdown,
      farm_steps: farmSteps(s.p, s.breakdown.age_days),
    };
  });
  return rows;
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const comps = buildCompTable(snapshot.protocols);
  const categories = [...comps.byCategory.entries()]
    .map(([category, v]) => ({ category, ratio: round4(v.ratio), comps: v.comps }))
    .sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    median_ratio_global: round4(comps.global),
    categories,
    rows: board,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
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
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not fall below row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share the same implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > MAX_IMPLIED) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's whole dataset as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
