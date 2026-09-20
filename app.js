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
const AVANZA_FUND_IDS = {
  'LF Global Index':                    { id: '417655', splitByCountry: true },
  'Länsförsäkringar Global Index':      { id: '417655', splitByCountry: true },
  'Länsförsäkringar Kort räntefond':    { id: '2084' },
  'LF Short bond':                      { id: '2084' },
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
  price:    ['price','nav','cost','rate','px','last','close','market price','current price','share price','unit price'],
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
let chartInst  = null;
let chartView  = 'sleeve'; // 'sleeve' | 'ticker' | 'account'
let unsaved    = false;
let importRows = [];
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
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️';
  // Re-render charts with theme-aware colors
  if (typeof renderChart === 'function') renderChart();
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
function themeChartBorder() { return isDark() ? '#161922' : '#fff'; }
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

function typeBadge(type) {
  const t = type || 'stock';
  const label = TYPE_CONFIG[t]?.label || t;
  return `<span class="type-badge type-${t}">${esc(label)}</span>`;
}

let autosaveTimer = null;
let historyData   = null;   // { snapshots: [{ date, value, spyPrice }] }
let perfChartInst = null;
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

async function saveHistorySnapshot() {
  const today = new Date().toISOString().slice(0, 10);
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
// External flows are only known from the ledger epoch (when P1a started
// recording them) — so true TWR/MWR is computed over snapshots from that date
// forward. The old since-inception figure stays, honestly labeled: it's a
// value change that includes contributions, not a return.
const LEDGER_EPOCH = '2026-06-11';

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

// Time-weighted return over [first..last] snapshot, end-of-period flow
// convention: each period's return = (V1 − flows in (d0,d1]) / V0. Returns a
// decimal (0.2 = +20%) or null when not computable.
function computeTWR(snapshots, flows) {
  if (!snapshots || snapshots.length < 2) return null;
  let twr = 1;
  for (let i = 1; i < snapshots.length; i++) {
    const s0 = snapshots[i - 1], s1 = snapshots[i];
    if (!(s0.value > 0)) return null;
    const F = (flows || [])
      .filter(f => f.date > s0.date && f.date <= s1.date)
      .reduce((s, f) => s + f.amount, 0);
    twr *= (s1.value - F) / s0.value;
  }
  return twr - 1;
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

// Annualized MWR is statistical noise on short spans — suppress under 30 days.
const MWR_MIN_SPAN_DAYS = 30;

function spanDays(snapshots) {
  if (!snapshots || snapshots.length < 2) return 0;
  return (new Date(snapshots[snapshots.length - 1].date) - new Date(snapshots[0].date)) / 86400000;
}

function renderPerformanceChart() {
  const card = document.getElementById('perfCard');
  const snapshots = historyData?.snapshots ?? [];
  if (snapshots.length < 2) { card.style.display = 'none'; return; }
  card.style.display = '';

  // Normalize both series to 100 at inception
  const base      = snapshots[0].value;
  const baseSpy   = snapshots[0].spyPrice ?? null;
  const labels    = snapshots.map(s => s.date);
  const portSerie = snapshots.map(s => +((s.value / base * 100).toFixed(2)));
  const spySerie  = baseSpy
    ? snapshots.map(s => s.spyPrice != null ? +((s.spyPrice / baseSpy * 100).toFixed(2)) : null)
    : null;

  // Header: honest value change (includes contributions — NOT a return)
  const latest = snapshots[snapshots.length - 1];
  const valueChange = ((latest.value / base - 1) * 100);
  const twrEl = document.getElementById('sinceInceptionReturn');
  if (twrEl) {
    const sign = valueChange >= 0 ? '+' : '';
    twrEl.textContent = `Value change since inception: ${sign}${valueChange.toFixed(1)}% (incl. contributions)`;
    twrEl.className = 'total-updated ' + (valueChange >= 0 ? 'return-positive' : 'return-negative');
  }

  // True TWR + MWR from the ledger epoch (flows known from there on)
  const postEpoch = snapshots.filter(s => s.date >= LEDGER_EPOCH);
  const flows = externalFlows(transactions);
  const twr = computeTWR(postEpoch, flows);
  const mwr = spanDays(postEpoch) >= MWR_MIN_SPAN_DAYS ? computeMWR(postEpoch, flows) : null;
  const trueEl = document.getElementById('trueTwrLabel');
  if (trueEl) {
    if (twr !== null) {
      const ts = twr >= 0 ? '+' : '';
      const mwrTxt = mwr !== null ? ` · MWR ${(mwr >= 0 ? '+' : '')}${(mwr * 100).toFixed(1)}%/yr` : '';
      const inc = recordedIncome(transactions);
      const incTxt = inc > 0 ? ` · income ${fmt$(inc)}` : '';
      trueEl.textContent = `TWR since ${LEDGER_EPOCH}: ${ts}${(twr * 100).toFixed(2)}%${mwrTxt}${incTxt}`;
      trueEl.className = 'total-updated ' + (twr >= 0 ? 'return-positive' : 'return-negative');
    } else {
      trueEl.textContent = '';
    }
  }

  const canvas = document.getElementById('perfChart');
  if (perfChartInst) { perfChartInst.destroy(); perfChartInst = null; }

  const datasets = [{
    label: 'Portfolio',
    data: portSerie,
    borderColor: '#0d9488',
    backgroundColor: 'rgba(13,148,136,0.08)',
    fill: true,
    tension: 0.3,
    pointRadius: 3,
    pointHoverRadius: 5,
  }];
  if (spySerie) datasets.push({
    label: 'SPY',
    data: spySerie,
    borderColor: '#a1a1aa',
    backgroundColor: 'transparent',
    fill: false,
    tension: 0.3,
    pointRadius: 3,
    pointHoverRadius: 5,
    borderDash: [4, 3],
  });

  perfChartInst = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              const ret = (v - 100).toFixed(1);
              const sign = ret >= 0 ? '+' : '';
              return `${ctx.dataset.label}: ${sign}${ret}%`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 11 }, color: themeTickColor() } },
        y: {
          ticks: {
            font: { size: 11 },
            color: themeTickColor(),
            callback: v => `${v >= 100 ? '+' : ''}${(v - 100).toFixed(0)}%`,
          },
          grid: { color: themeGridColor() },
        },
      },
    },
  });

  perfChartGen++;
  loadPolicyBenchmark(snapshots, postEpoch, twr, perfChartGen);
}

// Fetch VTI/VXUS/BND total-return series, blend by targets, and add the policy
// line + "vs policy" delta once ready. Failures skip silently — the chart is
// complete without it. Cached per range+weights for the session.
let policyCache = null;
let perfChartGen = 0;

function policyRangeFor(firstDate) {
  const days = (Date.now() - new Date(firstDate + 'T00:00:00Z')) / 86400000;
  if (days <= 80)  return '3mo';
  if (days <= 170) return '6mo';
  if (days <= 350) return '1y';
  if (days <= 700) return '2y';
  return '5y';
}

async function loadPolicyBenchmark(snapshots, postEpoch, twr, gen) {
  const weights = policyWeights(targets);
  if (!weights || snapshots.length < 2) return;
  const range = policyRangeFor(snapshots[0].date);
  const key = range + ':' + JSON.stringify(weights);
  if (!policyCache || policyCache.key !== key) {
    const fetched = {};
    for (const tick of Object.keys(weights)) {
      const s = await fetchYahooChart(tick, range).catch(() => null);
      if (!s) return; // offline or blocked — keep the chart as-is
      fetched[tick] = s;
    }
    const series = computePolicySeries(fetched, weights);
    if (!series) return;
    policyCache = { key, series };
  }
  if (gen !== perfChartGen || !perfChartInst) return; // superseded render

  const sampled = samplePolicyAt(policyCache.series, snapshots.map(s => s.date));
  const firstIdx = sampled.findIndex(v => v != null);
  if (firstIdx === -1) return;
  const base = sampled[firstIdx];
  const serie = sampled.map(v => v == null ? null : +((v / base * 100).toFixed(2)));
  perfChartInst.data.datasets.push({
    label: 'Policy (your targets)',
    data: serie,
    borderColor: '#3b6da0',
    backgroundColor: 'transparent',
    borderDash: [6, 4],
    fill: false,
    tension: 0.3,
    pointRadius: 0,
    pointHoverRadius: 4,
  });
  perfChartInst.update();

  // "Did my implementation beat my policy?" over the post-epoch TWR window.
  if (twr !== null && postEpoch.length >= 2) {
    const [p0, p1] = samplePolicyAt(policyCache.series,
      [postEpoch[0].date, postEpoch[postEpoch.length - 1].date]);
    if (p0 != null && p1 != null && p0 > 0) {
      const delta = twr - (p1 / p0 - 1);
      const el = document.getElementById('trueTwrLabel');
      if (el && el.textContent && !el.textContent.includes('vs policy')) {
        el.textContent += ` · vs policy ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(2)}%`;
      }
    }
  }
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

function getUniqueAccounts() {
  const seen = new Set();
  const accts = [];
  for (const h of holdings) {
    const acct = h.account || 'Unassigned';
    if (!seen.has(acct)) { seen.add(acct); accts.push(acct); }
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
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
      if (!(field in map) && aliases.includes(norm)) map[field] = i;
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
      const account = accountRaw.trim();

      let status = 'ok', statusMsg = 'Ready';
      if (!name)                           { status = 'err';  statusMsg = 'Missing name'; }
      else if (isNaN(qty) || qty <= 0)     { status = 'err';  statusMsg = 'Invalid shares'; }
      else if (isNaN(price) || price <= 0) { status = 'warn'; statusMsg = 'No price — fetch after import'; }

      const rec = {
        _row: idx + 1 + (looksLikeHeader ? 1 : 0),
        name, ticker, type, account,
        quantity: isNaN(qty) ? 0 : qty,
        price: (isNaN(price) || price < 0) ? 0 : price,
        status, statusMsg,
      };

      // Reconcile against existing holdings: a re-import UPDATES matching
      // positions instead of duplicating them.
      if (status !== 'err') {
        const match = findImportMatch(rec);
        if (match) {
          rec.matchIds = match.ids;
          const oldQty = match.ids.reduce((s, mid) =>
            s + (holdings.find(x => x.id === mid)?.quantity || 0), 0);
          rec.oldQty = oldQty;
          if (Math.abs(oldQty - rec.quantity) < 1e-9) {
            rec.mode = 'same';
            rec.statusMsg = 'No change';
          } else {
            rec.mode = 'update';
            rec.statusMsg = `Update: ${fmtN(oldQty)} → ${fmtN(rec.quantity)} sh`;
          }
        } else {
          rec.mode = 'add';
          if (status === 'ok') rec.statusMsg = 'New holding';
        }
      }
      return rec;
    }).filter(r => !(r.status === 'err' && !r.name && r.quantity === 0));

    renderImportPreview();
    event.target.value = '';
  };
  reader.readAsText(file);
}

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
  const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const hits = holdings.filter(h => norm(h.name) === norm(row.name) && inAccount(h));
  return hits.length ? { ids: hits.map(h => h.id) } : null;
}

