// ─── Constants ────────────────────────────────────────────────────────────────
const PALETTE = [
  '#0d9488','#3b82f6','#f59e0b','#ef4444','#8b5cf6',
  '#ec4899','#06b6d4','#84cc16','#f97316','#1e3a5f',
  '#0ea5e9','#a3e635','#fb923c','#c084fc','#34d399',
];

const TYPE_CONFIG = {
  stock:       { label: 'Stock',       priceLabel: 'Price (USD)',  fetchLabel: '↻ Fetch' },
  etf:         { label: 'ETF',         priceLabel: 'Price (USD)',  fetchLabel: '↻ Fetch' },
  mutual_fund: { label: 'Mutual Fund', priceLabel: 'NAV (USD)',    fetchLabel: '↻ Fetch NAV' },
  crypto:      { label: 'Crypto',      priceLabel: 'Price (USD)',  fetchLabel: '↻ Fetch' },
  bond:        { label: 'Bond',        priceLabel: 'Price (USD)',  fetchLabel: '↻ Fetch' },
  other:       { label: 'Other',       priceLabel: 'Price (USD)',  fetchLabel: '↻ Fetch' },
};

// Static NAV lookup for 401K collective investment trusts (no public ticker/API).
// Add entries here (partial name match keys) to have Refresh All auto-fill NAVs.
// Leave empty to manage 401K prices manually via the price click-to-edit in the UI.
const FUND_NAV_TABLE = {};

// Index-tracking CITs with no public ticker, priced via a proxy ETF that tracks the
// same index: NAV_est = calibration.nav × (proxy adjclose now / proxy adjclose at
// calibration). Dividend-adjusted closes make the ratio a total-return ratio, which is
// how CIT unit values accrue, so drift between calibrations is only the fee differential.
// Calibration = { date, nav } stored on the holding; reset whenever a price is entered
// manually (e.g. a real NAV from a statement), seeded from the current price otherwise.
const PROXY_TRACKED_FUNDS = {
  'State Street S&P 500':                        { proxy: 'IVV',  index: 'S&P 500' },
  'State Street S&P Midcap':                     { proxy: 'IJH',  index: 'S&P MidCap 400' },
  'State Street U.S. Inflation Protected Bond':  { proxy: 'SCHP', index: 'US TIPS' },
};

// Calibrations older than this get a "recalibrate" nudge in the table.
const PROXY_RECAL_NUDGE_DAYS = 90;

// Avanza fund IDs for Swedish pension funds (GET-based, no POST/search needed).
// Keys are partial name matches; avanzaId is from avanza.se fund pages.
// splitByCountry: true → on refresh, automatically rebalance the quantity split
//   between the us_stock and intl_stock holdings of this fund using Avanza's country data.
// assetsInSek: true → the fund HOLDS Swedish-krona assets, so its dollar value
//   moves one-for-one with the krona. Priced in SEK is not the same thing: the
//   global index fund holds mostly dollar and euro stocks, so a weaker krona
//   lifts its SEK NAV and leaves its dollar value roughly where it was. Counting
//   the whole pension put a krona fall at about ten times what the short-bond
//   fund alone carries (2026-10-03 audit, eval Q06). Mark any new Swedish-asset
//   fund here.
const AVANZA_FUND_IDS = {
  'LF Global Index':                    { id: '417655', splitByCountry: true },
  'Länsförsäkringar Global Index':      { id: '417655', splitByCountry: true },
  'Länsförsäkringar Kort räntefond':    { id: '2084', assetsInSek: true },
  'LF Short bond':                      { id: '2084', assetsInSek: true },
};

// Sleeve configuration
const SLEEVE_CONFIG = {
  us_stock:   { label: 'US Stock',    color: '#3b82f6' },
  intl_stock: { label: 'Intl Stock',  color: '#10b981' },
  tilt:       { label: 'Tilt',        color: '#f59e0b' },
  bond:       { label: 'Bond',        color: '#8b5cf6' },
  other:      { label: 'Other',       color: '#52525b' },
};

// Known ticker sets for sleeve auto-detection
const US_STOCK_TICKERS = new Set([
  'VOO','VTI','SPY','IVV','QQQ','SCHB','ITOT','SCHA','VB','VO','VUG','VTV',
  'VOOG','VOOV','MDY','IJH','IJR','AVUS','DFAC','VXF','FXAIX','VFIAX',
  'FSKAX','SWTSX','SWPPX','FNILX','SPTM',
]);
const INTL_TICKERS = new Set([
  'VXUS','VEU','VEA','EFA','IEFA','VWO','EEM','DFAX','AVDE','AVEM',
  'VT','IXUS','VGTSX','VTIAX','FSGGX','SWISX','FZILX',
]);
const BOND_TICKERS = new Set([
  'VGIT','BND','BNDX','VBTLX','AGG','TLT','IEF','SHY','VTIP','TIP',
  'SCHP','VGSH','VGLT','BSV','BIV','BLV','GOVT','VBIRX','VBILX',
  'FXNAX','FBIDX','VCIT','VCSH','LQD','HYG','MUB',
]);
const TILT_TICKERS = new Set([
  'FBTC','GBTC','IBIT','BTC','ETH','ASML','TSM','NDAQ','NVDA',
  'AVUV','VBR','IJS','AVLV','IVAL','QVAL','VNQ','VNQI',
]);

// Column aliases for CSV import
const COL_ALIASES = {
  name:     ['name','investment name','fund name','security name','security','holding','description','asset'],
  ticker:   ['ticker','symbol','tick','fund ticker','security ticker'],
  quantity: ['shares','quantity','units','qty','amount','lots','position','shares/units','shares units','number of shares','num shares'],
  // Per-share prices only. Position totals ("Current Value", "Market Value",
  // "Total Value", "Cost Basis Total") must never land here: a total read as a
  // price multiplies the position by its own share count. Fidelity's positions
  // export says "Last Price", which used to match nothing — every row imported
  // at $0.00.
  // 'cost' used to be here. A cost is what he paid, never what it is worth now,
  // and a "Cost" column ahead of "Price" took the price's place.
  price:    ['price','nav','rate','px','last','close','market price','current price','share price','unit price',
             'last price','last trade price','latest price','closing price','close price','mark price',
             'price per share','price per unit','nav per share'],
  type:     ['type','asset type','asset_type','asset class','category','class','kind','security type'],
  account:  ['account type','account','account name','account_type','acct','portfolio'],
};

// Account tile colors (cycled)
const ACCT_COLORS = ['#0d9488','#3b82f6','#f59e0b','#8b5cf6','#1e3a5f','#06b6d4','#f97316','#52525b'];

// Fixed account list (user's accounts — not adding new ones)
const ACCOUNTS = ['Brokerage', 'Roth IRA', '401K', 'Swedish pension', 'ESPP - Trade'];

// ─── State ────────────────────────────────────────────────────────────────────
let holdings   = [];
let lastSaved  = null;
let editingId     = null;
let quickPriceId  = null;
let splittingId   = null;
let unsaved    = false;
let importRows = [];
let importAccountMap = new Map(); // CSV account label → the account he chose for it; this import only
let lastRefreshed = null;
let refreshing    = false;

// Allocation targets (+ tax rates for gain estimates — directional, not advice)
let targets = { stocks: 80, bonds: 15, other: 5, us: 70, intl: 20, tilts: 10,
                taxMarginal: 24, taxLtcg: 15 };

// Transaction ledger (P1 foundation): quantity changes get a row each, so a
// true TWR/MWR can be computed later. Contribution rules auto-accrue payroll
// buys (e.g. 401K) between statements — estimated units, trued up whenever
// real statement values are entered.
let transactions = [];
let contributionRules = [];

// ─── Theme ───────────────────────────────────────────────────────────────────
function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('portfolio_theme', theme);
  // A labelled item in the ⋯ menu since Drop 2, so it names what a tap does.
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode';
  // Re-render charts with theme-aware colors
  if (typeof renderPerformanceChart === 'function') renderPerformanceChart();
}

function toggleTheme() {
  applyTheme(isDark() ? 'light' : 'dark');
}

function initTheme() {
  const stored = localStorage.getItem('portfolio_theme');
  if (stored) { applyTheme(stored); return; }
  // Respect system preference
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    applyTheme('dark');
  } else {
    applyTheme('light');
  }
}

// Theme-aware color helpers for Chart.js
function themeGridColor() { return isDark() ? '#1e2433' : '#eeece7'; }
function themeTickColor() { return isDark() ? '#5a6478' : undefined; }

// ─── Persistence ──────────────────────────────────────────────────────────────
function saveLocal() {
  localStorage.setItem('portfolio_v3', JSON.stringify({ holdings, lastSaved, targets, transactions, contributionRules }));
}
function loadLocal() {
  try {
    const raw = localStorage.getItem('portfolio_v3')
             || localStorage.getItem('portfolio_v2');
    if (!raw) return;
    const data = JSON.parse(raw);
    holdings  = (data.holdings || []).map(h => ({ type: 'stock', ...h }));
    lastSaved = data.lastSaved || null;
    if (data.targets) Object.assign(targets, data.targets);
    transactions      = data.transactions || [];
    contributionRules = data.contributionRules || [];
  } catch { /* ignore */ }
}

// ─── Utils ────────────────────────────────────────────────────────────────────
const fmt$  = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2}).format(n);
const fmtN  = (n, d=4) => new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(n);
const uid   = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const total = () => holdings.reduce((s,h) => s + h.quantity * h.price, 0);
const esc   = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
// Whole dollars, for the tiles: an account balance with its cents, at tile
// size, did not fit half a 375px column; the cents are in the header total
// and the Holdings rows.
const fmt$0 = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
// "Sep 21" — or "Sep 21, 2025" outside the current year. A bare YYYY-MM-DD is
// a calendar date (ledger rows are dated in New York time), never parsed as
// UTC midnight, which reads as the day before anywhere west of Greenwich.
function shortDate(iso, now = new Date()) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);
  if (isNaN(d)) return '';
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

function typeBadge(type) {
  const t = type || 'stock';
  const label = TYPE_CONFIG[t]?.label || t;
  return `<span class="type-badge type-${t}">${esc(label)}</span>`;
}

let autosaveTimer = null;
let historyData   = null;   // { snapshots: [{ date, value, spyPrice }] }
function markUnsaved() {
  unsaved = true;
  saveLocal();
  noteLocalChange();
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autoSaveToServer, 1000);
}

// Mirror the in-memory state to data/portfolio.json via server.py.
//
// This exists because a cloud PULL is not a save: when this Mac adopts a doc
// another device wrote (phone edits, a different laptop), only localStorage
// was updated and the on-disk JSON silently went stale — permanently, since
// opening the app never backfilled it either. That file is what Claude, the
// MCP server, and Vertex read, so a stale mirror means every one of them
// answers from a portfolio that no longer exists. Never called in shell mode
// (a phone has no server.py); returns false rather than throwing when the
// local server isn't there.
async function writeDiskMirror() {
  if (IS_SHELL) return false;
  try {
    const res = await fetch('data/portfolio.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holdings, targets, transactions, contributionRules,
                             lastSaved: lastSaved || new Date().toISOString() }),
    });
    return res.ok;
  } catch (_) { return false; }
}

async function autoSaveToServer() {
  if (IS_SHELL) {
    // Shell mode: the cloud row is the save target. localStorage already has
    // the latest state, so an offline push simply stays dirty for next time.
    if (await cloudPushState()) {
      render();
      saveHistorySnapshot();
    }
    return;
  }
  try {
    const payload = { holdings, targets, transactions, contributionRules, lastSaved: new Date().toISOString() };
    const res = await fetch('data/portfolio.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      lastSaved = payload.lastSaved;
      unsaved = false;
      saveLocal();
      render();
      saveHistorySnapshot();
    }
  } catch (_) {}
  // Continuous Mac→cloud sync: when signed in, every local save also mirrors
  // to the cloud (CAS-protected — a moved cloud triggers re-arbitration).
  if (cloudReady()) cloudPushState().catch(() => {});
}

// Persist what a price fetch wrote: prices, plus the side effects a fetch
// carries (SEK NAV/FX stamps, the LF Global country split, a seeded CIT
// calibration). None of that is an edit, so none of it marks the document.
//
// Until 2026-10-03 every refresh went through markUnsaved(). That stamped the
// device dirty "now", so an open Mac's 15-minute refresh was always the newest
// change, and when the phone had saved in between, last-write-wins pushed the
// Mac's stale copy over the phone's edit (audit, platform: replaying
// syncDecision for "phone edit 10:00, Mac synced 09:00, Mac refresh 10:15"
// gave 'push'). It also pushed twice — once here directly and once from
// markUnsaved's own 1s timer — so 9 of 29 cloud versions differed only in
// lastSaved and the 30-version safety net covered under 4 hours.
//
// Now a refresh writes only where it is free to: this browser and, on the
// Mac, data/portfolio.json (Claude and the MCP read it), keeping lastSaved —
// a price is not a save. The cloud copy's prices age until the next real
// edit, which is fine: every reader re-prices (the other device on open, the
// nightly snapshot from closes).
async function persistMarketData() {
  // A real edit that never reached its store (offline, server.py down, a
  // failed push) goes now, once, as itself. Its localChangedAt is the edit's,
  // not this refresh's, so arbitration still dates it honestly.
  if (unsaved || (cloudReady() && syncMeta().localDirty)) {
    clearTimeout(autosaveTimer);   // or its debounce would push it a second time
    await autoSaveToServer();
    return;
  }
  saveLocal();
  await writeDiskMirror();         // no-op in shell mode
  render();
  saveHistorySnapshot();
}

async function saveHistorySnapshot() {
  // New York date, like the server's nightly row (index.ts nyDate). On UTC an
  // evening save after 8pm ET wrote tomorrow's row (audit 2026-10-03).
  const today = nyToday();
  const value = total();
  if (!value) return;
  const spyPrice = await fetchYahoo('SPY').catch(() => null);
  try {
    if (IS_SHELL) {
      await cloudPushSnapshot({ date: today, value, spyPrice });
    } else {
      await fetch('data/history.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today, value, spyPrice }),
      });
    }
    // Refresh local history and re-render chart
    await loadHistory();
    renderPerformanceChart();
  } catch (_) {}
}

async function loadHistory() {
  try {
    if (IS_SHELL) {
      historyData = cloudReady() ? await cloudFetchHistory() : null;
      return;
    }
    const res = await fetch('data/history.json');
    if (!res.ok) { historyData = null; return; }
    historyData = await res.json();
  } catch (_) { historyData = null; }
}

// ─── True performance math (P1b) ─────────────────────────────────────────────
// Returns are only computed over snapshots from the ledger epoch forward.
// 2026-08-01, not the ledger's first row (06-11): the first two snapshots
// (07-30, 07-31) priced Brokerage + Roth only, and the 401K and pension
// (two whole accounts) arrived on 08-01 with no money-in row — so a chain
// from 06-11 read that arrival as a one-day market gain and put an absurd TWR
// and a four-digit annualised MWR under the total (audit 2026-10-03; the
// figures are in the private plan's evidence/audit-map.json). 08-01 is the
// first complete snapshot. Labels quote the first snapshot actually used,
// never this string.
const LEDGER_EPOCH = '2026-08-01';

// + = money into the portfolio (contributions and manual statement true-ups).
// 'dividend' rows are deliberately NOT flows: a reinvested distribution is
// investment income, and subtracting it here would strip income out of TWR —
// which is exactly what happened before the kind existed.
function externalFlows(txns) {
  return (txns || [])
    .filter(t => t.kind === 'contribution' || t.kind === 'adjustment')
    .map(t => ({ date: String(t.date).slice(0, 10), amount: +(t.amount || 0) }))
    .filter(f => f.amount !== 0 && f.date);
}

// Recorded income (reinvested or cash dividends) since the ledger epoch.
function recordedIncome(txns) {
  return (txns || [])
    .filter(t => t.kind === 'dividend')
    .reduce((s, t) => s + (+t.amount || 0), 0);
}

// Time-weighted growth index over [first..last] snapshot, end-of-period flow
// convention: each period's growth = (V1 − flows in (d0,d1]) / V0. `exclude`
// lists period END dates to leave out (growth 1 — see performanceHealth).
// Returns [1, …] one level per snapshot, or null when not computable. The
// Performance chart draws this; computeTWR is its last level.
function twrIndex(snapshots, flows, exclude) {
  if (!snapshots || snapshots.length < 2) return null;
  const skip = new Set(exclude || []);
  const out = [1];
  for (let i = 1; i < snapshots.length; i++) {
    const s0 = snapshots[i - 1], s1 = snapshots[i];
    if (!(s0.value > 0)) return null;
    const F = (flows || [])
      .filter(f => f.date > s0.date && f.date <= s1.date)
      .reduce((s, f) => s + f.amount, 0);
    out.push(out[i - 1] * (skip.has(s1.date) ? 1 : (s1.value - F) / s0.value));
  }
  return out;
}

// Time-weighted return: a decimal (0.2 = +20%) or null when not computable.
function computeTWR(snapshots, flows, exclude) {
  const idx = twrIndex(snapshots, flows, exclude);
  return idx ? idx[idx.length - 1] - 1 : null;
}

// ─── Discontinuity guard ─────────────────────────────────────────────────────
// A snapshot step the ledger cannot explain is a hole in the record, not a
// return. Two shapes, both seen in David's data (audit 2026-10-03):
//  - unexplained move: value net of booked flows moved more than 10% of the
//    period's opening value while the S&P moved less than ±3% (or is unknown).
//    2026-08-01: a large rise against a small fraction of it in rows, S&P
//    flat — the 401K and pension arriving.
//  - flows exceed the change: booked flows more than twice the value change
//    AND more than 2% of value. 2026-09-13: about four times the day's value
//    change booked as money in — a pension statement total booked as new
//    units while the lot it replaced was deleted with no row.
// Pure. Flagged periods are left out of every TWR chain (computeTWR's
// `exclude`), MWR is withheld across them, and the Ask brief names them in
// performance.caveats. measurableFrom is the snapshot that closes the last
// flagged period: a chain starting there crosses none. mcp/portfolio-lib.js
// carries a second copy of this function — change both (parity test in
// tests/performance.spec.js).
const GUARD_MOVE_PCT = 0.10, GUARD_SPY_CALM_PCT = 0.03, GUARD_FLOW_MULTIPLE = 2, GUARD_FLOW_MIN_PCT = 0.02;

function performanceHealth(snapshots, flows) {
  const snaps = snapshots || [];
  const usd = n => '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  const pct = n => (n < 0 ? '−' : '+') + Math.abs(n * 100).toFixed(1) + '%';
  const flags = [];
  for (let i = 1; i < snaps.length; i++) {
    const s0 = snaps[i - 1], s1 = snaps[i];
    if (!(s0.value > 0)) continue;
    const F = (flows || [])
      .filter(f => f.date > s0.date && f.date <= s1.date)
      .reduce((s, f) => s + f.amount, 0);
    const change = s1.value - s0.value, net = change - F;
    const spy = s0.spyPrice > 0 && s1.spyPrice > 0 ? s1.spyPrice / s0.spyPrice - 1 : null;
    if (Math.abs(net) > GUARD_MOVE_PCT * s0.value && (spy == null || Math.abs(spy) < GUARD_SPY_CALM_PCT)) {
      flags.push({ date: s1.date, cause: `value ${net > 0 ? 'rose' : 'fell'} ${usd(net)} (${pct(net / s0.value)}) ` +
        (F ? `beyond the ${usd(F)} booked as money ${F < 0 ? 'out' : 'in'}` : 'with no money booked in or out') +
        `, while the S&P moved ${spy == null ? 'an unknown amount' : pct(spy)} — likely holdings ` +
        `${net > 0 ? 'added' : 'removed'} without a ledger row, not a return` });
    } else if (Math.abs(F) > GUARD_FLOW_MULTIPLE * Math.abs(change) && Math.abs(F) > GUARD_FLOW_MIN_PCT * s0.value) {
      flags.push({ date: s1.date, cause: `${usd(F)} booked as money ${F > 0 ? 'in' : 'out'} against a ` +
        `${change < 0 ? '−' : '+'}${usd(change)} value change — likely a statement true-up or a lot moved ` +
        `between holdings, not new money` });
    }
  }
  return { flags, measurableFrom: flags.length ? flags[flags.length - 1].date : (snaps[0]?.date ?? null) };
}

// Flag dates inside the span (from, to] — the periods a chain over it crosses.
function flagsWithin(health, from, to) {
  return (health?.flags || []).filter(f => f.date > from && f.date <= to).map(f => f.date);
}

// Money-weighted return: annualized IRR of investor cash flows (−V0 at start,
// −flow at each contribution, +VT at end), bisection on NPV. Returns decimal
// per year or null (degenerate spans / no IRR in (−95%, +1000%)).
function computeMWR(snapshots, flows) {
  if (!snapshots || snapshots.length < 2) return null;
  const first = snapshots[0], last = snapshots[snapshots.length - 1];
  const t0 = new Date(first.date + 'T00:00:00Z').getTime();
  const yrs = d => (new Date(d + 'T00:00:00Z').getTime() - t0) / (365 * 86400000);
  const T = yrs(last.date);
  if (!(T > 0) || !(first.value > 0)) return null;
  const cfs = [
    { t: 0, amt: -first.value },
    ...(flows || [])
      .filter(f => f.date > first.date && f.date <= last.date)
      .map(f => ({ t: yrs(f.date), amt: -f.amount })),
    { t: T, amt: last.value },
  ];
  const npv = r => cfs.reduce((s, c) => s + c.amt / Math.pow(1 + r, c.t), 0);
  let lo = -0.95, hi = 10, nLo = npv(lo), nHi = npv(hi);
  if (!isFinite(nLo)) return null;
  // Short spans annualize to enormous rates — widen the bracket until the
  // NPV changes sign (or give up past 1e12/yr).
  while (isFinite(nHi) && nLo * nHi > 0 && hi < 1e12) { hi *= 10; nHi = npv(hi); }
  if (!isFinite(nHi) || nLo * nHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, nMid = npv(mid);
    if (nLo * nMid <= 0) { hi = mid; nHi = nMid; } else { lo = mid; nLo = nMid; }
  }
  return (lo + hi) / 2;
}

// ─── Policy benchmark ────────────────────────────────────────────────────────
// A price-only SPY line answers the wrong question for a policy investor. The
// honest benchmark is his own target mix as a blended TOTAL-return index:
// VTI/VXUS/BND daily adjcloses (dividend-adjusted), weighted from targets,
// compounded daily. 'other' has no benchmark — weights renormalize over the
// investable three. Tilt maps to VTI (disclosed simplification).
function policyWeights(t) {
  const stocks = (+t.stocks || 0) / 100;
  const w = {
    VTI:  stocks * (((+t.us || 0) + (+t.tilts || 0)) / 100),
    VXUS: stocks * ((+t.intl || 0) / 100),
    BND:  (+t.bonds || 0) / 100,
  };
  const sum = w.VTI + w.VXUS + w.BND;
  if (!(sum > 0)) return null;
  for (const k in w) w[k] = w[k] / sum;
  return w;
}

// seriesByTicker: {T:{timestamps:[unix s],adjcloses:[]}}; returns a
// daily-rebalanced blended index [{date, level}] from the first date where
// every ticker has a close (level 100), or null when not computable.
function computePolicySeries(seriesByTicker, weights) {
  const byDate = {};
  for (const [tick, s] of Object.entries(seriesByTicker || {})) {
    if (!s || !Array.isArray(s.timestamps) || !s.timestamps.length) return null;
    s.timestamps.forEach((ts, i) => {
      const px = s.adjcloses[i];
      if (px == null || !(px > 0)) return;
      const date = new Date(ts * 1000).toISOString().slice(0, 10);
      (byDate[date] = byDate[date] || {})[tick] = px;
    });
  }
  const ticks = Object.keys(weights);
  const dates = Object.keys(byDate)
    .filter(d => ticks.every(t => byDate[d][t] != null))
    .sort();
  if (dates.length < 2) return null;
  let level = 100;
  const out = [{ date: dates[0], level }];
  for (let i = 1; i < dates.length; i++) {
    let r = 0;
    for (const t of ticks) r += weights[t] * (byDate[dates[i]][t] / byDate[dates[i - 1]][t] - 1);
    level *= 1 + r;
    out.push({ date: dates[i], level: +level.toFixed(4) });
  }
  return out;
}

// Blended level at-or-before each wanted date (null before the series starts).
function samplePolicyAt(series, dates) {
  return dates.map(d => {
    let last = null;
    for (const p of series) {
      if (p.date > d) break;
      last = p.level;
    }
    return last;
  });
}

// An annualised MWR is noise until the span is a year: at 30 days (the old
// floor) a two-month return of about two percent displayed as six times that
// per year (audit 2026-10-03).
const MWR_MIN_SPAN_DAYS = 365;

function spanDays(snapshots) {
  if (!snapshots || snapshots.length < 2) return 0;
  return (new Date(snapshots[snapshots.length - 1].date) - new Date(snapshots[0].date)) / 86400000;
}

// History arrived or changed (cloud.js calls this after loadHistory, and the
// theme toggle after a switch). It used to draw the Performance card: three
// overlapping lines with a dot on every day under slanted dates, which David
// called "impossible to read on a phone" (2026-10-04). The return now lives in
// the This week card's "Since Aug 1" view, so new history redraws that card.
function renderPerformanceChart() {
  if (typeof renderWeekCard === 'function') renderWeekCard();
}

// The blended policy series, cached per range+weights for the session. The Ask
// brief reads it for its "vs policy" figure. The Performance card used to fill
// it; the This week card does now, from the VTI/VXUS/BND charts it fetches
// anyway (weekWarmPolicy). Empty until then, and the brief says so.
let policyCache = null;

function policyRangeFor(firstDate) {
  const days = (Date.now() - new Date(firstDate + 'T00:00:00Z')) / 86400000;
  if (days <= 80)  return '3mo';
  if (days <= 170) return '6mo';
  if (days <= 350) return '1y';
  if (days <= 700) return '2y';
  return '5y';
}

function toast(msg, ms = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

// Update fetch button label and price label when type changes
document.getElementById('iType').addEventListener('change', () => {
  const t = document.getElementById('iType').value;
  const cfg = TYPE_CONFIG[t] || TYPE_CONFIG.stock;
  document.getElementById('btnFetch').textContent  = cfg.fetchLabel;
  document.getElementById('iPriceLabel').textContent = cfg.priceLabel;
});

// ─── Sleeve detection ─────────────────────────────────────────────────────────
function autoDetectSleeve(h) {
  const ticker = (h.ticker || '').toUpperCase().trim();
  const name   = (h.name   || '').toLowerCase();

  if (TILT_TICKERS.has(ticker))    return 'tilt';
  if (BOND_TICKERS.has(ticker))    return 'bond';
  if (INTL_TICKERS.has(ticker))    return 'intl_stock';
  if (US_STOCK_TICKERS.has(ticker)) return 'us_stock';

  // Name heuristics for funds without standard tickers
  if (/inflation.?protect|tips|short.?bond|bond.?fund|fixed.?income|money.?market|stable.?value/i.test(name)) return 'bond';
  if (/international|global|world|intl|foreign|emerging/i.test(name)) return 'intl_stock';
  if (/s&p 500|sp500|500 index|domestic|large.?cap|mid.?cap|small.?cap/i.test(name)) return 'us_stock';

  // Type-based fallback
  if (h.type === 'bond')   return 'bond';
  if (h.type === 'crypto') return 'tilt';
  if (['stock','etf','mutual_fund'].includes(h.type)) return 'us_stock';
  return 'other';
}

function getSleeve(h) {
  // Use manual override if set, otherwise auto-detect
  return h.sleeve || autoDetectSleeve(h);
}

function sleeveOptions(selected) {
  return `<option value="">Auto-detect</option>` +
    Object.entries(SLEEVE_CONFIG).map(([val, cfg]) =>
      `<option value="${val}" ${val === selected ? 'selected' : ''}>${cfg.label}</option>`
    ).join('');
}

function accountOptions(selected) {
  return `<option value="">— Unassigned —</option>` +
    ACCOUNTS.map(a => `<option value="${esc(a)}" ${a === selected ? 'selected' : ''}>${esc(a)}</option>`).join('');
}

// ─── Account helpers ──────────────────────────────────────────────────────────
function getAccountTotals() {
  const accts = {};
  for (const h of holdings) {
    const acct = h.account || 'Unassigned';
    accts[acct] = (accts[acct] || 0) + h.quantity * h.price;
  }
  return accts;
}

// ─── Sleeve totals ────────────────────────────────────────────────────────────
function getSleeveTotals() {
  const totals = {};
  for (const key of Object.keys(SLEEVE_CONFIG)) totals[key] = 0;
  for (const h of holdings) {
    const s = getSleeve(h);
    totals[s] = (totals[s] || 0) + h.quantity * h.price;
  }
  return totals;
}

function getSleeveTargetPcts() {
  const { stocks, bonds, other, us, intl, tilts } = targets;
  return {
    us_stock:   stocks * us   / 100,
    intl_stock: stocks * intl / 100,
    tilt:       stocks * tilts / 100,
    bond:       bonds,
    other:      other,
  };
}

// ─── File I/O: JSON ───────────────────────────────────────────────────────────
async function saveToFile() {
  const payload = { holdings, targets, transactions, contributionRules, lastSaved: new Date().toISOString() };
  const json = JSON.stringify(payload, null, 2);

  // Shell mode: the cloud is the primary save; fall through to the download
  // path so Export still produces a local backup file on the phone/desktop.
  if (IS_SHELL) {
    if (await cloudPushState()) { toast('Saved to cloud ✓'); return; }
  }

  // Try direct POST to local server first (works when served via server.py)
  try {
    const res = await fetch('data/portfolio.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    });
    if (res.ok) {
      lastSaved = payload.lastSaved; unsaved = false; saveLocal(); render();
      toast('Saved ✓');
      return;
    }
  } catch (_) {}

  // Fallback: browser Save As dialog or download
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'portfolio.json',
        types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
    } catch (e) {
      if (e.name === 'AbortError') return;
      dlFallback(json);
    }
  } else {
    dlFallback(json);
  }

  lastSaved = payload.lastSaved; unsaved = false; saveLocal(); render();
  toast('Saved ✓');
}

function dlFallback(json) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = 'portfolio.json';
  a.click();
}

function triggerLoadJSON() { document.getElementById('fileInputJSON').click(); }

function loadFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.holdings)) throw new Error();
      holdings  = data.holdings.map(h => ({ type:'stock', ...h }));
      lastSaved = data.lastSaved || null;
      if (data.targets) Object.assign(targets, data.targets);
      // The backup carries the whole ledger — dropping it here silently
      // destroyed post-epoch TWR/MWR on every restore.
      transactions      = data.transactions || [];
      contributionRules = data.contributionRules || [];
      // A restore IS a local change: mark dirty so it propagates to the
      // cloud (and to every other device) instead of sitting on this one.
      markUnsaved();
      applyContributionRules();
      render(); renderTargetInputs();
      renderPerformanceChart();
      toast(`Restored ${holdings.length} holdings + ${transactions.length} ledger rows from ${file.name}`);
    } catch { toast('Error: not a valid portfolio.json file'); }
    event.target.value = '';
  };
  reader.readAsText(file);
}

// ─── CSV: parser ─────────────────────────────────────────────────────────────
function parseCSVText(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQ = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i], nx = text[i+1];
    if (inQ) {
      if (ch === '"' && nx === '"') { field += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { row.push(field.trim()); field = ''; }
      else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && nx === '\n') i++;
        row.push(field.trim()); field = '';
        if (row.some(f => f !== '')) rows.push(row);
        row = [];
      } else { field += ch; }
    }
  }
  if (field || row.length) {
    row.push(field.trim());
    if (row.some(f => f !== '')) rows.push(row);
  }
  return rows;
}

function detectColumns(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const norm = h.toLowerCase().replace(/[_\-\/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
    // Brokers decorate price headers with the currency ("Last Price $", "Price
    // (USD)") — a unit, not part of the name. Stripped for PRICE only: on any
    // other field it is a warning, not decoration — "Amount ($)" is dollars, and
    // reading it as a share count would import a position a hundred times over.
    // And only when the header actually says price or NAV, so the stripping cannot
    // widen a bare alias: "Rate $" stays unmatched, exactly as before.
    const bare = norm.replace(/\(\s*(\$|usd)\s*\)|\$|\busd\b/g, ' ').replace(/\s+/g, ' ').trim();
    const priceNorm = /\b(price|nav)\b/.test(bare) ? bare : norm;
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
      if (!(field in map) && aliases.includes(field === 'price' ? priceNorm : norm)) map[field] = i;
    }
  });
  return map;
}

// Returns a type, or null when the cell carries no asset-class information —
// callers fall back to inferTypeFromInstrument. Null cases matter: Fidelity's
// positions CSV has a "Type" column whose values are the account REGISTRATION
// ("Cash" / "Margin" / "Short") on every row, not an asset class — mapping
// bare "cash" to bond turned entire imports into bonds.
function normalizeType(raw) {
  if (!raw) return null;
  const r = raw.toLowerCase().trim().replace(/[\s\-\/]+/g, '_');
  if (['cash','margin','short'].includes(r)) return null; // brokerage registration, not an asset class
  if (['mutual_fund','mutualfund','mf','fund','open_end_fund','open_end'].includes(r)) return 'mutual_fund';
  if (['etf','exchange_traded_fund','exchange_traded'].includes(r))    return 'etf';
  if (['crypto','cryptocurrency','coin','token','digital_asset'].includes(r)) return 'crypto';
  if (['bond','bonds','fixed_income','fixed_income_bond','treasury','tbill','note',
       'money_market','cash_equivalent','stable_value'].includes(r))   return 'bond';
  if (['stock','stocks','equity','equities','share','common_stock',
       'domestic_stock','domestic_equity','us_stock','us_equity',
       'international_stock','international_equity','intl_stock','intl_equity',
       'foreign_stock','foreign_equity','global_stock','global_equity',
       'large_cap','large_cap_stock','small_cap','small_cap_stock',
       'mid_cap','mid_cap_stock','growth','value','blend',
       'emerging_markets','emerging_market','real_estate','reit'].includes(r)) return 'stock';
  return null; // unrecognized — let the instrument itself decide
}

// Type from what the instrument IS (ticker shape + name), used when the CSV's
// type cell is absent or carries no asset-class info.
function inferTypeFromInstrument(ticker, name) {
  const t = (ticker || '').toUpperCase().trim().replace(/\*+$/, ''); // SPAXX** → SPAXX
  const n = (name || '').toLowerCase();
  if (/money market|cash reserves|government cash|treasury only/.test(n)) return 'bond';
  if (/^(FBTC|IBIT|GBTC|ETHA|ETHE|ARKB|BITB)$/.test(t) || /bitcoin|ethereum|crypto/.test(n)) return 'crypto';
  if (/^[A-Z]{5}$/.test(t) && t.endsWith('X')) return 'mutual_fund'; // classic US open-end fund symbol
  if (US_STOCK_TICKERS.has(t) || INTL_TICKERS.has(t) || BOND_TICKERS.has(t) || TILT_TICKERS.has(t)) return 'etf';
  if (/\betf\b/.test(n)) return 'etf';
  if (/\bindex fund\b|\bfund\b/.test(n)) return 'mutual_fund';
  if (/\bbond\b|treasury|fixed income/.test(n)) return 'bond';
  return t ? 'stock' : 'other';
}

// ─── CSV: import flow ─────────────────────────────────────────────────────────
function triggerImportCSV() { document.getElementById('fileInputCSV').click(); }

function importCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const rows = parseCSVText(e.target.result);
    if (rows.length === 0) { toast('CSV appears to be empty.'); return; }

    const firstRow = rows[0];
    const looksLikeHeader = firstRow.some(f => isNaN(parseFloat(f)) && f.trim() !== '');
    let colMap, dataRows;

    if (looksLikeHeader) {
      colMap   = detectColumns(firstRow);
      dataRows = rows.slice(1);
    } else {
      colMap   = { name: 0, quantity: 1, price: 2, type: 3 };
      dataRows = rows;
    }

    if (!('name' in colMap) || !('quantity' in colMap)) {
      toast('Could not detect Name/Ticker and Shares columns. Add headers or check the template.');
      event.target.value = '';
      return;
    }

    importRows = dataRows.map((row, idx) => {
      const nameRaw    = row[colMap.name]    || '';
      const tickerRaw  = colMap.ticker  != null ? (row[colMap.ticker]  || '') : '';
      const qtyRaw     = row[colMap.quantity] || '';
      const priceRaw   = colMap.price   != null ? (row[colMap.price]   || '') : '';
      const typeRaw    = colMap.type    != null ? (row[colMap.type]    || '') : '';
      const accountRaw = colMap.account != null ? (row[colMap.account] || '') : '';

      const name   = nameRaw.trim() || tickerRaw.trim();
      const ticker = tickerRaw.trim();
      const qty    = parseFloat(qtyRaw.replace(/[$,\s]/g, ''));
      const price  = parseFloat(priceRaw.replace(/[$,\s]/g, ''));
      const type   = normalizeType(typeRaw) || inferTypeFromInstrument(ticker, name);

      let status = 'ok', statusMsg = 'Ready';
      if (!name)                           { status = 'err';  statusMsg = 'Missing name'; }
      else if (isNaN(qty) || qty <= 0)     { status = 'err';  statusMsg = 'Invalid shares'; }
      else if (isNaN(price) || price <= 0) { status = 'warn'; statusMsg = 'No price — fetch after import'; }

      // csvAccount is the label exactly as the file had it. The account the row
      // lands in is decided in reconcileImportRows, and can change while he looks.
      const csvAccount = accountRaw.trim();
      return {
        _row: idx + 1 + (looksLikeHeader ? 1 : 0),
        name, ticker, type, csvAccount, account: csvAccount,
        quantity: isNaN(qty) ? 0 : qty,
        price: (isNaN(price) || price < 0) ? 0 : price,
        status, statusMsg,
      };
    }).filter(r => !(r.status === 'err' && !r.name && r.quantity === 0));

    importAccountMap = new Map();
    reconcileImportRows();
    renderImportPreview();
    document.getElementById('importPreview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    event.target.value = '';
  };
  reader.readAsText(file);
}

