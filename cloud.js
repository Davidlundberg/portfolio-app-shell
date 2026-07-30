// ─── Cloud: phone access via Supabase ─────────────────────────────────────────
// Loaded BEFORE app.js. Two modes:
//   local  — served by server.py (or file://). Everything works exactly as
//            before; the header gains "Set up phone access" which pushes this
//            machine's data to the cloud once.
//   shell  — the public PWA on GitHub Pages. No data ships with the page;
//            a blocking sign-in gate (email → 6-digit code) pulls your data
//            from Supabase. Signup is refused server-side for emails not on
//            the allowlist, data access is enforced by owner-only RLS.
// The publishable key below is public by design — it grants nothing beyond
// what RLS permits to the signed-in user.

const PORTFOLIO_SHELL = true; // tools/publish_shell.py flips this to true

const CLOUD_URL = 'https://umimaxkucnugmkifenyg.supabase.co';
const CLOUD_KEY = 'sb_publishable_1wJlFgMwGiOwb7-viFNfeg_qczcRsBx';
const CLOUD_APP_URL = 'https://davidlundberg.github.io/portfolio-app-shell/';

const IS_SHELL = PORTFOLIO_SHELL || location.hostname.endsWith('.github.io');

let sb = null;               // supabase client
let cloudSession = null;
let cloudGateMode = 'gate';  // 'gate' (shell, blocking) | 'migrate' (local, cancellable)
let pendingOtpEmail = null;

// ─── Sync decision (ported from Perq's CloudSync, covered by tests) ──────────
// What should happen at sign-in / load, given where both sides stand?
//   cloudStamp       portfolio_state.updated_at in the cloud (null = cloud empty)
//   knownCloudStamp  the cloud stamp this device last saw (null = never synced)
//   everSynced       this device has completed a sync before
//   localDirty       local changes since this device's last sync
//   localChangedAt   when the last local change happened (for last-write-wins)
// Returns "push" | "pull" | "none" | "first-sync-conflict".
// first-sync-conflict = this device never synced, has its own edits, AND the
// cloud already has data — the one case where silently picking a side could
// destroy real data, so the UI must ask.
function syncDecision(s) {
  if (!s.cloudStamp) return 'push';
  if (!s.everSynced) return s.localDirty ? 'first-sync-conflict' : 'pull';
  const cloudMoved = s.cloudStamp !== s.knownCloudStamp;
  if (cloudMoved && s.localDirty) {
    return new Date(s.localChangedAt || 0) >= new Date(s.cloudStamp) ? 'push' : 'pull';
  }
  if (cloudMoved) return 'pull';
  if (s.localDirty) return 'push';
  return 'none';
}

// Per-device sync bookkeeping. Keyed off localStorage so it survives reloads
// but never leaves this browser.
const SYNC_META_KEY = 'portfolio_sync_meta';
function syncMeta() {
  try { return JSON.parse(localStorage.getItem(SYNC_META_KEY)) || {}; }
  catch { return {}; }
}
function setSyncMeta(patch) {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify({ ...syncMeta(), ...patch }));
}
// app.js calls this from markUnsaved() — every local edit stamps the device dirty.
function noteLocalChange() {
  setSyncMeta({ localDirty: true, localChangedAt: new Date().toISOString() });
}

// ─── Client bootstrap ────────────────────────────────────────────────────────
function cloudReady() { return !!(sb && cloudSession); }

async function initCloud() {
  if (typeof window.supabase === 'undefined') return false; // CDN unreachable; local mode unaffected
  if (!sb) {
    sb = window.supabase.createClient(CLOUD_URL, CLOUD_KEY);
    sb.auth.onAuthStateChange((_evt, s) => { cloudSession = s || null; });
  }
  const got = await sb.auth.getSession();
  cloudSession = (got.data && got.data.session) || null;
  return !!cloudSession;
}

// ─── Auth gate UI (email → 6-digit code) ─────────────────────────────────────
function authMsg(text, isErr) {
  const el = document.getElementById('authMsg');
  if (!el) return;
  el.style.display = text ? 'block' : 'none';
  el.textContent = text || '';
  el.classList.toggle('auth-err', !!isErr);
}

