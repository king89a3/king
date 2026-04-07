/**
 * WIN.X.KING — Server v3.0 — 100% Render compatible
 */
const express = require('express');
const cors    = require('cors');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app  = express();
const PORT = process.env.PORT || 10000;
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

// ── FIREBASE INIT ─────────────────────────────────────────────
function initFirebase() {
  if (getApps().length > 0) return true;

  // METHOD 1: Single JSON (BEST for Render — no \n issues at all)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
      console.log('Firebase: OK via JSON');
      return true;
    } catch(e) { console.error('Firebase JSON failed:', e.message); }
  }

  // METHOD 2: Separate vars with all possible \n fixes
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
    try {
      let k = process.env.FIREBASE_PRIVATE_KEY;
      k = k.replace(/\\n/g, '\n');
      k = k.replace(/\\\\n/g, '\n');
      if (!k.includes('-----BEGIN')) throw new Error('Key invalid');
      initializeApp({ credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  k,
      })});
      console.log('Firebase: OK via env vars');
      return true;
    } catch(e) { console.error('Firebase env vars failed:', e.message); }
  }

  return false;
}

if (!initFirebase()) {
  console.error('FIREBASE NOT CONFIGURED — set FIREBASE_SERVICE_ACCOUNT_JSON');
  app.use((req,res) => res.status(503).json({ok:false,msg:'Firebase not configured'}));
  app.listen(PORT);
  return;
}

const db = getFirestore();
const COL = {
  passwords: () => db.collection('wxk_passwords'),
  today:     () => db.collection('wxk_meta').doc('today'),
  ad:        () => db.collection('wxk_meta').doc('ad'),
  stats:     () => db.collection('wxk_meta').doc('stats'),
};

// ── HELPERS ───────────────────────────────────────────────────
const rl = {};
function rateLimit(ip, key, max, ms) {
  const k = ip+':'+key, now = Date.now();
  if (!rl[k] || now-rl[k].s > ms) { rl[k]={c:1,s:now}; return false; }
  return ++rl[k].c > max;
}
setInterval(()=>{const n=Date.now();Object.keys(rl).forEach(k=>{if(n-rl[k].s>600000)delete rl[k];});},600000);

function getIP(req){return(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket?.remoteAddress||'unknown';}
function auth(req){const p=process.env.ADMIN_PASS;return p&&req.headers['x-pass']===p;}
function genCode(){const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<8;i++){if(i===4)s+='-';s+=c[Math.floor(Math.random()*c.length)];}return s;}

const PLANS = {
  '3':  {days:3, price:99,  locations:1, label:'TRIAL'},
  '7':  {days:7, price:199, locations:2, label:'BASIC'},
  '30': {days:30,price:599, locations:4, label:'PRO'},
};

async function getPwd(code){try{const s=await COL.passwords().doc(code).get();return s.exists?{...s.data(),code:s.id}:null;}catch(e){return null;}}
async function savePwd(code,data){await COL.passwords().doc(code).set(data,{merge:true});}
async function getToday(){try{const s=await COL.today().get();return s.exists?s.data():null;}catch(e){return null;}}
async function getAd(){try{const s=await COL.ad().get();return s.exists?s.data():null;}catch(e){return null;}}
async function getStats(){try{const s=await COL.stats().get();return s.exists?s.data():{sold:0,revenue:0};}catch(e){return{sold:0,revenue:0};}}

function getPred(today,label){
  if(!today)return null;
  const map={TRIAL:'plan99',BASIC:'plan199',PRO:'plan599'};
  const key=map[label]||'plan599';
  if(!today[key])return null;
  return{date:today.date,locations:today[key].locations||[],extraNums:today.extraNums||[]};
}

// ── PUBLIC ────────────────────────────────────────────────────
app.get('/',(req,res)=>res.json({ok:true,status:'WIN.X.KING ONLINE'}));