const importNorm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Which existing holding(s) does a CSV row correspond to? Ticker wins (within
// the row's account when it names one); otherwise normalized name. A name
// match may hit a split pair (us_stock + intl_stock rows of one real fund) —
// both ids are returned and the new total is distributed by the current ratio.
function findImportMatch(row) {
  const inAccount = h => !row.account ||
    (h.account || '').toLowerCase() === row.account.toLowerCase();
  const tick = (row.ticker || '').toUpperCase();
  if (tick && tick !== 'N/A') {
    const hits = holdings.filter(h =>
      (h.ticker || '').toUpperCase() === tick && inAccount(h));
    if (hits.length) return { ids: hits.map(h => h.id) };
  }
  const hits = holdings.filter(h => importNorm(h.name) === importNorm(row.name) && inAccount(h));
  return hits.length ? { ids: hits.map(h => h.id) } : null;
}

// The same position wherever it is held, whatever the account: by ticker, or
// by name when the row has none.
function importHolders(row) {
  const tick = (row.ticker || '').toUpperCase();
  const byTicker = tick && tick !== 'N/A';
  return holdings.filter(h => byTicker
    ? (h.ticker || '').toUpperCase() === tick
    : importNorm(h.name) === importNorm(row.name));
}

const sameAccount = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

// His accounts, in his order, plus any a holding already lives in. A holding's
// spelling wins over the list's: a file saying "Roth IRA" joins holdings kept
// under "ROTH IRA" instead of opening a second group beside them.
function knownImportAccounts() {
  const held = [];
  holdings.forEach(h => {
    if (h.account && !held.some(a => sameAccount(a, h.account))) held.push(h.account);
  });
  return [...ACCOUNTS.map(a => held.find(x => sameAccount(x, a)) || a),
          ...held.filter(x => !ACCOUNTS.some(a => sameAccount(a, x)))];
}

// Reconcile against existing holdings: a re-import UPDATES matching positions
// instead of duplicating them. Re-run whenever he maps a label or ticks a row.
function reconcileImportRows() {
  const known = knownImportAccounts();
  const live = importRows.filter(r => r.status !== 'err');
  live.forEach(r => {
    // A broker's label is not his account name ("Individual" is his Brokerage),
    // and only he knows that — so his mapping wins. Failing that, a known
    // account keeps its spelling: "ROTH IRA" must not open a second Roth IRA.
    r.account = importAccountMap.get(r.csvAccount)
      || known.find(a => sameAccount(a, r.csvAccount))
      || r.csvAccount;
    r.matchIds = findImportMatch(r)?.ids || null;
    r.applyQty = r.quantity; r.applyPrice = r.price;
    r.oldQty = null; r.elsewhere = null; r.groupRows = null; r.countedWith = null;
  });

  // One position can arrive as several rows: Fidelity lists a symbol twice when
  // it sits in both Cash and Margin, and two labels can map to one account.
  // Applied row by row the last one won — 25 sh became "15", then "10". So the
  // first row carries the group's SUM and the others ride along. Rows that
  // would ADD the same new position are one holding for the same reason.
  const groups = new Map();
  live.forEach(r => {
    const tick = (r.ticker || '').toUpperCase();
    const key = r.matchIds
      ? `held|${[...r.matchIds].sort().join('|')}`
      : `new|${r.account.toLowerCase()}|${tick && tick !== 'N/A' ? `t:${tick}` : `n:${importNorm(r.name)}`}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  });
  groups.forEach(rows => {
    if (rows.length < 2) return;
    const [first, ...rest] = rows;
    first.applyQty = +rows.reduce((sum, r) => sum + r.quantity, 0).toFixed(6);
    first.applyPrice = first.price > 0 ? first.price : (rows.find(r => r.price > 0)?.price || 0);
    first.groupRows = rows.map(r => r._row);
    rest.forEach(r => { r.countedWith = first._row; });
  });

  live.forEach(r => {
    if (r.countedWith) {
      r.mode = 'same';
      r.statusMsg = `Counted with row ${r.countedWith}`;
      return;
    }
    const rowsNote = r.groupRows ? ` · rows ${r.groupRows.join(' + ')}` : '';
    if (r.matchIds) {
      r.oldQty = r.matchIds.reduce((s, mid) =>
        s + (holdings.find(x => x.id === mid)?.quantity || 0), 0);
      if (Math.abs(r.oldQty - r.applyQty) < 1e-9) {
        r.mode = 'same';
        r.statusMsg = `No change${rowsNote}`;
      } else {
        r.mode = 'update';
        r.statusMsg = `Update: ${fmtN(r.oldQty)} → ${fmtN(r.applyQty)} sh${rowsNote}`;
      }
      return;
    }
    r.mode = 'add';
    r.statusMsg = (r.applyPrice > 0 ? 'New holding' : 'No price — fetch after import') + rowsNote;
    // New to this account but held in another: almost always the same position
    // under the broker's name for the account, and importing it would count it
    // twice. Held back until he says otherwise. A row with no account already
    // matched across accounts above, so it never gets here.
    if (!r.account) return;
    const where = [...new Set(importHolders(r)
      .filter(h => !sameAccount(h.account, r.account))
      .map(h => h.account || 'Unassigned'))];
    if (where.length) {
      r.elsewhere = where;
      r.statusMsg = `Already held in ${where.join(' and ')} — add as a second position?${rowsNote}`;
    }
  });
}

const importHeldBack = r => !!r.elsewhere && !r.addAnyway;

// Labels that get a mapping line: every one that is not in HIS list. A label an
// earlier "Keep" import turned into an account still gets its line — dropping
// it left the next import of the same file with nothing but "Add anyway". So
// does any label he has mapped, or whose rows are held elsewhere.
function importMapLabels() {
  const live = importRows.filter(r => r.status !== 'err' && r.csvAccount);
  return [...new Set(live.map(r => r.csvAccount))].filter(l =>
    !ACCOUNTS.some(a => sameAccount(a, l)) || importAccountMap.has(l) ||
    live.some(r => r.csvAccount === l && r.elsewhere));
}

function setImportAccount(label, account, focusId) {
  if (account) importAccountMap.set(label, account); else importAccountMap.delete(label);
  // A tick said "add it to THAT account", and "reinvested dividend" described
  // the update he was looking at; a re-map can change both, so he is asked again.
  importRows.forEach(r => {
    r.kind = null;
    if (r.csvAccount === label) r.addAnyway = false;
  });
  refreshImportPreview(focusId);
}

function setImportAddAnyway(rowNo, on, focusId) {
  const r = importRows.find(x => x._row === rowNo);
  if (r) r.addAnyway = on;
  refreshImportPreview(focusId);
}

// Kept on the row, not only in the DOM: every re-render replaces the control.
function setImportKind(rowNo, kind) {
  const r = importRows.find(x => x._row === rowNo);
  if (r) r.kind = kind;
}

function refreshImportPreview(focusId) {
  reconcileImportRows();
  renderImportPreview();
  // The re-render replaced the control he was on; give the keyboard back.
  if (focusId) document.getElementById(focusId)?.focus();
}

function renderImportPreview() {
  const okRows   = importRows.filter(r => r.status === 'ok');
  const warnRows = importRows.filter(r => r.status === 'warn');
  const errRows  = importRows.filter(r => r.status === 'err');
  const heldBack = importRows.filter(importHeldBack);
  const adds     = importRows.filter(r => r.mode === 'add' && r.status !== 'err' && !importHeldBack(r));
  const updates  = importRows.filter(r => r.mode === 'update');
  const merged   = importRows.filter(r => r.countedWith);
  const sames    = importRows.filter(r => r.mode === 'same' && !r.countedWith);
  // A group of rows is ONE change, carried by its first row.
  const importable = adds.length + updates.length;

  document.getElementById('importSummary').innerHTML =
    `Found <strong>${importRows.length}</strong> rows: ` +
    `<span style="color:#10b981">${adds.length} new</span>, ` +
    `<span style="color:#3b82f6">${updates.length} updating</span>, ` +
    `<span style="color:var(--text-muted)">${sames.length} unchanged</span>` +
    (merged.length ? `, <span style="color:var(--text-muted)">${merged.length} counted with another row</span>` : '') +
    (heldBack.length ? `, <span style="color:#d97706">${heldBack.length} already held elsewhere</span>` : '') +
    (warnRows.length ? `, <span style="color:#d97706">${warnRows.length} missing price</span>` : '') +
    (errRows.length ? `, <span style="color:#dc2626">${errRows.length} skipped</span>` : '') + '.';

  document.getElementById('btnConfirmImport').textContent =
    updates.length ? `Apply ${importable} change${importable !== 1 ? 's' : ''}`
                   : `Import ${importable} holding${importable !== 1 ? 's' : ''}`;
  document.getElementById('btnConfirmImport').disabled = importable === 0;

  document.getElementById('importAccountMap').innerHTML = importAccountMapHTML();

  document.getElementById('importTableBody').innerHTML = importRows.map(r => {
    const sub = [r.ticker && r.ticker !== r.name ? r.ticker : '', r.account].filter(Boolean).join(' · ');
    // A quantity INCREASE on an existing holding may be a reinvested
    // distribution rather than new money — misclassifying it as a flow would
    // strip that income out of TWR, so the human decides here, one tap.
    const kindPicker = r.mode === 'update' && r.applyQty > r.oldQty
      ? `<div style="margin-top:4px;"><select id="imp-kind-${r._row}" class="imp-kind"
             onchange="setImportKind(${r._row}, this.value)">
           <option value="adjustment">New money / true-up</option>
           <option value="dividend" ${r.kind === 'dividend' ? 'selected' : ''}>Reinvested dividend</option>
         </select></div>`
      : '';
    const dupCheck = r.elsewhere
      ? `<label class="imp-dup"><input type="checkbox" id="imp-dup-${r._row}" ${r.addAnyway ? 'checked' : ''}
           onchange="setImportAddAnyway(${r._row}, this.checked, this.id)"> Add anyway</label>`
      : '';
    // Amber is "look before you import": no price, or held in another account.
    const tone = r.elsewhere ? 'warn' : r.status;
    return `<tr class="row-${tone}">
      <td style="color:var(--text-muted)">${r._row}</td>
      <td>
        <strong>${esc(r.name || '—')}</strong>
        ${sub ? `<div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${esc(sub)}</div>` : ''}
      </td>
      <td data-label="Type">${typeBadge(r.type)}</td>
      <td class="num" data-label="Shares">${r.quantity > 0 ? fmtN(r.quantity) : '—'}</td>
      <td class="num" data-label="Price">${r.price > 0 ? fmt$(r.price) : '—'}</td>
      <td class="status-${tone}">${esc(r.statusMsg)}${kindPicker}${dupCheck}</td>
    </tr>`;
  }).join('');

  document.getElementById('importPreview').style.display = '';
}

// One line per label that may not be his account's name. "Keep" is always the
// default: a merge into an existing account is his call, never a guess — the
// hint only says where these positions already are, and what choosing it does.
function importAccountMapHTML() {
  const known = knownImportAccounts();
  return importMapLabels().map((label, i) => {
    const chosen = importAccountMap.get(label) || '';
    // The label may already BE an account (his, or one an earlier import made):
    // that is what "Keep" means then, and it is not offered a second time.
    const own = known.find(a => sameAccount(a, label));
    const options = known.filter(a => a !== own);
    const rows = importRows.filter(r => r.status !== 'err' && r.csvAccount === label);
    const hits = options.map(a => rows.filter(r =>
      importHolders(r).some(h => sameAccount(h.account, a))).length);
    const n = Math.max(...hits), best = options[hits.indexOf(n)];
    const hint = n > 0 && chosen !== best
      ? `<div class="imp-map-hint">${n} of ${rows.length} position${rows.length !== 1 ? 's' : ''} ` +
        `${n === 1 ? 'is' : 'are'} already held in ${esc(best)} — choose it above to update ` +
        `${n === 1 ? 'it' : 'them'} instead.</div>`
      : '';
    return `<div class="imp-map-row">
      <span class="imp-map-label">${esc(label)}</span><span class="imp-map-arrow" aria-hidden="true">→</span>
      <select id="imp-acct-${i}" class="imp-acct" data-csv-label="${esc(label)}" aria-label="Account for ${esc(label)}"
        onchange="setImportAccount(this.dataset.csvLabel, this.value, this.id)">
        <option value="">${own ? `Keep in "${esc(own)}"` : `Keep "${esc(label)}" as a new account`}</option>
        ${options.map(a => `<option value="${esc(a)}" ${a === chosen ? 'selected' : ''}>${esc(a)}</option>`).join('')}
      </select>
      ${hint}
    </div>`;
  }).join('');
}

// Apply a new total quantity across one or more holding rows (a split pair
// gets the total distributed by its current ratio), recording ledger
// adjustments so TWR stays honest. Returns how many rows actually changed.
function applyQuantityUpdate(ids, newTotalQty, { price = null, source = 'manual', kind = 'adjustment' } = {}) {
  const rows = ids.map(mid => holdings.find(x => x.id === mid)).filter(Boolean);
  if (!rows.length) return 0;
  const oldTotal = rows.reduce((s, h) => s + h.quantity, 0);
  const now = new Date().toISOString();
  let changed = 0;
  rows.forEach((h, i) => {
    const share = rows.length === 1 ? 1
      : (oldTotal > 0 ? h.quantity / oldTotal : 1 / rows.length);
    const newQty = i === rows.length - 1
      ? +(newTotalQty - rows.slice(0, -1).reduce((s, x) => s + x.quantity, 0)).toFixed(6)
      : +(newTotalQty * share).toFixed(6);
    const qtyDelta = +(newQty - h.quantity).toFixed(6);
    const newPrice = price != null && price > 0 ? price : h.price;
    if (qtyDelta === 0 && newPrice === h.price) return;
    if (qtyDelta !== 0) {
      transactions.push({
        id: uid(), date: nyToday(), kind,
        holdingId: h.id, holdingName: h.name, units: qtyDelta,
        unitPrice: newPrice, amount: +(qtyDelta * newPrice).toFixed(2), source,
      });
    }
    if (newPrice !== h.price && newPrice > 0 && proxyEntryFor(h)) {
      h.calibration = { date: now, nav: newPrice };
    }
    h.quantity = newQty;
    h.price = newPrice;
    h.updated = now;
    changed++;
  });
  return changed;
}

function confirmImport() {
  let added = 0, updated = 0;
  importRows.filter(r => r.status !== 'err').forEach(r => {
    if (r.mode === 'same' || importHeldBack(r)) return;
    if (r.mode === 'update') {
      // Distributing across rows[] handles both a single match and a split
      // pair; keep the existing rows' account/type/sleeve — the CSV only
      // speaks for quantity and price.
      const kind = document.getElementById(`imp-kind-${r._row}`)?.value === 'dividend'
        ? 'dividend' : 'adjustment';
      if (applyQuantityUpdate(r.matchIds, r.applyQty, { price: r.applyPrice, source: 'import', kind })) updated++;
      return;
    }
    holdings.push({
      id: uid(), name: r.name, type: r.type,
      ticker:  r.ticker  || '',
      account: r.account || '',
      quantity: r.applyQty, price: r.applyPrice,   // a group's sum rides on its first row
      updated: new Date().toISOString(),
    });
    added++;
  });
  importRows = []; importAccountMap = new Map();
  document.getElementById('importPreview').style.display = 'none';
  markUnsaved(); render();
  const parts = [];
  if (added)   parts.push(`${added} added`);
  if (updated) parts.push(`${updated} updated`);
  toast(parts.length ? `Import applied: ${parts.join(', ')}` : 'Nothing to change');
}

function cancelImport() {
  importRows = []; importAccountMap = new Map();
  document.getElementById('importPreview').style.display = 'none';
}

// ─── CSV: template download ───────────────────────────────────────────────────
function downloadCSVTemplate() {
  const rows = [
    'Account Type,Investment Name,Ticker,Asset Class,Shares/Units,Price',
    'Roth IRA,Vanguard 500 Index Fund Admiral Shares,VFIAX,Domestic Stock,100.5,450.00',
    '401K,"Fidelity 500 Index Fund",FXAIX,Domestic Stock,50,175.00',
    'Brokerage,Apple Inc,AAPL,Stock,10,185.50',
    'Brokerage,SPDR S&P 500 ETF,SPY,ETF,25,480.00',
    'Brokerage,Bitcoin,BTC-USD,Crypto,0.5,',
    'Roth IRA,"Vanguard Total Bond Market Index",VBTLX,Bond,200,11.25',
  ].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
  a.download = 'portfolio_template.csv';
  a.click();
  toast('Template downloaded');
}

// ─── Add holding ──────────────────────────────────────────────────────────────
function addHolding() {
  const name    = document.getElementById('iName').value.trim();
  const ticker  = document.getElementById('iTicker').value.trim().toUpperCase();
  const type    = document.getElementById('iType').value;
  const account = document.getElementById('iAccount').value;
  const qty     = parseFloat(document.getElementById('iQty').value);
  const price   = parseFloat(document.getElementById('iPrice').value);

  if (!name)                     { toast('Enter an investment name.'); return; }
  if (isNaN(qty)   || qty <= 0)  { toast('Enter a valid quantity.'); return; }
  if (isNaN(price) || price < 0) { toast('Enter a valid price.'); return; }

  holdings.push({ id: uid(), name, ticker, type, account, quantity: qty, price, updated: new Date().toISOString() });
  markUnsaved(); render();
  document.getElementById('iName').value    = '';
  document.getElementById('iTicker').value  = '';
  document.getElementById('iAccount').selectedIndex = 0;
  document.getElementById('iQty').value     = '';
  document.getElementById('iPrice').value   = '';
  document.getElementById('fetchStatus').textContent = '';
  toast(`Added ${name}`);
}

// ─── Delete ───────────────────────────────────────────────────────────────────
// ✕ deleted a position in one tap, with no confirm and no undo: the audit
// removed a large position that way and autosave pushed the loss a second
// later (2026-10-03). It now asks first, naming the value, and
// keeps the holding for UNDO_DELETE_MS. Undo puts the same object back at the
// same index. Delete writes no ledger row, so the ledger is untouched either way.
// Since Drop 2 it takes the whole position: a split fund is one line and one
// Delete, so both its lots go — and come back — together (positionLots).
const UNDO_DELETE_MS = 10000;
let pendingUndo = null; // { lots: [{ holding, index }], timer }

function deleteHolding(id) {
  const lots = positionLots(id);
  if (!lots.length) return;
  const h = lots[0];
  const where = h.account ? ` (${h.account})` : '';
  if (!confirm(`Delete ${h.name}${where}, worth ${fmt$(lotsValue(lots))}?\n\n` +
               `You can undo this for 10 seconds.`)) return;
  // Indices in the array as it was, ascending, so Undo re-inserts in order.
  const removed = lots.map(x => ({ holding: x, index: holdings.indexOf(x) })).sort((a, b) => a.index - b.index);
  for (const r of [...removed].reverse()) holdings.splice(r.index, 1);
  const gone = x => lots.some(l => l.id === x);
  if (gone(editingId)) editingId = null;
  if (gone(quickPriceId)) quickPriceId = null;
  if (gone(splittingId)) splittingId = null;
  markUnsaved(); render();
  offerUndo(removed);
}

// Which holding, in the fewest characters that still tell two lots apart:
// two lots of one fund in different accounts share a name, and at 390 a long
// fund name after "Removed" truncated to its first few letters, so only the
// value told them apart.
function undoLabel(h) {
  return `${hasRealTicker(h) ? h.ticker.toUpperCase() : h.name}${h.account ? ` (${h.account})` : ''}`;
}

function offerUndo(lots) {
  if (pendingUndo) clearTimeout(pendingUndo.timer); // a second delete replaces the first's undo
  pendingUndo = { lots, timer: setTimeout(closeUndo, UNDO_DELETE_MS) };
  // Name and value apart, so a long name truncates and the value never does.
  // No "Removed" in front: he has just confirmed the delete, Undo says the
  // rest, and the word cost the account its room ("Removed VOO (Bro…" at 390).
  document.getElementById('undoToastMsg').textContent = undoLabel(lots[0].holding);
  document.getElementById('undoToastVal').textContent = `· ${fmt$(lotsValue(lots.map(r => r.holding)))}`;
  document.getElementById('undoToast').classList.add('show');
}

function closeUndo() {
  if (pendingUndo) clearTimeout(pendingUndo.timer);
  pendingUndo = null;
  document.getElementById('undoToast').classList.remove('show');
}

function undoDelete() {
  const u = pendingUndo;
  closeUndo();
  if (!u) return;
  // A cloud pull inside the window may already have brought it back.
  const missing = u.lots.filter(r => !holdings.some(x => x.id === r.holding.id));
  if (!missing.length) return;
  for (const r of missing) holdings.splice(Math.min(r.index, holdings.length), 0, r.holding);
  markUnsaved(); render();
  toast(`Restored ${undoLabel(u.lots[0].holding)}`);
}

// ─── Inline edit ──────────────────────────────────────────────────────────────
// Edit opens on the position (a split fund's two lots edit as one), in place
// of its line. On the phone the line is the only way in.
function startEdit(id) {
  editingId = positionKey(id); quickPriceId = null; splittingId = null;
  renderTable();
  document.getElementById(`he-row-${editingId}`)?.scrollIntoView?.({ block: 'nearest' });
}
function cancelEdit()  { editingId = null; renderTable(); }

function saveEdit(id) {
  const lots = positionLots(id);
  if (!lots.length) { editingId = null; renderTable(); return; }
  const h = lots[0], key = h.id, pair = lots.length > 1;
  // A field he left alone keeps the LIVE value, not the form's copy: the form
  // can be minutes old, and the boot refresh or a cloud pull may have moved
  // the price (or the phone the shares) underneath it. Writing the copy back
  // would undo that — and a stale price on a proxy fund would recalibrate it,
  // and an account the picker doesn't list would fall to Unassigned.
  const el = f => document.getElementById(`${f}-${key}`);
  const touched = f => !!el(f)?.dataset.dirty;
  const field = (f, live) => touched(f) ? el(f).value : live;
  const name    = String(field('en', h.name)).trim();
  const ticker  = String(field('etick', h.ticker || '')).trim();
  const type    = field('et', h.type);
  const account = field('eacc', h.account || '');
  const sleeve  = field('eslv', h.sleeve || '') || null;
  const qty     = parseFloat(field('eq', lotsQty(lots)));
  const price   = parseFloat(field('ep', h.price));

  if (!name || isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
    toast('Invalid values — check all fields.'); return;
  }
  if (!['en', 'etick', 'et', 'eacc', 'eslv', 'eq', 'ep'].some(touched)) {
    editingId = null; renderTable(); toast('No changes'); return;
  }
  const now = new Date().toISOString();
  if (pair) {
    // Both lots carry the shared fields, so they stay one position; the total
    // goes through the Update panel's path (ratio kept, a ledger row per lot).
    lots.forEach(x => Object.assign(x, { name, ticker, type, account }));
    applyQuantityUpdate(lots.map(x => x.id), qty,
      { price: touched('ep') && price > 0 ? price : null, source: 'manual' });
    if (touched('ep')) lots.forEach(x => { x.updated = now; });
  } else {
    const priceChanged = h.price !== price;
    const qtyDelta = qty - h.quantity;
    Object.assign(h, { name, ticker, type, account, sleeve, quantity: qty, price });
    // The price's age is what the stale badge reads: only a price he typed,
    // or a share count he changed, resets it — not a rename.
    if (touched('ep') || qtyDelta !== 0) h.updated = now;
    // A manually entered price on a proxy-tracked fund is a real NAV — recalibrate.
    if (priceChanged && price > 0 && proxyEntryFor(h)) {
      h.calibration = { date: now, nav: price };
    }
    // Ledger: a manual unit change is a statement true-up (or a real trade) —
    // record it so estimated auto-contributions reconcile against reality.
    if (qtyDelta !== 0) {
      transactions.push({
        id: uid(), date: nyToday(), kind: 'adjustment',
        holdingId: h.id, holdingName: h.name, units: +qtyDelta.toFixed(6),
        unitPrice: price, amount: +(qtyDelta * price).toFixed(2), source: 'manual',
      });
    }
  }
  editingId = null;
  markUnsaved(); render();
  toast('Updated');
}

// ─── Split holding ────────────────────────────────────────────────────────────
function startSplit(id) {
  editingId = null; quickPriceId = null; splittingId = id;
  renderTable();
}
function cancelSplit() { splittingId = null; renderTable(); }
function updateSplitPreview(id, totalQty = holdings.find(x => x.id === id)?.quantity ?? 0) {
  const pct  = parseFloat(document.getElementById(`sp-pct-${id}`)?.value) || 0;
  const pct2 = +(100 - pct).toFixed(4);
  const qty1 = totalQty * pct / 100;
  const qty2 = totalQty - qty1;
  const p2 = document.getElementById(`sp-pct2-${id}`);
  const q1 = document.getElementById(`sp-qty1-${id}`);
  const q2 = document.getElementById(`sp-qty2-${id}`);
  if (p2) p2.textContent = `${pct2}%`;
  if (q1) q1.textContent = `${fmtN(qty1)} units`;
  if (q2) q2.textContent = `${fmtN(qty2)} units`;
}
function confirmSplit(id) {
  const h = holdings.find(x => x.id === id);
  if (!h) { splittingId = null; renderTable(); return; }
  const pct  = parseFloat(document.getElementById(`sp-pct-${id}`).value);
  if (isNaN(pct) || pct <= 0 || pct >= 100) { toast('Enter a percentage between 1 and 99.'); return; }
  const slv1 = document.getElementById(`sp-slv1-${id}`).value || null;
  const slv2 = document.getElementById(`sp-slv2-${id}`).value || null;
  const qty1 = +(h.quantity * pct / 100).toFixed(6);
  const qty2 = +(h.quantity - qty1).toFixed(6);
  const now  = new Date().toISOString();
  const h1   = { ...h, id: uid(), quantity: qty1, sleeve: slv1, updated: now };
  const h2   = { ...h, id: uid(), quantity: qty2, sleeve: slv2, updated: now };
  holdings   = holdings.flatMap(x => x.id === id ? [h1, h2] : [x]);
  splittingId = null;
  markUnsaved(); render();
  toast(`Split into ${fmtN(qty1)} + ${fmtN(qty2)} units`);
}

// ─── Risk & Exposure ─────────────────────────────────────────────────────────
// Three honest views: employer-correlated concentration (salary + ESPP + any
// employer stock is ONE bet), look-through company exposure across index
// funds (static top-10 fact-sheet weights — lower bounds, dated), and the
// Swedish pension's fund-vs-krona return split from the stamped fxHistory.

// Employer identity lives in the PRIVATE synced doc (targets.employerName /
// targets.employerTickers), never in this public shell source — the code
// ships only neutral defaults. The ESPP account is employer-tied by nature.
const EMPLOYER_DEFAULTS = { name: 'Employer', tickers: [], accounts: ['ESPP - Trade'] };
const EMPLOYER_CAP_PCT = 10; // concentration alert threshold (% of portfolio)

function employerConfig() {
  return {
    name: targets.employerName || EMPLOYER_DEFAULTS.name,
    tickers: (Array.isArray(targets.employerTickers) ? targets.employerTickers : EMPLOYER_DEFAULTS.tickers)
      .map(t => String(t).toUpperCase()),
    accounts: EMPLOYER_DEFAULTS.accounts,
  };
}

// Approximate top-10 index weights (%), from public fact sheets. String
// values alias another entry. Truncated at top-10 by nature — the card shows
// "at least X%" and the as-of date, never a false total.
const FUND_TOP_HOLDINGS = {
  asOf: '2026-06',
  funds: {
    VOO: [['Nvidia', 7.5], ['Microsoft', 7.0], ['Apple', 5.8], ['Amazon', 4.2], ['Alphabet', 4.0],
          ['Meta', 3.0], ['Broadcom', 2.8], ['Tesla', 1.9], ['Berkshire Hathaway', 1.6], ['Eli Lilly', 1.4]],
    SPY: 'VOO', IVV: 'VOO', FXAIX: 'VOO', VFIAX: 'VOO', SWPPX: 'VOO', FNILX: 'VOO', SPLG: 'VOO',
    VTI: [['Nvidia', 6.4], ['Microsoft', 6.0], ['Apple', 5.0], ['Amazon', 3.6], ['Alphabet', 3.4],
          ['Meta', 2.6], ['Broadcom', 2.4], ['Tesla', 1.6], ['Berkshire Hathaway', 1.4], ['Eli Lilly', 1.2]],
    ITOT: 'VTI', FSKAX: 'VTI', SWTSX: 'VTI', FZROX: 'VTI',
    QQQ: [['Nvidia', 9.5], ['Microsoft', 8.8], ['Apple', 7.5], ['Amazon', 5.5], ['Broadcom', 5.2],
          ['Alphabet', 5.0], ['Meta', 4.8], ['Tesla', 3.5], ['Costco', 2.6], ['Netflix', 2.5]],
    VXUS: [['TSMC', 2.3], ['Tencent', 1.0], ['ASML', 1.0], ['SAP', 0.9], ['Nestlé', 0.8],
           ['Novo Nordisk', 0.8], ['Samsung', 0.8], ['Roche', 0.7], ['Shell', 0.7], ['AstraZeneca', 0.7]],
    IXUS: 'VXUS', VTIAX: 'VXUS', FTIHX: 'VXUS', FZILX: 'VXUS',
  },
  // Non-tickered funds matched by name fragment.
  byName: {
    'State Street S&P 500': 'VOO',
    'LF Global Index': [['Nvidia', 5.0], ['Microsoft', 4.6], ['Apple', 3.9], ['Amazon', 2.8],
      ['Alphabet', 2.6], ['Meta', 2.0], ['Broadcom', 1.8], ['Tesla', 1.2], ['JPMorgan', 1.0], ['Eli Lilly', 0.9]],
    'Länsförsäkringar Global Index': 'LF Global Index',
  },
};

function fundTopFor(h) {
  const F = FUND_TOP_HOLDINGS;
  const resolve = v => typeof v === 'string' ? (F.funds[v] ?? F.byName[v]) : v;
  const tick = (h.ticker || '').toUpperCase();
  if (tick && F.funds[tick]) return resolve(F.funds[tick]);
  for (const [frag, v] of Object.entries(F.byName)) {
    if ((h.name || '').includes(frag)) return resolve(v);
  }
  return null;
}

function employerExposure() {
  const tot = total();
  if (!(tot > 0)) return null;
  const emp = employerConfig();
  let value = 0;
  const parts = [];
  for (const h of holdings) {
    const v = h.quantity * h.price;
    if (!(v > 0)) continue;
    const byTicker = emp.tickers.includes((h.ticker || '').toUpperCase());
    const byAccount = emp.accounts.includes(h.account || '');
    if (byTicker || byAccount) {
      value += v;
      parts.push(`${h.ticker || h.name} (${byAccount && !byTicker ? 'ESPP' : 'stock'})`);
    }
  }
  if (!(value > 0)) return null;
  return { name: emp.name, value, pct: value / tot * 100, parts };
}

// Look-through: Σ fund value × top-10 weight, plus direct single-stock
// positions at 100%. Returns [{company, value, pct}] sorted desc — a LOWER
// BOUND (top-10 data only).
function lookThroughExposure() {
  const tot = total();
  if (!(tot > 0)) return [];
  const byCompany = {};
  const add = (company, v) => { byCompany[company] = (byCompany[company] || 0) + v; };
  for (const h of holdings) {
    const v = h.quantity * h.price;
    if (!(v > 0)) continue;
    const top = fundTopFor(h);
    if (top) {
      for (const [company, wPct] of top) add(company, v * wPct / 100);
    } else if (h.type === 'stock' && h.ticker && h.ticker.toUpperCase() !== 'N/A') {
      add(h.name || h.ticker, v);
    }
  }
  return Object.entries(byCompany)
    .map(([company, value]) => ({ company, value, pct: value / tot * 100 }))
    .sort((a, b) => b.value - a.value);
}

// Krona split: (1+local)×(1+fx)−1 between the first and last fxHistory stamp.
function sekDecomposition() {
  for (const h of holdings) {
    if (Array.isArray(h.fxHistory) && h.fxHistory.length >= 2) {
      const a = h.fxHistory[0], b = h.fxHistory[h.fxHistory.length - 1];
      if (!(a.nav > 0 && a.rate > 0 && b.nav > 0 && b.rate > 0)) continue;
      const local = b.nav / a.nav - 1;
      const fx = b.rate / a.rate - 1;
      return { name: h.name, from: a.date, to: b.date, local, fx, net: (1 + local) * (1 + fx) - 1 };
    }
  }
  return null;
}

// The Risk & Exposure card that drew these left the page in Drop 2
// (2026-10-04). The engines stay: Ask's brief carries all three
// (concentration.employer and .lookThrough, fx), the attention strip raises
// the employer chip, and the MCP answers concentration on its own.

// ─── "Since you last looked" ─────────────────────────────────────────────────
// The first question of every visit, answered as a RETURN-like number:
// value change minus external flows in the window, so a payroll contribution
// doesn't masquerade as growth. Per-device by design (localStorage).
const LAST_LOOK_KEY = 'portfolio_last_look';
let lastLookDone = false;
// The look the chip compared against. Kept because the stored stamp is
// overwritten with THIS visit straight after, and Ask answers the same question.
let lastLookPrev = null;

// Change since a previous look, minus what was paid in since.
function sinceLook(prev) {
  const flowsIn = externalFlows(transactions)
    .filter(f => f.date > prev.date)
    .reduce((s, f) => s + f.amount, 0);
  return { flowsIn, delta: total() - prev.value - flowsIn };
}

function renderLastLookChip() {
  if (lastLookDone || !holdings.length || !(total() > 0)) return;
  const el = document.getElementById('sinceLastLook');
  if (!el) return;
  lastLookDone = true; // computed once per visit, against the previous look
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(LAST_LOOK_KEY)); } catch { /* ignore */ }
  if (prev && prev.value > 0 && Date.now() - prev.ts > 6 * 3600000) {
    lastLookPrev = prev;
    const { flowsIn: flowsSince, delta } = sinceLook(prev);
    const pct = Math.abs(delta / prev.value * 100);
    const sign = delta >= 0 ? '+' : '−';
    const when = new Date(prev.ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    el.textContent = `Since ${when}: ${sign}${fmt$(Math.abs(delta))} (${sign}${pct.toFixed(1)}%)` +
      (flowsSince > 0 ? ` · excl. ${fmt$(flowsSince)} added` : '');
    el.className = 'total-updated ' + (delta >= 0 ? 'return-positive' : 'return-negative');
  }
  noteLook();
}

function noteLook() {
  if (!holdings.length || !(total() > 0)) return;
  localStorage.setItem(LAST_LOOK_KEY, JSON.stringify({
    ts: Date.now(), date: nyToday(), value: total(),
  }));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) noteLook(); });
window.addEventListener('pagehide', noteLook);

// ─── Update Positions panel ──────────────────────────────────────────────────
// One compact editor per account: every position is a single line with a big
// numeric input; a split fund (same name held as us_stock + intl_stock rows)
// collapses to ONE line — you type the statement's total and the current
// ratio is preserved. Saving records ledger adjustments via applyQuantityUpdate.
let updAccount = null;

const matchesAvanza = h => Object.keys(AVANZA_FUND_IDS).some(k => (h.name || '').includes(k));
// Money that moves one-for-one with the krona: see AVANZA_FUND_IDS.assetsInSek.
const holdsKronaAssets = h => Object.entries(AVANZA_FUND_IDS).some(([k, e]) => e.assetsInSek && (h.name || '').includes(k));

// A holding whose price nothing can fetch — the user maintains it by hand.
function isManualPrice(h) {
  const hasTicker = h.ticker && h.ticker.toUpperCase() !== 'N/A';
  return !hasTicker && !proxyEntryFor(h) && !matchesNavTable(h) && !matchesAvanza(h);
}

// Group an account's holdings into panel lines; split pairs become one line.
function updateLinesFor(acct) {
  const rows = holdings.filter(h => (h.account || '') === acct);
  const lines = [], used = new Set();
  for (const h of rows) {
    if (used.has(h.id)) continue;
    const pair = rows.filter(x => x.name === h.name &&
      (x.sleeve === 'us_stock' || x.sleeve === 'intl_stock'));
    if (pair.length === 2 && pair.some(x => x.id === h.id)) {
      pair.forEach(x => used.add(x.id));
      const totalQty = pair.reduce((s, x) => s + x.quantity, 0);
      const usH = pair.find(x => x.sleeve === 'us_stock');
      lines.push({
        ids: pair.map(x => x.id), name: h.name, ticker: '', label: '',
        qty: totalQty, price: h.price, manual: isManualPrice(h),
        splitPct: totalQty > 0 ? Math.round(usH.quantity / totalQty * 100) : 50,
      });
    } else {
      used.add(h.id);
      // "N/A · $<price>" on the 401K's lines: the stored placeholder ticker,
      // printed. Said as the Holdings line says it — the ticker, or the
      // ETF a fund is priced from (CPO, Drop 2 round 1).
      const px = !hasRealTicker(h) && proxyEntryFor(h);
      lines.push({
        ids: [h.id], name: h.name, ticker: h.ticker || '',
        label: hasRealTicker(h) ? h.ticker : px ? `via ${px.proxy}` : '',
        qty: h.quantity, price: h.price, manual: isManualPrice(h),
        splitPct: null,
      });
    }
  }
  return lines;
}

function openUpdatePanel(acct) {
  updAccount = acct;
  renderUpdatePanel();
  document.getElementById('updCard').style.display = '';
  document.getElementById('updCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function closeUpdatePanel() {
  updAccount = null;
  document.getElementById('updCard').style.display = 'none';
}
function switchUpdateAccount(acct) {
  updAccount = acct;
  renderUpdatePanel();
}

function renderUpdatePanel() {
  if (!updAccount) return;
  const sel = document.getElementById('updAccount');
  const accts = [...new Set(holdings.map(h => h.account || ''))].filter(Boolean);
  sel.innerHTML = accts.map(a =>
    `<option value="${esc(a)}" ${a === updAccount ? 'selected' : ''}>${esc(a)}</option>`).join('');

  const lines = updateLinesFor(updAccount);
  document.getElementById('updBody').innerHTML = lines.length ? lines.map(l => {
    const key = l.ids[0];
    const ageDays = l.manual && holdings.find(h => h.id === key)?.updated
      ? Math.floor((Date.now() - new Date(holdings.find(h => h.id === key).updated)) / 86400000)
      : null;
    return `<div class="upd-line">
      <div class="upd-line-info">
        <div class="upd-line-name">${esc(l.name)}
          ${l.splitPct != null ? `<span class="upd-split-badge">split ${l.splitPct}% US / ${100 - l.splitPct}% Intl</span>` : ''}
        </div>
        <div class="upd-line-sub">
          ${l.label ? esc(l.label) + ' · ' : ''}${fmt$(l.price)}${l.manual ? ` · manual price${ageDays != null && ageDays > 0 ? `, ${ageDays}d old` : ''}` : ''}
        </div>
      </div>
      <div class="upd-line-inputs">
        <input id="upd-q-${esc(key)}" type="number" inputmode="decimal" step="any" min="0"
               value="${esc(l.qty)}" aria-label="Shares for ${esc(l.name)}">
        ${l.manual ? `<input id="upd-p-${esc(key)}" type="number" inputmode="decimal" step="any" min="0"
               value="${esc(l.price)}" aria-label="Price for ${esc(l.name)}" class="upd-price">` : ''}
      </div>
    </div>`;
  }).join('') : '<p style="color:var(--text-muted);font-size:14px;">No holdings in this account.</p>';
}

function saveUpdatePanel() {
  if (!updAccount) return;
  let changed = 0;
  for (const l of updateLinesFor(updAccount)) {
    const key = l.ids[0];
    const qEl = document.getElementById(`upd-q-${key}`);
    if (!qEl) continue;
    const qty = parseFloat(qEl.value);
    if (isNaN(qty) || qty < 0) continue;
    const pEl = document.getElementById(`upd-p-${key}`);
    const price = pEl ? parseFloat(pEl.value) : null;
    changed += applyQuantityUpdate(l.ids, qty,
      { price: pEl && !isNaN(price) && price > 0 ? price : null, source: 'manual' });
  }
  if (changed) {
    markUnsaved(); render(); renderUpdatePanel();
    toast(`Updated ${changed} position${changed !== 1 ? 's' : ''} ✓`);
  } else {
    toast('No changes to save.');
  }
}

// Put a question in the Ask box — filled, never sent — and take him to it.
// For chips that live OUTSIDE the Ask card (the attention strip, This week's
// "Ask about this"): whatever he has already typed there wins, because he
// cannot see the box from where he tapped. The starters inside the card
// replace (askFill) — he is looking at the box. Both go through askFill so the
// function's log tags the question `src=insight`, not `typed` (Drop 2
// integration, 2026-10-04: the week card had its own copy that skipped it).
function askPrefill(question, src = 'insight') {
  const box = document.getElementById('askInput');
  if (!box) return;
  if (box.value.trim()) box.focus({ preventScroll: true });
  else askFill(question, src);
  document.getElementById('askCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ─── Needs attention strip ───────────────────────────────────────────────────
// Everything that requires a human: manual-price holdings gone stale, zero
// prices, failed refreshes, and overdue proxy calibrations — each one tap
// from its fix.
let lastRefreshFailures = new Set(); // holding ids, set by refreshAllPrices

function attentionItems() {
  const items = [];
  const now = Date.now();
  // One chip per position, keyed by its first lot — the key the holdings line
  // and the quick-price box use. A split fund's two lots share a name and a
  // price, so a failed refresh used to raise the same chip twice ("LF Global
  // Index: refresh failed" ×2 in the Drop 2 integration sandbox) above a list
  // that shows the fund once.
  const keyOf = new Map();
  for (const lots of positionsIn(holdings)) for (const x of lots) keyOf.set(x.id, lots[0].id);
  const raised = new Set();
  const raise = (h, label) => {
    const id = keyOf.get(h.id) ?? h.id;
    if (raised.has(id)) return;
    raised.add(id);
    items.push({ id, label: `${h.name}: ${label}`, kind: 'price' });
  };
  for (const h of holdings) {
    const age = h.updated ? Math.floor((now - new Date(h.updated)) / 86400000) : null;
    if (!(h.price > 0)) {
      raise(h, 'no price');
    } else if (lastRefreshFailures.has(h.id)) {
      raise(h, 'refresh failed');
    } else if (isManualPrice(h) && age != null && age >= 7) {
      raise(h, `manual price ${age}d old`);
    } else if (proxyEntryFor(h) && h.calibration?.date &&
               (now - new Date(h.calibration.date)) / 86400000 > PROXY_RECAL_NUDGE_DAYS) {
      raise(h, 'recalibrate NAV');
    }
  }
  const emp = employerExposure();
  if (emp && emp.pct > EMPLOYER_CAP_PCT) {
    items.push({ id: '__risk', kind: 'risk',
      label: `${emp.name} exposure ${emp.pct.toFixed(1)}% — over the ${EMPLOYER_CAP_PCT}% guideline` });
  }
  if (typeof cloudSyncIssue === 'function') {
    const err = cloudSyncIssue();
    if (err) items.push({ id: '__sync', kind: 'sync', label: `Cloud sync failing — ${err}` });
  }
  return items;
}

function renderAttentionStrip() {
  const el = document.getElementById('attnStrip');
  if (!el) return;
  const items = attentionItems();
  if (!items.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = `<div class="attn-title">Needs attention</div>` + items.map(it =>
    `<button class="attn-chip" data-hid="${esc(it.id)}">⚠ ${esc(it.label)}</button>`).join('');
  el.querySelectorAll('.attn-chip').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.hid;
      // The card this used to scroll to left the page in Drop 2. The chip
      // already says the figure; a tap puts the question in Ask — filled, not
      // sent — where the brief carries the employer aggregate and the
      // look-through.
      if (id === '__risk') {
        askPrefill('How concentrated am I in my employer, counting what my funds hold?');
        return;
      }
      if (id === '__sync') {
        toast('Cloud sync is failing — your edits are safe locally but not backed up. ' +
              (typeof cloudSyncIssue === 'function' ? (cloudSyncIssue() || '') : ''), 8000);
        return;
      }
      // Holdings is one closed row since Drop 2: open it, or the price box
      // the chip promises is drawn inside a collapsed card.
      const hc = document.getElementById('holdingsCard');
      if (hc) hc.open = true;
      startQuickPrice(id);
      document.getElementById(`qp-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById(`qp-${id}`)?.focus();
    };
  });
}

