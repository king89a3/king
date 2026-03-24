const express = require('express');
const cors = require('cors');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 10000;
const PASS = process.env.ADMIN_PASS || 'ADMIN2026';
const DATA = './db.json';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

function load() {
  try { if (fs.existsSync(DATA)) return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) {}
  return { passwords: [], today: null, sold: 0, revenue: 0, ad: null };
}
function save(d) { try { fs.writeFileSync(DATA, JSON.stringify(d)); } catch (e) {} }
function auth(req) { return req.headers['x-pass'] === PASS; }
function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let p = '';
  for (let i = 0; i < 8; i++) { if (i === 4) p += '-'; p += c[Math.floor(Math.random() * c.length)]; }
  return p;
}

// PLAN PRICES
const PLANS = {
  '3': { days: 3, price: 99, locations: 1, label: 'TRIAL' },
  '7': { days: 7, price: 199, locations: 2, label: 'BASIC' },
  '30': { days: 30, price: 599, locations: 4, label: 'PRO' }
};

// PUBLIC: Verify access code
app.post('/access', (req, res) => {
  const { code, deviceId } = req.body;
  if (!code) return res.json({ ok: false, msg: 'Code daalo' });
  const d = load();
  const now = Date.now();
  const clean = code.trim().toUpperCase();
  const pwd = d.passwords.find(p => p.code === clean);
  if (!pwd) return res.json({ ok: false, msg: 'Galat code — Telegram pe contact karo' });
  if (pwd.expiry < now) return res.json({ ok: false, msg: 'Code expire ho gaya — naya lo' });
  if (!pwd.used) {
    pwd.used = true;
    pwd.activatedAt = now;
    pwd.userExpiry = now + (pwd.days * 86400000);
    pwd.deviceId = deviceId || null;
    save(d);
  } else {
    if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId) {
      return res.json({ ok: false, msg: 'Ye code doosre phone pe use ho chuka hai. Naya lo — Telegram pe aao' });
    }
    if (!pwd.deviceId && deviceId) { pwd.deviceId = deviceId; save(d); }
  }
  if (pwd.userExpiry < now) return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
  const dl = Math.ceil((pwd.userExpiry - now) / 86400000);
  const plan = PLANS[String(pwd.days)] || PLANS['30'];
  const pred = d.today;
  return res.json({
    ok: true,
    daysLeft: dl,
    plan: plan,
    locations: plan.locations,
    hasPrediction: !!pred,
    prediction: pred || null,
    ad: (d.ad && d.ad.enabled) ? d.ad : null
  });
});

// PUBLIC: Get ad
app.get('/ad', (req, res) => {
  const d = load();
  res.json({ ok: true, ad: (d.ad && d.ad.enabled) ? d.ad : null });
});

// ADMIN: Get all data
app.get('/admin/data', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  return res.json({ ok: true, ...load() });
});

// ADMIN: Generate password
app.post('/admin/pwd', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  const { name = 'User', days = 30 } = req.body;
  const d = load();
  const code = genCode();
  const now = Date.now();
  const plan = PLANS[String(days)] || PLANS['30'];
  d.passwords.push({ code, name, days, price: plan.price, createdAt: now, expiry: now + (30 * 86400000), used: false, userExpiry: null });
  d.sold = (d.sold || 0) + 1;
  d.revenue = (d.revenue || 0) + plan.price;
  save(d);
  res.json({ ok: true, code, days, name, price: plan.price });
});

// ADMIN: Delete password
app.delete('/admin/pwd/:code', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  const d = load();
  d.passwords = d.passwords.filter(p => p.code !== req.params.code);
  save(d);
  res.json({ ok: true });
});

// ADMIN: Set prediction (manual)
app.post('/admin/predict', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  const { numbers, extraNums } = req.body;
  // numbers = { loc1: {main:[],spot:[]}, loc2: {...}, loc3: {...}, loc4: {...} }
  const d = load();
  d.today = {
    date: new Date().toLocaleDateString('en-IN'),
    numbers: numbers || {},
    extraNums: (extraNums || []).slice(0, 8)
  };
  save(d);
  res.json({ ok: true, prediction: d.today });
});

// ADMIN: Clear prediction
app.delete('/admin/today', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  const d = load();
  d.today = null;
  save(d);
  res.json({ ok: true });
});

// ADMIN: Ad management
app.get('/admin/ad', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  res.json({ ok: true, ad: load().ad || null });
});
app.post('/admin/ad', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  const { enabled, text, link, label } = req.body;
  const d = load();
  d.ad = { enabled: !!enabled, text: text || '', link: link || '', label: label || 'Contact Karo' };
  save(d);
  res.json({ ok: true, ad: d.ad });
});
app.delete('/admin/ad', (req, res) => {
  if (!auth(req)) return res.status(401).json({ ok: false });
  const d = load();
  d.ad = null;
  save(d);
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => console.log('Server running on ' + PORT));