function renderImportPreview() {
  const okRows   = importRows.filter(r => r.status === 'ok');
  const warnRows = importRows.filter(r => r.status === 'warn');
  const errRows  = importRows.filter(r => r.status === 'err');
  const adds     = importRows.filter(r => r.mode === 'add' && r.status !== 'err');
  const updates  = importRows.filter(r => r.mode === 'update');
  const sames    = importRows.filter(r => r.mode === 'same');
  const importable = okRows.length + warnRows.length - sames.length;

  document.getElementById('importSummary').innerHTML =
    `Found <strong>${importRows.length}</strong> rows: ` +
    `<span style="color:#10b981">${adds.length} new</span>, ` +
    `<span style="color:#3b82f6">${updates.length} updating</span>, ` +
    `<span style="color:var(--text-muted)">${sames.length} unchanged</span>` +
    (warnRows.length ? `, <span style="color:#d97706">${warnRows.length} missing price</span>` : '') +
    (errRows.length ? `, <span style="color:#dc2626">${errRows.length} skipped</span>` : '') + '.';

  document.getElementById('btnConfirmImport').textContent =
    updates.length ? `Apply ${importable} change${importable !== 1 ? 's' : ''}`
                   : `Import ${importable} holding${importable !== 1 ? 's' : ''}`;
  document.getElementById('btnConfirmImport').disabled = importable === 0;

  document.getElementById('importTableBody').innerHTML = importRows.map(r => {
    const sub = [r.ticker && r.ticker !== r.name ? r.ticker : '', r.account].filter(Boolean).join(' · ');
    // A quantity INCREASE on an existing holding may be a reinvested
    // distribution rather than new money — misclassifying it as a flow would
    // strip that income out of TWR, so the human decides here, one tap.
    const kindPicker = r.mode === 'update' && r.quantity > r.oldQty
      ? `<div style="margin-top:4px;"><select id="imp-kind-${r._row}" class="imp-kind">
           <option value="adjustment">New money / true-up</option>
           <option value="dividend">Reinvested dividend</option>
         </select></div>`
      : '';
    return `<tr class="row-${r.status}">
      <td style="color:var(--text-muted)">${r._row}</td>
      <td>
        <strong>${esc(r.name || '—')}</strong>
        ${sub ? `<div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${esc(sub)}</div>` : ''}
      </td>
      <td>${typeBadge(r.type)}</td>
      <td class="num">${r.quantity > 0 ? fmtN(r.quantity) : '—'}</td>
      <td class="num">${r.price > 0 ? fmt$(r.price) : '—'}</td>
      <td class="status-${r.status}">${r.statusMsg}${kindPicker}</td>
    </tr>`;
  }).join('');

  document.getElementById('importPreview').style.display = '';
  document.getElementById('importPreview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
        id: uid(), date: now.slice(0, 10), kind,
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
    if (r.mode === 'same') return;
    if (r.mode === 'update') {
      // Distributing across rows[] handles both a single match and a split
      // pair; keep the existing rows' account/type/sleeve — the CSV only
      // speaks for quantity and price.
      const kind = document.getElementById(`imp-kind-${r._row}`)?.value === 'dividend'
        ? 'dividend' : 'adjustment';
      if (applyQuantityUpdate(r.matchIds, r.quantity, { price: r.price, source: 'import', kind })) updated++;
      return;
    }
    holdings.push({
      id: uid(), name: r.name, type: r.type,
      ticker:  r.ticker  || '',
      account: r.account || '',
      quantity: r.quantity, price: r.price,
      updated: new Date().toISOString(),
    });
    added++;
  });
  importRows = [];
  document.getElementById('importPreview').style.display = 'none';
  markUnsaved(); render();
  const parts = [];
  if (added)   parts.push(`${added} added`);
  if (updated) parts.push(`${updated} updated`);
  toast(parts.length ? `Import applied: ${parts.join(', ')}` : 'Nothing to change');
}

