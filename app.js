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

// Allocation targets
let targets = { stocks: 80, bonds: 15, other: 5, us: 70, intl: 20, tilts: 10 };

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
      unsaved   = false;
      saveLocal();
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

const EMPLOYER = { name: 'Nasdaq', tickers: ['NDAQ'], accounts: ['ESPP - Trade'] };
const EMPLOYER_CAP_PCT = 10; // concentration alert threshold (% of portfolio)

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
  let value = 0;
  const parts = [];
  for (const h of holdings) {
    const v = h.quantity * h.price;
    if (!(v > 0)) continue;
    const byTicker = EMPLOYER.tickers.includes((h.ticker || '').toUpperCase());
    const byAccount = EMPLOYER.accounts.includes(h.account || '');
    if (byTicker || byAccount) {
      value += v;
      parts.push(`${h.ticker || h.name} (${byAccount && !byTicker ? 'ESPP' : 'stock'})`);
    }
  }
  if (!(value > 0)) return null;
  return { value, pct: value / tot * 100, parts };
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
    html += `<div class="subsection-label">Employer concentration — ${esc(EMPLOYER.name)}</div>
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

function renderLastLookChip() {
  if (lastLookDone || !holdings.length || !(total() > 0)) return;
  const el = document.getElementById('sinceLastLook');
  if (!el) return;
  lastLookDone = true; // computed once per visit, against the previous look
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(LAST_LOOK_KEY)); } catch { /* ignore */ }
  if (prev && prev.value > 0 && Date.now() - prev.ts > 6 * 3600000) {
    const flowsSince = externalFlows(transactions)
      .filter(f => f.date > prev.date)
      .reduce((s, f) => s + f.amount, 0);
    const delta = total() - prev.value - flowsSince;
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
      label: `${EMPLOYER.name} exposure ${emp.pct.toFixed(1)}% — over the ${EMPLOYER_CAP_PCT}% guideline` });
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
             dividends: viaProxy.events || {} };
  }

  const qs = `interval=${interval}&range=${range}${events ? '&events=div' : ''}`;
  const q1 = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?${qs}`;
  const q2 = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?${qs}`;
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
        return { timestamps, adjcloses, dividends: r?.events?.dividends || {} };
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
      <table style="font-size:13px;border-collapse:collapse;margin-top:8px;">
        <tr style="color:var(--text-secondary);"><td style="padding:2px 14px 2px 0;">Reaching FI within…</td>${[10, 15, 20, 25, 30].map(y => `<td style="padding:2px 12px;text-align:center;">${y}y</td>`).join('')}</tr>
        <tr><td style="padding:2px 14px 2px 0;color:var(--text-secondary);">Probability</td>${[10, 15, 20, 25, 30].map(y => `<td style="padding:2px 12px;text-align:center;font-weight:600;">${sim.successByYears[y]}%</td>`).join('')}</tr>
      </table>`;
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
  if (hasHoldings) {
    renderGapTable();
    updateAdvisorAccounts();
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
        <td>${typeBadge(h.type)}</td>
        <td class="num">${fmtN(h.quantity)}</td>
        <td class="num" style="cursor:pointer;" onclick="startQuickPrice('${h.id}')" title="Click to edit price">
          ${quickPriceId === h.id
            ? `<input id="qp-${h.id}" type="number" step="any" value="${h.price}" style="width:85px;text-align:right;" onkeydown="if(event.key==='Enter')saveQuickPrice('${h.id}');if(event.key==='Escape')cancelQuickPrice();" onblur="saveQuickPrice('${h.id}')">`
            : fmt$(h.price)}
        </td>
        <td class="num">${fmt$(val)}</td>
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
      rows.push({
        sleeve: k, label, action: 'sell', amount: amt,
        suggestion: h ? `Trim ${h.name} in ${h.account || 'Unassigned'}` : '',
        note: taxable ? 'taxable account — may realize capital gains' : 'tax-advantaged — no capital-gains impact',
      });
      if (taxable) warnings.push(`${label}: the only sell candidates are in a taxable account — check unrealized gains before trimming.`);
    }
  }
  return { totalBefore: +tot.toFixed(2), totalAfter: +totalAfter.toFixed(2), rows, warnings };
}