// ─── Quick inline price edit ──────────────────────────────────────────────────
// Keyed by the position: a price typed for a split fund lands on both lots,
// or they would stop matching and the fund would show as two lines again.
function startQuickPrice(id) {
  if (editingId) cancelEdit();
  quickPriceId = positionKey(id);
  renderTable();
}
function saveQuickPrice(id) {
  if (quickPriceId !== id) return;
  const inp = document.getElementById(`qp-${id}`);
  if (!inp) { quickPriceId = null; return; }
  const val = parseFloat(inp.value);
  if (!isNaN(val) && val >= 0) {
    const lots = positionLots(id);
    const now = new Date().toISOString();
    for (const h of lots) {
      h.price = val; h.updated = now;
      // Explicitly typed price on a proxy-tracked fund = real NAV — recalibrate.
      if (val > 0 && proxyEntryFor(h)) h.calibration = { date: now, nav: val };
    }
    if (lots.length) markUnsaved();
  }
  quickPriceId = null;
  render();
}
function cancelQuickPrice() {
  quickPriceId = null;
  renderTable();
}

// ─── Auto-fetch price ─────────────────────────────────────────────────────────
async function autoFetchPrice() {
  const ticker = (document.getElementById('iTicker').value.trim()
               || document.getElementById('iName').value.trim()).toUpperCase();
  if (!ticker) { toast('Enter a name or ticker first.'); return; }
  const type   = document.getElementById('iType').value;
  const btn    = document.getElementById('btnFetch');
  const status = document.getElementById('fetchStatus');
  btn.disabled = true; btn.textContent = '…';
  status.className = 'fetch-status'; status.textContent = 'Fetching…';

  const price = await fetchYahoo(ticker);
  btn.disabled = false;
  btn.textContent = TYPE_CONFIG[type]?.fetchLabel || '↻ Fetch';

  if (price !== null) {
    document.getElementById('iPrice').value = price.toFixed(2);
    const label = type === 'mutual_fund' ? 'NAV' : 'price';
    status.className = 'fetch-status ok';
    status.textContent = `✓ ${label} $${price.toFixed(2)} for ${ticker}`;
  } else {
    const hint = type === 'mutual_fund'
      ? 'Mutual fund NAV not found — enter NAV manually (updates once daily).'
      : 'Could not fetch — enter price manually.';
    status.className = 'fetch-status err';
    status.textContent = hint;
  }
}

async function fetchYahoo(ticker) {
  // Signed in → private edge proxy first (no third party sees the ticker).
  const viaProxy = await proxyGet('/quote', { ticker });
  // A price is a finite positive number or nothing. A string from a public
  // proxy's JSON used to be stored as-is and written into the page's HTML
  // (CISO, Drop 2 round 1).
  const num = p => (typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null);
  if (num(viaProxy?.price)) return viaProxy.price;

  const v8q1 = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
  const v8q2 = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
  const v7   = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}&fields=regularMarketPrice`;

  const stooqUrl = `https://stooq.com/q/l/?s=${ticker.toLowerCase()}.us&f=sd2t2ohlcv&h&e=csv`;

  const attempts = [
    { url: v8q1, creds: true  },
    { url: v8q2, creds: true  },
    { url: v7,   creds: true,  parser: 'v7' },
    { url: `https://corsproxy.io/?${encodeURIComponent(v8q1)}`, creds: false },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(v8q1)}`, creds: false },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(stooqUrl)}`, creds: false, parser: 'stooq' },
  ];

  for (const { url, creds, parser } of attempts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        ...(creds ? { credentials: 'include' } : {}),
      });
      clearTimeout(timer);
      if (!res.ok) { console.warn(`[portfolio] ${ticker}: HTTP ${res.status} — ${url}`); continue; }
      let price = null;
      if (parser === 'stooq') {
        const text = await res.text();
        const rows = text.trim().split('\n');
        const cols = rows[1]?.split(',');
        price = cols ? parseFloat(cols[6]) : null;
        if (isNaN(price)) price = null;
      } else {
        const data = await res.json();
        price = num(parser === 'v7'
          ? data?.quoteResponse?.result?.[0]?.regularMarketPrice
          : data?.chart?.result?.[0]?.meta?.regularMarketPrice);
      }
      if (price) { console.log(`[portfolio] ${ticker}: $${price} via ${url}`); return price; }
      console.warn(`[portfolio] ${ticker}: no price in response from ${url}`);
    } catch (e) {
      clearTimeout(timer);
      console.warn(`[portfolio] ${ticker}: ${e.message} — ${url}`);
    }
  }
  return null;
}

// ─── Proxy-tracked 401K CIT pricing ──────────────────────────────────────────
// Match a holding (no real ticker) against PROXY_TRACKED_FUNDS by partial name.
function proxyEntryFor(h) {
  if (h.ticker && h.ticker.toUpperCase() !== 'N/A') return null; // real ticker wins
  for (const [key, entry] of Object.entries(PROXY_TRACKED_FUNDS)) {
    if ((h.name || '').includes(key)) return entry;
  }
  return null;
}

// Fetch daily dividend-adjusted closes for a ticker (same fallback chain as fetchYahoo).
// Returns { timestamps, adjcloses } or null.
// `publicFallback: false` stops at the edge: a caller that must not hand his
// tickers to public CORS proxies gets null instead (CISO, Drop 2 round 1 — the
// This week card fell through to query1/query2/corsproxy.io/allorigins for any
// symbol the edge answered with a 502, or for all twelve when a token refresh
// was refused mid-fan-out, while signed in).
async function fetchYahooChart(ticker, range, { events = false, interval = '1d', publicFallback = true } = {}) {
  // Signed in → private edge proxy first.
  const viaProxy = await proxyGet('/chart', { ticker, range, interval, events: events ? '1' : '0' });
  if (viaProxy && viaProxy.timestamps?.length && viaProxy.adjcloses?.length) {
    return { timestamps: viaProxy.timestamps, adjcloses: viaProxy.adjcloses,
             closes: viaProxy.closes || viaProxy.adjcloses,
             dividends: viaProxy.events || {} };
  }
  if (!publicFallback) return null;

  const qs = `interval=${interval}&range=${range}${events ? '&events=div' : ''}`;
  // Index tickers carry a caret (^TNX). It must be percent-encoded in the URL
  // path, but NOT in the proxy call above — the edge function validates the
  // raw symbol against /^[A-Za-z0-9.^=-]{1,12}$/ and would reject "%5E".
  const t = ticker.replace(/\^/g, '%5E');
  const q1 = `https://query1.finance.yahoo.com/v8/finance/chart/${t}?${qs}`;
  const q2 = `https://query2.finance.yahoo.com/v8/finance/chart/${t}?${qs}`;
  const attempts = [
    { url: q1, creds: true },
    { url: q2, creds: true },
    { url: `https://corsproxy.io/?${encodeURIComponent(q1)}`, creds: false },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(q1)}`, creds: false },
  ];
  for (const { url, creds } of attempts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, ...(creds ? { credentials: 'include' } : {}) });
      clearTimeout(timer);
      if (!res.ok) { console.warn(`[proxy] ${ticker}: HTTP ${res.status} — ${url}`); continue; }
      const data = await res.json();
      const r = data?.chart?.result?.[0];
      const timestamps = r?.timestamp;
      const adjcloses = r?.indicators?.adjclose?.[0]?.adjclose ?? r?.indicators?.quote?.[0]?.close;
      if (timestamps?.length && adjcloses?.length) {
        // RAW closes are kept alongside the adjusted series. They are not
        // interchangeable: adjclose is a total-return series (back-adjusted for
        // distributions), raw close is the price. Attribution needs whichever
        // matches how the holding actually treats its dividends.
        return { timestamps, adjcloses, closes: r?.indicators?.quote?.[0]?.close ?? adjcloses,
                 dividends: r?.events?.dividends || {} };
      }
      console.warn(`[proxy] ${ticker}: no chart data from ${url}`);
    } catch (e) {
      clearTimeout(timer);
      console.warn(`[proxy] ${ticker}: ${e.message} — ${url}`);
    }
  }
  return null;
}

// ─── Dividend income (P3 — T12M projection) ─────────────────────────────────
// Free, keyless data check (2026-06-11): chart events=div returns trailing-12-
// month payments for every distributing holding; forward DECLARED calendars
// are paid-API territory, so income is projected from T12M — the plan's
// sanctioned fallback. Accumulating funds (the proxy-tracked 401K CITs, the
// Avanza pension fund) never distribute — dividends compound inside the NAV —
// so they're excluded with a note rather than faked.

// Pure: aggregate a Yahoo dividends map into a cacheable summary.
function summarizeDividends(divMap) {
  const payments = Object.values(divMap || {}).filter(d => d && d.amount > 0);
  if (!payments.length) return { t12mPerShare: 0, payments: 0, months: [] };
  const months = [...new Set(
    payments.sort((a, b) => a.date - b.date)
      .map(d => new Date(d.date * 1000).toLocaleString('en-US', { month: 'short' })),
  )];
  return {
    t12mPerShare: +payments.reduce((s, d) => s + d.amount, 0).toFixed(4),
    payments: payments.length,
    months,
  };
}

const hasRealTicker = h => h.ticker && h.ticker.toUpperCase() !== 'N/A';

async function updateDividends() {
  const btn = document.getElementById('btnDivRefresh');
  const tickered = holdings.filter(hasRealTicker);
  if (!tickered.length) { toast('No holdings with tickers to check.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '↻ Fetching…'; }
  let updated = 0;
  for (const h of tickered) {
    const chart = await fetchYahooChart(h.ticker.toUpperCase(), '1y', { events: true, interval: '1mo' });
    if (!chart) continue;
    h.dividends = { ...summarizeDividends(chart.dividends), updated: new Date().toISOString() };
    updated++;
  }
  if (updated > 0) markUnsaved();
  if (btn) { btn.disabled = false; btn.textContent = '↻ Update dividends'; }
  render();
  toast(`Dividend data updated for ${updated} of ${tickered.length} holdings`);
}

// Pure: income rows + totals from holdings carrying a dividends cache.
function dividendIncome(holdingsArr) {
  const rows = holdingsArr
    .filter(h => hasRealTicker(h) && h.dividends && h.dividends.t12mPerShare > 0)
    .map(h => ({
      name: h.name,
      ticker: h.ticker.toUpperCase(),
      account: h.account || 'Unassigned',
      perShare: h.dividends.t12mPerShare,
      annualIncome: +(h.dividends.t12mPerShare * h.quantity).toFixed(2),
      yieldPct: h.price > 0 ? +(h.dividends.t12mPerShare / h.price * 100).toFixed(2) : null,
      payments: h.dividends.payments,
      months: h.dividends.months,
    }))
    .sort((a, b) => b.annualIncome - a.annualIncome);
  const totalAnnual = +rows.reduce((s, r) => s + r.annualIncome, 0).toFixed(2);
  const accumulating = holdingsArr.filter(h => !hasRealTicker(h)).length;
  return { rows, totalAnnual, monthlyAvg: +(totalAnnual / 12).toFixed(2), accumulatingExcluded: accumulating };
}

// ─── Monte Carlo FIRE mode (P5) ──────────────────────────────────────────────
// "When does work become optional": N trials of monthly real-return walks
// from the current total + monthly contributions, against an FI target of
// annual spending ÷ SWR (4% default). Seeded PRNG so results are testable
// and reproducible. Real (inflation-adjusted) returns — results read in
// today's dollars. Defaults derived from the actual sleeve mix.

// Deterministic PRNG (mulberry32) + Box–Muller standard normal.
function makeRng(seed) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    let u = 0, v = 0;
    while (u === 0) u = uniform();
    while (v === 0) v = uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

// Default real return/volatility assumptions per sleeve, blended by the
// current allocation. Editable in the card — these are starting points.
const SLEEVE_ASSUMPTIONS = {
  us_stock: { mu: 0.05, sigma: 0.16 },
  intl_stock: { mu: 0.05, sigma: 0.17 },
  tilt: { mu: 0.05, sigma: 0.22 },
  bond: { mu: 0.015, sigma: 0.06 },
  other: { mu: 0.02, sigma: 0.08 },
};

function blendedAssumptions(holdingsArr) {
  const val = h => (h.quantity || 0) * (h.price || 0);
  const tot = holdingsArr.reduce((s, h) => s + val(h), 0);
  if (!(tot > 0)) return { mu: 0.04, sigma: 0.12 };
  let mu = 0, sigma = 0;
  for (const h of holdingsArr) {
    const a = SLEEVE_ASSUMPTIONS[h.sleeve || autoDetectSleeve(h)] || SLEEVE_ASSUMPTIONS.other;
    const w = val(h) / tot;
    mu += w * a.mu;
    sigma += w * a.sigma; // weighted-avg vol — conservative (ignores diversification)
  }
  return { mu: +mu.toFixed(4), sigma: +sigma.toFixed(4) };
}

// Pure Monte Carlo. Returns years-to-FI percentiles + success probabilities.
function simulateFire({ start, monthlyContrib, annualSpend, muAnnual, sigmaAnnual,
                        swr = 0.04, years = 50, trials = 1000, seed = 42 }) {
  if (!(annualSpend > 0) || !(swr > 0)) return null;
  const target = annualSpend / swr;
  if (start >= target) {
    return { fiTarget: +target.toFixed(0), alreadyFI: true, medianYears: 0, p10Years: 0, p90Years: 0,
             neverPct: 0, successByYears: Object.fromEntries([10, 15, 20, 25, 30].map(y => [y, 100])) };
  }
  const normal = makeRng(seed);
  const muM = muAnnual / 12;
  const sigmaM = sigmaAnnual / Math.sqrt(12);
  const months = years * 12;
  const yearsToFI = [];
  for (let t = 0; t < trials; t++) {
    let w = start;
    let hit = null;
    for (let m = 1; m <= months; m++) {
      w = w * (1 + muM + sigmaM * normal()) + monthlyContrib;
      if (w >= target) { hit = m / 12; break; }
    }
    yearsToFI.push(hit);
  }
  const reached = yearsToFI.filter(y => y !== null).sort((a, b) => a - b);
  const successByYears = {};
  for (const y of [10, 15, 20, 25, 30]) {
    successByYears[y] = +(yearsToFI.filter(t => t !== null && t <= y).length / trials * 100).toFixed(1);
  }
  // Percentiles over ALL trials (never-reached counts as worse than any time)
  const pctAll = p => {
    const idx = Math.floor(p * trials);
    if (idx >= reached.length) return null; // that percentile never reaches FI
    return +reached[idx].toFixed(1);
  };
  return {
    fiTarget: +target.toFixed(0),
    alreadyFI: false,
    medianYears: pctAll(0.5),
    p10Years: pctAll(0.1),   // lucky markets
    p90Years: pctAll(0.9),   // unlucky markets
    neverPct: +((trials - reached.length) / trials * 100).toFixed(1),
    successByYears,
    assumptionNote: `real (inflation-adjusted) returns μ=${(muAnnual * 100).toFixed(1)}%, σ=${(sigmaAnnual * 100).toFixed(1)}%/yr, SWR ${(swr * 100).toFixed(1)}%, ${trials} trials`,
  };
}

function monthlyContribFromRules() {
  const perMonth = { biweekly: 26 / 12, semimonthly: 2, monthly: 1 };
  return +contributionRules.reduce((s, r) => s + (r.amount || 0) * (perMonth[r.cadence] || 1), 0).toFixed(0);
}

function runFireSim() {
  const spend = parseFloat(document.getElementById('fireSpend').value);
  const contrib = parseFloat(document.getElementById('fireContrib').value) || 0;
  const mu = parseFloat(document.getElementById('fireMu').value) / 100;
  const sigma = parseFloat(document.getElementById('fireSigma').value) / 100;
  const out = document.getElementById('fireResult');
  if (!(spend > 0)) { out.innerHTML = '<p class="adv-placeholder">Enter your target annual spending.</p>'; return; }
  // A what-if stays a what-if. Simulate used to write the typed spend back to
  // targets.fireAnnualSpend, so trying one figure after another silently
  // changed the number Ask and the MCP read, and pushed it to the cloud (audit
  // 2026-10-03: five what-ifs in a row left the last one saved). Saving is now
  // its own button, saveFireSpend.
  const saved = +targets.fireAnnualSpend > 0 ? +targets.fireAnnualSpend : null;
  const sim = simulateFire({
    start: total(), monthlyContrib: contrib, annualSpend: spend,
    muAnnual: isNaN(mu) ? 0.04 : mu, sigmaAnnual: isNaN(sigma) ? 0.12 : sigma,
    seed: 42,
  });
  if (!sim) { out.innerHTML = '<p class="adv-placeholder">Could not simulate — check inputs.</p>'; return; }
  // All values app-computed.
  let html = `<div class="adv-rec-box">`;
  if (sim.alreadyFI) {
    html += `<div class="adv-sleeve-name" style="color:#16a34a;">Work is already optional 🎉</div>
      <div class="adv-detail">Your portfolio exceeds the FI target of ${fmt$(sim.fiTarget)} (${fmt$(sim.fiTarget)} = spending ÷ 4%).</div>`;
  } else {
    html += `<div class="adv-sleeve-name">Work becomes optional in ≈ ${sim.medianYears === null ? '>50' : sim.medianYears} years <span style="font-size:13px;font-weight:400;color:var(--text-secondary);">(median of 1,000 futures)</span></div>
      <div class="adv-detail" style="margin-top:4px;">
        FI target: <strong>${fmt$(sim.fiTarget)}</strong> ·
        Lucky markets (p10): <strong>${sim.p10Years === null ? '>50' : sim.p10Years} yrs</strong> ·
        Unlucky (p90): <strong>${sim.p90Years === null ? '>50' : sim.p90Years} yrs</strong>
        ${sim.neverPct > 0 ? ` · never within 50 yrs: ${sim.neverPct}%` : ''}
      </div>
      <div class="fire-odds-label">Probability of reaching FI within…</div>
      <div class="fire-odds" role="list">${[10, 15, 20, 25, 30].map(y =>
        `<div class="fire-odds-cell" role="listitem" data-years="${y}"><span class="fire-odds-h">${y}y</span><span class="fire-odds-v">${sim.successByYears[y]}%</span></div>`).join('')}</div>`;
  }
  html += `<div style="font-size:11px;color:var(--text-secondary);margin-top:8px;">${esc(sim.assumptionNote || '')} · today's dollars · a model, not advice</div>`;
  if (saved !== spend) {
    html += `<div class="fire-whatif">What-if only · ${saved
      ? `your saved FI spend is ${fmt$(saved)}` : 'no FI spend saved yet'}</div>`;
  }
  out.innerHTML = html + `</div>`;
}

// The one FIRE input with no derivable default. Kept with the targets so it
// syncs like them, and so Ask can answer "am I on pace?" without the card.
function saveFireSpend() {
  const spend = parseFloat(document.getElementById('fireSpend').value);
  if (!(spend > 0)) { toast('Enter your target annual spending first.'); return; }
  if (targets.fireAnnualSpend !== spend) { targets.fireAnnualSpend = spend; markUnsaved(); }
  runFireSim();
  toast(`Saved ${fmt$(spend)} as your FI spend`);
}

function renderFireDefaults() {
  const card = document.getElementById('fireCard');
  if (!card) return;
  card.style.display = holdings.length > 0 ? '' : 'none';
  if (holdings.length === 0) return;
  const contribEl = document.getElementById('fireContrib');
  if (contribEl && !contribEl.value) contribEl.value = String(monthlyContribFromRules() || '');
  const spendEl = document.getElementById('fireSpend');
  if (spendEl && !spendEl.value && targets.fireAnnualSpend > 0) spendEl.value = String(targets.fireAnnualSpend);
  const { mu, sigma } = blendedAssumptions(holdings);
  const muEl = document.getElementById('fireMu');
  const sigmaEl = document.getElementById('fireSigma');
  if (muEl && !muEl.dataset.touched) muEl.value = (mu * 100).toFixed(1);
  if (sigmaEl && !sigmaEl.dataset.touched) sigmaEl.value = (sigma * 100).toFixed(1);
}

// Pure: what the dividend cache holds — how many tickered holdings carry
// T12M data, and when the newest of them was fetched. The income table that
// read it left with the Dividend Income card in Drop 2: Ask answers income
// by account from this cache (brief.income), and the MCP from the file.
function dividendCacheStatus(holdingsArr = holdings) {
  const tickered = holdingsArr.filter(hasRealTicker);
  const cached = tickered.filter(h => h.dividends && h.dividends.updated);
  const newest = cached.map(h => String(h.dividends.updated)).sort().at(-1) || null;
  return { tickered: tickered.length, cached: cached.length, newest };
}

function renderDividendSection() {
  const sec = document.getElementById('divSec');
  if (!sec) return;
  const st = dividendCacheStatus();
  sec.style.display = st.tickered ? '' : 'none';
  const meta = document.getElementById('planDivMeta');
  if (meta) meta.textContent = st.newest
    ? `Fetched ${shortDate(st.newest)} · ${st.cached} of ${st.tickered} holdings`
    : 'Not fetched yet';
}

// Pure: estimated NAV from a calibration point and an adjclose series.
// Uses the last bar at-or-before the calibration date as the anchor; null-gaps skipped.
// Returns null when the series doesn't cover the calibration date.
function computeProxyEstimate(cal, timestamps, adjcloses) {
  if (!cal || !(cal.nav > 0) || !timestamps?.length || !adjcloses?.length) return null;
  const calSec = Math.floor(new Date(cal.date).getTime() / 1000);
  if (isNaN(calSec)) return null;
  let calAdj = null, latestAdj = null;
  for (let i = 0; i < timestamps.length; i++) {
    const a = adjcloses[i];
    if (a == null || !(a > 0)) continue;
    if (timestamps[i] <= calSec) calAdj = a;
    latestAdj = a;
  }
  if (!(calAdj > 0) || !(latestAdj > 0)) return null;
  return cal.nav * (latestAdj / calAdj);
}

// Estimate a proxy-tracked holding's NAV. Seeds calibration from the last
// manually-set price on first use. Returns price (USD) or null on failure.
async function fetchProxyNav(h) {
  const entry = proxyEntryFor(h);
  if (!entry) return null;
  if (!h.calibration || !(h.calibration.nav > 0)) {
    if (!(h.price > 0)) return null;
    h.calibration = { date: h.updated || new Date().toISOString(), nav: h.price };
  }
  const ageDays = (Date.now() - new Date(h.calibration.date).getTime()) / 86400000;
  const range = ageDays <= 25 ? '1mo' : ageDays <= 85 ? '3mo' : ageDays <= 170 ? '6mo'
              : ageDays <= 360 ? '1y' : ageDays <= 720 ? '2y' : '5y';
  const chart = await fetchYahooChart(entry.proxy, range);
  if (!chart) return null;
  const est = computeProxyEstimate(h.calibration, chart.timestamps, chart.adjcloses);
  if (est === null) {
    console.warn(`[proxy] ${h.name}: series from ${entry.proxy} (${range}) didn't cover calibration ${h.calibration.date}`);
    return null;
  }
  console.log(`[proxy] ${h.name}: NAV ≈ $${est.toFixed(4)} via ${entry.proxy} (calibrated ${String(h.calibration.date).slice(0, 10)} @ $${h.calibration.nav})`);
  return est;
}

// ─── Avanza price fetch (Swedish pension funds, SEK→USD) ─────────────────────
// The day the NAV is FOR, which is not the day it was fetched. The stamp's
// `date` is when the app saw it; Avanza publishes LF Global a day or more
// behind (2026-10-04, a Sunday: navDate 2026-10-01 — the very NAV stamped
// "2026-10-03"). Without it the pension's weekly move compared
// mismatched days and read as currency (insights-content.md §13). Avanza's
// guide sends "2026-10-01T00:00:00"; the edge /avanza passes it through.
function avanzaNavDate(d) {
  const m = typeof d?.navDate === 'string' && d.navDate.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Returns price in USD, or null on failure.
// Side-effect: if the fund has splitByCountry, also rebalances the us_stock/intl_stock
// quantity split across same-named holdings using live Avanza country allocation data.
async function fetchAvanza(name) {
  const entry = Object.entries(AVANZA_FUND_IDS).find(([k]) => name.includes(k))?.[1] ?? null;
  if (!entry) { console.warn(`[avanza] no ID configured for "${name}"`); return null; }
  const avanzaId = entry.id ?? entry; // support both { id } and plain string

  // Fetch fund data by ID via GET
  const infoUrl = `https://www.avanza.se/_api/fund-guide/guide/${avanzaId}`;
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(infoUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(infoUrl)}`,
  ];

  let fundData = null;
  // Signed in → private edge proxy first.
  const viaProxy = await proxyGet('/avanza', { id: avanzaId });
  if (viaProxy && viaProxy.nav) fundData = viaProxy;
  for (const proxy of fundData ? [] : proxies) {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 9000);
    try {
      const res = await fetch(proxy, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) { console.warn(`[avanza] HTTP ${res.status} — ${proxy}`); continue; }
      fundData = await res.json();
      if (fundData?.nav) { console.log(`[avanza] ${name} (id ${avanzaId}): ${fundData.nav} SEK via ${proxy}`); break; }
      console.warn(`[avanza] no nav in response for "${name}"`, fundData);
      fundData = null;
    } catch (e) { clearTimeout(t); console.warn(`[avanza] ${e.message} — ${proxy}`); }
  }
  if (!fundData?.nav) return null;

  // Auto-rebalance us_stock / intl_stock quantity split using live country data
  if (entry.splitByCountry && fundData.countryChartData?.length) {
    const usPct = fundData.countryChartData.find(c => c.countryCode === 'US')?.y ?? null;
    if (usPct !== null) rebalanceCountrySplit(name, usPct);
  }

  // Convert SEK → USD: private edge proxy first, then two public sources.
  // Return null on total failure to avoid storing SEK as USD.
  const viaFxProxy = await proxyGet('/fx', { from: 'SEK', to: 'USD' });
  // Frankfurter moved to api.frankfurter.dev/v1. The old host answers with a
  // 301 that carries no CORS header, so in the browser this source had been
  // failing outright and every signed-out krona rate came from the second
  // one (checked 2026-10-04 in Chromium: "blocked by CORS policy"; the new
  // host returns the same { rates: { USD } }). The CSP's connect-src names
  // the new host. v1 is the ECB reference rate every stored stamp was taken
  // at; its successor, /v2/rates, quoted a different rate for the same day.
  const fxSources = [
    'https://api.frankfurter.dev/v1/latest?from=SEK&to=USD',
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/sek.json',
  ];
  for (const url of viaFxProxy?.rate ? ['proxy'] : fxSources) {
    try {
      const fxData = url === 'proxy'
        ? null
        : await (await fetch(url, { signal: AbortSignal.timeout(7000) })).json();
      // proxy: { rate } · Frankfurter: { rates: { USD } } · fawazahmed0: { sek: { usd } }
      const sekToUsd = url === 'proxy'
        ? viaFxProxy.rate
        : (fxData?.rates?.USD ?? fxData?.sek?.usd ?? null);
      if (sekToUsd) {
        const navUSD = fundData.nav * sekToUsd;
        // P1c: stamp the SEK-native NAV + FX rate (one row per day, capped)
        // on every same-named holding, so the pension's USD return can be
        // decomposed into fund-vs-krona once two stamps exist. Same
        // accrue-from-now philosophy as the ledger epoch.
        const today = nyToday();
        const navDate = avanzaNavDate(fundData);
        for (const h of holdings.filter(x => x.name === name)) {
          if (!Array.isArray(h.fxHistory)) h.fxHistory = [];
          const row = { date: today, nav: fundData.nav, rate: sekToUsd, currency: 'SEK' };
          if (navDate) row.navDate = navDate;
          const i = h.fxHistory.findIndex(r => r.date === today);
          if (i >= 0) h.fxHistory[i] = row; else h.fxHistory.push(row);
          if (h.fxHistory.length > 400) h.fxHistory = h.fxHistory.slice(-400);
        }
        console.log(`[avanza] ${name}: ${fundData.nav} SEK → $${navUSD.toFixed(4)} USD (rate: ${sekToUsd})`);
        return navUSD;
      }
    } catch (_) { console.warn(`[avanza] FX source failed: ${url}`); }
  }
  console.warn('[avanza] All FX sources failed — skipping price update to avoid storing SEK as USD');
  return null;
}

// Rebalance the us_stock / intl_stock quantity split for a fund across same-named holdings.
// usPct is the US allocation % from Avanza (e.g. 73.27).
function rebalanceCountrySplit(name, usPct) {
  const paired = holdings.filter(h => h.name === name && (h.sleeve === 'us_stock' || h.sleeve === 'intl_stock'));
  if (paired.length !== 2) return; // only works when exactly two sleeve rows exist
  const totalQty = paired.reduce((s, h) => s + h.quantity, 0);
  const usH   = paired.find(h => h.sleeve === 'us_stock');
  const intlH = paired.find(h => h.sleeve === 'intl_stock');
  const newUsQty = parseFloat((totalQty * usPct / 100).toFixed(6));
  usH.quantity   = newUsQty;
  intlH.quantity = parseFloat((totalQty - newUsQty).toFixed(6));
  console.log(`[avanza] ${name}: country split updated ${usPct.toFixed(2)}% US — us_stock ${usH.quantity}, intl_stock ${intlH.quantity}`);
}

// Look up static NAV from FUND_NAV_TABLE by partial name match
function fetchFromNavTable(name) {
  for (const [key, entry] of Object.entries(FUND_NAV_TABLE)) {
    if (name.includes(key) && entry.nav > 0) return entry.nav;
  }
  return null;
}

// Check if a holding matches the NAV lookup table
function matchesNavTable(h) {
  return Object.keys(FUND_NAV_TABLE).some(key => h.name.includes(key));
}

async function refreshHoldingPrice(id) {
  // One fetch for the position; the price lands on every lot (positionLots).
  const lots = positionLots(id);
  const h = lots[0];
  if (!h) return;
  const hasTicker = h.ticker && h.ticker.toUpperCase() !== 'N/A';
  const label  = h.type === 'mutual_fund' ? 'NAV' : 'price';
  const displayKey = hasTicker ? h.ticker.toUpperCase() : h.name;
  toast(`Fetching ${label} for ${displayKey}…`);
  const price = hasTicker
    ? await fetchYahoo(h.ticker.toUpperCase())
    : (proxyEntryFor(h) ? await fetchProxyNav(h)
       : (fetchFromNavTable(h.name) ?? await fetchAvanza(h.name)));
  if (price !== null) {
    const now = new Date().toISOString();
    // The live copies: a cloud pull during the fetch replaces the objects.
    for (const l of lots) {
      const x = holdings.includes(l) ? l : holdings.find(y => y.id === l.id);
      if (x) { x.price = price; x.updated = now; }
    }
    render();
    toast(`${h.name} ${label} → ${fmt$(price)}`);
    await persistMarketData();   // a fetched price is not an edit — see persistMarketData
  } else {
    toast(`Could not fetch "${displayKey}" — enter ${label} manually.`);
  }
}

async function refreshAllPrices({ silent = false } = {}) {
  if (refreshing) return;
  refreshing = true;

  const noTicker = h => !h.ticker || h.ticker.toUpperCase() === 'N/A';
  const useAvanza = h =>
    /swedish|pension/i.test(h.account || '') ||
    (noTicker(h) && /^lf\b|länsförsäkring/i.test(h.name));
  // One fetch per position: a split fund's lots take the same price, or they
  // stop matching and the fund shows as two lines (positionsIn). When the
  // second of two separate fetches failed, that is exactly what happened.
  const lotsOf = new Map(positionsIn(holdings).map(lots => [lots[0], lots.map(x => x.id)]));
  const fetchable = [...lotsOf.keys()].filter(h => {
    const key = (h.ticker || '').toUpperCase().trim();
    return (key && key !== 'N/A') || useAvanza(h) || matchesNavTable(h) || !!proxyEntryFor(h);
  });
  if (!fetchable.length) {
    refreshing = false;
    if (!silent) toast('No fetchable tickers found.');
    return;
  }

  // The button is a bare ↻ since Drop 2; progress goes to the status line
  // under the total, and aria-busy says it to a screen reader (and a test).
  const btn = document.getElementById('btnRefreshAll');
  if (!silent) { btn.disabled = true; }
  btn.setAttribute('aria-busy', 'true');
  setRefreshProgress(`updating prices 0/${fetchable.length}…`);

  let updated = 0, failed = 0;
  const failedTickers = [];
  const failedIds = new Set();
  for (const f of fetchable) {
    const hasRealTicker = f.ticker && f.ticker.toUpperCase() !== 'N/A';
    const lookup = (hasRealTicker ? f.ticker : f.name).toUpperCase();
    const price  = useAvanza(f) ? await fetchAvanza(f.name)
                 : proxyEntryFor(f) ? await fetchProxyNav(f)
                 : matchesNavTable(f) ? fetchFromNavTable(f.name)
                 : await fetchYahoo(lookup);
    // Boot runs this refresh and the sign-in sync side by side, so a pull can
    // replace `holdings` while a fetch is in flight. Land the price on the
    // holding that is live now; writing it onto the object the loop started
    // with would strand it, and the pulled copy — whose prices are only as
    // fresh as the other device's last edit (persistMarketData) — would stay
    // on screen until the next refresh.
    const ids = lotsOf.get(f);
    const live = ids.map(id => id === f.id && holdings.includes(f) ? f
      : holdings.find(x => id != null && x.id === id)).filter(Boolean);
    if (price !== null && live.length) {
      const now = new Date().toISOString();
      for (const h of live) { h.price = price; h.updated = now; }
      updated++;
    } else if (price === null) {
      failed++;
      failedTickers.push(lookup);
      ids.forEach(id => failedIds.add(id));
    }
    setRefreshProgress(`updating prices ${updated + failed}/${fetchable.length}…`);
    render();
  }

  btn.disabled = false; btn.removeAttribute('aria-busy');

  lastRefreshFailures = failedIds;
  renderAttentionStrip();
  lastRefreshed = new Date();
  updateRefreshLabel();

  if (!silent) {
    const msg = failed === 0
      ? `Updated ${updated} prices ✓`
      : `Updated ${updated} ✓  |  Failed: ${failedTickers.join(', ')} — enter manually`;
    toast(msg, 5000);
  }

  // One write, and not a push: prices are market data, not an edit — see
  // persistMarketData. (This used to be markUnsaved() plus a direct
  // autoSaveToServer(): two cloud pushes per refresh.) Full payload to disk —
  // never drop the ledger.
  if (updated > 0) {
    try { await persistMarketData(); } catch (_) { /* offline — no-op */ }
  }

  refreshing = false;
  // The week card held its cache write while prices were landing (a NAV
  // stamped mid-refresh changes the pension's line); write it now, with the
  // prices this refresh ended on (Drop 2 round 2).
  if (weekCharts) renderWeekCard();
}

// ─── Refresh label ("prices just now / X min ago") ───────────────────────────
// The second half of the header's one status line ("Saved 11:48 AM · prices
// 2 min ago"); lower case because it follows the saved time.
function updateRefreshLabel() {
  const el = document.getElementById('lastRefreshedLabel');
  // Mid-refresh the line shows progress; the minute timer must not cover it.
  if (!el || !lastRefreshed || document.getElementById('btnRefreshAll')?.getAttribute('aria-busy') === 'true') return;
  const mins = Math.round((Date.now() - lastRefreshed) / 60000);
  el.textContent = mins < 1 ? 'prices just now' : `prices ${mins} min ago`;
}
function setRefreshProgress(text) {
  const el = document.getElementById('lastRefreshedLabel');
  if (el) el.textContent = text;
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
function exportCSV() {
  if (!holdings.length) { toast('Nothing to export.'); return; }
  const tot = total();
  const rows = [...holdings]
    .sort((a,b) => (b.quantity*b.price) - (a.quantity*a.price))
    .map(h => {
      const val = h.quantity * h.price;
      const pct = tot > 0 ? (val / tot * 100).toFixed(2) : '0.00';
      const sleeve = getSleeve(h);
      return `"${h.name}","${h.ticker||''}",${h.quantity},${h.price},${val.toFixed(2)},${pct},${h.type||'stock'},"${h.account||''}","${sleeve}"`;
    });
  const blob = new Blob([
    'Investment Name,Ticker,Shares/Units,Price,Value,Allocation%,Type,Account Type,Sleeve\n' + rows.join('\n')
  ], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `portfolio_${nyToday()}.csv`;
  a.click();
  toast('CSV exported');
}

// ─── Render: Account Tiles ────────────────────────────────────────────────────
// Pure: the date an account's share counts were last set by hand — a
// statement typed into Update positions, an Edit, a CSV import. Accruals a
// contribution rule estimated are not a statement, so they don't count. A row
// whose holding was since deleted (the Sep 13 pension lot) still belongs to
// the account through its holdingName.
function lastPositionsUpdate(acct, holdingsArr = holdings, txns = transactions) {
  const inAcct = holdingsArr.filter(h => (h.account || 'Unassigned') === acct);
  const ids = new Set(inAcct.map(h => h.id));
  const names = new Set(inAcct.map(h => h.name));
  const live = new Set(holdingsArr.map(h => h.id));
  let newest = null;
  for (const t of txns || []) {
    if (!t || !t.date || t.source === 'auto-rule' || t.estimated) continue;
    const mine = ids.has(t.holdingId) || (!live.has(t.holdingId) && names.has(t.holdingName));
    if (mine && (!newest || t.date > newest)) newest = t.date;
  }
  return newest;
}

function renderAccountTiles() {
  const tot = total();
  const el  = document.getElementById('accountTiles');

  if (!holdings.length) { el.style.display = 'none'; return; }
  el.style.display = '';

  const acctTotals = getAccountTotals();
  const sorted = Object.entries(acctTotals).sort(([,a],[,b]) => b - a);

  // The fourth line was "✎ update positions" on every tile. It is now the
  // date his share counts were last set, so a stale account (one not updated
  // in weeks) shows itself without a tap; the tile is still the button.
  el.innerHTML = sorted.map(([acct, val], i) => {
    const pct   = tot > 0 ? (val / tot * 100).toFixed(1) : '0.0';
    const color = ACCT_COLORS[i % ACCT_COLORS.length];
    const asOf  = lastPositionsUpdate(acct);
    const asOfText = asOf ? `Updated ${shortDate(asOf)}` : '✎ Update positions';
    return `<div class="account-tile" style="border-top-color:${color}" role="button" tabindex="0"
      data-acct="${esc(acct)}" aria-label="${esc(acct)}, ${esc(fmt$0(val))}, ${pct}% of portfolio. ${esc(asOfText)}. Update positions."
      title="Update positions in ${esc(acct)}">
      <div class="account-tile-name">${esc(acct)}</div>
      <div class="account-tile-value">${fmt$0(val)}</div>
      <div class="account-tile-pct">${pct}%</div>
      <div class="account-tile-hint">${esc(asOfText)}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.account-tile').forEach(tile => {
    tile.onclick = () => openUpdatePanel(tile.dataset.acct);
    tile.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') openUpdatePanel(tile.dataset.acct); };
  });
}

