// =====================================================================
//  Riod Inventory — main application
// =====================================================================
import { auth, db, fb, createAuthUser, callFn, isConfigured } from './firebase.js?v=18';
import { COMPANY_DOMAINS, ADMIN_EMAIL, LOW_STOCK_THRESHOLD, PRODUCTION_EMAILS } from './firebase-config.js?v=18';
const isCompanyEmail = e => COMPANY_DOMAINS.includes(String(e || '').toLowerCase().split('@')[1]);
import {
  $, $$, esc, normValue, fmtDate, fmtDateTime, timeAgo, toDate, debounce, toast,
  openModal, confirmDialog, uniqSorted
} from './util.js?v=18';
import * as BOM from './bom.js?v=18';

const {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where,
  serverTimestamp, runTransaction, writeBatch, Timestamp, increment
} = fb;

// ---------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------
const CATEGORIES = BOM.CATEGORIES; // "IC / Module" covers ICs and modules
const IC_TYPES = ['Microcontroller (MCU)', 'Buck Converter', 'Boost Converter', 'Buck-Boost Converter',
  'LDO Regulator', 'Linear Regulator', 'PMIC', 'Battery Charger', 'Op-Amp', 'Comparator', 'ADC', 'DAC',
  'Gate Driver', 'Motor Driver', 'LED Driver', 'Load Switch', 'eFuse / Protection', 'ESD / TVS',
  'Interface (UART/RS-485/CAN)', 'USB Interface', 'Ethernet PHY', 'RF / Wireless', 'Memory (EEPROM/Flash)',
  'Logic', 'Level Shifter', 'Sensor IC', 'Clock / Timer', 'Voltage Reference', 'Audio',
  'GSM / LTE Module', 'WiFi / BLE Module', 'GPS / GNSS Module', 'LoRa Module', 'Power Module', 'Display Module', 'Sensor Module', 'Other'];
const PACKAGES = ['01005', '0201', '0402', '0603', '0805', '1206', '1210', '1812', '2010', '2512',
  'SOD-123', 'SOD-323', 'SOD-523', 'SMA', 'SMB', 'SMC', 'SOT-23', 'SOT-23-5', 'SOT-23-6', 'SOT-223',
  'SOT-89', 'SOT-363', 'TO-252 (DPAK)', 'TO-263 (D2PAK)', 'TO-220', 'SOIC-8', 'SOIC-14', 'SOIC-16',
  'TSSOP-8', 'TSSOP-14', 'TSSOP-16', 'TSSOP-20', 'MSOP-8', 'MSOP-10', 'QFN-16', 'QFN-20', 'QFN-24',
  'QFN-32', 'QFN-48', 'DFN-8', 'LQFP-32', 'LQFP-48', 'LQFP-64', 'LQFP-100', 'BGA', 'WLCSP', 'DIP-8',
  'Through Hole', 'Module'];
const SITES = ['Mouser', 'DigiKey', 'LCSC', 'Element14 / Farnell', 'RS Components', 'Arrow', 'TME',
  'Robu.in', 'Amazon', 'AliExpress'];
const TX_LABEL = { added: 'Added', import: 'Imported (BOM)', restock: 'Restocked', taken: 'Taken',
  request: 'Given on request', adjust: 'Qty adjusted' };
const MAX_ROWS = 500;
// Bump together with the ?v= numbers in index.html and the imports when publishing, so browsers load the new files.
const APP_VERSION = 18;

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  out: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  swap: '<path d="M7 20V4M3 8l4-4 4 4M17 4v16M13 16l4 4 4-4"/>',
  store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0112 0v1"/><path d="M16 4a4 4 0 010 8M22 21v-1a6 6 0 00-4-5.6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------
const S = {
  profile: null, isAdmin: false,
  components: [], vendors: [], users: [], reqIn: [], reqOut: [], activity: [],
  unsubs: [], viewUpdate: null, loginTime: 0, ui: {}, loginMsg: '',
};
const myUid = () => S.profile?.uid;
const findComp = id => S.components.find(c => c.id === id);
const isLow = c => c.qty > 0 && c.qty < LOW_STOCK_THRESHOLD;
const isOut = c => c.qty <= 0;

// ---- Production inventory ----
// Parts held by a production account (PRODUCTION_EMAILS), or in a project named "Production", are hidden
// from other engineers unless they tick "Show production inventory". Your own parts are never hidden.
// The production team can "release" parts for common use (released: true); released parts show for everyone.
const PROD_EMAILS = new Set(PRODUCTION_EMAILS.map(e => e.toLowerCase()));
const isProdProject = p => String(p || '').trim().toLowerCase() === 'production';
const isProdStock = c => (S.prodUids?.has(c.ownerUid) ?? false) || isProdProject(c.project); // production's, released or not
const isProduction = c => isProdStock(c) && !c.released;                                           // production-only
const iAmProduction = () => PROD_EMAILS.has(String(S.profile?.email || '').toLowerCase());
let showProd = false;
try { showProd = localStorage.getItem('riod.showProd') === '1'; } catch { /* ignore */ }
const hideProd = c => !showProd && c.ownerUid !== myUid() && isProduction(c);
const hideProdActivity = a => a.type !== 'release' && !showProd && a.byUid !== myUid() && ((S.prodUids?.has(a.byUid) ?? false) || isProdProject(a.project));
const visibleComps = () => S.components.filter(c => !hideProd(c));
const qtyClass = q => (q <= 0 ? 'out' : q < LOW_STOCK_THRESHOLD ? 'low' : 'ok');
const vp = x => [x.value, x.package].filter(Boolean).join(' '); // "10k 0603", or just "QFN-16" for an IC
// Two entries are "the same component" only if part number, project AND value match.
// (A BOM may wrongly reuse a part number for e.g. 1.5k and 1.62k resistors; those must not be merged.)
const keyOf = (pn, proj, value = '') =>
  `${String(pn).trim().toLowerCase()}|${String(proj || '').trim().toLowerCase()}|${normValue(value)}`;

// ---------------------------------------------------------------------
//  Boot
// ---------------------------------------------------------------------
function showOnly(id) {
  for (const s of ['boot', 'login', 'setup', 'app']) $('#' + s).classList.toggle('hidden', s !== id);
}

function init() {
  if (!isConfigured) { showOnly('setup'); return; }
  wireLogin();
  wireShell();
  onAuthStateChanged(auth, handleAuth);
}

async function handleAuth(user) {
  if (!user) {
    teardown();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search); // next login starts on the home page
    showLogin();
    return;
  }
  // Access = @riodlogic.com accounts the admin added, plus any outside email the admin added explicitly.
  // Either way an active record in "users" (created only by the admin) is required.
  const email = (user.email || '').toLowerCase();
  const isAdmin = email === ADMIN_EMAIL;
  const ref = doc(db, 'users', user.uid);
  let data;
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) data = snap.data();
    if (isAdmin && !data) {
      data = { name: 'Adithyan', email, role: 'admin', active: true, createdAt: serverTimestamp() };
      await setDoc(ref, data);
    }
  } catch (e) {
    console.error(e);
    S.loginMsg = 'Could not read your account. Check that the Firestore rules are published (see README).';
    await signOut(auth); return;
  }
  if (!data || data.active !== true || (data.email || '').toLowerCase() !== email) {
    S.loginMsg = !data
      ? `This email has no account yet. Ask the admin to add you.`
      : 'Your account is not active. Please contact the admin.';
    await signOut(auth); return;
  }
  S.profile = { uid: user.uid, email, name: data.name || email.split('@')[0], role: isAdmin ? 'admin' : 'engineer' };
  S.isAdmin = isAdmin;
  updateDoc(ref, { lastLogin: serverTimestamp() }).catch(() => {});
  startApp();
}

function showLogin() {
  showOnly('login');
  const msg = $('#loginMsg');
  msg.textContent = S.loginMsg || '';
  msg.className = 'form-msg' + (S.loginMsg ? ' error' : '');
  S.loginMsg = '';
}

function friendlyAuthError(e) {
  const c = e?.code || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return 'Incorrect email or password.';
  if (c.includes('too-many-requests')) return 'Too many attempts. Please wait a few minutes and try again.';
  if (c.includes('network')) return 'Network error. Check your internet connection.';
  if (c.includes('user-disabled')) return 'This account has been disabled.';
  return e?.message || 'Sign-in failed.';
}

function wireLogin() {
  const form = $('#loginForm');
  const msg = $('#loginMsg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    const pass = form.password.value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      msg.textContent = 'Enter your full email address.'; msg.className = 'form-msg error'; return;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Signing in…';
    msg.textContent = ''; msg.className = 'form-msg';
    try { await signInWithEmailAndPassword(auth, email, pass); form.password.value = ''; }
    catch (err) { msg.textContent = friendlyAuthError(err); msg.className = 'form-msg error'; }
    finally { btn.disabled = false; btn.textContent = 'Sign in'; }
  });
  $('#forgot').addEventListener('click', async () => {
    const email = form.email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      msg.textContent = 'Type your email above first, then click "Forgot password".';
      msg.className = 'form-msg error'; return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      msg.textContent = `If ${email} has an account, a password reset link has been sent to it.`;
      msg.className = 'form-msg success';
    } catch (err) { msg.textContent = friendlyAuthError(err); msg.className = 'form-msg error'; }
  });
}

function wireShell() {
  const menu = $('#userMenu');
  $('#userBtn').addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', () => menu.classList.add('hidden'));
  menu.addEventListener('click', async e => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    menu.classList.add('hidden');
    if (b.dataset.menu === 'logout') { await signOut(auth); }
    if (b.dataset.menu === 'password') showPasswordModal();
    if (b.dataset.menu === 'notify') requestNotify();
  });
  // ☰ : on a phone it slides the menu in/out; on a PC it collapses the menu to icons only (remembered).
  try { if (localStorage.getItem('riod.navCollapsed') === '1') $('#app').classList.add('nav-collapsed'); } catch { /* ignore */ }
  // PC: ☰ at the top-left of the sidebar collapses it to icons. Phone: ☰ in the top bar slides the menu in.
  $('#sideToggle').addEventListener('click', () => {
    if (window.matchMedia('(max-width: 820px)').matches) { $('#app').classList.remove('nav-open'); return; }
    const c = $('#app').classList.toggle('nav-collapsed');
    try { localStorage.setItem('riod.navCollapsed', c ? '1' : '0'); } catch { /* ignore */ }
  });
  $('#menuToggle').addEventListener('click', () => $('#app').classList.toggle('nav-open'));
  $('#nav').addEventListener('click', e => { if (e.target.closest('a')) $('#app').classList.remove('nav-open'); });
  $('#enableNotify').addEventListener('click', requestNotify);
  $('#dismissNotify').addEventListener('click', () => {
    $('#notifyBanner').classList.add('hidden');
    try { localStorage.setItem('riod.notifyDismissed', '1'); } catch { /* ignore */ }
  });
  window.addEventListener('hashchange', () => { if (S.profile) route(); });
  // Esc clears a multi-selection (when no dialog is open)
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.clearSel && !$('#modalRoot').children.length) S.clearSel(); });

  // Every button with data-action inside the main view
  $('#view').addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    ACTIONS[b.dataset.action]?.(b.dataset.id, b);
  });
}

// ---------------------------------------------------------------------
//  Live data
// ---------------------------------------------------------------------
function startApp() {
  const { profile, isAdmin } = S;
  teardown();
  Object.assign(S, { profile, isAdmin });
  S.loginTime = Date.now();
  showOnly('app');
  $('#userName').textContent = S.profile.name;
  $('#userEmail').innerHTML = `${esc(S.profile.email)}<br><span class="small">Riod Inventory v${APP_VERSION}</span>`;
  $('#avatar').textContent = (S.profile.name || '?').trim().charAt(0).toUpperCase();
  buildNav();
  subscribe();
  route();
  let dismissed = false;
  try { dismissed = localStorage.getItem('riod.notifyDismissed') === '1'; } catch { /* ignore */ }
  const canAsk = 'Notification' in window && Notification.permission === 'default';
  $('#notifyBanner').classList.toggle('hidden', !(canAsk && !dismissed));
}

function teardown() {
  S.unsubs.forEach(u => { try { u(); } catch { /* ignore */ } });
  S.unsubs = [];
  Object.assign(S, { profile: null, isAdmin: false, components: [], vendors: [], users: [], reqIn: [], reqOut: [], activity: [], viewUpdate: null, ui: {}, newSeen: null, newSince: 0, route: null, prodUids: new Set() });
  $('#modalRoot').innerHTML = '';
}

function onSyncError(what) {
  return e => {
    console.error(what, e);
    if (e.code === 'permission-denied') {
      S.loginMsg = 'Access denied. Your account may have been removed, or the database rules are not published. Contact the admin.';
      signOut(auth);
    } else toast(`Sync problem (${what}): ${e.message}`, 'error', 6000);
  };
}

function subscribe() {
  const uid = myUid();
  const add = u => S.unsubs.push(u);

  add(onSnapshot(collection(db, 'components'), snap => {
    S.components = snap.docs.map(d => {
      const x = d.data();
      // Older parts saved as "IC" or "Module" show under "IC / Module".
      return { id: d.id, ...x, qty: Number(x.qty) || 0, category: BOM.isIcCat(x.category) ? BOM.IC_CAT : (x.category || '') };
    });
    scheduleRender();
  }, onSyncError('components')));

  add(onSnapshot(collection(db, 'vendors'), snap => {
    S.vendors = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    scheduleRender();
  }, onSyncError('vendors')));

  add(onSnapshot(collection(db, 'users'), snap => {
    S.users = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    S.prodUids = new Set(S.users.filter(u => PROD_EMAILS.has(String(u.email || '').toLowerCase())).map(u => u.id));
    scheduleRender();
  }, onSyncError('users')));

  // Activity feed (last 30 days) -> "New Components" feed + desktop notifications
  const since = Timestamp.fromMillis(Date.now() - 30 * 864e5);
  add(onSnapshot(query(collection(db, 'activity'), where('createdAt', '>=', since)), snap => {
    S.activity = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
    for (const ch of snap.docChanges()) {
      if (ch.type !== 'added') continue;
      const a = ch.doc.data();
      if (a.byUid === uid) continue;
      const t = toDate(a.createdAt);
      if (!t || t.getTime() < S.loginTime - 5000) continue;
      if (hideProdActivity(a)) continue; // production stock stays quiet unless you chose to see it
      if (a.type === 'add') notify('New component added', `${a.byName} added ${[a.qty, a.value, a.package].filter(Boolean).join(' ')}, ${a.description}`);
      if (a.type === 'bom') notify('New components added', `${a.byName} added ${a.count} components (${a.totalQty} pcs) from a BOM — project ${a.project}`);
      if (a.type === 'release') notify('Production parts released', `${a.byName} released ${a.count} component${a.count === 1 ? '' : 's'} (${a.totalQty} pcs) for common use`);
    }
    scheduleRender();
  }, onSyncError('activity')));

  // (the admin is also an engineer, so everyone gets request listeners)

  let firstIn = true;
  add(onSnapshot(query(collection(db, 'requests'), where('ownerUid', '==', uid)), snap => {
    S.reqIn = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!firstIn) {
      for (const ch of snap.docChanges()) {
        const r = ch.doc.data();
        if (ch.type === 'added' && r.status === 'pending')
          notify('Component request', `${r.requesterName} requests ${r.qtyRequested} × ${r.partNumber} (${vp(r)})`);
      }
    }
    firstIn = false;
    scheduleRender();
  }, onSyncError('requests')));

  const prevStatus = new Map();
  add(onSnapshot(query(collection(db, 'requests'), where('requesterUid', '==', uid)), snap => {
    S.reqOut = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    for (const ch of snap.docChanges()) {
      const r = ch.doc.data();
      const before = prevStatus.get(ch.doc.id);
      if (ch.type === 'modified' && before === 'pending' && r.status !== 'pending') {
        if (r.status === 'approved') notify('Request approved', `${r.ownerName} approved ${r.qtyApproved} × ${r.partNumber}. Collect it from them.`);
        if (r.status === 'rejected') notify('Request rejected', `${r.ownerName} rejected your request for ${r.partNumber}${r.ownerNote ? ': ' + r.ownerNote : ''}`);
      }
      prevStatus.set(ch.doc.id, r.status);
    }
    scheduleRender();
  }, onSyncError('requests')));
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    if (!S.profile) return;
    updateNavCounts();
    fillDatalists();
    try { S.viewUpdate?.(); } catch (e) { console.error(e); }
  }, 30);
}

