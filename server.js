const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 10000;
const PASS = process.env.ADMIN_PASS || 'NUMEXADMIN2026';

// ─── FIREBASE INIT ────────────────────────────────────────────────────────────
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  }),
});

const db = admin.firestore();
const META_DOC = db.collection('winxking').doc('meta');
const PASSWORDS_COL = db.collection('winxking').doc('meta').collection('passwords');

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// ─── DB HELPERS ───────────────────────────────────────────────────────────────
async function getMeta() {
  try {
    const snap = await META_DOC.get();
    const data = snap.exists ? snap.data() : {};
    return {
      today: data.today || null,
      sold: data.sold || 0,
      revenue: data.revenue || 0,
      ad: data.ad || null,
    };
  } catch (e) {
    console.error('getMeta error:', e.message);
    return { today: null, sold: 0, revenue: 0, ad: null };
  }
}

async function setMeta(updates) {
  try {
    await META_DOC.set(updates, { merge: true });
  } catch (e) {
    console.error('setMeta error:', e.message);
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
  } catch (e) {
    console.error('setPassword error:', e.message);
  }
}

async function deletePassword(code) {
  try {
    await PASSWORDS_COL.doc(code).delete();
  } catch (e) {
    console.error('deletePassword error:', e.message);
  }
}

// ─── AUTH HELPER ──────────────────────────────────────────────────────────────
function isAdmin(req) {
  return req.headers['x-pass'] === PASS;
}

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

// ─── HELPER: get plan prediction ─────────────────────────────────────────────
function getPlanPrediction(today, planLabel) {
  if (!today) return null;
  const keyMap = { TRIAL: 'plan99', BASIC: 'plan199', PRO: 'plan599' };
  const key = keyMap[planLabel] || 'plan599';
  if (!today[key]) return null;
  return {
    date: today.date,
    locations: today[key].locations || [],
    extraNums: today.extraNums || [],
  };
}

// ─── PUBLIC: Verify session ───────────────────────────────────────────────────
app.post('/verify', async (req, res) => {
  const { code, deviceId } = req.body;
  if (!code) return res.json({ ok: false, msg: 'Code daalo' });

  const now = Date.now();
  const clean = code.trim().toUpperCase();

  const [pwd, meta] = await Promise.all([getPassword(clean), getMeta()]);

  if (!pwd) return res.json({ ok: false, msg: 'Session expired' });
  if (pwd.sessionActive !== true) return res.json({ ok: false, msg: 'Session expired' });
  if (!pwd.used) return res.json({ ok: false, msg: 'Session expired' });
  if (!pwd.userExpiry || pwd.userExpiry < now) {
    return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
  }
  if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId) {
    return res.json({ ok: false, msg: 'Session invalid — device mismatch' });
  }

  const daysLeft = Math.ceil((pwd.userExpiry - now) / 86400000);
  const plan = PLANS[String(pwd.days)] || PLANS['30'];
  const prediction = getPlanPrediction(meta.today, plan.label);

  return res.json({
    ok: true,
    daysLeft,
    plan,
    locations: plan.locations,
    hasPrediction: !!prediction,
    prediction: prediction || null,
    ad: (meta.ad && meta.ad.enabled) ? meta.ad : null,
  });
});

// ─── PUBLIC: Access / Login ───────────────────────────────────────────────────
app.post('/access', async (req, res) => {
  const { code, deviceId } = req.body;
  if (!code) return res.json({ ok: false, msg: 'Code daalo' });

  const now = Date.now();
  const clean = code.trim().toUpperCase();

  const [pwd, meta] = await Promise.all([getPassword(clean), getMeta()]);

  if (!pwd) return res.json({ ok: false, msg: 'Galat code — Telegram pe contact karo' });

  if (!pwd.used && pwd.expiry < now) {
    return res.json({ ok: false, msg: 'Code expire ho gaya — naya lo' });
  }

  if (!pwd.used) {
    const updates = {
      used: true,
      activatedAt: now,
      userExpiry: now + (pwd.days * 86400000),
      deviceId: deviceId || null,
      sessionActive: true,
      lastLoginAt: now,
    };
    await setPassword(clean, updates);
    Object.assign(pwd, updates);
  } else {
    if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId) {
      return res.json({ ok: false, msg: 'Ye code doosre phone pe use ho chuka hai. Naya lo — Telegram pe aao' });
    }
    const updates = {
      sessionActive: true,
      lastLoginAt: now,
    };
    if (!pwd.deviceId && deviceId) {
      updates.deviceId = deviceId;
      pwd.deviceId = deviceId;
    }
    await setPassword(clean, updates);
    Object.assign(pwd, updates);
  }

  if (!pwd.userExpiry || pwd.userExpiry < now) {
    return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
  }

  const daysLeft = Math.ceil((pwd.userExpiry - now) / 86400000);
  const plan = PLANS[String(pwd.days)] || PLANS['30'];
  const prediction = getPlanPrediction(meta.today, plan.label);

  return res.json({
    ok: true,
    daysLeft,
    plan,
    locations: plan.locations,
    hasPrediction: !!prediction,
    prediction: prediction || null,
    ad: (meta.ad && meta.ad.enabled) ? meta.ad : null,
  });
});

