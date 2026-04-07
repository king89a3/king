const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 10000;
const PASS = process.env.ADMIN_PASS || 'NUMEXADMIN2026';

// ─── GLOBAL CRASH GUARD ───────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason && reason.message ? reason.message : String(reason));
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.message);
});

// ─── FIREBASE INIT ────────────────────────────────────────────────────────────
// Render pe FIREBASE_SERVICE_ACCOUNT naam se poori JSON file ka content paste karo
let serviceAccount;
try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  serviceAccount = JSON.parse(raw);
  console.log('[Firebase] Service account loaded for project:', serviceAccount.project_id);
} catch (e) {
  console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT:', e.message);
  console.error('[Firebase] Make sure FIREBASE_SERVICE_ACCOUNT env var is set to the full JSON file content');
  process.exit(1);
}

try {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  console.log('[Firebase] Admin SDK initialized');
} catch (e) {
  console.error('[Firebase] initializeApp failed:', e.message);
  process.exit(1);
}

const db = admin.firestore();
const META_DOC = db.collection('winxking').doc('meta');
const PASSWORDS_COL = db.collection('winxking').doc('meta').collection('passwords');

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
const corsOptions = {
  origin: function (origin, callback) { callback(null, true); },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'PUT', 'PATCH'],
  allowedHeaders: ['Content-Type', 'x-pass', 'Authorization'],
  credentials: false,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// ─── DB HELPERS ───────────────────────────────────────────────────────────────
async function getMeta() {
  try {
    const snap = await META_DOC.get();
    const data = snap.exists ? snap.data() : {};
    return { today: data.today || null, sold: data.sold || 0, revenue: data.revenue || 0, ad: data.ad || null };
  } catch (e) {
    console.error('getMeta error:', e.message);
    return { today: null, sold: 0, revenue: 0, ad: null };
  }
}

async function setMeta(updates) {
  try {
    await META_DOC.set(updates, { merge: true });
    return true;
  } catch (e) {
    console.error('setMeta error:', e.message);
    return false;
  }
}

async function getAllPasswords() {
  try {
    const snap = await PASSWORDS_COL.get();
    return snap.docs.map(d => ({ ...d.data(), _id: d.id }));
  } catch (e) {
    console.error('getAllPasswords error:', e.message);
    return [];
  }
}

async function getPassword(code) {
  try {
    const snap = await PASSWORDS_COL.doc(code).get();
    if (!snap.exists) return null;
    return { ...snap.data(), _id: snap.id };
  } catch (e) {
    console.error('getPassword error:', e.message);
    return null;
  }
}

async function setPassword(code, data) {
  try {
    await PASSWORDS_COL.doc(code).set(data, { merge: true });
    return true;
  } catch (e) {
    console.error('setPassword error:', e.message);
    return false;
  }
}

async function createPassword(code, data) {
  try {
    await PASSWORDS_COL.doc(code).set(data);
    return true;
  } catch (e) {
    console.error('createPassword error:', e.message);
    return false;
  }
}

async function deletePassword(code) {
  try {
    await PASSWORDS_COL.doc(code).delete();
    return true;
  } catch (e) {
    console.error('deletePassword error:', e.message);
    return false;
  }
}

// ─── AUTH HELPER ──────────────────────────────────────────────────────────────
function isAdmin(req) { return req.headers['x-pass'] === PASS; }

// ─── CODE GENERATOR ───────────────────────────────────────────────────────────
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ─── PLAN CONFIG ─────────────────────────────────────────────────────────────
const PLANS = {
  '3':  { days: 3,  price: 99,  locations: 1, label: 'TRIAL' },
  '7':  { days: 7,  price: 199, locations: 2, label: 'BASIC' },
  '30': { days: 30, price: 599, locations: 4, label: 'PRO'   },
};