// ---------------------------------------------------------------------
//  Notifications
// ---------------------------------------------------------------------
function notify(title, body) {
  toast(`<strong>${esc(title)}</strong><br>${esc(body)}`, 'info', 7000, true);
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body, icon: 'assets/icon.png' });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) { console.warn(e); }
  }
}

async function requestNotify() {
  if (!('Notification' in window)) { toast('This browser does not support desktop notifications.', 'error'); return; }
  const p = await Notification.requestPermission();
  $('#notifyBanner').classList.add('hidden');
  if (p === 'granted') {
    toast('Desktop notifications are on. Keep this tab open (it can stay in the background).', 'success', 5000);
    new Notification('Riod Inventory', { body: 'Notifications are working!', icon: 'assets/icon.png' });
  } else toast('Notifications blocked. Allow them from the lock icon in the address bar.', 'error', 6000);
}

// ---------------------------------------------------------------------
//  Navigation
// ---------------------------------------------------------------------
const NAV = [
  { id: 'search', label: 'Search Inventory', icon: 'search' },
  { id: 'new', label: 'New Components', icon: 'sparkle', count: () => visibleComps().filter(isUnseenNew).length, cls: 'accent' },
  { id: 'low', label: 'Low Stock', icon: 'alert', count: () => visibleComps().filter(isLow).length, cls: 'warn' },
  { id: 'out', label: 'Out of Stock', icon: 'out', count: () => visibleComps().filter(isOut).length, cls: 'danger' },
  { sep: 'My work', engineer: true },
  { id: 'my', label: 'My Inventory', icon: 'box', engineer: true },
  { id: 'add', label: 'Add Component', icon: 'plus', engineer: true },
  { id: 'import', label: 'Import BOM / Excel', icon: 'upload', engineer: true },
  { id: 'requests', label: 'Requests', icon: 'swap', engineer: true, count: () => S.reqIn.filter(r => r.status === 'pending').length, cls: 'accent' },
  { sep: 'Directory' },
  { id: 'vendors', label: 'Vendors', icon: 'store' },
  { id: 'admin', label: 'Manage Engineers', icon: 'users', admin: true },
];
const navVisible = n => !(n.admin && !S.isAdmin);

function buildNav() {
  $('#nav').innerHTML = NAV.filter(navVisible).map(n => n.sep
    ? `<div class="nav-sep">${esc(n.sep)}</div>`
    : `<a href="#${n.id}" data-nav="${n.id}" title="${esc(n.label)}">${icon(n.icon)}<span>${esc(n.label)}</span>${n.count ? `<b class="count ${n.cls || ''}" data-count="${n.id}"></b>` : ''}</a>`
  ).join('');
}

// ---- "New Components" badge: counts only parts added since you last looked at that page ----
const addedMs = c => toDate(c.lastAddedAt || c.createdAt)?.getTime() || 0;
const seenKey = () => 'riod.newSeen.' + myUid();
function newSeenAt() {
  if (S.newSeen == null) { try { S.newSeen = Number(localStorage.getItem(seenKey())) || 0; } catch { S.newSeen = 0; } }
  return S.newSeen;
}
function markNewSeen() {
  S.newSeen = Date.now();
  try { localStorage.setItem(seenKey(), String(S.newSeen)); } catch { /* ignore */ }
}
const isUnseenNew = c => c.ownerUid !== myUid() && isRecent(c, 7) && addedMs(c) > newSeenAt();

function updateNavCounts() {
  // While the New Components page is open (and visible), everything on it counts as seen.
  if (S.route === 'new' && document.visibilityState === 'visible') markNewSeen();
  for (const n of NAV) {
    if (!n.count) continue;
    const el = $(`[data-count="${n.id}"]`);
    if (!el) continue;
    const v = n.count();
    el.textContent = v || '';
    el.classList.toggle('hidden', !v);
  }
}

const VIEWS = {
  search: { title: 'Search Inventory', render: el => renderList(el, LIST_CFG.search) },
  new: { title: 'New Components', render: el => renderList(el, LIST_CFG.new) },
  low: { title: 'Low Stock', render: el => renderList(el, LIST_CFG.low) },
  out: { title: 'Out of Stock', render: el => renderList(el, LIST_CFG.out) },
  my: { title: 'My Inventory', render: renderMy, engineer: true },
  add: { title: 'Add Component', render: renderAdd, engineer: true },
  import: { title: 'Import BOM / Excel', render: renderImport, engineer: true },
  requests: { title: 'Component Requests', render: renderRequests, engineer: true },
  vendors: { title: 'Vendors', render: renderVendors },
  admin: { title: 'Manage Engineers', render: renderAdmin, admin: true },
};

function route() {
  let v = location.hash.slice(1) || 'search';
  const def = VIEWS[v];
  if (!def || !navVisible(def)) v = 'search';
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === v));
  $('#viewTitle').textContent = VIEWS[v].title;
  document.title = `${VIEWS[v].title} · Riod Inventory`;
  const el = $('#view');
  el.innerHTML = '';
  if (v === 'new' && S.route !== 'new') S.newSince = newSeenAt(); // rows newer than this get a "new" tag
  S.route = v;
  S.clearSel = null;
  S.viewUpdate = null;
  S.viewUpdate = VIEWS[v].render(el) || null;
  updateNavCounts();
  fillDatalists();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------
//  Datalists (suggestions while typing)
// ---------------------------------------------------------------------
const dlCache = {};
function setDatalist(id, values) {
  const html = values.map(v => `<option value="${esc(v)}"></option>`).join('');
  if (dlCache[id] === html) return;
  dlCache[id] = html;
  $('#' + id).innerHTML = html;
}
function fillDatalists() {
  const C = S.components;
  setDatalist('dl-packages', uniqSorted([...PACKAGES, ...C.map(c => c.package)]));
  setDatalist('dl-ictypes', uniqSorted([...IC_TYPES, ...C.map(c => c.icType)]));
  setDatalist('dl-categories', uniqSorted([...CATEGORIES, ...C.map(c => c.category)]));
  setDatalist('dl-mfrs', uniqSorted(C.map(c => c.manufacturer)));
  const mine = uniqSorted(C.filter(c => c.ownerUid === myUid()).map(c => c.project));
  setDatalist('dl-projects', uniqSorted([...mine, ...C.map(c => c.project)]));
  const sites = uniqSorted([...SITES, ...C.filter(c => c.sourceType === 'online').map(c => c.sourceName)]);
  setDatalist('dl-sites', sites);
  setDatalist('dl-sources', uniqSorted([...sites, ...S.vendors.map(v => v.name)]));
}

// ---------------------------------------------------------------------
//  Search & component tables
// ---------------------------------------------------------------------
function compText(c) {
  if (c._t) return c._t;
  const base = [c.partNumber, c.value, c.package, c.description, c.category, c.icType, c.manufacturer,
    c.project, c.ownerName, c.sourceName].filter(Boolean).join(' ').toLowerCase();
  c._t = base + ' ' + normValue(base);
  return c._t;
}
function matchQuery(c, q) {
  const tokens = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const txt = compText(c);
  return tokens.every(t => txt.includes(t) || txt.includes(normValue(t)));
}
function isRecent(c, days) {
  const d = toDate(c.lastAddedAt || c.createdAt);
  return !!d && d.getTime() >= Date.now() - days * 864e5;
}
function isSavedVendor(name) {
  const n = String(name || '').trim().toLowerCase();
  return !!n && S.vendors.some(v => (v.name || '').trim().toLowerCase() === n);
}
// Decides Online vs Vendor for an imported row's source name.
function classifySource(name, headerSaysVendor) {
  const n = String(name || '').trim();
  if (!n) return 'online';
  if (isSavedVendor(n)) return 'vendor';
  if (SITES.some(s => s.toLowerCase() === n.toLowerCase())) return 'online';
  return headerSaysVendor ? 'vendor' : 'online';
}
function sourceLabel(c) {
  if (c.sourceType === 'vendor') return `Vendor${c.sourceName ? ' · ' + c.sourceName : ''}`;
  return `Online${c.sourceName ? ' · ' + c.sourceName : ''}`;
}

// Clicking a row opens the details (which has Mark taken / Edit / Request).
// Only the most common shortcut stays on the row: Request for others' parts, Restock for your empty ones.
function rowActions(c) {
  const mine = c.ownerUid === myUid();
  const a = [];
  if (mine) {
    if (c.qty <= 0) a.push(`<button class="btn sm" data-action="edit" data-id="${c.id}">Restock</button>`);
  } else if (c.qty > 0) {
    a.push(`<button class="btn sm primary" data-action="request" data-id="${c.id}">Request</button>`);
  }
  return a.join('');
}

// ---- Sorting by category (Resistor, Capacitor, ... IC / Module ...), then by value ----
const catLabel = c => c.category || 'Uncategorized';
const catRank = c => {
  const i = CATEGORIES.indexOf(c.category);
  if (i >= 0) return c.category === 'Other' ? 900 : i;
  return c.category ? 800 : 1000; // unknown categories before "Other", uncategorized last
};
// "4k7" → 4700, "100nF" → 1e-7, "4R7" → 4.7, "16MHz" → 1.6e7. Not a number → Infinity (sorted after).
const SI = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, R: 1, r: 1 };
function valueNum(v) {
  const m = String(v || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([pnuµmkKMGRr]?)(\d*)/);
  if (!m) return Infinity;
  const n = parseFloat(m[3] ? `${m[1]}.${m[3]}` : m[1]);
  return n * (SI[m[2]] ?? 1);
}
const byCategory = (a, b) => catRank(a) - catRank(b) || catLabel(a).localeCompare(catLabel(b))
  || valueNum(a.value) - valueNum(b.value) || String(a.package || '').localeCompare(String(b.package || ''), undefined, { numeric: true })
  || SORTS.pn(a, b);

function componentTable(list, opt = {}) {
  if (!list.length) return `<div class="empty">${opt.empty || 'No components found.'}</div>`;
  const showOwner = opt.owner !== false, showProject = opt.project !== false;
  const shown = list.slice(0, MAX_ROWS);
  return `<div class="table-wrap"><table class="tbl">
    <thead><tr>
      <th>Part Number</th><th>Value</th><th>Package</th><th>Description</th><th>Category</th><th>Manufacturer</th>
      <th class="num">Qty left</th>${showOwner ? '<th>Held by</th>' : ''}${showProject ? '<th>Project</th>' : ''}
      ${opt.date ? '<th>Added</th>' : ''}<th></th>
    </tr></thead>
    <tbody>${shown.map((c, i) => `${opt.catHeads && (i === 0 || catLabel(shown[i - 1]) !== catLabel(c))
      ? `<tr class="cat-row"><td colspan="${8 + showOwner + showProject + !!opt.date}">${esc(catLabel(c))}
          <span class="muted">${shown.filter(x => catLabel(x) === catLabel(c)).length}</span></td></tr>` : ''}
    <tr class="clickable" data-action="details" data-id="${c.id}" title="Click for details${c.ownerUid === myUid() && c.qty > 0 ? ', Mark taken or Edit' : ''}">
      <td class="mono strong">${esc(c.partNumber)}${opt.newSince != null && c.ownerUid !== myUid() && addedMs(c) > opt.newSince ? ' <span class="tag new">new</span>' : ''}</td>
      <td>${esc(c.value)}</td>
      <td><span class="pkg">${esc(c.package)}</span></td>
      <td class="desc">${esc(c.description)}${c.icType ? ` <span class="tag">${esc(c.icType)}</span>` : ''}${isProduction(c) ? ' <span class="tag prod" title="Production stock, not released">production</span>' : isProdStock(c) ? ' <span class="tag rel" title="Released by production for common use">released</span>' : ''}</td>
      <td>${esc(c.category || '')}</td>
      <td>${esc(c.manufacturer || '')}</td>
      <td class="num"><span class="qty ${qtyClass(c.qty)}">${c.qty}</span></td>
      ${showOwner ? `<td>${esc(c.ownerName)}${c.ownerUid === myUid() ? ' <span class="you">you</span>' : ''}</td>` : ''}
      ${showProject ? `<td>${esc(c.project || '')}</td>` : ''}
      ${opt.date ? `<td class="nowrap" title="${esc(fmtDateTime(c.lastAddedAt || c.createdAt))}">${esc(timeAgo(c.lastAddedAt || c.createdAt))}</td>` : ''}
      <td class="actions">${rowActions(c)}</td>
    </tr>`).join('')}</tbody></table></div>
    ${list.length > MAX_ROWS ? `<p class="muted small">Showing first ${MAX_ROWS} of ${list.length}. Refine your search to see more.</p>` : ''}`;
}

const SORTS = {
  pn: (a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true, sensitivity: 'base' }),
  qty: (a, b) => a.qty - b.qty,
  qtyd: (a, b) => b.qty - a.qty,
  new: (a, b) => (toDate(b.lastAddedAt || b.createdAt) || 0) - (toDate(a.lastAddedAt || a.createdAt) || 0),
  owner: (a, b) => (a.ownerName || '').localeCompare(b.ownerName || ''),
};

const NO_CAT = '__none';
const LIST_CFG = {
  search: {
    key: 'search', outToggle: true, sort: 'pn', categories: true,
    predicate: () => () => true,
    placeholder: 'Search anything: part number, value (10k, 100nF), size (0603), description (buck, LDO)…',
  },
  new: {
    key: 'new', sort: 'new', date: true, days: true, feed: true,
    predicate: st => c => isRecent(c, st.days),
    intro: 'Components added or restocked recently by everyone in the team.',
    empty: 'No components were added in this period.',
  },
  low: {
    key: 'low', sort: 'qty',
    predicate: () => isLow,
    intro: `Items with fewer than ${LOW_STOCK_THRESHOLD} pieces left. Reorder soon.`,
    empty: 'Nothing is running low.',
  },
  out: {
    key: 'out', sort: 'pn',
    predicate: () => isOut,
    intro: 'Items with 0 pieces left. Owners can click <b>Restock</b> after buying more.',
    empty: 'Nothing is out of stock.',
  },
};