// ─── Render: Holdings Table ───────────────────────────────────────────────────
// ─── Recurring contributions (P1a — ledger foundation) ───────────────────────
// A rule auto-accrues payroll buys between statements: each due pay date adds
// amount/price units (estimated at the CURRENT price — past dates use today's
// best estimate) and writes a ledger transaction. Entering real statement
// values later overwrites quantity and logs an 'adjustment', so drift never
// compounds. Idempotent via rule.lastAppliedThrough.
// NOTE: all interpolated values below are esc()-escaped or app-generated,
// matching the app's existing escaped-template render pattern.

const CADENCE_LABELS = { biweekly: 'every 2 weeks', semimonthly: '1st & 15th', monthly: 'monthly' };

// Pure: ISO dates (YYYY-MM-DD) due after lastAppliedThrough (or from the
// anchor inclusive when never applied), up to and including `throughISO`.
function nextPayDates(rule, throughISO) {
  const anchor = String(rule.anchorDate || '').slice(0, 10);
  const through = String(throughISO).slice(0, 10);
  if (!anchor || anchor > through) return [];
  const after = String(rule.lastAppliedThrough || '').slice(0, 10);
  const out = [];
  const pushIfDue = iso => { if (iso <= through && (!after || iso > after) && iso >= anchor) out.push(iso); };

  if (rule.cadence === 'biweekly') {
    const start = new Date(anchor + 'T00:00:00Z').getTime();
    const end = new Date(through + 'T00:00:00Z').getTime();
    for (let t = start, i = 0; t <= end && i < 500; t += 14 * 86400000, i++) {
      pushIfDue(new Date(t).toISOString().slice(0, 10));
    }
  } else if (rule.cadence === 'semimonthly') {
    const [ay, am] = anchor.split('-').map(Number);
    const [ty, tm] = through.split('-').map(Number);
    for (let y = ay, m = am, i = 0; (y < ty || (y === ty && m <= tm)) && i < 500; i++) {
      for (const day of [1, 15]) {
        pushIfDue(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
      }
      m++; if (m > 12) { m = 1; y++; }
    }
  } else { // monthly — anchor's day-of-month, clamped to month length
    const [ay, am, ad] = anchor.split('-').map(Number);
    const [ty, tm] = through.split('-').map(Number);
    for (let y = ay, m = am, i = 0; (y < ty || (y === ty && m <= tm)) && i < 500; i++) {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const day = Math.min(ad, lastDay);
      pushIfDue(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  return out;
}

function applyContributionRules() {
  const today = nyToday();
  let applied = 0;
  const summary = {};
  for (const rule of contributionRules) {
    const h = holdings.find(x => x.id === rule.holdingId)
           || holdings.find(x => x.name === rule.holdingName);
    if (!h || !(h.price > 0) || !(rule.amount > 0)) continue;
    for (const date of nextPayDates(rule, today)) {
      const units = +(rule.amount / h.price).toFixed(6);
      h.quantity = +(h.quantity + units).toFixed(6);
      transactions.push({
        id: uid(), date, kind: 'contribution', holdingId: h.id, holdingName: h.name,
        units, unitPrice: h.price, amount: rule.amount, source: 'auto-rule', estimated: true,
      });
      rule.lastAppliedThrough = date;
      applied++;
      summary[h.name] = (summary[h.name] || 0) + units;
    }
  }
  if (applied > 0) {
    markUnsaved();
    const what = Object.entries(summary).map(([n, u]) => `${fmtN(u)} units → ${n.slice(0, 40)}`).join(' · ');
    toast(`Applied ${applied} scheduled contribution${applied === 1 ? '' : 's'}: ${what}`, 7000);
  }
  return applied;
}

function addContributionRule() {
  const holdingId = document.getElementById('crHolding').value;
  const amount = parseFloat(document.getElementById('crAmount').value);
  const cadence = document.getElementById('crCadence').value;
  const anchorDate = document.getElementById('crAnchor').value;
  const h = holdings.find(x => x.id === holdingId);
  if (!h || isNaN(amount) || amount <= 0 || !anchorDate) {
    toast('Pick a holding, a positive amount, and a first pay date.');
    return;
  }
  const rule = {
    id: uid(), holdingId: h.id, holdingName: h.name,
    amount, cadence, anchorDate, lastAppliedThrough: null,
  };
  const back = backdatedAccrual(rule);
  if (back.daysBack > BACKDATE_CONFIRM_DAYS && back.rows > 0 && !confirm(
    `This rule starts ${anchorDate}, ${back.daysBack} days ago.\n\n` +
    `Adding it now writes ${back.rows} back-dated contribution${back.rows === 1 ? '' : 's'}, ` +
    `${fmt$(back.dollars)} in total, into ${h.name}${h.account ? ` (${h.account})` : ''}, ` +
    `estimated at today's price.\n\nAdd it anyway?`)) {
    toast('Rule not added');
    return;
  }
  contributionRules.push(rule);
  const appliedNow = applyContributionRules();
  if (appliedNow === 0) markUnsaved();
  // The form survives render() now, so clear what was just added.
  document.getElementById('crAmount').value = '';
  document.getElementById('crAnchor').value = '';
  render();
  // One toast for the whole add. The accrual's own "Applied N…" toast was
  // replaced by this one at once, so a back-dated start never said what it
  // had written (Drop 1 review) — it says it here, as the confirm promised it.
  const added = `Rule added: ${fmt$(amount)} ${CADENCE_LABELS[cadence]} → ${h.name.slice(0, 40)}`;
  toast(appliedNow > 0 && back.rows > 0
    ? `${added} · ${back.rows} back-dated contribution${back.rows === 1 ? '' : 's'} written (${fmt$(back.dollars)})`
    : added, appliedNow > 0 ? 7000 : undefined);
}

function deleteContributionRule(id) {
  contributionRules = contributionRules.filter(r => r.id !== id);
  markUnsaved(); render();
}

// ─── Back-dated rules ────────────────────────────────────────────────────────
// A start date in the past backfills every pay date since, at today's price,
// in one tap. The "Describe it" text box that used to sit here read "6/16" as
// 2001-06-16 (new Date("6/16") in V8), and one Confirm wrote 1,000 rows of
// phantom units (audit 2026-10-03, cards-plan critical). The box is gone (a
// rule from words is the chat's job, with its own preview). The date picker
// cannot misparse, but a mis-tapped year does the same damage, so a start more
// than BACKDATE_CONFIRM_DAYS back says what it will write, first.
const BACKDATE_CONFIRM_DAYS = 60;

// Pure. What adding `rule` today would accrue: how far back it starts, and
// the rows and dollars nextPayDates would write (the same 500-row cap).
function backdatedAccrual(rule, today = nyToday()) {
  const daysBack = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(rule.anchorDate).slice(0, 10)}T00:00:00Z`)) / 86400000);
  const rows = nextPayDates({ ...rule, lastAppliedThrough: null }, today).length;
  return { daysBack, rows, dollars: +(rows * (+rule.amount || 0)).toFixed(2) };
}

function ruleNextDate(rule) {
  // Probe one year ahead for the next due date after today
  const probe = new Date();
  probe.setUTCFullYear(probe.getUTCFullYear() + 1);
  const upcoming = nextPayDates(
    { ...rule, lastAppliedThrough: rule.lastAppliedThrough || null },
    probe.toISOString().slice(0, 10),
  ).filter(d => d > nyToday());
  return upcoming[0] || '—';
}

let ruleFormOpts = null;   // the holding list the rule form was last given
function renderContributions() {
  const card = document.getElementById('contribCard');
  if (!card) return;
  card.style.display = holdings.length > 0 ? '' : 'none';
  const meta = document.getElementById('planContribMeta');
  if (meta) {
    const perMonth = monthlyContribFromRules();
    meta.textContent = contributionRules.length
      ? `${contributionRules.length} rule${contributionRules.length === 1 ? '' : 's'} · about ${fmt$0(perMonth)} a month`
      : 'None set up';
  }
  if (holdings.length === 0) return;

  // Each rule names its account: "Vanguard S&P 500 ETF" is held in two.
  const list = document.getElementById('contribList');
  // Delete by delegation: the id rides in an escaped data attribute, never
  // inside an inline handler's JavaScript string (CISO, Drop 2 round 1 — a
  // restored doc's rule id with a quote in it was code).
  if (!list.dataset.wired) {
    list.dataset.wired = '1';
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-rule-del]');
      if (b) deleteContributionRule(b.dataset.ruleDel);
    });
  }
  if (contributionRules.length === 0) {
    list.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);margin:6px 0 10px;">No rules yet. Add one to auto-accrue payroll contributions (e.g. 401K) between statements.</p>';
  } else {
    list.innerHTML = contributionRules.map(r => {
      const h = holdings.find(x => x.id === r.holdingId);
      const orphan = !h && !holdings.some(x => x.name === r.holdingName);
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-subtle);">
        <div style="min-width:0;">
          <div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.holdingName)}</div>
          <div style="font-size:12px;color:var(--text-secondary);">
            ${fmt$(r.amount)} ${esc(CADENCE_LABELS[r.cadence] || r.cadence)} · next ${esc(ruleNextDate(r))}${h?.account ? ` · ${esc(h.account)}` : ''}
            ${orphan ? ' · <span style="color:var(--danger,#dc2626);">holding missing — rule inactive</span>' : ''}
          </div>
        </div>
        <button class="btn btn-ghost btn-icon" data-rule-del="${esc(r.id)}" title="Delete rule" aria-label="Delete rule for ${esc(r.holdingName)}">✕</button>
      </div>`;
    }).join('');
  }

  // The form is built once and then only its holding list is refreshed.
  // render() runs once per fetched price during a refresh, and rebuilding the
  // whole form wiped an amount or date he was half-way through typing (Drop 1
  // carry-over) — worse now that the form sits in a drawer he opens to edit.
  const opts = holdings
    .map(h => `<option value="${esc(h.id)}">${esc(h.name.slice(0, 60))}${h.account ? ` (${esc(h.account)})` : ''}</option>`)
    .join('');
  const form = document.getElementById('contribForm');
  const sel = document.getElementById('crHolding');
  if (sel && form.contains(sel)) {
    if (ruleFormOpts !== opts && document.activeElement !== sel) {
      const keep = sel.value;
      sel.innerHTML = opts;
      ruleFormOpts = opts;
      if (holdings.some(h => h.id === keep)) sel.value = keep;
    }
    return;
  }
  form.innerHTML = `
    <div class="plan-fields" style="margin-top:12px;">
      <div class="plan-field" style="grid-column:1 / -1;"><label for="crHolding">Holding</label><select id="crHolding">${opts}</select></div>
      <div class="plan-field" style="grid-column:1 / -1;"><label for="crCadence">Cadence</label><select id="crCadence">
        <option value="biweekly">Every 2 weeks</option><option value="semimonthly">1st &amp; 15th</option><option value="monthly">Monthly</option>
      </select></div>
      <div class="plan-field"><label for="crAmount">$ per period</label><input id="crAmount" type="number" min="0" step="any" placeholder="500"></div>
      <div class="plan-field"><label for="crAnchor">First pay date</label><input id="crAnchor" type="date"></div>
    </div>
    <div class="plan-actions"><button class="btn btn-primary" onclick="addContributionRule()">+ Add rule</button></div>`;
  ruleFormOpts = opts;
}

function render() {
  document.getElementById('totalValue').textContent = fmt$(total());

  // One status line with the price label (#lastRefreshedLabel). "Last saved:
  // 10/3/2026 11:48 AM" became "Saved 11:48 AM" — the date only when it isn't
  // today (Drop 2).
  const el = document.getElementById('lastSavedLabel');
  if (lastSaved) {
    const d = new Date(lastSaved);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    el.textContent = `Saved ${d.toDateString() === new Date().toDateString() ? time : `${shortDate(lastSaved)}, ${time}`}` +
      (unsaved ? ' · unsaved changes' : '');
  } else {
    el.textContent = unsaved ? 'Saving…' : '';
  }

  renderAccountTiles();
  renderAttentionStrip();
  renderLastLookChip();
  renderTable();
  renderHoldingsCount();
  renderContributions();
  renderDividendSection();
  renderFireDefaults();

  const hasHoldings = holdings.length > 0;
  document.getElementById('advisorCard').style.display    = hasHoldings ? '' : 'none';
  document.getElementById('askCard').style.display        = hasHoldings ? '' : 'none';
  renderAskState();
  renderPlan();
  if (hasHoldings) {
    renderAdvisorContext();
  }
  // Paints from the last facts at once (cache or this session's charts), then
  // fetches when signed in and the charts are missing or half an hour old.
  renderWeekCard();
  maybeRefreshWeek();
}

// "Holdings · 10 positions": a split fund's US/Intl pair is one position, the
// same grouping Update positions uses.
function positionCount() {
  return [...new Set(holdings.map(h => h.account || ''))]
    .reduce((n, a) => n + updateLinesFor(a).length, 0);
}

function renderHoldingsCount() {
  const el = document.getElementById('holdingsCount');
  if (!el) return;
  const n = positionCount();
  el.textContent = n ? `${n} position${n === 1 ? '' : 's'}` : 'None yet — add one in Plan & settings';
}

// ─── Plan & settings ─────────────────────────────────────────────────────────
// The drawer's sections and the one line each shows closed: his current
// figure, so the row answers "what is it set to?" without a tap.
function renderPlan() {
  const hasHoldings = holdings.length > 0;
  for (const id of ['planTargets', 'planTax']) {
    const sec = document.getElementById(id);
    if (sec) sec.style.display = hasHoldings ? '' : 'none';
  }
  if (!hasHoldings) return;
  const tgt = getSleeveTargetPcts();
  const bandAbs = +targets.bandAbsPp || 5, bandRel = +targets.bandRelPct || 25;
  const short = { us_stock: 'US', intl_stock: 'Intl', tilt: 'Tilts', bond: 'Bonds', other: 'Other' };
  const mix = Object.keys(SLEEVE_CONFIG).filter(k => tgt[k] > 0)
    .map(k => `${short[k]} ${+tgt[k].toFixed(1)}%`).join(' · ');
  const set = (id, text) => { const e = document.getElementById(id); if (e) e.textContent = text; };
  set('planTargetsMeta', `${mix} · bands ${bandAbs}pp / ${bandRel}%`);
  // The same defaults effectiveRates applies, so the row shows what Ask uses.
  const marg = targets.taxMarginal == null ? DEFAULT_TAX_MARGINAL : +targets.taxMarginal || 0;
  const ltcg = targets.taxLtcg == null ? DEFAULT_TAX_LTCG : +targets.taxLtcg || 0;
  set('planTaxMeta', `${marg}% marginal · ${ltcg}% long-term gains · ${+targets.taxStateLocal || 0}% state + local` +
    (targets.taxNiit ? ' · NIIT' : ''));
  set('planFireMeta', +targets.fireAnnualSpend > 0 ? `${fmt$0(+targets.fireAnnualSpend)} a year · simulate` : 'Not set · simulate');
  renderTargetInputs();
  renderPlanBands();
  renderTaxRates();
}

// The rebalancing bands, his 5/25 rule. Until Drop 2 they could only be set
// in two 22px boxes inside a sentence at the foot of Where you stand; the
// drawer gives them labels and phone-sized fields. Where you stand reads the
// same two figures.
function setBand(key, value) {
  const v = +value;
  // 0 too: every reader takes `|| 5` / `|| 25`, so a stored 0 showed and ran
  // as the default while the doc said 0 (CIO, round 2; predates Drop 2).
  if (!(v > 0)) { renderPlanBands(true); return; }
  targets[key] = v;
  markUnsaved();
  render();
}

function renderPlanBands(force = false) {
  const el = document.getElementById('planBands');
  if (!el) return;
  const abs = +targets.bandAbsPp || 5, rel = +targets.bandRelPct || 25;
  const a = document.getElementById('planBandAbs'), b = document.getElementById('planBandRel');
  if (a && b && !force) {
    // Synced in place, never rebuilt: a render mid-typing must not eat it.
    if (document.activeElement !== a) a.value = abs;
    if (document.activeElement !== b) b.value = rel;
    const note = document.getElementById('planBandNote');
    if (note) note.textContent = planBandNote(abs, rel);
    return;
  }
  el.innerHTML = `
    <div class="target-inputs">
      <div class="target-row"><label for="planBandAbs">Absolute band</label>
        <input id="planBandAbs" type="number" min="0" max="50" step="0.5" value="${esc(abs)}"
          onchange="setBand('bandAbsPp', this.value)"><span class="pct-label">pp</span></div>
      <div class="target-row"><label for="planBandRel">Relative band</label>
        <input id="planBandRel" type="number" min="0" max="100" step="5" value="${esc(rel)}"
          onchange="setBand('bandRelPct', this.value)"><span class="pct-label">%</span><span class="pct-label">of target</span></div>
    </div>
    <p class="plan-note" id="planBandNote">${esc(planBandNote(abs, rel))}</p>`;
}
// From his figures: "your 5/25 rule" was fixed text, wrong the moment he
// changed a band (CPO, Drop 2 round 1).
function planBandNote(abs, rel) {
  return `A sleeve is outside your bands when it is off its target by either amount — ` +
    `your ${abs}pp / ${rel}% rule. Where you stand reports against it; nothing here trades.`;
}

// Opening the drawer or a section re-reads his figures, so it never shows a
// stale one until the next price refresh. (Until the Drop 2 integration a band
// typed into Where you stand changed targets without a full render(); the
// bands are now set only here.)
document.querySelectorAll('#planCard, #planCard .plan-sec').forEach(d =>
  d.addEventListener('toggle', () => { if (d.open && holdings.length) renderPlan(); }));

function typeOptions(selected) {
  return Object.entries(TYPE_CONFIG).map(([val, cfg]) =>
    `<option value="${val}" ${val === selected ? 'selected' : ''}>${cfg.label}</option>`
  ).join('');
}

// ─── Positions: one line per fund he holds ───────────────────────────────────
// confirmSplit turns one fund into two lots — same name, account and price,
// one per sleeve — so the allocation can count LF Global as US and Intl. It
// is still one fund he owns: the phone list showed it twice, and the
// 2026-09-13 statement incident began with one half edited on its own.
// Everything a person touches (the line, Edit, ↻, quick price, Delete) works
// on the position; only the sleeve maths sees the lots. The account is part
// of the rule: VOO in Brokerage and VOO in the Roth share a name and a price
// and are two positions. Two lots in the SAME sleeve are not a split — that
// is a duplicate, and folding it into one line would hide it.
function splitMateOf(h, list = holdings) {
  const mates = list.filter(x => x !== h && x.name === h.name &&
    (x.account || '') === (h.account || '') && x.price === h.price);
  return mates.length === 1 && getSleeve(mates[0]) !== getSleeve(h) ? mates[0] : null;
}

// Every position in `list`, each the array of its lots in list order.
function positionsIn(list = holdings) {
  const seen = new Set(), out = [];
  for (const h of list) {
    if (seen.has(h)) continue;
    const mate = splitMateOf(h, list);
    const lots = mate ? [h, mate] : [h]; // the mate comes later, or it would be seen
    lots.forEach(x => seen.add(x));
    out.push(lots);
  }
  return out;
}

// The lots of the position a holding id belongs to, in holdings order. The
// first lot's id is the position's key everywhere in the DOM.
function positionLots(id) {
  return positionsIn(holdings).find(lots => lots.some(x => x.id === id)) || [];
}
const positionKey = id => positionLots(id)[0]?.id ?? id;
const lotsQty   = lots => lots.reduce((s, x) => s + x.quantity, 0);
const lotsValue = lots => lots.reduce((s, x) => s + x.quantity * x.price, 0);

// "split 70% US / 30% Intl" (the Update panel's words; illustrative ratio), US first when one is.
// Short form for the phone line, where the ratio would push the account off.
function splitLabel(lots, short = false) {
  const word = h => ({ us_stock: 'US', intl_stock: 'Intl' })[getSleeve(h)] || SLEEVE_CONFIG[getSleeve(h)]?.label || 'Other';
  const [a, b] = [...lots].sort((x, y) => (getSleeve(y) === 'us_stock') - (getSleeve(x) === 'us_stock'));
  if (short) return `split ${word(a)}/${word(b)}`;
  const tot = lotsQty(lots);
  const pa = tot > 0 ? Math.round(a.quantity / tot * 100) : 50;
  return `split ${pa}% ${word(a)} / ${100 - pa}% ${word(b)}`;
}

// The phone layout's breakpoint, the one style.css stacks the page at.
const PHONE_MQ = '(max-width: 640px)';
const isPhoneLayout = () => window.matchMedia(PHONE_MQ).matches;

// A position's value: cents on the desktop table, whole dollars on the phone
// line — the number he came for, and the cents cost the account its room.
// Both are in the DOM; CSS shows one (display:none keeps the other unread).
const fmtWhole$ = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const holdValueHtml = n => `<span class="v-cents">${fmt$(n)}</span><span class="v-whole">${fmtWhole$(n)}</span>`;

