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
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  }),
});
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
-14
+1
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
// ─── GLOBAL ERROR GUARD — server crash se bachao ─────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (caught):', reason && reason.message ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (caught):', err.message);
});
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
    return { today: data.today || null, sold: data.sold || 0, revenue: data.revenue || 0, ad: data.ad || null };
  } catch (e) {
    console.error('getMeta error:', e.message);
    return { today: null, sold: 0, revenue: 0, ad: null };
-3
+1
}
// ─── AUTH HELPER ──────────────────────────────────────────────────────────────
function isAdmin(req) {
  return req.headers['x-pass'] === PASS;
}
function isAdmin(req) { return req.headers['x-pass'] === PASS; }
// ─── CODE GENERATOR ───────────────────────────────────────────────────────────
function genCode() {
-6
+1
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
  return { date: today.date, locations: today[key].locations || [], extraNums: today.extraNums || [] };
}
// ─── PUBLIC: Verify session ───────────────────────────────────────────────────
-20
+3
  try {
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
    if (!pwd.userExpiry || pwd.userExpiry < now) return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
    if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId) return res.json({ ok: false, msg: 'Session invalid — device mismatch' });
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
    return res.json({ ok: true, daysLeft, plan, locations: plan.locations, hasPrediction: !!prediction, prediction: prediction || null, ad: (meta.ad && meta.ad.enabled) ? meta.ad : null });
  } catch (e) {
    console.error('/verify error:', e.message);
    return res.json({ ok: false, msg: 'Server error' });
-38
+6
  try {
    const { code, deviceId } = req.body;
    if (!code) return res.json({ ok: false, msg: 'Code daalo' });
    const now = Date.now();
    const clean = code.trim().toUpperCase();
    const [pwd, meta] = await Promise.all([getPassword(clean), getMeta()]);
    if (!pwd) return res.json({ ok: false, msg: 'Galat code — Telegram pe contact karo' });
    if (!pwd.used && pwd.expiry < now) {
      return res.json({ ok: false, msg: 'Code expire ho gaya — naya lo' });
    }
    if (!pwd.used && pwd.expiry < now) return res.json({ ok: false, msg: 'Code expire ho gaya — naya lo' });
    if (!pwd.used) {
      const updates = {
        used: true,
        activatedAt: now,
        userExpiry: now + (pwd.days * 86400000),
        deviceId: deviceId || null,
        sessionActive: true,
        lastLoginAt: now,
      };
      const updates = { used: true, activatedAt: now, userExpiry: now + (pwd.days * 86400000), deviceId: deviceId || null, sessionActive: true, lastLoginAt: now };
      await setPassword(clean, updates);
      Object.assign(pwd, updates);
    } else {
      if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId) {
        return res.json({ ok: false, msg: 'Ye code doosre phone pe use ho chuka hai. Naya lo — Telegram pe aao' });
      }
      if (pwd.deviceId && deviceId && pwd.deviceId !== deviceId) return res.json({ ok: false, msg: 'Ye code doosre phone pe use ho chuka hai. Naya lo — Telegram pe aao' });
      const updates = { sessionActive: true, lastLoginAt: now };
      if (!pwd.deviceId && deviceId) {
        updates.deviceId = deviceId;
        pwd.deviceId = deviceId;
      }
      if (!pwd.deviceId && deviceId) { updates.deviceId = deviceId; pwd.deviceId = deviceId; }
      await setPassword(clean, updates);
      Object.assign(pwd, updates);
    }
    if (!pwd.userExpiry || pwd.userExpiry < now) {
      return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
    }
    if (!pwd.userExpiry || pwd.userExpiry < now) return res.json({ ok: false, msg: 'Access expire ho gaya — naya code lo' });
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
    return res.json({ ok: true, daysLeft, plan, locations: plan.locations, hasPrediction: !!prediction, prediction: prediction || null, ad: (meta.ad && meta.ad.enabled) ? meta.ad : null });
  } catch (e) {
    console.error('/access error:', e.message);
    return res.json({ ok: false, msg: 'Server error' });
-3
+1
  try {
    const meta = await getMeta();
    res.json({ ok: true, ad: (meta.ad && meta.ad.enabled) ? meta.ad : null });
  } catch (e) {
    res.json({ ok: true, ad: null });
  }
  } catch (e) { res.json({ ok: true, ad: null }); }
});
// ─── ADMIN: Get all data ──────────────────────────────────────────────────────
-20
+2
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
    const pwdData = { code, name, days: plan.days, price: plan.price, createdAt: now, expiry: now + (30 * 86400000), used: false, userExpiry: null, activatedAt: null, deviceId: null, sessionActive: false, lastLoginAt: null };
    const meta = await getMeta();
    const saved = await createPassword(code, pwdData);
    if (!saved) {
      return res.status(500).json({ ok: false, msg: 'Firebase save error — check Firestore setup' });
    }
    if (!saved) return res.status(500).json({ ok: false, msg: 'Firebase mein save nahi hua — Firestore setup check karo' });
    await setMeta({ sold: (meta.sold || 0) + 1, revenue: (meta.revenue || 0) + plan.price });
    return res.json({ ok: true, code, days: plan.days, name, price: plan.price });
  } catch (e) {
    console.error('/admin/pwd error:', e.message);
-7
+1
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  try {
    const { plan99, plan199, plan599, extraNums } = req.body;
    const today = {
      date: new Date().toLocaleDateString('en-IN'),
      plan99: plan99 || null,
      plan199: plan199 || null,
      plan599: plan599 || null,
      extraNums: (extraNums || []).slice(0, 8),
    };
    const today = { date: new Date().toLocaleDateString('en-IN'), plan99: plan99 || null, plan199: plan199 || null, plan599: plan599 || null, extraNums: (extraNums || []).slice(0, 8) };
    await setMeta({ today });
    return res.json({ ok: true, prediction: today });
  } catch (e) {
-2
+2
// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port ' + PORT);
});
  console.log('[Server] Running on port', PORT);
});