function renderList(el, cfg) {
  const st = S.ui[cfg.key] ||= { q: '', pkg: '', cat: '', owner: '', proj: '', out: false, sort: cfg.sort, days: 30 };
  el.innerHTML = `
    ${cfg.intro ? `<p class="intro">${cfg.intro}</p>` : ''}
    ${cfg.feed ? '<div id="feed"></div>' : ''}
    <div class="toolbar">
      <input id="q" class="search" type="search" autocomplete="off" placeholder="${esc(cfg.placeholder || 'Search in this list…')}" value="${esc(st.q)}">
      <div class="filters">
        <select id="f-pkg" title="Package / size"></select>
        <select id="f-cat" title="Category"></select>
        <select id="f-owner" title="Held by"></select>
        <select id="f-proj" title="Project"></select>
        ${cfg.days ? `<select id="f-days" title="Period">${[7, 30, 90, 365].map(d => `<option value="${d}" ${st.days === d ? 'selected' : ''}>Last ${d} days</option>`).join('')}</select>` : ''}
        <select id="f-sort" title="Sort">
          ${[['pn', 'Part number A–Z'], ['qty', 'Qty: low → high'], ['qtyd', 'Qty: high → low'], ['new', 'Newest first'], ['owner', 'Held by']]
            .map(([v, l]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        ${cfg.outToggle ? `<label class="chk"><input type="checkbox" id="f-out" ${st.out ? 'checked' : ''}> Include out of stock</label>` : ''}
        ${iAmProduction() ? '' : `<label class="chk prod-chk" title="Show parts held by the production team"><input type="checkbox" id="f-prod" ${showProd ? 'checked' : ''}> Show production inventory</label>`}
      </div>
    </div>
    <div id="summary" class="summary"></div>
    <div id="results"></div>`;

  const fill = (id, label, values, cur) => {
    const s = $('#' + id, el);
    s.innerHTML = `<option value="">${label}</option>` +
      values.map(v => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  };

  const update = () => {
    const pred = cfg.predicate(st);
    const prodHidden = S.components.filter(c => pred(c) && hideProd(c)).length;
    const base = visibleComps().filter(pred);
    fill('f-pkg', 'All sizes / packages', uniqSorted(base.map(c => c.package)), st.pkg);
    fill('f-cat', 'All categories', uniqSorted(base.map(c => c.category)), st.cat);
    fill('f-owner', 'All engineers', uniqSorted(base.map(c => c.ownerName)), st.owner);
    fill('f-proj', 'All projects', uniqSorted(base.map(c => c.project)), st.proj);
    if (st.cat === NO_CAT && base.some(c => !c.category)) $('#f-cat', el).insertAdjacentHTML('beforeend', `<option value="${NO_CAT}" selected>Uncategorized</option>`);
    const catOf = c => c.category || NO_CAT;
    let list = base.filter(c =>
      (!st.pkg || c.package === st.pkg) && (!st.cat || catOf(c) === st.cat) &&
      (!st.owner || c.ownerName === st.owner) && (!st.proj || c.project === st.proj) && matchQuery(c, st.q));
    let hiddenOut = 0;
    if (cfg.outToggle && !st.out) { const before = list.length; list = list.filter(c => c.qty > 0); hiddenOut = before - list.length; }
    list.sort(SORTS[st.sort] || SORTS.pn);
    const pcs = list.reduce((s, c) => s + c.qty, 0);
    const outNote = (hiddenOut ? ` · <span class="muted">${hiddenOut} out-of-stock hidden (see <a href="#out">Out of Stock</a>)</span>` : '') +
      (prodHidden ? ` · <span class="muted">${prodHidden} production item${prodHidden === 1 ? '' : 's'} hidden</span>` : '');

    // Search page with nothing typed or filtered: show categories instead of every component.
    const browsing = cfg.categories && !st.q.trim() && !st.cat && !st.pkg && !st.owner && !st.proj && !st.showAll;
    if (browsing) {
      const cats = new Map();
      for (const c of list) {
        const k = catOf(c);
        const g = cats.get(k) || { n: 0, pcs: 0, low: 0 };
        g.n++; g.pcs += c.qty; if (isLow(c)) g.low++;
        cats.set(k, g);
      }
      const keys = [...cats.keys()].sort((a, b) => (a === NO_CAT) - (b === NO_CAT) || a.localeCompare(b));
      $('#summary', el).innerHTML = `<b>${keys.length}</b> categories · <b>${list.length}</b> items · <b>${pcs.toLocaleString()}</b> pcs${outNote}
        · <button class="link" type="button" data-showall>Show all components</button>`;
      $('#results', el).innerHTML = keys.length ? `<div class="cat-grid">${keys.map(k => {
        const g = cats.get(k);
        const name = k === NO_CAT ? 'Uncategorized' : k;
        return `<button type="button" class="cat-tile" data-cat="${esc(k)}">
          <span class="cat-badge">${esc(name.slice(0, 2))}</span>
          <span class="cat-name">${esc(name)}</span>
          <span class="cat-meta">${g.n} item${g.n === 1 ? '' : 's'} · ${g.pcs.toLocaleString()} pcs${g.low ? ` · <span class="text-warn">${g.low} low</span>` : ''}</span>
        </button>`;
      }).join('')}</div>` : `<div class="empty">No components yet.</div>`;
      return;
    }
    const crumb = cfg.categories && (st.cat || st.showAll) && !st.q.trim()
      ? `<button class="link" type="button" data-allcats>← All categories</button> · ` : '';
    $('#summary', el).innerHTML = crumb + (st.cat ? `<b>${esc(st.cat === NO_CAT ? 'Uncategorized' : st.cat)}</b> · ` : '') +
      `<b>${list.length}</b> item${list.length === 1 ? '' : 's'} · <b>${pcs.toLocaleString()}</b> pcs` + outNote;
    $('#results', el).innerHTML = componentTable(list, { date: cfg.date, empty: cfg.empty, newSince: cfg.key === 'new' ? S.newSince : null });
    if (cfg.feed) $('#feed', el).innerHTML = activityFeed();
  };

  const q = $('#q', el);
  q.addEventListener('input', debounce(() => { st.q = q.value; update(); }, 120));
  for (const [id, k] of [['f-pkg', 'pkg'], ['f-cat', 'cat'], ['f-owner', 'owner'], ['f-proj', 'proj'], ['f-sort', 'sort']])
    $('#' + id, el).addEventListener('change', e => { st[k] = e.target.value; update(); });
  $('#f-days', el)?.addEventListener('change', e => { st.days = Number(e.target.value); update(); });
  $('#f-out', el)?.addEventListener('change', e => { st.out = e.target.checked; update(); });
  $('#f-prod', el)?.addEventListener('change', e => {
    showProd = e.target.checked; // applies to every list and the menu counts, and is remembered
    try { localStorage.setItem('riod.showProd', showProd ? '1' : '0'); } catch { /* ignore */ }
    update(); updateNavCounts();
  });
  // (#view itself lives across pages, so listen on its fresh children, not on el)
  const onNav = e => {
    const tile = e.target.closest('[data-cat]');
    if (tile) { st.cat = tile.dataset.cat; update(); window.scrollTo(0, 0); return; }
    if (e.target.closest('[data-showall]')) { st.showAll = true; update(); return; }
    if (e.target.closest('[data-allcats]')) { st.cat = ''; st.showAll = false; update(); }
  };
  $('#results', el).addEventListener('click', onNav);
  $('#summary', el).addEventListener('click', onNav);
  update();
  if (cfg.key === 'search') q.focus();
  return update;
}

function activityFeed() {
  const items = S.activity.filter(a => !hideProdActivity(a)).slice(0, 8);
  if (!items.length) return '';
  return `<div class="card feed"><h4>Recent activity</h4><ul>${items.map(a => {
    const who = `<b>${esc(a.byName)}</b>`;
    const txt = a.type === 'release'
      ? `${who} released <b>${a.count}</b> production component${a.count === 1 ? '' : 's'} (${a.totalQty} pcs) for common use`
      : a.type === 'bom'
      ? `${who} imported <b>${a.count}</b> components (${a.totalQty} pcs) into <b>${esc(a.project)}</b>`
      : `${who} added <b>${a.qty}</b> × ${esc(vp(a))} — ${esc(a.description)} <span class="muted">(${esc(a.partNumber)})</span>`;
    return `<li>${txt}<span class="muted small"> · ${esc(timeAgo(a.createdAt))}</span></li>`;
  }).join('')}</ul></div>`;
}

// ---------------------------------------------------------------------
//  My Inventory
// ---------------------------------------------------------------------
function renderMy(el) {
  const st = S.ui.my ||= { proj: '', q: '' };
  let collapsed = false;
  try { collapsed = localStorage.getItem('riod.projCollapsed') === '1'; } catch { /* ignore */ }
  el.innerHTML = `
    <div class="my-layout ${collapsed ? 'proj-collapsed' : ''}">
      <aside class="card proj-list">
        <div class="proj-head"><h4>My projects</h4>
          <button type="button" class="icon-btn proj-toggle" id="projToggle" title="Hide the project panel (use ☰ to pick a project)" aria-label="Hide project panel">‹</button></div>
        <div id="projs"></div></aside>
      <section>
        <div class="toolbar">
          <div class="proj-dd" id="projDD">
            <button type="button" class="btn proj-dd-btn" id="projBtn" aria-haspopup="true" aria-expanded="false" title="Select project">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
              <span id="projBtnLabel">All projects</span><span class="caret">▾</span></button>
            <div class="proj-menu hidden" id="projMenu" role="menu"></div>
          </div>
          <input id="q" class="search" type="search" autocomplete="off" placeholder="Search my components…" value="${esc(st.q)}">
          <a class="btn primary" href="#add">+ Add component</a>
          <a class="btn" href="#import">Import BOM</a>
        </div>
        <div id="summary" class="summary"></div>
        <div id="selBar" class="sel-bar hidden"></div>
        <div id="results" class="selectable"></div>
      </section>
    </div>`;

  // ---- Multi-select like on a PC: Ctrl+click adds/removes a row, Shift+click selects a range ----
  const sel = new Set();
  let anchor = null;
  const rowIds = () => $$('#results tr.clickable', el).map(tr => tr.dataset.id);
  const paintSel = () => {
    for (const id of [...sel]) { const c = findComp(id); if (!c || c.ownerUid !== myUid()) sel.delete(id); }
    $$('#results tr.clickable', el).forEach(tr => tr.classList.toggle('selected', sel.has(tr.dataset.id)));
    const bar = $('#selBar', el);
    if (!sel.size) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
    const list = [...sel].map(findComp);
    const pcs = list.reduce((s, c) => s + c.qty, 0);
    const toRelease = list.filter(c => canRelease(c) && !c.released).length;
    const toRevert = list.filter(c => canRelease(c) && c.released).length;
    bar.innerHTML = `<span><b>${sel.size}</b> selected · ${pcs.toLocaleString()} pcs</span>
      ${toRelease ? `<button class="btn sm primary" type="button" data-bulk="release">Release for common use (${toRelease})</button>` : ''}
      ${toRevert ? `<button class="btn sm" type="button" data-bulk="revert">Make production-only (${toRevert})</button>` : ''}
      <button class="btn sm danger" type="button" data-bulk="delete">Delete ${sel.size}</button>
      <button class="btn sm ghost" type="button" data-bulk="all">Select all shown</button>
      <button class="btn sm ghost" type="button" data-bulk="clear">Clear (Esc)</button>`;
    bar.classList.remove('hidden');
  };
  const clearSel = () => { sel.clear(); anchor = null; paintSel(); };
  S.clearSel = clearSel; // Esc (see wireShell)
  $('#results', el).addEventListener('mousedown', e => { if (e.shiftKey && e.target.closest('tr.clickable')) e.preventDefault(); }); // no text highlight
  $('#results', el).addEventListener('click', e => {
    const tr = e.target.closest('tr.clickable');
    if (!tr || e.target.closest('button') || !(e.ctrlKey || e.metaKey || e.shiftKey)) return; // plain click opens details
    e.stopPropagation(); // don't open details
    const id = tr.dataset.id;
    if (e.shiftKey && anchor) {
      const ids = rowIds(), a = ids.indexOf(anchor), b = ids.indexOf(id);
      if (!(e.ctrlKey || e.metaKey)) sel.clear();
      if (a >= 0 && b >= 0) ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => sel.add(x));
      else sel.add(id);
    } else {
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      anchor = id;
    }
    paintSel();
  });
  $('#selBar', el).addEventListener('click', async e => {
    const b = e.target.closest('[data-bulk]');
    if (!b) return;
    const list = [...sel].map(findComp).filter(Boolean);
    const act = b.dataset.bulk;
    if (act === 'clear') return clearSel();
    if (act === 'all') { rowIds().forEach(x => sel.add(x)); return paintSel(); }
    const done = act === 'delete' ? await deleteComps(list) : await setReleased(list, act === 'release');
    if (done) clearSel();
  });

  const layout = $('.my-layout', el);
  const menu = $('#projMenu', el), btn = $('#projBtn', el);
  const setCollapsed = c => {
    layout.classList.toggle('proj-collapsed', c);
    try { localStorage.setItem('riod.projCollapsed', c ? '1' : '0'); } catch { /* ignore */ }
  };
  const openMenu = open => { menu.classList.toggle('hidden', !open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };

  const update = () => {
    const mine = S.components.filter(c => c.ownerUid === myUid());
    const projects = uniqSorted(mine.map(c => c.project || 'General'));
    if (st.proj && !projects.includes(st.proj)) st.proj = '';
    const count = p => mine.filter(c => (c.project || 'General') === p).length;
    const items = [['', 'All projects', mine.length], ...projects.map(p => [p, p, count(p)])];
    $('#projs', el).innerHTML =
      items.map(([v, l, n]) => `<button class="proj ${st.proj === v ? 'active' : ''}" data-proj="${esc(v)}">${esc(l)} <span>${n}</span></button>`).join('') +
      (projects.length ? '' : '<p class="muted small">No projects yet.</p>');
    menu.innerHTML = items.map(([v, l, n]) =>
      `<button type="button" role="menuitem" class="proj ${st.proj === v ? 'active' : ''}" data-proj="${esc(v)}">${esc(l)} <span>${n}</span></button>`).join('') +
      `<div class="proj-menu-sep"></div><button type="button" role="menuitem" class="proj proj-panel-toggle" data-panel>
        ${layout.classList.contains('proj-collapsed') ? 'Show project panel' : 'Hide project panel'}</button>`;
    $('#projBtnLabel', el).textContent = st.proj || 'All projects';
    const list = mine.filter(c => (!st.proj || (c.project || 'General') === st.proj) && matchQuery(c, st.q)).sort(SORTS.pn);
    const pcs = list.reduce((s, c) => s + c.qty, 0);
    const lowN = list.filter(isLow).length, outN = list.filter(isOut).length;
    $('#summary', el).innerHTML = `<b>${list.length}</b> items · <b>${pcs.toLocaleString()}</b> pcs` +
      (lowN ? ` · <span class="text-warn">${lowN} low</span>` : '') + (outN ? ` · <span class="text-bad">${outN} out of stock</span>` : '') +
      (list.length > 1 ? ` · <span class="muted">Tip: <kbd>Ctrl</kbd>+click or <kbd>Shift</kbd>+click to select several</span>` : '');
    if (!mine.length) {
      $('#results', el).innerHTML = `<div class="empty">You have not added any components yet.<br><a href="#add">Add a component</a> or <a href="#import">import a BOM</a>.</div>`;
      return;
    }
    const groups = st.proj ? [st.proj] : uniqSorted(list.map(c => c.project || 'General'));
    $('#results', el).innerHTML = groups.map(p => {
      const g = list.filter(c => (c.project || 'General') === p).sort(byCategory); // resistors, then caps, then ICs…
      if (!g.length) return '';
      return `<div class="group"><h3 class="group-title">${icon('box')} ${esc(p)} <span class="muted small">${g.length} items</span></h3>${componentTable(g, { owner: false, project: false, catHeads: true })}</div>`;
    }).join('') || '<div class="empty">No matching components.</div>';
    paintSel();
  };

  $('#projToggle', el).addEventListener('click', () => { setCollapsed(true); update(); });
  btn.addEventListener('click', () => openMenu(menu.classList.contains('hidden')));
  // Close the dropdown when focus leaves it (click elsewhere, Tab away) or on Escape.
  $('#projDD', el).addEventListener('focusout', e => { if (!$('#projDD', el).contains(e.relatedTarget)) openMenu(false); });
  $('#projDD', el).addEventListener('keydown', e => { if (e.key === 'Escape') { openMenu(false); btn.focus(); } });
  const pick = e => {
    if (e.target.closest('[data-panel]')) { setCollapsed(!layout.classList.contains('proj-collapsed')); openMenu(false); update(); return; }
    const b = e.target.closest('[data-proj]');
    if (!b) return;
    st.proj = b.dataset.proj;
    openMenu(false);
    update();
  };
  $('#projs', el).addEventListener('click', pick);
  menu.addEventListener('click', pick);
  const q = $('#q', el);
  q.addEventListener('input', debounce(() => { st.q = q.value; update(); }, 120));
  update();
  return update;
}

// ---------------------------------------------------------------------
//  Component form (shared by Add and Edit)
// ---------------------------------------------------------------------
function componentFields(c = {}, editing = false) {
  // Fixed 4-column layout. "IC type" takes the Value slot for ICs (ICs don't need a value),
  // so nothing jumps around when the category changes.
  const isIC = BOM.isIcCat(c.category);
  const need = BOM.needsValue(c.category);
  return `
  <div class="cf-grid">
    <label class="span2">Part Number <i>*</i><input name="partNumber" required value="${esc(c.partNumber)}" placeholder="e.g. RC0603FR-0710KL"></label>
    <label>Manufacturer<input name="manufacturer" list="dl-mfrs" value="${esc(c.manufacturer)}" placeholder="TI, Yageo, Murata…"></label>
    <label>Category<select name="category"><option value="">— Select —</option>${CATEGORIES.map(x => `<option ${c.category === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}${c.category && !CATEGORIES.includes(c.category) ? `<option selected>${esc(c.category)}</option>` : ''}</select></label>
    <label class="span4">Description <i>*</i><input name="description" required value="${esc(c.description)}" placeholder="What part is it, e.g. Resistor 10k 1% 1/10W, or Buck converter 3A 17V input"></label>
    <label class="val-only ${isIC ? 'hidden' : ''}">Value <i class="val-req ${need ? '' : 'hidden'}">*</i><span class="val-opt opt ${need ? 'hidden' : ''}">(R, L, C only)</span><input name="value" value="${esc(c.value)}" placeholder="10k, 100nF, 4.7uH"></label>
    <label class="ic-only ${isIC ? '' : 'hidden'}">IC / Module type<input name="icType" list="dl-ictypes" value="${esc(c.icType)}" placeholder="Buck, LDO, MCU, GSM module…"></label>
    <label>Package / Size <i>*</i><input name="package" list="dl-packages" required value="${esc(c.package)}" placeholder="0402, 0603, SOT-23"></label>
    <label>${editing ? 'Qty in stock' : 'Quantity'} <i>*</i><input name="qty" type="number" min="0" step="1" required value="${c.qty ?? ''}" placeholder="0"></label>
    <label>Project<input name="project" list="dl-projects" value="${esc(c.project)}" placeholder="General"></label>
  </div>`;
}

function wireComponentForm(form) {
  const cat = form.querySelector('[name=category]');
  const icLabel = form.querySelector('.ic-only');
  const valLabel = form.querySelector('.val-only');
  const showIc = isIC => { icLabel.classList.toggle('hidden', !isIC); valLabel.classList.toggle('hidden', isIC); };
  const desc = form.querySelector('[name=description]');
  const val = form.querySelector('[name=value]');
  // Value is only needed for parts whose value matters (R, L, C, ...); fill it from the description when possible.
  const syncValue = () => {
    const need = BOM.needsValue(cat.value);
    form.querySelector('.val-req').classList.toggle('hidden', !need);
    form.querySelector('.val-opt').classList.toggle('hidden', need);
    val.placeholder = need ? '10k, 100nF, 4.7uH, 16MHz' : 'Not needed for this part';
    if (need && !val.value.trim()) val.value = BOM.extractValue(desc.value, cat.value);
  };
  cat.addEventListener('change', () => { showIc(BOM.isIcCat(cat.value)); syncValue(); });
  desc.addEventListener('blur', () => {
    if (!cat.value) {
      const g = BOM.guessCategory('', `${desc.value} ${val.value}`);
      if (g) {
        cat.value = g; showIc(BOM.isIcCat(g));
        if (BOM.isIcCat(g) && !form.querySelector('[name=icType]').value) form.querySelector('[name=icType]').value = BOM.guessIcType(desc.value);
      }
    }
    syncValue();
  });
}

function readComponentForm(form) {
  const g = k => String(form.querySelector(`[name=${k}]`)?.value ?? '').trim();
  const qtyRaw = g('qty');
  return {
    partNumber: g('partNumber'), value: g('value'), package: g('package'), description: g('description'),
    category: g('category'), icType: BOM.isIcCat(g('category')) ? g('icType') : '', manufacturer: g('manufacturer'),
    qty: /^\d+$/.test(qtyRaw) ? parseInt(qtyRaw, 10) : NaN,
    project: g('project') || 'General',
  };
}

function validateComp(d) {
  const miss = [];
  if (!d.partNumber) miss.push('Part Number');
  if (!d.value && BOM.needsValue(d.category)) miss.push(`Value (needed for a ${d.category.toLowerCase()})`);
  if (!d.package) miss.push('Package / Size');
  if (!d.description) miss.push('Description');
  if (!Number.isInteger(d.qty) || d.qty < 0) miss.push('Quantity (whole number)');
  return miss.length ? `Please fill: ${miss.join(', ')}` : '';
}

function newComponentDoc(d, src) {
  const cut = (s, n = 500) => String(s ?? '').trim().slice(0, n);
  return {
    partNumber: cut(d.partNumber, 200), value: cut(d.value, 200), package: cut(d.package, 200),
    description: cut(d.description), category: cut(d.category, 100), icType: cut(d.icType, 100),
    manufacturer: cut(d.manufacturer, 200), qty: d.qty, project: cut(d.project || 'General', 200),
    sourceType: src.sourceType, sourceName: src.sourceName, vendorId: src.vendorId,
    ownerUid: myUid(), ownerName: S.profile.name,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastAddedAt: serverTimestamp(),
  };
}

// ---- Vendor contact people (several per vendor) ----
// Stored as vendor.contacts = [{name, designation, phone, email}]. Older vendors only have
// contact/phone/email fields; those are read as one person. The first person is also
// mirrored into contact/phone/email so older views keep working.
function vendorContacts(v) {
  if (!v) return [];
  if (Array.isArray(v.contacts)) return v.contacts;
  return v.contact || v.phone || v.email ? [{ name: v.contact || '', designation: '', phone: v.phone || '', email: v.email || '' }] : [];
}
const contactLine = p => [p.name && (p.designation ? `${p.name} (${p.designation})` : p.name), p.phone, p.email].filter(Boolean).join(' · ');
const vendorSearchText = v => [v.name, v.notes, ...vendorContacts(v).flatMap(p => [p.name, p.designation, p.phone, p.email])].join(' ').toLowerCase();
function contactsData(list) {
  const contacts = list.filter(p => p.name || p.phone || p.email);
  const first = contacts[0] || {};
  return { contacts, contact: first.name || '', phone: first.phone || '', email: first.email || '' };
}
const sameContacts = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function contactRow(p = {}) {
  return `<div class="ct-row">
    <input data-k="name" placeholder="Name" value="${esc(p.name)}" aria-label="Contact name">
    <input data-k="designation" placeholder="Designation (optional)" value="${esc(p.designation)}" aria-label="Designation">
    <input data-k="phone" placeholder="Phone" value="${esc(p.phone)}" aria-label="Phone">
    <input data-k="email" type="email" placeholder="Email" value="${esc(p.email)}" aria-label="Email">
    <button type="button" class="icon-btn ct-del" title="Remove this person" aria-label="Remove this person">×</button>
  </div>`;
}
function contactsEditor(list) {
  return `<div class="contacts">
    <div class="ct-head"><span>Contact people</span></div>
    <div class="ct-list">${(list.length ? list : [{}]).map(contactRow).join('')}</div>
    <button type="button" class="btn sm ct-add">+ Add another person</button>
  </div>`;
}
function setContacts(root, list) {
  root.querySelector('.ct-list').innerHTML = (list.length ? list : [{}]).map(contactRow).join('');
}
function wireContacts(root) {
  const box = root.querySelector('.contacts');
  if (!box) return;
  box.addEventListener('click', e => {
    if (e.target.closest('.ct-add')) {
      box.querySelector('.ct-list').insertAdjacentHTML('beforeend', contactRow());
      box.querySelector('.ct-row:last-child input').focus();
    } else if (e.target.closest('.ct-del')) {
      const rows = box.querySelectorAll('.ct-row');
      if (rows.length > 1) e.target.closest('.ct-row').remove();
      else rows[0].querySelectorAll('input').forEach(i => { i.value = ''; });
    }
  });
}
function readContacts(root) {
  return [...root.querySelectorAll('.ct-row')].map(r => {
    const p = {};
    r.querySelectorAll('input[data-k]').forEach(i => { p[i.dataset.k] = i.value.trim(); });
    return p;
  }).filter(p => p.name || p.phone || p.email || p.designation);
}

// ---- Source: Online site / Vendor (with autocomplete of saved vendors) ----
function sourceFields(c = {}) {
  const isV = c.sourceType === 'vendor';
  const v = isV && c.vendorId ? S.vendors.find(x => x.id === c.vendorId) : null;
  return `
  <fieldset class="source" data-vendor-id="${esc(isV ? c.vendorId || '' : '')}">
    <legend>Source — where was it bought from?</legend>
    <div class="seg">
      <label><input type="radio" name="srcType" value="online" ${!isV ? 'checked' : ''}> Online</label>
      <label><input type="radio" name="srcType" value="vendor" ${isV ? 'checked' : ''}> Vendor</label>
    </div>
    <div class="src-online ${isV ? 'hidden' : ''}">
      <label>Site name <span class="opt">(optional)</span><input name="site" list="dl-sites" value="${esc(!isV ? c.sourceName || '' : '')}" placeholder="Mouser, DigiKey, LCSC…"></label>
    </div>
    <div class="src-vendor ${isV ? '' : 'hidden'}">
      <div class="ac src-vname"><label>Vendor name <span class="opt">(optional)</span><input name="vendorName" autocomplete="off" value="${esc(isV ? c.sourceName || '' : '')}" placeholder="Start typing to pick a saved vendor"></label><div class="ac-list hidden"></div></div>
      ${contactsEditor(vendorContacts(v))}
    </div>
  </fieldset>`;
}

function wireSource(root) {
  const fs = root.querySelector('fieldset.source');
  if (!fs) return;
  fs.querySelectorAll('input[name=srcType]').forEach(r => r.addEventListener('change', () => {
    const v = fs.querySelector('input[name=srcType]:checked').value;
    fs.querySelector('.src-online').classList.toggle('hidden', v !== 'online');
    fs.querySelector('.src-vendor').classList.toggle('hidden', v !== 'vendor');
  }));
  wireContacts(fs);
  const inp = fs.querySelector('[name=vendorName]');
  const list = fs.querySelector('.ac-list');
  let items = [], active = -1;
  const pick = v => {
    inp.value = v.name;
    setContacts(fs, vendorContacts(v));
    fs.dataset.vendorId = v.id;
    list.classList.add('hidden');
  };
  const show = () => {
    const t = inp.value.trim().toLowerCase();
    items = S.vendors.filter(v => !t || vendorSearchText(v).includes(t)).slice(0, 8);
    active = -1;
    if (!items.length) { list.classList.add('hidden'); return; }
    list.innerHTML = items.map((v, i) => {
      const ps = vendorContacts(v);
      const sub = ps.length ? contactLine(ps[0]) + (ps.length > 1 ? ` +${ps.length - 1} more` : '') : 'no contact saved';
      return `<div class="ac-item" data-i="${i}"><strong>${esc(v.name)}</strong><span>${esc(sub)}</span></div>`;
    }).join('');
    list.classList.remove('hidden');
  };
  inp.addEventListener('input', () => { fs.dataset.vendorId = ''; show(); });
  inp.addEventListener('focus', show);
  inp.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
  inp.addEventListener('keydown', e => {
    if (list.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      $$('.ac-item', list).forEach((x, i) => x.classList.toggle('active', i === active));
    } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); e.stopPropagation(); pick(items[active]); }
    else if (e.key === 'Escape') list.classList.add('hidden');
  });
  list.addEventListener('mousedown', e => {
    const it = e.target.closest('.ac-item');
    if (!it) return;
    e.preventDefault();
    pick(items[Number(it.dataset.i)]);
  });
}

function readSource(root) {
  const fs = root.querySelector('fieldset.source');
  const g = k => String(fs.querySelector(`[name=${k}]`)?.value ?? '').trim();
  return {
    type: fs.querySelector('input[name=srcType]:checked')?.value || 'online',
    site: g('site'), vendorName: g('vendorName'), contacts: readContacts(fs), vendorId: fs.dataset.vendorId || '',
  };
}

// Saves a new vendor if needed; returns the source fields stored on the component.
async function resolveSource(src) {
  if (src.type !== 'vendor') return { sourceType: 'online', sourceName: src.site, vendorId: '' };
  if (!src.vendorName) return { sourceType: 'vendor', sourceName: '', vendorId: '' };
  let v = (src.vendorId && S.vendors.find(x => x.id === src.vendorId)) ||
    S.vendors.find(x => (x.name || '').toLowerCase() === src.vendorName.toLowerCase());
  if (v) {
    // Save edited contact people (an emptied list doesn't wipe the saved ones).
    if (src.contacts.length && !sameContacts(src.contacts, vendorContacts(v)))
      await updateDoc(doc(db, 'vendors', v.id), { ...contactsData(src.contacts), updatedAt: serverTimestamp() });
    return { sourceType: 'vendor', sourceName: v.name, vendorId: v.id };
  }
  const ref = await addDoc(collection(db, 'vendors'), {
    name: src.vendorName, ...contactsData(src.contacts), notes: '',
    createdBy: myUid(), createdByName: S.profile.name, createdAt: serverTimestamp(),
  });
  return { sourceType: 'vendor', sourceName: src.vendorName, vendorId: ref.id };
}

// ---------------------------------------------------------------------
//  Add Component
// ---------------------------------------------------------------------
function renderAdd(el) {
  el.innerHTML = `
    <form id="addForm" class="card form add-form" novalidate>
      <div class="card-head"><h3>Component</h3><span class="muted small"><i>*</i> required · the team gets a desktop notification</span></div>
      ${componentFields({ project: S.ui.lastProject || '' })}
      ${sourceFields({})}
      <div class="form-actions">
        <button class="btn primary" type="submit">Add component</button>
        <button class="btn ghost" type="button" id="clear">Clear</button>
      </div>
    </form>`;
  const form = $('#addForm', el);
  wireComponentForm(form);
  wireSource(form);
  $('#clear', el).onclick = () => route();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = readComponentForm(form);
    const err = validateComp(d);
    if (err) { toast(err, 'error'); return; }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const existing = S.components.find(c => c.ownerUid === myUid() && keyOf(c.partNumber, c.project, c.value) === keyOf(d.partNumber, d.project, d.value));
      if (existing) {
        const ok = await confirmDialog('Already in your inventory',
          `You already have <b>${existing.qty}</b> × <b>${esc(existing.partNumber)}</b> in project <b>${esc(existing.project)}</b>.<br>Add <b>${d.qty}</b> more to that stock (new total ${existing.qty + d.qty})?`,
          'Add to existing');
        if (!ok) return;
      }
      const src = await resolveSource(readSource(form));
      let id;
      if (existing) {
        id = existing.id;
        await updateDoc(doc(db, 'components', id), { qty: increment(d.qty), lastAddedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      } else {
        id = (await addDoc(collection(db, 'components'), newComponentDoc(d, src))).id;
      }
      await logTx({ componentId: id, partNumber: d.partNumber, type: existing ? 'restock' : 'added', delta: d.qty });
      await addDoc(collection(db, 'activity'), {
        type: 'add', byUid: myUid(), byName: S.profile.name, qty: d.qty, value: d.value, package: d.package,
        description: d.description, partNumber: d.partNumber, project: d.project, createdAt: serverTimestamp(),
      });
      S.ui.lastProject = d.project; // project is remembered; source is per component so it is not
      toast(`Added ${d.qty} × ${d.partNumber}`, 'success');
      route(); // fresh form, keeps last project & source
    } catch (err2) {
      console.error(err2);
      if (err2.code === 'permission-denied')
        toast(`Could not save: the database rejected it. The Firestore rules in Firebase are probably an older version
          (the old rules reject parts with no Value, such as ICs). Ask the admin to publish the latest <b>firestore.rules</b>.`, 'error', 15000, true);
      else toast(err2.message, 'error', 6000);
    } finally { btn.disabled = false; }
  });
  return null;
}

function logTx(t) {
  return addDoc(collection(db, 'transactions'), {
    note: '', toName: '', ...t, byUid: myUid(), byName: S.profile.name, createdAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------
//  Import BOM / Excel
// ---------------------------------------------------------------------
function renderImport(el) {
  const st = { wb: null, fileName: '', sheet: '', rows: [], headerIdx: 0, headers: [], map: {}, items: [], onlyBad: false };
  el.innerHTML = `
    <div class="notice warn">
      <strong>Before you import:</strong> add a separate column named <b>Stock Qty</b> to your Excel / BOM file.
      The stock quantity is read <u>only</u> from the <b>Stock Qty</b> column. The BOM's per-board "Qty" or "Quantity" column is ignored.
      <br>Mandatory columns: <b>Part Number</b>, <b>Package / Size</b>, <b>Description</b> and <b>Stock Qty</b>.
      The <b>value</b> (10k, 100nF, 4.7uH…) is read from the description, and only resistors, capacitors, inductors, ferrite beads, crystals and fuses need one.
      Optional: Manufacturer, Category, Designator, Project, and <b>Source</b> (where each part was bought: a site like Mouser / LCSC, or a vendor name).
      You can also set or change the source of each part in the preview below.
      <div class="notice-actions"><button class="btn sm" id="tpl" type="button">Download Excel template</button></div>
    </div>
    <div class="card form" id="importSetup">
      <div class="grid">
        <label class="span2">BOM / Excel file (.xlsx, .xls, .csv)<input type="file" id="file" accept=".xlsx,.xls,.csv"></label>
        <label>Sheet<select id="sheet" disabled><option>—</option></select></label>
        <label>Project name <i>*</i><input id="proj" list="dl-projects" placeholder="e.g. Motor Controller Rev B"></label>
      </div>
    </div>
    <div id="mapping"></div>
    <div id="preview"></div>`;
  $('#tpl', el).onclick = () => BOM.downloadTemplate();
  const projInput = $('#proj', el);
  projInput.addEventListener('input', () => refreshAll());

  $('#file', el).addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      st.wb = await BOM.readWorkbook(f);
      st.fileName = f.name;
      if (!projInput.value.trim()) projInput.value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\bbom\b/ig, '').trim();
      const sel = $('#sheet', el);
      sel.innerHTML = st.wb.SheetNames.map(n => `<option>${esc(n)}</option>`).join('');
      sel.disabled = st.wb.SheetNames.length < 2;
      loadSheet(st.wb.SheetNames[0]);
    } catch (err) { console.error(err); toast('Could not read this file: ' + err.message, 'error', 6000); }
  });
  $('#sheet', el).addEventListener('change', e => loadSheet(e.target.value));

  function loadSheet(name) {
    st.sheet = name;
    st.rows = BOM.sheetRows(st.wb, name);
    st.headerIdx = BOM.detectHeader(st.rows);
    st.headers = st.rows[st.headerIdx] || [];
    st.map = BOM.autoMap(st.headers);
    rebuild();
  }
  function rebuild() {
    st.items = BOM.buildItems(st.rows, st.headerIdx, st.map);
    // A "Vendor"/"Supplier" column means vendor; a "Site"/"Source" column means online unless the name is a saved vendor.
    const srcHeader = st.map.source >= 0 ? BOM.normHeader(st.headers[st.map.source]) : '';
    const headerSaysVendor = /vendor|supplier/.test(srcHeader);
    for (const it of st.items) it.sourceType = classifySource(it.sourceName, headerSaysVendor);
    renderMapping();
    renderPreview();
  }

  function renderMapping() {
    const mp = $('#mapping', el);
    if (!st.rows.length) { mp.innerHTML = '<div class="notice error">This sheet is empty.</div>'; return; }
    const opts = (sel, filter) => `<option value="-1">— not in file —</option>` + st.headers.map((h, j) =>
      (filter && !filter(h)) ? '' : `<option value="${j}" ${sel === j ? 'selected' : ''}>${esc(h || `(column ${j + 1})`)}</option>`).join('');
    // First non-empty cell under the header, so you can see what each column holds.
    const sample = j => {
      if (j < 0) return '';
      for (let r = st.headerIdx + 1; r < Math.min(st.rows.length, st.headerIdx + 30); r++) {
        const v = String(st.rows[r]?.[j] ?? '').trim();
        if (v) return v;
      }
      return '';
    };
    const FIELDS = [
      ['Required', [['partNumber', 'Part Number'], ['description', 'Description'], ['package', 'Package / Size'], ['qty', 'Stock Qty']]],
      ['Optional', [['value', 'Value', 'Backup only; read from the description'], ['manufacturer', 'Manufacturer'], ['category', 'Category'],
        ['designator', 'Designator', 'Used to detect the category'], ['source', 'Source', 'Where each part was bought'], ['project', 'Project', 'Overrides the project name']]],
    ];
    const found = FIELDS.flatMap(([, fs]) => fs).filter(([k]) => st.map[k] >= 0).length;
    mp.innerHTML = `<div class="card map-card">
      <div class="card-head">
        <div><h3>Columns <span class="muted small">${found} of 10 matched</span></h3>
          <p class="muted small">Matched automatically from your file's header row. Change any that are wrong.</p></div>
        <label class="hdr-row">Header row <input type="number" id="hdr" min="1" max="${st.rows.length}" value="${st.headerIdx + 1}"></label>
      </div>
      ${st.map.qty < 0 ? `<div class="notice error">No <b>Stock Qty</b> column found. Add a column named <b>Stock Qty</b> with the quantity you have, save the file and upload it again.</div>` : ''}
      <div class="map-table">
        <div class="map-row map-headrow"><div>Field</div><div>Column in your file</div><div>Example from your file</div></div>
        ${FIELDS.map(([group, fs]) => `<div class="map-group">${group}</div>` + fs.map(([k, label, hint]) => {
          const miss = group === 'Required' && st.map[k] < 0;
          return `<div class="map-row ${miss ? 'unmatched' : ''}">
            <div class="map-name">${esc(label)}${group === 'Required' ? ' <i>*</i>' : ''}${hint ? `<span class="muted small">${esc(hint)}</span>` : ''}</div>
            <div><select data-field="${k}" class="${miss ? 'missing' : ''}">${opts(st.map[k], k === 'qty' ? h => BOM.normHeader(h).includes('stock') : null)}</select></div>
            <div class="map-sample">${st.map[k] >= 0 ? (esc(sample(st.map[k])) || '<span class="muted">(empty)</span>') : '<span class="muted">—</span>'}</div>
          </div>`;
        }).join('')).join('')}
      </div>
      <p class="muted small map-note">Values (10k, 100nF, 4.7uH, 16MHz…) are read from the <b>Description</b>. Only resistors, capacitors, inductors,
        ferrite beads, crystals and fuses need one. The category comes from the designator (R, C, L, U…) or the description.</p>
    </div>`;
    $('#hdr', mp).addEventListener('change', e => {
      const n = Math.max(1, Math.min(st.rows.length, parseInt(e.target.value, 10) || 1));
      st.headerIdx = n - 1; st.headers = st.rows[st.headerIdx] || []; st.map = BOM.autoMap(st.headers); rebuild();
    });
    $$('select[data-field]', mp).forEach(s => s.addEventListener('change', () => { st.map[s.dataset.field] = Number(s.value); rebuild(); }));
  }

  const CELLS = [['partNumber', 'Part Number', true], ['category', 'Category'], ['value', 'Value (R/L/C…)'], ['package', 'Package / Size', true],
    ['description', 'Description', true], ['manufacturer', 'Manufacturer'], ['qty', 'Stock Qty', true],
    ['sourceName', 'Source (bought from)']];

  const cellHtml = (it, i, k) => {
    const inp = `<input class="cell c-${k}" data-i="${i}" data-k="${k}" value="${esc(it[k])}" ${k === 'package' ? 'list="dl-packages"' : ''}${k === 'category' ? 'list="dl-categories"' : ''}${k === 'sourceName' ? `list="dl-sources" placeholder="${it.sourceType === 'vendor' ? 'Vendor name' : 'Site, e.g. Mouser'}"` : ''}>`;
    if (k !== 'sourceName') return `<td>${inp}</td>`;
    return `<td><div class="src-cell"><select class="src-type" data-i="${i}" title="Online site or vendor">
      <option value="online" ${it.sourceType !== 'vendor' ? 'selected' : ''}>Online</option>
      <option value="vendor" ${it.sourceType === 'vendor' ? 'selected' : ''}>Vendor</option></select>${inp}</div></td>`;
  };

  function renderPreview() {
    const pv = $('#preview', el);
    if (!st.items.length) { pv.innerHTML = st.rows.length ? '<div class="notice">No data rows found below the header row.</div>' : ''; return; }
    pv.innerHTML = `<div class="card">
      <div class="preview-head">
        <h3>Preview — nothing is saved until you click Import</h3>
        <div id="pvSummary" class="summary"></div>
        <div class="pv-tools">
          <label class="chk"><input type="checkbox" id="onlyBad" ${st.onlyBad ? 'checked' : ''}> Show only rows with problems</label>
          <button class="btn primary" id="doImport" type="button">Import</button>
        </div>
      </div>
      <div class="table-wrap"><table class="tbl preview">
        <thead><tr><th><input type="checkbox" id="allInc" checked title="Include all"></th><th>Row</th>
          ${CELLS.map(([, l, r]) => `<th>${l}${r ? ' <i>*</i>' : ''}</th>`).join('')}<th>Status</th></tr></thead>
        <tbody>${st.items.map((it, i) => `<tr data-i="${i}">
          <td><input type="checkbox" class="inc" data-i="${i}" ${it.include ? 'checked' : ''}></td>
          <td class="muted">${it.rowNo}</td>
          ${CELLS.map(([k]) => cellHtml(it, i, k)).join('')}
          <td class="status"></td></tr>`).join('')}</tbody>
      </table></div></div>`;

    const tbody = $('tbody', pv);
    tbody.addEventListener('input', e => {
      const t = e.target;
      if (!t.classList.contains('cell')) return;
      const it = st.items[Number(t.dataset.i)];
      it[t.dataset.k] = t.value;
      if (t.dataset.k === 'category') it.icType = BOM.isIcCat(t.value) ? BOM.guessIcType(it.description) : '';
      if ((t.dataset.k === 'category' || t.dataset.k === 'description') && BOM.needsValue(it.category) && !String(it.value).trim()) {
        it.value = BOM.extractValue(it.description, it.category); // e.g. category changed to Resistor -> read "10k" from description
        const vInp = $(`input.cell[data-i="${t.dataset.i}"][data-k="value"]`, pv);
        if (vInp) vInp.value = it.value;
      }
      if (t.dataset.k === 'sourceName' && it.sourceType !== 'vendor' && isSavedVendor(t.value)) {
        it.sourceType = 'vendor'; // typed a saved vendor's name
        const sel = t.parentElement.querySelector('.src-type');
        if (sel) sel.value = 'vendor';
      }
      refreshAll();
    });
    tbody.addEventListener('change', e => {
      if (e.target.classList.contains('src-type')) {
        const it = st.items[Number(e.target.dataset.i)];
        it.sourceType = e.target.value;
        const inp = e.target.parentElement.querySelector('.cell');
        if (inp) inp.placeholder = it.sourceType === 'vendor' ? 'Vendor name' : 'Site, e.g. Mouser';
        return;
      }
      if (!e.target.classList.contains('inc')) return;
      st.items[Number(e.target.dataset.i)].include = e.target.checked;
      refreshAll();
    });
    tbody.addEventListener('click', e => {
      const nc = e.target.closest('[data-nocombine]');
      if (nc) {
        const i = Number(nc.dataset.nocombine);
        [i, ...combinedWith(i)].forEach(j => { st.items[j].noCombine = true; });
        refreshAll();
        toast('Those rows will be imported as separate components. Click "Kept separate" to undo.');
        return;
      }
      const dup = e.target.closest('[data-dup]');
      if (dup) { showDuplicates(Number(dup.dataset.dup)); return; }
      const ex = e.target.closest('[data-exist]');
      if (ex) showDetails(findComp(ex.dataset.exist));
    });
    $('#allInc', pv).addEventListener('change', e => {
      st.items.forEach(it => { it.include = e.target.checked; });
      $$('.inc', pv).forEach(c => { c.checked = e.target.checked; });
      refreshAll();
    });
    $('#onlyBad', pv).addEventListener('change', e => { st.onlyBad = e.target.checked; refreshAll(); });
    $('#doImport', pv).addEventListener('click', doImport);
    refreshAll();
  }

  // Scrolls the preview to a row and flashes it (turns off "only problems" if that row is hidden).
  function goToRow(i) {
    const pv = $('#preview', el);
    if (st.onlyBad) { st.onlyBad = false; const cb = $('#onlyBad', pv); if (cb) cb.checked = false; refreshAll(); }
    const tr = $(`tr[data-i="${i}"]`, pv);
    if (!tr) return;
    tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash');
  }

  const isValid = x => x.include && !BOM.missingFields(x).length;
  const itemKey = x => keyOf(x.partNumber, itemProject(x), x.value); // same part = same PN + project + value
  const pnKey = x => keyOf(x.partNumber, itemProject(x));             // same part number only

  // Rows that will be merged with row i (same part number + value, nobody chose "don't combine").
  const combinedWith = i => {
    const it = st.items[i];
    if (!isValid(it) || it.noCombine) return [];
    return st.items.map((_, j) => j).filter(j => j !== i && isValid(st.items[j]) && !st.items[j].noCombine && itemKey(st.items[j]) === itemKey(it));
  };
  // Rows that reuse row i's part number for a DIFFERENT value (likely a mistake in the BOM).
  const conflictsWith = i => {
    const it = st.items[i];
    if (!isValid(it)) return [];
    return st.items.map((_, j) => j).filter(j => j !== i && isValid(st.items[j]) && pnKey(st.items[j]) === pnKey(it) && itemKey(st.items[j]) !== itemKey(it));
  };

  // Lists every row in the file with the same part number as row i, and what will happen to each.
  function showDuplicates(i) {
    const it = st.items[i];
    const idx = st.items.map((_, j) => j).filter(j => isValid(st.items[j]) && pnKey(st.items[j]) === pnKey(it));
    const merged = combinedWith(i);
    const conflicts = conflictsWith(i);
    const total = [i, ...merged].reduce((s, j) => s + BOM.parseQty(st.items[j].qty), 0);
    const srcTxt = x => x.sourceName ? `${x.sourceType === 'vendor' ? 'Vendor' : 'Online'} · ${x.sourceName}` : '—';
    const outcome = j => {
      const x = st.items[j];
      if (x.noCombine) return '<span class="st muted">Kept separate</span>';
      if (j === i) return merged.length ? '<span class="st info">Combined</span>' : '<span class="st ok">Own component</span>';
      if (merged.includes(j)) return '<span class="st info">Combined with this row</span>';
      return '<span class="st warn">Different value: separate</span>';
    };
    let msg = `Part number <b class="mono">${esc(it.partNumber)}</b> appears in <b>${idx.length} rows</b> of <b>${esc(st.fileName)}</b>.`;
    if (merged.length) msg += `<br>Rows with the <b>same value</b> are imported as <b>one component with ${total.toLocaleString()} pcs</b>. Click <b>Don't combine</b> to keep them as separate entries.`;
    if (conflicts.length) msg += `<br><span class="text-warn">Some rows use this part number for a <b>different value</b>. That is usually a mistake in the BOM, so they are <b>not</b> combined. Check the part number.</span>`;
    const dm = openModal({
      title: `Same part number: ${it.partNumber}`, wide: true,
      body: `<p>${msg}</p>
        <div class="table-wrap"><table class="tbl compact"><thead><tr>
          <th>Row in file</th><th>Designator</th><th>Value</th><th>Package</th><th>Description</th><th class="num">Stock Qty</th><th>Source</th><th>Result</th><th></th></tr></thead>
        <tbody>${idx.map(j => { const x = st.items[j]; return `<tr class="${j === i ? 'current' : ''}">
          <td class="strong">${x.rowNo}${j === i ? ' <span class="you">this row</span>' : ''}</td><td>${esc(x.designator || '—')}</td>
          <td>${esc(x.value || '—')}</td><td>${esc(x.package)}</td><td class="desc">${esc(x.description)}</td>
          <td class="num">${esc(x.qty)}</td><td>${esc(srcTxt(x))}</td><td>${outcome(j)}</td>
          <td class="actions"><button class="btn sm" type="button" data-goto="${j}">Go to row</button></td></tr>`; }).join('')}</tbody></table></div>`,
      actions: [
        ...(merged.length ? [{ label: "Don't combine these rows", onClick: () => { [i, ...merged].forEach(j => { st.items[j].noCombine = true; }); refreshAll(); toast('These rows will be imported as separate components.'); } }] : []),
        ...(st.items[i].noCombine ? [{ label: 'Combine again', onClick: () => { idx.forEach(j => { if (itemKey(st.items[j]) === itemKey(it)) st.items[j].noCombine = false; }); refreshAll(); } }] : []),
        { label: 'Close', cls: 'ghost' },
      ],
    });
    dm.el.addEventListener('click', e => {
      const b = e.target.closest('[data-goto]');
      if (!b) return;
      dm.close();
      goToRow(Number(b.dataset.goto));
    });
  }

  function itemProject(it) { return String(it.project || '').trim() || projInput.value.trim() || 'General'; }

  function refreshAll() {
    const pv = $('#preview', el);
    if (!st.items.length || !$('tbody', pv)) return;
    const mine = new Map(S.components.filter(c => c.ownerUid === myUid()).map(c => [keyOf(c.partNumber, c.project, c.value), c]));
    const rowList = js => js.map(j => st.items[j].rowNo).join(', ');
    let ready = 0, bad = 0, excluded = 0, pcs = 0;
    st.items.forEach((it, i) => {
      const tr = $(`tr[data-i="${i}"]`, pv);
      const miss = BOM.missingFields(it);
      for (const [k, , req] of CELLS) {
        const inp = $(`input.cell[data-k="${k}"]`, tr);
        const isMissing = k === 'qty' ? miss.includes('Stock Qty') : k === 'value' ? miss.includes('Value') : req && !String(it[k]).trim();
        inp.classList.toggle('missing', isMissing);
        if (k === 'value') inp.placeholder = BOM.needsValue(it.category) ? 'needed' : 'not needed';
      }
      let html;
      if (!it.include) { html = '<span class="st muted">Excluded</span>'; excluded++; }
      else if (miss.length) { html = `<span class="st bad">Missing: ${esc(miss.join(', '))}</span>`; bad++; }
      else {
        ready++; pcs += BOM.parseQty(it.qty);
        const ex = it.noCombine ? null : mine.get(itemKey(it));
        const parts = [];
        if (ex) parts.push(`<button type="button" class="st info st-link" data-exist="${ex.id}" title="Open the part already in your inventory">Adds to your existing stock (${ex.qty} now)</button>`);
        const merged = combinedWith(i);
        const conflicts = conflictsWith(i);
        if (it.noCombine) {
          parts.push(`<button type="button" class="st muted st-link" data-dup="${i}" title="Show the rows with this part number">Kept separate (not combined)</button>`);
        } else if (merged.length) {
          parts.push(`<button type="button" class="st info st-link" data-dup="${i}" title="Show where the duplicates are">Duplicate of row ${rowList(merged)}, will be combined</button>` +
            `<button type="button" class="btn sm ghost nocombine" data-nocombine="${i}" title="Import these rows as separate components">Don't combine</button>`);
        }
        if (conflicts.length) {
          parts.push(`<button type="button" class="st warn st-link" data-dup="${i}" title="Same part number, different value. Check the BOM">Same part no. as row ${rowList(conflicts)} but different value, kept separate</button>`);
        }
        html = parts.length ? parts.join(' ') : '<span class="st ok">Ready</span>';
      }
      const cell = $('.status', tr);
      if (cell._html !== html) { cell.innerHTML = html; cell._html = html; } // don't replace buttons the user may be clicking
      tr.classList.toggle('row-bad', it.include && miss.length > 0);
      tr.classList.toggle('row-excluded', !it.include);
      tr.classList.toggle('hidden', st.onlyBad && !(it.include && miss.length > 0));
    });
    $('#pvSummary', pv).innerHTML = `<b>${st.items.length}</b> rows · <span class="text-ok"><b>${ready}</b> ready (${pcs.toLocaleString()} pcs)</span>` +
      (bad ? ` · <span class="text-bad"><b>${bad}</b> with missing fields (will be skipped unless fixed)</span>` : '') +
      (excluded ? ` · <span class="muted">${excluded} excluded</span>` : '');
    const btn = $('#doImport', pv);
    if (!btn.dataset.busy) {
      btn.disabled = !ready || st.map.qty < 0;
      btn.textContent = st.map.qty < 0 ? 'Stock Qty column missing' : `Import ${ready} row${ready === 1 ? '' : 's'}`;
    }
  }

  async function doImport() {
    if (st.map.qty < 0) { toast('Your file needs a "Stock Qty" column.', 'error'); return; }
    const readyItems = st.items.filter(it => it.include && !BOM.missingFields(it).length);
    if (!readyItems.length) { toast('No valid rows to import.', 'error'); return; }
    if (!projInput.value.trim() && readyItems.some(it => !String(it.project || '').trim())) {
      toast('Enter a project name.', 'error'); projInput.focus(); return;
    }
    const groups = new Map();
    for (const it of readyItems) {
      const project = itemProject(it);
      const k = itemKey(it);
      // "Don't combine" rows become their own component (not merged with other rows or existing stock).
      const gk = it.noCombine ? `${k}#row${it.rowNo}` : k;
      const q = BOM.parseQty(it.qty);
      if (groups.has(gk)) groups.get(gk).qty += q;
      else groups.set(gk, {
        _key: k, _separate: !!it.noCombine,
        partNumber: it.partNumber.trim(), value: String(it.value).trim(), package: String(it.package).trim(),
        description: String(it.description).trim(), manufacturer: String(it.manufacturer || '').trim(),
        category: String(it.category || '').trim(), icType: it.icType || '', project, qty: q,
        sourceType: it.sourceType === 'vendor' ? 'vendor' : 'online', sourceName: String(it.sourceName || '').trim(),
      });
    }
    const list = [...groups.values()];
    const mine = new Map(S.components.filter(c => c.ownerUid === myUid()).map(c => [keyOf(c.partNumber, c.project, c.value), c]));
    const existingOf = x => (x._separate ? null : mine.get(x._key));
    const merges = list.filter(existingOf).length;
    const totalQty = list.reduce((s, x) => s + x.qty, 0);
    const skipped = st.items.filter(it => it.include).length - readyItems.length;
    const projects = uniqSorted(list.map(x => x.project));
    const ok = await confirmDialog('Import components',
      `Add <b>${list.length}</b> components (<b>${totalQty.toLocaleString()}</b> pcs) to project <b>${esc(projects.join(', '))}</b>?` +
      (merges ? `<br>${merges} of them already exist in your inventory. Their quantity will be increased.` : '') +
      (skipped ? `<br><span class="text-bad">${skipped} row(s) with missing fields will be skipped.</span>` : ''),
      'Import');
    if (!ok) return;

    const btn = $('#doImport', el);
    btn.dataset.busy = '1'; btn.disabled = true;
    try {
      // Save any vendor names that are not in the vendor directory yet (one entry per name).
      const vendorIds = new Map(S.vendors.map(v => [(v.name || '').trim().toLowerCase(), { id: v.id, name: v.name }]));
      for (const x of list) {
        if (x.sourceType !== 'vendor' || !x.sourceName) continue;
        const k = x.sourceName.toLowerCase();
        if (vendorIds.has(k)) continue;
        const ref = await addDoc(collection(db, 'vendors'), {
          name: x.sourceName, contacts: [], contact: '', phone: '', email: '', notes: '',
          createdBy: myUid(), createdByName: S.profile.name, createdAt: serverTimestamp(),
        });
        vendorIds.set(k, { id: ref.id, name: x.sourceName });
      }
      const srcOf = x => {
        if (x.sourceType !== 'vendor') return { sourceType: 'online', sourceName: x.sourceName, vendorId: '' };
        const v = x.sourceName ? vendorIds.get(x.sourceName.toLowerCase()) : null;
        return { sourceType: 'vendor', sourceName: v ? v.name : '', vendorId: v ? v.id : '' };
      };
      const CHUNK = 200;
      for (let i = 0; i < list.length; i += CHUNK) {
        btn.textContent = `Importing… ${i}/${list.length}`;
        const batch = writeBatch(db);
        for (const x of list.slice(i, i + CHUNK)) {
          const ex = existingOf(x);
          let ref;
          if (ex) {
            ref = doc(db, 'components', ex.id);
            // Restock: keep the old source unless this row says where the new stock came from.
            batch.update(ref, { qty: increment(x.qty), lastAddedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...(x.sourceName ? srcOf(x) : {}) });
          } else {
            ref = doc(collection(db, 'components'));
            batch.set(ref, newComponentDoc(x, srcOf(x)));
          }
          batch.set(doc(collection(db, 'transactions')), {
            componentId: ref.id, partNumber: x.partNumber, type: 'import', delta: x.qty, toName: '',
            note: `BOM: ${st.fileName}`, byUid: myUid(), byName: S.profile.name, createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      await addDoc(collection(db, 'activity'), {
        type: 'bom', byUid: myUid(), byName: S.profile.name, count: list.length, totalQty,
        project: projects.join(', '), fileName: st.fileName, createdAt: serverTimestamp(),
      });
      toast(`Imported ${list.length} components (${totalQty} pcs)`, 'success', 5000);
      S.ui.my = { proj: projects.length === 1 ? projects[0] : '', q: '' };
      location.hash = '#my';
    } catch (err) {
      console.error(err);
      if (err.code === 'permission-denied')
        toast(`Import failed: the database rejected the data. This usually means the Firestore rules in Firebase are an older version
          (for example, the old rules reject parts with no Value, such as ICs). Ask the admin to publish the latest <b>firestore.rules</b>
          (Firebase console → Firestore Database → Rules → paste → Publish), then import again.`, 'error', 20000, true);
      else toast('Import failed: ' + err.message, 'error', 8000);
      delete btn.dataset.busy;
      refreshAll();
    }
  }

  return () => refreshAll(); // live data changes only affect "adds to existing" hints
}

// ---------------------------------------------------------------------
//  Component actions (details / request / take / edit)
// ---------------------------------------------------------------------
const kv = (label, val, raw = false) =>
  `<div class="kv"><span>${esc(label)}</span><div>${raw ? val : esc(val || '—')}</div></div>`;

// ---- Release production stock for common use / revert; delete several at once ----
// Writes in batches (Firestore allows up to 500 writes per batch).
async function batchWrite(list, op) {
  for (let i = 0; i < list.length; i += 400) {
    const b = writeBatch(db);
    for (const c of list.slice(i, i + 400)) op(b, doc(db, 'components', c.id), c);
    await b.commit();
  }
}
const canRelease = c => c.ownerUid === myUid() && isProdStock(c);
async function setReleased(list, release) {
  list = list.filter(c => canRelease(c) && !!c.released !== release);
  if (!list.length) { toast(release ? 'Those parts are already released.' : 'Those parts are already production-only.'); return false; }
  const pcs = list.reduce((s, c) => s + c.qty, 0);
  const what = list.length === 1 ? `<b>${esc(list[0].partNumber)}</b>` : `<b>${list.length}</b> components (${pcs.toLocaleString()} pcs)`;
  const ok = release
    ? await confirmDialog('Release for common use', `Release ${what} for common use?<br>All engineers will see them and can request them.`, 'Release')
    : await confirmDialog('Make production-only', `Make ${what} production-only again?<br>Other engineers will no longer see them (unless they tick "Show production inventory").`, 'Make production-only');
  if (!ok) return false;
  try {
    await batchWrite(list, (b, ref) => b.update(ref, release
      ? { released: true, releasedAt: serverTimestamp(), releasedBy: S.profile.name, lastAddedAt: serverTimestamp(), updatedAt: serverTimestamp() }
      : { released: false, updatedAt: serverTimestamp() }));
    if (release) await addDoc(collection(db, 'activity'), {
      type: 'release', byUid: myUid(), byName: S.profile.name, count: list.length, totalQty: pcs,
      project: uniqSorted(list.map(c => c.project)).join(', '), createdAt: serverTimestamp(),
    });
    toast(release ? `Released ${list.length} component${list.length === 1 ? '' : 's'} for common use.` : `${list.length} component${list.length === 1 ? ' is' : 's are'} production-only again.`, 'success');
    return true;
  } catch (err) { console.error(err); toast('Could not update: ' + err.message, 'error', 8000); return false; }
}
async function deleteComps(list) {
  list = list.filter(c => c.ownerUid === myUid());
  if (!list.length) return false;
  const pcs = list.reduce((s, c) => s + c.qty, 0);
  const ok = await confirmDialog('Delete components',
    `Delete <b>${list.length}</b> component${list.length === 1 ? '' : 's'} (${pcs.toLocaleString()} pcs) from your inventory?<br>
     <span class="muted small">${list.slice(0, 8).map(c => esc(c.partNumber)).join(', ')}${list.length > 8 ? ` and ${list.length - 8} more` : ''}</span><br>This cannot be undone.`,
    `Delete ${list.length}`, true);
  if (!ok) return false;
  try {
    await batchWrite(list, (b, ref) => b.delete(ref));
    toast(`Deleted ${list.length} component${list.length === 1 ? '' : 's'}.`, 'success');
    return true;
  } catch (err) { console.error(err); toast('Could not delete: ' + err.message, 'error', 8000); return false; }
}

async function showDetails(c) {
  if (!c) { toast('This component no longer exists.', 'error'); return; }
  const v = c.sourceType === 'vendor' && c.vendorId ? S.vendors.find(x => x.id === c.vendorId) : null;
  const mine = c.ownerUid === myUid();
  const actions = [];
  if (!mine && c.qty > 0) actions.push({ label: 'Request this part', cls: 'primary', onClick: () => { setTimeout(() => showRequestModal(c)); } });
  if (mine && c.qty > 0) actions.push({ label: 'Mark taken', cls: 'primary', onClick: () => { setTimeout(() => showTakeModal(c)); } });
  if (mine) actions.push({ label: c.qty > 0 ? 'Edit' : 'Restock / Edit', onClick: () => { setTimeout(() => showEditModal(c)); } });
  if (canRelease(c)) actions.push(c.released
    ? { label: 'Make production-only', cls: 'left', onClick: () => { setTimeout(() => setReleased([c], false)); } }
    : { label: 'Release for common use', cls: 'left', onClick: () => { setTimeout(() => setReleased([c], true)); } });
  actions.push({ label: 'Close', cls: 'ghost' });
  const m = openModal({
    title: c.partNumber, wide: true, actions,
    body: `<div class="detail-grid">
      ${kv('Part Number', c.partNumber)}${kv('Value', c.value)}
      ${kv('Package / Size', c.package)}${kv('Category', [c.category, c.icType].filter(Boolean).join(' — '))}
      ${kv('Manufacturer', c.manufacturer)}${kv('Remaining qty', `<span class="qty ${qtyClass(c.qty)}">${c.qty}</span>`, true)}
      ${kv('Held by', c.ownerName)}${kv('Project', c.project)}
      ${kv('Source', sourceLabel(c))}${v ? kv('Vendor contacts', vendorContacts(v).map(p => esc(contactLine(p))).join('<br>') || '—', true) : ''}
      ${kv('First added', fmtDateTime(c.createdAt))}${kv('Last updated', fmtDateTime(c.updatedAt))}
      <div class="kv span2"><span>Description</span><div>${esc(c.description)}</div></div>
    </div>
    <h4>History</h4><div id="hist" class="muted small">Loading…</div>`,
  });
  try {
    const qs = await getDocs(query(collection(db, 'transactions'), where('componentId', '==', c.id)));
    const rows = qs.docs.map(d => d.data()).sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
    const h = $('#hist', m.el);
    if (!h) return;
    h.className = '';
    h.innerHTML = rows.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>When</th><th>Action</th><th class="num">Qty</th><th>By</th><th>To / note</th></tr></thead><tbody>
      ${rows.map(t => `<tr><td class="nowrap">${esc(fmtDateTime(t.createdAt))}</td><td>${esc(TX_LABEL[t.type] || t.type)}</td>
        <td class="num ${t.delta < 0 ? 'text-bad' : 'text-ok'}">${t.delta > 0 ? '+' : ''}${t.delta}</td><td>${esc(t.byName)}</td>
        <td>${esc([t.toName, t.note].filter(Boolean).join(' — '))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No history yet.</p>';
  } catch (e) {
    console.error(e);
    const h = $('#hist', m.el); if (h) h.textContent = 'Could not load history.';
  }
}

function showRequestModal(c) {
  if (!c) return;
  openModal({
    title: `Request ${c.partNumber}`,
    body: `<p class="muted">${esc([c.value, c.package, c.description].filter(Boolean).join(' · '))}</p>
      <p>Held by <b>${esc(c.ownerName)}</b> (project <b>${esc(c.project)}</b>). Available now: <b>${c.qty}</b></p>
      <div class="grid">
        <label>Quantity needed <i>*</i><input name="qty" type="number" min="1" max="${c.qty}" value="1"></label>
        <label>For project / purpose<input name="purpose" list="dl-projects"></label>
        <label class="span2">Note to ${esc(c.ownerName)}<textarea name="note" rows="2" placeholder="Optional"></textarea></label>
      </div>`,
    actions: [{ label: 'Cancel', cls: 'ghost' }, {
      label: 'Send request', cls: 'primary', onClick: async m => {
        const q = parseInt(m.querySelector('[name=qty]').value, 10);
        if (!(q > 0)) { toast('Enter a quantity.', 'error'); return false; }
        const cur = findComp(c.id);
        if (!cur || q > cur.qty) { toast(`Only ${cur ? cur.qty : 0} available.`, 'error'); return false; }
        await addDoc(collection(db, 'requests'), {
          componentId: c.id, partNumber: c.partNumber, value: c.value, package: c.package, description: c.description,
          project: c.project, requesterUid: myUid(), requesterName: S.profile.name, ownerUid: c.ownerUid, ownerName: c.ownerName,
          qtyRequested: q, qtyApproved: 0, purpose: m.querySelector('[name=purpose]').value.trim(),
          note: m.querySelector('[name=note]').value.trim(), ownerNote: '', status: 'pending', createdAt: serverTimestamp(),
        });
        toast(`Request sent to ${c.ownerName}. You'll be notified when they respond.`, 'success', 5000);
      },
    }],
  });
}

function showTakeModal(c) {
  if (!c) return;
  const others = S.users.filter(u => u.active && u.id !== myUid());
  openModal({
    title: `Mark taken: ${c.partNumber}`,
    body: `<p class="muted">${esc([c.value, c.package, c.description].filter(Boolean).join(' · '))}</p><p>In stock: <b>${c.qty}</b></p>
      <div class="grid">
        <label>Quantity taken <i>*</i><input name="qty" type="number" min="1" max="${c.qty}" value="1"></label>
        <label>Taken by<select name="to"><option value="">Me (${esc(S.profile.name)})</option>${others.map(u => `<option>${esc(u.name)}</option>`).join('')}</select></label>
        <label class="span2">Purpose / note<input name="note" placeholder="e.g. Used on proto board #3"></label>
      </div>`,
    actions: [{ label: 'Cancel', cls: 'ghost' }, {
      label: 'Deduct from stock', cls: 'primary', onClick: async m => {
        const q = parseInt(m.querySelector('[name=qty]').value, 10);
        if (!(q > 0)) { toast('Enter a quantity.', 'error'); return false; }
        const toName = m.querySelector('[name=to]').value || S.profile.name;
        const note = m.querySelector('[name=note]').value.trim();
        await runTransaction(db, async tx => {
          const ref = doc(db, 'components', c.id);
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error('Component no longer exists.');
          const cur = Number(snap.data().qty) || 0;
          if (q > cur) throw new Error(`Only ${cur} in stock.`);
          tx.update(ref, { qty: cur - q, updatedAt: serverTimestamp() });
          tx.set(doc(collection(db, 'transactions')), {
            componentId: c.id, partNumber: c.partNumber, type: 'taken', delta: -q, qtyAfter: cur - q, toName, note,
            byUid: myUid(), byName: S.profile.name, createdAt: serverTimestamp(),
          });
        });
        toast(`Deducted ${q}. ${c.qty - q} left.`, 'success');
      },
    }],
  });
}

function showEditModal(c) {
  if (!c) return;
  openModal({
    title: `Edit ${c.partNumber}`, wide: true,
    body: `<form class="form" novalidate>${componentFields(c, true)}${sourceFields(c)}</form>`,
    onOpen: m => { const f = m.querySelector('form'); wireComponentForm(f); wireSource(f); },
    actions: [
      { label: 'Delete', cls: 'danger left', onClick: async () => {
        const ok = await confirmDialog('Delete component', `Delete <b>${esc(c.partNumber)}</b> (${c.qty} pcs) from your inventory? This cannot be undone.`, 'Delete', true);
        if (!ok) return false;
        await deleteDoc(doc(db, 'components', c.id));
        toast('Component deleted.', 'success');
      } },
      { label: 'Cancel', cls: 'ghost' },
      { label: 'Save changes', cls: 'primary', onClick: async m => {
        const f = m.querySelector('form');
        const d = readComponentForm(f);
        const err = validateComp(d);
        if (err) { toast(err, 'error'); return false; }
        const src = await resolveSource(readSource(f));
        const cur = findComp(c.id) || c;
        const delta = d.qty - cur.qty;
        await updateDoc(doc(db, 'components', c.id), {
          partNumber: d.partNumber, value: d.value, package: d.package, description: d.description,
          category: d.category, icType: d.icType, manufacturer: d.manufacturer, qty: d.qty, project: d.project,
          ...src, updatedAt: serverTimestamp(), ...(delta > 0 ? { lastAddedAt: serverTimestamp() } : {}),
        });
        if (delta !== 0) await logTx({ componentId: c.id, partNumber: d.partNumber, type: delta > 0 ? 'restock' : 'adjust', delta, qtyAfter: d.qty, note: 'Edited' });
        toast('Saved.', 'success');
      } },
    ],
  });
}

// ---------------------------------------------------------------------
//  Requests
// ---------------------------------------------------------------------
function renderRequests(el) {
  const st = S.ui.req ||= { tab: 'in' };
  el.innerHTML = `
    <div class="tabs">
      <button data-tab="in">Requests to me <b class="count accent" id="cIn"></b></button>
      <button data-tab="out">My requests</button>
    </div>
    <p class="intro" id="reqIntro"></p>
    <div id="results"></div>`;
  $('.tabs', el).addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    st.tab = b.dataset.tab; update();
  });
  const order = { pending: 0, approved: 1, rejected: 2, cancelled: 3 };
  const update = () => {
    $$('.tabs button', el).forEach(b => b.classList.toggle('active', b.dataset.tab === st.tab));
    const pend = S.reqIn.filter(r => r.status === 'pending').length;
    $('#cIn', el).textContent = pend || '';
    $('#reqIntro', el).innerHTML = st.tab === 'in'
      ? 'Engineers asking for components you hold. Approving deducts the approved quantity from your stock.'
      : 'Components you asked other engineers for.';
    const list = (st.tab === 'in' ? S.reqIn : S.reqOut).slice()
      .sort((a, b) => (order[a.status] - order[b.status]) || ((toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0)));
    if (!list.length) { $('#results', el).innerHTML = `<div class="empty">${st.tab === 'in' ? 'No one has requested parts from you yet.' : 'You have not requested any parts. Find a part in <a href="#search">Search</a> and click Request.'}</div>`; return; }
    $('#results', el).innerHTML = `<div class="req-list">${list.map(r => {
      const c = findComp(r.componentId);
      const who = st.tab === 'in' ? `From <b>${esc(r.requesterName)}</b>` : `To <b>${esc(r.ownerName)}</b>`;
      let acts = '';
      if (r.status === 'pending' && st.tab === 'in') acts = `<button class="btn sm primary" data-action="approve" data-id="${r.id}">Approve</button><button class="btn sm ghost" data-action="reject" data-id="${r.id}">Reject</button>`;
      if (r.status === 'pending' && st.tab === 'out') acts = `<button class="btn sm ghost" data-action="cancelReq" data-id="${r.id}">Cancel request</button>`;
      return `<div class="req card ${r.status}">
        <div class="req-main">
          <div class="req-title"><span class="mono strong">${esc(r.partNumber)}</span> <span class="badge ${r.status}">${esc(r.status)}</span></div>
          <div class="muted">${esc([r.value, r.package, r.description].filter(Boolean).join(' · '))}</div>
          <div>${who} · requested <b>${r.qtyRequested}</b>${r.status === 'approved' ? ` · approved <b>${r.qtyApproved}</b>` : ''}${r.purpose ? ` · for <b>${esc(r.purpose)}</b>` : ''}
            ${st.tab === 'in' && r.status === 'pending' ? ` · you have <b class="${c && c.qty >= r.qtyRequested ? 'text-ok' : 'text-bad'}">${c ? c.qty : 'deleted'}</b>` : ''}</div>
          ${r.note ? `<div class="note">“${esc(r.note)}”</div>` : ''}
          ${r.ownerNote ? `<div class="note owner">${esc(r.ownerName)}: “${esc(r.ownerNote)}”</div>` : ''}
          <div class="muted small">${esc(fmtDateTime(r.createdAt))}${r.decidedAt ? ` · ${esc(r.status)} ${esc(fmtDateTime(r.decidedAt))}` : ''}</div>
        </div>
        <div class="req-actions">${acts}</div>
      </div>`;
    }).join('')}</div>`;
  };
  update();
  return update;
}