function renderTable() {
  const tot   = total();
  const tbody = document.getElementById('tableBody');
  const tfoot = document.getElementById('tableFoot');

  if (!holdings.length) {
    editingId = null;
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state"><p>No holdings yet — add one in Plan &amp; settings below, or import a CSV from ⋯.</p></div>
    </td></tr>`;
    tfoot.innerHTML = '';
    return;
  }

  // Group positions by account
  const groups = {};
  for (const lots of positionsIn(holdings)) {
    const acct = lots[0].account || 'Unassigned';
    if (!groups[acct]) groups[acct] = [];
    groups[acct].push(lots);
  }

  // Order: fixed ACCOUNTS list first, then any unknowns, then Unassigned last
  const acctOrder = [
    ...ACCOUNTS.filter(a => groups[a]),
    ...Object.keys(groups).filter(a => !ACCOUNTS.includes(a) && a !== 'Unassigned'),
    ...(groups['Unassigned'] ? ['Unassigned'] : []),
  ];

  // Assign colors globally by value rank (consistent across groups)
  const allByValue = [...holdings].sort((a,b) => (b.quantity*b.price) - (a.quantity*a.price));
  const colorMap = {};
  allByValue.forEach((h, i) => { colorMap[h.id] = PALETTE[i % PALETTE.length]; });

  // Edit is keyed by the position; a pull can reorder its lots, so follow it.
  const editLots = editingId ? positionLots(editingId) : [];
  editingId = editLots[0]?.id ?? null;

  // Rows before the open Edit form, the form, and rows after it — so a
  // background render can leave the form's own node alone (keepEditRow).
  let before = '', html = '', editHtml = '';

  acctOrder.forEach((acct, acctIdx) => {
    const positions = [...groups[acct]].sort((a, b) => lotsValue(b) - lotsValue(a));
    const acctTotal = positions.reduce((s, lots) => s + lotsValue(lots), 0);
    const acctPct   = tot > 0 ? (acctTotal / tot * 100).toFixed(1) : '0.0';
    const acctColor = ACCT_COLORS[acctIdx % ACCT_COLORS.length];

    // Account header row (desktop; the phone line names its account instead)
    html += `<tr class="acct-header">
      <td colspan="7">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;color:${acctColor};">${esc(acct)}</span>
          <span style="font-size:13px;color:var(--text-secondary);font-feature-settings:'cv01','tnum';">${fmt$(acctTotal)} &nbsp;·&nbsp; ${acctPct}%</span>
        </div>
      </td>
    </tr>`;

    for (const lots of positions) {
      if (lots[0].id === editingId) {
        before = html; html = '';
        editHtml = holdEditRowHtml(lots);
        continue;
      }
      html += holdRowHtml(lots, tot, colorMap[lots[0].id]);
      if (splittingId === lots[0].id && lots.length === 1) html += holdSplitRowHtml(lots[0]);
    }
  });

  if (!keepEditRow(tbody, editLots, before, html)) tbody.innerHTML = before + editHtml + html;

  if (quickPriceId) {
    const inp = document.getElementById(`qp-${quickPriceId}`);
    if (inp) { inp.focus(); inp.select(); }
  }
  if (splittingId) {
    const inp = document.getElementById(`sp-pct-${splittingId}`);
    if (inp) { inp.focus(); inp.select(); }
  }

  tfoot.innerHTML = `<tr>
    <td class="h-name">Total</td><td></td><td class="num">—</td><td class="num">—</td>
    <td class="num h-val">${holdValueHtml(tot)}</td>
    <td class="h-alloc">100%</td><td></td>
  </tr>`;
}

// One position's line. Desktop: the seven-column row with its buttons. Phone
// (≤640, style.css): name over "account · ticker", value over its share — one
// line per position, and the line itself opens Edit (David, 2026-10-04: the
// four-button row and the six-line cards made the list four screens long).
function holdRowHtml(lots, tot, color) {
  const h      = lots[0];
  const key    = esc(h.id);
  const pair   = lots.length > 1;
  const qty    = lotsQty(lots);
  const val    = lotsValue(lots);
  const pct    = tot > 0 ? (val / tot) * 100 : 0;
  const upd    = h.updated ? new Date(h.updated).toLocaleDateString() : '—';
  const isMF   = h.type === 'mutual_fund';
  const fetchKey = (h.ticker || h.name).toUpperCase();
  const realTicker = h.ticker && h.ticker.toUpperCase() !== h.name.toUpperCase() && h.ticker !== 'N/A' ? h.ticker.toUpperCase() : '';

  // Subtitle: ticker + updated (omit account — shown in header)
  const subParts = [];
  if (pair) subParts.push(splitLabel(lots));
  if (realTicker) subParts.push(realTicker);
  const proxyEntry = proxyEntryFor(h);
  const navEntry = matchesNavTable(h) ? Object.entries(FUND_NAV_TABLE).find(([k]) => h.name.includes(k))?.[1] : null;
  const navTag = proxyEntry && h.calibration
    ? ` · est. via ${proxyEntry.proxy} (calibrated ${new Date(h.calibration.date).toLocaleDateString()})`
    : navEntry ? ` · manual NAV ${navEntry.updated}` : (isMF ? ' · NAV' : '');
  subParts.push(`updated ${upd}${navTag}`);
  const subtitle = subParts.join(' · ');
  const daysOld = h.updated ? Math.floor((Date.now() - new Date(h.updated)) / 86400000) : null;
  // Proxy-tracked funds refresh automatically, so the price-age badge doesn't apply;
  // nudge instead when the real-NAV calibration is getting old.
  const calDays = proxyEntry && h.calibration ? Math.floor((Date.now() - new Date(h.calibration.date)) / 86400000) : null;
  const recal = proxyEntry && calDays !== null && calDays > PROXY_RECAL_NUDGE_DAYS;
  const old = !proxyEntry && daysOld !== null && daysOld > 7;
  const staleTag = recal ? ` <span class="stale-badge">⚠ recalibrate — ${calDays}d since real NAV</span>`
    : old ? ` <span class="stale-badge">⚠ ${daysOld}d old</span>` : '';

  // The phone's second line: what tells this line from its neighbours, in the
  // fewest characters, warning first. Each part is unbreakable, so on a
  // narrow phone the line wraps between parts, never inside "Swedish pension".
  const meta = [
    recal ? '⚠ recalibrate' : old ? `⚠ ${daysOld}d old` : '',
    h.account || 'Unassigned',
    pair ? splitLabel(lots, true) : realTicker || (proxyEntry ? `via ${proxyEntry.proxy}` : ''),
  ].filter(Boolean).map(s => `<span>${esc(s)}</span>`).join(' · ');

  const dots = lots.map(x => {
    const s = SLEEVE_CONFIG[getSleeve(x)];
    return `<span class="sleeve-dot" style="width:7px;height:7px;background:${s.color};margin-left:6px;vertical-align:middle;" title="${s.label}"></span>`;
  }).join('');

  return `<tr class="hold-row${quickPriceId === h.id ? ' qp-open' : ''}" data-key="${key}">
    <td class="h-name">
      <div class="ticker-name">${esc(h.name)}${dots}</div>
      <div class="ticker-sub">${esc(subtitle)}${staleTag}</div>
      <div class="h-meta">${meta}</div>
    </td>
    <td class="h-type" data-label="Type">${typeBadge(h.type)}</td>
    <td class="num h-qty" data-label="Shares">${fmtN(qty)}</td>
    <td class="num h-price" data-label="Price" style="cursor:pointer;" data-act="qp" data-key="${key}" title="Click to edit price">
      ${quickPriceId === h.id
        ? `<input id="qp-${key}" data-key="${key}" type="number" inputmode="decimal" step="any" value="${esc(h.price)}" aria-label="Price for ${esc(h.name)}">`
        : fmt$(h.price)}
    </td>
    <td class="num h-val" data-label="Value">${holdValueHtml(val)}</td>
    <td class="h-alloc">
      <div class="bar-wrap">
        <div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>
        <span class="h-pct">${pct.toFixed(1)}%</span>
      </div>
    </td>
    <td class="num h-actions"><div class="actions">
      <button class="btn btn-ghost btn-sm" title="Fetch ${isMF ? 'NAV' : 'price'} for ${esc(fetchKey)}" data-act="refresh" data-key="${key}">↻</button>
      <button class="btn btn-ghost btn-sm" data-act="edit" data-key="${key}">Edit</button>
      ${pair ? '' : `<button class="btn btn-ghost btn-sm" title="Split into two sleeve allocations" data-act="split" data-key="${key}">Split</button>`}
      <button class="btn btn-danger btn-sm" title="Delete ${esc(h.name)}" aria-label="Delete ${esc(h.name)}" data-act="delete" data-key="${key}">✕</button>
    </div></td>
  </tr>`;
}

// A fetched price is a raw float (a dozen or more decimal places), which ran
// past the field at 375. Four places show what matters (six significant
// digits below $1), and showing less is safe: a field he doesn't touch
// saves the live price, not this (saveEdit).
const editPriceStr = p => String(+p >= 1 ? +(+p).toFixed(4) : +(+p).toPrecision(6));

// Edit, at every width: labelled fields, then Save, and the rarer actions
// that used to sit on every line — ↻ price, Split, Delete (Drop 1's confirm
// and 10 s Undo, unchanged). A split fund edits as one: its total shares
// (the ratio is kept, as in Update positions) and one price for both lots.
function holdEditRowHtml(lots) {
  const h    = lots[0];
  const key  = esc(h.id);
  const pair = lots.length > 1;
  const priceLabel = (TYPE_CONFIG[h.type] || TYPE_CONFIG.other).priceLabel;
  return `<tr class="hold-edit" id="he-row-${key}" data-lots="${esc(lots.map(x => x.id).join(','))}">
    <td colspan="7"><div class="he-form">
      <div class="he-grid">
        <label class="he-f he-wide"><span>Name</span>
          <input id="en-${key}" type="text" value="${esc(h.name)}" autocomplete="off"></label>
        <label class="he-f"><span>Ticker</span>
          <input id="etick-${key}" type="text" value="${esc(h.ticker || '')}" placeholder="optional" autocomplete="off" spellcheck="false"></label>
        <label class="he-f"><span>Type</span><select id="et-${key}">${typeOptions(h.type)}</select></label>
        <label class="he-f he-wide-m"><span>Account</span><select id="eacc-${key}">${accountOptions(h.account || '')}</select></label>
        ${pair
          ? `<div class="he-f he-wide-m"><span>Sleeve</span><div class="he-split-note">${esc(splitLabel(lots))}</div></div>`
          : `<label class="he-f he-wide-m"><span>Sleeve</span><select id="eslv-${key}">${sleeveOptions(h.sleeve || '')}</select></label>`}
        <label class="he-f"><span>${pair ? 'Total shares' : 'Shares'}</span>
          <input id="eq-${key}" type="number" inputmode="decimal" step="any" min="0" value="${+lotsQty(lots).toFixed(6)}"></label>
        <label class="he-f"><span>${priceLabel}</span>
          <input id="ep-${key}" type="number" inputmode="decimal" step="any" min="0" value="${editPriceStr(h.price)}"></label>
      </div>
      ${pair ? `<p class="he-hint">One fund held as two sleeves. A new total keeps the split.</p>` : ''}
      <div class="he-actions">
        <button class="btn btn-primary btn-sm" data-act="save" data-key="${key}">Save</button>
        <button class="btn btn-ghost btn-sm" data-act="cancel">Cancel</button>
        <span class="he-tools">
          <button class="btn btn-ghost btn-sm" data-act="refresh" data-key="${key}" aria-label="Fetch the latest ${h.type === 'mutual_fund' ? 'NAV' : 'price'}">↻ Price</button>
          ${pair ? '' : `<button class="btn btn-ghost btn-sm" data-act="split" data-key="${key}">Split</button>`}
          <button class="btn btn-danger btn-sm" data-act="delete" data-key="${key}" aria-label="Delete ${esc(h.name)}">Delete</button>
        </span>
      </div>
    </div></td>
  </tr>`;
}

// A render while Edit is open — the boot price refresh renders once per
// holding, for the first ten seconds or so of every visit — rebuilt the form
// from the stored values and threw away what he had typed, focus included.
// When the same position is still being edited, keep the form's node and
// rebuild only the rows around it; fields he has not touched take the fresh
// values (a refreshed price shows up), fields he has touched keep his.
function keepEditRow(tbody, lots, before, after) {
  if (!lots.length) return false;
  const row = document.getElementById(`he-row-${lots[0].id}`);
  if (!row || row.parentNode !== tbody || row.dataset.lots !== lots.map(x => x.id).join(',')) return false;
  for (const el of [...tbody.children]) if (el !== row) el.remove();
  row.insertAdjacentHTML('beforebegin', before);
  row.insertAdjacentHTML('afterend', after);
  const h = lots[0], key = h.id;
  const live = {
    [`en-${key}`]: h.name, [`etick-${key}`]: h.ticker || '', [`et-${key}`]: h.type,
    [`eacc-${key}`]: h.account || '', [`eslv-${key}`]: h.sleeve || '',
    [`eq-${key}`]: String(+lotsQty(lots).toFixed(6)), [`ep-${key}`]: editPriceStr(h.price),
  };
  for (const [id, v] of Object.entries(live)) {
    const el = document.getElementById(id);
    if (el && !el.dataset.dirty && el.value !== v) el.value = v;
  }
  const note = row.querySelector('.he-split-note');
  if (note && lots.length > 1) note.textContent = splitLabel(lots);
  return true;
}

function holdSplitRowHtml(h) {
  const key = esc(h.id);
  return `<tr class="hold-split">
    <td colspan="7"><div class="sp-form">
      <div class="sp-title">✂ Split "${esc(h.name)}" (${fmtN(h.quantity)} total units)</div>
      <div class="sp-line">
        <span class="sp-pct"><input id="sp-pct-${key}" data-act="sp-pct" data-key="${key}" type="number" inputmode="decimal"
          min="1" max="99" step="0.1" value="72" aria-label="Percent in the first sleeve"> %</span>
        <select id="sp-slv1-${key}" aria-label="First sleeve">${sleeveOptions('us_stock')}</select>
        <span class="sp-qty" id="sp-qty1-${key}">${fmtN(h.quantity * 0.72)} units</span>
      </div>
      <div class="sp-line">
        <span class="sp-pct"><span id="sp-pct2-${key}">28%</span></span>
        <select id="sp-slv2-${key}" aria-label="Second sleeve">${sleeveOptions('intl_stock')}</select>
        <span class="sp-qty" id="sp-qty2-${key}">${fmtN(h.quantity * 0.28)} units</span>
      </div>
      <div class="sp-btns">
        <button class="btn btn-primary btn-sm" data-act="split-ok" data-key="${key}">✓ Confirm Split</button>
        <button class="btn btn-ghost btn-sm" data-act="split-cancel">Cancel</button>
      </div>
    </div></td>
  </tr>`;
}

// One listener per kind for the whole table. Every control carries
// data-act and its position's key as data-key: no id is spliced into an
// onclick string any more (Drop 1 CISO-4 — an id from an imported file is
// arbitrary text, and a quote in it broke out of the handler).
(function wireHoldingsTable() {
  const tbody = document.getElementById('tableBody');
  if (!tbody) return;
  tbody.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('input, select, label')) return; // typing, not tapping
    const el = t.closest('[data-act]');
    if (el) {
      const key = el.dataset.key;
      switch (el.dataset.act) {
        case 'refresh':      return refreshHoldingPrice(key);
        case 'edit':         return startEdit(key);
        case 'split':        return startSplit(key);
        case 'delete':       return deleteHolding(key);
        case 'save':         return saveEdit(key);
        case 'cancel':       return cancelEdit();
        case 'qp':           return startQuickPrice(key);
        case 'split-ok':     return confirmSplit(key);
        case 'split-cancel': return cancelSplit();
      }
    }
    // At phone width the line is the way in: there are no buttons on it.
    const row = t.closest('tr.hold-row');
    if (row && isPhoneLayout()) startEdit(row.dataset.key);
  });
  tbody.addEventListener('keydown', e => {
    const t = e.target;
    if (t.id && t.id.startsWith('qp-')) {
      if (e.key === 'Enter') saveQuickPrice(t.dataset.key);
      if (e.key === 'Escape') cancelQuickPrice();
    }
  });
  tbody.addEventListener('focusout', e => {
    const t = e.target;
    if (t.id && t.id.startsWith('qp-')) saveQuickPrice(t.dataset.key);
  });
  // What he has touched in Edit: saveEdit applies only these, and a
  // background render keeps them (keepEditRow).
  const touched = e => {
    const t = e.target;
    if (t.closest('.he-form')) t.dataset.dirty = '1';
    if (t.dataset.act === 'sp-pct') updateSplitPreview(t.dataset.key);
  };
  tbody.addEventListener('input', touched);
  tbody.addEventListener('change', touched);
})();

// ─── Render: Target Inputs ────────────────────────────────────────────────────
const TARGET_ROWS = {
  targetInputsTot: [
    { key: 'stocks', label: 'Stocks', color: '#0d9488' },
    { key: 'bonds',  label: 'Bonds',  color: '#8b5cf6' },
    { key: 'other',  label: 'Other',  color: '#52525b' },
  ],
  targetInputsStk: [
    { key: 'us',    label: 'US',            color: SLEEVE_CONFIG.us_stock.color },
    { key: 'intl',  label: 'International', color: SLEEVE_CONFIG.intl_stock.color },
    { key: 'tilts', label: 'Tilts',         color: SLEEVE_CONFIG.tilt.color },
  ],
};

// Built once, then synced in place. render() calls this since Drop 2 (the
// dollar figures follow prices), a price refresh renders once per fetched
// holding, and committing one field (blur) renders while the finger is
// already on the next: a rebuild there replaced the field he had just tapped
// and dropped the keyboard (layout.spec.js), or wiped a half-typed figure.
function renderTargetInputs() {
  const tot = total();
  const stockVal = tot * targets.stocks / 100;
  const dollarsFor = (box, key) => (box === 'targetInputsTot' ? tot : stockVal) * targets[key] / 100;
  let typing = null;
  for (const [box, rows] of Object.entries(TARGET_ROWS)) {
    const el = document.getElementById(box);
    if (!el) continue;
    if (el.querySelectorAll('input[data-key]').length !== rows.length) {
      el.innerHTML = rows.map(row => `
    <div class="target-row">
      <label>
        <span class="sleeve-dot" style="background:${row.color}"></span>
        ${row.label}
      </label>
      <input type="number" min="0" max="100" step="1" data-key="${row.key}" value="${esc(targets[row.key])}" aria-label="${row.label} target %"
             oninput="previewTarget('${row.key}', this.value)" onchange="commitTarget('${row.key}', this.value)">
      <span class="pct-label">%</span>
      <span class="target-dollar">${fmt$0(dollarsFor(box, row.key))}</span>
    </div>`).join('');
      continue;
    }
    for (const row of rows) {
      const inp = el.querySelector(`input[data-key="${row.key}"]`);
      // A value with markup in it lands in .value, which is inert.
      if (document.activeElement !== inp) inp.value = targets[row.key];
      else typing = { key: row.key, value: inp.value };
      inp.parentElement.querySelector('.target-dollar').textContent = fmt$0(dollarsFor(box, row.key));
    }
  }
  // The sum check keeps previewing what is in the field he is typing in.
  renderTargetWarning(typing ? { ...targets, [typing.key]: +typing.value } : targets);
}

// Target edits used to call only saveLocal() on every keystroke: nothing
// marked the doc dirty, so they never reached data/portfolio.json or the
// cloud, and the next boot adopted the file's old targets (audit 2026-10-03,
// sandbox: a target edit sent 0 POSTs and was back to the old split after
// reload). Each keystroke
// also rebuilt the inputs, dropping focus after the first digit. Committing
// (change: blur or Enter) saves once and re-renders everything that reads
// targets: the Advisor's drift against the bands, the attention strip, and
// the policy line on the chart.
//
// Typing only previews the sum check, on a copy. Until Drop 2 the preview
// wrote the half-typed figure into the live targets (Drop 1 carry-over): any
// render or save that ran mid-typing — the 15-minute price refresh, a cloud
// pull — read or pushed a target he had not committed.
function previewTarget(key, value) {
  renderTargetWarning({ ...targets, [key]: +value });
}

function commitTarget(key, value) {
  targets[key] = +value;
  markUnsaved();
  render();     // renderPlan → renderTargetInputs syncs the fields in place
}

// Pure: the sum checks on a set of targets. The Current-vs-Target table that
// used to carry them left the page in Drop 2 (its ±0.5pp verdicts disagreed
// with his 5/25 bands — Where you stand is the band check), so the sums now
// sit under the inputs they police.
function targetSumWarnings(t = targets) {
  const allTotal = +t.stocks + +t.bonds + +t.other;
  const stkTotal = +t.us + +t.intl + +t.tilts;
  const warnings = [];
  if (Math.abs(allTotal - 100) > 0.5) warnings.push(`Stocks + Bonds + Other = ${allTotal}% (should be 100%)`);
  if (Math.abs(stkTotal - 100) > 0.5) warnings.push(`US + Intl + Tilts = ${stkTotal}% (should be 100%)`);
  return warnings;
}

function renderTargetWarning(t = targets) {
  const warnEl = document.getElementById('targetWarning');
  if (!warnEl) return;
  const warnings = targetSumWarnings(t);
  warnEl.textContent = warnings.length ? '⚠ ' + warnings.join(' · ') : '';
}

// ─── Market context ──────────────────────────────────────────────────────────
// External data in, decision out. Nothing here says buy or sell, and nothing
// reads a market level as a signal: "VOO is 2% off its high" is a fact,
// "therefore buy" is not one this app is entitled to make.
//
// The Advisor's Market panel (a tap-to-load list of 1d/30d/YTD moves per
// ticker, "no view on what they mean") left on 2026-10-04 — David: it "doesn't
// do anything, and it doesn't tell you anything". The This week card's market
// strip replaced it. marketSnapshot stays as a tested pure engine.
//
// The macro row is the CBOE 10-year Treasury yield index. It is quoted in
// percent, not dollars, so its moves are shown in basis points — a percent
// change of a yield would read as a price move and mean nothing.
const MACRO_TICKER = '^TNX';

// Pure: reduce a daily adjusted-close series to the numbers worth showing.
// `asOf` is injectable so tests can pin the YTD boundary. Returns null when
// the series is too short to say anything honest rather than reporting zeros.
function marketSnapshot(timestamps, closes, asOf = Date.now()) {
  const pts = (timestamps || [])
    .map((t, i) => ({ t: t * 1000, c: closes?.[i] }))
    .filter(p => Number.isFinite(p.c) && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;

  const last = pts[pts.length - 1];
  // Last close at or before a cutoff — the honest comparison point when the
  // exact date is a weekend or a market holiday.
  const atOrBefore = ms => {
    let found = null;
    for (const p of pts) { if (p.t <= ms) found = p; else break; }
    return found;
  };
  const delta = ref => (ref && ref.c > 0 && ref !== last)
    ? { abs: last.c - ref.c, pct: (last.c / ref.c - 1) * 100 }
    : null;

  const jan1 = Date.UTC(new Date(asOf).getUTCFullYear(), 0, 1);
  const yearAgo = asOf - 365 * 86400000;
  const trailing = pts.filter(p => p.t >= yearAgo);
  const high52 = Math.max(...(trailing.length ? trailing : pts).map(p => p.c));

  return {
    last: last.c,
    asOfDate: new Date(last.t).toISOString().slice(0, 10),
    d1:  delta(pts[pts.length - 2]),
    d30: delta(atOrBefore(asOf - 30 * 86400000)),
    ytd: delta(atOrBefore(jan1)),
    d365: delta(atOrBefore(yearAgo)) || delta(pts[0]),
    high52,
    offHighPct: high52 > 0 ? (last.c / high52 - 1) * 100 : 0,
  };
}

// ─── Advisor: drift vs policy ────────────────────────────────────────────────
// The 5/25 rule, which is a policy and not a prediction: a sleeve is out of
// band when it is off by at least `bandAbsPp` percentage points OR by at least
// `bandRelPct`% of its own target weight. The relative leg is what catches
// small sleeves — a 9% target sitting at 6.5% is only 2.5pp off but is 28%
// short of where it should be. A zero-target sleeve has no meaningful relative
// test (division by zero), so it is judged on the absolute leg alone.
function driftCheck(sleeveVals, targetPcts, totalValue,
                    bandAbsPp = 5, bandRelPct = 25) {
  if (!(totalValue > 0)) return { rows: [], anyOutOfBand: false, worst: null };
  const rows = Object.keys(SLEEVE_CONFIG).map(key => {
    const curVal  = sleeveVals[key] || 0;
    const curPct  = curVal / totalValue * 100;
    const tgtPct  = targetPcts[key] || 0;
    const driftPp = curPct - tgtPct;
    const relPct  = tgtPct > 0 ? driftPp / tgtPct * 100 : null;
    const absHit  = Math.abs(driftPp) >= bandAbsPp;
    const relHit  = relPct !== null && Math.abs(relPct) >= bandRelPct;
    return {
      sleeve: key,
      label: SLEEVE_CONFIG[key].label,
      curPct, tgtPct, driftPp, relPct,
      driftDollars: curVal - tgtPct / 100 * totalValue,
      outOfBand: absHit || relHit,
      // Which leg tripped — shown so the number is never a black box.
      reason: absHit && relHit ? 'both' : absHit ? 'absolute' : relHit ? 'relative' : null,
    };
  // A sleeve with no target and no money is noise, not a row.
  }).filter(r => r.tgtPct > 0 || Math.abs(r.curPct) > 0.05);

  const breaches = rows.filter(r => r.outOfBand);
  const worst = rows.slice().sort((a, b) => Math.abs(b.driftPp) - Math.abs(a.driftPp))[0] || null;
  return { rows, anyOutOfBand: breaches.length > 0, breaches, worst };
}

// Monthly dollars the standing rules actually move, normalised across
// cadences (26 biweekly payments a year, not 24).
function monthlyContribution(rules = contributionRules) {
  const perMonth = { biweekly: 26 / 12, semimonthly: 2, monthly: 1 };
  return (rules || []).reduce(
    (sum, r) => sum + (+r.amount || 0) * (perMonth[r.cadence] ?? 1), 0);
}

// Can new money alone close a gap, or does this need selling? Returns months
// to close at the current contribution rate, assuming every dollar is aimed at
// the shortfall — the optimistic bound. null when nothing is flowing in, or
// when the sleeve is overweight (new money can never fix an overweight; only
// the rest of the portfolio growing around it, or a sale, does that).
function monthsToCloseGap(gapDollars, monthlyIn) {
  if (!(monthlyIn > 0) || !(gapDollars > 0)) return null;
  return gapDollars / monthlyIn;
}

// ─── Attribution ─────────────────────────────────────────────────────────────
// The engine behind the Advisor's old "What moved your money" panel, which left
// with it on 2026-10-04 (its window buttons opened a second, per-ticker table
// under the Market panel — "why is there one and then another one"). The This
// week card answers the same question on trading-date closes (weekMoney);
// this stays as the tested reference for the rules both follow.
//
// "What moved my money" — the decomposition the header cannot give you. A
// change in total value is two different things wearing one number: money you
// PUT IN, and money the market gave or took. Splitting them is the difference
// between "I'm up" and "I'm up, and almost all of it was my own paycheck".
//
// Per holding, exactly:
//   marketGain(h) = (qty_now × P_now) − (qty_start × P_start) − contributed(h)
//
// qty_start comes from the ledger — current units minus everything the ledger
// added inside the window. This is the first thing besides TWR that makes the
// transaction log earn its keep.
//
// A holding whose starting price cannot be established is reported as
// unattributable rather than folded in at zero, because a silent zero would
// understate the market's contribution and quietly break the identity
// (flows + market = total).

// Windows are anchored in New York, not UTC. On UTC the evening of 31 December
// already belongs to the next year, so a YTD run after ~7pm ET resolved to
// 2027-01-01, `closeAtOrBefore` returned the latest close, and the card
// cheerfully reported that the portfolio had moved $0.00.
// Every date the client WRITES uses it too (ledger rows, contribution
// accruals, history snapshots, fx stamps, the last look): the server keys its
// rows by the New York date, and the UTC day runs ahead every evening after
// 8pm ET, so an evening edit was booked to tomorrow (audit 2026-10-03).
// One formatter, made on first use (a property of the hoisted function, so
// it works before this line runs). A new one per call cost the week card
// ~27 ms of its ~29 ms per render: ~1,500 bars, ~11 renders in the boot
// refresh (CIO, Drop 2 round 2).
function nyToday(now = Date.now()) {
  nyToday.fmt ||= new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return nyToday.fmt.format(new Date(now));
}

function windowStartDate(win, now = Date.now()) {
  const today = nyToday(now);
  if (win.days == null) return `${today.slice(0, 4)}-01-01`;
  // Calendar arithmetic on the New York date, NOT fixed milliseconds off the
  // instant. Subtracting 7×86400000ms across a DST boundary lands a day early
  // or late — a "1 week" window spanning 15 March silently became 8 days.
  // Date.UTC has no DST, so day subtraction on it is exact.
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - win.days * 86400000).toISOString().slice(0, 10);
}

// Units and dollars the ledger added to this holding inside the window.
// 'dividend' rows are income, not an external flow — same rule as externalFlows.
function ledgerAddsSince(h, sinceDate, txns = transactions) {
  return (txns || [])
    .filter(t => t.holdingId === h.id && String(t.date).slice(0, 10) > sinceDate &&
                 (t.kind === 'contribution' || t.kind === 'adjustment'))
    .reduce((a, t) => ({ units: a.units + (+t.units || 0),
                         dollars: a.dollars + (+t.amount || 0) }), { units: 0, dollars: 0 });
}

// Units that arrived as REINVESTED distributions inside the window. These need
// their own accounting: they were not held when the window opened, so they must
// come out of startQty — but David did not pay for them either, so they stay
// out of `contributed`. What's left is that they land in marketGain, which is
// exactly right, because a reinvested dividend IS investment income.
//
// Leaving them in startQty (the first cut) made a DRIP invisible: 100 units at
// a flat $100 with $2/unit reinvested reported $0.00 when the truth was +$200.
function dividendUnitsSince(h, sinceDate, txns = transactions) {
  return (txns || [])
    .filter(t => t.holdingId === h.id && String(t.date).slice(0, 10) > sinceDate &&
                 t.kind === 'dividend')
    .reduce((s, t) => s + (+t.units || 0), 0);
}

// Close at or before a date, from a Yahoo chart series. `series` picks which
// of the two co-indexed price series to read — see startPriceFor.
function closeAtOrBefore(chart, dateStr, series = 'closes') {
  const values = chart?.[series] || chart?.adjcloses;
  if (!chart?.timestamps?.length || !values) return null;
  const cutoff = Date.parse(dateStr + 'T23:59:59Z');
  let found = null;
  for (let i = 0; i < chart.timestamps.length; i++) {
    const c = values[i];
    if (c == null) continue;
    if (chart.timestamps[i] * 1000 <= cutoff) found = c; else break;
  }
  return found;
}

// The price this holding stood at when the window opened.
//
// Which series to scale by is NOT cosmetic — it decides whether a dividend
// shows up as a price gain. Adjusted closes are a TOTAL-RETURN series:
// back-adjustment pushes the historical value down by every distribution
// since, so scaling by the adjusted ratio understates the start price by
// roughly the yield and reports the coupon as if the price had risen. VGIT sat
// flat across a year while paying its coupon to cash; on the adjusted ratio
// that reads as a price gain of a few percent, and hundreds of dollars of
// "market", against a truth of zero.
//
//   distributing holding (real ticker) -> RAW close ratio. The cash left the
//     fund. If it was reinvested, the ledger booked a `dividend` row and the
//     extra units are already in qty_now, so counting total return too would
//     double-count it.
//   accumulating CIT (proxy-priced)    -> ADJUSTED ratio. These never
//     distribute; the dividends compound inside the NAV, which is exactly what
//     the proxy's total-return series tracks.
//   Avanza pension                     -> its own stamped NAV, already
//     accumulating and already in the right units.
// Which basis a holding's start price is derived on. ONLY the ticker route is
// a true price return; the other two are total return, because those holdings
// reinvest internally. Labelling all three "price" was misleading for the 401K
// funds and the pension, which together are the larger share of the book.
function priceBasisFor(h) {
  const ticker = (h.ticker || '').toUpperCase();
  return ticker && ticker !== 'N/A' ? 'price' : 'total ret.';
}

function startPriceFor(h, sinceDate, charts) {
  const ratioFrom = (chart, series) => {
    const start = closeAtOrBefore(chart, sinceDate, series);
    const now = (chart?.[series] || chart?.adjcloses || []).filter(x => x != null).pop();
    return start > 0 && now > 0 ? h.price * (start / now) : null;
  };
  const ticker = (h.ticker || '').toUpperCase();
  if (ticker && ticker !== 'N/A') return ratioFrom(charts[ticker], 'closes');

  const proxyKey = Object.keys(PROXY_TRACKED_FUNDS).find(k => (h.name || '').includes(k));
  if (proxyKey) return ratioFrom(charts[PROXY_TRACKED_FUNDS[proxyKey].proxy], 'adjcloses');

  if (Array.isArray(h.fxHistory) && h.fxHistory.length) {
    const prior = h.fxHistory.filter(r => r.date <= sinceDate).pop();
    if (prior?.nav > 0 && prior?.rate > 0) return prior.nav * prior.rate;
  }
  return null;
}

// Pure given `charts`. Returns per-holding rows plus totals that satisfy
// flows + marketGain === totalChange over the attributable set.
function attribution(holdingsArr, charts, sinceDate, txns = transactions) {
  const rows = [], skipped = [];
  for (const h of holdingsArr) {
    const qtyNow = +h.quantity || 0;
    const nowValue = qtyNow * (+h.price || 0);
    const adds = ledgerAddsSince(h, sinceDate, txns);
    const startQty = qtyNow - adds.units - dividendUnitsSince(h, sinceDate, txns);

    // Nothing now, and nothing at the open by the ledger's account. Either the
    // holding has been empty all along, or it was sold on a device that never
    // wrote a row — and nothing available here separates those. `continue` was
    // wrong for the same reason the old nowValue guard was: it hides a real
    // disposal. Declaring costs one line of noise in the harmless case.
    if (!(qtyNow > 0) && !(startQty > 0)) {
      skipped.push({ h, nowValue, reason: 'position is zero and the ledger has no record for this window' });
      continue;
    }
    // The ledger and the position disagree. Clamping invents a loss out of the
    // disagreement; declaring keeps the totals honest about what they cannot know.
    if (startQty < 0) { skipped.push({ h, nowValue, reason: 'ledger exceeds position' }); continue; }

    const startPrice = startPriceFor(h, sinceDate, charts);
    // `== null` let a ZERO price through — and 0 is reachable, because
    // startPriceFor scales h.price, which the table itself renders as '—' when
    // it is unset. A holding at price 0 with an in-window contribution then
    // reported the whole contribution as a market loss.
    if (!(startPrice > 0)) { skipped.push({ h, nowValue, reason: 'no usable price for the window start' }); continue; }
    const startValue = startQty * startPrice;
    rows.push({
      h, startPrice, startValue, nowValue,
      basis: priceBasisFor(h),
      contributed: adds.dollars,
      marketGain: nowValue - startValue - adds.dollars,
      pricePct: startPrice > 0 ? (h.price / startPrice - 1) * 100 : null,
    });
  }
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const totalMarket = sum('marketGain');
  return {
    rows: rows.sort((a, b) => b.marketGain - a.marketGain),
    skipped,
    startValue: sum('startValue'),
    nowValue: sum('nowValue'),
    contributed: sum('contributed'),
    marketGain: totalMarket,
    totalChange: sum('nowValue') - sum('startValue'),
    // Share of the market move each holding is responsible for, on the
    // magnitude of the moves so offsetting winners and losers both count.
    grossMove: rows.reduce((s, r) => s + Math.abs(r.marketGain), 0),
  };
}

// ─── This week (Insights v1 — Drop 2, 2026-10-04) ────────────────────────────
// David, the morning after a day with v1.11.0 on his phone: the Advisor's
// Market panel "doesn't do anything, and it doesn't tell you anything — and why
// is there one and then another one when you select week/month", and the
// Performance chart was "impossible to read on a phone". Both are replaced by
// ONE card under Ask. Collapsed it is two lines: his money for the window net
// of money added, then one market clause and one plan clause. One tap opens
// the market strip, what moved his money, his plan against his own bands, and
// a two-line chart. Deterministic — no model; every number can be checked
// against closes (PLAN.md §3, research/insights-content.md).
//
// The rules it keeps:
// - Windows END on the latest FINAL close (a live bar during market hours is
//   not a close: no intraday noise) and START on a trading-date close. Week =
//   the last complete week, Friday close to Friday close, with one "Since
//   Fri" row added midweek; Month = the close a calendar month back; Since
//   Aug 1 = LEDGER_EPOCH. Never on history-row labels: from 09-02 to 10-02
//   each row carried the previous day's close.
// - Week and Month value his holdings at those closes — tickers at their raw
//   close, 401K CITs through their proxy's total return, the pension at its own
//   NAV × krona stamps — with units backed out through the ledger and money
//   added netted out: attribution()'s rules, pinned to the window's closes.
// - Since Aug 1 is the performance engine's guard-aware return, the figure Ask
//   gives, with the periods it leaves out named.
// - "The S&P" is SPY's price: the series the snapshots, the brief and Ask
//   already use. ^GSPC put a second S&P figure on the same screen, a tenth
//   of a point off the first since Aug 1 (2026-10-02 closes).
// - The pension is never the lead line and never "krona": its price dates are
//   its own (Avanza NAVs stamped when the app happened to run), said on its line.
// - It loads by itself only when signed in. Signed out it paints the last
//   facts it computed and fetches nothing: the fallback chain would hand his
//   tickers to public CORS proxies on every boot.
const WEEK_CACHE_KEY  = 'portfolio_week_v1';
// Sandbox and test switch: '1' lets a signed-out page fetch through
// fetchYahooChart's public chain, so QA can render the card with real closes.
// Nothing in the app sets it, and it only works on a local server: on the
// published github.io shell it is inert (CISO, Drop 2 round 1).
const WEEK_PUBLIC_KEY = 'portfolio_week_public';
const WEEK_PUBLIC_HOSTS = ['localhost', '127.0.0.1'];
const WEEK_REFRESH_MS = 30 * 60 * 1000;     // weekly cadence: half-hourly is plenty
const WEEK_RETRY_MS   = 60 * 1000;          // after a failed fetch, not on every render
const WEEK_FINAL_MIN  = 16 * 60 + 15;       // NY minutes after which today's bar is the close
// A Yahoo bar is stamped at its session's open in the exchange's own zone:
// 09:30 New York for funds, 07:20 Chicago for ^TNX, but 00:00 London for the
// krona — 23:00 UTC the evening BEFORE. A plain UTC or New York date put every
// krona close a day early. Six hours on lands all of them inside their own
// date in New York.
const WEEK_BAR_SHIFT_S = 6 * 3600;
const WEEK_ANCHOR = 'SPY';                  // its trading dates are the windows'
const WEEK_POLICY = ['VTI', 'VXUS', 'BND']; // policyWeights' three
const WEEK_STRIP = [
  { key: 'sp',    ticker: WEEK_ANCHOR,  label: 'S&P 500',        sub: 'price' },
  { key: 'intl',  ticker: 'VXUS',       label: 'International',  sub: 'VXUS' },
  { key: 'bonds', ticker: 'VGIT',       label: 'US bonds',       sub: 'VGIT' },
  { key: 'tenYr', ticker: MACRO_TICKER, label: '10-yr Treasury', yield: true },
  // SEK=X is kronor per dollar; the krona's own move is its inverse.
  { key: 'krona', ticker: 'SEK=X',      label: 'Krona vs $',     perUsd: true },
];

const weekDayOf = d => new Date(d + 'T00:00:00Z').getUTCDay();
const weekAddDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const weekShort = d => new Date(d + 'T00:00:00Z')
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekDow = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
function weekNextWeekday(d) {
  let x = weekAddDays(d, 1);
  while (weekDayOf(x) === 0 || weekDayOf(x) === 6) x = weekAddDays(x, 1);
  return x;
}
function nyMinutes(now = Date.now()) {
  nyMinutes.fmt ||= new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23' });
  const p = nyMinutes.fmt.formatToParts(new Date(now));
  return +p.find(x => x.type === 'hour').value * 60 + +p.find(x => x.type === 'minute').value;
}
// One figure, one rendering everywhere on the card: two decimals under one
// percent (a typical week), one above it (a quarter), so the legend, the strip
// and the headline never show the same number two ways.
const weekPct = n => signed(n, Math.abs(n) < 1 ? 2 : 1, '%');
const weekUsd = n => Math.abs(n) < 0.5 ? '$0'
  : `${n > 0 ? '+' : '−'}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const weekUsdPlain = n => '$' + Math.round(Math.abs(n)).toLocaleString('en-US');

// A chart as [{date, c}] by trading date, the last bar of a date winning.
function weekSeries(chart, which = 'closes') {
  const vals = chart?.[which] || chart?.adjcloses;
  if (!chart?.timestamps?.length || !vals) return [];
  const byDate = new Map();
  chart.timestamps.forEach((ts, i) => {
    const c = vals[i];
    if (c == null || !Number.isFinite(c) || !(c > 0)) return;
    byDate.set(nyToday((ts + WEEK_BAR_SHIFT_S) * 1000), c);
  });
  return [...byDate].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, c]) => ({ date, c }));
}
// Ex-dates as trading dates, same shift as the bars.
function weekDivs(chart) {
  return Object.values(chart?.dividends || {})
    .filter(d => d && d.amount > 0 && d.date > 0)
    .map(d => ({ date: nyToday((d.date + WEEK_BAR_SHIFT_S) * 1000), amount: +d.amount }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
// Today's bar is the live price until the session has closed.
function weekFinal(points, now = Date.now()) {
  const last = points[points.length - 1];
  return last && last.date === nyToday(now) && nyMinutes(now) < WEEK_FINAL_MIN ? points.slice(0, -1) : points;
}
function weekAt(points, date) {
  let found = null;
  for (const p of points || []) { if (p.date <= date) found = p; else break; }
  return found;
}

// The three windows on the anchor's trading dates. Pure; `now` injectable.
//
// The week is always the last COMPLETE week, Friday close to Friday close.
// Until Drop 2 round 1 (2026-10-04) one session after Friday turned it into
// "Since Fri": from Monday evening to Tuesday afternoon the headline, the
// collapsed line, the Week tab and a two-point chart were all ONE day's move
// (CPO: a synthetic Monday close on his doc became the card's headline). That broke "No 1-day figure appears" (Appendix C) and David's
// weekly cadence; every QA screenshot until then was taken on a Sunday.
// Midweek the card ADDS one "Since Fri" row (PLAN §3) — only once at least
// two sessions have closed after that Friday, so Monday's single session
// never gets one — and it is never a tab, never the headline, never in the
// collapsed card. Month and Since Aug 1 still end on the latest close; each
// states its own span.
const WEEK_SINCE_FRI_MIN_SESSIONS = 2;
// The Friday whose close ends the last complete week, by the clock alone.
function weekLastFriday(now = Date.now()) {
  const t = nyToday(now), dow = weekDayOf(t), fri = weekAddDays(t, -((dow + 2) % 7));
  return dow === 5 && nyMinutes(now) < WEEK_FINAL_MIN ? weekAddDays(fri, -7) : fri;
}
// Facts whose week reaches it (a Friday market holiday ends it Thursday). A
// cache from an earlier week is history, not "this week" (CIO, round 2).
const weekIsCurrent = (f, now = Date.now()) =>
  !!f?.windows?.week && f.windows.week.to >= weekAddDays(weekLastFriday(now), -1);
function weekWindows(anchorDates, now = Date.now()) {
  if (!anchorDates || anchorDates.length < 2) return null;
  const end = anchorDates[anchorDates.length - 1];
  const at = d => { let f = null; for (const x of anchorDates) { if (x <= d) f = x; else break; } return f; };
  // The Friday that closes end's week. That week is complete once the Friday
  // has closed — or has passed with no bar (a Friday market holiday ends the
  // week at Thursday's close). Otherwise the last complete week is the one
  // before it.
  const fri = weekAddDays(end, (5 - weekDayOf(end) + 7) % 7);
  const thisDone = end === fri || nyToday(now) > fri;
  const wFri = thisDone ? fri : weekAddDays(fri, -7);
  const wEnd = thisDone ? end : at(wFri);
  const wStart = at(weekAddDays(wFri, -7));
  // Sessions that have closed since the week's last close.
  const after = wEnd ? anchorDates.filter(d => d > wEnd).length : 0;
  const [y, m, d] = end.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const dim = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const mStart = at(`${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`);
  return {
    end,
    week: wStart && wEnd && wStart < wEnd ? { start: wStart, end: wEnd, complete: true,
      label: `Week to ${weekDow(wEnd)} ${weekShort(wEnd)}`,
      // Once a session has closed after it, it is last week.
      words: after ? 'last week' : 'this week', sessionsAfter: after } : null,
    sinceFri: wEnd && after >= WEEK_SINCE_FRI_MIN_SESSIONS
      ? { start: wEnd, end, sessions: after, label: `Since ${weekDow(wEnd)} ${weekShort(wEnd)}`,
          words: `since ${weekDow(wEnd)}` } : null,
    month: mStart && { start: mStart, end, label: `${weekShort(mStart)} → ${weekShort(end)}`, words: 'this month' },
    epoch: { start: at(LEDGER_EPOCH), end },
  };
}

// A holding's price at a trading date's close, by the same three routes as
// attribution(). The pension takes its last stamp before the next session
// opens: a Saturday stamp carries Friday's NAV and Friday's krona.
function weekPriceAt(h, date, ctx) {
  if (hasRealTicker(h)) {
    const p = weekAt(ctx.closes[h.ticker.toUpperCase()], date);
    return p ? { price: p.c } : null;
  }
  const proxy = proxyEntryFor(h)?.proxy;
  if (proxy) {
    // Scaled from the proxy's latest bar, the reference fetchProxyNav priced
    // h.price against — an accumulating CIT moves on total return.
    const s = ctx.adj[proxy] || [], p = weekAt(s, date), last = s[s.length - 1];
    return p && last && h.price > 0 ? { price: h.price * p.c / last.c } : null;
  }
  if (Array.isArray(h.fxHistory) && h.fxHistory.length) {
    const before = weekNextWeekday(date);
    let st = null;
    for (const r of h.fxHistory) {
      if (r && r.date < before && r.nav > 0 && r.rate > 0 && (!st || r.date >= st.date)) st = r;
    }
    return st ? { price: st.nav * st.rate, stamp: st.date } : null;
  }
  return null;
}

const WEEK_FLOW_KINDS = ['contribution', 'adjustment'];
// Units the ledger added after a date (dividend units too: not held then).
function weekUnitsAfter(h, date, txns) {
  return (txns || []).filter(t => t.holdingId === h.id && String(t.date).slice(0, 10) > date &&
    (WEEK_FLOW_KINDS.includes(t.kind) || t.kind === 'dividend')).reduce((s, t) => s + (+t.units || 0), 0);
}
// Money added in (a, b] — externalFlows' kinds; a reinvested dividend is income.
function weekFlowIn(h, a, b, txns) {
  return (txns || []).filter(t => t.holdingId === h.id && WEEK_FLOW_KINDS.includes(t.kind) &&
    String(t.date).slice(0, 10) > a && String(t.date).slice(0, 10) <= b).reduce((s, t) => s + (+t.amount || 0), 0);
}

// His money over one window's trading dates: value at each close, money added
// between closes, and the chained growth net of it. A holding with no price at
// a close it was held for is left out of every date and named — never zeroed.
//
// So is a stamp-priced fund (the pension) whose last stamp in the window is no
// newer than its first (CPO, Drop 2 round 2): one stamp at both ends priced
// the whole pension flat, and the week read well under the S&P with no word
// why. That happens on every weekly open whose closes land before the
// boot's Avanza refresh stamps a new NAV, and stays if that refresh fails. It
// is named as not in the figure and kept out of the percentage's base.
function weekMoney(holdingsArr, txns, ctx, dates) {
  const n = dates.length, priced = [], left = [], noNewPrice = [];
  for (const h of holdingsArr) {
    const qNow = +h.quantity || 0;
    const qty = dates.map(d => qNow - weekUnitsAfter(h, d, txns));
    if (qty.every(q => Math.abs(q) < 1e-9)) continue;                 // never held in the window
    if (qty.some(q => q < -1e-9)) { left.push(h); continue; }         // ledger exceeds the position
    const px = dates.map((d, i) => (qty[i] > 1e-9 ? weekPriceAt(h, d, ctx) : { price: 0 }));
    if (px.some(p => !p)) { left.push(h); continue; }
    if (qty[0] > 1e-9 && px[0].stamp && px[n - 1].stamp && px[n - 1].stamp <= px[0].stamp) {
      noNewPrice.push({ h, since: px[n - 1].stamp });
      continue;
    }
    priced.push({ h, vals: dates.map((_, i) => qty[i] * px[i].price),
      flows: dates.map((d, i) => (i ? weekFlowIn(h, dates[i - 1], d, txns) : 0)),
      qty, stampFrom: px[0].stamp || null, stampTo: px[n - 1].stamp || null });
  }
  const V = i => priced.reduce((s, r) => s + r.vals[i], 0);
  const F = i => priced.reduce((s, r) => s + r.flows[i], 0);
  const index = [0];
  let g = 1;
  for (let i = 1; i < n; i++) {
    const v0 = V(i - 1);
    g *= v0 > 0 ? (V(i) - F(i)) / v0 : 1;
    index.push((g - 1) * 100);
  }
  const added = priced.reduce((s, r) => s + r.flows.reduce((a, b) => a + b, 0), 0);
  return { startValue: V(0), endValue: V(n - 1), added, gain: V(n - 1) - V(0) - added,
    pct: index[n - 1], index, priced, left, noNewPrice };
}

// What moved his money: one line per position, a fund split across two
// sleeves as ONE line, the pension (stamp-priced) as one line for the account.
function weekFundName(h) {
  const name = String(h.name || '').replace(/^Länsförsäkringar\b/, 'LF');
  return `${name.length > 26 ? name.slice(0, 25) + '…' : name} (${h.account || 'Unassigned'})`;
}
function weekLineName(h) {
  if (hasRealTicker(h)) return `${h.ticker.toUpperCase()} (${h.account || 'Unassigned'})`;
  const px = proxyEntryFor(h);
  if (px) return `${px.index} fund (${h.account || 'Unassigned'})`;
  if (Array.isArray(h.fxHistory) && h.fxHistory.length) return h.account || h.name;
  return weekFundName(h);
}
// The funds a window could not reprice, one entry per line name. When the
// same account also has a fund that WAS repriced (one Avanza fetch failed,
// the other did not), the stale one goes by its own name, so "Swedish
// pension" never names both a moved line and a fund left out.
function weekNoNewPrice(m) {
  const pricedNames = new Set(m.priced.map(r => weekLineName(r.h)));
  const groups = new Map();
  for (const { h, since } of m.noNewPrice) {
    const name = pricedNames.has(weekLineName(h)) ? weekFundName(h) : weekLineName(h);
    const g = groups.get(name);
    if (!g) groups.set(name, { name, since });
    else if (since > g.since) g.since = since;
  }
  return [...groups.values()];
}
function weekLines(money, ctx, dates) {
  const start = dates[0], end = dates[dates.length - 1], n = dates.length;
  const groups = new Map();
  for (const r of money.priced) {
    const stamped = !!r.stampTo;
    const key = stamped ? 'acct\n' + (r.h.account || r.h.name) : r.h.name + '\n' + (r.h.account || '');
    const g = groups.get(key) || { name: weekLineName(r.h), account: r.h.account || null, gain: 0, added: 0,
      payout: 0, exDate: null, from: null, to: null };
    const added = r.flows.reduce((a, b) => a + b, 0);
    g.gain += r.vals[n - 1] - r.vals[0] - added;
    g.added += added;
    if (stamped) {
      if (!g.from || r.stampFrom < g.from) g.from = r.stampFrom;
      if (!g.to || r.stampTo > g.to) g.to = r.stampTo;
    }
    // A payout that went ex inside the window left the price, not his pocket:
    // named on the line, never read as a loss (PLAN §3). Units held the day before.
    if (hasRealTicker(r.h)) {
      for (const dv of ctx.divs[r.h.ticker.toUpperCase()] || []) {
        if (dv.date <= start || dv.date > end) continue;
        const i = dates.findIndex(d => d >= dv.date);
        const units = i > 0 ? r.qty[i - 1] : r.qty[0];
        g.payout += dv.amount * units;
        if (!g.exDate || dv.date > g.exDate) g.exDate = dv.date;
      }
    }
    groups.set(key, g);
  }
  const all = [...groups.values()].map(g => ({ ...g,
    // Priced on its own dates: said on the line, and never the lead line.
    offWindow: g.from != null && (g.from !== start || g.to !== end) }));
  const top = all.slice().sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain)).slice(0, 3)
    .sort((a, b) => (a.offWindow - b.offWindow) || Math.abs(b.gain) - Math.abs(a.gain));
  const rest = all.filter(g => !top.includes(g));
  return {
    lines: top.map(g => ({ name: g.name, account: g.account, gain: g.gain, added: g.added,
      payout: g.payout > 0.005 ? { amount: g.payout, exDate: g.exDate } : null,
      pricedFrom: g.offWindow ? g.from : null, pricedTo: g.offWindow ? g.to : null })),
    // Its money added too: on Month the three lines said "net of $X added"
    // and Everything else did not, so the lines did not add up to the
    // headline's figure (QA, Drop 2 round 1).
    rest: rest.length ? { gain: rest.reduce((s, g) => s + g.gain, 0), count: rest.length,
      added: rest.reduce((s, g) => s + g.added, 0), payout: rest.reduce((s, g) => s + g.payout, 0) } : null,
  };
}

// The market strip for a window: each series' close-to-close move.
function weekStrip(ctx, start, end) {
  return WEEK_STRIP.map(s => {
    const a = weekAt(ctx.closes[s.ticker], start), b = weekAt(ctx.closes[s.ticker], end);
    const base = { key: s.key, label: s.label, sub: s.sub || null };
    if (!a || !b || a === b) return { ...base, na: true };
    if (s.yield) return { ...base, level: b.c, bp: (b.c - a.c) * 100 };
    return { ...base, pct: s.perUsd ? (a.c / b.c - 1) * 100 : (b.c / a.c - 1) * 100 };
  });
}

// His plan in one line, from the SAME driftCheck as Where you stand. Inside
// the bands it also says how far stocks would have to fall before one trips —
// distance to his own rule, not an adjective (Appendix C: "A band trips only
// if stocks fall N%").
const WEEK_STOCK_SLEEVES = ['us_stock', 'intl_stock', 'tilt'];
function weekPlan(sleeveVals, tgtPcts, totalValue, bandAbs, bandRel) {
  const d = driftCheck(sleeveVals, tgtPcts, totalValue, bandAbs, bandRel);
  if (!d.rows.length) return null;
  const limit = r => Math.min(bandAbs, r.tgtPct > 0 ? r.tgtPct * bandRel / 100 : Infinity);
  const sleeves = d.rows.map(r => ({ sleeve: r.sleeve, label: r.label, nowPct: r.curPct, targetPct: r.tgtPct,
    driftPp: r.driftPp, limitPp: limit(r), outOfBand: r.outOfBand }));
  const tripsAt = dir => {
    for (let x = dir * 0.001; Math.abs(x) <= 0.9; x += dir * 0.001) {
      const s = {};
      let tot = 0;
      for (const [k, v] of Object.entries(sleeveVals)) {
        s[k] = WEEK_STOCK_SLEEVES.includes(k) ? v * (1 + x) : v;
        tot += s[k];
      }
      if (driftCheck(s, tgtPcts, tot, bandAbs, bandRel).anyOutOfBand) return +(x * 100).toFixed(1);
    }
    return null;
  };
  const near = d.anyOutOfBand ? [] : sleeves.filter(r => Math.abs(r.driftPp) >= 0.9 * r.limitPp);
  const state = d.anyOutOfBand ? 'out' : near.length ? 'near' : 'in';
  const fall = state === 'out' ? null : tripsAt(-1);
  const names = list => list.map(r => r.label).join(' and ');
  const out = sleeves.filter(r => r.outOfBand);
  const pct1 = n => n.toFixed(1) + '%';
  // One sleeve: "Bond is outside your bands: N%, target T%." Several are each
  // named with their figures. (The old form said the sleeve's name twice, and
  // "against a 8x% target" misread — CPO, round 2.)
  const figs = list => (list.length > 1
    ? list.map(r => `${r.label} ${pct1(r.nowPct)} (target ${pct1(r.targetPct)})`).join(', ')
    : `${pct1(list[0].nowPct)}, target ${pct1(list[0].targetPct)}`);
  const line = state === 'out'
    ? `${names(out)} ${out.length > 1 ? 'are' : 'is'} outside your bands: ${figs(out)}.`
    : state === 'near'
      ? `Inside your bands, with ${names(near)} near ${near.length > 1 ? 'their edges' : 'its edge'}: ${figs(near)}.`
      : 'Inside all your bands.' + (fall != null ? ` A band trips only if stocks fall about ${Math.abs(fall).toFixed(0)}%.` : '');
  // Short: it shares line 2 with the market clause, one line at 375px. Two
  // sleeves by name ran line 2 to three lines at 375 (QA, Drop 2 round 1);
  // the expanded plan line names them.
  const clause = state === 'out' ? (out.length > 1 ? `${out.length} sleeves outside your bands` : `${names(out)} outside its band`)
    : state === 'near' ? (near.length > 1 ? `${near.length} sleeves near your bands` : `${names(near)} near its band`)
    : 'inside your bands';
  return { state, line, clause, stocksFallPct: fall, sleeves };
}

// Since Aug 1: the performance engine's own chain, over snapshots up to the
// window's end (a row dated after it is today's live value, not a close), with
// the guard's left-out periods named. S&P from the same rows, so the two lines
// can never be a day apart.
function weekEpoch(snapshots, txns, end) {
  const flows = externalFlows(txns);
  const cutoff = weekNextWeekday(end);
  const snaps = (snapshots || []).filter(s => s.date < cutoff);
  const post = snaps.filter(s => s.date >= LEDGER_EPOCH);
  if (post.length < 2) return null;
  const last = post[post.length - 1];
  const excluded = flagsWithin(performanceHealth(snaps, flows), post[0].date, last.date);
  const idx = twrIndex(post, flows, excluded);
  if (!idx) return null;
  const spy0 = post[0].spyPrice;
  const spy = s => (spy0 > 0 && s.spyPrice > 0 ? (s.spyPrice / spy0 - 1) * 100 : null);
  // Drawn by the close each row holds: a Saturday or Sunday row is Friday's
  // close (the first row, Sat Aug 1, is Jul 31's), so it is labelled Friday
  // and only the weekend's last row is kept. The chain itself runs over every
  // row, so the end point is the headline figure exactly.
  const marketDate = d => (weekDayOf(d) === 6 ? weekAddDays(d, -1) : weekDayOf(d) === 0 ? weekAddDays(d, -2) : d);
  const keep = new Map();
  post.forEach((s, i) => keep.set(marketDate(s.date), i));
  const pick = [...keep.values()];
  return { from: post[0].date, to: last.date, pct: (idx[idx.length - 1] - 1) * 100, excluded,
    spPct: spy(last), chart: { dates: [...keep.keys()], you: pick.map(i => (idx[i] - 1) * 100),
      sp: pick.map(i => spy(post[i])) } };
}

// Every symbol the card reads: the strip, his tickers, the CITs' proxies, and
// the policy mix's three.
function weekSymbols(holdingsArr) {
  const s = new Set(WEEK_STRIP.map(x => x.ticker));
  for (const h of holdingsArr) {
    if (hasRealTicker(h)) s.add(h.ticker.toUpperCase());
    else if (proxyEntryFor(h)) s.add(proxyEntryFor(h).proxy);
  }
  WEEK_POLICY.forEach(t => s.add(t));
  return [...s];
}

// The card's facts for all three windows. Pure: plain JSON out (it is cached
// and it rides in the Ask brief), no holding objects, no ids.
function weekCompute({ holdingsArr, txns, charts, snapshots, tgt, now = Date.now(), fetchedAt = null }) {
  const ctx = { closes: {}, adj: {}, divs: {} };
  for (const [t, c] of Object.entries(charts || {})) {
    ctx.closes[t] = weekSeries(c, 'closes');
    ctx.adj[t] = weekSeries(c, 'adjcloses');
    ctx.divs[t] = weekDivs(c);
  }
  const anchor = weekFinal(ctx.closes[WEEK_ANCHOR] || [], now);
  const W = weekWindows(anchor.map(p => p.date), now);
  if (!W) return null;
  const spAt = (d, d0) => { const a = weekAt(anchor, d0), b = weekAt(anchor, d); return a && b ? (b.c / a.c - 1) * 100 : null; };
  const out = { v: 1, asOf: W.end, fetchedAt, windows: {} };
  // The performance guard, once, for every window (Drop 2 round 1, CIO): the
  // Month tab quoted a percentage "net of money added" straight across the
  // flagged 2026-09-13 period that the Since Aug 1 tab, on the same card,
  // leaves out and names. weekMoney's index is a chained return net of flows —
  // a TWR — and CLAUDE.md: never quote one across a flagged period. Such a
  // window keeps its dollars and says the money added is what the record
  // says; it shows no percentage, and the chart draws the S&P alone.
  const health = performanceHealth(snapshots || [], externalFlows(txns));
  // Ledger money booked to an id the app no longer has: weekFlowIn matches by
  // id, so it silently counted as neither added nor held. Named instead — by
  // the row's own holdingName (CPO, Drop 2 round 2). His 2026-09-13 LF Global
  // Index row points at the fund's id from BEFORE its split, and the card
  // called it "a holding no longer in the app" two lines under the fund
  // itself. A name held as a split position is the split; any other current
  // lot of that name is an earlier record of a fund he still holds; none is a
  // true orphan.
  const ids = new Set((holdingsArr || []).map(h => h.id));
  // "Split" only for a name held as ONE split position (positionsIn: same
  // name, account and price, two sleeves). Two lots that merely share a name
  // are two positions: VOO in the Roth and the Brokerage was never split, and
  // an orphan VOO row read "booked to the fund's record from before it was
  // split" on the card and in the brief (CIO, Drop 2 round 3).
  const splitNames = new Set(positionsIn(holdingsArr || []).filter(l => l.length > 1).map(l => l[0].name));
  const unmatchedIn = (a, b) => {
    const rows = (txns || []).filter(t => WEEK_FLOW_KINDS.includes(t.kind) && !ids.has(t.holdingId) &&
      String(t.date).slice(0, 10) > a && String(t.date).slice(0, 10) <= b);
    if (!rows.length) return null;
    const entries = new Map();
    for (const t of rows) {
      const holding = String(t.holdingName || '').trim() || null;   // a row with no name: "recorded"
      const same = holding ? (holdingsArr || []).filter(h => h.name === holding).length : 0;
      const kind = holding && splitNames.has(holding) ? 'split' : same ? 'earlier' : 'gone';
      const e = entries.get(holding + '\n' + kind) || { holding, kind, count: 0, amount: 0, dates: [] };
      const d = String(t.date).slice(0, 10);
      e.count++; e.amount += +t.amount || 0;
      if (!e.dates.includes(d)) e.dates.push(d);
      entries.set(holding + '\n' + kind, e);
    }
    return { count: rows.length, amount: rows.reduce((x, t) => x + (+t.amount || 0), 0),
      dates: [...new Set(rows.map(t => String(t.date).slice(0, 10)))].sort(),
      entries: [...entries.values()].map(e => ({ ...e, dates: e.dates.sort() })) };
  };
  // A window that left a holding out for want of a price (one chart that did
  // not come back) is a figure for part of the portfolio: its dollars stand,
  // named, but no percentage and no "You" line (CIO, Drop 2 round 2 — one
  // failed VOO chart put a figure for part of the book on the card as his
  // week, unmarked). A fund with no new price (weekNoNewPrice) keeps the
  // rest's percentage: it is out of the base, and named.
  const money = (w, dates) => {
    const m = weekMoney(holdingsArr, txns, ctx, dates);
    const flagged = flagsWithin(health, w.start, w.end);
    return { m, flagged, unmatched: unmatchedIn(w.start, w.end), noNewPrice: weekNoNewPrice(m),
      left: m.left.map(h => weekLineName(h)), leftShort: m.left.map(h => (hasRealTicker(h) ? h.ticker.toUpperCase() : null)),
      you: { startValue: m.startValue, endValue: m.endValue, added: m.added, gain: m.gain,
        pct: flagged.length || m.left.length ? null : m.pct } };
  };
  for (const key of ['week', 'month']) {
    const w = W[key];
    if (!w) continue;
    const dates = anchor.filter(p => p.date >= w.start && p.date <= w.end).map(p => p.date);
    if (dates.length < 2) continue;
    const r = money(w, dates);
    const moved = weekLines(r.m, ctx, dates);
    out.windows[key] = { key, label: w.label, words: w.words, from: w.start, to: w.end, complete: !!w.complete,
      you: r.you, flagged: r.flagged, unmatched: r.unmatched,
      strip: weekStrip(ctx, w.start, w.end), lines: moved.lines, rest: moved.rest,
      left: r.left, leftShort: r.leftShort, noNewPrice: r.noNewPrice,
      chart: { dates, you: r.you.pct == null ? null : r.m.index, sp: dates.map(d => spAt(d, w.start)) } };
  }
  // Midweek: one secondary row, never a tab, never the headline.
  if (W.sinceFri) {
    const w = W.sinceFri;
    const dates = anchor.filter(p => p.date >= w.start && p.date <= w.end).map(p => p.date);
    if (dates.length >= 2) {
      const r = money(w, dates);
      out.windows.sinceFri = { key: 'sinceFri', label: w.label, words: w.words, from: w.start, to: w.end,
        sessions: w.sessions, you: r.you, flagged: r.flagged, unmatched: r.unmatched,
        spPct: spAt(w.end, w.start), left: r.left, leftShort: r.leftShort, noNewPrice: r.noNewPrice };
    }
  }
  const ep = W.epoch.start ? weekEpoch(snapshots, txns, W.end) : null;
  // His target mix over the same span: the policy series, dividends in.
  let mixPct = null;
  const weights = policyWeights(tgt);
  if (weights && W.epoch.start) {
    const series = computePolicySeries(Object.fromEntries(WEEK_POLICY.map(t => [t, charts?.[t]])), weights);
    if (series) {
      const [p0, p1] = samplePolicyAt(series, [W.epoch.start, W.end]);
      if (p0 > 0 && p1 > 0) mixPct = (p1 / p0 - 1) * 100;
    }
  }
  out.windows.epoch = { key: 'epoch', label: 'Since ' + weekShort(LEDGER_EPOCH), words: 'since ' + weekShort(LEDGER_EPOCH),
    from: W.epoch.start, to: W.end, perf: ep, mixPct, strip: W.epoch.start ? weekStrip(ctx, W.epoch.start, W.end) : [] };
  return out;
}

// The card's facts as the Ask brief carries them: the same numbers, named for
// a reader that never sees the card, rounded, no chart arrays. `plan` is the
// card's plan line, computed by the caller from the live drift.
const WEEK_SERIES_NAMES = { sp: 'S&P 500 (SPY price)', intl: 'International stocks (VXUS price)',
  bonds: 'US Treasuries (VGIT price)', tenYr: '10-yr Treasury yield', krona: 'Krona vs dollar' };
function askWeek(facts, r2, plan) {
  if (!facts?.windows?.week && !facts?.windows?.month) return null;
  const market = list => (list || []).filter(s => !s.na).map(s => (s.level != null
    ? { series: WEEK_SERIES_NAMES[s.key], levelPct: r2(s.level), changeBp: r2(s.bp) }
    : { series: WEEK_SERIES_NAMES[s.key], pct: r2(s.pct) }));
  // What the record cannot split, said where the figure is (Drop 2 round 1):
  // a flagged window's percentage goes out null, and money booked against an
  // id the app no longer has is named — by holding, and by what that record
  // is (round 2: his LF Global row is the fund's pre-split record, not a
  // holding that is gone).
  const BOOKED_TO = { split: "the fund's record from before it was split — the fund is still held",
    earlier: 'an earlier record of a fund still held', gone: 'a holding no longer in the app' };
  const caveats = w => ({
    ...(w.flagged?.length ? { periodsTheRecordCannotSplit: w.flagged } : {}),
    ...(w.unmatched ? { entriesNotCountedAsAdded: (w.unmatched.entries || [{ holding: null, kind: 'gone',
      count: w.unmatched.count, amount: w.unmatched.amount, dates: w.unmatched.dates }]).map(e => ({
      holding: e.holding, count: e.count, amount: r2(e.amount), dates: e.dates, bookedTo: BOOKED_TO[e.kind] })) } : {}),
    ...((w.noNewPrice || []).length ? { noNewPriceInWindow: w.noNewPrice.map(x => ({ holding: x.name, lastPriced: x.since })) } : {}),
  });
  // A figure for part of the portfolio says which part (CIO, Drop 2 round 2):
  // a holding with no price for the window, or a fund with no new one, is out
  // of `you`; with one not priced at all the percentage goes out null.
  const you = (y, w) => {
    const out = (w.left || []).concat((w.noNewPrice || []).map(x => x.name));
    return { startValue: r2(y.startValue), endValue: r2(y.endValue), moneyAdded: r2(y.added),
      changeNetOfMoneyAdded: r2(y.gain), pctNetOfMoneyAdded: (w.left || []).length ? null : r2(y.pct),
      ...(out.length ? { excludesHoldings: out } : {}) };
  };
  // Each line's change is net of the money added to it: the key says so. As
  // `change`, an eval answer read a line's gain as partly the money added to
  // it, where the card says "net of $X added" (Drop 2 round 1).
  const win = w => w && {
    window: w.label, from: w.from, to: w.to,
    you: you(w.you, w), ...caveats(w),
    market: market(w.strip),
    moved: (w.lines || []).map(l => ({ holding: l.name, changeNetOfMoneyAdded: r2(l.gain), moneyAdded: r2(l.added),
      payout: l.payout ? { amount: r2(l.payout.amount), exDate: l.payout.exDate } : null,
      pricedFrom: l.pricedFrom, pricedTo: l.pricedTo })),
    everythingElse: w.rest ? { changeNetOfMoneyAdded: r2(w.rest.gain), moneyAdded: r2(w.rest.added ?? null),
      holdings: w.rest.count, payouts: r2(w.rest.payout) } : null,
    notPriced: w.left || [],
  };
  const sf = facts.windows.sinceFri;
  const e = facts.windows.epoch, p = e?.perf;
  return {
    closesTo: facts.asOf, pricesFetched: facts.fetchedAt || null,
    week: win(facts.windows.week) || null,
    sinceFri: sf ? { window: sf.label, from: sf.from, to: sf.to, sessions: sf.sessions, you: you(sf.you, sf),
      ...caveats(sf), ...((sf.left || []).length ? { notPriced: sf.left } : {}), sp500PricePct: r2(sf.spPct) } : null,
    month: win(facts.windows.month) || null,
    sinceAug1: e ? { fromClose: e.from, to: e.to, market: market(e.strip),
      you: p ? { twrPct: r2(p.pct), fromSnapshot: p.from, toSnapshot: p.to, excludedPeriods: p.excluded } : null,
      sp500PricePct: p ? r2(p.spPct) : null, targetMixTotalReturnPct: r2(e.mixPct) } : null,
    plan: plan ? { state: plan.state, line: plan.line, stocksFallThatTripsABandPct: plan.stocksFallPct } : null,
  };
}

let weekCharts = null;      // { fetchedAt: ms, charts, missing } — this session's fetch
let weekFactsData = loadWeekCache();
let weekWin = 'week';
let weekOpen = false;
let weekBusy = false;
let weekFailedAt = 0;
let weekChartInst = null;
let weekSavedJson = null;
let weekChips = [];

function loadWeekCache() {
  try {
    const f = JSON.parse(localStorage.getItem(WEEK_CACHE_KEY) || 'null');
    return f && f.v === 1 && f.windows ? f : null;
  } catch (e) { return null; }
}
function saveWeekCache(facts) {
  try {
    const json = JSON.stringify(facts);
    if (json !== weekSavedJson) { localStorage.setItem(WEEK_CACHE_KEY, json); weekSavedJson = json; }
  } catch (e) { /* storage full or blocked: the card still renders from memory */ }
}
function weekPublicAllowed(host = location.hostname) {
  if (!WEEK_PUBLIC_HOSTS.includes(host)) return false;
  try { return localStorage.getItem(WEEK_PUBLIC_KEY) === '1'; } catch (e) { return false; }
}
function weekCanFetch() {
  return (typeof cloudReady === 'function' && cloudReady()) || weekPublicAllowed();
}

// The policy series for the Ask brief's vsPolicyBenchmark, from charts already
// in hand (it used to load with the Performance card's third line).
function weekWarmPolicy(charts, range) {
  const weights = policyWeights(targets);
  if (!weights) return;
  const series = computePolicySeries(Object.fromEntries(WEEK_POLICY.map(t => [t, charts[t]])), weights);
  if (series) policyCache = { key: range + ':' + JSON.stringify(weights), series };
}

async function refreshWeek() {
  if (weekBusy || !weekCanFetch() || !holdings.length) return;
  weekBusy = true;
  const t0 = performance.now();
  try {
    const range = policyRangeFor(LEDGER_EPOCH);
    const symbols = weekSymbols(holdings);
    // Signed in, the edge or nothing — decided once, before the fan-out, so a
    // refresh refused half-way cannot tip the rest onto the public chain.
    // Only the sandbox switch (signed out, on localhost) uses that chain.
    const publicFallback = !(typeof cloudReady === 'function' && cloudReady());
    // In parallel: the Advisor's panels fetched one chart after another.
    const got = await Promise.all(symbols.map(t =>
      fetchYahooChart(t, range, { events: true, publicFallback }).catch(() => null)));
    const charts = {};
    symbols.forEach((t, i) => { if (got[i]) charts[t] = got[i]; });
    if (!charts[WEEK_ANCHOR]) { weekFailedAt = Date.now(); return; }
    // The symbols his money is priced from (his tickers, the CITs' proxies).
    // One that did not come back leaves a holding out of every window: the
    // fetch counts, but it is tried again after WEEK_RETRY_MS, not half an
    // hour (CIO, Drop 2 round 2 — one VOO 502 held a partial figure, cached,
    // for 30 minutes).
    const held = [...new Set(holdings.map(h => (hasRealTicker(h) ? h.ticker.toUpperCase() : proxyEntryFor(h)?.proxy))
      .filter(Boolean))];
    weekCharts = { fetchedAt: Date.now(), charts, missing: held.filter(t => !charts[t]) };
    weekFailedAt = 0;
    console.log(`[week] ${Object.keys(charts).length}/${symbols.length} charts in ${Math.round(performance.now() - t0)} ms`);
  } finally {
    weekBusy = false;
    renderWeekCard();   // the new facts, or "unavailable" after a failed fetch
  }
}

// Called from render(): cheap unless the charts are missing or half an hour old.
function maybeRefreshWeek() {
  if (weekBusy || !holdings.length || !weekCanFetch()) return;
  const now = Date.now();
  if (weekCharts && now - weekCharts.fetchedAt < (weekCharts.missing?.length ? WEEK_RETRY_MS : WEEK_REFRESH_MS)) return;
  if (weekFailedAt && now - weekFailedAt < WEEK_RETRY_MS) return;
  refreshWeek();
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && typeof holdings !== 'undefined') maybeRefreshWeek();
});