function showAuthGate(mode) {
  cloudGateMode = mode || (IS_SHELL ? 'gate' : 'migrate');
  document.getElementById('authTitle').textContent =
    cloudGateMode === 'migrate' ? 'Set up phone access' : 'Portfolio Tracker';
  document.getElementById('authSub').textContent = cloudGateMode === 'migrate'
    ? 'Sign in and this machine pushes your portfolio to your private cloud. Then sign in with the same email on your phone.'
    : 'Sign in to your portfolio.';
  document.getElementById('authCancel').style.display = cloudGateMode === 'migrate' ? '' : 'none';
  authStep('email');
  authMsg('');
  document.getElementById('authGate').style.display = 'flex';
  document.getElementById('authEmail').focus();
}
function hideAuthGate() { document.getElementById('authGate').style.display = 'none'; }

function authStep(step) {
  document.getElementById('authStepEmail').style.display = step === 'email' ? '' : 'none';
  document.getElementById('authStepCode').style.display = step === 'code' ? '' : 'none';
  if (step === 'code') document.getElementById('authCode').focus();
}

async function authRequestCode() {
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  if (!email) { authMsg('Enter your email.', true); return; }
  if (!sb) { await initCloud(); }
  if (!sb) { authMsg('Cloud library not loaded — check your connection and reload.', true); return; }
  authMsg('Sending code…');
  // shouldCreateUser stays true: the server-side before-user-created hook
  // rejects any email not on the allowlist, so this cannot open registration.
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) { authMsg(error.message, true); return; }
  pendingOtpEmail = email;
  authStep('code');
  authMsg('Check your email for a 6-digit code (or tap its sign-in link on this device).');
}

async function authVerifyCode() {
  const token = document.getElementById('authCode').value.trim();
  if (!token || !pendingOtpEmail) { authMsg('Enter the 6-digit code from the email.', true); return; }
  authMsg('Verifying…');
  const { data, error } = await sb.auth.verifyOtp({ email: pendingOtpEmail, token, type: 'email' });
  if (error) { authMsg(error.message, true); return; }
  cloudSession = data.session;
  if (cloudGateMode === 'migrate') {
    authMsg('Pushing your portfolio to the cloud…');
    const ok = await migrateLocalToCloud();
    if (!ok) return;
    authMsg('Done — your portfolio is in the cloud. Open the app on your phone and sign in with the same email.');
    setTimeout(hideAuthGate, 3500);
    renderCloudButton();
  } else {
    hideAuthGate();
    await syncOnSignIn();
    renderCloudButton();
  }
}

async function cloudSignOut() {
  if (sb) await sb.auth.signOut();
  cloudSession = null;
  renderCloudButton();
  if (IS_SHELL) showAuthGate('gate');
}

// ─── Data plane (owner-only RLS tables) ──────────────────────────────────────
function stateDoc() {
  return { holdings, targets, transactions, contributionRules, lastSaved: new Date().toISOString() };
}

// Guard a pulled doc before adopting it — a malformed doc must never nuke
// local data.
function adoptDoc(doc) {
  if (!doc || !Array.isArray(doc.holdings)) return false;
  holdings = doc.holdings.map(h => ({ type: 'stock', ...h }));
  if (doc.targets) Object.assign(targets, doc.targets);
  transactions      = doc.transactions || [];
  contributionRules = doc.contributionRules || [];
  lastSaved         = doc.lastSaved || null;
  return true;
}

async function cloudFetchState() {
  const { data, error } = await sb.from('portfolio_state')
    .select('doc, updated_at').maybeSingle();
  if (error) throw new Error(error.message);
  return data; // null when the cloud is empty
}

async function cloudPushState() {
  if (!cloudReady()) return false;
  const { data, error } = await sb.from('portfolio_state')
    .upsert({ user_id: cloudSession.user.id, doc: stateDoc() })
    .select('updated_at').single();
  if (error) { console.warn('[cloud] push failed:', error.message); return false; }
  lastSaved = new Date().toISOString();
  unsaved = false;
  setSyncMeta({ knownCloudStamp: data.updated_at, everSynced: true, localDirty: false });
  saveLocal();
  return true;
}