function runRebalancePlan(allowSells) {
  const amount = parseFloat(document.getElementById('advAmount').value) || 0;
  const result = document.getElementById('advResult');
  const plan = rebalancePlan(holdings, targets, amount, { allowSells });
  if (!plan) { result.innerHTML = '<p class="adv-placeholder">Add holdings with prices first.</p>'; return; }
  if (!plan.rows.length) {
    result.innerHTML = `<p class="adv-placeholder">${esc(plan.warnings[0] || 'Nothing to do.')}</p>`;
    return;
  }
  // All interpolated values esc()-escaped or app-computed (app's render pattern).
  let html = `<div class="adv-rec-box">
    <div class="adv-sleeve-name">Rebalance plan ${allowSells ? '(full — sells allowed)' : '(buy-only)'}
      <span style="font-size:13px;font-weight:400;color:var(--text-secondary);margin-left:6px;">${fmt$(plan.totalBefore)} → ${fmt$(plan.totalAfter)}</span>
    </div>
    <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:6px;" data-testid="rebalance-table">
      <tr style="text-align:left;color:var(--text-secondary);"><th style="padding:4px 6px;">Sleeve</th><th>Action</th><th style="text-align:right;">Amount</th><th style="padding-left:10px;">Suggestion</th></tr>`;
  for (const r of plan.rows) {
    const color = r.action === 'buy' ? '#16a34a' : r.action === 'sell' ? '#dc2626' : 'var(--text-secondary)';
    html += `<tr style="border-top:1px solid var(--border,#eee);">
      <td style="padding:4px 6px;">${esc(r.label)}</td>
      <td style="color:${color};font-weight:600;">${esc(r.action.toUpperCase())}</td>
      <td style="text-align:right;">${r.action === 'hold' ? '—' : fmt$(Math.abs(r.amount))}</td>
      <td style="font-size:12px;color:var(--text-secondary);padding-left:10px;">${esc(r.suggestion)}${r.note ? ` <em>(${esc(r.note)})</em>` : ''}</td>
    </tr>`;
  }
  html += '</table>';
  for (const w of plan.warnings) {
    html += `<div class="adv-tax-tip" style="margin-top:6px;"><strong>⚠</strong> ${esc(w)}</div>`;
  }
  html += '</div>';
  result.innerHTML = html;
}