function showApproveModal(r) {
  if (!r) return;
  const c = findComp(r.componentId);
  if (!c) { toast('That component was deleted. Reject the request instead.', 'error'); return; }
  const def = Math.min(r.qtyRequested, c.qty);
  openModal({
    title: 'Approve request',
    body: `<p><b>${esc(r.requesterName)}</b> requested <b>${r.qtyRequested}</b> × <span class="mono">${esc(r.partNumber)}</span> (${esc(vp(r))}).</p>
      <p>You have <b>${c.qty}</b> in stock (project ${esc(c.project)}).</p>
      ${r.note ? `<p class="note">“${esc(r.note)}”</p>` : ''}
      <div class="grid">
        <label>Quantity to give <i>*</i><input name="qty" type="number" min="1" max="${c.qty}" value="${def}"></label>
        <label class="span2">Note to ${esc(r.requesterName)}<input name="note" placeholder="Optional, e.g. collect from my desk"></label>
      </div>`,
    actions: [{ label: 'Cancel', cls: 'ghost' }, {
      label: 'Approve & deduct', cls: 'primary', onClick: async m => {
        const q = parseInt(m.querySelector('[name=qty]').value, 10);
        if (!(q > 0)) { toast('Enter a quantity.', 'error'); return false; }
        const note = m.querySelector('[name=note]').value.trim();
        await runTransaction(db, async tx => {
          const cRef = doc(db, 'components', r.componentId);
          const rRef = doc(db, 'requests', r.id);
          const [cs, rs] = [await tx.get(cRef), await tx.get(rRef)];
          if (!cs.exists()) throw new Error('Component no longer exists.');
          if (rs.data()?.status !== 'pending') throw new Error('This request was already handled or cancelled.');
          const cur = Number(cs.data().qty) || 0;
          if (q > cur) throw new Error(`You only have ${cur}.`);
          tx.update(cRef, { qty: cur - q, updatedAt: serverTimestamp() });
          tx.update(rRef, { status: 'approved', qtyApproved: q, ownerNote: note, decidedAt: serverTimestamp() });
          tx.set(doc(collection(db, 'transactions')), {
            componentId: r.componentId, partNumber: r.partNumber, type: 'request', delta: -q, qtyAfter: cur - q,
            toName: r.requesterName, note, byUid: myUid(), byName: S.profile.name, createdAt: serverTimestamp(),
          });
        });
        toast(`Approved ${q} for ${r.requesterName}. ${c.qty - q} left.`, 'success');
      },
    }],
  });
}

