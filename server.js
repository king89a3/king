/**
 * WIN.X.KING Server v3.1
 * Firebase Admin with guaranteed Render compatibility
 */
const express = require('express');
const cors    = require('cors');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 10000;
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

// ══════════════════════════════════════════════════════════════
// FIREBASE REST API — No SDK, no private key format issues!
// Uses Firebase REST API directly with a service account token
// ══════════════════════════════════════════════════════════════

// We use firebase-admin ONLY for token generation, with JSON credentials
let db_initialized = false;
let getFirestore = null;

function initFirebase() {
  try {
    const admin = require('firebase-admin');
    
    // Check if already initialized
    if (admin.apps.length > 0) {
      getFirestore = () => admin.firestore();
      db_initialized = true;
      return true;
    }

    let credential;
    
    // METHOD 1: Full JSON in one env var (recommended for Render)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      credential = admin.credential.cert(sa);
      console.log('Using FIREBASE_SERVICE_ACCOUNT_JSON');
    }
    // METHOD 2: Individual env vars - fix the private key
    else if (process.env.FIREBASE_PROJECT_ID) {
      let pk = (process.env.FIREBASE_PRIVATE_KEY || '');
      // Aggressively fix all newline encodings Render might use
      pk = pk.replace(/\\n/g, '\n');
      pk = pk.replace(/\\\\n/g, '\n');
      // Remove surrounding quotes if present
      if (pk.startsWith('"')) pk = pk.slice(1);
      if (pk.endsWith('"')) pk = pk.slice(0, -1);
      
      console.log('Private key first 40 chars:', pk.substring(0, 40));
      console.log('Has real newlines:', pk.includes('\n'));
      
      credential = admin.credential.cert({
        project_id:   process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key:  pk,
      });
    } else {
      throw new Error('No Firebase credentials found');
    }

    admin.initializeApp({ credential });
    getFirestore = () => admin.firestore();
    db_initialized = true;
    console.log('✅ Firebase initialized successfully');
    return true;
  } catch(e) {
    console.error('❌ Firebase init error:', e.message);
    return false;
  }
}

const fb_ok = initFirebase();

if (!fb_ok) {
  // Serve a meaningful error instead of crashing
  app.use((req, res) => {
    res.status(503).json({
      ok: false,
      msg: 'Firebase not configured. Add FIREBASE_SERVICE_ACCOUNT_JSON to Render env vars.'
    });
  });
  app.listen(PORT, () => console.log('Server on port ' + PORT + ' — Firebase NOT configured'));
  return; // Stop here
}

const db = getFirestore();

// ══════════════════════════════════════════════════════════════
// COLLECTIONS
// ══════════════════════════════════════════════════════════════
const C = {
  pwd:   () => db.collection('wxk_passwords'),
  today: () => db.collection('wxk_meta').doc('today'),
  ad:    () => db.collection('wxk_meta').doc('ad'),
  stats: () => db.collection('wxk_meta').doc('stats'),
};

// ══════════════════════════════════════════════════════════════
// RATE LIMIT
// ══════════════════════════════════════════════════════════════
const rl = {};
function rateLimit(ip, key, max, ms) {
  const k = ip + ':' + key, now = Date.now();
  if (!rl[k] || now - rl[k].s > ms) { rl[k] = { c: 1, s: now }; return false; }
  return ++rl[k].c > max;
}
setInterval(() => { const n = Date.now(); Object.keys(rl).forEach(k => { if (n - rl[k].s > 600000) delete rl[k]; }); }, 600000);

function getIP(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'; }
function auth(req) { const p = process.env.ADMIN_PASS; return !!(p && req.headers['x-pass'] === p); }
function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = '';
  for (let i = 0; i < 8; i++) { if (i === 4) s += '-'; s += c[Math.floor(Math.random() * c.length)]; }
  return s;
}

const PLANS = {
  '3':  { days: 3,  price: 99,  locations: 1, label: 'TRIAL' },
  '7':  { days: 7,  price: 199, locations: 2, label: 'BASIC' },
  '30': { days: 30, price: 599, locations: 4, label: 'PRO' },
};

