const express = require('express');
const cors    = require('cors');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore }        = require('firebase-admin/firestore');

const app  = express();
const PORT = process.env.PORT || 10000;
const PASS = process.env.ADMIN_PASS || 'NUMEXADMIN2026';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// ─── FIREBASE INIT ────────────────────────────────────────
// Credentials come from Render environment variables — NEVER in code/git!
initializeApp({
  credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  })
});

const db      = getFirestore();
const PWD_COL = db.collection('passwords');           // access codes
const APP_DOC = db.collection('appdata').doc('main'); // global app data

// ─── AUTH ─────────────────────────────────────────────────
function isAdmin(req) {
  return req.headers['x-pass'] === PASS;
}

// ─── PLAN CONFIG ──────────────────────────────────────────
const PLANS = {
  '3':  { days: 3,  price: 99,  locations: 1, label: 'TRIAL' },
  '7':  { days: 7,  price: 199, locations: 2, label: 'BASIC' },
  '30': { days: 30, price: 599, locations: 4, label: 'PRO'   },
};

// ─── HELPERS ──────────────────────────────────────────────
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

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

async function getAppData() {
  try {
    const snap = await APP_DOC.get();
    if (snap.exists) return snap.data();
  } catch (e) { console.error('getAppData:', e.message); }
  return { sold: 0, revenue: 0, ad: null, today: null };
}

async function getPassword(code) {
  try {
    const snap = await PWD_COL.doc(code).get();
    return snap.exists ? snap.data() : null;
  } catch (e) { console.error('getPassword:', e.message); return null; }
}

// ─── HEALTH ───────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'OK', db: 'Firestore' }));

// ══════════════════════════════════════════════════════════
// PUBLIC: VERIFY SESSION
// Called every time user opens the app (auto-login).
// All session data is in Firestore — server restart has NO effect.
// ══════════════════════════════════════════════════════════
app.post('/verify', async (req, res) => {
  const { code, deviceId } = req.body;
  if (!code) return res.json({ ok: false, msg: 'Code daalo' });

  const clean = code.trim().toUpperCase();
  const now   = Date.now();

  try {
    const pwd = await getPassword(clean);

    if (!pwd)                       return res.json({ ok: false, msg: 'Session expired' });
    if (!pwd.used)                  return res.json({ ok: false, msg: 'Session expired' });
    if (pwd.sessionActive !== true) return res.json({ ok: false, msg: 'Session expired' });
    if (!pwd.userExpiry || pwd.userExpiry < now)
      return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
    if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId)
      return res.json({ ok: false, msg: 'Session invalid — device mismatch' });

    const daysLeft  = Math.ceil((pwd.userExpiry - now) / 86400000);
    const plan      = PLANS[String(pwd.days)] || PLANS['30'];
    const appData   = await getAppData();
    const prediction = getPlanPrediction(appData.today, plan.label);

    return res.json({
      ok: true,
      daysLeft,
      plan,
      locations:     plan.locations,
      hasPrediction: !!prediction,
      prediction:    prediction || null,
      ad: (appData.ad && appData.ad.enabled) ? appData.ad : null,
    });
  } catch (e) {
    console.error('/verify error:', e.message);
    return res.json({ ok: false, msg: 'Server error — try again' });
  }
});

// ══════════════════════════════════════════════════════════
// PUBLIC: ACCESS / LOGIN
// First-time activation OR re-login.
// Device lock: once deviceId saved, only that device can re-login.
// ══════════════════════════════════════════════════════════
app.post('/access', async (req, res) => {
  const { code, deviceId } = req.body;
  if (!code) return res.json({ ok: false, msg: 'Code daalo' });

  const clean = code.trim().toUpperCase();
  const now   = Date.now();

  try {
    const pwd = await getPassword(clean);
    if (!pwd) return res.json({ ok: false, msg: 'Galat code — Telegram pe contact karo' });

    if (!pwd.used) {
      // ── FIRST ACTIVATION ──
      if (pwd.expiry && pwd.expiry < now)
        return res.json({ ok: false, msg: 'Code expire ho gaya — naya lo' });

      const userExpiry = now + (pwd.days * 86400000);

      await PWD_COL.doc(clean).update({
        used:          true,
        activatedAt:   now,
        userExpiry,
        deviceId:      deviceId || null,
        sessionActive: true,
        lastLoginAt:   now,
      });

      const plan       = PLANS[String(pwd.days)] || PLANS['30'];
      const appData    = await getAppData();
      const prediction = getPlanPrediction(appData.today, plan.label);
      const daysLeft   = Math.ceil((userExpiry - now) / 86400000);

      return res.json({
        ok: true,
        daysLeft,
        plan,
        locations:     plan.locations,
        hasPrediction: !!prediction,
        prediction:    prediction || null,
        ad: (appData.ad && appData.ad.enabled) ? appData.ad : null,
      });

    } else {
      // ── RE-LOGIN ──
      if (!pwd.userExpiry || pwd.userExpiry < now)
        return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });

      if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId)
        return res.json({ ok: false, msg: 'Ye code doosre phone pe use ho chuka hai. Naya lo — Telegram pe aao' });

      const updates = { sessionActive: true, lastLoginAt: now };
      if (!pwd.deviceId && deviceId) updates.deviceId = deviceId;
      await PWD_COL.doc(clean).update(updates);

      const daysLeft   = Math.ceil((pwd.userExpiry - now) / 86400000);
      const plan       = PLANS[String(pwd.days)] || PLANS['30'];
      const appData    = await getAppData();
      const prediction = getPlanPrediction(appData.today, plan.label);

      return res.json({
        ok: true,
        daysLeft,
        plan,
        locations:     plan.locations,
        hasPrediction: !!prediction,
        prediction:    prediction || null,
        ad: (appData.ad && appData.ad.enabled) ? appData.ad : null,
      });
    }
  } catch (e) {
    console.error('/access error:', e.message);
    return res.json({ ok: false, msg: 'Server error — try again' });
  }
});

