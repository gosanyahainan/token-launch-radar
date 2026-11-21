// Token Radar's value model (radar-2): one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol on the snapshot's watchlist (the floor, never the ceiling) plus
// the strongest pre-token protocols below that floor, by an implied value the model derives from
// the snapshot's own figures alone. No protocol name is ever special-cased.
//
//   sector    = the median market-cap-to-TVL ratio of the live-token protocols in the same
//               category (at least three of them, else the whole live set's median), clamped
//               to [0.05, 1.5]: what the market already pays per dollar of TVL in that business.
//   growth    = 1 + clamp(change_7d, -40, 60) / 100 x 0.8: a growing protocol's token would
//               be worth more, a shrinking one's less, but a week's move is not the whole story.
//   tenure    = 0.75 + 0.25 x min(age_days, 730) / 730 (unknown age: 0.85): a protocol that
//               has run longer with no token has more to price in; the factor tops out at two years.
//   implied   = max(1, round(tvl_usd x sector x growth x tenure))
//
// A protocol is pre-token when its record carries no token at all (no market cap, no CoinGecko id,
// no symbol). Live-token protocols are set aside and shown with the market's own values, never
// ranked as if they were still to come. The farm plan for each row is derived from the protocol's
// own record (category, chains, TVL, age), never from a hand-written list of names.

/** One protocol of the sealed snapshot: exactly its ten fields. */
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

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunable numbers, stated in the dashboard so a reader can check them. */
export interface ModelParams {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  tenure_floor: number;
  tenure_range: number;
  tenure_days: number;
  unknown_age_factor: number;
  sector_floor: number;
  sector_cap: number;
  min_sector_sample: number;
}

export const MODEL: ModelParams = {
  growth_weight: 0.8,
  growth_floor: -40,
  growth_cap: 60,
  tenure_floor: 0.75,
  tenure_range: 0.25,
  tenure_days: 730,
  unknown_age_factor: 0.85,
  sector_floor: 0.05,
  sector_cap: 1.5,
  min_sector_sample: 3,
};

/** The model's version label, named by the dashboard. */
export const MODEL_VERSION = 'radar-2';

/** Early rows the radar carries below the watchlist floor, by TVL. */
export const EARLY_ROWS = 160;

/** Live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
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
  model: {
    sector: string;
    sector_multiple: number;
    growth_pct: number;
    growth_factor: number;
    tenure_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js, farm plan included so the page never re-derives it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  sector_multiple: number;
  growth_factor: number;
  tenure_factor: number;
  farm_steps: string[];
}

/** A live-token protocol, shown with the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol's record carries no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a release marker is a versioned pool of another protocol, not its own launch. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A name carrying one of these whole words is a wrapped, staked or bridged product, not a launch. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name is that exchange's product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
/** Categories the board keeps off: exchanges are not token launches. (Bridges and staking
    products stay rankable below the floor: the snapshot records no token for them, and the
    watchlist's stricter rule is the house's list, not the board's.) */
const OFF_BOARD_CATEGORIES = new Set(['CEX']);

/** Whether a protocol is one the board may rank: pre-token and a standalone launch candidate. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && OFF_BOARD_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The sector table: each category's median live market-cap-to-TVL ratio, plus the overall median. */
export interface SectorTable {
  byCategory: Map<string, number>;
  overall: number;
}

export function sectorTable(snapshot: Snapshot): SectorTable {
  const perCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
  }
  const overall = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, number>();
  for (const [key, ratios] of perCategory) {
    if (ratios.length >= MODEL.min_sector_sample) byCategory.set(key, median(ratios));
  }
  return { byCategory, overall };
}

/** A category's sector multiple from the table, clamped; the overall median when the sample is thin. */
export function sectorMultiple(category: string | null, table: SectorTable): { multiple: number; sector: string } {
  const key = category ?? 'Other';
  const raw = table.byCategory.get(key);
  if (raw !== undefined) {
    return { multiple: Math.min(MODEL.sector_cap, Math.max(MODEL.sector_floor, raw)), sector: key };
  }
  return { multiple: Math.min(MODEL.sector_cap, Math.max(MODEL.sector_floor, table.overall)), sector: 'all live tokens' };
}