// ══════════════════════════════════════════════════════════════
// DB HELPERS
// ══════════════════════════════════════════════════════════════
async function getPwd(code) {
  try { const s = await C.pwd().doc(code).get(); return s.exists ? { ...s.data(), code: s.id } : null; }
  catch(e) { console.error('getPwd error:', e.message); return null; }
}
async function savePwd(code, data) { await C.pwd().doc(code).set(data, { merge: true }); }
async function getToday() { try { const s = await C.today().get(); return s.exists ? s.data() : null; } catch(e) { return null; } }
async function getAd() { try { const s = await C.ad().get(); return s.exists ? s.data() : null; } catch(e) { return null; } }
async function getStats() { try { const s = await C.stats().get(); return s.exists ? s.data() : { sold: 0, revenue: 0 }; } catch(e) { return { sold: 0, revenue: 0 }; } }

function getPred(today, label) {
  if (!today) return null;
  const map = { TRIAL: 'plan99', BASIC: 'plan199', PRO: 'plan599' };
  const key = map[label] || 'plan599';
  if (!today[key]) return null;
  return { date: today.date, locations: today[key].locations || [], extraNums: today.extraNums || [] };
}

// ══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════════════════════════════
app.get('/', (req, res) => res.json({ ok: true, status: 'WIN.X.KING ONLINE', firebase: 'connected' }));