app.post('/access', async(req,res)=>{
  const ip=getIP(req);
  if(rateLimit(ip,'access',15,60000))return res.json({ok:false,msg:'Bahut zyada attempts. 1 min ruko.'});
  const{code,deviceId}=req.body;
  if(!code)return res.json({ok:false,msg:'Code daalo'});
  const clean=code.trim().toUpperCase();
  try{
    const pwd=await getPwd(clean);
    if(!pwd)return res.json({ok:false,msg:'Galat code — Telegram pe contact karo'});
    const now=Date.now();
    if(!pwd.used){
      if(pwd.expiry<now)return res.json({ok:false,msg:'Code expire ho gaya — naya lo'});
      const userExpiry=now+(pwd.days*86400000);
      await savePwd(clean,{used:true,activatedAt:now,userExpiry,deviceId:deviceId||null,sessionActive:true,lastSeen:now});
      const plan=PLANS[String(pwd.days)]||PLANS['30'];
      const[today,ad]=await Promise.all([getToday(),getAd()]);
      const pred=getPred(today,plan.label);
      return res.json({ok:true,daysLeft:pwd.days,plan,hasPrediction:!!pred,prediction:pred||null,ad:(ad&&ad.enabled)?ad:null});
    }
    if(pwd.deviceId&&deviceId&&pwd.deviceId!==deviceId)return res.json({ok:false,msg:'Ye code doosre phone pe use ho chuka hai. Naya lo — Telegram pe aao'});
    if(!pwd.userExpiry||pwd.userExpiry<now)return res.json({ok:false,msg:'Access expire ho gaya — naya code lo'});
    const upd={sessionActive:true,lastSeen:now};
    if(!pwd.deviceId&&deviceId)upd.deviceId=deviceId;
    await savePwd(clean,upd);
    const daysLeft=Math.ceil((pwd.userExpiry-now)/86400000);
    const plan=PLANS[String(pwd.days)]||PLANS['30'];
    const[today,ad]=await Promise.all([getToday(),getAd()]);
    const pred=getPred(today,plan.label);
    return res.json({ok:true,daysLeft,plan,hasPrediction:!!pred,prediction:pred||null,ad:(ad&&ad.enabled)?ad:null});
  }catch(e){console.error('/access:',e.message);return res.status(500).json({ok:false,msg:'Server error. Dobara try karo.'});}
});

app.post('/verify', async(req,res)=>{
  const ip=getIP(req);
  if(rateLimit(ip,'verify',20,60000))return res.json({ok:false});
  const{code,deviceId}=req.body;
  if(!code)return res.json({ok:false});
  const clean=code.trim().toUpperCase();
  try{
    const pwd=await getPwd(clean);
    if(!pwd||!pwd.used)return res.json({ok:false,msg:'Session expire — dobara login karo'});
    const now=Date.now();
    if(pwd.sessionActive===false)return res.json({ok:false,msg:'Session expire — dobara login karo'});
    if(!pwd.userExpiry||pwd.userExpiry<now)return res.json({ok:false,msg:'Access expire ho gaya — naya code lo'});
    if(pwd.deviceId&&deviceId&&pwd.deviceId!==deviceId)return res.json({ok:false,msg:'Ye code doosre phone pe use ho chuka hai.'});
    await savePwd(clean,{lastSeen:now});
    const daysLeft=Math.ceil((pwd.userExpiry-now)/86400000);
    const plan=PLANS[String(pwd.days)]||PLANS['30'];
    const[today,ad]=await Promise.all([getToday(),getAd()]);
    const pred=getPred(today,plan.label);
    return res.json({ok:true,daysLeft,plan,hasPrediction:!!pred,prediction:pred||null,ad:(ad&&ad.enabled)?ad:null});
  }catch(e){return res.status(500).json({ok:false,msg:'Server error'});}
});

app.get('/ad',async(req,res)=>{const ad=await getAd();res.json({ok:true,ad:(ad&&ad.enabled)?ad:null});});