/** The three factors and the implied value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  table: SectorTable,
): { implied: number; sector: string; sectorMultiple: number; growthPct: number; growthFactor: number; tenureFactor: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, sector } = sectorMultiple(p.category, table);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, rawGrowth));
  const growthFactor = 1 + (growthPct / 100) * MODEL.growth_weight;
  const tenureFactor =
    age === null ? MODEL.unknown_age_factor : MODEL.tenure_floor + (Math.min(Math.max(age, 0), MODEL.tenure_days) / MODEL.tenure_days) * MODEL.tenure_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor * tenureFactor));
  return { implied, sector, sectorMultiple: multiple, growthPct, growthFactor, tenureFactor, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const table = sectorTable(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked, whatever its TVL or category.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the floor, by TVL, capped at EARLY_ROWS.
  // A chosen protocol stays chosen; the early rows only add what the watchlist leaves out.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, table);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      sector: s.sector,
      sector_multiple: Math.round(s.sectorMultiple * 1e4) / 1e4,
      growth_pct: Math.round(s.growthPct * 100) / 100,
      growth_factor: Math.round(s.growthFactor * 1e4) / 1e4,
      tenure_factor: Math.round(s.tenureFactor * 1e4) / 1e4,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

// ---------------------------------------------------------------- farm plans

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, and what a week of farming costs there. */
function gasOn(chain: string): { tx: string; week: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { tx: '$8 to $15 of gas', week: 'about $25 of gas a week' };
  if (c === 'solana') return { tx: 'about $0.01 of gas', week: 'under $0.10 of gas a week' };
  if (
    c === 'arbitrum' || c === 'base' || c === 'optimism' || c === 'zksync' || c === 'blast' ||
    c === 'polygon' || c === 'linea' || c === 'scroll' || c === 'mode' || c === 'mantle' || c === 'opbnb'
  ) {
    return { tx: 'under $0.50 of gas', week: 'under $2 of gas a week' };
  }
  if (c === 'binance' || c === 'avalanche' || c === 'fantom' || c === 'gnosis') {
    return { tx: '$0.50 to $3 of gas', week: 'about $5 of gas a week' };
  }
  return { tx: '$1 to $5 of gas', week: 'about $8 of gas a week' };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 200_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small amount against it, then repay the borrow so the position stays healthy.`;
  }
  if (c.includes('dex')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain}, in the pair the pool itself suggests, and keep the position in range.`;
  }
  if (c.includes('yield aggregator') || c.includes('yield')) {
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and leave the vault tokens untouched.`;
  }
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('allocator') || c.includes('curator')) {
    return `Deposit $${capital} of USDC into a ${name} curated vault on ${chain} and hold the vault shares through at least one rebalance.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the same wallet for the whole farming window.`;
  }
  if (c.includes('basis trading') || c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, then close it within the week.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its app, then bridge a small amount back.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the farming wallet.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} for a position you already hold, and keep the policy until it expires.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} on ${chain} and place one small market position on an outcome you have researched.`;
  }
  if (c.includes('payment')) {
    return `Move $${capital} through ${name} on ${chain} for a real payment, then keep a $${capital} balance in the app for the farming window.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it instead of swapping it away.`;
  }
  if (c.includes('chain')) {
    return `Use $${capital} inside ${name}'s own app on ${chain} for its headline action, and keep the resulting position open.`;
  }
  if (c.includes('governance')) {
    return `Deposit $${capital} of USDC into ${name} on ${chain} and vote with the position in the next governance round.`;
  }
  return `Deposit $${capital} of USDC into ${name}'s main app on ${chain} and keep the position open.`;
}

/** The weekly qualifying action, fitted to the category. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'Make one qualifying action each week: a fresh deposit, a borrow, a repayment or a vote in the protocol.';
  if (c.includes('dex')) return 'Make one qualifying action each week: add or remove a little liquidity, or one swap through the pool.';
  if (c.includes('restak') || c.includes('staking')) return 'Make one qualifying action each week: top up the stake a little, or claim and restake the rewards.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading')) return 'Make one qualifying action each week: one small hedged trade, then close it before the week ends.';
  if (c.includes('bridge')) return 'Make one qualifying action each week: bridge a small amount through the protocol, or use the bridged funds in its app.';
  if (c.includes('prediction')) return 'Make one qualifying action each week: one small position on a new market, never the same market twice.';
  return 'Make one qualifying action each week: a deposit, a swap, a vote or a claim inside the protocol.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasOn(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Set up a fresh wallet that holds only the funds you plan to farm, fund it with $${capital + 20} of USDC on ${chain}, and keep its seed phrase offline.`,
      cost: `${gas.tx} for the funding transaction`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus ${gas.tx}`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: gas.week,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not move it between wallets.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and check what the position earned; claim only from the link that page publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, and keep enough gas in the wallet to unwind the position later.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** One step as a single string: action, then cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, farm plan included so the page never re-derives it. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    sector_multiple: row.model.sector_multiple,
    growth_factor: row.model.growth_factor,
    tenure_factor: row.model.tenure_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: `window.RADAR = {...};`, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
