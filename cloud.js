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

// Sync health: the needs-attention strip surfaces this so a silently failing
// backup can never go unnoticed for weeks.
let lastCloudError = null;
function cloudSyncIssue() { return lastCloudError; }

async function initCloud() {
  if (typeof window.supabase === 'undefined') return false; // CDN unreachable; local mode unaffected
  if (!sb) {
    // detectSessionInUrl: a magic-link redirect lands here with tokens in the
    // URL fragment; the client consumes them into a session and scrubs the URL.
    // storageKey ISOLATES this app's session: Closet/Perq share this origin
    // (github.io) and this Supabase project, so the default key would make any
    // of their sessions silently unlock the portfolio (and portfolio sign-out
    // would sign them out). The portfolio always demands its own sign-in.
    sb = window.supabase.createClient(CLOUD_URL, CLOUD_KEY, {
      auth: {
        storageKey: 'sb-portfolio-auth',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
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
  document.getElementById('authStepPassword').style.display = step === 'password' ? '' : 'none';
  if (step === 'code') document.getElementById('authCode').focus();
  if (step === 'password') document.getElementById('authPassword').focus();
}

async function authRequestCode() {
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  if (!email) { authMsg('Enter your email.', true); return; }
  if (!sb) { await initCloud(); }
  if (!sb) { authMsg('Cloud library not loaded — check your connection and reload.', true); return; }
  authMsg('Sending sign-in email…');
  // shouldCreateUser stays true: the signup allowlist (DB trigger + optional
  // auth hook) rejects any email not on the allowlist server-side, so this
  // cannot open registration. In shell mode the email's magic link redirects
  // back to the app (the URL must be in Supabase Auth → Redirect URLs);
  // supabase-js picks the session out of the redirect on load.
  const options = { shouldCreateUser: true };
  if (IS_SHELL) options.emailRedirectTo = CLOUD_APP_URL;
  const { error } = await sb.auth.signInWithOtp({ email, options });
  if (error) { authMsg(error.message, true); return; }
  pendingOtpEmail = email;
  authStep('code');
  authMsg('Check your email — tap the sign-in link on this device, or enter the 6-digit code if the email shows one.');
}

async function authVerifyCode() {
  const token = document.getElementById('authCode').value.trim();
  if (!token || !pendingOtpEmail) { authMsg('Enter the 6-digit code from the email.', true); return; }
  authMsg('Verifying…');
  const { data, error } = await sb.auth.verifyOtp({ email: pendingOtpEmail, token, type: 'email' });
  if (error) { authMsg(error.message, true); return; }
  cloudSession = data.session;
  await afterSignIn();
}

// Fallback: password sign-in against the existing personal-cloud account
// (same credentials as Closet/Perq). Kept alongside OTP so sign-in works
// even before the email template carries the 6-digit code.
async function authSubmitPassword() {
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  const password = document.getElementById('authPassword').value;
  if (!email) { authStep('email'); authMsg('Enter your email first.', true); return; }
  if (!password) { authMsg('Enter your password.', true); return; }
  if (!sb) { await initCloud(); }
  if (!sb) { authMsg('Cloud library not loaded — check your connection and reload.', true); return; }
  authMsg('Signing in…');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { authMsg(error.message, true); return; }
  cloudSession = data.session;
  await afterSignIn();
}

async function afterSignIn() {
  if (cloudGateMode === 'migrate') {
    // No blind push: the decision matrix arbitrates (an empty cloud gets a
    // push; a cloud with data triggers the explicit conflict question).
    authMsg('Syncing your portfolio with the cloud…');
    await syncOnSignIn();
    await seedHistory();
    authMsg('Done — this machine now syncs continuously. Sign in with the same email on your phone.');
    setTimeout(hideAuthGate, 3000);
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
  const meta = syncMeta();
  let data, error;
  if (meta.knownCloudStamp) {
    // Compare-and-swap: only overwrite the cloud version this device last
    // saw. Zero rows back = the cloud moved underneath us — never blind-
    // overwrite; re-run the sync decision instead.
    ({ data, error } = await sb.from('portfolio_state')
      .update({ doc: stateDoc() })
      .eq('user_id', cloudSession.user.id)
      .eq('updated_at', meta.knownCloudStamp)
      .select('updated_at'));
    if (!error && (!data || !data.length)) {
      console.warn('[cloud] push rejected — cloud moved; re-arbitrating');
      await syncOnSignIn();
      return false;
    }
    data = data && data[0];
  } else {
    ({ data, error } = await sb.from('portfolio_state')
      .upsert({ user_id: cloudSession.user.id, doc: stateDoc() })
      .select('updated_at').single());
  }
  if (error || !data) {
    lastCloudError = error?.message || 'push returned no row';
    console.warn('[cloud] push failed:', lastCloudError);
    return false;
  }
  lastCloudError = null;
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
  // The nightly server snapshot writes official closes — an intraday client
  // value must never overwrite it.
  const { data: existing } = await sb.from('portfolio_history')
    .select('source')
    .eq('user_id', cloudSession.user.id).eq('snap_date', snap.date)
    .maybeSingle();
  if (existing?.source === 'server') return;
  const { error } = await sb.from('portfolio_history').upsert({
    user_id: cloudSession.user.id,
    snap_date: snap.date,
    value: snap.value,
    spy_price: snap.spyPrice ?? null,
    source: 'client',
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
let syncInFlight = false;

async function syncOnSignIn() {
  if (syncInFlight) return;
  syncInFlight = true;
  try {
    let row;
    try { row = await cloudFetchState(); }
    catch (e) {
      lastCloudError = e.message;
      toast('Cloud unreachable — working from this device. ' + e.message, 6000);
      return;
    }
    lastCloudError = null;
    const meta = syncMeta();
    const dec = syncDecision({
      cloudStamp: row ? row.updated_at : null,
      knownCloudStamp: meta.knownCloudStamp || null,
      everSynced: !!meta.everSynced,
      localDirty: !!meta.localDirty,
      localChangedAt: meta.localChangedAt || null,
    });
    // A deliberate overwrite (LWW push / conflict-keep-local) targets the
    // version we just fetched — record it so the CAS in cloudPushState matches.
    if (row) setSyncMeta({ knownCloudStamp: row.updated_at });
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
    toast('Portfolio synced ✓');
  } finally {
    syncInFlight = false;
  }
}

// Local machine only: merge data/history.json into cloud history — fills
// every date the cloud lacks, never touches existing rows (server close
// rows especially). Server-side daily snapshots take over going forward.
async function seedHistory() {
  if (IS_SHELL || !cloudReady()) return;
  try {
    if (!historyData || !Array.isArray(historyData.snapshots) || !historyData.snapshots.length) return;
    const { data: existing, error: exErr } = await sb.from('portfolio_history').select('snap_date');
    if (exErr) { console.warn('[cloud] history seed skipped:', exErr.message); return; }
    const have = new Set((existing || []).map(r => r.snap_date));
    const rows = historyData.snapshots
      .filter(s => s.date && s.value > 0 && !have.has(s.date))
      .map(s => ({
        user_id: cloudSession.user.id, snap_date: s.date,
        value: s.value, spy_price: s.spyPrice ?? null, source: 'client',
      }));
    if (rows.length) {
      const { error } = await sb.from('portfolio_history').upsert(rows);
      if (error) console.warn('[cloud] history seed failed:', error.message);
      else console.log(`[cloud] seeded ${rows.length} history snapshots`);
    }
  } catch (e) { console.warn('[cloud] history seed failed:', e.message); }
}

// ─── Version restore (clobber insurance UI) ──────────────────────────────────
async function cloudVersionRestore() {
  if (!cloudReady()) { toast('Sign in first.'); return; }
  const { data, error } = await sb.from('portfolio_state_versions')
    .select('id, saved_at').order('id', { ascending: false }).limit(5);
  if (error || !data || !data.length) { toast('No cloud versions yet.'); return; }
  const list = data.map((v, i) => `${i + 1}. ${new Date(v.saved_at).toLocaleString()}`).join('\n');
  const pick = prompt(
    `Restore which cloud version?\n${list}\n\nEnter a number (the current state is versioned first, so this is reversible).`);
  if (pick == null) return;
  const chosen = data[parseInt(pick, 10) - 1];
  if (!chosen) { toast('No such version.'); return; }
  const { data: v, error: vErr } = await sb.from('portfolio_state_versions')
    .select('doc').eq('id', chosen.id).single();
  if (vErr || !v || !adoptDoc(v.doc)) { toast('Version unreadable — nothing changed.'); return; }
  await cloudPushState();
  applyContributionRules();
  render(); renderTargetInputs();
  await loadHistory(); renderPerformanceChart();
  toast('Cloud version restored ✓');
}

// ─── Header button ───────────────────────────────────────────────────────────
function renderCloudButton() {
  const btn = document.getElementById('btnCloud');
  if (!btn) return;
  btn.style.display = '';
  if (cloudReady()) {
    btn.textContent = IS_SHELL ? '☁ Synced' : '☁ Cloud synced';
    btn.onclick = showCloudMenu;
  } else {
    btn.textContent = IS_SHELL ? '☁ Sign in' : '☁ Set up phone access';
    btn.onclick = () => showAuthGate(IS_SHELL ? 'gate' : 'migrate');
  }
}

function showCloudMenu() {
  document.getElementById('cloudMenu').style.display = 'flex';
  const info = document.getElementById('cloudMenuInfo');
  if (info) {
    info.textContent = IS_SHELL
      ? 'Synced with your private cloud.'
      : 'This machine syncs continuously. Phone app: ' + CLOUD_APP_URL;
  }
}
function hideCloudMenu() { document.getElementById('cloudMenu').style.display = 'none'; }

// ─── Quote proxy (edge function) ─────────────────────────────────────────────
// When signed in, market data flows through the private portfolio-quotes
// function instead of anonymous public CORS proxies. Callers fall back to
// their original chains when this returns null.
const CLOUD_FN = CLOUD_URL + '/functions/v1/portfolio-quotes';

async function proxyGet(path, params) {
  if (!cloudReady()) return null;
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${CLOUD_FN}${path}?${qs}`, {
      headers: {
        Authorization: 'Bearer ' + cloudSession.access_token,
        apikey: CLOUD_KEY,
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ─── Boot (called at the end of app.js init) ─────────────────────────────────
async function cloudBoot() {
  const signedIn = await initCloud();
  renderCloudButton();
  if (IS_SHELL) {
    if (!signedIn) { showAuthGate('gate'); return; }
    await syncOnSignIn();
  } else if (signedIn) {
    // Continuous two-way sync for the Mac — the one-shot "migrate" trap is
    // gone; every boot arbitrates through the decision matrix.
    await syncOnSignIn();
    await seedHistory();
  }
}

// Service worker: shell only — local dev must never fight a cache.
if (IS_SHELL && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('[sw]', e));
  });
}