// ─── PUBLIC: Get Ad ───────────────────────────────────────────────────────────
app.get('/ad', async (req, res) => {
  const meta = await getMeta();
  res.json({ ok: true, ad: (meta.ad && meta.ad.enabled) ? meta.ad : null });
});

// ─── ADMIN: Get all data ──────────────────────────────────────────────────────
app.get('/admin/data', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const [meta, passwords] = await Promise.all([getMeta(), getAllPasswords()]);
  return res.json({ ok: true, ...meta, passwords });
});

// ─── ADMIN: Generate access code ─────────────────────────────────────────────
app.post('/admin/pwd', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const { name = 'User', days = 30 } = req.body;
  const code = genCode();
  const now = Date.now();
  const plan = PLANS[String(days)] || PLANS['30'];

  const pwdData = {
    code,
    name,
    days: plan.days,
    price: plan.price,
    createdAt: now,
    expiry: now + (30 * 86400000),
    used: false,
    userExpiry: null,
    activatedAt: null,
    deviceId: null,
    sessionActive: false,
    lastLoginAt: null,
  };

  const meta = await getMeta();
  await Promise.all([
    PASSWORDS_COL.doc(code).set(pwdData),
    setMeta({ sold: (meta.sold || 0) + 1, revenue: (meta.revenue || 0) + plan.price }),
  ]);

  return res.json({ ok: true, code, days: plan.days, name, price: plan.price });
});

// ─── ADMIN: Delete access code ────────────────────────────────────────────────
app.delete('/admin/pwd/:code', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  await deletePassword(req.params.code);
  return res.json({ ok: true });
});

// ─── ADMIN: Force logout a user ───────────────────────────────────────────────
app.post('/admin/logout/:code', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const pwd = await getPassword(req.params.code);
  if (!pwd) return res.json({ ok: false, msg: 'Code not found' });
  await setPassword(req.params.code, { sessionActive: false, deviceId: null });
  return res.json({ ok: true, msg: 'User force logged out' });
});

// ─── ADMIN: Set today's prediction ───────────────────────────────────────────
app.post('/admin/predict', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const { plan99, plan199, plan599, extraNums } = req.body;
  const today = {
    date: new Date().toLocaleDateString('en-IN'),
    plan99: plan99 || null,
    plan199: plan199 || null,
    plan599: plan599 || null,
    extraNums: (extraNums || []).slice(0, 8),
  };
  await setMeta({ today });
  return res.json({ ok: true, prediction: today });
});

// ─── ADMIN: Clear today's prediction ─────────────────────────────────────────
app.delete('/admin/today', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  await setMeta({ today: null });
  return res.json({ ok: true });
});

// ─── ADMIN: Get ad ────────────────────────────────────────────────────────────
app.get('/admin/ad', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const meta = await getMeta();
  return res.json({ ok: true, ad: meta.ad || null });
});

// ─── ADMIN: Set ad ────────────────────────────────────────────────────────────
app.post('/admin/ad', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const { enabled, text, link, label } = req.body;
  const ad = { enabled: !!enabled, text: text || '', link: link || '', label: label || 'Contact Karo' };
  await setMeta({ ad });
  return res.json({ ok: true, ad });
});

// ─── ADMIN: Delete ad ────────────────────────────────────────────────────────
app.delete('/admin/ad', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  await setMeta({ ad: null });
  return res.json({ ok: true });
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port ' + PORT);
});