function getPlanPrediction(today, planLabel) {
  if (!today) return null;
  const keyMap = { TRIAL: 'plan99', BASIC: 'plan199', PRO: 'plan599' };
  const key = keyMap[planLabel] || 'plan599';
  if (!today[key]) return null;
  return { date: today.date, locations: today[key].locations || [], extraNums: today.extraNums || [] };
}

// ─── PUBLIC: Verify session ───────────────────────────────────────────────────
app.post('/verify', async (req, res) => {
  try {
    const { code, deviceId } = req.body;
    if (!code) return res.json({ ok: false, msg: 'Code daalo' });
    const now = Date.now();
    const clean = code.trim().toUpperCase();
    const [pwd, meta] = await Promise.all([getPassword(clean), getMeta()]);
    if (!pwd) return res.json({ ok: false, msg: 'Session expired' });
    if (pwd.sessionActive !== true) return res.json({ ok: false, msg: 'Session expired' });
    if (!pwd.used) return res.json({ ok: false, msg: 'Session expired' });
    if (!pwd.userExpiry || pwd.userExpiry < now) return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
    if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId) return res.json({ ok: false, msg: 'Session invalid — device mismatch' });
    const daysLeft = Math.ceil((pwd.userExpiry - now) / 86400000);
    const plan = PLANS[String(pwd.days)] || PLANS['30'];
    const prediction = getPlanPrediction(meta.today, plan.label);
    return res.json({ ok: true, daysLeft, plan, locations: plan.locations, hasPrediction: !!prediction, prediction: prediction || null, ad: (meta.ad && meta.ad.enabled) ? meta.ad : null });
  } catch (e) {
    console.error('/verify error:', e.message);
    return res.json({ ok: false, msg: 'Server error' });
  }
});

// ─── PUBLIC: Access / Login ───────────────────────────────────────────────────
app.post('/access', async (req, res) => {
  try {
    const { code, deviceId } = req.body;
    if (!code) return res.json({ ok: false, msg: 'Code daalo' });
    const now = Date.now();
    const clean = code.trim().toUpperCase();
    const [pwd, meta] = await Promise.all([getPassword(clean), getMeta()]);
    if (!pwd) return res.json({ ok: false, msg: 'Galat code — Telegram pe contact karo' });
    if (!pwd.used && pwd.expiry < now) return res.json({ ok: false, msg: 'Code expire ho gaya — naya lo' });
    if (!pwd.used) {
      const updates = { used: true, activatedAt: now, userExpiry: now + (pwd.days * 86400000), deviceId: deviceId || null, sessionActive: true, lastLoginAt: now };
      await setPassword(clean, updates);
      Object.assign(pwd, updates);
    } else {
      if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId) return res.json({ ok: false, msg: 'Ye code doosre phone pe use ho chuka hai. Naya lo — Telegram pe aao' });
      const updates = { sessionActive: true, lastLoginAt: now };
      if (!pwd.deviceId && deviceId) { updates.deviceId = deviceId; pwd.deviceId = deviceId; }
      await setPassword(clean, updates);
      Object.assign(pwd, updates);
    }
    if (!pwd.userExpiry || pwd.userExpiry < now) return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
    const daysLeft = Math.ceil((pwd.userExpiry - now) / 86400000);
    const plan = PLANS[String(pwd.days)] || PLANS['30'];
    const prediction = getPlanPrediction(meta.today, plan.label);
    return res.json({ ok: true, daysLeft, plan, locations: plan.locations, hasPrediction: !!prediction, prediction: prediction || null, ad: (meta.ad && meta.ad.enabled) ? meta.ad : null });
  } catch (e) {
    console.error('/access error:', e.message);
    return res.json({ ok: false, msg: 'Server error' });
  }
});

// ─── PUBLIC: Get Ad ───────────────────────────────────────────────────────────
app.get('/ad', async (req, res) => {
  try {
    const meta = await getMeta();
    res.json({ ok: true, ad: (meta.ad && meta.ad.enabled) ? meta.ad : null });
  } catch (e) { res.json({ ok: true, ad: null }); }
});