// ── PUBLIC: Get Ad ─────────────────────────────────────────
app.get('/ad', async (req, res) => {
  try {
    const appData = await getAppData();
    res.json({ ok: true, ad: (appData.ad && appData.ad.enabled) ? appData.ad : null });
  } catch (e) { res.json({ ok: true, ad: null }); }
});

// ══════════════════════════════════════════════════════════
// ADMIN APIS — all use x-pass header for auth
// ══════════════════════════════════════════════════════════

// ── Get all data (same format as old /admin/data) ─────────
app.get('/admin/data', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    const [appData, pwdSnap] = await Promise.all([
      getAppData(),
      PWD_COL.get(),
    ]);
    const passwords = pwdSnap.docs.map(d => d.data());
    return res.json({
      ok:       true,
      passwords,
      today:    appData.today   || null,
      sold:     appData.sold    || 0,
      revenue:  appData.revenue || 0,
      ad:       appData.ad      || null,
    });
  } catch (e) {
    console.error('/admin/data:', e.message);
    return res.status(500).json({ ok: false, msg: e.message });
  }
});

// ── Generate access code ───────────────────────────────────
app.post('/admin/pwd', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const { name = 'User', days = 30 } = req.body;
  const plan = PLANS[String(days)] || PLANS['30'];
  const code = genCode();
  const now  = Date.now();

  const pwdData = {
    code,
    name,
    days:          plan.days,
    price:         plan.price,
    createdAt:     now,
    expiry:        now + (30 * 86400000), // 30 days to first-time activate
    used:          false,
    userExpiry:    null,
    activatedAt:   null,
    deviceId:      null,
    sessionActive: false,
    lastLoginAt:   null,
  };

  try {
    await PWD_COL.doc(code).set(pwdData);
    // Update sold + revenue counters
    const appData = await getAppData();
    await APP_DOC.set({
      today:   appData.today   || null,
      ad:      appData.ad      || null,
      sold:    (appData.sold   || 0) + 1,
      revenue: (appData.revenue || 0) + plan.price,
    });
    return res.json({ ok: true, code, days: plan.days, name, price: plan.price });
  } catch (e) {
    console.error('/admin/pwd:', e.message);
    return res.status(500).json({ ok: false, msg: e.message });
  }
});

// ── Delete access code ─────────────────────────────────────
app.delete('/admin/pwd/:code', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    await PWD_COL.doc(req.params.code).delete();
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ ok: false, msg: e.message }); }
});

// ── Force logout user ──────────────────────────────────────
// sessionActive=false + deviceId=null → next /verify = "Session expired"
app.post('/admin/logout/:code', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    const pwd = await getPassword(req.params.code);
    if (!pwd) return res.json({ ok: false, msg: 'Code not found' });
    await PWD_COL.doc(req.params.code).update({
      sessionActive: false,
      deviceId:      null,
    });
    return res.json({ ok: true, msg: 'User force logged out' });
  } catch (e) { return res.status(500).json({ ok: false, msg: e.message }); }
});

// ── Set today's prediction ─────────────────────────────────
app.post('/admin/predict', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const { plan99, plan199, plan599, extraNums } = req.body;
  try {
    const appData = await getAppData();
    const today = {
      date:     new Date().toLocaleDateString('en-IN'),
      plan99:   plan99  || null,
      plan199:  plan199 || null,
      plan599:  plan599 || null,
      extraNums: (extraNums || []).slice(0, 8),
    };
    await APP_DOC.set({ ...appData, today });
    return res.json({ ok: true, prediction: today });
  } catch (e) { return res.status(500).json({ ok: false, msg: e.message }); }
});

// ── Clear today's prediction ───────────────────────────────
app.delete('/admin/today', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    const appData = await getAppData();
    await APP_DOC.set({ ...appData, today: null });
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ ok: false, msg: e.message }); }
});

// ── Ad management ──────────────────────────────────────────
app.get('/admin/ad', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    const appData = await getAppData();
    return res.json({ ok: true, ad: appData.ad || null });
  } catch (e) { return res.status(500).json({ ok: false, msg: e.message }); }
});

app.post('/admin/ad', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const { enabled, text, link, label } = req.body;
  try {
    const appData = await getAppData();
    const ad = { enabled: !!enabled, text: text || '', link: link || '', label: label || 'Contact Karo' };
    await APP_DOC.set({ ...appData, ad });
    return res.json({ ok: true, ad });
  } catch (e) { return res.status(500).json({ ok: false, msg: e.message }); }
});

app.delete('/admin/ad', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    const appData = await getAppData();
    await APP_DOC.set({ ...appData, ad: null });
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ ok: false, msg: e.message }); }
});

// ─── START ────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('WIN.X.KING Firebase server on port ' + PORT);
});