async function cloudPullState() {
  const row = await cloudFetchState();
  if (!row || !adoptDoc(row.doc)) return false;
  unsaved = false;
  setSyncMeta({ knownCloudStamp: row.updated_at, everSynced: true, localDirty: false });
  saveLocal();
  return true;
}

async function cloudPushSnapshot(snap) {
  if (!cloudReady()) return;
  const { error } = await sb.from('portfolio_history').upsert({
    user_id: cloudSession.user.id,
    snap_date: snap.date,
    value: snap.value,
    spy_price: snap.spyPrice ?? null,
  });
  if (error) console.warn('[cloud] snapshot failed:', error.message);
}

async function cloudFetchHistory() {
  const { data, error } = await sb.from('portfolio_history')
    .select('snap_date, value, spy_price').order('snap_date');
  if (error) throw new Error(error.message);
  return {
    snapshots: (data || []).map(r => ({
      date: r.snap_date, value: +r.value,
      spyPrice: r.spy_price == null ? null : +r.spy_price,
    })),
  };
}

// ─── Sync orchestration ──────────────────────────────────────────────────────
async function syncOnSignIn() {
  let row;
  try { row = await cloudFetchState(); }
  catch (e) { toast('Cloud unreachable — working from this device. ' + e.message, 6000); return; }
  const meta = syncMeta();
  const dec = syncDecision({
    cloudStamp: row ? row.updated_at : null,
    knownCloudStamp: meta.knownCloudStamp || null,
    everSynced: !!meta.everSynced,
    localDirty: !!meta.localDirty,
    localChangedAt: meta.localChangedAt || null,
  });
  if (dec === 'first-sync-conflict') {
    const useCloud = confirm(
      'This device has its own unsynced data, and your cloud account already has a portfolio.\n\n' +
      'OK = use the CLOUD copy (recommended — this device\'s local data is replaced)\n' +
      'Cancel = keep THIS DEVICE\'s data and overwrite the cloud'
    );
    if (useCloud) await cloudPullState(); else await cloudPushState();
  } else if (dec === 'pull') {
    await cloudPullState();
  } else if (dec === 'push') {
    await cloudPushState();
  }
  applyContributionRules();
  render();
  renderTargetInputs();
  await loadHistory();
  renderPerformanceChart();
  toast('Signed in — portfolio synced ✓');
}

// Local machine → cloud, once, from the "Set up phone access" flow.
async function migrateLocalToCloud() {
  try {
    const ok = await cloudPushState();
    if (!ok) { authMsg('Push failed — try again.', true); return false; }
    if (historyData && Array.isArray(historyData.snapshots) && historyData.snapshots.length) {
      const rows = historyData.snapshots
        .filter(s => s.date && s.value > 0)
        .map(s => ({
          user_id: cloudSession.user.id, snap_date: s.date,
          value: s.value, spy_price: s.spyPrice ?? null,
        }));
      if (rows.length) {
        const { error } = await sb.from('portfolio_history').upsert(rows);
        if (error) console.warn('[cloud] history migration failed:', error.message);
      }
    }
    return true;
  } catch (e) { authMsg('Push failed — ' + e.message, true); return false; }
}

// ─── Header button ───────────────────────────────────────────────────────────
function renderCloudButton() {
  const btn = document.getElementById('btnCloud');
  if (!btn) return;
  btn.style.display = '';
  if (IS_SHELL) {
    btn.textContent = cloudReady() ? '☁ Sign out' : '☁ Sign in';
    btn.onclick = cloudReady() ? cloudSignOut : () => showAuthGate('gate');
  } else {
    btn.textContent = cloudReady() ? '☁ Phone synced' : '☁ Set up phone access';
    btn.onclick = cloudReady()
      ? () => toast('Phone sync is on — open ' + CLOUD_APP_URL + ' on your phone.', 6000)
      : () => showAuthGate('migrate');
  }
}

// ─── Boot (called at the end of app.js init) ─────────────────────────────────
async function cloudBoot() {
  const signedIn = await initCloud();
  renderCloudButton();
  if (!IS_SHELL) return;            // local mode: nothing else changes
  if (!signedIn) { showAuthGate('gate'); return; }
  await syncOnSignIn();
}

// Service worker: shell only — local dev must never fight a cache.
if (IS_SHELL && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('[sw]', e));
  });
}