// Closing it goes back to the week: the card is "This week" whenever it is shut.
function weekToggle() {
  weekOpen = !weekOpen;
  if (!weekOpen) weekWin = 'week';
  renderWeekCard();
}
function weekSetWindow(key) {
  if (!['week', 'month', 'epoch'].includes(key)) return;
  weekWin = key;
  renderWeekCard();
}
// "Ask about this": fills the one general Ask box and puts the cursor there.
// Never sends — the question is his to send (PLAN §3). askPrefill keeps a
// half-typed question and tags the send `src=insight` for the log.
function weekAsk(i) {
  const q = weekChips[i];
  if (q) askPrefill(q, 'insight');
}

// Deterministic chips, picked by what the window shows; never model-written.
function weekChipsFor(w, plan) {
  const out = [];
  const pension = (w.lines || []).find(l => l.pricedFrom);
  if (w.key !== 'epoch' && pension && Math.abs(pension.gain) >= 1) {
    out.push(`Why did my pension ${pension.gain < 0 ? 'drop' : 'rise'} ${w.words}?`);
  }
  if (w.key === 'epoch') out.push('How have I done since August?');
  const ten = (w.strip || []).find(s => s.key === 'tenYr' && !s.na);
  // Short enough for one line at 375 (CPO, Drop 2 round 1): the long form
  // wrapped to two and cost the expanded card a row.
  if (ten && Math.abs(ten.bp) >= 5) out.push(`What do ${ten.level.toFixed(2)}% yields mean for my bonds?`);
  if ((w.lines || []).some(l => l.payout) && out.length < 2) out.push('How do dividends show up in my numbers?');
  out.push(plan && plan.state !== 'in' ? 'What does my band rule say to do now?' : 'How far am I from a rebalance?');
  return out.slice(0, 3);
}

// Line 1. The window is in the kicker above it ("This week · to Fri Oct 2"),
// so the line is only the money: short enough for one line at 375px. The
// money-added clause never breaks inside itself: at 375 the Month line used
// to leave "added" alone on a second line.
function weekHeadline(w) {
  if (w.key === 'epoch') {
    const p = w.perf;
    return p ? `<strong>${weekPct(p.pct)}</strong> · net of money added` : null;
  }
  const y = w.you;
  // A window across a flagged period: the dollars and what the record says
  // was added, no percentage (the foot says why).
  if ((w.flagged || []).length) {
    // "net of": "$X recorded as added" read as gross beside lines that say
    // "net of $X added" (CPO, round 2).
    const rec = Math.abs(y.added) < 0.5 ? 'nothing recorded as added'
      : `net of ${weekUsdPlain(y.added)} recorded as ${y.added > 0 ? 'added' : 'taken out'}`;
    return `<strong>${weekUsd(y.gain)}</strong> <span class="week-nw">· ${rec}</span>`;
  }
  const added = Math.abs(y.added) < 0.5 ? 'nothing added'
    : y.added > 0 ? `net of ${weekUsdPlain(y.added)} added` : `net of ${weekUsdPlain(y.added)} taken out`;
  // Part of the portfolio (a holding not priced): dollars, no percentage —
  // line 2 says what is out (CIO, Drop 2 round 2).
  if (y.pct == null || (w.left || []).length) return `<strong>${weekUsd(y.gain)}</strong> <span class="week-nw">· ${added}</span>`;
  return `<strong>${weekUsd(y.gain)} (${weekPct(y.pct)})</strong> <span class="week-nw">· ${added}</span>`;
}
// What the record cannot split, under the window it applies to. Ledger rows
// the window could not count are named by holding, and said under the
// flagged date they belong to — one footnote for Sep 13, not two (CPO, Drop 2
// round 2: "a holding no longer in the app" sat beside a note about the same
// event, two lines under the fund it named).
const weekList = ds => new Intl.ListFormat('en-US').format(ds);
function weekEntrySentence(e) {
  const one = e.count === 1;
  const lead = `${one ? '1 entry' : `${e.count} entries`} ${e.holding ? `for ${e.holding} on` : 'recorded'} ${weekList(e.dates.map(weekShort))} (${weekUsdPlain(e.amount)})`;
  if (e.kind === 'split') return `${lead} ${one ? 'is' : 'are'} booked to the fund's record from before it was split, so ${one ? "it isn't" : "they aren't"} counted as added.`;
  if (e.kind === 'earlier') return `${lead} ${one ? 'is' : 'are'} booked to an earlier record of the fund, so ${one ? "it isn't" : "they aren't"} counted as added.`;
  return `${lead} ${one ? 'is' : 'are'} for a holding no longer in the app and ${one ? 'is' : 'are'} not counted as added.`;
}
function weekCaveatsHtml(w) {
  const flagged = w.flagged || [];
  // A cache written before round 2 has no entries: one unnamed sentence.
  const entries = w.unmatched?.count ? (w.unmatched.entries || [{ holding: null, kind: 'gone',
    count: w.unmatched.count, amount: w.unmatched.amount, dates: w.unmatched.dates }]) : [];
  const onFlag = entries.filter(e => e.dates.some(d => flagged.includes(d)));
  const rest = entries.filter(e => !onFlag.includes(e));
  let out = '';
  if (flagged.length) {
    const ds = flagged.map(weekShort);
    out += `<p class="week-foot">${esc(weekList(ds))} ${ds.length > 1 ? 'are' : 'is'} inside this window: the record
      there can't separate money added from the market's move, so no return is shown.${
      onFlag.map(e => ' ' + esc(weekEntrySentence(e))).join('')}</p>`;
  }
  if (rest.length) out += `<p class="week-foot">${rest.map(e => esc(weekEntrySentence(e))).join(' ')}</p>`;
  return out;
}
// What a window's figure leaves out, short enough to lead line 2: "excl. VOO
// ×2", "excl. Swedish pension", else a count.
function weekLeadOut(w) {
  const labels = [...(w.left || []).map((n, i) => (w.leftShort || [])[i] || n),
    ...(w.noNewPrice || []).map(x => x.name)];
  if (!labels.length) return null;
  const counts = new Map();
  labels.forEach(l => counts.set(l, (counts.get(l) || 0) + 1));
  const named = 'excl. ' + [...counts].map(([l, k]) => (k > 1 ? `${l} ×${k}` : l)).join(', ');
  return named.length <= 22 ? named : `excl. ${labels.length} holding${labels.length > 1 ? 's' : ''}`;
}
function weekSecondLine(w, plan) {
  const sp = (w.strip || []).find(s => s.key === 'sp' && !s.na);
  const ten = (w.strip || []).find(s => s.key === 'tenYr' && !s.na);
  // A figure for part of the portfolio says so first (CIO and CPO, Drop 2
  // round 2), beside the S&P only: at 375 the line holds 309px, and the
  // three usual clauses already take 306 (measured). The 10-yr and the plan
  // are a tap away, and Where you stand sits just below.
  const out = w.key === 'epoch' ? null : weekLeadOut(w);
  if (out) return [out, sp && `S&P ${weekPct(sp.pct)}`].filter(Boolean).join(' · ');
  return [sp && `S&P ${weekPct(sp.pct)}`, ten && `10-yr ${ten.level.toFixed(2)}%`, plan && plan.clause]
    .filter(Boolean).join(' · ');
}

function weekStripHtml(strip) {
  return `<div class="week-strip">${strip.map(s => `<div class="week-row">
      <span class="week-name">${esc(s.label)}${s.sub ? `<span class="week-sub"> · ${esc(s.sub)}</span>` : ''}</span>
      <span class="week-num">${s.na ? '—'
        : s.level != null ? `${s.level.toFixed(2)}% <span class="week-sub">${fmtSignedBp(s.bp / 100)}</span>`
        : weekPct(s.pct)}</span>
    </div>`).join('')}</div>`;
}
// Each clause of a line's note stays whole and the line breaks between them:
// at 375 the Month VOO note broke "(ex Sep" / "28)" and the pension's left
// "added" alone (real-data screenshots, Drop 2 round 1).
function weekLinesHtml(w) {
  const row = (name, gain, parts) => `<div class="week-row week-line">
      <span class="week-name">${esc(name)}${parts.length ? `<span class="week-note-line">${
        parts.map(p => `<span class="week-nw">${esc(p)}</span>`).join(' · ')}</span>` : ''}</span>
      <span class="week-num">${weekUsd(gain)}</span>
    </div>`;
  // David reinvests every payout (2026-10-04): the dividend left the price and
  // came back as new units, so it is never described as paid out.
  // Two clauses, each kept whole: as one clause the payout note ran about 260px
  // into a 235-253px name column at 375 and 393 on his data (CIO, final).
  const payout = p => [`incl. ${weekUsdPlain(p.amount)} dividend reinvested`, `ex ${weekShort(p.exDate)}`];
  const lines = (w.lines || []).map(l => row(l.name, l.gain, [
    l.pricedFrom ? `priced ${weekShort(l.pricedFrom)} → ${weekShort(l.pricedTo)}` : null,
    ...(l.payout ? payout(l.payout) : []),
    l.added >= 0.5 ? `net of ${weekUsdPlain(l.added)} added` : null,
  ].filter(Boolean))).join('');
  const rest = w.rest ? row('Everything else', w.rest.gain, [
    w.rest.payout >= 0.5 ? `incl. ${weekUsdPlain(w.rest.payout)} in dividends reinvested` : null,
    w.rest.added >= 0.5 ? `net of ${weekUsdPlain(w.rest.added)} added` : null,
  ].filter(Boolean)) : '';
  // A fund with no new price in the window: named, no figure (CPO, round 2).
  const stale = (w.noNewPrice || []).map(x => `<div class="week-row week-line week-stale">
      <span class="week-name">${esc(x.name)}<span class="week-note-line"><span class="week-nw">no new price since ${
        esc(weekShort(x.since))}</span> — <span class="week-nw">not in this figure</span></span></span>
      <span class="week-num">—</span>
    </div>`).join('');
  const left = (w.left || []).length
    ? `<p class="week-foot">Left out — no price for these dates: ${esc(w.left.join(', '))}.</p>` : '';
  return `<div class="week-lines">${lines}${rest}${stale}</div>${left}`;
}