// ─── ADMIN: Get all data ──────────────────────────────────────────────────────
app.get('/admin/data', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    const [meta, passwords] = await Promise.all([getMeta(), getAllPasswords()]);
    return res.json({ ok: true, ...meta, passwords });
  } catch (e) {
    console.error('/admin/data error:', e.message);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// ─── ADMIN: Generate access code ─────────────────────────────────────────────
app.post('/admin/pwd', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    const { name = 'User', days = 30 } = req.body;
    const code = genCode();
    const now = Date.now();
    const plan = PLANS[String(days)] || PLANS['30'];
    const pwdData = { code, name, days: plan.days, price: plan.price, createdAt: now, expiry: now + (30 * 86400000), used: false, userExpiry: null, activatedAt: null, deviceId: null, sessionActive: false, lastLoginAt: null };
    const meta = await getMeta();
    const saved = await createPassword(code, pwdData);
    if (!saved) return res.status(500).json({ ok: false, msg: 'Firebase mein save nahi hua — Firestore setup check karo' });
    await setMeta({ sold: (meta.sold || 0) + 1, revenue: (meta.revenue || 0) + plan.price });
    return res.json({ ok: true, code, days: plan.days, name, price: plan.price });
  } catch (e) {
    console.error('/admin/pwd error:', e.message);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + e.message });
  }
});

// ─── ADMIN: Delete access code ────────────────────────────────────────────────
app.delete('/admin/pwd/:code', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    await deletePassword(req.params.code);
    return res.json({ ok: true });
  } catch (e) {
    console.error('/admin/pwd delete error:', e.message);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// ─── ADMIN: Force logout a user ───────────────────────────────────────────────
app.post('/admin/logout/:code', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    const pwd = await getPassword(req.params.code);
    if (!pwd) return res.json({ ok: false, msg: 'Code not found' });
    await setPassword(req.params.code, { sessionActive: false, deviceId: null });
    return res.json({ ok: true, msg: 'User force logged out' });
  } catch (e) {
    console.error('/admin/logout error:', e.message);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// ─── ADMIN: Set today's prediction ───────────────────────────────────────────
app.post('/admin/predict', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    const { plan99, plan199, plan599, extraNums } = req.body;
    const today = { date: new Date().toLocaleDateString('en-IN'), plan99: plan99 || null, plan199: plan199 || null, plan599: plan599 || null, extraNums: (extraNums || []).slice(0, 8) };
    await setMeta({ today });
    return res.json({ ok: true, prediction: today });
  } catch (e) {
    console.error('/admin/predict error:', e.message);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// ─── ADMIN: Clear today's prediction ─────────────────────────────────────────
app.delete('/admin/today', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    await setMeta({ today: null });
    return res.json({ ok: true });
  } catch (e) {
    console.error('/admin/today error:', e.message);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// ─── ADMIN: Get ad ────────────────────────────────────────────────────────────
app.get('/admin/ad', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    const meta = await getMeta();
    return res.json({ ok: true, ad: meta.ad || null });
  } catch (e) {
    console.error('/admin/ad get error:', e.message);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// ─── ADMIN: Set ad ────────────────────────────────────────────────────────────
app.post('/admin/ad', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    const { enabled, text, link, label } = req.body;
    const ad = { enabled: !!enabled, text: text || '', link: link || '', label: label || 'Contact Karo' };
    await setMeta({ ad });
    return res.json({ ok: true, ad });
  } catch (e) {
    console.error('/admin/ad post error:', e.message);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// ─── ADMIN: Delete ad ────────────────────────────────────────────────────────
app.delete('/admin/ad', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    await setMeta({ ad: null });
    return res.json({ ok: true });
  } catch (e) {
    console.error('/admin/ad delete error:', e.message);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('[Server] Running on port', PORT);
});