// Test firebase connection endpoint
app.get('/health', async (req, res) => {
  try {
    await C.today().get();
    res.json({ ok: true, firebase: 'connected', admin_pass_set: !!process.env.ADMIN_PASS });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// /access
// ══════════════════════════════════════════════════════════════
app.post('/access', async (req, res) => {
  const ip = getIP(req);
  if (rateLimit(ip, 'access', 15, 60000)) return res.json({ ok: false, msg: 'Bahut zyada attempts. 1 min ruko.' });
  const { code, deviceId } = req.body;
  if (!code) return res.json({ ok: false, msg: 'Code daalo' });
  const clean = code.trim().toUpperCase();
  try {
    const pwd = await getPwd(clean);
    if (!pwd) return res.json({ ok: false, msg: 'Galat code — Telegram pe contact karo' });
    const now = Date.now();
    if (!pwd.used) {
      if (pwd.expiry < now) return res.json({ ok: false, msg: 'Code expire ho gaya — naya lo' });
      const userExpiry = now + (pwd.days * 86400000);
      await savePwd(clean, { used: true, activatedAt: now, userExpiry, deviceId: deviceId || null, sessionActive: true, lastSeen: now });
      const plan = PLANS[String(pwd.days)] || PLANS['30'];
      const [today, ad] = await Promise.all([getToday(), getAd()]);
      return res.json({ ok: true, daysLeft: pwd.days, plan, hasPrediction: !!getPred(today, plan.label), prediction: getPred(today, plan.label), ad: (ad && ad.enabled) ? ad : null });
    }
    if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId)
      return res.json({ ok: false, msg: 'Ye code doosre phone pe use ho chuka hai. Naya lo — Telegram pe aao' });
    if (!pwd.userExpiry || pwd.userExpiry < now)
      return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
    const upd = { sessionActive: true, lastSeen: now };
    if (!pwd.deviceId && deviceId) upd.deviceId = deviceId;
    await savePwd(clean, upd);
    const daysLeft = Math.ceil((pwd.userExpiry - now) / 86400000);
    const plan = PLANS[String(pwd.days)] || PLANS['30'];
    const [today, ad] = await Promise.all([getToday(), getAd()]);
    return res.json({ ok: true, daysLeft, plan, hasPrediction: !!getPred(today, plan.label), prediction: getPred(today, plan.label), ad: (ad && ad.enabled) ? ad : null });
  } catch(e) {
    console.error('/access error:', e.message);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// /verify
// ══════════════════════════════════════════════════════════════
app.post('/verify', async (req, res) => {
  if (rateLimit(getIP(req), 'verify', 20, 60000)) return res.json({ ok: false });
  const { code, deviceId } = req.body;
  if (!code) return res.json({ ok: false });
  const clean = code.trim().toUpperCase();
  try {
    const pwd = await getPwd(clean);
    if (!pwd || !pwd.used) return res.json({ ok: false, msg: 'Session expire — dobara login karo' });
    const now = Date.now();
    if (pwd.sessionActive === false) return res.json({ ok: false, msg: 'Session expire — dobara login karo' });
    if (!pwd.userExpiry || pwd.userExpiry < now) return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
    if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId) return res.json({ ok: false, msg: 'Ye code doosre phone pe use ho chuka hai.' });
    await savePwd(clean, { lastSeen: now });
    const daysLeft = Math.ceil((pwd.userExpiry - now) / 86400000);
    const plan = PLANS[String(pwd.days)] || PLANS['30'];
    const [today, ad] = await Promise.all([getToday(), getAd()]);
    return res.json({ ok: true, daysLeft, plan, hasPrediction: !!getPred(today, plan.label), prediction: getPred(today, plan.label), ad: (ad && ad.enabled) ? ad : null });
  } catch(e) {
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

app.get('/ad', async (req, res) => {
  const ad = await getAd();
  res.json({ ok: true, ad: (ad && ad.enabled) ? ad : null });
});

// ══════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════
app.get('/admin/data', async (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false, msg: 'Password galat hai' });
  try {
    const [snap, today, ad, stats] = await Promise.all([C.pwd().get(), getToday(), getAd(), getStats()]);
    const passwords = snap.docs.map(d => ({ ...d.data(), code: d.id }));
    return res.json({ ok: true, passwords, today: today || null, ad: ad || null, sold: stats.sold || passwords.filter(p => p.used).length, revenue: stats.revenue || 0 });
  } catch(e) {
    console.error('/admin/data error:', e.message);
    return res.status(500).json({ ok: false, msg: 'Firebase error: ' + e.message });
  }
});

app.post('/admin/predict', async (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  const { plan99, plan199, plan599, extraNums } = req.body;
  try {
    const pred = { date: new Date().toLocaleDateString('en-IN'), plan99: plan99 || null, plan199: plan199 || null, plan599: plan599 || null, extraNums: (extraNums || []).slice(0, 8), savedAt: Date.now() };
    await C.today().set(pred);
    res.json({ ok: true, prediction: pred });
  } catch(e) { res.status(500).json({ ok: false, msg: e.message }); }
});

app.delete('/admin/today', async (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  try { await C.today().delete(); res.json({ ok: true }); } catch(e) { res.status(500).json({ ok: false, msg: e.message }); }
});

app.post('/admin/pwd', async (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  const { name = 'User', days = 30 } = req.body;
  try {
    const plan = PLANS[String(days)] || PLANS['30'];
    const code = genCode(), now = Date.now();
    await C.pwd().doc(code).set({ code, name, days: plan.days, price: plan.price, createdAt: now, expiry: now + (30 * 86400000), used: false, userExpiry: null, deviceId: null, sessionActive: false, activatedAt: null, lastSeen: null });
    const stats = await getStats();
    await C.stats().set({ sold: (stats.sold || 0) + 1, revenue: (stats.revenue || 0) + plan.price });
    res.json({ ok: true, code, days: plan.days, name, price: plan.price });
  } catch(e) { res.status(500).json({ ok: false, msg: e.message }); }
});

app.delete('/admin/pwd/:code', async (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  try { await C.pwd().doc(req.params.code.toUpperCase()).delete(); res.json({ ok: true }); } catch(e) { res.status(500).json({ ok: false, msg: e.message }); }
});

app.get('/admin/ad', async (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  const ad = await getAd(); res.json({ ok: true, ad: ad || null });
});

app.post('/admin/ad', async (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  const { enabled, text, link, label } = req.body;
  try {
    const ad = { enabled: !!enabled, text: text || '', link: link || '', label: label || 'Contact Karo', updatedAt: Date.now() };
    await C.ad().set(ad); res.json({ ok: true, ad });
  } catch(e) { res.status(500).json({ ok: false, msg: e.message }); }
});

app.delete('/admin/ad', async (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  try { await C.ad().delete(); res.json({ ok: true }); } catch(e) { res.status(500).json({ ok: false, msg: e.message }); }
});

app.post('/admin/logout/:code', async (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  try {
    const code = req.params.code.toUpperCase();
    const pwd = await getPwd(code);
    if (!pwd) return res.json({ ok: false, msg: 'Code nahi mila' });
    await savePwd(code, { sessionActive: false, deviceId: null });
    res.json({ ok: true, msg: 'User force logged out' });
  } catch(e) { res.status(500).json({ ok: false, msg: e.message }); }
});

app.use((req, res) => res.status(404).json({ ok: false, msg: 'Invalid API' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log('WIN.X.KING v3.1 — Port:' + PORT);
  console.log('Firebase: ' + (db_initialized ? 'CONNECTED' : 'NOT CONNECTED'));
  console.log('ADMIN_PASS: ' + (process.env.ADMIN_PASS ? 'SET' : 'NOT SET'));
  console.log('Test Firebase: GET /health');
});
