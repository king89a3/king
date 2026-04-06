const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;
const PASS = process.env.ADMIN_PASS || 'NUMEXADMIN2026';
const DATA = './db.json';

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// ─── DB HELPERS ───────────────────────────────────────────────────────────────
function load() {
  try {
    if (fs.existsSync(DATA)) {
      return JSON.parse(fs.readFileSync(DATA, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load db.json:', e.message);
  }
  return { passwords: [], today: null, sold: 0, revenue: 0, ad: null };
}

function save(d) {
  try {
    fs.writeFileSync(DATA, JSON.stringify(d));
  } catch (e) {
    console.error('Failed to save db.json:', e.message);
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
// Called on app startup — fast silent check, no session write.
// Returns ok:true if session active, ok:false if expired or force-logged-out.
app.post('/verify', (req, res) => {
  const { code, deviceId } = req.body;
  if (!code) return res.json({ ok: false, msg: 'Code daalo' });

  const d = load();
  const now = Date.now();
  const clean = code.trim().toUpperCase();
  const pwd = d.passwords.find(p => p.code === clean);

  // Code hi nahi mila (server restart/db wipe) — client apna local session use kare
  if (!pwd) return res.json({ ok: false, msg: 'Session expired' });

  // Code mila par kabhi activate nahi hua
  if (!pwd.used) return res.json({ ok: false, msg: 'Session expired' });

  // Plan genuinely expire ho gaya
  if (!pwd.userExpiry || pwd.userExpiry < now) {
    return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
  }

  // Device mismatch — kisi aur ka phone
  if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId) {
    return res.json({ ok: false, msg: 'Session invalid — device mismatch' });
  }

  // NOTE: sessionActive check hata diya — server restart pe false ho jaata tha
  // Ab sirf userExpiry se decide hoga — yahi sahi hai

  // Session restore on verify (agar restart ke baad false tha)
  if (!pwd.sessionActive) {
    pwd.sessionActive = true;
    pwd.lastLoginAt = now;
    save(d);
  }

  const daysLeft = Math.ceil((pwd.userExpiry - now) / 86400000);
  const plan = PLANS[String(pwd.days)] || PLANS['30'];
  const prediction = getPlanPrediction(d.today, plan.label);

  return res.json({
    ok: true,
    daysLeft,
    plan,
    locations: plan.locations,
    hasPrediction: !!prediction,
    prediction: prediction || null,
    ad: (d.ad && d.ad.enabled) ? d.ad : null,
  });
});

// ─── PUBLIC: Access / Login ───────────────────────────────────────────────────
// First-time activation or re-login. Enforces one-device-per-code.
app.post('/access', (req, res) => {
  const { code, deviceId } = req.body;
  if (!code) return res.json({ ok: false, msg: 'Code daalo' });

  const d = load();
  const now = Date.now();
  const clean = code.trim().toUpperCase();
  const pwd = d.passwords.find(p => p.code === clean);

  if (!pwd) return res.json({ ok: false, msg: 'Galat code — Telegram pe contact karo' });

  if (!pwd.used && pwd.expiry < now) {
    return res.json({ ok: false, msg: 'Code expire ho gaya — naya lo' });
  }

  if (!pwd.used) {
    // First activation
    pwd.used = true;
    pwd.activatedAt = now;
    pwd.userExpiry = now + (pwd.days * 86400000);
    pwd.deviceId = deviceId || null;
    pwd.sessionActive = true;
    pwd.lastLoginAt = now;
    save(d);
  } else {
    // Re-login (ya server restart ke baad pehli baar)
    if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId) {
      return res.json({ ok: false, msg: 'Ye code doosre phone pe use ho chuka hai. Naya lo — Telegram pe aao' });
    }
    if (!pwd.deviceId && deviceId) pwd.deviceId = deviceId;
    pwd.sessionActive = true;
    pwd.lastLoginAt = now;
    save(d);
  }

  if (!pwd.userExpiry || pwd.userExpiry < now) {
    return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
  }

  const daysLeft = Math.ceil((pwd.userExpiry - now) / 86400000);
  const plan = PLANS[String(pwd.days)] || PLANS['30'];
  const prediction = getPlanPrediction(d.today, plan.label);

  return res.json({
    ok: true,
    daysLeft,
    plan,
    locations: plan.locations,
    hasPrediction: !!prediction,
    prediction: prediction || null,
    ad: (d.ad && d.ad.enabled) ? d.ad : null,
  });
});

// ─── PUBLIC: Get Ad ───────────────────────────────────────────────────────────
app.get('/ad', (req, res) => {
  const d = load();
  res.json({ ok: true, ad: (d.ad && d.ad.enabled) ? d.ad : null });
});

// ─── ADMIN: Get all data ──────────────────────────────────────────────────────
app.get('/admin/data', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  return res.json({ ok: true, ...load() });
});

// ─── ADMIN: Generate access code ─────────────────────────────────────────────
app.post('/admin/pwd', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const { name = 'User', days = 30 } = req.body;
  const d = load();
  const code = genCode();
  const now = Date.now();
  const plan = PLANS[String(days)] || PLANS['30'];

  d.passwords.push({
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
  });

  d.sold = (d.sold || 0) + 1;
  d.revenue = (d.revenue || 0) + plan.price;
  save(d);

  return res.json({ ok: true, code, days: plan.days, name, price: plan.price });
});

// ─── ADMIN: Delete access code ────────────────────────────────────────────────
app.delete('/admin/pwd/:code', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const d = load();
  d.passwords = d.passwords.filter(p => p.code !== req.params.code);
  save(d);
  return res.json({ ok: true });
});

// ─── ADMIN: Force logout a user ───────────────────────────────────────────────
// Sets sessionActive=false and clears deviceId.
// User's next /verify call will return "Session expired" — app se bahar ho jayega.
app.post('/admin/logout/:code', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const d = load();
  const pwd = d.passwords.find(p => p.code === req.params.code);
  if (!pwd) return res.json({ ok: false, msg: 'Code not found' });
  pwd.sessionActive = false;
  pwd.deviceId = null;
  save(d);
  return res.json({ ok: true, msg: 'User force logged out' });
});

// ─── ADMIN: Set today's prediction ───────────────────────────────────────────
app.post('/admin/predict', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const { plan99, plan199, plan599, extraNums } = req.body;
  const d = load();
  d.today = {
    date: new Date().toLocaleDateString('en-IN'),
    plan99: plan99 || null,
    plan199: plan199 || null,
    plan599: plan599 || null,
    extraNums: (extraNums || []).slice(0, 8),
  };
  save(d);
  return res.json({ ok: true, prediction: d.today });
});

// ─── ADMIN: Clear today's prediction ─────────────────────────────────────────
app.delete('/admin/today', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const d = load();
  d.today = null;
  save(d);
  return res.json({ ok: true });
});

// ─── ADMIN: Get ad ────────────────────────────────────────────────────────────
app.get('/admin/ad', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  return res.json({ ok: true, ad: load().ad || null });
});

// ─── ADMIN: Set ad ────────────────────────────────────────────────────────────
app.post('/admin/ad', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const { enabled, text, link, label } = req.body;
  const d = load();
  d.ad = { enabled: !!enabled, text: text || '', link: link || '', label: label || 'Contact Karo' };
  save(d);
  return res.json({ ok: true, ad: d.ad });
});

// ─── ADMIN: Delete ad ────────────────────────────────────────────────────────
app.delete('/admin/ad', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  const d = load();
  d.ad = null;
  save(d);
  return res.json({ ok: true });
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port ' + PORT);
});