function renderWeekCard() {
  const card = document.getElementById('weekCard');
  if (!card) return;
  if (!holdings.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  // Recompute from this session's charts whenever the card renders: an edit
  // or a new history row changes the answer, and the maths is a few ms.
  if (weekCharts) {
    // `now` is when the charts were FETCHED, not this render: a bar fetched
    // at 15:50 New York is a live price, and recomputed after 16:15 (inside
    // the half-hour refresh window) it used to count as the day's close.
    const f = weekCompute({ holdingsArr: holdings, txns: transactions, charts: weekCharts.charts,
      snapshots: historyData?.snapshots || [], tgt: targets, now: weekCharts.fetchedAt,
      // UTC, and says so: without the Z the brief's pricesFetched read as New York time.
      fetchedAt: new Date(weekCharts.fetchedAt).toISOString().slice(0, 16) + 'Z' });
    if (f) {
      weekFactsData = f;
      // Not a figure to paint at the next boot (Drop 2 round 2): one made
      // while the boot refresh is still stamping prices (the pension's NAV
      // lands after the week's closes on a weekly open — CPO), or from a fetch
      // that lost a chart his money needs (CIO). refreshAllPrices re-renders
      // when it ends; a missing chart is retried after WEEK_RETRY_MS.
      if (!refreshing && !weekCharts.missing?.length) saveWeekCache(f);
    }
    // With the targets as they are now: a target edit re-renders, and the
    // brief's vsPolicyBenchmark only reads a series built from current weights.
    weekWarmPolicy(weekCharts.charts, policyRangeFor(LEDGER_EPOCH));
  }
  const facts = weekFactsData;
  const plan = weekPlan(getSleeveTotals(), getSleeveTargetPcts(), total(),
    +targets.bandAbsPp || 5, +targets.bandRelPct || 25);
  const w = facts?.windows?.[weekWin] || facts?.windows?.week;
  if (weekChartInst) { weekChartInst.destroy(); weekChartInst = null; }
  // Facts that do not reach the last complete week, with nothing newer on the
  // way: the cache, or this session's charts after a later refresh failed.
  // Never "This week" (CIO, Drop 2 round 2: a Sep 26 cache read "THIS WEEK"
  // on Oct 4 while the feed was down, and Ask answered from it).
  const stale = !!facts && !weekIsCurrent(facts) && (!weekCharts || !!weekFailedAt);

  // "This week · to Fri Oct 2"; "Last week · to Fri Oct 2" once a session has
  // closed after that Friday; "This month · Sep 2 → Oct 2"; "Since Aug 1 · to
  // Fri Oct 2". Stale: "Week to Fri Sep 25", "Month · Aug 25 → Sep 25".
  const kicker = !w ? '' : w.key === 'week' ? (stale ? '' : w.label.replace(/^Week /, ''))
    : w.key === 'month' ? w.label : `to ${weekDow(w.to)} ${weekShort(w.to)}`;
  // Last week once a session has closed after its Friday — or once it is
  // Monday by the calendar: before Monday's close the live bar is dropped,
  // so asOf is still the Friday (CIO, round 2).
  const friOf = d => weekAddDays(d, (5 - weekDayOf(d) + 7) % 7);
  const lastWeek = w?.key === 'week' && (facts?.asOf > w.to || nyToday() >= weekAddDays(friOf(w.to), 3));
  const title = stale
    ? { week: w ? `Week to ${weekDow(w.to)} ${weekShort(w.to)}` : 'Week', month: 'Month',
        epoch: 'Since ' + weekShort(LEDGER_EPOCH) }[w?.key || 'week']
    : { week: lastWeek ? 'Last week' : 'This week', month: 'This month',
        epoch: 'Since ' + weekShort(LEDGER_EPOCH) }[w?.key || 'week'];
  const head1 = w && weekHeadline(w);
  let summary;
  if (head1 && stale) {
    // Stale with no failure and a fetch allowed means no charts yet this
    // session, so maybeRefreshWeek has one in flight: every weekly first open
    // after Friday's close read "Not refreshed yet", as if he had to act,
    // while the card was refreshing itself (CPO, Drop 2 round 3).
    const why = weekFailedAt ? "Couldn't refresh" : !weekCanFetch() ? 'Sign in with ☁ to refresh' : 'Updating…';
    summary = `<span class="week-l1">${head1}</span><span class="week-l2">${esc(`${why} · closes to ${weekShort(facts.asOf)}`)}</span>`;
  } else if (head1) {
    summary = `<span class="week-l1">${head1}</span><span class="week-l2">${esc(weekSecondLine(w, plan))}</span>`;
  } else if (!facts && !weekCanFetch()) {
    summary = `<span class="week-l2">Sign in with ☁ to load the week's closes.</span>`;
  } else if (weekFailedAt && !facts) {
    summary = `<span class="week-l2">Market closes are unavailable right now — trying again shortly.</span>`;
  } else {
    summary = `<span class="week-l2">${w && w.key === 'epoch' ? 'Not enough history since ' + esc(weekShort(LEDGER_EPOCH)) + ' yet.' : 'Loading the week’s closes…'}</span>`;
  }
  const head = `<button type="button" class="week-head" aria-expanded="${weekOpen}" aria-controls="weekBody"
      onclick="weekToggle()" ${w ? '' : 'disabled'}>
      <span class="week-kick"><span class="week-title">${esc(title)}</span>
        <span class="week-when">${esc(kicker)}</span><span class="week-chev" aria-hidden="true"></span></span>
      ${summary}
    </button>`;
  if (!weekOpen || !w) { card.innerHTML = head; card.classList.remove('week-open'); return; }

  card.classList.add('week-open');
  const tabs = `<div class="week-tabs" role="group" aria-label="Window">${[
    ['week', 'Week'], ['month', 'Month'], ['epoch', 'Since ' + weekShort(LEDGER_EPOCH)]]
    .map(([k, label]) => `<button type="button" class="week-tab${w.key === k ? ' week-tab-on' : ''}"
      aria-pressed="${w.key === k}" onclick="weekSetWindow('${k}')" ${facts.windows[k] ? '' : 'disabled'}>${label}</button>`).join('')}</div>`;
  const span = `${weekShort(w.from)} → ${weekShort(w.to)}`;
  let body = `<div class="week-sec">Markets · ${esc(span)}</div>${weekStripHtml(w.strip)}`;
  if (w.key === 'epoch') {
    const p = w.perf;
    body += `<div class="week-sec">Your return</div>` + (p ? `<div class="week-lines">
        <div class="week-row"><span class="week-name">You<span class="week-note-line">net of money added</span></span><span class="week-num">${weekPct(p.pct)}</span></div>
        ${w.mixPct != null ? `<div class="week-row"><span class="week-name">Your target mix<span class="week-note-line">the same mix in index funds, dividends included</span></span><span class="week-num">${weekPct(w.mixPct)}</span></div>` : ''}
        ${p.spPct != null ? `<div class="week-row"><span class="week-name">S&amp;P 500<span class="week-note-line">price</span></span><span class="week-num">${weekPct(p.spPct)}</span></div>` : ''}
      </div>${p.excluded.length ? `<p class="week-foot">${esc(new Intl.ListFormat('en-US').format(p.excluded.map(weekShort)))}
        ${p.excluded.length > 1 ? 'are' : 'is'} left out: the record there can't separate money added from the market's move.</p>` : ''}`
      : `<p class="week-foot">Not enough history since ${esc(weekShort(LEDGER_EPOCH))} yet.</p>`);
  } else {
    body += `<div class="week-sec">What moved your money</div>${weekLinesHtml(w)}${weekCaveatsHtml(w)}`;
    // Midweek, one secondary row: never a tab, the headline or the collapsed line.
    const sf = w.key === 'week' ? facts.windows.sinceFri : null;
    if (sf) {
      const spF = sf.spPct != null ? ` · S&P ${weekPct(sf.spPct)}` : '';
      const outF = weekLeadOut(sf);
      // Its own heading and a rule: under "What moved" it read as a fifth
      // line of last week (CPO, round 2).
      body += `<div class="week-lines week-since"><div class="week-sec">So far · ${esc(sf.label.replace(/^Since/, 'since'))}</div><div class="week-row">
          <span class="week-name">You<span class="week-note-line">${esc(sf.sessions)} sessions${esc(spF)}${outF ? ` · ${esc(outF)}` : ''}</span></span>
          <span class="week-num">${weekUsd(sf.you.gain)}${sf.you.pct != null ? ` (${weekPct(sf.you.pct)})` : ''}</span>
        </div></div>${weekCaveatsHtml(sf)}`;
    }
  }
  // The chart sits with the figures it draws, above the plan — under "Your
  // plan" the plan sentence read as the chart's caption (CPO, round 1).
  const ch = w.key === 'epoch' ? w.perf?.chart : w.chart;
  const youEnd = w.key === 'epoch' ? w.perf?.pct : w.you.pct;
  const spEnd = ch ? ch.sp[ch.sp.length - 1] : null;
  if (ch && ch.dates.length >= 2) {
    body += `<div class="week-legend">
        ${youEnd != null && ch.you ? `<span class="week-key"><i class="week-swatch week-swatch-you"></i>You <strong>${weekPct(youEnd)}</strong></span>` : ''}
        ${spEnd != null ? `<span class="week-key"><i class="week-swatch week-swatch-sp"></i>S&amp;P <strong>${weekPct(spEnd)}</strong></span>` : ''}
      </div><div class="week-chart"><canvas id="weekChart" aria-label="${ch.you ? 'You and the S&amp;P 500' : 'The S&amp;P 500'} over the window" role="img"></canvas></div>`;
  }
  body += plan ? `<div class="week-sec">Your plan</div><p class="week-plan">${esc(plan.line)}</p>` : '';
  weekChips = weekChipsFor(w.key === 'week' && lastWeek ? { ...w, words: 'last week' } : w, plan);
  body += `<div class="week-chips"><span class="week-sub">Ask about this</span>${weekChips.map((c, i) =>
    `<button type="button" class="ask-chip" onclick="weekAsk(${i})">${esc(c)}</button>`).join('')}</div>`;
  // One line at 375 (it was three). The pension's own dates are on its line
  // ("priced Sep 23 → Oct 3"); the footnote's "priced on its own NAV dates"
  // also claimed more than the app knows — those are the dates it fetched
  // the NAV.
  body += `<p class="week-foot">Yahoo Finance closes to ${esc(weekShort(facts.asOf))} · facts, no forecasts.</p>`;
  card.innerHTML = head + `<div id="weekBody" class="week-body">${tabs}${body}</div>`;
  if (ch && ch.dates.length >= 2) drawWeekChart(ch);
}

// Two lines, no point markers, at most four dates, a zero line, 12px type.
// Colours validated for colour-blind separation on both card surfaces
// (dataviz validator: teal/violet ΔE 22.4 light, 13.8 dark).
function drawWeekChart(ch) {
  const canvas = document.getElementById('weekChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const dark = isDark();
  const tick = dark ? '#8b95a8' : '#52525b';
  const n = ch.dates.length;
  // A week's six closes get first, middle and last ("Sep 25 · Sep 29 · Oct 2");
  // a longer window four evenly spaced dates. Never more than four.
  const pick = n <= 3 ? ch.dates.map((_, i) => i)
    : n <= 7 ? [0, Math.round((n - 1) / 2), n - 1]
    : [...new Set([0, Math.round((n - 1) / 3), Math.round(2 * (n - 1) / 3), n - 1])];
  const step = ticks => (ticks.length > 1 ? Math.abs(ticks[1].value - ticks[0].value) : 1);
  const digits = s => [0, 1, 2].find(d => Math.abs(s * 10 ** d - Math.round(s * 10 ** d)) < 1e-6) ?? 2;
  weekChartInst = new Chart(canvas, {
    type: 'line',
    data: { labels: ch.dates, datasets: [
      // Monotone: smooth without inventing a peak or trough between closes.
      // No "You" line across a flagged period: there is no return to draw.
      ...(ch.you ? [{ label: 'You', data: ch.you, borderColor: '#0d9488', borderWidth: 2.5, pointRadius: 0,
        pointHoverRadius: 4, pointHitRadius: 12, cubicInterpolationMode: 'monotone', fill: false, spanGaps: true }] : []),
      { label: 'S&P 500', data: ch.sp, borderColor: dark ? '#9085e9' : '#4a3aa7', borderWidth: 2, pointRadius: 0,
        pointHoverRadius: 4, pointHitRadius: 12, cubicInterpolationMode: 'monotone', fill: false, spanGaps: true },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { displayColors: true, callbacks: {
        title: items => weekShort(ch.dates[items[0].dataIndex]),
        label: c => `${c.dataset.label} ${c.parsed.y == null ? '—' : weekPct(c.parsed.y)}` } } },
      scales: {
        x: { grid: { display: false }, border: { color: themeGridColor() },
          afterBuildTicks: axis => { axis.ticks = pick.map(i => ({ value: i })); },
          ticks: { autoSkip: false, maxRotation: 0, minRotation: 0, align: 'inner', font: { size: 12 }, color: tick,
            callback: v => weekShort(ch.dates[v]) } },
        y: { border: { display: false },
          grid: { color: c => (c.tick && Math.abs(c.tick.value) < 1e-9 ? (dark ? '#3a4256' : '#c9c6bf') : themeGridColor()) },
          ticks: { maxTicksLimit: 5, font: { size: 12 }, color: tick,
            callback: (v, i, ticks) => signed(v, digits(step(ticks)), '%') } },
      },
    },
  });
}

// ─── Advisor: asset location ─────────────────────────────────────────────────
// WHERE a sleeve is held changes what it costs to hold, without changing the
// allocation by a cent. Bond interest is ordinary income taxed every single
// year; a broad equity fund throws mostly qualified dividends at the lower
// rate and defers the rest into unrealised gain. So the highest-yielding,
// worst-taxed asset wants the sheltered account — and the swap that puts it
// there is allocation-neutral by construction, because the displaced asset
// takes its place in taxable.
//
// This is arithmetic on rates the user enters, not a recommendation. It says
// what a swap would cost or save; it does not say to make one.
// Three categories, not two. The Swedish pension is deliberately NOT counted
// as shelter here: its income is not taxed under US ordinary/qualified rates
// at all, so pricing it with them is meaningless, and it is not an account
// David trades in — a "swap" proposed inside it is advice he cannot act on.
// It is reported as out of scope rather than silently dropped.
//
// This is a different question from the one TAX_ADVANTAGED_RE answers in
// rebalancePlan. There the test is "would selling here realise a US capital
// gain", and the pension genuinely does shelter that. Here the test is
// "is this holding's income taxable to David under the US rates below",
// and it is not. Same accounts, opposite answers — keep the two separate.
const US_SHELTERED_RE = /roth|401|403|\bira\b/i;
const FOREIGN_PENSION_RE = /pension|swedish|avanza|länsförsäkringar|lansforsakringar/i;

function taxLocationOf(h) {
  const acct = h.account || '';
  if (FOREIGN_PENSION_RE.test(acct)) return 'foreign';
  if (US_SHELTERED_RE.test(acct)) return 'sheltered';
  return 'taxable';
}
const isShelteredAccount = h => taxLocationOf(h) === 'sheltered';

// Defaults live here and NOWHERE else. They were briefly duplicated — the rate
// inputs rendered `?? 24` while this function computed `|| 0` — so the card
// displayed a 24% marginal rate while doing the maths at zero, and then
// reported a confident green "nothing to gain by relocating" that was purely
// an artefact of the missing rates. Any new reader of these numbers must come
// through here.
const DEFAULT_TAX_MARGINAL = 24;
const DEFAULT_TAX_LTCG = 15;

// Federal + state/local, and NIIT where it applies. One place, so the two
// rates can never drift apart.
function effectiveRates(t = targets) {
  const local = (+t.taxStateLocal || 0) / 100;
  const niit  = t.taxNiit ? 0.038 : 0;
  const marg  = t.taxMarginal == null ? DEFAULT_TAX_MARGINAL : +t.taxMarginal || 0;
  const ltcg  = t.taxLtcg     == null ? DEFAULT_TAX_LTCG     : +t.taxLtcg     || 0;
  return { ordinary: marg / 100 + local + niit, qualified: ltcg / 100 + local + niit };
}

// Trailing-12-month yield from the dividend cache. Null when unknown — the
// accumulating funds (401K CITs, the Avanza pension) never distribute, so
// they have no cache and must never be assigned a fabricated yield.
function holdingYield(h) {
  const ps = h.dividends?.t12mPerShare;
  return ps > 0 && h.price > 0 ? ps / h.price : null;
}

// An accumulating fund still WOULD throw income if it were held in a taxable
// account — it just doesn't today. Estimate that from a real distributing
// holding in the same sleeve, and mark it estimated so the UI can say so.
function yieldForLocation(h, holdingsArr) {
  const own = holdingYield(h);
  if (own != null) return { yield: own, estimated: false };
  const sleeve = getSleeve(h);
  const peers = holdingsArr
    .filter(x => x !== h && getSleeve(x) === sleeve)
    .map(holdingYield)
    .filter(y => y != null);
  if (!peers.length) return null;
  return { yield: peers.reduce((s, y) => s + y, 0) / peers.length, estimated: true };
}

// Bond interest is ordinary income; equity distributions are mostly qualified.
const usesOrdinaryRate = h => getSleeve(h) === 'bond';

// Annual tax cost per dollar held in a TAXABLE account.
function dragRateFor(h, holdingsArr, rates) {
  const y = yieldForLocation(h, holdingsArr);
  if (!y) return null;
  return {
    rate: y.yield * (usesOrdinaryRate(h) ? rates.ordinary : rates.qualified),
    yield: y.yield, estimated: y.estimated,
    kind: usesOrdinaryRate(h) ? 'ordinary' : 'qualified',
  };
}

// The single best location swap: move the highest-drag taxable holding into
// shelter, displacing the lowest-drag sheltered holding out into taxable.
// Allocation is untouched — only the addresses change. Returns null when
// nothing would improve (already optimal, or nothing comparable to swap).
function assetLocationSwap(holdingsArr = holdings, t = targets) {
  const rates = effectiveRates(t);
  const rows = holdingsArr
    .map(h => {
      const v = h.quantity * h.price;
      const loc = taxLocationOf(h);
      const d = v > 0 ? dragRateFor(h, holdingsArr, rates) : null;
      return d ? { h, value: v, loc, sheltered: loc === 'sheltered', ...d } : null;
    })
    .filter(Boolean);

  // Foreign-pension holdings are listed but never traded against — see
  // taxLocationOf. Only US taxable and US sheltered take part in a swap.
  const taxable   = rows.filter(r => r.loc === 'taxable').sort((a, b) => b.rate - a.rate);
  const sheltered = rows.filter(r => r.loc === 'sheltered').sort((a, b) => a.rate - b.rate);
  if (!taxable.length || !sheltered.length) return { rows, swap: null, rates };

  const into = taxable[0];      // worst asset to hold in taxable
  const out  = sheltered[0];    // cheapest asset to expose to taxable
  const gain = into.rate - out.rate;
  // Same sleeve on both sides is a no-op, and a non-positive gain means the
  // portfolio is already located as well as these rates can make it.
  if (!(gain > 0) || getSleeve(into.h) === getSleeve(out.h)) return { rows, swap: null, rates };

  const amount = Math.min(into.value, out.value);
  return {
    rows, rates,
    swap: {
      into, out, amount,
      annualSaving: gain * amount,
      currentCost: into.rate * amount,
      estimated: into.estimated || out.estimated,
    },
  };
}

// ─── Advisor: context rendering ──────────────────────────────────────────────
// A move that rounds away to nothing is flat, not a tiny loss. Signing it
// ("−0.0pp", "−0bp") reads as a real move in the wrong direction and colours
// the row red for what is actually no change at all.
const signed = (n, digits, unit) => {
  const shown = Math.abs(n).toFixed(digits);
  if (+shown === 0) return `${shown}${unit}`;
  return `${n > 0 ? '+' : '−'}${shown}${unit}`;
};
const fmtSignedPct = (n, d = 2) => signed(n, d, '%');
const fmtSignedBp   = n => signed(Math.round(n * 100), 0, 'bp');
const fmtSignedPp   = n => signed(n, 1, 'pp');
// Same flat-is-flat rule for dollars: under half a dollar reads as no gap.
const fmtSigned$    = n =>
  Math.abs(n) < 0.5 ? fmt$(0) : `${n > 0 ? '+' : '−'}${fmt$(Math.abs(n))}`;
// Colour follows what is displayed, not the raw float — a value that renders
// as flat must not render red.
const moveClass = (n, digits = 2) =>
  +Math.abs(n).toFixed(digits) === 0 ? '' : n > 0 ? 'mkt-up' : 'mkt-down';

function renderDriftSection() {
  const tot = total();
  const bandAbs = +targets.bandAbsPp || 5;
  const bandRel = +targets.bandRelPct || 25;
  const d = driftCheck(getSleeveTotals(), getSleeveTargetPcts(), tot, bandAbs, bandRel);
  if (!d.rows.length) return '';

  const monthlyIn = monthlyContribution();
  // Whole dollars, as everywhere else on the phone page (CPO, round 1).
  const usd0 = n => (Math.abs(n) < 0.5 ? '$0' : `${n > 0 ? '+' : '−'}${fmt$0(Math.abs(n))}`);
  let head;
  if (d.anyOutOfBand) {
    // Breaches come in both directions at once, so a single "worst sleeve"
    // verdict is the wrong shape: it can report an overweight while the thing
    // new money actually fixes is an underweight somewhere else. Answer for
    // the portfolio — total shortfall buying can close, and separately whether
    // an overweight exists that buying can never touch.
    const under = d.breaches.filter(r => r.driftDollars < 0);
    const over  = d.breaches.filter(r => r.driftDollars > 0);
    const shortfall = under.reduce((s, r) => s - r.driftDollars, 0);
    const months = monthsToCloseGap(shortfall, monthlyIn);

    const parts = [];
    if (shortfall > 0) {
      const names = under.map(r => r.label).join(' and ');
      // Whole dollars here too: the head still printed the shortfall and the
      // monthly rate to the cent, over rows in whole dollars (CPO, round 2).
      parts.push(months === null
        ? `${fmt$0(shortfall)} short in ${names} — no standing contributions to close it with.`
        : months <= 24
          ? `${fmt$0(shortfall)} short in ${names} — about ${Math.ceil(months)} months of contributions at ${fmt$0(monthlyIn)}/mo.`
          : `${fmt$0(shortfall)} short in ${names} — roughly ${(months / 12).toFixed(1)} years at ${fmt$0(monthlyIn)}/mo, so buying alone will not close it.`);
    }
    if (over.length) {
      parts.push(`${over.map(r => r.label).join(' and ')} ${over.length === 1 ? 'is' : 'are'} over target — new money cannot bring ${over.length === 1 ? 'it' : 'them'} down, only selling or the rest growing into ${over.length === 1 ? 'it' : 'them'}.`);
    }
    head = `<p class="drift-head drift-breach">⚠ ${d.breaches.length}
      ${d.breaches.length === 1 ? 'sleeve is' : 'sleeves are'} outside your bands.
      ${esc(parts.join(' '))}</p>`;
  } else {
    head = `<p class="drift-head drift-ok">✓ Every sleeve is inside your bands${d.worst
      ? ` — largest drift ${Math.abs(d.worst.driftPp).toFixed(1)}pp (${esc(d.worst.label)},
          ${usd0(d.worst.driftDollars)})` : ''}.</p>`;
  }

  // Drift inside the band is neutral: red and green on a −0.2pp drift read as
  // a verdict while the head says every sleeve is inside (trim.md item 22;
  // CPO, Drop 2 round 1). Colour marks a breach only. Whole dollars, and the
  // amount never breaks: at 375 a breach's sub-line wrapped to "−" / the
  // amount in cents / "· both band".
  const leg = { both: 'both bands', absolute: 'absolute band', relative: 'relative band' };
  const rows = d.rows.map(r => `<div class="drift-row ${r.outOfBand ? 'drift-row-breach' : ''}">
    <span>${esc(r.label)}</span>
    <span class="num">${r.curPct.toFixed(1)}%<span class="drift-sub">now</span></span>
    <span class="num">${r.tgtPct.toFixed(1)}%<span class="drift-sub">target</span></span>
    <span class="num ${r.outOfBand ? moveClass(r.driftPp, 1) : ''}">${fmtSignedPp(r.driftPp)}
      <span class="drift-sub"><span class="drift-amt">${usd0(r.driftDollars)}</span>${
        r.reason ? ` · ${leg[r.reason]}` : ''}</span></span>
  </div>`).join('');

  // The bands are stated here and set in one place, Plan & settings → Targets
  // & bands (trim.md item 22: "the band inputs move to the drawer"). Drop 2
  // integration, 2026-10-04: the layout package built the drawer's labelled
  // 44px fields while this sentence kept its own two 22px boxes, so one figure
  // had two editors on the same page.
  return head + `<div class="drift-rows">${rows}</div>
    <p class="risk-note" id="driftBands">Act when a sleeve is off by ${esc(bandAbs)}pp or ${esc(bandRel)}% of its own
      target weight. Your policy, your numbers — this only reports against it.
      <button type="button" class="ask-link inline-link" onclick="openPlanSection('planTargets')">Change your bands</button></p>`;
}

// Plan & settings opened at one section, scrolled to it — the one tap from a
// figure on the page to the field that sets it.
function openPlanSection(id) {
  const plan = document.getElementById('planCard'), sec = document.getElementById(id);
  if (!plan || !sec) return;
  plan.open = true;
  sec.open = true;
  renderPlan();
  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// His tax rates: the inputs effectiveRates reads, and through it the asset-
// location rows Ask carries in every brief. They used to sit at the foot of the
// Advisor's "Where your assets sit" panel. That panel left the card 2026-10-03
// (David: "the rest is better in the ask feature" — Ask already runs
// assetLocationSwap on every question), but it was the ONLY place the rates
// could be set, so the inputs moved with the rest of his policy instead of
// leaving with the panel — since Drop 2 into Plan & settings, as labelled
// 44px rows rather than 22px boxes inside a sentence. Same ids, same defaults.
//
// Built once, then synced in place: render() runs once per fetched price
// during a refresh, and the old full rebuild wiped a rate he was half-way
// through typing (Drop 1 carry-over).
function setTaxRate(key, value) {
  targets[key] = key === 'taxNiit' ? !!value : +value;
  markUnsaved();
  renderTaxRates();
  renderPlan();
}

function renderTaxRates() {
  const el = document.getElementById('taxRates');
  if (!el) return;
  const vals = {
    taxMarg:  targets.taxMarginal ?? DEFAULT_TAX_MARGINAL,
    taxLt:    targets.taxLtcg ?? DEFAULT_TAX_LTCG,
    taxLocal: targets.taxStateLocal ?? 0,
  };
  if (!document.getElementById('taxMarg')) {
    // Values are esc()'d: targets come from a restored backup or the cloud doc
    // as well as these inputs (Drop 1 security review).
    const row = (id, label, key, max, step) => `<div class="target-row">
        <label for="${id}">${label}</label>
        <input id="${id}" type="number" min="0" max="${max}" step="${step}" value="${esc(vals[id])}"
          onchange="setTaxRate('${key}', this.value)"><span class="pct-label">%</span></div>`;
    el.innerHTML = `<p class="plan-note">Ask prices tax drag and asset location at these rates.</p>
      <div class="target-inputs">
        ${row('taxMarg', 'Marginal income tax', 'taxMarginal', 60, 1)}
        ${row('taxLt', 'Long-term capital gains', 'taxLtcg', 40, 1)}
        ${row('taxLocal', 'State + local', 'taxStateLocal', 20, 0.5)}
        <label class="plan-check"><input type="checkbox" id="taxNiit" ${targets.taxNiit ? 'checked' : ''}
          onchange="setTaxRate('taxNiit', this.checked)"> Net investment income tax (3.8%)</label>
      </div>
      <p class="plan-note" id="taxLocalHint"></p>`;
  } else {
    for (const [id, v] of Object.entries(vals)) {
      const inp = document.getElementById(id);
      // A value with markup in it lands in .value, which is inert.
      if (inp && document.activeElement !== inp) inp.value = v;
    }
    const niit = document.getElementById('taxNiit');
    if (niit) niit.checked = !!targets.taxNiit;
  }
  const hint = document.getElementById('taxLocalHint');
  if (hint) hint.innerHTML = !(+targets.taxStateLocal > 0)
    ? '<span class="loc-hint">State + local is 0, so these are federal-only figures.</span>' : '';
}

// Nothing in this card volunteers a verdict nobody asked for. Volunteering
// "relocate this bond lot and save this much a year" to someone who opened the
// app to check a balance was exactly that; the location panel that did it left
// the card on 2026-10-03 and the question now lives in Ask. Market and What
// moved your money left on 2026-10-04 for the This week card, so Where you
// stand is the whole card now — David: "the where you stand is fine, the rest
// is better in the ask feature". Its Show/Hide stays, open by default, since
// it only reports against his own bands.
let advShow = { drift: true };
function advToggle(key) { advShow[key] = !advShow[key]; renderAdvisorContext(); }

// ─── Ask ─────────────────────────────────────────────────────────────────────
// A general conversation about his own portfolio, in its own card. The cards
// stopped volunteering conclusions; this is where they moved to. The brief is
// built by the SAME engines that render the page, so an answer can never
// disagree with what is on screen — and it is built at submit time only, so
// the card shows nothing derived from his data until he asks.
//
// Cloud only: the question goes to a JWT-gated edge function. Signed out, the
// card says so inline rather than pushing an error into the thread.
const ASK_THREAD_KEY = 'portfolio_ask_thread_v1';
const ASK_KEEP_TURNS = 30, ASK_HISTORY_TURNS = 10, ASK_OPEN_TURNS = 2;
// Which shell asked, for the function's log line (`v=`), so "is the phone on
// the new shell?" and "is anyone using Ask?" are log queries, not guesses.
// Must equal sw.js VERSION — tests/ask.spec.js fails the build when they drift.
const ASK_SHELL_VERSION = 'v1.12.0';
let askBusy = false;
let askAbort = null;               // the in-flight question's AbortController
let askShowEarlier = false;
let askThread = loadAskThread();   // [{ q, a | error, ts }] (+ pending while in flight)
// Turns restored from an earlier visit start folded away: the page opens quiet,
// not with last week's answers sitting above the holdings.
let askRestored = askThread.length;

// Dollar amounts named in a question ("where would my next $5,000 go?"), so
// the question can carry the engine's own result for exactly that sum instead
// of leaving the model to redo the maths. A number counts only when something
// marks it as money — a $, a k/m suffix, the word "dollars" — or it is a bare
// figure of 1,000+ that is not a year. "401k", "S&P 500", "5/25", "30%" and
// "2026" are all deliberately not amounts, and neither is a sum in another
// currency: "50,000 kr" is not fifty thousand dollars.
//
// Then each sum is sorted by what it is FOR, from the nearest cue in its own
// sentence (2026-10-03 audit): until ask-4 every dollar figure became a
// new-money buy plan, so "if I spend $100k" got a 100k deposit plan and
// the FIRE run he meant was never computed; so did a statement balance and
// "log a 6500 contribution".
//   newMoney — "next 10k", invest, put, add, bonus, deposit, split, allocate,
//              deploy, "buy with", and "where would 15k go" → a buy-only plan
//   spend    — spend, retire on, live on; failing those, "a year" or "annual"
//              → a FIRE run at that spend
//   neither  — anything else, and "7k of it" (part of a sum already named).
//              "I spent $5k on VOO" is a purchase, and "withdraw $5k" a
//              one-off, so neither is a spend cue unless "a year" says so.
const ASK_MAX_AMOUNTS = 3;
const ASK_CUE_REACH = 40;   // characters either side; a cue further off is about something else
// The verb, not the noun: "allocation" is how he asks about his mix ("my
// allocation at $400k"), so only allocate/allocating cue new money.
const ASK_NEW_MONEY_CUE = /\b(?:next|invest\w*|put(?:ting)?|add(?:s|ed|ing)?|bonus\w*|deposit\w*|windfall|lump[- ]sum|new money|split|allocat(?:e|es|ed|ing)|deploy\w*|buy with)\b/gi;
const ASK_SPEND_CUE = /\b(?:spend|spends|spending|retire on|live on|living on)\b/gi;
const ASK_SPEND_WEAK = /\b(?:a year|per year|a yr|yearly|annual\w*)\b|\/\s*(?:yr|year)\b/i;
function askAmountKind(s, start, end) {
  // The amount's own sentence only: a cue in the one before is about something else.
  const before = s.slice(Math.max(0, start - ASK_CUE_REACH), start).split(/[?!;\n]|\.(?=\s|$)/).pop();
  const after = s.slice(end, end + ASK_CUE_REACH).split(/[?!;\n]|\.(?=\s|$)/)[0];
  if (/^\s*of (?:it|that|this|them)\b/i.test(after)) return null;
  let best = null;
  for (const [kind, re] of [['newMoney', ASK_NEW_MONEY_CUE], ['spend', ASK_SPEND_CUE]]) {
    for (const c of before.matchAll(re)) {
      const d = before.length - (c.index + c[0].length);
      if (!best || d < best.d) best = { kind, d };
    }
    for (const c of after.matchAll(re)) {
      if (!best || c.index < best.d) best = { kind, d: c.index };
    }
  }
  if (best) return best.kind;
  // "Where would $15k go?" names no verb: the sum itself is what goes. Without
  // this the commonest phrasing got no plan once the card's Get Recommendation
  // left for Ask (Drop 1 review, 2026-10-03). Not the past tense: "where did
  // that 5k go?" asks about money already gone and got a buy plan (round 2).
  if (/\bwhere\b/i.test(before) && !/\bwhere\b.*\bdid(?:n't)?\b/i.test(before) &&
      /^\s*go(?:es)?\b/i.test(after)) return 'newMoney';
  return ASK_SPEND_WEAK.test(before) || ASK_SPEND_WEAK.test(after) ? 'spend' : null;
}
function askAmounts(text) {
  const s = String(text || '');
  const re = /(\$\s*)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:(k|mm|m)\b|\s*(thousand|million|grand)\b)?(\s*(?:dollars|usd|bucks)\b)?/gi;
  const mult = { k: 1e3, m: 1e6, mm: 1e6, thousand: 1e3, million: 1e6, grand: 1e3 };
  const out = { newMoney: [], spend: [] };
  let m;
  while ((m = re.exec(s))) {
    const [whole, dollar, intPart, frac, suffix, word, unit] = m;
    // Part of a word, a decimal, a date or a fraction ("VGIT2", "1.5", "9/20").
    if (!dollar && /[\w.,\/\-]/.test(s[m.index - 1] || '')) continue;
    const after = s.slice(m.index + whole.length);
    if (/^\s*(%|percent|pp\b|bps?\b)/i.test(after)) continue;
    if (/^\s*(sek|kr|kronor|eur|euros?|gbp|pounds?)\b/i.test(after) || /([€£]|\b(sek|kr|eur|gbp))\s*$/i.test(s.slice(0, m.index))) continue;
    const n = parseFloat(intPart.replace(/,/g, '') + (frac || ''));
    const scale = mult[(suffix || word || '').toLowerCase()] || 1;
    // The account, not four hundred thousand dollars.
    if (!dollar && /^k$/i.test(suffix || '') && [401, 403, 457].includes(n)) continue;
    if (!dollar && !suffix && !word && !unit) {
      if (n < 1000 || /^[\/\-]|^\s*(shares|units|years?|yrs?|months?|days?|weeks?)\b/i.test(after)) continue;
      if (!intPart.includes(',') && !frac && n >= 1900 && n <= 2100) continue;
    }
    const v = +(n * scale).toFixed(2);
    if (!(v >= 1 && v <= 1e9)) continue;
    const kind = askAmountKind(s, m.index, m.index + whole.length);
    if (kind && out[kind].length < ASK_MAX_AMOUNTS && !out[kind].includes(v)) out[kind].push(v);
  }
  return out;
}

// The portfolio brief: everything the app knows, computed by the SAME engines
// that render the cards, so an answer can never disagree with the screen. It
// is a projection layer — no maths of its own beyond shares-of-a-total.
//
// Three properties are load-bearing. It has no side effects (no DOM, no
// network, no markUnsaved). It carries no ids and no employer identity — the
// employer appears only as an aggregate. And identical data serialises to an
// identical string: dates not instants, fixed key order — because the server
// caches the brief between turns and a stray millisecond would miss every time.
// For the same reason it no longer depends on the question (ask-4, 2026-10-03):
// what a question's amounts need is askExtra()'s, sent beside it.
const ASK_LEDGER_ROWS = 60, ASK_SERIES_POINTS = 60, ASK_FX_STAMPS = 30, ASK_LOOKTHROUGH_ROWS = 10;

// The rebalance engine's plan for one sum, as the brief and askExtra carry it:
// plain fields only, no holding objects.
function askPlan(amount, allowSells) {
  const r2 = n => n == null || !isFinite(n) ? null : +(+n).toFixed(2);
  const p = rebalancePlan(holdings, targets, amount, { allowSells });
  return p ? { amount: r2(amount), totalBefore: p.totalBefore, totalAfter: p.totalAfter,
    rows: p.rows.map(r => ({ sleeve: r.sleeve, label: r.label, action: r.action, amount: r.amount,
      suggestion: r.suggestion, note: r.note })), warnings: p.warnings } : null;
}

// One FIRE run with the card's own defaults — the rounded μ/σ its inputs show,
// the rules' monthly total, seed 42 — at a given annual spend. The brief runs it
// at the saved spend; askExtra at any spend the question names, so "what if I
// spend 150k?" gets the simulated years instead of a hand-off to the card.
function askFireInputs() {
  const ba = blendedAssumptions(holdings);
  return { start: total(), monthlyContrib: monthlyContribFromRules(),
    muPct: +(ba.mu * 100).toFixed(1), sigmaPct: +(ba.sigma * 100).toFixed(1) };
}
function askFireRun(spend, fi = askFireInputs()) {
  const sim = simulateFire({ start: fi.start, monthlyContrib: fi.monthlyContrib, annualSpend: spend,
    muAnnual: fi.muPct / 100, sigmaAnnual: fi.sigmaPct / 100, seed: 42 });
  return sim ? { fiTarget: sim.fiTarget, alreadyFI: sim.alreadyFI, medianYears: sim.medianYears,
    p10Years: sim.p10Years, p90Years: sim.p90Years, neverWithin50YearsPct: sim.neverPct,
    successByYears: sim.successByYears } : null;
}

// Results for THIS question only, computed by the same engines and sent after
// the server's cache breakpoint: a buy-only plan per sum named as new money,
// a FIRE run per annual spend named. Empty when the question names neither.
function askExtra(question) {
  const { newMoney, spend } = askAmounts(question);
  const out = {};
  const plans = newMoney.map(a => askPlan(a, false)).filter(Boolean);
  if (plans.length) out.newMoney = plans;
  if (spend.length) {
    const fi = askFireInputs();
    const runs = spend.map(s => {
      const run = askFireRun(s, fi);
      return run && { annualSpend: s, monthlyContrib: fi.monthlyContrib, muRealPct: fi.muPct,
        sigmaPct: fi.sigmaPct, swrPct: 4, ...run };
    }).filter(Boolean);
    if (runs.length) out.fire = runs;
  }
  return out;
}

function askContext() {
  const r2 = n => n == null || !isFinite(n) ? null : +(+n).toFixed(2);
  const r1 = n => n == null || !isFinite(n) ? null : +(+n).toFixed(1);
  const day = iso => iso ? String(iso).slice(0, 10) : null;
  const now = Date.now();
  // Same whole-day age the attention strip and the table badge use.
  const ageDays = iso => iso ? Math.floor((now - new Date(iso)) / 86400000) : null;
  const val = h => (+h.quantity || 0) * (+h.price || 0);
  const acctOf = h => h.account || 'Unassigned';
  const pctOf = (v, whole) => whole > 0 ? r1(v / whole * 100) : 0;

  const tot = total();
  const held = holdings.filter(h => val(h) > 0);
  const sleeveVals = getSleeveTotals();
  const tgtPcts = getSleeveTargetPcts();
  const acctTotals = getAccountTotals();
  const bandAbs = +targets.bandAbsPp || 5, bandRel = +targets.bandRelPct || 25;
  const rates = effectiveRates();
  const monthlyIn = monthlyContribution();
  const ruleFor = h => contributionRules.some(r => r.holdingId === h.id);
  const notLoaded = [];

  const priceSource = h => hasRealTicker(h) ? 'ticker'
    : proxyEntryFor(h) ? 'proxy:' + proxyEntryFor(h).proxy
    : matchesAvanza(h) ? 'avanza-sek' : matchesNavTable(h) ? 'nav-table' : 'manual';

  // ── freshness ──
  // The over-cap attention label is the one place an engine embeds the
  // employer's name; it goes out with the name replaced, never verbatim.
  const emp = employerExposure();
  const attention = attentionItems().map(it => it.kind === 'risk' && emp
    ? it.label.split(emp.name).join('Employer') : it.label);
  const ages = held.map(h => ageDays(h.updated)).filter(a => a != null);
  const divDates = held.map(h => day(h.dividends?.updated)).filter(Boolean).sort();
  const snaps = historyData?.snapshots || [];
  const freshness = {
    lastSaved: lastSaved ? String(lastSaved).slice(0, 16) : null,
    mode: IS_SHELL ? 'shell' : 'local',
    priceAgeDays: ages.length ? { min: Math.min(...ages), max: Math.max(...ages) } : null,
    attention,
    proxyCalibrations: held.filter(h => proxyEntryFor(h)).map(h => {
      const age = ageDays(h.calibration?.date);
      return { name: h.name, proxy: proxyEntryFor(h).proxy, index: proxyEntryFor(h).index,
        calibratedOn: day(h.calibration?.date), daysAgo: age,
        overdue: age == null ? null : age > PROXY_RECAL_NUDGE_DAYS };
    }),
    dividendCacheAsOf: divDates[0] || null,
    historyLastSnapshot: snaps.length ? snaps[snaps.length - 1].date : null,
  };

  // ── policy ──
  const benchW = policyWeights(targets);
  const policy = {
    targets: { stocks: targets.stocks, bonds: targets.bonds, other: targets.other,
               us: targets.us, intl: targets.intl, tilts: targets.tilts },
    sleeveTargetPct: Object.fromEntries(Object.keys(SLEEVE_CONFIG).map(k => [k, r2(tgtPcts[k])])),
    bands: { absPp: bandAbs, relPct: bandRel },
    tax: {
      marginalPct: targets.taxMarginal == null ? DEFAULT_TAX_MARGINAL : +targets.taxMarginal || 0,
      ltcgPct: targets.taxLtcg == null ? DEFAULT_TAX_LTCG : +targets.taxLtcg || 0,
      stateLocalPct: +targets.taxStateLocal || 0, niit: !!targets.taxNiit,
      effectiveOrdinaryPct: r1(rates.ordinary * 100), effectiveQualifiedPct: r1(rates.qualified * 100),
    },
    employerCapPct: EMPLOYER_CAP_PCT,
    // The chart's blended benchmark: his own target mix, `other` left out.
    benchmarkWeights: benchW && Object.fromEntries(Object.entries(benchW).map(([k, w]) => [k, +w.toFixed(4)])),
  };

  // ── accounts & holdings ──
  // Two tax questions, two fields — see taxLocationOf vs TAX_ADVANTAGED_RE.
  const accounts = Object.entries(acctTotals).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]).map(([account, v]) => {
      const hs = held.filter(h => acctOf(h) === account);
      const mix = {};
      for (const k of Object.keys(SLEEVE_CONFIG)) {
        const sv = hs.filter(h => getSleeve(h) === k).reduce((s, h) => s + val(h), 0);
        if (sv > 0) mix[k] = r2(sv);
      }
      return { account, value: r2(v), pct: pctOf(v, tot), holdings: hs.length,
        incomeTaxLocation: taxLocationOf({ account }),
        sellRealisesUsGain: !TAX_ADVANTAGED_RE.test(account), sleeveValues: mix };
    });

  const holdingRows = held.map(h => {
    const v = val(h), y = holdingYield(h);
    return {
      name: h.name, ticker: hasRealTicker(h) ? h.ticker.toUpperCase() : null, type: h.type,
      account: acctOf(h), sleeve: getSleeve(h), quantity: h.quantity, price: h.price, value: r2(v),
      pctOfPortfolio: pctOf(v, tot), pctOfAccount: pctOf(v, acctTotals[acctOf(h)]),
      pctOfSleeve: pctOf(v, sleeveVals[getSleeve(h)]),
      priceUpdated: day(h.updated), priceAgeDays: ageDays(h.updated), priceSource: priceSource(h),
      yieldPct: y == null ? null : r2(y * 100),
      annualIncome: dividendIncome([h]).rows[0]?.annualIncome ?? null,
      incomeTaxLocation: taxLocationOf(h), hasContributionRule: ruleFor(h),
    };
  });

  // ── drift ── the card's own headline arithmetic: shortfall across breached
  // underweights, and how many months of standing contributions would close it.
  // Named for what it counts: a sleeve under target but inside its band adds 0.
  const d = driftCheck(sleeveVals, tgtPcts, tot, bandAbs, bandRel);
  const under = (d.breaches || []).filter(r => r.driftDollars < 0);
  const shortfall = under.reduce((s, r) => s - r.driftDollars, 0);
  const drift = {
    anyOutOfBand: d.anyOutOfBand,
    rows: d.rows.map(r => ({ sleeve: r.sleeve, label: r.label, value: r2(sleeveVals[r.sleeve] || 0),
      nowPct: r1(r.curPct), targetPct: r1(r.tgtPct), driftPp: r1(r.driftPp), relPct: r1(r.relPct),
      driftDollars: r2(r.driftDollars), outOfBand: r.outOfBand, reason: r.reason })),
    outOfBandShortfallDollars: r2(shortfall),
    monthsToCloseOutOfBandShortfall: r1(monthsToCloseGap(shortfall, monthlyIn)),
    overweightOutOfBand: (d.breaches || []).filter(r => r.driftDollars > 0).map(r => r.label),
  };

  // ── concentration ── one instrument held in three accounts is one bet.
  const byInstr = new Map();
  for (const h of held) {
    const key = hasRealTicker(h) ? h.ticker.toUpperCase() : h.name;
    const p = byInstr.get(key) || { instrument: key, value: 0, accounts: [] };
    p.value += val(h);
    if (!p.accounts.includes(acctOf(h))) p.accounts.push(acctOf(h));
    byInstr.set(key, p);
  }
  const positions = [...byInstr.values()].sort((a, b) => b.value - a.value);
  const concentration = {
    positions: positions.map(p => ({ instrument: p.instrument, value: r2(p.value),
      pct: pctOf(p.value, tot), accounts: p.accounts })),
    over20Pct: positions.filter(p => tot > 0 && p.value / tot * 100 > 20).map(p => p.instrument),
    // Aggregate only: no name, no tickers, no parts. "None held" and "none
    // configured" are different facts, so neither is left as a bare null.
    employer: emp ? { configured: true, value: r2(emp.value), pct: r1(emp.pct), capPct: EMPLOYER_CAP_PCT,
                      over: emp.pct > EMPLOYER_CAP_PCT }
      : targets.employerName || employerConfig().tickers.length
        ? { configured: true, value: 0, pct: 0, capPct: EMPLOYER_CAP_PCT, over: false }
        : { configured: false },
    lookThrough: { asOf: FUND_TOP_HOLDINGS.asOf, lowerBound: true,
      rows: lookThroughExposure().slice(0, ASK_LOOKTHROUGH_ROWS)
        .map(r => ({ company: r.company, value: r2(r.value), pct: r1(r.pct) })) },
  };

  // ── contributions ──
  const rules = contributionRules.map(r => {
    const h = holdings.find(x => x.id === r.holdingId) || holdings.find(x => x.name === r.holdingName);
    return { holding: h?.name || r.holdingName, account: h ? acctOf(h) : null,
      sleeve: h ? getSleeve(h) : null, amount: r.amount,
      cadence: CADENCE_LABELS[r.cadence] || r.cadence,
      monthlyEquivalent: r2(monthlyContribution([r])), nextDate: ruleNextDate(r) };
  });
  const bySleeveMonthly = {};
  for (const k of Object.keys(SLEEVE_CONFIG)) {
    const sum = rules.filter(r => r.sleeve === k).reduce((s, r) => s + r.monthlyEquivalent, 0);
    if (sum > 0) bySleeveMonthly[k] = r2(sum);
  }
  const contributions = { monthlyTotal: r2(monthlyIn), rules, bySleeveMonthly };

  // ── ledger ── by name, never by id. The id is still what says which ACCOUNT
  // a row belongs to — one fund can sit in two — so it is resolved here. A row
  // whose holding is gone falls back to its name only when that is unambiguous.
  const flows = externalFlows(transactions);
  const txSorted = transactions.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const txAccount = t => {
    const h = holdings.find(x => x.id === t.holdingId);
    if (h) return acctOf(h);
    const named = [...new Set(holdings.filter(x => x.name === t.holdingName).map(acctOf))];
    return named.length === 1 ? named[0] : null;
  };
  const byKind = {}, byMonth = {}, byHolding = new Map(), byAccount = {};
  for (const t of txSorted) {
    const amt = +t.amount || 0, account = txAccount(t);
    const k = byKind[t.kind] = byKind[t.kind] || { n: 0, dollars: 0, estimatedN: 0 };
    k.n++; k.dollars = r2(k.dollars + amt); if (t.estimated) k.estimatedN++;
    const mo = String(t.date).slice(0, 7);
    (byMonth[mo] = byMonth[mo] || {})[t.kind] = r2((byMonth[mo][t.kind] || 0) + amt);
    const hKey = t.holdingName + '\n' + account;
    const hh = byHolding.get(hKey) || { holding: t.holdingName, account, n: 0, units: 0, dollars: 0 };
    hh.n++; hh.units = +(hh.units + (+t.units || 0)).toFixed(6); hh.dollars = r2(hh.dollars + amt);
    byHolding.set(hKey, hh);
    const aa = byAccount[account || 'unknown'] = byAccount[account || 'unknown'] || { n: 0, dollars: 0, byKind: {} };
    aa.n++; aa.dollars = r2(aa.dollars + amt); aa.byKind[t.kind] = r2((aa.byKind[t.kind] || 0) + amt);
  }
  const ledger = {
    epoch: LEDGER_EPOCH, count: transactions.length,
    firstDate: txSorted.length ? day(txSorted[0].date) : null,
    lastDate: txSorted.length ? day(txSorted[txSorted.length - 1].date) : null,
    byKind, byMonth, byHolding: [...byHolding.values()], byAccount,
    externalFlowsTotal: r2(flows.reduce((s, f) => s + f.amount, 0)),
    recordedIncome: r2(recordedIncome(transactions)),
    rows: txSorted.slice(-ASK_LEDGER_ROWS).reverse().map(t => ({ date: day(t.date), kind: t.kind,
      holding: t.holdingName, account: txAccount(t), units: t.units, unitPrice: t.unitPrice,
      amount: t.amount, source: t.source, estimated: !!t.estimated })),
  };

  // ── income ──
  const inc = dividendIncome(holdings);
  const incByAccount = {};
  for (const r of inc.rows) incByAccount[r.account] = r2((incByAccount[r.account] || 0) + r.annualIncome);
  const income = {
    totalAnnual: inc.totalAnnual, monthlyAvg: inc.monthlyAvg,
    accumulatingExcluded: inc.accumulatingExcluded,
    rows: inc.rows.map(r => ({ name: r.name, ticker: r.ticker, account: r.account, perShare: r.perShare,
      annualIncome: r.annualIncome, yieldPct: r.yieldPct, payments: r.payments, months: r.months })),
    byAccount: incByAccount,
    taxableAccountIncome: r2(inc.rows.filter(r => taxLocationOf(r) === 'taxable')
      .reduce((s, r) => s + r.annualIncome, 0)),
  };

  // ── asset location ── the engine's rows hold live holding objects (ids and
  // all); only plain fields leave this function.
  const loc = assetLocationSwap();
  const side = x => ({ holding: x.h.name, account: acctOf(x.h), sleeve: getSleeve(x.h) });
  const assetLocation = {
    rows: loc.rows.map(r => ({ holding: r.h.name, account: acctOf(r.h), location: r.loc,
      value: r2(r.value), yieldPct: r2(r.yield * 100), yieldEstimated: r.estimated, taxedAs: r.kind,
      annualCostIfTaxable: r2(r.rate * r.value),
      annualCostToday: r.loc === 'taxable' ? r2(r.rate * r.value) : 0 })),
    swap: loc.swap ? { moveIntoShelter: side(loc.swap.into), moveOutToTaxable: side(loc.swap.out),
      amount: r2(loc.swap.amount), annualSaving: r2(loc.swap.annualSaving),
      currentCost: r2(loc.swap.currentCost), estimatedYieldUsed: loc.swap.estimated } : null,
    foreignPensionExcluded: true,
  };

  // ── performance ── whole-portfolio snapshots only; returns only from the
  // ledger epoch (its first complete snapshot), and never THROUGH a period the
  // discontinuity guard flags. Before 2026-10-03 the brief carried a twrPct
  // near 100, a four-digit mwrAnnualPct and a 30-day loss that was really a
  // statement update, as facts, and Ask repeated them.
  let performance = null;
  if (snaps.length >= 2) {
    const first = snaps[0], last = snaps[snaps.length - 1];
    const post = snaps.filter(s => s.date >= LEDGER_EPOCH);
    const flowsIn = (from, to) => flows.filter(f => f.date > from && f.date <= to)
      .reduce((s, f) => s + f.amount, 0);
    // The same guard, over the same whole history, as the Performance chart.
    const health = performanceHealth(snaps, flows);
    // The since-epoch figure is THE answer to "how have I done": flagged
    // periods are left out of its chain and listed beside it. MWR is one IRR
    // over the whole span — it cannot step round a hole, so a flag withholds it.
    const excluded = post.length >= 2 ? flagsWithin(health, post[0].date, last.date) : [];
    const twr = computeTWR(post, flows, excluded);
    const mwr = !excluded.length && spanDays(post) >= MWR_MIN_SPAN_DAYS ? computeMWR(post, flows) : null;
    // Measurable from the later of the epoch's first snapshot and the guard's.
    const measurableFrom = !post.length ? null
      : health.measurableFrom > post[0].date ? health.measurableFrom : post[0].date;
    const atOrBefore = dstr => { let f = null; for (const s of snaps) { if (s.date <= dstr) f = s; else break; } return f; };
    // The S&P 500 yardstick the snapshots already carry, between the same two
    // snapshots as the figure beside it. Price only — SPY's dividends are not in it.
    const spyPct = (a, b) => a.spyPrice > 0 && b.spyPrice > 0 ? r2((b.spyPrice / a.spyPrice - 1) * 100) : null;
    const windows = [['7d', 7], ['30d', 30], ['90d', 90], ['ytd', null]].map(([label, days]) => {
      // A window only exists if history reaches back to where it opens — a
      // "90d" figure quietly covering seven weeks would be a trap.
      const s0 = atOrBefore(windowStartDate({ days }, now));
      if (!s0 || s0 === last) return null;
      const F = flowsIn(s0.date, last.date);
      // A short window across a flagged period gets no return at all — not a
      // figure with a hole in it, and not the change ex-flows that hole corrupts.
      const spans = flagsWithin(health, s0.date, last.date);
      const w = s0.date >= LEDGER_EPOCH && !spans.length
        ? computeTWR(snaps.filter(s => s.date >= s0.date), flows) : null;
      return { window: label, from: s0.date, to: last.date, valueChange: r2(last.value - s0.value),
        flowsIn: r2(F), changeExFlows: spans.length ? null : r2(last.value - s0.value - F),
        twrPct: w == null ? null : r2(w * 100), spyPricePct: spyPct(s0, last), spansFlaggedPeriods: spans };
    }).filter(Boolean);
    let hw = first;
    for (const s of snaps) if (s.value > hw.value) hw = s;
    const step = (snaps.length - 1) / (ASK_SERIES_POINTS - 1);
    const picks = snaps.length <= ASK_SERIES_POINTS ? snaps
      : [...new Set(Array.from({ length: ASK_SERIES_POINTS }, (_, i) => Math.round(i * step)))].map(i => snaps[i]);
    // The chart's own "vs policy" figure — only if its blended series is already
    // in memory, and was built from the targets he has now.
    let vsPolicy = null;
    const policyWarm = policyCache && benchW && policyCache.key.endsWith(':' + JSON.stringify(benchW));
    if (policyWarm && twr != null && post.length >= 2) {
      const [p0, p1] = samplePolicyAt(policyCache.series, [post[0].date, last.date]);
      if (p0 > 0 && p1 != null) vsPolicy = { from: post[0].date, to: last.date,
        policyTotalReturnPct: r2((p1 / p0 - 1) * 100), twrMinusPolicyPct: r2((twr - (p1 / p0 - 1)) * 100) };
    }
    if (!policyWarm) notLoaded.push('Blended policy benchmark — it loads with the This week card once signed in, and has not loaded this session');
    performance = {
      snapshots: { count: snaps.length, first: first.date, last: last.date },
      valueChangeSinceFirstSnapshot: { dollars: r2(last.value - first.value),
        pct: first.value > 0 ? r1((last.value / first.value - 1) * 100) : null, includesMoneyPaidIn: true },
      caveats: health.flags,
      measurableFrom,
      sinceLedgerEpoch: post.length >= 2 ? { from: post[0].date, twrPct: twr == null ? null : r2(twr * 100),
        excludedPeriods: excluded, mwrAnnualPct: mwr == null ? null : r1(mwr * 100),
        flowsIn: r2(flowsIn(post[0].date, last.date)), spyPricePct: spyPct(post[0], last) } : null,
      vsPolicyBenchmark: vsPolicy,
      windows,
      highWater: { date: hw.date, value: r2(hw.value),
        currentVsHighPct: hw.value > 0 ? r1((last.value / hw.value - 1) * 100) : null },
      seriesColumns: ['date', 'value', 'spyPrice'],
      series: picks.map(s => [s.date, r2(s.value), r2(s.spyPrice)]),
      spyNote: 'spyPrice / spyPricePct: S&P 500 (SPY) price only, no dividends',
    };
  } else {
    notLoaded.push('Performance history — it needs at least two daily value snapshots; they are recorded automatically as the app is used');
  }

  // ── since last look ── the home screen's own line, against the same earlier
  // visit. Read from memory: the stored stamp already belongs to this visit.
  const look = lastLookPrev && sinceLook(lastLookPrev);
  const sinceLastLook = look ? { date: lastLookPrev.date, valueThen: r2(lastLookPrev.value),
    valueChange: r2(tot - lastLookPrev.value), flowsIn: r2(look.flowsIn), changeExFlows: r2(look.delta) } : null;

  // ── fx ──
  const sek = sekDecomposition();
  const sekHolding = sek && holdings.find(h => h.name === sek.name && Array.isArray(h.fxHistory) && h.fxHistory.length >= 2);
  // Krona exposure is what HOLDS kronor, not what is priced in them: the
  // short-bond fund, not the global index fund (AVANZA_FUND_IDS.assetsInSek).
  // The old `sekExposedValue` summed the whole pension, ≈10× too much; the
  // field is renamed so ask-4 can tell an old shell's figure from this one.
  const byName = list => [...list.reduce((m, h) => m.set(h.name, (m.get(h.name) || 0) + val(h)), new Map())]
    .map(([holding, v]) => ({ holding, value: r2(v) }));
  const sekPriced = held.filter(h => matchesAvanza(h) || (Array.isArray(h.fxHistory) && h.fxHistory.length));
  const kronaHeld = sekPriced.filter(holdsKronaAssets);
  const fx = sek && sekHolding ? {
    fund: sek.name, from: sek.from, to: sek.to, fundInKronorPct: r2(sek.local * 100),
    kronaVsDollarPct: r2(sek.fx * 100), netUsdPct: r2(sek.net * 100),
    kronaExposure: { value: r2(kronaHeld.reduce((s, h) => s + val(h), 0)), holdings: byName(kronaHeld),
      pricedInKronorOnly: byName(sekPriced.filter(h => !holdsKronaAssets(h))) },
    // navDate: the day each NAV is for (avanzaNavDate) — null on stamps from
    // before Drop 2. `date` is only when the app fetched it.
    stamps: { columns: ['date', 'navSek', 'usdPerSek', 'navDate'],
      rows: sekHolding.fxHistory.slice(-ASK_FX_STAMPS).map(r => [r.date, r.nav, r.rate, r.navDate ?? null]) },
  } : null;

  // ── fire ── one run with the card's own defaults (the rounded figures its
  // inputs show), and only once a spending number has been saved.
  const fi = askFireInputs();
  const spend = +targets.fireAnnualSpend > 0 ? +targets.fireAnnualSpend : null;
  const sim = spend ? askFireRun(spend, fi) : null;
  const fire = {
    start: r2(tot), monthlyContribDefault: fi.monthlyContrib, muRealPct: fi.muPct, sigmaPct: fi.sigmaPct,
    swrPct: 4, annualSpend: spend,
    // Where muRealPct / sigmaPct come from — the app's own table, not a forecast.
    assumptions: {
      perSleeve: Object.fromEntries(Object.entries(SLEEVE_ASSUMPTIONS).map(([k, a]) =>
        [k, { realReturnPct: r2(a.mu * 100), volatilityPct: r2(a.sigma * 100) }])),
      basis: 'blended by CURRENT holding weights (not targets); volatility is a weighted average that ignores diversification; returns are real (after inflation)',
    },
    simulation: sim,
  };
  if (!sim) {
    fire.note = 'No annual spending saved, so no simulation was run.';
    // Not "enter it in the card": the prompt never sends him to a card, and a
    // spend named in the question is run for it (askExtra's fire).
    notLoaded.push("Annual spending for the FIRE estimate — none is saved. Name a yearly spend in the question " +
      "and the app runs the simulation for it; 'Save as my FI spend' keeps one");
  }

  // ── scenarios ── the rebalance engine's full rebalance. A plan per named sum
  // moved to askExtra (ask-4). oneMonthOfContributions went too: the eval read
  // it as what his rules buy (eval Q02/Q22: a different split from the rules')
  // — contributions.bySleeveMonthly is that figure.
  const scenarios = {
    fullRebalanceToTargets: askPlan(0, true),
  };

  // ── this week ── the This week card's facts for all three windows, as last
  // computed (this session's closes, or the cached ones from the last). They
  // replace the Advisor's market and attribution sections, which were empty
  // unless he had tapped their buttons that visit (eval Q01 answered a week
  // question from history rows a day late). Read, never fetched or computed
  // here: building the brief has no side effects.
  // Only facts that reach the last complete week (CIO, Drop 2 round 2): a
  // cache from an earlier Friday, with the refresh failing, went out as "the
  // last complete week" and Ask answered "How'd I do this week?" from it.
  const weekCurrent = weekIsCurrent(weekFactsData, now);
  const thisWeek = weekCurrent ? askWeek(weekFactsData, r2, weekPlan(sleeveVals, tgtPcts, tot, bandAbs, bandRel)) : null;
  if (!thisWeek) {
    notLoaded.push(weekFactsData?.windows?.week && !weekCurrent
      ? `This week's figures ${weekFailedAt ? 'could not be refreshed' : 'have not refreshed yet'} — the last ones on this phone run to ${weekFactsData.asOf}`
      : "This week's market moves and what moved your money — they load with the This week card once signed in");
  }

  return {
    schema: 'portfolio-brief/2',   // /2 (ask-4): no question-dependent sections; fx.kronaExposure
    nyDate: nyToday(now),
    freshness, policy,
    totals: { totalValue: r2(tot), holdings: held.length, accounts: accounts.length },
    accounts, holdings: holdingRows, drift, concentration, contributions, ledger, income,
    assetLocation, performance, sinceLastLook, fx, fire, scenarios, thisWeek,
    notLoaded,
    notTracked: [
      'Cost basis, tax lots and unrealised gains — so the tax cost of a sale cannot be computed',
      'Per-holding or per-account history — value snapshots are whole-portfolio only',
      'Fund expense ratios',
      'Cash or assets held outside these accounts',
      'Age, retirement date and income',
      'Sells and deleted holdings — they leave no ledger row',
    ],
  };
}

// Starters. Questions, never verdicts: a starter built from live figures
// ("Which prices are stale?") would itself be a verdict nobody asked for, so
// none names a value of his. Each is one the brief answers well today, and the
// one that names a date reads it from the data's own schema (LEDGER_EPOCH),
// never from a string in the code: "since June" sat in this pool for weeks
// after returns moved to start on Aug 1 (Drop 1 review).
// Two show (Drop 2, 2026-10-04): the week, which is the app's cadence, always
// first, then one from the pool stepped by day so it holds still within one.
// They now stay on screen under every thread, so two keep the card short.
const ASK_STARTER_LEAD = "How'd I do this week?";
function askStarterPool() {
  const [y, m, d] = LEDGER_EPOCH.split('-').map(Number);
  const epoch = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return [
    'Am I on plan?',
    `How have I done since ${epoch}?`,
    'Where would my next $5,000 go?',
    "What's my krona exposure?",
    'What would a 30% drop do to my mix?',
    'Am I on pace for work-optional?',
    'How much have I put in this year?',
    "What's my dividend income by account?",
    'Does it matter where my bonds sit?',
  ];
}
function askStartersFor(date = new Date()) {
  const pool = askStarterPool();
  const dayOfYear = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
  return [ASK_STARTER_LEAD, pool[dayOfYear % pool.length]];
}

// A starter fills the box and focuses it; it never sends. Until Drop 2 a tap
// sent at once, and every chip vanished for good after the first question
// (2026-10-03 audit, chat-live). Filling lets him read, edit or add to it
// first. `src` is for the function's log only: where the text in the box came
// from ('starter', or 'insight' from the week card); typed text is 'typed'.
let askSrc = null;
function askFill(text, src = 'starter') {
  const input = document.getElementById('askInput');
  if (!input) return;
  input.value = String(text ?? '').slice(0, 2000);
  askSrc = src;
  askAutoGrow(input);
  input.focus();
  // Caret at the end, so he can carry the question on.
  input.setSelectionRange?.(input.value.length, input.value.length);
}
// Typing over a starter keeps it a starter question; emptying the box and
// typing fresh makes it his own.
function askEdited(el) {
  if (!el.value) askSrc = null;
  askAutoGrow(el);
}

// The thread survives a reload, per device. Storage can be absent or full
// (private window, blocked site data); the card must work without it.
function loadAskThread() {
  try {
    const raw = JSON.parse(localStorage.getItem(ASK_THREAD_KEY) || '[]');
    return (Array.isArray(raw) ? raw : [])
      .filter(t => t && typeof t.q === 'string' && (typeof t.a === 'string' || typeof t.error === 'string'))
      .map(t => typeof t.a === 'string' ? { q: t.q, a: t.a, ts: +t.ts || 0 } : { q: t.q, error: t.error, ts: +t.ts || 0 })
      .slice(-ASK_KEEP_TURNS);
  } catch (e) { return []; }
}
function saveAskThread() {
  try {
    const done = askThread.filter(t => !t.pending).slice(-ASK_KEEP_TURNS);
    if (done.length) localStorage.setItem(ASK_THREAD_KEY, JSON.stringify(done));
    else localStorage.removeItem(ASK_THREAD_KEY);
  } catch (e) { /* the thread still lives in memory */ }
}
function clearAskThread() {
  // A question still in flight is dropped with the thread — otherwise the card
  // sits busy, chips dead, until an answer nobody is waiting for times out.
  askAbort?.abort();
  askAbort = null;
  askBusy = false;
  askThread = [];
  askRestored = 0;
  askShowEarlier = false;
  saveAskThread();
  renderAskThread();
}
function toggleAskEarlier() {
  askShowEarlier = !askShowEarlier;
  renderAskThread();
}

// Model text → HTML. Escaped FIRST, so nothing the model (or a poisoned fund
// name echoed back by it) writes can become markup; then a deliberately small
// markdown subset is layered on the escaped text. No links, no raw HTML.
function askRender(text) {
  const bold = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  let html = '', para = [], list = null;
  const endPara = () => { if (para.length) html += `<p>${para.join('<br>')}</p>`; para = []; };
  const endList = () => {
    if (list) html += `<${list.tag}>${list.items.map(i => `<li>${i}</li>`).join('')}</${list.tag}>`;
    list = null;
  };
  for (const raw of esc(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const ul = /^[-*•]\s+(.+)$/.exec(line), ol = /^\d{1,2}[.)]\s+(.+)$/.exec(line);
    const head = /^#{1,6}\s+(.+)$/.exec(line);
    if (!line) endPara();               // a blank line between items must not restart an <ol>
    else if (ul || ol) {
      endPara();
      const tag = ul ? 'ul' : 'ol';
      if (list && list.tag !== tag) endList();
      list = list || { tag, items: [] };
      list.items.push(bold((ul || ol)[1]));
    }
    else if (list && !para.length && /^\s{2,}/.test(raw)) list.items[list.items.length - 1] += '<br>' + bold(line);
    else if (head) { endPara(); endList(); html += `<p><strong>${head[1].replace(/\*\*/g, '')}</strong></p>`; }
    else { endList(); para.push(bold(line)); }
  }
  endPara(); endList();
  return html;
}

function askTurnHtml(t) {
  // An answer kept from an earlier day carries that day's numbers — date it.
  const d = t.ts ? new Date(t.ts) : null;
  const when = d && d.toDateString() !== new Date().toDateString()
    ? `<span class="ask-when">${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>` : '';
  return `<div class="ask-turn">
      <p class="ask-q">${esc(t.q)}${when}</p>
      ${t.pending ? '<div class="ask-a ask-wait">Thinking… this can take up to half a minute.</div>'
        : t.error ? `<div class="ask-a ask-err">${esc(t.error)}</div>`
        : `<div class="ask-a">${askRender(t.a)}</div>`}
    </div>`;
}

function renderAskThread() {
  const el = document.getElementById('askThread');
  if (!el) return;
  const cut = Math.max(Math.min(askRestored, askThread.length), askThread.length - ASK_OPEN_TURNS);
  const earlier = askThread.slice(0, cut);
  el.innerHTML =
    (earlier.length ? `<button type="button" class="ask-link" id="askEarlier" onclick="toggleAskEarlier()"
        aria-expanded="${askShowEarlier}">${askShowEarlier ? 'Hide earlier' : `Show earlier (${earlier.length})`}</button>` : '') +
    (askShowEarlier ? earlier.map(askTurnHtml).join('') : '') +
    askThread.slice(cut).map(askTurnHtml).join('');
  renderAskState();
}

// Everything about the card that is not the thread or the typed text. Safe to
// call from render() and from the cloud button: it never touches #askInput.
function renderAskState() {
  const send = document.getElementById('askSend');
  if (!send) return;
  // #btnCloud stays hidden until cloud.js knows whether there is a session.
  // Until then say nothing, rather than flash "sign in" at someone signed in.
  const known = document.getElementById('btnCloud')?.style.display !== 'none';
  const signedOut = known && !cloudReady();
  send.disabled = askBusy || signedOut;
  send.textContent = askBusy ? '…' : 'Ask';
  document.getElementById('askSignin').style.display = signedOut ? '' : 'none';
  document.getElementById('askClear').style.display = askThread.length ? '' : 'none';
  // Starters stay whenever he can ask, thread or not; signed out they would
  // only fill a box he cannot send.
  const chips = document.getElementById('askChips');
  chips.style.display = signedOut ? 'none' : '';
  if (!signedOut && !chips.childElementCount) {
    chips.innerHTML = askStartersFor().map(c =>
      `<button type="button" class="ask-chip" onclick="askFill(this.textContent)">${esc(c)}</button>`).join('');
  }
}

function askAutoGrow(el) {
  el.style.height = 'auto';
  if (el.value) el.style.height = (el.scrollHeight + 2) + 'px';   // +2: the border; CSS max-height caps it
}
function askKeydown(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  submitAsk();
}
function askScrollToLatest() {
  const turn = document.querySelector('#askThread .ask-turn:last-child');
  // 'nearest' moves the page only if it has to. An answer taller than the
  // screen is the exception — land on its first line, not its last.
  turn?.scrollIntoView({ behavior: 'smooth', block: turn.offsetHeight > window.innerHeight ? 'start' : 'nearest' });
}

// Errors are short and plain, and never the body of someone else's response.
function askErrorText(e) {
  const msg = String(e?.message || '').slice(0, 160);
  // The edge function deploys separately from the shell. proxyPost surfaces
  // the function's own {error:"not found"}; a gateway 404 has no JSON body.
  // Anchored to those two strings: an upstream 404/401 arrives as "the model is
  // unavailable right now (404)", which is neither of these and says so itself.
  if (/^not found$|^request failed \(404\)$/i.test(msg))
    return "Ask isn't deployed yet — the app shipped ahead of its cloud function. Everything else works.";
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /did not respond in time|timed? ?out/i.test(msg))
    return 'No answer in time — the model took too long. Try again.';
  // "sign in required" is the function's own 401. proxyPost has already
  // renewed the token once and retried, so this is a just-renewed token
  // refused again; a session that could not be renewed never gets here
  // (SignedOutError → the card's sign-in line).
  if (/^sign in required$|^request failed \(401\)$|jwt/i.test(msg))
    return 'Your cloud session has expired — sign in again with ☁.';
  if (e instanceof TypeError)
    return 'Could not reach your cloud function — check the connection and try again.';
  return 'Could not get an answer — ' + (msg || 'unknown error') + '.';
}