function showRejectModal(r) {
  if (!r) return;
  openModal({
    title: 'Reject request',
    body: `<p>Reject <b>${esc(r.requesterName)}</b>'s request for ${r.qtyRequested} × <span class="mono">${esc(r.partNumber)}</span>?</p>
      <label>Reason (optional)<input name="note" placeholder="e.g. Reserved for project X"></label>`,
    actions: [{ label: 'Cancel', cls: 'ghost' }, {
      label: 'Reject', cls: 'danger', onClick: async m => {
        await updateDoc(doc(db, 'requests', r.id), { status: 'rejected', ownerNote: m.querySelector('[name=note]').value.trim(), decidedAt: serverTimestamp() });
        toast('Request rejected.');
      },
    }],
  });
}

async function cancelRequest(r) {
  if (!r) return;
  if (!await confirmDialog('Cancel request', `Cancel your request for <b>${esc(r.partNumber)}</b>?`, 'Cancel request', true)) return;
  await updateDoc(doc(db, 'requests', r.id), { status: 'cancelled', decidedAt: serverTimestamp() });
  toast('Request cancelled.');
}

// ---------------------------------------------------------------------
//  Vendors
// ---------------------------------------------------------------------
function renderVendors(el) {
  const st = S.ui.vendors ||= { q: '' };
  el.innerHTML = `
    <div class="toolbar">
      <input id="q" class="search" type="search" autocomplete="off" placeholder="Search vendors by name, contact, phone, email…" value="${esc(st.q)}">
      <button class="btn primary" id="addV" type="button">+ Add vendor</button>
    </div>
    <div id="results"></div>`;
  $('#addV', el).onclick = () => showVendorModal(null);
  const update = () => {
    const t = st.q.trim().toLowerCase();
    const list = S.vendors.filter(v => !t || vendorSearchText(v).includes(t));
    const used = id => S.components.filter(c => c.vendorId === id).length;
    const person = p => `<div class="ct-person"><b>${esc(p.name || '—')}</b>${p.designation ? ` <span class="muted">${esc(p.designation)}</span>` : ''}
      ${p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ''}${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}</div>`;
    $('#results', el).innerHTML = list.length ? `<div class="table-wrap"><table class="tbl vendors"><thead><tr>
        <th>Vendor</th><th>Contact people</th><th>Notes</th><th class="num">Components</th><th>Added by</th><th></th></tr></thead>
      <tbody>${list.map(v => `<tr>
        <td class="strong">${esc(v.name)}</td>
        <td>${vendorContacts(v).map(person).join('') || '<span class="muted">—</span>'}</td>
        <td class="desc">${esc(v.notes)}</td><td class="num">${used(v.id)}</td><td>${esc(v.createdByName)}</td>
        <td class="actions"><button class="btn sm" data-action="editVendor" data-id="${v.id}">Edit</button>
          ${v.createdBy === myUid() || S.isAdmin ? `<button class="btn sm ghost" data-action="deleteVendor" data-id="${v.id}">Delete</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${S.vendors.length ? 'No matching vendors.' : 'No vendors saved yet. Vendors are also saved automatically when you add a component bought from a vendor.'}</div>`;
  };
  const q = $('#q', el);
  q.addEventListener('input', debounce(() => { st.q = q.value; update(); }, 120));
  update();
  return update;
}

function showVendorModal(v) {
  openModal({
    title: v ? `Edit vendor: ${v.name}` : 'Add vendor',
    wide: true,
    body: `<div class="vendor-form">
      <label>Vendor name <i>*</i><input name="name" value="${esc(v?.name)}"></label>
      ${contactsEditor(vendorContacts(v))}
      <label>Address / notes <span class="opt">(optional)</span><textarea name="notes" rows="2">${esc(v?.notes)}</textarea></label></div>`,
    onOpen: m => wireContacts(m),
    actions: [{ label: 'Cancel', cls: 'ghost' }, {
      label: 'Save', cls: 'primary', onClick: async m => {
        const g = k => m.querySelector(`[name=${k}]`).value.trim();
        const people = readContacts(m);
        if (people.some(p => !p.name && (p.designation))) { toast('Each contact person needs a name.', 'error'); return false; }
        const data = { name: g('name'), ...contactsData(people), notes: g('notes') };
        if (!data.name) { toast('Vendor name is required.', 'error'); return false; }
        const dup = S.vendors.find(x => x.name.toLowerCase() === data.name.toLowerCase() && x.id !== v?.id);
        if (dup) { toast('A vendor with this name already exists.', 'error'); return false; }
        if (v) await updateDoc(doc(db, 'vendors', v.id), { ...data, updatedAt: serverTimestamp() });
        else await addDoc(collection(db, 'vendors'), { ...data, createdBy: myUid(), createdByName: S.profile.name, createdAt: serverTimestamp() });
        toast('Vendor saved.', 'success');
      },
    }],
  });
}

// ---------------------------------------------------------------------
//  Admin: manage engineers
// ---------------------------------------------------------------------
// Shows login details with a one-click copy, for the admin to share.
function showCredentials(title, name, email, pass) {
  const site = location.origin + location.pathname;
  const text = `Riod Inventory\nWebsite: ${site}\nEmail: ${email}\nPassword: ${pass}`;
  openModal({
    title,
    body: `<p>Share these login details with <b>${esc(name)}</b>:</p>
      <div class="cred"><div><span>Website</span><b>${esc(site)}</b></div><div><span>Email</span><b>${esc(email)}</b></div><div><span>Password</span><b>${esc(pass)}</b></div></div>
      <p class="muted small">They can change it later from the menu (top right) → Change password.</p>`,
    actions: [
      { label: 'Copy password', onClick: async () => { await copyText(pass); toast('Password copied.', 'success'); return false; } },
      { label: 'Copy all details', onClick: async () => { await copyText(text); toast('Login details copied.', 'success'); return false; } },
      { label: 'Done', cls: 'primary' },
    ],
  });
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch { // older browsers / no permission
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}

// Admin sets a new password for an engineer (generated or custom), then copies it to share.
function showSetPasswordModal(u) {
  if (!u) return;
  const m = openModal({
    title: `Set password: ${u.name}`,
    body: `<p>Set a new password for <b>${esc(u.name)}</b> (${esc(u.email)}). Their old password stops working, and they are signed out on their devices.</p>
      <p class="muted small">Nobody, including the admin, can see an engineer's current password. You can only set a new one.</p>
      <label>New password (min 6 characters)
        <span class="pass-row"><input name="np" class="mono" autocomplete="off" spellcheck="false" value="${genPass()}"><button class="btn" type="button" data-gen>Generate</button></span></label>
      <p class="muted small">Keep the generated one, or clear it and type your own.</p>`,
    actions: [{ label: 'Cancel', cls: 'ghost' }, {
      label: 'Set password', cls: 'primary', onClick: async el => {
        const p = el.querySelector('[name=np]').value;
        if (p.length < 6) { toast('Password must be at least 6 characters.', 'error'); return false; }
        if (/\s/.test(p) && !await confirmDialog('Spaces in password', 'The password contains spaces. Keep it?', 'Keep')) return false;
        try {
          await callFn('adminSetPassword', { uid: u.id, password: p });
        } catch (e) {
          console.error(e);
          const code = String(e.code || '');
          if (/not-found|internal|unavailable|unimplemented/.test(code) && !/does not exist/.test(e.message || ''))
            toast('The password service is not set up yet (needs the Cloud Function, see README "Admin password setup"). For now, use "Email reset link".', 'error', 10000);
          else toast(e.message || 'Could not set the password.', 'error', 7000);
          return false;
        }
        setTimeout(() => showCredentials('Password changed', u.name, u.email, p));
      },
    }],
  });
  const inp = m.el.querySelector('[name=np]');
  m.el.querySelector('[data-gen]').onclick = () => { inp.value = genPass(); inp.focus(); inp.select(); };
  inp.select();
}

function genPass() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = crypto.getRandomValues(new Uint32Array(10));
  return 'Riod-' + [...a].map(n => chars[n % chars.length]).join('');
}

function renderAdmin(el) {
  el.innerHTML = `
    <div class="card add-eng">
      <h3>Add engineer</h3>
      <form id="addEng" class="add-eng-row" novalidate>
        <label>Full name<input name="name" placeholder="e.g. Arjun Menon" autocomplete="off"></label>
        <label class="ae-email">Email
          <span class="email-input"><input name="local" placeholder="name" autocomplete="off" aria-label="Email"><select name="domain" aria-label="Email domain">
            ${COMPANY_DOMAINS.map((d, i) => `<option value="${esc(d)}" ${i ? '' : 'selected'}>@${esc(d)}</option>`).join('')}<option value="other">Other email…</option></select></span></label>
        <label>Temporary password
          <span class="pass-row"><input name="pass" value="${genPass()}" autocomplete="off"><button class="btn" type="button" data-gen title="Generate a new password">Generate</button></span></label>
        <button class="btn primary" type="submit">Add engineer</button>
      </form>
      <p class="muted small ae-help">After adding, copy the details and send them to the engineer. They can change the password from the top-right menu.
        Choose <b>Other email…</b> for someone outside ${COMPANY_DOMAINS.map(d => '@' + esc(d)).join(' / ')}.</p>
    </div>
    <div class="card"><h3>Engineers</h3><div id="results"></div></div>`;

  const form = $('#addEng', el);
  const localInp = form.querySelector('[name=local]');
  const domSel = form.querySelector('[name=domain]');
  const kind = () => domSel.value;
  const syncDomain = () => {
    const other = kind() === 'other';
    domSel.classList.toggle('other', other);
    localInp.placeholder = other ? 'full email, e.g. someone@gmail.com' : 'name';
  };
  domSel.addEventListener('change', () => { syncDomain(); localInp.focus(); });
  form.querySelector('[data-gen]').addEventListener('click', () => { form.querySelector('[name=pass]').value = genPass(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = form.querySelector("[name=name]").value.trim();
    const raw = localInp.value.trim().toLowerCase();
    const pass = form.querySelector("[name=pass]").value;
    if (!name || !raw) { toast('Name and email are required.', 'error'); return; }
    let email;
    if (kind() !== 'other') {
      // A full company address typed in the box (e.g. x@riod.in) is fine whichever domain is selected.
      const typedDom = raw.includes('@') ? raw.split('@')[1] : kind();
      const local = raw.split('@')[0];
      if (!COMPANY_DOMAINS.includes(typedDom)) { toast(`For an outside email, pick "Other email…" in the dropdown.`, 'error'); return; }
      if (!/^[a-z0-9._%+-]+$/.test(local)) { toast('Email has invalid characters.', 'error'); return; }
      email = `${local}@${typedDom}`;
    } else {
      if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) { toast('Enter a full, valid email address.', 'error'); return; }
      email = raw;
      if (!isCompanyEmail(email) && !await confirmDialog('Outside email',
        `<b>${esc(email)}</b> is not a company address (${COMPANY_DOMAINS.map(d => '@' + esc(d)).join(', ')}).<br>This person will be able to see and use the whole inventory. Add them?`, 'Add outside user')) return;
    }
    if (pass.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }
    if (email === ADMIN_EMAIL) { toast('That is your own (admin) account.', 'error'); return; }
    const existing = S.users.find(u => (u.email || '').toLowerCase() === email);
    if (existing) {
      if (existing.active) toast(`${email} is already an engineer.`, 'error');
      else if (await confirmDialog('Reactivate engineer', `${esc(email)} was removed earlier. Reactivate their account? (Their old password still works.)`, 'Reactivate'))
        await updateDoc(doc(db, 'users', existing.id), { active: true, name, reactivatedAt: serverTimestamp() });
      return;
    }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
      const uid = await createAuthUser(email, pass);
      await setDoc(doc(db, 'users', uid), { name, email, role: 'engineer', active: true, createdAt: serverTimestamp(), createdBy: myUid() });
      showCredentials('Engineer added', name, email, pass);
      form.reset(); form.querySelector("[name=pass]").value = genPass();
      syncDomain();
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use')
        toast('This email already has a login in Firebase but no engineer record. Delete it in Firebase Console → Authentication → Users, then add again.', 'error', 9000);
      else if (err.code === 'auth/weak-password') toast('Password is too weak (min 6 characters).', 'error');
      else toast(err.message, 'error', 6000);
    } finally { btn.disabled = false; btn.textContent = 'Add engineer'; }
  });

  const update = () => {
    const list = S.users.filter(u => u.role !== 'admin').sort((a, b) => (b.active === true) - (a.active === true) || (a.name || '').localeCompare(b.name || ''));
    const count = id => S.components.filter(c => c.ownerUid === id).length;
    $('#results', el).innerHTML = list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>
      <th>Name</th><th>Email</th><th>Status</th><th class="num">Components</th><th>Added</th><th>Last login</th><th></th></tr></thead>
      <tbody>${list.map(u => `<tr class="${u.active ? '' : 'row-excluded'}">
        <td class="strong">${esc(u.name)}</td><td>${esc(u.email)}${isCompanyEmail(u.email) ? '' : ' <span class="tag">outside</span>'}</td>
        <td>${u.active ? '<span class="badge approved">active</span>' : '<span class="badge cancelled">removed</span>'}</td>
        <td class="num">${count(u.id)}</td><td>${esc(fmtDate(u.createdAt))}</td><td>${esc(u.lastLogin ? timeAgo(u.lastLogin) : 'never')}</td>
        <td class="actions">${u.active
          ? `<button class="btn sm primary" data-action="setPass" data-id="${u.id}" title="Set a new password and copy it to share">Set password</button><button class="btn sm" data-action="resetPass" data-id="${u.id}" title="Email them a link to choose their own password">Email reset link</button><button class="btn sm danger" data-action="removeEng" data-id="${u.id}">Remove</button>`
          : `<button class="btn sm" data-action="reactivateEng" data-id="${u.id}">Reactivate</button>`}</td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty">No engineers yet. Add the first one above.</div>';
  };
  update();
  return update;
}

// ---------------------------------------------------------------------
//  Change password
// ---------------------------------------------------------------------
function showPasswordModal() {
  openModal({
    title: 'Change password',
    body: `<div class="grid one">
      <label>Current password<input name="cur" type="password" autocomplete="current-password"></label>
      <label>New password (min 6 characters)<input name="n1" type="password" autocomplete="new-password"></label>
      <label>Confirm new password<input name="n2" type="password" autocomplete="new-password"></label></div>`,
    actions: [{ label: 'Cancel', cls: 'ghost' }, {
      label: 'Change password', cls: 'primary', onClick: async m => {
        const g = k => m.querySelector(`[name=${k}]`).value;
        if (g('n1').length < 6) { toast('New password must be at least 6 characters.', 'error'); return false; }
        if (g('n1') !== g('n2')) { toast('New passwords do not match.', 'error'); return false; }
        try {
          const u = auth.currentUser;
          await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, g('cur')));
          await updatePassword(u, g('n1'));
          toast('Password changed.', 'success');
        } catch (e) { toast(friendlyAuthError(e), 'error'); return false; }
      },
    }],
  });
}

// ---------------------------------------------------------------------
//  Action dispatcher for buttons in the main view
// ---------------------------------------------------------------------
const reqById = id => S.reqIn.find(r => r.id === id) || S.reqOut.find(r => r.id === id);
const ACTIONS = {
  details: id => showDetails(findComp(id)),
  request: id => showRequestModal(findComp(id)),
  take: id => showTakeModal(findComp(id)),
  edit: id => showEditModal(findComp(id)),
  approve: id => showApproveModal(reqById(id)),
  reject: id => showRejectModal(reqById(id)),
  cancelReq: id => cancelRequest(reqById(id)).catch(e => toast(e.message, 'error')),
  editVendor: id => showVendorModal(S.vendors.find(v => v.id === id)),
  deleteVendor: async id => {
    const v = S.vendors.find(x => x.id === id);
    if (!v || !await confirmDialog('Delete vendor', `Delete vendor <b>${esc(v.name)}</b>? Components keep the vendor name.`, 'Delete', true)) return;
    try { await deleteDoc(doc(db, 'vendors', id)); toast('Vendor deleted.'); } catch (e) { toast(e.message, 'error'); }
  },
  removeEng: async id => {
    const u = S.users.find(x => x.id === id);
    if (!u || !await confirmDialog('Remove engineer', `Remove <b>${esc(u.name)}</b> (${esc(u.email)})?<br>They will no longer be able to sign in. Their components stay in the inventory under their name.`, 'Remove', true)) return;
    try { await updateDoc(doc(db, 'users', id), { active: false, removedAt: serverTimestamp() }); toast(`${u.name} removed.`); } catch (e) { toast(e.message, 'error'); }
  },
  setPass: id => showSetPasswordModal(S.users.find(x => x.id === id)),
  resetPass: async id => {
    const u = S.users.find(x => x.id === id);
    if (!u) return;
    const ok = await confirmDialog('Reset password',
      `Send a password reset link to <b>${esc(u.email)}</b>?<br><br>
       ${esc(u.name)} opens the email, clicks the link and chooses a new password. Their current password keeps working until they do.
       <br><span class="muted small">Ask them to check the Spam/Junk folder if it doesn't arrive in a minute. The sender is noreply@riod-inventory.firebaseapp.com.</span>`,
      'Send reset link');
    if (!ok) return;
    try {
      await sendPasswordResetEmail(auth, u.email);
      toast(`Password reset link sent to ${u.email}.`, 'success', 5000);
    } catch (e) { toast(friendlyAuthError(e), 'error', 6000); }
  },
  reactivateEng: async id => {
    const u = S.users.find(x => x.id === id);
    if (!u) return;
    try { await updateDoc(doc(db, 'users', id), { active: true, reactivatedAt: serverTimestamp() }); toast(`${u.name} reactivated.`, 'success'); } catch (e) { toast(e.message, 'error'); }
  },
};

init();