// ─── Advisor: recommendation ──────────────────────────────────────────────────
function computeAdvisorRec() {
  const amount  = parseFloat(document.getElementById('advAmount').value);
  const account = document.getElementById('advAccount').value;
  const result  = document.getElementById('advResult');

  if (isNaN(amount) || amount <= 0) {
    result.innerHTML = '<p class="adv-placeholder">Enter a positive amount to see a recommendation.</p>';
    return;
  }

  const tot = total();
  if (tot === 0) {
    result.innerHTML = '<p class="adv-placeholder">Add holdings with prices first, then get a recommendation.</p>';
    return;
  }

  const slvVals = getSleeveTotals();
  const tgtPcts = getSleeveTargetPcts();
  const newTot  = tot + amount;

  // Calculate gap for each sleeve ($ short after investing)
  const gaps = {};
  for (const sleeve of Object.keys(SLEEVE_CONFIG)) {
    const targetVal = tgtPcts[sleeve] / 100 * newTot;
    const curVal    = slvVals[sleeve] || 0;
    gaps[sleeve]    = targetVal - curVal; // positive = underweight
  }

  // Sort by gap descending; exclude 'other' from advice
  const sortedGaps = Object.entries(gaps)
    .filter(([s]) => s !== 'other')
    .sort(([,a],[,b]) => b - a);

  const [bestSleeve, bestGap] = sortedGaps[0];
  const slvCfg = SLEEVE_CONFIG[bestSleeve];

  // Find matching holdings in the chosen account
  const acctHoldings = account
    ? holdings.filter(h => (h.account || 'Unassigned') === account)
    : holdings;
  const matchInAcct  = acctHoldings.filter(h => getSleeve(h) === bestSleeve);
  const matchAnywhere = holdings.filter(h => getSleeve(h) === bestSleeve);

  const curPct = tot > 0 ? (slvVals[bestSleeve] || 0) / tot * 100 : 0;
  const tgtPct = tgtPcts[bestSleeve] || 0;

  // Build recommendation HTML
  let html = `<div class="adv-rec-box">`;

  // Headline
  html += `<div class="adv-sleeve-name" style="color:${slvCfg.color}">
    Invest in ${slvCfg.label}
    <span style="font-size:13px;font-weight:400;color:var(--text-secondary);margin-left:6px;">
      ${curPct.toFixed(1)}% current → ${tgtPct.toFixed(1)}% target
    </span>
  </div>`;

  // Specific holding suggestion
  if (matchInAcct.length > 0) {
    const h = matchInAcct[0];
    const ticker = h.ticker && h.ticker !== 'N/A' ? ` (${h.ticker})` : '';
    html += `<div class="adv-detail">
      Add to <strong>${esc(h.name)}${ticker}</strong> — you already hold this ${slvCfg.label} position in
      ${account ? `your <strong>${esc(account)}</strong> account` : 'your portfolio'}.
    </div>`;
  } else if (matchAnywhere.length > 0 && account) {
    const h = matchAnywhere[0];
    const ticker = h.ticker && h.ticker !== 'N/A' ? ` (${h.ticker})` : '';
    const otherAcct = h.account || 'Unassigned';
    html += `<div class="adv-detail">
      You hold <strong>${esc(h.name)}${ticker}</strong> in <strong>${esc(otherAcct)}</strong>.
      Either open a similar position in <strong>${esc(account)}</strong>, or contribute to
      <strong>${esc(otherAcct)}</strong> if that's where the ${slvCfg.label} sleeve makes more sense.
    </div>`;
  } else {
    const suggestions = {
      us_stock:   'a US total market or S&P 500 index ETF (e.g. VOO, VTI, SCHB)',
      intl_stock: 'an international index ETF (e.g. VXUS, VEA, VWO)',
      tilt:       'a factor tilt, sector, or individual position aligned with your strategy',
      bond:       'a bond ETF matching your duration preference (e.g. VGIT for intermediate, BND for total market)',
    };
    html += `<div class="adv-detail">
      No ${slvCfg.label} holding yet${account ? ` in <strong>${esc(account)}</strong>` : ''}.
      Consider adding ${suggestions[bestSleeve] || 'an appropriate instrument'}.
    </div>`;
  }

  // Tax tip
  const tip = accountTaxTip(account);
  if (tip) {
    html += `<div class="adv-tax-tip"><strong>Tax note:</strong> ${tip}</div>`;
  }

  // All sleeve gaps summary
  html += `<div class="adv-gaps">`;
  for (const [sleeve, gap] of sortedGaps) {
    const cfg = SLEEVE_CONFIG[sleeve];
    const isTop = sleeve === bestSleeve;
    html += `<span class="adv-gap-item" style="${isTop ? 'font-weight:600;' : ''}">
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
renderTargetInputs();

async function loadFromServer() {
  try {
    const res = await fetch('data/portfolio.json');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.holdings?.length) return;
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
    toast('Portfolio loaded from file ✓');
  } catch (e) {}
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
    if (holdings.length === 0) await loadFromServer();
    // Accrue any contributions that came due since the last visit (the
    // server path runs this inside loadFromServer; idempotent).
    else applyContributionRules();
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