function cancelImport() {
  importRows = [];
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
function deleteHolding(id) {
  const h = holdings.find(x => x.id === id);
  holdings = holdings.filter(x => x.id !== id);
  markUnsaved(); render();
  if (h) toast(`Removed ${h.name}`);
}

// ─── Inline edit ──────────────────────────────────────────────────────────────
function startEdit(id) { editingId = id; renderTable(); }
function cancelEdit()  { editingId = null; renderTable(); }

function saveEdit(id) {
  const name    = document.getElementById(`en-${id}`).value.trim();
  const ticker  = document.getElementById(`etick-${id}`).value.trim();
  const type    = document.getElementById(`et-${id}`).value;
  const account = document.getElementById(`eacc-${id}`).value;
  const sleeve  = document.getElementById(`eslv-${id}`).value || null;
  const qty     = parseFloat(document.getElementById(`eq-${id}`).value);
  const price   = parseFloat(document.getElementById(`ep-${id}`).value);

  if (!name || isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
    toast('Invalid values — check all fields.'); return;
  }
  const h = holdings.find(x => x.id === id);
  if (h) {
    const priceChanged = h.price !== price;
    const qtyDelta = qty - h.quantity;
    Object.assign(h, { name, ticker, type, account, sleeve, quantity: qty, price, updated: new Date().toISOString() });
    // A manually entered price on a proxy-tracked fund is a real NAV — recalibrate.
    if (priceChanged && price > 0 && proxyEntryFor(h)) {
      h.calibration = { date: new Date().toISOString(), nav: price };
    }
    // Ledger: a manual unit change is a statement true-up (or a real trade) —
    // record it so estimated auto-contributions reconcile against reality.
    if (qtyDelta !== 0) {
      transactions.push({
        id: uid(), date: new Date().toISOString().slice(0, 10), kind: 'adjustment',
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
function updateSplitPreview(id, totalQty) {
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

function renderRiskCard() {
  const card = document.getElementById('riskCard');
  const body = document.getElementById('riskBody');
  if (!card || !body) return;
  const emp = employerExposure();
  const look = lookThroughExposure().slice(0, 8);
  const sek = sekDecomposition();
  if (!emp && !look.length && !sek) { card.style.display = 'none'; return; }
  card.style.display = '';
  const pctFmt = (x, signed = false) =>
    `${signed && x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
  let html = '';

  if (emp) {
    const over = emp.pct > EMPLOYER_CAP_PCT;
    html += `<div class="subsection-label">Employer concentration — ${esc(emp.name)}</div>
      <p class="risk-line ${over ? 'risk-over' : ''}">
        ${fmt$(emp.value)} · <strong>${emp.pct.toFixed(1)}%</strong> of portfolio
        ${over ? `— above the ${EMPLOYER_CAP_PCT}% concentration guideline` : `(guideline: keep under ${EMPLOYER_CAP_PCT}%)`}
      </p>
      <p class="risk-note">Counts ${esc(emp.parts.join(', '))} — the same single bet as your salary.</p>`;
  }

  if (look.length) {
    html += `<div class="subsection-label">Top companies across all funds (look-through)</div>
      <div class="risk-look">` +
      look.map(r => `<div class="risk-row">
          <span>${esc(r.company)}</span>
          <span class="risk-bar"><span style="width:${Math.min(100, r.pct * 8)}%"></span></span>
          <span class="num">≥ ${r.pct.toFixed(1)}%</span>
        </div>`).join('') +
      `</div>
      <p class="risk-note">Lower bounds — computed from top-10 fund weights (approx., as of ${FUND_TOP_HOLDINGS.asOf}) plus direct positions.</p>`;
  }

  if (sek) {
    html += `<div class="subsection-label">Swedish pension — fund vs krona (${esc(sek.from)} → ${esc(sek.to)})</div>
      <p class="risk-line">
        Fund ${pctFmt(sek.local, true)} in SEK · krona ${pctFmt(sek.fx, true)} vs USD
        → net <strong>${pctFmt(sek.net, true)}</strong> in USD
      </p>`;
  }
  body.innerHTML = html;
}

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
    ts: Date.now(), date: new Date().toISOString().slice(0, 10), value: total(),
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
        ids: pair.map(x => x.id), name: h.name, ticker: '',
        qty: totalQty, price: h.price, manual: isManualPrice(h),
        splitPct: totalQty > 0 ? Math.round(usH.quantity / totalQty * 100) : 50,
      });
    } else {
      used.add(h.id);
      lines.push({
        ids: [h.id], name: h.name, ticker: h.ticker || '',
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
          ${l.ticker ? esc(l.ticker) + ' · ' : ''}${fmt$(l.price)}${l.manual ? ` · manual price${ageDays != null && ageDays > 0 ? `, ${ageDays}d old` : ''}` : ''}
        </div>
      </div>
      <div class="upd-line-inputs">
        <input id="upd-q-${key}" type="number" inputmode="decimal" step="any" min="0"
               value="${l.qty}" aria-label="Shares for ${esc(l.name)}">
        ${l.manual ? `<input id="upd-p-${key}" type="number" inputmode="decimal" step="any" min="0"
               value="${l.price}" aria-label="Price for ${esc(l.name)}" class="upd-price">` : ''}
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

// ─── Needs attention strip ───────────────────────────────────────────────────
// Everything that requires a human: manual-price holdings gone stale, zero
// prices, failed refreshes, and overdue proxy calibrations — each one tap
// from its fix.
let lastRefreshFailures = new Set(); // holding ids, set by refreshAllPrices

function attentionItems() {
  const items = [];
  const now = Date.now();
  for (const h of holdings) {
    const age = h.updated ? Math.floor((now - new Date(h.updated)) / 86400000) : null;
    if (!(h.price > 0)) {
      items.push({ id: h.id, label: `${h.name}: no price`, kind: 'price' });
    } else if (lastRefreshFailures.has(h.id)) {
      items.push({ id: h.id, label: `${h.name}: refresh failed`, kind: 'price' });
    } else if (isManualPrice(h) && age != null && age >= 7) {
      items.push({ id: h.id, label: `${h.name}: manual price ${age}d old`, kind: 'price' });
    } else if (proxyEntryFor(h) && h.calibration?.date &&
               (now - new Date(h.calibration.date)) / 86400000 > PROXY_RECAL_NUDGE_DAYS) {
      items.push({ id: h.id, label: `${h.name}: recalibrate NAV`, kind: 'price' });
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
    `<button class="attn-chip" data-hid="${it.id}">⚠ ${esc(it.label)}</button>`).join('');
  el.querySelectorAll('.attn-chip').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.hid;
      if (id === '__risk') {
        document.getElementById('riskCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (id === '__sync') {
        toast('Cloud sync is failing — your edits are safe locally but not backed up. ' +
              (typeof cloudSyncIssue === 'function' ? (cloudSyncIssue() || '') : ''), 8000);
        return;
      }
      startQuickPrice(id);
      document.getElementById(`qp-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById(`qp-${id}`)?.focus();
    };
  });
}

// ─── Quick inline price edit ──────────────────────────────────────────────────
function startQuickPrice(id) {
  if (editingId) cancelEdit();
  quickPriceId = id;
  renderTable();
}
function saveQuickPrice(id) {
  if (quickPriceId !== id) return;
  const inp = document.getElementById(`qp-${id}`);
  if (!inp) { quickPriceId = null; return; }
  const val = parseFloat(inp.value);
  if (!isNaN(val) && val >= 0) {
    const h = holdings.find(x => x.id === id);
    if (h) {
      h.price = val; h.updated = new Date().toISOString();
      // Explicitly typed price on a proxy-tracked fund = real NAV — recalibrate.
      if (val > 0 && proxyEntryFor(h)) h.calibration = { date: new Date().toISOString(), nav: val };
      markUnsaved();
    }
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
  if (viaProxy && viaProxy.price > 0) return viaProxy.price;

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
        price = parser === 'v7'
          ? data?.quoteResponse?.result?.[0]?.regularMarketPrice
          : data?.chart?.result?.[0]?.meta?.regularMarketPrice;
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
async function fetchYahooChart(ticker, range, { events = false, interval = '1d' } = {}) {
  // Signed in → private edge proxy first.
  const viaProxy = await proxyGet('/chart', { ticker, range, interval, events: events ? '1' : '0' });
  if (viaProxy && viaProxy.timestamps?.length && viaProxy.adjcloses?.length) {
    return { timestamps: viaProxy.timestamps, adjcloses: viaProxy.adjcloses,
             closes: viaProxy.closes || viaProxy.adjcloses,
             dividends: viaProxy.events || {} };
  }

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
  // The one FIRE input with no derivable default. Kept with the targets so it
  // syncs like them — and so Ask can answer "am I on pace?" without the card.
  if (targets.fireAnnualSpend !== spend) { targets.fireAnnualSpend = spend; markUnsaved(); }
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
  html += `<div style="font-size:11px;color:var(--text-secondary);margin-top:8px;">${esc(sim.assumptionNote || '')} · today's dollars · a model, not advice</div></div>`;
  out.innerHTML = html;
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

function renderDividends() {
  const card = document.getElementById('divCard');
  if (!card) return;
  card.style.display = holdings.length > 0 ? '' : 'none';
  if (holdings.length === 0) return;
  const body = document.getElementById('divBody');
  const inc = dividendIncome(holdings);
  if (!inc.rows.length) {
    body.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);margin:6px 0;">No dividend data yet — hit "Update dividends" to fetch trailing-12-month payments for your tickered holdings.</p>';
    return;
  }
  // All interpolated values esc()-escaped or app-computed.
  let html = `<table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:6px;">
    <tr style="text-align:left;color:var(--text-secondary);"><th style="padding:4px 6px;">Holding</th><th style="text-align:right;">$/share (T12M)</th><th style="text-align:right;">Est. annual</th><th style="text-align:right;">Yield</th><th style="padding-left:10px;">Pays</th></tr>`;
  for (const r of inc.rows) {
    html += `<tr style="border-top:1px solid var(--border,#eee);">
      <td style="padding:4px 6px;">${esc(r.ticker)} <span style="color:var(--text-secondary);font-size:12px;">${esc(r.account)}</span></td>
      <td style="text-align:right;">${fmt$(r.perShare)}</td>
      <td style="text-align:right;font-weight:600;">${fmt$(r.annualIncome)}</td>
      <td style="text-align:right;">${r.yieldPct === null ? '—' : r.yieldPct.toFixed(2) + '%'}</td>
      <td style="font-size:12px;color:var(--text-secondary);padding-left:10px;">${esc(r.months.join(', '))}</td>
    </tr>`;
  }
  html += `<tr style="border-top:2px solid var(--border,#ddd);font-weight:700;">
    <td style="padding:6px;">Total</td><td></td>
    <td style="text-align:right;">${fmt$(inc.totalAnnual)}/yr</td>
    <td colspan="2" style="font-size:12px;color:var(--text-secondary);padding-left:10px;">≈ ${fmt$(inc.monthlyAvg)}/month</td>
  </tr></table>`;
  if (inc.accumulatingExcluded > 0) {
    html += `<p style="font-size:12px;color:var(--text-secondary);margin:8px 0 0;">${inc.accumulatingExcluded} accumulating holding${inc.accumulatingExcluded === 1 ? '' : 's'} excluded (401K CITs / pension funds reinvest dividends inside the NAV — no cash distributions).</p>`;
  }
  body.innerHTML = html;
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
  const fxSources = [
    'https://api.frankfurter.app/latest?from=SEK&to=USD',
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
        const today = new Date().toISOString().slice(0, 10);
        for (const h of holdings.filter(x => x.name === name)) {
          if (!Array.isArray(h.fxHistory)) h.fxHistory = [];
          const row = { date: today, nav: fundData.nav, rate: sekToUsd, currency: 'SEK' };
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
  const h = holdings.find(x => x.id === id);
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
    h.price = price; h.updated = new Date().toISOString();
    markUnsaved(); render();
    toast(`${h.name} ${label} → ${fmt$(price)}`);
  } else {
    toast(`Could not fetch "${displayKey}" — enter ${label} manually.`);
  }
}

async function refreshAllPrices({ silent = false, autoSave = false } = {}) {
  if (refreshing) return;
  refreshing = true;

  const noTicker = h => !h.ticker || h.ticker.toUpperCase() === 'N/A';
  const useAvanza = h =>
    /swedish|pension/i.test(h.account || '') ||
    (noTicker(h) && /^lf\b|länsförsäkring/i.test(h.name));
  const fetchable = holdings.filter(h => {
    const key = (h.ticker || '').toUpperCase().trim();
    return (key && key !== 'N/A') || useAvanza(h) || matchesNavTable(h) || !!proxyEntryFor(h);
  });
  if (!fetchable.length) {
    refreshing = false;
    if (!silent) toast('No fetchable tickers found.');
    return;
  }

  const btn = document.getElementById('btnRefreshAll');
  if (!silent) { btn.disabled = true; }
  btn.textContent = '↻ Fetching…';

  let updated = 0, failed = 0;
  const failedTickers = [];
  const failedIds = new Set();
  for (const h of fetchable) {
    const hasRealTicker = h.ticker && h.ticker.toUpperCase() !== 'N/A';
    const lookup = (hasRealTicker ? h.ticker : h.name).toUpperCase();
    const price  = useAvanza(h) ? await fetchAvanza(h.name)
                 : proxyEntryFor(h) ? await fetchProxyNav(h)
                 : matchesNavTable(h) ? fetchFromNavTable(h.name)
                 : await fetchYahoo(lookup);
    if (price !== null) {
      h.price   = price;
      h.updated = new Date().toISOString();
      updated++;
    } else {
      failed++;
      failedTickers.push(lookup);
      failedIds.add(h.id);
    }
    btn.textContent = `↻ ${updated + failed}/${fetchable.length}…`;
    render();
  }

  if (updated > 0) markUnsaved();
  btn.disabled = false; btn.textContent = '↻ Refresh All';

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

  if (autoSave && updated > 0) {
    // Silently persist so storage (file locally, cloud row in shell mode)
    // always has fresh prices. Full payload — never drop the ledger.
    try { await autoSaveToServer(); } catch (_) { /* offline — no-op */ }
  }

  refreshing = false;
}

// ─── Refresh label ("Prices updated just now / X min ago") ───────────────────
function updateRefreshLabel() {
  const el = document.getElementById('lastRefreshedLabel');
  if (!el || !lastRefreshed) return;
  const mins = Math.round((Date.now() - lastRefreshed) / 60000);
  el.textContent = mins < 1 ? 'Prices updated just now' : `Prices updated ${mins} min ago`;
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
  a.download = `portfolio_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  toast('CSV exported');
}

// ─── Render: Account Tiles ────────────────────────────────────────────────────
function renderAccountTiles() {
  const tot = total();
  const el  = document.getElementById('accountTiles');

  if (!holdings.length) { el.style.display = 'none'; return; }
  el.style.display = '';

  const acctTotals = getAccountTotals();
  const sorted = Object.entries(acctTotals).sort(([,a],[,b]) => b - a);

  el.innerHTML = sorted.map(([acct, val], i) => {
    const pct   = tot > 0 ? (val / tot * 100).toFixed(1) : '0.0';
    const color = ACCT_COLORS[i % ACCT_COLORS.length];
    return `<div class="account-tile" style="border-top-color:${color}" role="button" tabindex="0"
      data-acct="${esc(acct)}" title="Update positions in ${esc(acct)}">
      <div class="account-tile-name">${esc(acct)}</div>
      <div class="account-tile-value">${fmt$(val)}</div>
      <div class="account-tile-pct">${pct}% of portfolio</div>
      <div class="account-tile-hint">✎ update positions</div>
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
  const today = new Date().toISOString().slice(0, 10);
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
  contributionRules.push({
    id: uid(), holdingId: h.id, holdingName: h.name,
    amount, cadence, anchorDate, lastAppliedThrough: null,
  });
  const appliedNow = applyContributionRules();
  if (appliedNow === 0) markUnsaved();
  render();
  toast(`Rule added: ${fmt$(amount)} ${CADENCE_LABELS[cadence]} → ${h.name.slice(0, 40)}`);
}

function deleteContributionRule(id) {
  contributionRules = contributionRules.filter(r => r.id !== id);
  markUnsaved(); render();
}

// ─── Natural-language contribution rules ─────────────────────────────────────
// "I have a bi-weekly fidelity transfer of $500 that goes to VOO and VGIT at
// a 70/30 rate" → two rules ($350 / $150, biweekly). Deterministic parser —
// this app deliberately has no LLM backend or API key, and the realistic
// utterance space (amount + cadence + targets + optional split + optional
// start date) is small. A preview-before-commit catches any misparse.

// Pure. Returns { rules: [{holdingId, holdingName, account, amount}],
// cadence, anchorDate, summary } or { error }.
function parseContributionText(text, holdingsArr) {
  const t = String(text || '').trim();
  if (!t) return { error: 'Type something like "$500 biweekly to VOO and VGIT 70/30".' };
  const lower = t.toLowerCase();

  // Cadence
  let cadence = null;
  if (/bi-?weekly|every (2|two) weeks|every other week|fortnight|per paycheck|each paycheck|every paycheck/.test(lower)) cadence = 'biweekly';
  else if (/semi-?monthly|1st (and|&) 15th|first (and|&) fifteenth|twice a month/.test(lower)) cadence = 'semimonthly';
  else if (/monthly|every month|per month|a month|each month/.test(lower)) cadence = 'monthly';
  if (!cadence) return { error: 'Couldn\'t find a cadence — say "biweekly", "monthly", or "1st and 15th".' };

  // Work on a copy with any "starting <date>" clause removed, so dates like
  // "starting 7/1" can't be mistaken for a split ratio or an amount.
  const startMatch = t.match(/starting (?:on )?([A-Za-z0-9 ,/-]+?)(?:\.|,|$)/i);
  const tBody = startMatch ? t.replace(startMatch[0], ' ') : t;

  // Total amount: prefer a $-prefixed number; fall back to a bare number.
  // Ratio pairs are stripped first and trailing \b excludes ordinals (15th).
  const ratioStripped = tBody.replace(/(\d+(?:\.\d+)?)\s*%?\s*[/\-]\s*(\d+(?:\.\d+)?)\s*%?(?:\s*[/\-]\s*(\d+(?:\.\d+)?)\s*%?)?/g, ' ');
  const amtMatch = ratioStripped.match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i)
                || ratioStripped.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i);
  const amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, '')) * (amtMatch[2] ? 1000 : 1) : NaN;
  if (!(amount > 0)) return { error: 'Couldn\'t find the dollar amount — include something like "$500".' };

  // Targets: tickers first (word-boundary match against held tickers), then
  // holding-name substrings (≥4 chars) for fundy names. Ambiguous tickers
  // (same ticker in two accounts) resolve to the larger position — the
  // preview shows the account so a wrong guess is visible before commit.
  const targets = [];
  const seen = new Set(); // ticker AND name keys — the same instrument held in
                          // two accounts must resolve to ONE target (largest)
  const byValue = [...holdingsArr].sort((a, b) => b.quantity * b.price - a.quantity * a.price);
  for (const h of byValue) {
    const tick = (h.ticker || '').toUpperCase();
    const tickKey = tick && tick !== 'N/A' ? `t:${tick}` : null;
    const nameKey = `n:${(h.name || '').toLowerCase()}`;
    if (seen.has(nameKey) || (tickKey && seen.has(tickKey))) continue;
    if (tickKey && new RegExp(`\\b${tick}\\b`, 'i').test(t)) {
      seen.add(tickKey); seen.add(nameKey);
      targets.push(h);
      continue;
    }
    const nameWords = (h.name || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    if (nameWords.length && nameWords.every(w => lower.includes(w))) {
      seen.add(nameKey); if (tickKey) seen.add(tickKey);
      targets.push(h);
    }
  }
  if (!targets.length) return { error: 'Couldn\'t match a holding — mention a ticker (VOO) or the fund\'s name as it appears in the table.' };

  // Split ratio: "70/30", "70-30", "70% / 30%"; nothing → equal split.
  // Ratios normalize by their sum (7/3 works too). Matched on the
  // start-date-free body so "starting 7/1" never reads as a ratio.
  let weights = null;
  const ratio = tBody.match(/(\d+(?:\.\d+)?)\s*%?\s*[/\-]\s*(\d+(?:\.\d+)?)\s*%?(?:\s*[/\-]\s*(\d+(?:\.\d+)?)\s*%?)?/);
  if (ratio) {
    weights = [ratio[1], ratio[2], ratio[3]].filter(Boolean).map(Number);
  }
  if (weights && weights.length !== targets.length) {
    return { error: `Found ${targets.length} holding${targets.length === 1 ? '' : 's'} but a ${weights.length}-way split — they need to match.` };
  }
  if (!weights) weights = targets.map(() => 1);
  const wSum = weights.reduce((s, w) => s + w, 0);
  if (!(wSum > 0)) return { error: 'Split ratio didn\'t add up — try "70/30".' };

  // Anchor date: "starting <parseable date>", else today
  let anchorDate = new Date().toISOString().slice(0, 10);
  if (startMatch) {
    const parsed = new Date(startMatch[1].trim());
    if (!isNaN(parsed.getTime())) anchorDate = parsed.toISOString().slice(0, 10);
  }

  const rules = targets.map((h, i) => ({
    holdingId: h.id,
    holdingName: h.name,
    account: h.account || 'Unassigned',
    amount: +(amount * weights[i] / wSum).toFixed(2),
  }));
  const summary = rules
    .map(r => `${fmt$(r.amount)} → ${(r.holdingName || '').slice(0, 36)} (${r.account})`)
    .join(' · ') + ` — ${CADENCE_LABELS[cadence]}, starting ${anchorDate}`;
  return { rules, cadence, anchorDate, summary };
}

let nlParsePreview = null; // holds the parsed-but-unconfirmed result

function parseNlContribution() {
  const input = document.getElementById('crNlText');
  const out = document.getElementById('crNlPreview');
  const result = parseContributionText(input.value, holdings);
  if (result.error) {
    nlParsePreview = null;
    out.innerHTML = `<span style="color:var(--danger,#dc2626);font-size:13px;">${esc(result.error)}</span>`;
    return;
  }
  nlParsePreview = result;
  out.innerHTML = `<span style="font-size:13px;">Got it: <strong>${esc(result.summary)}</strong></span>
    <button class="btn btn-primary btn-sm" onclick="confirmNlContribution()" style="margin-left:8px;">Confirm</button>
    <button class="btn btn-ghost btn-sm" onclick="cancelNlContribution()">Cancel</button>`;
}

function confirmNlContribution() {
  if (!nlParsePreview) return;
  const { rules, cadence, anchorDate } = nlParsePreview;
  for (const r of rules) {
    contributionRules.push({
      id: uid(), holdingId: r.holdingId, holdingName: r.holdingName,
      amount: r.amount, cadence, anchorDate, lastAppliedThrough: null,
    });
  }
  nlParsePreview = null;
  const el = document.getElementById('crNlText');
  if (el) el.value = '';
  const appliedNow = applyContributionRules();
  if (appliedNow === 0) markUnsaved();
  render();
  toast(`Added ${rules.length} rule${rules.length === 1 ? '' : 's'} from text`);
}

function cancelNlContribution() {
  nlParsePreview = null;
  const out = document.getElementById('crNlPreview');
  if (out) out.innerHTML = '';
}

function ruleNextDate(rule) {
  // Probe one year ahead for the next due date after today
  const probe = new Date();
  probe.setUTCFullYear(probe.getUTCFullYear() + 1);
  const upcoming = nextPayDates(
    { ...rule, lastAppliedThrough: rule.lastAppliedThrough || null },
    probe.toISOString().slice(0, 10),
  ).filter(d => d > new Date().toISOString().slice(0, 10));
  return upcoming[0] || '—';
}

function renderContributions() {
  const card = document.getElementById('contribCard');
  if (!card) return;
  card.style.display = holdings.length > 0 ? '' : 'none';
  if (holdings.length === 0) return;

  const list = document.getElementById('contribList');
  if (contributionRules.length === 0) {
    list.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);margin:6px 0 10px;">No rules yet. Add one to auto-accrue payroll contributions (e.g. 401K) between statements.</p>';
  } else {
    list.innerHTML = contributionRules.map(r => {
      const orphan = !holdings.some(h => h.id === r.holdingId || h.name === r.holdingName);
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border,#eee);">
        <div style="min-width:0;">
          <div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.holdingName)}</div>
          <div style="font-size:12px;color:var(--text-secondary);">
            ${fmt$(r.amount)} ${esc(CADENCE_LABELS[r.cadence] || r.cadence)} · next ${esc(ruleNextDate(r))}
            ${orphan ? ' · <span style="color:var(--danger,#dc2626);">holding missing — rule inactive</span>' : ''}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="deleteContributionRule('${r.id}')" title="Delete rule">✕</button>
      </div>`;
    }).join('');
  }

  const opts = holdings
    .map(h => `<option value="${h.id}">${esc(h.name.slice(0, 60))}${h.account ? ` (${esc(h.account)})` : ''}</option>`)
    .join('');
  document.getElementById('contribForm').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:10px;">
      <div style="flex:2;min-width:220px;"><label style="font-size:12px;">Holding</label><select id="crHolding">${opts}</select></div>
      <div style="flex:1;min-width:90px;"><label style="font-size:12px;">$ per period</label><input id="crAmount" type="number" min="0" step="any" placeholder="500"></div>
      <div style="flex:1;min-width:120px;"><label style="font-size:12px;">Cadence</label><select id="crCadence">
        <option value="biweekly">Every 2 weeks</option><option value="semimonthly">1st &amp; 15th</option><option value="monthly">Monthly</option>
      </select></div>
      <div style="flex:1;min-width:140px;"><label style="font-size:12px;">First pay date</label><input id="crAnchor" type="date"></div>
      <button class="btn btn-primary btn-sm" onclick="addContributionRule()" style="height:34px;">+ Add rule</button>
    </div>`;
}

function render() {
  document.getElementById('totalValue').textContent = fmt$(total());

  const el = document.getElementById('lastSavedLabel');
  if (lastSaved) {
    const d = new Date(lastSaved);
    el.textContent = `Last saved: ${d.toLocaleDateString()} ${d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}` +
      (unsaved ? ' · unsaved changes' : '');
  } else {
    el.textContent = unsaved ? 'Saving…' : '';
  }

  renderAccountTiles();
  renderAttentionStrip();
  renderLastLookChip();
  renderRiskCard();
  renderTable();
  renderChart();
  renderContributions();
  renderDividends();
  renderFireDefaults();

  const hasHoldings = holdings.length > 0;
  document.getElementById('allocStratCard').style.display = hasHoldings ? '' : 'none';
  document.getElementById('advisorCard').style.display    = hasHoldings ? '' : 'none';
  document.getElementById('askCard').style.display        = hasHoldings ? '' : 'none';
  renderAskState();
  if (hasHoldings) {
    renderGapTable();
    updateAdvisorAccounts();
    renderAdvisorContext();
  }
  renderPerformanceChart();
}

function typeOptions(selected) {
  return Object.entries(TYPE_CONFIG).map(([val, cfg]) =>
    `<option value="${val}" ${val === selected ? 'selected' : ''}>${cfg.label}</option>`
  ).join('');
}

function renderTable() {
  const tot   = total();
  const tbody = document.getElementById('tableBody');
  const tfoot = document.getElementById('tableFoot');

  if (!holdings.length) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state"><p>No holdings yet — add one above or import a CSV.</p></div>
    </td></tr>`;
    tfoot.innerHTML = '';
    return;
  }

  // Group by account
  const groups = {};
  for (const h of holdings) {
    const acct = h.account || 'Unassigned';
    if (!groups[acct]) groups[acct] = [];
    groups[acct].push(h);
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

  let html = '';

  acctOrder.forEach((acct, acctIdx) => {
    const acctHoldings = [...groups[acct]].sort((a,b) => (b.quantity*b.price) - (a.quantity*a.price));
    const acctTotal    = acctHoldings.reduce((s,h) => s + h.quantity*h.price, 0);
    const acctPct      = tot > 0 ? (acctTotal / tot * 100).toFixed(1) : '0.0';
    const acctColor    = ACCT_COLORS[acctIdx % ACCT_COLORS.length];

    // Account header row
    html += `<tr class="acct-header">
      <td colspan="7">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;color:${acctColor};">${esc(acct)}</span>
          <span style="font-size:13px;color:var(--text-secondary);font-feature-settings:'cv01','tnum';">${fmt$(acctTotal)} &nbsp;·&nbsp; ${acctPct}%</span>
        </div>
      </td>
    </tr>`;

    for (const h of acctHoldings) {
      const val    = h.quantity * h.price;
      const pct    = tot > 0 ? (val / tot) * 100 : 0;
      const color  = colorMap[h.id];
      const upd    = h.updated ? new Date(h.updated).toLocaleDateString() : '—';
      const isMF   = h.type === 'mutual_fund';
      const sleeve = getSleeve(h);
      const slvCfg = SLEEVE_CONFIG[sleeve];
      const fetchKey = (h.ticker || h.name).toUpperCase();

      // Subtitle: ticker + updated (omit account — shown in header)
      const subParts = [];
      if (h.ticker && h.ticker.toUpperCase() !== h.name.toUpperCase() && h.ticker !== 'N/A') subParts.push(h.ticker.toUpperCase());
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
      const staleTag = proxyEntry
        ? (calDays !== null && calDays > PROXY_RECAL_NUDGE_DAYS ? ` <span class="stale-badge">⚠ recalibrate — ${calDays}d since real NAV</span>` : '')
        : (daysOld !== null && daysOld > 7 ? ` <span class="stale-badge">⚠ ${daysOld}d old</span>` : '');

      if (editingId === h.id) {
        html += `<tr>
          <td colspan="2">
            <div style="display:flex;flex-direction:column;gap:5px;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
                <input id="en-${h.id}" type="text" value="${esc(h.name)}" placeholder="Name">
                <input id="etick-${h.id}" type="text" value="${esc(h.ticker||'')}" placeholder="Ticker (optional)">
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;">
                <select id="et-${h.id}">${typeOptions(h.type)}</select>
                <select id="eacc-${h.id}">${accountOptions(h.account||'')}</select>
                <select id="eslv-${h.id}" title="Sleeve">${sleeveOptions(h.sleeve||'')}</select>
              </div>
            </div>
          </td>
          <td class="num"><input id="eq-${h.id}" type="number" step="any" value="${h.quantity}" style="width:90px;text-align:right;"></td>
          <td class="num"><input id="ep-${h.id}" type="number" step="any" value="${h.price}" style="width:90px;text-align:right;"></td>
          <td class="num" colspan="2"></td>
          <td class="num"><div class="actions">
            <button class="btn btn-primary btn-sm" onclick="saveEdit('${h.id}')">Save</button>
            <button class="btn btn-ghost btn-sm" onclick="cancelEdit()">Cancel</button>
          </div></td>
        </tr>`;
        continue;
      }

      html += `<tr>
        <td>
          <div class="ticker-name">
            ${esc(h.name)}
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${slvCfg.color};margin-left:6px;vertical-align:middle;" title="${slvCfg.label}"></span>
          </div>
          <div class="ticker-sub">${esc(subtitle)}${staleTag}</div>
        </td>
        <td data-label="Type">${typeBadge(h.type)}</td>
        <td class="num" data-label="Shares">${fmtN(h.quantity)}</td>
        <td class="num" data-label="Price" style="cursor:pointer;" onclick="startQuickPrice('${h.id}')" title="Click to edit price">
          ${quickPriceId === h.id
            ? `<input id="qp-${h.id}" type="number" step="any" value="${h.price}" style="width:85px;text-align:right;" onkeydown="if(event.key==='Enter')saveQuickPrice('${h.id}');if(event.key==='Escape')cancelQuickPrice();" onblur="saveQuickPrice('${h.id}')">`
            : fmt$(h.price)}
        </td>
        <td class="num" data-label="Value">${fmt$(val)}</td>
        <td>
          <div class="bar-wrap">
            <div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>
            <span style="font-size:13px;color:var(--text-secondary);min-width:42px;text-align:right;">${pct.toFixed(1)}%</span>
          </div>
        </td>
        <td class="num"><div class="actions">
          <button class="btn btn-ghost btn-sm" title="Fetch ${isMF ? 'NAV' : 'price'} for ${fetchKey}" onclick="refreshHoldingPrice('${h.id}')">↻</button>
          <button class="btn btn-ghost btn-sm" onclick="startEdit('${h.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" title="Split into two sleeve allocations" onclick="startSplit('${h.id}')">Split</button>
          <button class="btn btn-danger btn-sm" onclick="deleteHolding('${h.id}')">✕</button>
        </div></td>
      </tr>
      ${splittingId === h.id ? `<tr>
        <td colspan="7" style="background:var(--navy-muted);border-top:none;padding:12px 16px;">
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div style="font-size:14px;font-weight:600;color:var(--navy-text);">✂ Split "${esc(h.name)}" (${fmtN(h.quantity)} total units)</div>
            <div style="display:grid;grid-template-columns:90px 1fr 130px;gap:8px;align-items:center;">
              <div style="display:flex;align-items:center;gap:4px;">
                <input id="sp-pct-${h.id}" type="number" min="1" max="99" step="0.1" value="72"
                  style="width:58px;text-align:right;"
                  oninput="updateSplitPreview('${h.id}',${h.quantity})"> %
              </div>
              <select id="sp-slv1-${h.id}">${sleeveOptions('us_stock')}</select>
              <span id="sp-qty1-${h.id}" style="font-size:13px;color:var(--text-secondary);">${fmtN(h.quantity * 0.72)} units</span>
            </div>
            <div style="display:grid;grid-template-columns:90px 1fr 130px;gap:8px;align-items:center;">
              <div style="color:var(--text-secondary);font-size:14px;padding-left:4px;"><span id="sp-pct2-${h.id}">28%</span></div>
              <select id="sp-slv2-${h.id}">${sleeveOptions('intl_stock')}</select>
              <span id="sp-qty2-${h.id}" style="font-size:13px;color:var(--text-secondary);">${fmtN(h.quantity * 0.28)} units</span>
            </div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-primary btn-sm" onclick="confirmSplit('${h.id}')">✓ Confirm Split</button>
              <button class="btn btn-ghost btn-sm" onclick="cancelSplit()">Cancel</button>
            </div>
          </div>
        </td>
      </tr>` : ''}`;
    }
  });

  tbody.innerHTML = html;

  if (quickPriceId) {
    const inp = document.getElementById(`qp-${quickPriceId}`);
    if (inp) { inp.focus(); inp.select(); }
  }
  if (splittingId) {
    const inp = document.getElementById(`sp-pct-${splittingId}`);
    if (inp) { inp.focus(); inp.select(); }
  }

  tfoot.innerHTML = `<tr>
    <td>Total</td><td></td><td class="num">—</td><td class="num">—</td>
    <td class="num">${fmt$(tot)}</td>
    <td>100%</td><td></td>
  </tr>`;
}

// ─── Render: Chart ────────────────────────────────────────────────────────────
function setChartView(view) {
  chartView = view;
  document.querySelectorAll('.chart-toggle .toggle-btn').forEach((btn, i) => {
    btn.classList.toggle('active', ['sleeve','ticker','account'][i] === view);
  });
  renderChart();
}

function chartGroups() {
  if (chartView === 'sleeve') {
    return ['us_stock','intl_stock','tilt','bond','other'].map(s => ({
      label: SLEEVE_CONFIG[s].label,
      value: holdings.reduce((sum, h) => sum + (getSleeve(h) === s ? h.quantity * h.price : 0), 0),
      color: SLEEVE_CONFIG[s].color,
    })).filter(g => g.value > 0);
  }
  const map = new Map();
  holdings.forEach(h => {
    const key   = chartView === 'account'
      ? (h.account || 'Unknown')
      : ((h.ticker && h.ticker !== 'N/A') ? h.ticker : h.name);
    const val   = h.quantity * h.price;
    if (map.has(key)) map.get(key).value += val;
    else map.set(key, { label: key, value: val });
  });
  const palette = chartView === 'account' ? ACCT_COLORS : PALETTE;
  return [...map.values()]
    .sort((a, b) => b.value - a.value)
    .map((g, i) => ({ ...g, color: palette[i % palette.length] }));
}

function renderChart() {
  const tot    = total();
  const groups = chartGroups();

  document.getElementById('legend').innerHTML = groups.length === 0
    ? '<li style="color:var(--text-muted);font-size:14px;">No holdings yet</li>'
    : groups.map(g => {
        const pct = tot > 0 ? (g.value / tot * 100).toFixed(1) : '0.0';
        return `<li>
          <span class="legend-dot" style="background:${g.color}"></span>
          <span class="legend-name" title="${esc(g.label)}">${esc(g.label)}</span>
          <span class="legend-pct">${pct}%</span>
        </li>`;
      }).join('');

  const canvas = document.getElementById('allocChart');
  if (chartInst) { chartInst.destroy(); chartInst = null; }
  if (!groups.length) { canvas.style.display = 'none'; return; }
  canvas.style.display = '';

  chartInst = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: groups.map(g => g.label),
      datasets: [{ data: groups.map(g => g.value), backgroundColor: groups.map(g => g.color), borderWidth: 2, borderColor: themeChartBorder(), hoverOffset: 6 }]
    },
    options: {
      cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => {
          const pct = tot > 0 ? (ctx.parsed / tot * 100).toFixed(1) : '0.0';
          return `  ${fmt$(ctx.parsed)}  (${pct}%)`;
        }}}
      }
    }
  });
}

// ─── Render: Target Inputs ────────────────────────────────────────────────────
function renderTargetInputs() {
  const tot = total();

  // Total mix inputs
  document.getElementById('targetInputsTot').innerHTML = [
    { key: 'stocks', label: 'Stocks', color: '#0d9488' },
    { key: 'bonds',  label: 'Bonds',  color: '#8b5cf6' },
    { key: 'other',  label: 'Other',  color: '#52525b' },
  ].map(row => {
    const dollarVal = tot * targets[row.key] / 100;
    return `
    <div class="target-row">
      <label>
        <span class="sleeve-dot" style="background:${row.color}"></span>
        ${row.label}
      </label>
      <input type="number" min="0" max="100" step="1" value="${targets[row.key]}"
             oninput="targets['${row.key}']=+this.value; saveLocal(); renderTargetInputs(); renderGapTable();">
      <span class="pct-label">%</span>
      <span class="target-dollar">${fmt$(dollarVal)}</span>
    </div>`;
  }).join('');

  // Within-stocks split inputs
  const stockVal = tot * targets.stocks / 100;
  document.getElementById('targetInputsStk').innerHTML = [
    { key: 'us',    label: 'US',            color: SLEEVE_CONFIG.us_stock.color },
    { key: 'intl',  label: 'International', color: SLEEVE_CONFIG.intl_stock.color },
    { key: 'tilts', label: 'Tilts',         color: SLEEVE_CONFIG.tilt.color },
  ].map(row => {
    const dollarVal = stockVal * targets[row.key] / 100;
    return `
    <div class="target-row">
      <label>
        <span class="sleeve-dot" style="background:${row.color}"></span>
        ${row.label}
      </label>
      <input type="number" min="0" max="100" step="1" value="${targets[row.key]}"
             oninput="targets['${row.key}']=+this.value; saveLocal(); renderTargetInputs(); renderGapTable();">
      <span class="pct-label">%</span>
      <span class="target-dollar">${fmt$(dollarVal)}</span>
    </div>`;
  }).join('');
}

// ─── Render: Gap Table ────────────────────────────────────────────────────────
function renderGapTable() {
  const tot      = total();
  const slvVals  = getSleeveTotals();
  const tgtPcts  = getSleeveTargetPcts();

  // Validate targets sum
  const allTotal = targets.stocks + targets.bonds + targets.other;
  const stkTotal = targets.us + targets.intl + targets.tilts;
  const warnings = [];
  if (Math.abs(allTotal - 100) > 0.5) warnings.push(`Stocks + Bonds + Other = ${allTotal}% (should be 100%)`);
  if (Math.abs(stkTotal - 100) > 0.5) warnings.push(`US + Intl + Tilts = ${stkTotal}% (should be 100%)`);
  const warnEl = document.getElementById('targetWarning');
  warnEl.textContent = warnings.length ? '⚠ ' + warnings.join(' · ') : '';

  document.getElementById('gapTableBody').innerHTML = Object.entries(SLEEVE_CONFIG).map(([sleeve, cfg]) => {
    const curVal = slvVals[sleeve] || 0;
    const curPct = tot > 0 ? curVal / tot * 100 : 0;
    const tgtPct = tgtPcts[sleeve] || 0;
    const gap    = curPct - tgtPct; // positive = overweight

    let gapCls, gapStr;
    if (Math.abs(gap) < 0.5) {
      gapCls = 'gap-ok'; gapStr = '✓';
    } else if (gap < 0) {
      gapCls = 'gap-under';
      const shortAmt = Math.abs(gap / 100 * tot);
      gapStr = `${gap.toFixed(1)}% (${fmt$(shortAmt)} short)`;
    } else {
      gapCls = 'gap-over';
      const overAmt = Math.abs(gap / 100 * tot);
      gapStr = `+${gap.toFixed(1)}% (${fmt$(overAmt)} over)`;
    }

    return `<tr>
      <td>
        <span class="sleeve-label">
          <span class="sleeve-dot" style="background:${cfg.color}"></span>
          ${cfg.label}
        </span>
      </td>
      <td class="r">${tgtPct.toFixed(1)}%</td>
      <td class="r">${curPct.toFixed(1)}%</td>
      <td class="r">${fmt$(curVal)}</td>
      <td class="r ${gapCls}">${gapStr}</td>
    </tr>`;
  }).join('');
}

// ─── Advisor: market context ─────────────────────────────────────────────────
// External data in, decision out — the card reports what moved and where the
// portfolio stands against its own policy. It never says buy or sell, and it
// never reads a market level as a signal: "VOO is 2% off its high" is a fact,
// "therefore buy" is not one this app is entitled to make.
//
// The macro row is the CBOE 10-year Treasury yield index. It is quoted in
// percent, not dollars, so its moves are shown in basis points — a "−3.2%"
// on a yield would read as a price move and mean nothing.
const MACRO_TICKER = '^TNX';
const MACRO_LABEL  = '10-yr Treasury';

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

// The instruments actually worth watching: every distinct real ticker held,
// plus the macro row. Sorted by position size so the biggest bet reads first.
function marketWatchlist(holdingsArr = holdings) {
  const byTicker = new Map();
  for (const h of holdingsArr) {
    if (!hasRealTicker(h)) continue;
    const t = h.ticker.toUpperCase();
    byTicker.set(t, (byTicker.get(t) || 0) + h.quantity * h.price);
  }
  return [...byTicker.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([ticker, value]) => ({ ticker, value, macro: false }));
}

let marketData = null;      // { rows: [{ticker, label, macro, snap}], fetched }
let marketBusy = false;

async function refreshMarket() {
  if (marketBusy) return;
  marketBusy = true;
  const btn = document.getElementById('btnMarketRefresh');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Fetching…'; }

  const targetsList = [
    ...marketWatchlist(),
    { ticker: MACRO_TICKER, label: MACRO_LABEL, macro: true, value: 0 },
  ];
  const rows = [];
  for (const item of targetsList) {
    const chart = await fetchYahooChart(item.ticker, '1y');
    const snap = chart ? marketSnapshot(chart.timestamps, chart.adjcloses) : null;
    rows.push({ ...item, label: item.label || item.ticker, snap });
  }
  marketData = { rows, fetched: new Date().toISOString() };

  marketBusy = false;
  if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh market'; }
  renderAdvisorContext();
  const ok = rows.filter(r => r.snap).length;
  toast(ok === rows.length
    ? `Market updated — ${ok} instruments`
    : `Market updated — ${ok} of ${rows.length} (some feeds unavailable)`);
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

// ─── Advisor: attribution ────────────────────────────────────────────────────
// "What moved my money" — the decomposition the header cannot give you. A
// change in total value is two different things wearing one number: money you
// PUT IN, and money the market gave or took. Splitting them is the difference
// between "I'm up $16K" and "I'm up $16K, of which $15K was my own paycheck".
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
const ATTRIB_WINDOWS = [
  { key: '1w',  label: '1 week',   days: 7 },
  { key: '1m',  label: '1 month',  days: 30 },
  { key: '3m',  label: '3 months', days: 91 },
  { key: 'ytd', label: 'YTD',      days: null },
];

// Windows are anchored in New York, not UTC. On UTC the evening of 31 December
// already belongs to the next year, so a YTD run after ~7pm ET resolved to
// 2027-01-01, `closeAtOrBefore` returned the latest close, and the card
// cheerfully reported that the portfolio had moved $0.00.
function nyToday(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now));
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
// flat across a year while paying 3.9% to cash; on the adjusted ratio that
// reads as "+2.3% price, +$536 market" against a truth of zero.
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

let attribData = null;    // { win, sinceDate, result, fetched }
let attribBusy = false;

async function runAttribution(winKey) {
  if (attribBusy) return;
  attribBusy = true;
  const win = ATTRIB_WINDOWS.find(w => w.key === winKey) || ATTRIB_WINDOWS[1];
  const btn = document.getElementById('btnAttrib');
  if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }

  // One chart per distinct symbol: real tickers plus the proxies that price
  // the 401K CITs. The pension needs no fetch — its stamps are already local.
  const symbols = new Set();
  for (const h of holdings) {
    const t = (h.ticker || '').toUpperCase();
    if (t && t !== 'N/A') { symbols.add(t); continue; }
    const key = Object.keys(PROXY_TRACKED_FUNDS).find(k => (h.name || '').includes(k));
    if (key) symbols.add(PROXY_TRACKED_FUNDS[key].proxy);
  }
  const charts = {};
  for (const s of symbols) {
    const c = await fetchYahooChart(s, '1y');
    if (c) charts[s] = c;
  }
  const sinceDate = windowStartDate(win);
  attribData = { win, sinceDate, result: attribution(holdings, charts, sinceDate), fetched: new Date().toISOString() };

  attribBusy = false;
  if (btn) { btn.disabled = false; btn.textContent = '↻ Recompute'; }
  renderAdvisorContext();
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

function marketMoveCell(label, d, macro) {
  if (!d) return `<span class="mkt-move mkt-na">${label} —</span>`;
  const shown = macro ? fmtSignedBp(d.abs) : fmtSignedPct(d.pct);
  const cls = macro ? moveClass(d.abs * 100, 0) : moveClass(d.pct);
  return `<span class="mkt-move ${cls}">${label} ${shown}</span>`;
}

function renderMarketSection() {
  if (!marketData) {
    return `<p class="adv-placeholder mkt-empty">Pull current prices, 30-day and YTD moves, and the
      10-year Treasury yield for the instruments you actually hold.</p>`;
  }
  const rows = marketData.rows.map(r => {
    if (!r.snap) {
      return `<div class="mkt-row"><span class="mkt-tick">${esc(r.label)}</span>
        <span class="mkt-na">feed unavailable</span></div>`;
    }
    const s = r.snap;
    const level = r.macro ? `${s.last.toFixed(3)}%` : fmt$(s.last);
    // "Off high" is a drawdown fact about price. On a yield it would invert
    // its own meaning (a high yield is a low price), so it is omitted there.
    const offHigh = r.macro ? '' :
      `<span class="mkt-off">${s.offHighPct <= -0.05
        ? `${Math.abs(s.offHighPct).toFixed(1)}% off high` : 'at 52w high'}</span>`;
    return `<div class="mkt-row">
      <span class="mkt-tick">${esc(r.label)}</span>
      <span class="mkt-last">${level}</span>
      ${marketMoveCell('1d', s.d1, r.macro)}
      ${marketMoveCell('30d', s.d30, r.macro)}
      ${marketMoveCell('YTD', s.ytd, r.macro)}
      ${offHigh}
    </div>`;
  }).join('');
  const asOf = marketData.rows.find(r => r.snap)?.snap.asOfDate;
  return rows + `<p class="risk-note">Last close ${esc(asOf || '—')} · Yahoo Finance.
    Levels and moves only — no view on what they mean.</p>`;
}

function renderDriftSection() {
  const tot = total();
  const bandAbs = +targets.bandAbsPp || 5;
  const bandRel = +targets.bandRelPct || 25;
  const d = driftCheck(getSleeveTotals(), getSleeveTargetPcts(), tot, bandAbs, bandRel);
  if (!d.rows.length) return '';

  const monthlyIn = monthlyContribution();
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
      parts.push(months === null
        ? `${fmt$(shortfall)} short in ${names} — no standing contributions to close it with.`
        : months <= 24
          ? `${fmt$(shortfall)} short in ${names} — about ${Math.ceil(months)} months of contributions at ${fmt$(monthlyIn)}/mo.`
          : `${fmt$(shortfall)} short in ${names} — roughly ${(months / 12).toFixed(1)} years at ${fmt$(monthlyIn)}/mo, so buying alone will not close it.`);
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
          ${fmtSigned$(d.worst.driftDollars)})` : ''}.</p>`;
  }

  const rows = d.rows.map(r => `<div class="drift-row ${r.outOfBand ? 'drift-row-breach' : ''}">
    <span>${esc(r.label)}</span>
    <span class="num">${r.curPct.toFixed(1)}%<span class="drift-sub">now</span></span>
    <span class="num">${r.tgtPct.toFixed(1)}%<span class="drift-sub">target</span></span>
    <span class="num ${moveClass(r.driftPp, 1)}">${fmtSignedPp(r.driftPp)}
      <span class="drift-sub">${fmtSigned$(r.driftDollars)}${
        r.reason ? ` · ${r.reason} band` : ''}</span></span>
  </div>`).join('');

  return head + `<div class="drift-rows">${rows}</div>
    <p class="risk-note">Act when a sleeve is off by
      <input class="band-input" id="bandAbs" type="number" min="0" max="50" step="0.5" value="${bandAbs}"
        onchange="targets.bandAbsPp=+this.value;markUnsaved();renderAdvisorContext()"> pp
      or <input class="band-input" id="bandRel" type="number" min="0" max="100" step="5" value="${bandRel}"
        onchange="targets.bandRelPct=+this.value;markUnsaved();renderAdvisorContext()">% of its own
      target weight (the 5/25 rule). Your policy, your numbers — this only reports against it.</p>`;
}

function renderLocationSection() {
  const { rows, swap, rates } = assetLocationSwap();
  const pct = n => `${(n * 100).toFixed(1)}%`;
  const rateInputs = `<p class="risk-note">Your rates:
    marginal <input class="band-input" id="taxMarg" type="number" min="0" max="60" step="1"
      value="${targets.taxMarginal ?? DEFAULT_TAX_MARGINAL}"
      onchange="targets.taxMarginal=+this.value;markUnsaved();renderAdvisorContext()">%
    · long-term gains <input class="band-input" id="taxLt" type="number" min="0" max="40" step="1"
      value="${targets.taxLtcg ?? DEFAULT_TAX_LTCG}"
      onchange="targets.taxLtcg=+this.value;markUnsaved();renderAdvisorContext()">%
    · state + local <input class="band-input" id="taxLocal" type="number" min="0" max="20" step="0.5"
      value="${targets.taxStateLocal ?? 0}"
      onchange="targets.taxStateLocal=+this.value;markUnsaved();renderAdvisorContext()">%
    · <label class="band-check"><input type="checkbox" id="taxNiit" ${targets.taxNiit ? 'checked' : ''}
      onchange="targets.taxNiit=this.checked;markUnsaved();renderAdvisorContext()"> NIIT 3.8%</label>
    ${!(+targets.taxStateLocal > 0) ? '<span class="loc-hint">— state + local is 0, so these are federal-only figures.</span>' : ''}
  </p>`;

  if (!rows.length) {
    return `<p class="adv-placeholder loc-empty">Run “Update dividends” first — location math needs a
      yield per holding.</p>` + rateInputs;
  }

  const LOC_LABEL = { taxable: 'taxable', sheltered: 'sheltered', foreign: 'outside US tax' };
  const table = `<div class="loc-row loc-head-row">
      <span>Holding</span><span class="num">Yield</span>
      <span class="num">Cost/yr if taxable</span><span class="num">Tax/yr today</span>
    </div>` + rows
    .slice().sort((a, b) => b.rate - a.rate)
    .map(r => `<div class="loc-row">
      <span>${esc(r.h.name.slice(0, 30))}<span class="drift-sub">${esc(r.h.account || '—')} ·
        ${LOC_LABEL[r.loc]}</span></span>
      <span class="num">${pct(r.yield)}${r.estimated ? '<span class="drift-sub">est.</span>' : ''}</span>
      <span class="num">${pct(r.rate)}<span class="drift-sub">${r.kind}</span></span>
      <span class="num ${r.loc === 'taxable' ? 'mkt-down' : ''}">${
        r.loc === 'taxable' ? fmt$(r.rate * r.value) : '—'}</span>
    </div>`).join('');
  const foreignCount = rows.filter(r => r.loc === 'foreign').length;
  const foreignNote = foreignCount
    ? `<p class="risk-note">${foreignCount} holding${foreignCount === 1 ? '' : 's'} sit outside US
       tax entirely (Swedish pension). Shown for completeness, never proposed as one side of a
       swap — the rates above do not apply to them, and it is not an account you trade in.</p>`
    : '';

  let verdict;
  if (rates.ordinary <= 0 && rates.qualified <= 0) {
    // With every rate at zero there is no drag to compare, so "nothing to gain"
    // would be an artefact of the inputs rather than a finding.
    verdict = `<p class="loc-head loc-swap">Set your tax rates below — at 0% there is no drag to
      compare, so this section cannot tell you anything yet.</p>`;
  } else if (!swap) {
    verdict = `<p class="loc-head drift-ok">✓ Nothing to gain by relocating — the assets that
      cost the most to hold in a taxable account are already sheltered.</p>`;
  } else {
    const s = swap;
    verdict = `<p class="loc-head loc-swap">⇄ Relocating ${fmt$(s.amount)} would save about
      <strong>${fmt$(s.annualSaving)}/year</strong> at your rates, with your allocation unchanged.${
      s.estimated ? ' One side uses an estimated yield (accumulating fund).' : ''}</p>
      <div class="loc-plan">
        <p class="risk-line">1 — Sell ${fmt$(s.amount)} of <strong>${esc(s.into.h.name.slice(0, 30))}</strong>
          in ${esc(s.into.h.account || '—')} <span class="drift-sub">costs ${fmt$(s.currentCost)}/yr in tax where it sits</span></p>
        <p class="risk-line">2 — Inside ${esc(s.out.h.account || '—')}, move ${fmt$(s.amount)} out of
          <strong>${esc(s.out.h.name.slice(0, 30))}</strong> into
          <strong>${esc(SLEEVE_CONFIG[getSleeve(s.into.h)]?.label || 'the same sleeve')}</strong>
          <span class="drift-sub">not a taxable event — it happens inside the account</span></p>
        <p class="risk-line">3 — With the step-1 proceeds, buy ${fmt$(s.amount)} of
          <strong>${esc(SLEEVE_CONFIG[getSleeve(s.out.h)]?.label || 'that sleeve')}</strong>
          in ${esc(s.into.h.account || '—')}</p>
        <p class="risk-note">Steps 2 and 3 cancel out at the portfolio level — every sleeve ends at
          exactly the weight it has now. Step 1 is a taxable sale, so check the gain before acting;
          steps inside a sheltered account are not taxable events. Advisory math only.</p>
      </div>`;
  }
  return verdict + `<div class="loc-rows">${table}</div>` + foreignNote + rateInputs;
}

function renderAttributionSection() {
  const picker = ATTRIB_WINDOWS.map(w =>
    `<button class="btn btn-ghost btn-sm ${attribData?.win.key === w.key ? 'attrib-on' : ''}"
       onclick="runAttribution('${w.key}')">${w.label}</button>`).join('');
  const controls = `<div class="attrib-picker">${picker}</div>`;

  if (!attribData) {
    return controls + `<p class="adv-placeholder attrib-empty">Pick a window to split the change in
      your portfolio into what you paid in and what the market did — then see which holdings
      actually drove it.</p>`;
  }
  const r = attribData.result;
  if (!r.rows.length) {
    return controls + `<p class="adv-placeholder">No holding had an establishable starting price
      for that window.</p>`;
  }

  const head = `<p class="attrib-head">Since ${esc(attribData.sinceDate)} your portfolio moved
    <strong class="${moveClass(r.totalChange, 0)}">${fmtSigned$(r.totalChange)}</strong> —
    <strong>${fmtSigned$(r.contributed)}</strong> of that you paid in,
    <strong class="${moveClass(r.marketGain, 0)}">${fmtSigned$(r.marketGain)}</strong> the market
    ${r.marketGain >= 0 ? 'gave' : 'took'}.</p>`;

  const rows = r.rows.map(row => {
    const share = r.grossMove > 0 ? Math.abs(row.marketGain) / r.grossMove * 100 : 0;
    return `<div class="attrib-row">
      <span>${esc(row.h.name.slice(0, 28))}<span class="drift-sub">${esc(row.h.account || '—')}</span></span>
      <span class="num ${moveClass(row.pricePct ?? 0)}">${row.pricePct == null ? '—' : fmtSignedPct(row.pricePct, 1)}
        <span class="drift-sub">${row.basis}</span></span>
      <span class="num ${moveClass(row.marketGain, 0)}">${fmtSigned$(row.marketGain)}
        <span class="drift-sub">market</span></span>
      <span class="num">${row.contributed ? fmtSigned$(row.contributed) : '—'}
        <span class="drift-sub">paid in</span></span>
      <span class="attrib-bar"><i style="width:${Math.min(100, share).toFixed(1)}%"
        class="${row.marketGain >= 0 ? 'bar-up' : 'bar-down'}"></i></span>
    </div>`;
  }).join('');

  const skipped = r.skipped.length
    ? `<p class="risk-note">${r.skipped.length} holding${r.skipped.length === 1 ? '' : 's'}
       (${esc(r.skipped.map(s => s.h.name.slice(0, 22) + (s.reason ? ` — ${s.reason}` : '')).join(', '))})
       could not be attributed for ${esc(attribData.sinceDate)} and are left out entirely rather than
       counted as zero — the totals above cover ${fmt$(r.nowValue)} of the portfolio, not all of it.</p>`
    : '';

  return controls + head + `<div class="attrib-rows">${rows}</div>` + skipped +
    `<p class="risk-note">Market = value change with your own contributions stripped out, per
     holding. Holdings with a ticker are priced off RAW closes, so a dividend never reads as a
     price gain; the 401K funds and the Swedish pension are on TOTAL RETURN, because their
     distributions compound inside the NAV — the per-row label says which. Reinvested dividends
     land in market, where income belongs. Bars show each holding's share of the total movement.
     <strong>Three things this cannot see:</strong> a holding added by hand writes no ledger entry,
     so its purchase reads as market gain; a reinvestment entered by hand is booked as an
     adjustment, so it reads as money paid in; and a holding you <em>delete</em> rather than zero
     out leaves nothing to iterate, so it vanishes from the window entirely. Facts about what happened — no view on what happens
     next.</p>`;
}

// Nothing in this card computes a verdict until it is asked to. Volunteering
// "relocate $23,432 and save $272/year" to someone who opened the app to check
// a balance is an opinion nobody requested — and the whole design brief was
// data in, David decides.
let advShow = { drift: true, location: false };
function advToggle(key) { advShow[key] = !advShow[key]; renderAdvisorContext(); }

function advSection(key, title, bodyFn, teaser) {
  const open = advShow[key];
  return `<div class="subsection-label subsection-flex">${title}
      <button class="btn btn-ghost btn-sm" onclick="advToggle('${key}')">${open ? 'Hide' : 'Show'}</button>
    </div>` + (open ? bodyFn() : `<p class="adv-placeholder adv-quiet">${teaser}</p>`);
}

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
let askBusy = false;
let askAbort = null;               // the in-flight question's AbortController
let askShowEarlier = false;
let askThread = loadAskThread();   // [{ q, a | error, ts }] (+ pending while in flight)
// Turns restored from an earlier visit start folded away: the page opens quiet,
// not with last week's answers sitting above the holdings.
let askRestored = askThread.length;

// Dollar amounts named in a question ("where would my next $5,000 go?"), so
// the brief can carry the rebalance engine's own plan for exactly that sum
// instead of leaving the model to redo the pro-rata maths. A number counts
// only when something marks it as money — a $, a k/m suffix, the word
// "dollars" — or it is a bare figure of 1,000+ that is not a year. "401k",
// "S&P 500", "5/25", "30%" and "2026" are all deliberately not amounts, and
// neither is a sum in another currency: "50,000 kr" is not fifty thousand dollars.
const ASK_MAX_AMOUNTS = 3;
function askAmounts(text) {
  const s = String(text || '');
  const re = /(\$\s*)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:(k|mm|m)\b|\s*(thousand|million|grand)\b)?(\s*(?:dollars|usd|bucks)\b)?/gi;
  const mult = { k: 1e3, m: 1e6, mm: 1e6, thousand: 1e3, million: 1e6, grand: 1e3 };
  const out = [];
  let m;
  while ((m = re.exec(s)) && out.length < ASK_MAX_AMOUNTS) {
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
    if (v >= 1 && v <= 1e9 && !out.includes(v)) out.push(v);
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
const ASK_LEDGER_ROWS = 60, ASK_SERIES_POINTS = 60, ASK_FX_STAMPS = 30, ASK_LOOKTHROUGH_ROWS = 10;

function askContext(question = '') {
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

  // ── performance ── whole-portfolio snapshots only; true returns only from
  // the ledger epoch, because before it nobody recorded what was paid in.
  let performance = null;
  if (snaps.length >= 2) {
    const first = snaps[0], last = snaps[snaps.length - 1];
    const post = snaps.filter(s => s.date >= LEDGER_EPOCH);
    const flowsIn = (from, to) => flows.filter(f => f.date > from && f.date <= to)
      .reduce((s, f) => s + f.amount, 0);
    const twr = computeTWR(post, flows);
    const mwr = spanDays(post) >= MWR_MIN_SPAN_DAYS ? computeMWR(post, flows) : null;
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
      const w = s0.date >= LEDGER_EPOCH ? computeTWR(snaps.filter(s => s.date >= s0.date), flows) : null;
      return { window: label, from: s0.date, to: last.date, valueChange: r2(last.value - s0.value),
        flowsIn: r2(F), changeExFlows: r2(last.value - s0.value - F), twrPct: w == null ? null : r2(w * 100),
        spyPricePct: spyPct(s0, last) };
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
    if (!policyWarm) notLoaded.push('Blended policy benchmark — it loads with the chart in the Performance card, and has not loaded this session');
    performance = {
      snapshots: { count: snaps.length, first: first.date, last: last.date },
      valueChangeSinceFirstSnapshot: { dollars: r2(last.value - first.value),
        pct: first.value > 0 ? r1((last.value / first.value - 1) * 100) : null, includesMoneyPaidIn: true },
      sinceLedgerEpoch: post.length >= 2 ? { from: post[0].date, twrPct: twr == null ? null : r2(twr * 100),
        mwrAnnualPct: mwr == null ? null : r1(mwr * 100),
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
  const fx = sek && sekHolding ? {
    fund: sek.name, from: sek.from, to: sek.to, fundInKronorPct: r2(sek.local * 100),
    kronaVsDollarPct: r2(sek.fx * 100), netUsdPct: r2(sek.net * 100),
    sekExposedValue: r2(held.filter(h => matchesAvanza(h) || (Array.isArray(h.fxHistory) && h.fxHistory.length))
      .reduce((s, h) => s + val(h), 0)),
    stamps: { columns: ['date', 'navSek', 'usdPerSek'],
      rows: sekHolding.fxHistory.slice(-ASK_FX_STAMPS).map(r => [r.date, r.nav, r.rate]) },
  } : null;

  // ── fire ── one run with the card's own defaults (the rounded figures its
  // inputs show), and only once a spending number has been saved.
  const ba = blendedAssumptions(holdings);
  const muPct = +(ba.mu * 100).toFixed(1), sigmaPct = +(ba.sigma * 100).toFixed(1);
  const spend = +targets.fireAnnualSpend > 0 ? +targets.fireAnnualSpend : null;
  const sim = spend ? simulateFire({ start: tot, monthlyContrib: monthlyContribFromRules(), annualSpend: spend,
    muAnnual: muPct / 100, sigmaAnnual: sigmaPct / 100, seed: 42 }) : null;
  const fire = {
    start: r2(tot), monthlyContribDefault: monthlyContribFromRules(), muRealPct: muPct, sigmaPct,
    swrPct: 4, annualSpend: spend,
    // Where muRealPct / sigmaPct come from — the app's own table, not a forecast.
    assumptions: {
      perSleeve: Object.fromEntries(Object.entries(SLEEVE_ASSUMPTIONS).map(([k, a]) =>
        [k, { realReturnPct: r2(a.mu * 100), volatilityPct: r2(a.sigma * 100) }])),
      basis: 'blended by CURRENT holding weights (not targets); volatility is a weighted average that ignores diversification; returns are real (after inflation)',
    },
    simulation: sim ? { fiTarget: sim.fiTarget, alreadyFI: sim.alreadyFI, medianYears: sim.medianYears,
      p10Years: sim.p10Years, p90Years: sim.p90Years, neverWithin50YearsPct: sim.neverPct,
      successByYears: sim.successByYears } : null,
  };
  if (!sim) {
    fire.note = 'No annual spending saved, so no simulation was run.';
    notLoaded.push("Annual spending for the FIRE estimate — enter it in the 'When does work become optional?' card");
  }

  // ── scenarios ── the rebalance engine's own plans, including one for each
  // dollar amount the question names.
  const plan = (amount, allowSells) => {
    const p = rebalancePlan(holdings, targets, amount, { allowSells });
    return p ? { amount: r2(amount), totalBefore: p.totalBefore, totalAfter: p.totalAfter,
      rows: p.rows.map(r => ({ sleeve: r.sleeve, label: r.label, action: r.action, amount: r.amount,
        suggestion: r.suggestion, note: r.note })), warnings: p.warnings } : null;
  };
  const scenarios = {
    fullRebalanceToTargets: plan(0, true),
    oneMonthOfContributions: monthlyIn > 0 ? plan(monthlyIn, false) : null,
    newMoney: askAmounts(question).map(a => plan(a, false)).filter(Boolean),
  };

  // ── session caches ── attached only if he already loaded them.
  const delta = x => x ? { abs: r2(x.abs), pct: r2(x.pct) } : null;
  const market = marketData ? {
    fetched: String(marketData.fetched).slice(0, 16),
    rows: marketData.rows.filter(r => r.snap).map(r => ({ ticker: r.ticker, label: r.label, macro: !!r.macro,
      last: r2(r.snap.last), asOfDate: r.snap.asOfDate, d1: delta(r.snap.d1), d30: delta(r.snap.d30),
      ytd: delta(r.snap.ytd), d365: delta(r.snap.d365), high52: r2(r.snap.high52),
      offHighPct: r1(r.snap.offHighPct) })),
  } : null;
  if (!market) notLoaded.push('Market moves — tap ↻ Refresh market in the Advisor card');
  const A = attribData?.result;
  const attributionOut = A ? {
    window: attribData.win.label, since: attribData.sinceDate,
    rows: A.rows.map(r => ({ holding: r.h.name, account: acctOf(r.h), startValue: r2(r.startValue),
      nowValue: r2(r.nowValue), paidIn: r2(r.contributed), marketGain: r2(r.marketGain),
      pricePct: r2(r.pricePct), basis: r.basis })),
    totals: { startValue: r2(A.startValue), nowValue: r2(A.nowValue), paidIn: r2(A.contributed),
      marketGain: r2(A.marketGain), totalChange: r2(A.totalChange) },
    notAttributable: A.skipped.map(x => ({ holding: x.h.name, reason: x.reason })),
  } : null;
  if (!attributionOut) notLoaded.push('What moved your money (attribution) — pick a window in the Advisor card');

  return {
    schema: 'portfolio-brief/1',
    nyDate: nyToday(now),
    freshness, policy,
    totals: { totalValue: r2(tot), holdings: held.length, accounts: accounts.length },
    accounts, holdings: holdingRows, drift, concentration, contributions, ledger, income,
    assetLocation, performance, sinceLastLook, fx, fire, scenarios, market, attribution: attributionOut,
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

// Example questions. Static strings on purpose: a chip built from live data
// ("Which prices are stale?") would itself be a verdict nobody asked for. Three
// show at a time, stepped through the pool by day so they hold still within one.
const ASK_CHIPS = [
  'How far am I from my targets?',
  'How much have I put in this year?',
  "What's my dividend income by account?",
  'How has my portfolio done since June?',
  'How much of my money rides on the krona?',
  'How fresh is my data?',
  'What would a 30% stock drop do to my mix?',
  'Where would my next $5,000 go?',
  "What's my biggest single-company exposure?",
  'Am I on pace for work-optional?',
  'Why does it matter which account holds my bonds?',
  'What do my 5/25 bands mean?',
];
function askChipsFor(date = new Date()) {
  const dayOfYear = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
  // A stride of four spreads the three across topics rather than neighbours.
  return [0, 4, 8].map(step => ASK_CHIPS[(dayOfYear + step) % ASK_CHIPS.length]);
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
  const chips = document.getElementById('askChips');
  const showChips = !askThread.length && !signedOut;
  chips.style.display = showChips ? '' : 'none';
  if (showChips && !chips.childElementCount) {
    chips.innerHTML = askChipsFor().map(c =>
      `<button type="button" class="ask-chip" onclick="submitAsk(this.textContent)">${esc(c)}</button>`).join('');
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
  // "sign in required" is the function's own 401, which is what a lapsed JWT gets.
  if (/^sign in required$|^request failed \(401\)$|jwt/i.test(msg))
    return 'Your cloud session has expired — sign in again with ☁.';
  if (e instanceof TypeError)
    return 'Could not reach your cloud function — check the connection and try again.';
  return 'Could not get an answer — ' + (msg || 'unknown error') + '.';
}

async function submitAsk(preset) {
  const input = document.getElementById('askInput');
  const fromChip = typeof preset === 'string';
  const q = (fromChip ? preset : input?.value || '').trim().slice(0, 2000);
  if (!q || askBusy) return;
  // Signed out is a state of the card, not a failed question: keep what was
  // typed, show the sign-in line, push nothing into the thread.
  if (!cloudReady()) { renderAskState(); return; }

  // Only completed turns go back to the model; an error bubble is not something it said.
  const history = askThread.filter(t => t.a && !t.error)
    .slice(-ASK_HISTORY_TURNS).map(t => ({ q: t.q, a: t.a }));
  const turn = { q, pending: true, ts: Date.now() };
  const ctl = askAbort = new AbortController();
  askBusy = true;
  askThread.push(turn);
  if (input && !fromChip) { input.value = ''; askAutoGrow(input); }
  // On a phone the keyboard would otherwise sit on top of the answer.
  if (input && window.matchMedia?.('(pointer: coarse)').matches) input.blur();
  renderAskThread();
  askScrollToLatest();

  let result;
  try {
    // 90s: deliberately outlives the function's own 85s upstream budget.
    const r = await proxyPost('/ask', { question: q, context: askContext(q), history }, 90000, ctl.signal);
    result = typeof r?.answer === 'string' && r.answer.trim()
      ? { a: r.answer } : { error: 'No answer came back. Try again.' };
  } catch (e) {
    result = { error: askErrorText(e) };
  }
  // Cleared while it was thinking: Clear already reset the card and a newer
  // question may be in flight, so this one has nothing left to touch.
  if (!askThread.includes(turn)) return;
  delete turn.pending;
  Object.assign(turn, result);
  askBusy = false;
  askAbort = null;
  // A failed question goes back in the box, unless he has started another.
  if (result.error && input && !input.value) { input.value = q; askAutoGrow(input); }
  saveAskThread();
  renderAskThread();
  askScrollToLatest();
}

function renderAdvisorContext() {
  const el = document.getElementById('advContext');
  if (!el) return;
  el.innerHTML =
    `${advSection('drift', 'Where you stand', renderDriftSection,
        'Compare each sleeve against your targets and rebalancing bands.')}
     <div class="subsection-label subsection-flex">Market
       <button class="btn btn-ghost btn-sm" id="btnMarketRefresh" onclick="refreshMarket()">↻ Refresh market</button>
     </div>${renderMarketSection()}
     <div class="subsection-label subsection-flex">What moved your money
       ${attribData ? `<button class="btn btn-ghost btn-sm" id="btnAttrib"
         onclick="runAttribution('${attribData.win.key}')">↻ Recompute</button>` : ''}
     </div>${renderAttributionSection()}
     ${advSection('location', 'Where your assets sit', renderLocationSection,
        'Work out what it costs to hold each sleeve where it currently sits.')}`;
}

// ─── Advisor: account dropdown ────────────────────────────────────────────────
function updateAdvisorAccounts() {
  const accts  = getUniqueAccounts();
  const select = document.getElementById('advAccount');
  const prev   = select.value;
  select.innerHTML = '<option value="">Any account</option>' +
    accts.map(a => `<option value="${esc(a)}" ${a === prev ? 'selected' : ''}>${esc(a)}</option>`).join('');
}

// ─── Advisor: tax tip ─────────────────────────────────────────────────────────
function accountTaxTip(account) {
  const a = (account || '').toLowerCase();
  if (/roth/i.test(a))
    return 'Roth IRA — tax-free growth forever. Best for highest-growth assets (tilts, stocks). Putting bonds here wastes the tax shelter.';
  if (/401|403b/i.test(a))
    return '401K/Traditional — tax-deferred; withdrawals taxed as ordinary income. Good for bonds, REITs, and high-yield assets you don\'t want taxed annually.';
  if (/espp/i.test(a))
    return 'ESPP/Taxable — employer stock creates concentration risk. Consider diversifying proceeds into your target sleeves after the holding period.';
  if (/brokerage|taxable/i.test(a))
    return 'Taxable brokerage — favor low-turnover index ETFs to minimize capital gains. Bonds generate ordinary income; keep them in tax-advantaged accounts if possible.';
  if (/swedish|pension/i.test(a))
    return 'Swedish pension — tax-advantaged. Treat similarly to Roth; prioritize long-term growth assets here.';
  return null;
}

// ─── Rebalance simulator (P4) ────────────────────────────────────────────────
// Pure: given $amount of new money (buy-only) or a full rebalance (sells
// allowed), return exact dollar actions per sleeve with a concrete holding
// suggestion each. Tax-aware: sells prefer tax-advantaged accounts; taxable
// sells carry a capital-gains warning. No lot data yet — warnings, not lots.
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
               warnings: ['Enter an amount to invest, or use Full Rebalance (allows sells).'] };
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

// One list for both answers below. A grid, not a <table>: the phone-width
// rules in style.css restack every tbody tr/td for the holdings table, and at
// 390px they folded the old table here into an unlabelled column that ran off
// the box. `detail` is HTML built by the caller; everything else is escaped.
function planListHtml(items, { actions = false } = {}) {
  return `<div class="adv-split${actions ? ' adv-split-acts' : ''}" data-testid="${actions ? 'rebalance-rows' : 'advisor-split'}">` +
    items.map(it => `<div class="adv-split-row" data-sleeve="${esc(it.sleeve)}">
      <span class="adv-split-dot"><span class="sleeve-dot" style="background:${SLEEVE_CONFIG[it.sleeve]?.color || 'var(--text-muted)'}"></span></span>
      <span class="adv-split-name">${esc(it.label)}</span>
      ${actions ? `<span class="adv-split-act"><span class="adv-act-${esc(it.action)}">${esc(it.action.toUpperCase())}</span></span>` : ''}
      <span class="adv-split-amt${it.action === 'hold' ? ' adv-act-hold' : ''}">${it.action === 'hold' ? '—' : fmt$(Math.abs(it.amount))}</span>
      <span class="adv-split-how">${it.detail || ''}</span>
    </div>`).join('') + '</div>';
}

const planWarningsHtml = warnings => warnings.map(w =>
  `<div class="adv-tax-tip"><strong>⚠</strong> ${esc(w)}</div>`).join('');

function runFullRebalance() {
  const amount = parseFloat(document.getElementById('advAmount').value) || 0;
  const result = document.getElementById('advResult');
  const plan = rebalancePlan(holdings, targets, amount, { allowSells: true });
  if (!plan) { result.innerHTML = '<p class="adv-placeholder">Add holdings with prices first.</p>'; return; }
  // All interpolated values esc()-escaped or app-computed (app's render pattern).
  result.innerHTML = `<div class="adv-rec-box">
    <div class="adv-sleeve-name">Full rebalance
      <span class="adv-plan-sub">sells allowed · ${fmt$(plan.totalBefore)} → ${fmt$(plan.totalAfter)}</span>
    </div>
    ${planListHtml(plan.rows.map(r => ({ ...r,
      detail: esc(r.suggestion) + (r.note ? ` <em>(${esc(r.note)})</em>` : '') })), { actions: true })}
    ${planWarningsHtml(plan.warnings)}
  </div>`;
}

// ─── Advisor: recommendation ──────────────────────────────────────────────────
// The holding line under one BUY row. Largest position first — the same pick
// the engine's own `suggestion` makes, so with no account chosen this names
// the holding the Ask box names — narrowed to the chosen account when there
// is one.
function advisorHoldingLine(sleeve, account) {
  const label = SLEEVE_CONFIG[sleeve].label;
  const val = h => (h.quantity || 0) * (h.price || 0);
  const acctOf = h => h.account || 'Unassigned';
  const named = h => `<strong>${esc(h.name)}${h.ticker && h.ticker !== 'N/A' ? ` (${esc(h.ticker)})` : ''}</strong>`;
  const anywhere = holdings.filter(h => getSleeve(h) === sleeve).sort((a, b) => val(b) - val(a));
  const inAcct = account ? anywhere.filter(h => acctOf(h) === account) : anywhere;

  if (inAcct.length > 0) {
    const h = inAcct[0];
    return `Add to ${named(h)} — you already hold this ${label} position in
      ${account ? `your <strong>${esc(account)}</strong> account` : `<strong>${esc(acctOf(h))}</strong>`}.`;
  }
  if (anywhere.length > 0) {
    const h = anywhere[0];
    return `You hold ${named(h)} in <strong>${esc(acctOf(h))}</strong>.
      Either open a similar position in <strong>${esc(account)}</strong>, or contribute to
      <strong>${esc(acctOf(h))}</strong> if that's where the ${label} sleeve makes more sense.`;
  }
  const suggestions = {
    us_stock:   'a US total market or S&P 500 index ETF (e.g. VOO, VTI, SCHB)',
    intl_stock: 'an international index ETF (e.g. VXUS, VEA, VWO)',
    tilt:       'a factor tilt, sector, or individual position aligned with your strategy',
    bond:       'a bond ETF matching your duration preference (e.g. VGIT for intermediate, BND for total market)',
  };
  return `No ${label} holding yet${account ? ` in <strong>${esc(account)}</strong>` : ''}.
    Consider adding ${suggestions[sleeve] || 'an appropriate instrument'}.`;
}

// One answer: the split is rebalancePlan's buy-only plan, the same rows the
// Ask brief carries as `scenarios.newMoney`. This adds only what the engine
// cannot know — which account he is paying into.
function computeAdvisorRec() {
  const amount  = parseFloat(document.getElementById('advAmount').value);
  const account = document.getElementById('advAccount').value;
  const result  = document.getElementById('advResult');

  if (isNaN(amount) || amount <= 0) {
    result.innerHTML = '<p class="adv-placeholder">Enter a positive amount to see a recommendation.</p>';
    return;
  }

  const plan = rebalancePlan(holdings, targets, amount);
  if (!plan) {
    result.innerHTML = '<p class="adv-placeholder">Add holdings with prices first, then get a recommendation.</p>';
    return;
  }
  const buys = plan.rows.filter(r => r.action === 'buy');
  if (!buys.length) {   // under a dollar a sleeve — the engine holds everything
    result.innerHTML = '<p class="adv-placeholder">That is too small to split. Enter a larger amount.</p>';
    return;
  }

  let html = `<div class="adv-rec-box">
    <div class="adv-sleeve-name">Where ${fmt$(amount)} goes
      <span class="adv-plan-sub">buy-only · ${fmt$(plan.totalBefore)} → ${fmt$(plan.totalAfter)}</span>
    </div>
    ${planListHtml(buys.map(r => ({ ...r, detail: advisorHoldingLine(r.sleeve, account) })))}`;

  // Tax tip
  const tip = accountTaxTip(account);
  if (tip) {
    html += `<div class="adv-tax-tip"><strong>Tax note:</strong> ${tip}</div>`;
  }
  html += planWarningsHtml(plan.warnings);

  // All sleeve gaps summary ($ short of target once this money is in);
  // 'other' is never gap-filled, so it is left out as before.
  const slvVals = getSleeveTotals();
  const tgtPcts = getSleeveTargetPcts();
  const bought = new Set(buys.map(r => r.sleeve));
  html += `<div class="adv-gaps">`;
  const gaps = Object.keys(SLEEVE_CONFIG).filter(s => s !== 'other')
    .map(s => [s, tgtPcts[s] / 100 * plan.totalAfter - (slvVals[s] || 0)])  // positive = underweight
    .sort(([, a], [, b]) => b - a);
  for (const [sleeve, gap] of gaps) {
    const cfg = SLEEVE_CONFIG[sleeve];
    html += `<span class="adv-gap-item" style="${bought.has(sleeve) ? 'font-weight:600;' : ''}">
      <span class="sleeve-dot" style="background:${cfg.color}"></span>
      ${cfg.label}: ${gap > 50 ? fmt$(gap) + ' short' : '✓'}
    </span>`;
  }
  html += `</div></div>`;

  result.innerHTML = html;
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
    // History may have rendered before transactions arrived — recompute the
    // TWR/MWR header now that external flows are known.
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
setTimeout(() => refreshAllPrices({ silent: true, autoSave: true }), 1200);
setInterval(() => {
  if (!document.hidden) refreshAllPrices({ silent: true, autoSave: true });
}, 15 * 60 * 1000);

// Keep "X min ago" label current
setInterval(updateRefreshLabel, 60 * 1000);