// ── ADMIN ─────────────────────────────────────────────────────
app.get('/admin/data',async(req,res)=>{
  if(!auth(req))return res.status(401).json({ok:false,msg:'Password galat hai'});
  try{
    const[snap,today,ad,stats]=await Promise.all([COL.passwords().get(),getToday(),getAd(),getStats()]);
    const passwords=snap.docs.map(d=>({...d.data(),code:d.id}));
    return res.json({ok:true,passwords,today:today||null,ad:ad||null,sold:stats.sold||passwords.filter(p=>p.used).length,revenue:stats.revenue||0});
  }catch(e){console.error('/admin/data:',e.message);return res.status(500).json({ok:false,msg:'Server error: '+e.message});}
});

app.post('/admin/predict',async(req,res)=>{
  if(!auth(req))return res.status(401).json({ok:false});
  const{plan99,plan199,plan599,extraNums}=req.body;
  try{
    const pred={date:new Date().toLocaleDateString('en-IN'),plan99:plan99||null,plan199:plan199||null,plan599:plan599||null,extraNums:(extraNums||[]).slice(0,8),savedAt:Date.now()};
    await COL.today().set(pred);
    res.json({ok:true,prediction:pred});
  }catch(e){res.status(500).json({ok:false,msg:e.message});}
});

app.delete('/admin/today',async(req,res)=>{
  if(!auth(req))return res.status(401).json({ok:false});
  try{await COL.today().delete();res.json({ok:true});}catch(e){res.status(500).json({ok:false,msg:e.message});}
});

app.post('/admin/pwd',async(req,res)=>{
  if(!auth(req))return res.status(401).json({ok:false});
  const{name='User',days=30}=req.body;
  try{
    const plan=PLANS[String(days)]||PLANS['30'];
    const code=genCode(),now=Date.now();
    await COL.passwords().doc(code).set({code,name,days:plan.days,price:plan.price,createdAt:now,expiry:now+(30*86400000),used:false,userExpiry:null,deviceId:null,sessionActive:false,activatedAt:null,lastSeen:null});
    const stats=await getStats();
    await COL.stats().set({sold:(stats.sold||0)+1,revenue:(stats.revenue||0)+plan.price});
    res.json({ok:true,code,days:plan.days,name,price:plan.price});
  }catch(e){res.status(500).json({ok:false,msg:e.message});}
});

app.delete('/admin/pwd/:code',async(req,res)=>{
  if(!auth(req))return res.status(401).json({ok:false});
  try{await COL.passwords().doc(req.params.code.toUpperCase()).delete();res.json({ok:true});}catch(e){res.status(500).json({ok:false,msg:e.message});}
});

app.get('/admin/ad',async(req,res)=>{
  if(!auth(req))return res.status(401).json({ok:false});
  const ad=await getAd();res.json({ok:true,ad:ad||null});
});

app.post('/admin/ad',async(req,res)=>{
  if(!auth(req))return res.status(401).json({ok:false});
  const{enabled,text,link,label}=req.body;
  try{
    const ad={enabled:!!enabled,text:text||'',link:link||'',label:label||'Contact Karo',updatedAt:Date.now()};
    await COL.ad().set(ad);res.json({ok:true,ad});
  }catch(e){res.status(500).json({ok:false,msg:e.message});}
});

app.delete('/admin/ad',async(req,res)=>{
  if(!auth(req))return res.status(401).json({ok:false});
  try{await COL.ad().delete();res.json({ok:true});}catch(e){res.status(500).json({ok:false,msg:e.message});}
});

app.post('/admin/logout/:code',async(req,res)=>{
  if(!auth(req))return res.status(401).json({ok:false});
  try{
    const code=req.params.code.toUpperCase();
    const pwd=await getPwd(code);
    if(!pwd)return res.json({ok:false,msg:'Code nahi mila'});
    await savePwd(code,{sessionActive:false,deviceId:null});
    res.json({ok:true,msg:'User force logged out'});
  }catch(e){res.status(500).json({ok:false,msg:e.message});}
});

app.use((req,res)=>res.status(404).json({ok:false,msg:'Invalid API'}));

app.listen(PORT,'0.0.0.0',()=>{
  console.log('WIN.X.KING v3.0 — PORT:'+PORT+' — Firebase:OK');
});