async function submitAsk() {
  const input = document.getElementById('askInput');
  const q = (input?.value || '').trim().slice(0, 2000);
  if (!q || askBusy) return;
  // Signed out is a state of the card, not a failed question: keep what was
  // typed, show the sign-in line, push nothing into the thread.
  if (!cloudReady()) { renderAskState(); return; }

  // Only completed turns go back to the model; an error bubble is not something it said.
  const history = askThread.filter(t => t.a && !t.error)
    .slice(-ASK_HISTORY_TURNS).map(t => ({ q: t.q, a: t.a }));
  const turn = { q, pending: true, ts: Date.now() };
  const ctl = askAbort = new AbortController();
  const src = askSrc || 'typed';
  askSrc = null;
  askBusy = true;
  askThread.push(turn);
  if (input) { input.value = ''; askAutoGrow(input); }
  // On a phone the keyboard would otherwise sit on top of the answer.
  if (input && window.matchMedia?.('(pointer: coarse)').matches) input.blur();
  renderAskThread();
  askScrollToLatest();

  let result;
  try {
    // 90s: deliberately outlives the function's own 85s upstream budget. The
    // brief is the same for every question; what this question's amounts need
    // rides as `extra`, after the server's cache breakpoint. `client` is for
    // the log: no ids, just the shell version and typed / starter / insight.
    const r = await proxyPost('/ask', { question: q, context: askContext(), extra: askExtra(q), history,
      client: { v: ASK_SHELL_VERSION, src } }, 90000, ctl.signal);
    result = typeof r?.answer === 'string' && r.answer.trim()
      ? { a: r.answer } : { error: 'No answer came back. Try again.' };
  } catch (e) {
    // The session could not be renewed (cloud.js has already signed the app
    // out): that is the card's sign-in state, not an answer that failed.
    result = e?.name === 'SignedOutError' ? { signedOut: true } : { error: askErrorText(e) };
  }
  // Cleared while it was thinking: Clear already reset the card and a newer
  // question may be in flight, so this one has nothing left to touch.
  if (!askThread.includes(turn)) return;
  askBusy = false;
  askAbort = null;
  if (result.signedOut) {
    // No bubble, nothing saved: the question goes back in the box (unless he
    // has typed the next one) and the sign-in line shows under it.
    askThread.splice(askThread.indexOf(turn), 1);
    if (input && !input.value) { input.value = q; askSrc = src === 'typed' ? null : src; askAutoGrow(input); }
    saveAskThread();
    renderAskThread();
    return;
  }
  delete turn.pending;
  Object.assign(turn, result);
  // A failed question goes back in the box, unless he has started another.
  if (result.error && input && !input.value) { input.value = q; askSrc = src === 'typed' ? null : src; askAutoGrow(input); }
  saveAskThread();
  renderAskThread();
  askScrollToLatest();
}

function renderAdvisorContext() {
  const el = document.getElementById('advContext');
  if (!el) return;
  const open = advShow.drift;
  const btn = document.getElementById('advDriftToggle');
  if (btn) { btn.textContent = open ? 'Hide' : 'Show'; btn.setAttribute('aria-expanded', String(open)); }
  el.innerHTML = open ? renderDriftSection()
    : '<p class="adv-placeholder adv-quiet">Compare each sleeve against your targets and rebalancing bands.</p>';
}

// ─── Rebalance simulator (P4) ────────────────────────────────────────────────
// Pure: given $amount of new money (buy-only) or a full rebalance (sells
// allowed), return exact dollar actions per sleeve with a concrete holding
// suggestion each. Tax-aware: sells prefer tax-advantaged accounts; taxable
// sells carry a capital-gains warning. No lot data yet — warnings, not lots.
// Its only reader in the shell is Ask's brief (`scenarios`): the Next money
// form and the Full Rebalance button that also drew it left the Advisor card
// on 2026-10-03.
const TAX_ADVANTAGED_RE = /roth|401|403|pension|swedish/i;

function rebalancePlan(holdingsArr, targetsObj, amount, { allowSells = false } = {}) {
  amount = +amount || 0;
  const val = h => (h.quantity || 0) * (h.price || 0);
  const sleeveOf = h => h.sleeve || autoDetectSleeve(h);
  const tot = holdingsArr.reduce((s, h) => s + val(h), 0);
  if (!(tot > 0)) return null;

  const vals = {};
  for (const k of Object.keys(SLEEVE_CONFIG)) vals[k] = 0;
  for (const h of holdingsArr) vals[sleeveOf(h)] = (vals[sleeveOf(h)] || 0) + val(h);
  const { stocks = 0, bonds = 0, other = 0, us = 0, intl = 0, tilts = 0 } = targetsObj;
  const tgt = { us_stock: stocks * us / 100, intl_stock: stocks * intl / 100, tilt: stocks * tilts / 100, bond: bonds, other };

  const totalAfter = tot + amount;
  const sleeves = Object.keys(vals);
  const deltas = {};
  for (const k of sleeves) deltas[k] = (tgt[k] || 0) / 100 * totalAfter - vals[k];

  const warnings = [];
  const buys = {};
  if (allowSells) {
    for (const k of sleeves) buys[k] = deltas[k];
  } else {
    if (amount <= 0) {
      return { totalBefore: +tot.toFixed(2), totalAfter: +totalAfter.toFixed(2), rows: [],
               warnings: ['No amount to invest — a buy-only plan needs one; a full rebalance (sells allowed) does not.'] };
    }
    for (const k of sleeves) buys[k] = 0;
    const posKeys = sleeves.filter(k => k !== 'other' && deltas[k] > 0);
    const G = posKeys.reduce((s, k) => s + deltas[k], 0);
    if (G <= 0) {
      for (const k of sleeves) buys[k] = amount * (tgt[k] || 0) / 100; // on target — keep weights
    } else if (amount >= G) {
      for (const k of posKeys) buys[k] = deltas[k];
      const R = amount - G;
      for (const k of sleeves) buys[k] = (buys[k] || 0) + R * (tgt[k] || 0) / 100;
    } else {
      for (const k of posKeys) buys[k] = amount * deltas[k] / G; // pro-rata to gap
    }
  }

  const rows = [];
  for (const k of sleeves) {
    const label = SLEEVE_CONFIG[k].label;
    const amt = +(buys[k] || 0).toFixed(2);
    if (Math.abs(amt) < 1) { rows.push({ sleeve: k, label, action: 'hold', amount: 0, suggestion: '', note: '' }); continue; }
    const inSleeve = holdingsArr.filter(h => sleeveOf(h) === k).sort((a, b) => val(b) - val(a));
    if (amt > 0) {
      const h = inSleeve[0];
      rows.push({
        sleeve: k, label, action: 'buy', amount: amt,
        suggestion: h
          ? `Add to ${h.name}${h.ticker && h.ticker !== 'N/A' ? ` (${h.ticker})` : ''} in ${h.account || 'Unassigned'}`
          : `Open a new ${label} position`,
        note: '',
      });
    } else {
      const taxAdv = inSleeve.find(h => TAX_ADVANTAGED_RE.test(h.account || ''));
      const h = taxAdv || inSleeve[0];
      const taxable = !!h && !TAX_ADVANTAGED_RE.test(h.account || '');
      const note = taxable ? 'taxable account — may realize capital gains' : 'tax-advantaged — no capital-gains impact';
      rows.push({
        sleeve: k, label, action: 'sell', amount: amt,
        suggestion: h ? `Trim ${h.name} in ${h.account || 'Unassigned'}` : '',
        note,
      });
      if (taxable) warnings.push(`${label}: the only sell candidates are in a taxable account — check unrealized gains before trimming.`);
    }
  }
  return { totalBefore: +tot.toFixed(2), totalAfter: +totalAfter.toFixed(2), rows, warnings };
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement === document.getElementById('iPrice')) addHolding();
  if (e.key === 'Escape') { cancelEdit(); cancelSplit(); cancelQuickPrice(); }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
initTheme();
document.getElementById('iAccount').innerHTML = accountOptions('');
loadLocal();
render();
renderAskThread();   // a thread kept from the last visit
renderTargetInputs();

// Adopt data/portfolio.json. Returns true when the file supplied state.
//
// In local mode this file IS the store — every save goes through server.py to
// land here, and it is what Claude, the MCP server, and Vertex read.
// localStorage is only a fast first paint and an offline fallback, so the file
// must win whenever it has data. Booting the other way round is a data-loss
// bug: a browser holding a stale cache skips the read, then the auto price
// refresh autosaves that stale cache straight over a newer file. Observed
// 2026-08-02 — a preview browser silently reverted the portfolio by a day,
// restoring three sold positions.
async function loadFromServer() {
  try {
    const res = await fetch('data/portfolio.json');
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.holdings?.length) return false;
    holdings = data.holdings;
    if (data.targets) targets = data.targets;
    if (data.lastSaved) lastSaved = data.lastSaved;
    transactions      = data.transactions || [];
    contributionRules = data.contributionRules || [];
    saveLocal();
    applyContributionRules();
    render();
    renderTargetInputs();
    // History may have rendered before transactions arrived — redraw the
    // flow-adjusted chart now that external flows are known.
    renderPerformanceChart();
    return true;
  } catch (e) { return false; }
}

if (IS_SHELL) {
  // Shell mode: no data ships with the page — cloudBoot gates on sign-in,
  // then pulls state + history from the cloud (contribution accrual runs
  // inside syncOnSignIn).
  cloudBoot();
} else {
  // Local mode: finish loading the file-backed state BEFORE the cloud client
  // arbitrates — syncing against a half-loaded state could push emptiness.
  (async () => {
    const hadCache = holdings.length > 0;
    // Always read the file — see loadFromServer. Never gate this on whether
    // localStorage happened to have something.
    const fromFile = await loadFromServer();
    if (fromFile && !hadCache) toast('Portfolio loaded from file ✓');
    // Accrue any contributions that came due since the last visit (the
    // file path runs this inside loadFromServer; idempotent).
    if (!fromFile) applyContributionRules();
    await loadHistory();
    renderPerformanceChart();
    // Continuous two-way cloud sync when signed in; otherwise the button
    // just offers "Set up phone access".
    await cloudBoot();
  })();
}

// Auto-refresh prices on load (after UI settles) and every 15 minutes
setTimeout(() => refreshAllPrices({ silent: true }), 1200);
setInterval(() => {
  if (!document.hidden) refreshAllPrices({ silent: true });
}, 15 * 60 * 1000);

// Keep "X min ago" label current
setInterval(updateRefreshLabel, 60 * 1000);
