"use strict";

/* =========================================================
   Track Your Health — Trainings-Log
   Lokale Speicherung (localStorage) + optionale Supabase-Cloud-Sync
   ========================================================= */

const STORAGE_KEY = "tyh-training-data-v1";
const LEGACY_STORAGE_KEY = "ac-training-data-v2";
const LOCAL_UPDATED_KEY = "tyh-local-updated-at";
const SB_URL_KEY = "tyh-sb-url";
const SB_ANON_KEY = "tyh-sb-anon";
const SEED_DATE = "2026-08-11";

function uid(){ return 'ex_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

/* ---------- Default-Daten (nur beim allerersten Start) ---------- */

function mkEx(list, seedLogs, name, group, sets){
  const ex = { id: uid(), name, group };
  list.push(ex);
  const baseAt = new Date(SEED_DATE + "T12:00:00").getTime();
  seedLogs[ex.id] = [{ date: SEED_DATE, sets: sets.map(([w,r], i) => ({weight:w, reps:r, at: baseAt + i})) }];
  return ex;
}

function buildDefaultData(){
  const pushA = { id: uid(), name: "Push A", exercises: [] };
  const pushB = { id: uid(), name: "Push B", exercises: [] };
  const pullA = { id: uid(), name: "Pull A", exercises: [] };
  const pullB = { id: uid(), name: "Pull B", exercises: [] };
  const logs = {};

  mkEx(pushA.exercises, logs, "Bankdrücken mit LH", "Brust", [[60,8],[60,7],[60,6]]);
  mkEx(pushA.exercises, logs, "Schrägbank-Brustpresse", "Brust", [[40,12],[40,10],[40,9]]);
  mkEx(pushA.exercises, logs, "Beinpresse", "Beine", [[120,12],[120,11],[120,10]]);
  mkEx(pushA.exercises, logs, "Schulterdrücken mit KH", "Schultern", [[18,10],[18,9],[18,8]]);
  mkEx(pushA.exercises, logs, "Seitenheben mit KH", "Schultern", [[10,15],[10,14],[10,12]]);
  mkEx(pushA.exercises, logs, "Trizepsdrücken am Kabelzug", "Trizeps", [[25,13],[25,12],[25,11]]);

  mkEx(pushB.exercises, logs, "Schulterdrücken mit LH", "Schultern", [[40,8],[40,7],[40,6]]);
  mkEx(pushB.exercises, logs, "Schrägbankdrücken mit KH", "Brust", [[24,12],[24,10],[24,9]]);
  mkEx(pushB.exercises, logs, "Hackenschmidt / Beinpresse", "Beine", [[100,14],[100,12],[100,11]]);
  mkEx(pushB.exercises, logs, "Beinstrecker", "Beine", [[45,15],[45,13],[45,12]]);
  mkEx(pushB.exercises, logs, "Seitenheben mit KH", "Schultern", [[10,18],[10,15],[10,13]]);
  mkEx(pushB.exercises, logs, "Dips / Trizeps über Kopf", "Trizeps", [[25,12],[25,10],[25,8]]);

  mkEx(pullA.exercises, logs, "Klimmzug / Latzug", "Rücken", [[55,12],[55,10],[55,9]]);
  mkEx(pullA.exercises, logs, "Rudern am Kabelzug", "Rücken", [[50,12],[50,10],[50,10]]);
  mkEx(pullA.exercises, logs, "Rumänisches Kreuzheben", "Beine", [[70,10],[70,9],[70,8]]);
  mkEx(pullA.exercises, logs, "Face Pulls / Reverse Fly", "Schultern", [[20,18],[20,16],[20,15]]);
  mkEx(pullA.exercises, logs, "Bizeps-Curl mit KH", "Bizeps", [[14,12],[14,11],[14,10]]);
  mkEx(pullA.exercises, logs, "Beinbeuger", "Beine", [[40,13],[40,12],[40,11]]);

  mkEx(pullB.exercises, logs, "Rudern schwer (LH / T-Bar)", "Rücken", [[70,9],[70,8],[70,6]]);
  mkEx(pullB.exercises, logs, "Latzug eng / neutral", "Rücken", [[55,12],[55,11],[55,10]]);
  mkEx(pullB.exercises, logs, "Hip Thrust", "Beine", [[80,12],[80,10],[80,9]]);
  mkEx(pullB.exercises, logs, "Beinbeuger", "Beine", [[40,15],[40,13],[40,12]]);
  mkEx(pullB.exercises, logs, "Reverse Fly / Face Pull", "Schultern", [[20,18],[20,16],[20,15]]);
  mkEx(pullB.exercises, logs, "Hammer-Curl mit KH", "Bizeps", [[14,13],[14,12],[14,10]]);

  const plans = [pushA, pullA, pushB, pullB];
  const seedFinishedAt = new Date(SEED_DATE + "T23:59:59").getTime();
  return { plans, logs, lastFinishedAt: seedFinishedAt, lastOpenDay: null };
}

/* ---------- App-State ---------- */

let data = null;
let view = "home";        // home | day | exercise | sheets | account
let currentPlanId = null;
let currentExId = null;
let currentSheetPlanId = null;
let editingExId = null;
let editingPlanId = null;
let extraRows = {};

let trainingState = { running:false, startedAt:null, frozen:0 };
let restState = { running:false, startedAt:null, frozen:0 };

/* ---------- Cloud-Sync-State ---------- */

let sb = null;
let sbSession = null;
let syncBusy = false;
let authMode = "signin";  // signin | signup
let authMsg = null;       // {type:'error'|'ok', text}
let lastSyncedAt = null;
let pushTimer = null;

function getSupabaseConfig(){
  return { url: localStorage.getItem(SB_URL_KEY) || "", anon: localStorage.getItem(SB_ANON_KEY) || "" };
}
function saveSupabaseConfig(url, anon){
  localStorage.setItem(SB_URL_KEY, url.trim());
  localStorage.setItem(SB_ANON_KEY, anon.trim());
}
function clearSupabaseConfig(){
  localStorage.removeItem(SB_URL_KEY);
  localStorage.removeItem(SB_ANON_KEY);
}

function initSupabase(){
  const { url, anon } = getSupabaseConfig();
  if(!url || !anon || typeof window.supabase === "undefined"){ sb = null; return; }
  try{
    sb = window.supabase.createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } });
  } catch(e){ console.error("Supabase-Init fehlgeschlagen", e); sb = null; }
}

async function refreshSession(){
  if(!sb) return;
  const { data: sess } = await sb.auth.getSession();
  sbSession = sess && sess.session ? sess.session : null;
}

function scheduleCloudPush(){
  if(!sb || !sbSession) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushToCloud, 700);
}

async function pushToCloud(){
  if(!sb || !sbSession) return;
  syncBusy = true; renderSyncIndicatorOnly();
  try{
    const { error } = await sb.from("training_data").upsert({
      user_id: sbSession.user.id,
      data: data,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    if(error) throw error;
    lastSyncedAt = Date.now();
  } catch(e){
    console.error("Cloud-Sync (Push) fehlgeschlagen", e);
  } finally{
    syncBusy = false; renderSyncIndicatorOnly();
  }
}

async function pullFromCloudAndMerge(){
  if(!sb || !sbSession) return;
  syncBusy = true; renderSyncIndicatorOnly();
  try{
    const { data: rows, error } = await sb.from("training_data").select("data, updated_at").eq("user_id", sbSession.user.id).maybeSingle();
    if(error) throw error;
    const localUpdatedAt = parseInt(localStorage.getItem(LOCAL_UPDATED_KEY) || "0", 10);
    if(!rows){
      await pushToCloud();
    } else {
      const remoteUpdatedAt = new Date(rows.updated_at).getTime();
      const remoteJson = JSON.stringify(rows.data);
      const localJson = JSON.stringify(data);
      if(remoteJson === localJson){
        lastSyncedAt = Date.now();
      } else if(remoteUpdatedAt > localUpdatedAt){
        const useRemote = confirm(
          "In der Cloud liegt ein neuerer Trainingsstand als auf diesem Gerät.\n\n" +
          "OK = Cloud-Stand laden (dieses Gerät wird überschrieben)\n" +
          "Abbrechen = diesen Geräte-Stand behalten und in die Cloud hochladen"
        );
        if(useRemote){
          data = rows.data;
          currentSheetPlanId = data.plans[0] ? data.plans[0].id : null;
          saveLocalData();
          lastSyncedAt = Date.now();
        } else {
          await pushToCloud();
        }
      } else {
        await pushToCloud();
      }
    }
  } catch(e){
    console.error("Cloud-Sync (Pull) fehlgeschlagen", e);
  } finally{
    syncBusy = false; renderSyncIndicatorOnly();
    render();
  }
}

async function signUp(email, password){
  authMsg = null;
  if(!sb){ authMsg = { type:"error", text:"Bitte zuerst Supabase-URL und Anon-Key speichern." }; render(); return; }
  const { data: res, error } = await sb.auth.signUp({ email, password });
  if(error){ authMsg = { type:"error", text: error.message }; render(); return; }
  if(res.session){
    sbSession = res.session;
    await pullFromCloudAndMerge();
  } else {
    authMsg = { type:"ok", text:"Konto erstellt. Bitte bestätige deine E-Mail-Adresse und melde dich danach an." };
  }
  render();
}
async function signIn(email, password){
  authMsg = null;
  if(!sb){ authMsg = { type:"error", text:"Bitte zuerst Supabase-URL und Anon-Key speichern." }; render(); return; }
  const { data: res, error } = await sb.auth.signInWithPassword({ email, password });
  if(error){ authMsg = { type:"error", text: error.message }; render(); return; }
  sbSession = res.session;
  await pullFromCloudAndMerge();
  render();
}
async function signOut(){
  if(sb) await sb.auth.signOut();
  sbSession = null;
  render();
}

/* ---------- Timer ---------- */

function getElapsedMs(state){ return state.running ? (Date.now() - state.startedAt) : state.frozen; }
function fmtTime(ms){
  const totalSec = Math.max(0, Math.floor(ms/1000));
  const h = Math.floor(totalSec/3600);
  const m = Math.floor((totalSec%3600)/60);
  const s = totalSec%60;
  const mm = String(m).padStart(2,"0");
  const ss = String(s).padStart(2,"0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
function startTimer(state){ state.running = true; state.startedAt = Date.now(); state.frozen = 0; }
function stopTimer(state){
  if(state.running){ state.frozen = Date.now() - state.startedAt; state.running = false; state.startedAt = null; }
}
function updateRestUI(){
  const valEl = document.getElementById("rest-timer-value");
  if(valEl) valEl.textContent = fmtTime(getElapsedMs(restState));
  const btnEl = document.querySelector('[data-action="toggle-rest-timer"]');
  if(btnEl){
    btnEl.textContent = restState.running ? "Stop" : "Start";
    btnEl.classList.toggle("running", restState.running);
  }
}
function tickTimers(){
  if(trainingState.running){
    const el2 = document.getElementById("training-timer-value");
    if(el2) el2.textContent = fmtTime(getElapsedMs(trainingState));
  }
  if(restState.running){
    const el2 = document.getElementById("rest-timer-value");
    if(el2) el2.textContent = fmtTime(getElapsedMs(restState));
  }
}
setInterval(tickTimers, 1000);

function renderTimerBarHtml(){
  return `<div class="timer-bar">
    <div class="timer-block">
      <div>
        <div class="timer-label">Pause</div>
        <div class="timer-value" id="rest-timer-value">${fmtTime(getElapsedMs(restState))}</div>
      </div>
      <button class="timer-btn ${restState.running ? "running" : ""}" data-action="toggle-rest-timer">${restState.running ? "Stop" : "Start"}</button>
    </div>
  </div>`;
}

function todayStr(){
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function fmtDate(iso){
  const [y,m,d] = iso.split("-");
  return d + "." + m + "." + y.slice(2);
}

/* ---------- Lokale Speicherung ---------- */

function loadLocalData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  } catch(e){}
  try{
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if(legacy) return JSON.parse(legacy);
  } catch(e){}
  return null;
}
function saveLocalData(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(LOCAL_UPDATED_KEY, String(Date.now()));
  } catch(e){ console.error("Lokales Speichern fehlgeschlagen", e); }
}
async function saveData(){
  saveLocalData();
  scheduleCloudPush();
}

function migratePlansIfNeeded(){
  if(Array.isArray(data.plans)) return false;
  const labelMap = { pushA: "Push A", pullA: "Pull A", pushB: "Push B", pullB: "Pull B" };
  const order = ["pushA", "pullA", "pushB", "pullB"];
  const oldPlans = data.plans || {};
  const newPlans = [];
  order.forEach(key=>{
    if(oldPlans[key]) newPlans.push({ id: uid(), name: labelMap[key], exercises: oldPlans[key] });
  });
  Object.keys(oldPlans).forEach(key=>{
    if(!order.includes(key)) newPlans.push({ id: uid(), name: key, exercises: oldPlans[key] });
  });
  data.plans = newPlans;
  return true;
}

function restoreOpenDay(){
  if(!data.lastOpenDay) return;
  if(!findPlan(data.lastOpenDay)) return;
  view = "day";
  currentPlanId = data.lastOpenDay;
  startTimer(trainingState);
}

async function loadData(){
  data = loadLocalData();
  if(!data){ data = buildDefaultData(); saveLocalData(); }
  const migrated = migratePlansIfNeeded();
  if(typeof data.lastFinishedAt !== "number") data.lastFinishedAt = 0;
  if(data.lastOpenDay === undefined) data.lastOpenDay = null;
  currentSheetPlanId = data.plans[0] ? data.plans[0].id : null;
  restoreOpenDay();
  if(migrated) saveLocalData();

  initSupabase();
  if(sb){
    await refreshSession();
    sb.auth.onAuthStateChange((_event, session)=>{
      sbSession = session;
      render();
    });
    if(sbSession) await pullFromCloudAndMerge();
  }
  render();
}

/* ---------- Helpers ---------- */

function el(html){
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}
function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function fmtW(w){ return (Math.round(w*10)/10).toString().replace(/\.0$/, ""); }
function icon(name, cls){ return `<svg class="icon${cls?(' '+cls):''}"><use href="#ic-${name}"/></svg>`; }

function findPlan(planId){ return data.plans.find(p => p.id === planId) || null; }
function findExercise(id){
  for(const plan of data.plans){
    const found = plan.exercises.find(e=>e.id===id);
    if(found) return found;
  }
  return null;
}
function getSessions(exId){
  return (data.logs[exId] || [])
    .map(entry => ({ date: entry.date, sets: entry.sets.filter(s => (s.at||0) <= data.lastFinishedAt) }))
    .filter(entry => entry.sets.length > 0)
    .sort((a,b)=> a.date.localeCompare(b.date));
}
function allSetsFlat(exId){
  const out = [];
  (data.logs[exId] || []).forEach(entry=>{
    entry.sets.forEach(s=>{ out.push({ date: entry.date, weight: s.weight, reps: s.reps, at: s.at || 0 }); });
  });
  out.sort((a,b)=> a.at - b.at);
  return out;
}
function getSessionCheckedSets(exId){
  return allSetsFlat(exId).filter(s => s.at > data.lastFinishedAt);
}
function getPriorReferenceSession(exId){
  const prior = allSetsFlat(exId).filter(s => s.at <= data.lastFinishedAt);
  if(prior.length === 0) return null;
  const lastDate = prior[prior.length-1].date;
  const sets = prior.filter(s => s.date === lastDate).map(s => ({weight:s.weight, reps:s.reps}));
  return { date: lastDate, sets };
}

function getAllFinishedDates(){
  const set = new Set();
  Object.keys(data.logs).forEach(exId=>{
    (data.logs[exId]||[]).forEach(entry=>{
      const hasFinished = entry.sets.some(s => (s.at||0) <= data.lastFinishedAt);
      if(hasFinished) set.add(entry.date);
    });
  });
  return [...set].sort();
}
function computeStats(){
  const dates = getAllFinishedDates();
  const dateSet = new Set(dates);
  const today = new Date(todayStr()+"T00:00:00");
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate()-6);
  const sessionsThisWeek = dates.filter(d=>{
    const dt = new Date(d+"T00:00:00");
    return dt >= weekAgo && dt <= today;
  }).length;

  let streak = 0;
  let cursor = new Date(today);
  if(!dateSet.has(todayStr())) cursor.setDate(cursor.getDate()-1);
  while(true){
    const key = cursor.getFullYear()+"-"+String(cursor.getMonth()+1).padStart(2,"0")+"-"+String(cursor.getDate()).padStart(2,"0");
    if(dateSet.has(key)){ streak++; cursor.setDate(cursor.getDate()-1); } else break;
  }
  return { sessionsThisWeek, streak, totalSessions: dates.length };
}

/* ---------- RENDER ---------- */

function render(){
  const app = document.getElementById("app");
  app.innerHTML = "";
  if(view === "home") app.appendChild(renderHome());
  else if(view === "day") app.appendChild(renderDay());
  else if(view === "exercise") app.appendChild(renderExercise());
  else if(view === "sheets") app.appendChild(renderSheets());
  else if(view === "account") app.appendChild(renderAccount());
  attachEvents();
}

function renderSyncIndicatorOnly(){
  const dot = document.getElementById("topbar-sync-dot");
  if(dot) dot.classList.toggle("has-dot", !!(sb && sbSession));
}

function renderBottomNav(active){
  const synced = !!(sb && sbSession);
  return `<div class="bottom-nav">
    <button class="nav-btn ${active==='home'?'active':''}" data-navview="home">${icon('home')}<span>Home</span></button>
    <button class="nav-btn ${active==='sheets'?'active':''}" data-navview="sheets">${icon('grid')}<span>Workoutz</span></button>
    <button class="nav-btn ${active==='account'?'active':''}" data-navview="account">${icon(synced?'cloud':'user')}<span>${synced?'Sync':'Konto'}</span></button>
  </div>`;
}

function previewText(list){
  const names = list.map(e=>e.name);
  const shown = names.slice(0,3).join(", ");
  return `${list.length} Übungen · ${shown}${names.length > 3 ? "…" : ""}`;
}

function renderPlanForm(plan){
  const isNew = !plan;
  const nameVal = plan ? esc(plan.name) : "";
  return el(`<div class="inline-form">
    <label>Name des Trainingsplans</label>
    <input type="text" id="plan-form-name" value="${nameVal}" placeholder="z.B. Push A">
    <div class="form-row">
      <button class="form-btn ghost" data-action="cancel-plan-form">Abbrechen</button>
      <button class="form-btn primary" data-action="save-plan-form" data-planid="${isNew ? '__new__' : plan.id}">Speichern</button>
    </div>
  </div>`);
}

function renderHome(){
  const stats = computeStats();
  const synced = !!(sb && sbSession);
  const wrap = el(`<div>
    <div class="topbar">
      <img class="logo-badge" src="icons/icon-192.png" alt="Track Your Health Logo">
      <div class="brand-text">
        <div class="b1">TRACK YOUR HEALTH</div>
        <div class="b2">Training Log</div>
      </div>
      <button class="topbar-action" id="topbar-sync-dot" data-navview="account" title="${synced?'Cloud-Sync aktiv':'Konto & Sync'}">${icon(synced?'cloud':'user')}</button>
    </div>
    <div class="hero">
      <div class="eyebrow">Deine Pläne</div>
      <h1 class="display">Was steht an?</h1>
    </div>
    <div class="stats-strip">
      <div class="stat-card">
        <div class="stat-val">${stats.sessionsThisWeek}<span class="unit">Sessions</span></div>
        <div class="stat-label">Diese Woche</div>
      </div>
      <div class="stat-card accent">
        <div class="stat-val">${stats.streak}${icon('flame')}</div>
        <div class="stat-label">Tage-Streak</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${stats.totalSessions}<span class="unit">Total</span></div>
        <div class="stat-label">Einheiten</div>
      </div>
    </div>
    <div class="routine-list" id="routine-list"></div>
    <button class="workoutz-btn" id="open-sheets">${icon('grid')} Workoutz — Tabellenansicht</button>
  </div>`);

  const listEl = wrap.querySelector("#routine-list");

  if(data.plans.length === 0 && editingPlanId !== "__new__"){
    listEl.appendChild(el(`<div class="empty-state">${icon('dumbbell')}<br>Noch keine Trainingspläne.<br>Leg unten deinen ersten an.</div>`));
  }

  data.plans.forEach(plan=>{
    if(editingPlanId === plan.id){
      listEl.appendChild(renderPlanForm(plan));
      return;
    }
    const list = plan.exercises.filter(ex => !ex.removed);
    const card = el(`<div class="routine-card" data-planid="${plan.id}">
      <div class="routine-glyph">${icon('dumbbell')}</div>
      <div class="routine-info">
        <div class="routine-name">${esc(plan.name)}</div>
        <div class="routine-sub">${list.length ? previewText(list) : "Noch keine Übungen"}</div>
      </div>
      <div class="routine-actions">
        <button class="icon-btn" data-action="edit-plan" data-planid="${plan.id}" title="Umbenennen">${icon('edit')}</button>
        <button class="icon-btn danger" data-action="delete-plan" data-planid="${plan.id}" title="Löschen">${icon('trash')}</button>
        <button class="start-btn" data-planid="${plan.id}">Start</button>
      </div>
    </div>`);
    listEl.appendChild(card);
  });

  if(editingPlanId === "__new__"){
    listEl.appendChild(renderPlanForm(null));
  } else {
    wrap.appendChild(el(`<button class="add-plan-btn" id="add-plan-btn">${icon('plus')} Neuen Trainingsplan erstellen</button>`));
  }

  wrap.appendChild(el(`<div class="nav-spacer"></div>`));
  wrap.appendChild(el(renderBottomNav("home")));
  return wrap;
}

function renderDay(){
  const plan = findPlan(currentPlanId);
  if(!plan){ view = "home"; return renderHome(); }
  const list = plan.exercises.filter(ex => !ex.removed);
  const wrap = el(`<div>
    <div class="workout-header">
      <button class="icon-x" id="exit-workout" title="Zurück">${icon('x')}</button>
      <div class="wh-mid">
        <div class="wh-title">${icon('dumbbell')} ${esc(plan.name)}</div>
        <div class="wh-timer" id="training-timer-value">${fmtTime(getElapsedMs(trainingState))}</div>
      </div>
      <button class="finish-btn" id="finish-workout">Fertig</button>
    </div>
    <div class="warmup-note">${icon('flame')} Aufwärmen &amp; Dehnen nicht vergessen</div>
    <div id="ex-list"></div>
  </div>`);

  const listEl = wrap.querySelector("#ex-list");

  if(list.length === 0 && editingExId !== "__new__"){
    listEl.appendChild(el(`<div class="empty-state">${icon('dumbbell')}<br>Noch keine Übungen für ${esc(plan.name)}.<br>Füg deine erste Übung hinzu.</div>`));
  }

  list.forEach(ex=>{
    if(editingExId === ex.id){ listEl.appendChild(renderEditForm(ex)); return; }
    listEl.appendChild(renderExerciseCard(ex));
  });

  if(editingExId === "__new__"){
    listEl.appendChild(renderEditForm(null));
  } else {
    listEl.appendChild(el(`<button class="add-ex-btn" id="add-ex-btn">${icon('plus')} Übung hinzufügen</button>`));
  }

  wrap.appendChild(el(`<div class="timer-spacer"></div>`));
  wrap.appendChild(el(renderTimerBarHtml()));
  return wrap;
}

function renderExerciseCard(ex){
  const priorSession = getPriorReferenceSession(ex.id);
  const sessionSets = getSessionCheckedSets(ex.id);
  const checkedCount = sessionSets.length;
  const rowCount = Math.max(3 + (extraRows[ex.id]||0), checkedCount);

  const rows = [];
  for(let i=0;i<rowCount;i++){
    const isChecked = i < checkedCount;
    const prevSet = (priorSession && priorSession.sets[i]) ? priorSession.sets[i] : null;
    const prevTxt = prevSet ? `${fmtW(prevSet.weight)}kg×${prevSet.reps}` : "–";

    let midHtml, checkHtml;
    if(isChecked){
      const s = sessionSets[i];
      midHtml = `<div class="set-static">${fmtW(s.weight)}</div><div class="set-static">${s.reps}</div>`;
      const isLastChecked = i === checkedCount - 1;
      checkHtml = isLastChecked
        ? `<button class="set-check done" data-action="uncheck-set" data-ex="${ex.id}" data-idx="${i}">${icon('check')}</button>`
        : `<button class="set-check done" disabled>${icon('check')}</button>`;
    } else {
      const wVal = prevSet ? fmtW(prevSet.weight) : "";
      const rVal = prevSet ? prevSet.reps : "";
      midHtml = `<input type="number" inputmode="decimal" step="0.5" min="0" class="set-input weight-input" data-ex="${ex.id}" data-idx="${i}" value="${wVal}">`
              + `<input type="number" inputmode="numeric" min="0" class="set-input reps-input" data-ex="${ex.id}" data-idx="${i}" value="${rVal}">`;
      const isNext = i === checkedCount;
      checkHtml = isNext
        ? `<button class="set-check" data-action="check-set" data-ex="${ex.id}" data-idx="${i}">${icon('check')}</button>`
        : `<button class="set-check" disabled>${icon('check')}</button>`;
    }

    rows.push(`<div class="set-row ${isChecked ? "done" : ""}" style="display:contents">
      <div class="set-num">${i+1}</div>
      <div class="set-prev">${prevTxt}</div>
      ${midHtml}
      ${checkHtml}
    </div>`);
  }

  return el(`<div class="ex-card" data-exid="${ex.id}">
    <div class="ex-top">
      <div>
        <div class="ex-name">${esc(ex.name)}</div>
        ${ex.group ? `<div class="ex-meta">${esc(ex.group)}</div>` : ``}
      </div>
      <div class="ex-icons">
        <button class="icon-btn chart-btn" data-action="chart" data-exid="${ex.id}" title="Fortschritt">${icon('chart')}</button>
        <button class="icon-btn" data-action="edit" data-exid="${ex.id}" title="Bearbeiten">${icon('edit')}</button>
        <button class="icon-btn danger" data-action="delete" data-exid="${ex.id}" title="Löschen">${icon('trash')}</button>
      </div>
    </div>
    <div class="set-table">
      <div class="thead"></div><div class="thead">Letztes Mal</div><div class="thead">Kg</div><div class="thead">Wdh</div><div class="thead"></div>
      ${rows.join("")}
    </div>
    <button class="add-set-row" data-action="add-set-row" data-exid="${ex.id}">${icon('plus')} Satz hinzufügen</button>
  </div>`);
}

function renderEditForm(ex){
  const isNew = !ex;
  const nameVal = ex ? esc(ex.name) : "";
  const groupVal = ex ? esc(ex.group || "") : "";
  return el(`<div class="inline-form">
    <label>Name der Übung</label>
    <input type="text" id="form-name" value="${nameVal}" placeholder="z.B. Butterfly">
    <label>Muskelgruppe (optional)</label>
    <input type="text" id="form-group" value="${groupVal}" placeholder="z.B. Brust">
    <div class="form-row">
      <button class="form-btn ghost" data-action="cancel-form">Abbrechen</button>
      <button class="form-btn primary" data-action="save-form" data-exid="${isNew ? '__new__' : ex.id}">Speichern</button>
    </div>
  </div>`);
}

const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X"];
function romanOrNum(i){ return ROMAN[i] || String(i+1); }

function buildSheetData(planId){
  const plan = findPlan(planId);
  if(!plan) return { exercises: [], dates: [], maxSetsByDate: {} };
  const exercises = plan.exercises.filter(ex => !ex.hiddenFromSheet);
  const dateSet = new Set();
  exercises.forEach(ex => getSessions(ex.id).forEach(entry => dateSet.add(entry.date)));
  const dates = [...dateSet].sort();
  const maxSetsByDate = {};
  dates.forEach(d=>{
    let max = 1;
    exercises.forEach(ex=>{
      const entry = getSessions(ex.id).find(e => e.date === d);
      if(entry && entry.sets.length > max) max = entry.sets.length;
    });
    maxSetsByDate[d] = max;
  });
  return { exercises, dates, maxSetsByDate };
}

function buildRowCells(ex, dates, maxSetsByDate, field){
  if(dates.length === 0) return `<td>–</td>`;
  let html = "";
  dates.forEach(d=>{
    const n = maxSetsByDate[d];
    const entry = getSessions(ex.id).find(e => e.date === d);
    for(let i=0;i<n;i++){
      const s = entry && entry.sets[i];
      if(s){
        const val = field === "weight" ? fmtW(s.weight) : s.reps;
        html += `<td><input type="number" inputmode="decimal" class="sheet-cell-input" data-exid="${ex.id}" data-date="${d}" data-at="${s.at}" data-field="${field}" value="${val}"></td>`;
      } else {
        html += `<td><span class="sheet-cell-empty">–</span></td>`;
      }
    }
  });
  return html;
}

function buildSheetTableHtml(exercises, dates, maxSetsByDate){
  let headDates = `<th class="lbl-col">Übung</th><th class="lbl-col2">Gruppe</th><th class="lbl-col3"></th>`;
  let headSets = `<th class="lbl-col"></th><th class="lbl-col2"></th><th class="lbl-col3"></th>`;
  if(dates.length === 0){
    headDates += `<th>—</th>`;
    headSets += `<th>—</th>`;
  } else {
    dates.forEach(d=>{
      const n = maxSetsByDate[d];
      headDates += `<th class="sheet-datehead" colspan="${n}">${fmtDate(d)} <button class="date-del-btn" data-action="sheet-delete-date" data-date="${d}" title="Diese Einheit für alle Übungen löschen">${icon('trash')}</button></th>`;
      for(let i=0;i<n;i++) headSets += `<th class="sheet-datehead">${romanOrNum(i)}</th>`;
    });
  }

  let bodyHtml = "";
  exercises.forEach(ex=>{
    const removedTag = ex.removed ? ` <span style="color:var(--text-dim); font-size:9px; font-weight:400;">(entfernt)</span>` : "";
    bodyHtml += `<tr>
      <td class="lbl-col" rowspan="2">
        <input class="sheet-name-input" data-exname="${ex.id}" value="${esc(ex.name)}">${removedTag}
      </td>
      <td class="lbl-col2" rowspan="2">
        <input class="sheet-group-input" data-exgroup="${ex.id}" value="${esc(ex.group||'')}" placeholder="–">
      </td>
      <td class="lbl-col3"><span class="sheet-rowtype">Kg</span></td>
      ${buildRowCells(ex, dates, maxSetsByDate, "weight")}
    </tr>
    <tr>
      <td class="lbl-col3">
        <span class="sheet-rowtype">Wdh</span>
        <button class="sheet-del-btn" data-action="sheet-hide-ex" data-exid="${ex.id}" title="Nur aus Workoutz entfernen">${icon('trash')}</button>
      </td>
      ${buildRowCells(ex, dates, maxSetsByDate, "reps")}
    </tr>`;
  });

  return `<div class="sheet-scroll"><table class="sheet-table">
    <thead><tr>${headDates}</tr><tr>${headSets}</tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table></div>`;
}

function renderSheets(){
  const plan = findPlan(currentSheetPlanId);
  const wrap = el(`<div>
    <div class="back-row">
      <button class="back-btn" data-navview="home">${icon('arrow-left')} Home</button>
      <button class="topbar-action" data-navview="account" title="Konto &amp; Sync">${icon((sb && sbSession)?'cloud':'user')}</button>
    </div>
    <div class="day-title">
      <div class="eyebrow">Workoutz</div>
      <h2>${plan ? esc(plan.name) : "—"}</h2>
    </div>
    <div id="sheet-container"></div>
  </div>`);

  const container = wrap.querySelector("#sheet-container");
  if(!plan){
    container.appendChild(el(`<div class="sheet-empty">Noch keine Trainingspläne vorhanden.</div>`));
  } else {
    const { exercises, dates, maxSetsByDate } = buildSheetData(currentSheetPlanId);
    if(exercises.length === 0){
      container.appendChild(el(`<div class="sheet-empty">Noch keine Übungen für ${esc(plan.name)}. Füg im Workout eine Übung hinzu, dann erscheint hier automatisch eine Zeile.</div>`));
    } else {
      container.appendChild(el(buildSheetTableHtml(exercises, dates, maxSetsByDate)));
    }
  }

  const tabs = data.plans.map(p=>`<button class="sheet-tab ${p.id===currentSheetPlanId?'active':''}" data-sheetplanid="${p.id}">${esc(p.name)}</button>`).join("");
  wrap.appendChild(el(`<div class="sheet-tabs">${tabs}</div>`));
  return wrap;
}

function renderExercise(){
  const ex = findExercise(currentExId);
  if(!ex){ view = "day"; return renderDay(); }
  const sessions = getSessions(ex.id);

  const wrap = el(`<div>
    <div class="back-row">
      <button class="back-btn" id="back-day">${icon('arrow-left')} ${esc(findPlan(currentPlanId)?.name || "Plan")}</button>
    </div>
    <div class="ex-detail-head">
      <div class="eyebrow">Fortschritt</div>
      <h2>${esc(ex.name)}</h2>
      ${ex.group ? `<div class="code">${esc(ex.group)}</div>` : ""}
    </div>
    <div class="chart-card" id="chart-card"></div>
    <div class="hist-list">
      <div class="hist-title">Verlauf</div>
      <div id="hist-rows"></div>
    </div>
  </div>`);

  wrap.querySelector("#chart-card").appendChild(renderChart(sessions));

  const histRows = wrap.querySelector("#hist-rows");
  if(sessions.length === 0){
    histRows.appendChild(el(`<div class="empty-state">Noch keine Einträge. Trag im Tagesplan deine erste Session ein.</div>`));
  } else {
    sessions.slice().reverse().forEach(s=>{
      const setsTxt = s.sets.map(x => fmtW(x.weight)+"kg×"+x.reps).join(" · ");
      histRows.appendChild(el(`<div class="hist-row">
        <div class="sets-txt">${setsTxt}</div>
        <span class="d">${fmtDate(s.date)}</span>
      </div>`));
    });
  }

  wrap.appendChild(el(`<div class="timer-spacer"></div>`));
  wrap.appendChild(el(renderTimerBarHtml()));
  return wrap;
}

function computeYScale(maxWeight){
  const safeMax = Math.max(maxWeight, 5);
  const padded = safeMax * 1.15;
  const candidates = [5,10,15,20,25,30,40,50,60,75,100,125,150,200,250,300,400,500,750,1000];
  let step = candidates[candidates.length-1];
  for(const c of candidates){
    if(Math.ceil(padded / c) <= 6){ step = c; break; }
  }
  const top = step * Math.ceil(padded / step);
  const lines = [];
  for(let v=0; v<=top; v+=step) lines.push(v);
  return { top, lines };
}

function renderChart(sessions){
  if(sessions.length === 0){
    return el(`<div class="empty-state" style="padding:24px 6px;">Noch keine Daten für einen Verlauf.<br>Sobald du Sessions einträgst, erscheint hier deine Kurve.</div>`);
  }

  const points = sessions.map(s => ({ date: s.date, weight: Math.max(...s.sets.map(x=>x.weight)) }));
  const maxW = Math.max(...points.map(p=>p.weight));
  const { top: yTop, lines: yLines } = computeYScale(maxW);

  const W = 300, H = 178, padL = 36, padR = 10, padT = 16, padB = 22;
  const xStep = points.length > 1 ? (W - padL - padR) / (points.length - 1) : 0;
  const coords = points.map((p,i)=>{
    const x = padL + (points.length > 1 ? i*xStep : (W-padL-padR)/2);
    const y = padT + (H-padT-padB) * (1 - p.weight/yTop);
    return {x, y, ...p};
  });

  const pathD = coords.map((c,i)=> (i===0 ? "M":"L") + c.x.toFixed(1) + "," + c.y.toFixed(1)).join(" ");
  const areaD = pathD + ` L${coords[coords.length-1].x.toFixed(1)},${H-padB} L${coords[0].x.toFixed(1)},${H-padB} Z`;

  const dots = coords.map((c,i)=> {
    const isLast = i === coords.length-1;
    return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${isLast?4.4:2.6}" fill="${isLast?'#ff8a3d':'#3d9bff'}" opacity="${isLast?1:0.8}"/>`;
  }).join("");

  const gridHtml = yLines.map(v=>{
    const y = padT + (H-padT-padB) * (1 - v/yTop);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" stroke="#1c3350" stroke-width="1"/>`
      + `<text x="${padL-6}" y="${(y+3).toFixed(1)}" font-size="8" fill="#8296b3" text-anchor="end" font-family="Inter">${v}kg</text>`;
  }).join("");

  const n = coords.length;
  let labelIdxs = [0];
  if(n > 4){ labelIdxs.push(Math.round((n-1)/3), Math.round((n-1)*2/3)); }
  else if(n > 2){ labelIdxs.push(Math.round((n-1)/2)); }
  if(n > 1) labelIdxs.push(n-1);
  labelIdxs = [...new Set(labelIdxs)];
  const xLabels = labelIdxs.map(i => {
    const c = coords[i];
    return `<text x="${c.x.toFixed(1)}" y="${H-6}" font-size="8" fill="#8296b3" text-anchor="middle" font-family="Inter">${fmtDate(c.date)}</text>`;
  }).join("");

  const svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fadeGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3d9bff" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#3d9bff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#3d9bff"/>
        <stop offset="100%" stop-color="#ff8a3d"/>
      </linearGradient>
    </defs>
    ${gridHtml}
    <path d="${areaD}" fill="url(#fadeGrad)"/>
    <path d="${pathD}" fill="none" stroke="url(#lineGrad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    ${xLabels}
  </svg>`;

  const first = points[0];
  const last = points[points.length-1];
  const priorMax = points.length > 1 ? Math.max(...points.slice(0,-1).map(p=>p.weight)) : -Infinity;
  const isPR = points.length > 1 && last.weight > priorMax;

  const heroHtml = `<div class="chart-hero">
    <div class="chart-hero-left">
      <span class="chart-hero-val">${fmtW(last.weight)}kg</span>
      <span class="chart-hero-date">${fmtDate(last.date)}</span>
    </div>
    ${isPR ? `<div class="pr-badge">PR</div>` : ``}
  </div>`;

  let deltaHtml = "";
  if(points.length > 1){
    const delta = last.weight - first.weight;
    const sign = delta > 0 ? "+" : "";
    deltaHtml = `<div class="chart-delta"><b>${sign}${fmtW(delta)}kg</b> seit dem ersten Eintrag (${fmtDate(first.date)})</div>`;
  }

  return el(`<div>${heroHtml}${deltaHtml}${svg}</div>`);
}

/* ---------- Account / Sync View ---------- */

function renderAccount(){
  const { url, anon } = getSupabaseConfig();
  const configured = !!(url && anon);
  const loggedIn = !!(sb && sbSession);

  const wrap = el(`<div>
    <div class="back-row">
      <button class="back-btn" id="back-home-account">${icon('arrow-left')} Zurück</button>
    </div>
    <div class="day-title">
      <div class="eyebrow">Konto</div>
      <h2>Cloud-Sync</h2>
    </div>
    <div id="account-body"></div>
  </div>`);

  const body = wrap.querySelector("#account-body");

  if(loggedIn){
    body.appendChild(el(`<div class="acct-card">
      <h3>Verbunden</h3>
      <div class="acct-sub">Deine Trainingsdaten werden automatisch mit Supabase synchronisiert — auf all deinen Geräten.</div>
      <div class="acct-row">
        ${icon('mail')}
        <div class="acct-row-label">${esc(sbSession.user.email || "")}</div>
        <span class="sync-badge on"><span class="dot"></span>${syncBusy ? "Sync…" : "Verbunden"}</span>
      </div>
      <button class="acct-btn ghost" id="acct-sync-now">${icon('refresh')} Jetzt synchronisieren</button>
      <button class="acct-btn danger" id="acct-signout">${icon('logout')} Abmelden</button>
    </div>`));
  } else {
    body.appendChild(el(`<div class="acct-card">
      <h3>Supabase-Projekt verbinden</h3>
      <div class="acct-sub">Trag hier die Zugangsdaten deines Supabase-Projekts ein (Projekteinstellungen → API). Der Anon-Key ist bewusst öffentlich und für den Browser gedacht — Zugriffsschutz übernimmt Row Level Security (siehe README).</div>
      <label style="font-size:10px; text-transform:uppercase; color:var(--text-dim); letter-spacing:0.5px; display:block; margin-bottom:6px; font-weight:700;">Projekt-URL</label>
      <input type="text" id="sb-url-input" placeholder="https://xxxxxxxx.supabase.co" value="${esc(url)}"
        style="width:100%; background:var(--panel2); border:1px solid var(--border); color:var(--text); border-radius:9px; padding:11px 12px; font-size:13.5px; margin-bottom:12px;">
      <label style="font-size:10px; text-transform:uppercase; color:var(--text-dim); letter-spacing:0.5px; display:block; margin-bottom:6px; font-weight:700;">Anon (public) Key</label>
      <input type="text" id="sb-anon-input" placeholder="eyJhbGciOi..." value="${esc(anon)}"
        style="width:100%; background:var(--panel2); border:1px solid var(--border); color:var(--text); border-radius:9px; padding:11px 12px; font-size:13.5px; margin-bottom:14px;">
      <button class="acct-btn primary" id="sb-save-config">${icon('check')} Speichern &amp; verbinden</button>
      ${configured ? `<button class="acct-btn ghost" id="sb-clear-config">Verbindung entfernen</button>` : ``}
    </div>`));

    if(configured){
      const authCard = el(`<div class="acct-card" id="auth-card">
        <div class="acct-tabs">
          <button class="acct-tab ${authMode==='signin'?'active':''}" data-authmode="signin">Anmelden</button>
          <button class="acct-tab ${authMode==='signup'?'active':''}" data-authmode="signup">Registrieren</button>
        </div>
        <div id="auth-msg-slot"></div>
        <label style="font-size:10px; text-transform:uppercase; color:var(--text-dim); letter-spacing:0.5px; display:block; margin-bottom:6px; font-weight:700;">E-Mail</label>
        <input type="email" id="auth-email" placeholder="du@beispiel.de"
          style="width:100%; background:var(--panel2); border:1px solid var(--border); color:var(--text); border-radius:9px; padding:11px 12px; font-size:13.5px; margin-bottom:12px;">
        <label style="font-size:10px; text-transform:uppercase; color:var(--text-dim); letter-spacing:0.5px; display:block; margin-bottom:6px; font-weight:700;">Passwort</label>
        <input type="password" id="auth-password" placeholder="mind. 6 Zeichen"
          style="width:100%; background:var(--panel2); border:1px solid var(--border); color:var(--text); border-radius:9px; padding:11px 12px; font-size:13.5px; margin-bottom:14px;">
        <button class="acct-btn primary" id="auth-submit">${icon(authMode==='signin'?'lock':'mail')} ${authMode==='signin' ? "Anmelden" : "Konto erstellen"}</button>
      </div>`);
      if(authMsg){
        authCard.querySelector("#auth-msg-slot").appendChild(el(`<div class="acct-msg ${authMsg.type==='error'?'error':'ok'}">${esc(authMsg.text)}</div>`));
      }
      body.appendChild(authCard);
    }
  }

  body.appendChild(el(`<div class="acct-card">
    <h3>Daten-Backup</h3>
    <div class="acct-sub">Sichere deine Trainingsdaten als Datei oder importiere ein früheres Backup — unabhängig von der Cloud.</div>
    <button class="acct-btn ghost" id="acct-export">${icon('download')} Backup exportieren</button>
    <button class="acct-btn ghost" id="acct-import">${icon('upload')} Backup importieren</button>
    <input type="file" id="acct-import-file" accept="application/json" style="display:none">
  </div>`));

  body.appendChild(el(`<div class="acct-foot">Track Your Health · lokal &amp; privat, optional mit deiner eigenen Supabase-Cloud synchronisiert.</div>`));

  wrap.appendChild(el(`<div class="nav-spacer"></div>`));
  wrap.appendChild(el(renderBottomNav("account")));
  return wrap;
}

function exportBackup(){
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const urlObj = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = urlObj;
  a.download = `track-your-health-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(urlObj), 2000);
}
function importBackup(file){
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      if(!parsed || !Array.isArray(parsed.plans) || typeof parsed.logs !== "object"){
        alert("Diese Datei sieht nicht nach einem gültigen Backup aus.");
        return;
      }
      if(!confirm("Backup importieren? Der aktuelle Trainingsstand auf diesem Gerät wird ersetzt.")) return;
      data = parsed;
      if(typeof data.lastFinishedAt !== "number") data.lastFinishedAt = 0;
      if(data.lastOpenDay === undefined) data.lastOpenDay = null;
      currentSheetPlanId = data.plans[0] ? data.plans[0].id : null;
      view = "home";
      await saveData();
      render();
    } catch(e){
      alert("Diese Datei konnte nicht gelesen werden.");
    }
  };
  reader.readAsText(file);
}

/* ---------- EVENTS ---------- */

function attachEvents(){
  const app = document.getElementById("app");

  app.querySelectorAll('[data-navview]').forEach(b=>{
    b.addEventListener("click", ()=>{ view = b.dataset.navview; render(); });
  });

  app.querySelectorAll(".routine-card").forEach(card => card.addEventListener("click", async (e)=>{
    if(e.target.closest('[data-action="edit-plan"]') || e.target.closest('[data-action="delete-plan"]')) return;
    currentPlanId = card.dataset.planid;
    view = "day";
    editingExId = null;
    extraRows = {};
    startTimer(trainingState);
    restState = { running:false, startedAt:null, frozen:0 };
    data.lastOpenDay = currentPlanId;
    await saveData();
    render();
  }));

  app.querySelectorAll('[data-action="edit-plan"]').forEach(b=>{
    b.addEventListener("click", (e)=>{ e.stopPropagation(); editingPlanId = b.dataset.planid; render(); });
  });
  app.querySelectorAll('[data-action="delete-plan"]').forEach(b=>{
    b.addEventListener("click", async (e)=>{
      e.stopPropagation();
      const plan = findPlan(b.dataset.planid);
      if(!plan) return;
      if(!confirm(`Trainingsplan "${plan.name}" komplett löschen, inkl. aller Übungen und ihres Verlaufs? Das kann nicht rückgängig gemacht werden.`)) return;
      plan.exercises.forEach(ex => delete data.logs[ex.id]);
      data.plans = data.plans.filter(p => p.id !== plan.id);
      await saveData();
      render();
    });
  });

  const addPlanBtn = app.querySelector("#add-plan-btn");
  if(addPlanBtn) addPlanBtn.addEventListener("click", ()=>{ editingPlanId = "__new__"; render(); });

  app.querySelectorAll('[data-action="cancel-plan-form"]').forEach(b=>{
    b.addEventListener("click", ()=>{ editingPlanId = null; render(); });
  });
  app.querySelectorAll('[data-action="save-plan-form"]').forEach(b=>{
    b.addEventListener("click", async ()=>{
      const name = app.querySelector("#plan-form-name").value.trim();
      if(!name) return;
      if(b.dataset.planid === "__new__"){
        data.plans.push({ id: uid(), name, exercises: [] });
      } else {
        const plan = findPlan(b.dataset.planid);
        if(plan) plan.name = name;
      }
      editingPlanId = null;
      await saveData();
      render();
    });
  });

  const openSheets = app.querySelector("#open-sheets");
  if(openSheets) openSheets.addEventListener("click", ()=>{ view = "sheets"; render(); });

  app.querySelectorAll(".sheet-tab").forEach(t=>{
    t.addEventListener("click", ()=>{ currentSheetPlanId = t.dataset.sheetplanid; render(); });
  });

  const exitBtn = app.querySelector("#exit-workout");
  if(exitBtn) exitBtn.addEventListener("click", async ()=>{
    stopTimer(trainingState); stopTimer(restState);
    data.lastOpenDay = null;
    await saveData();
    view = "home"; editingExId = null; render();
  });
  const finishBtn = app.querySelector("#finish-workout");
  if(finishBtn) finishBtn.addEventListener("click", async ()=>{
    stopTimer(trainingState); stopTimer(restState);
    data.lastFinishedAt = Date.now();
    data.lastOpenDay = null;
    await saveData();
    view = "home"; editingExId = null; render();
  });

  const backDay = app.querySelector("#back-day");
  if(backDay) backDay.addEventListener("click", ()=>{ view = "day"; render(); });
  const backHomeAccount = app.querySelector("#back-home-account");
  if(backHomeAccount) backHomeAccount.addEventListener("click", ()=>{ view = "home"; render(); });

  const addExBtn = app.querySelector("#add-ex-btn");
  if(addExBtn) addExBtn.addEventListener("click", ()=>{ editingExId = "__new__"; render(); });

  app.querySelectorAll('[data-action="edit"]').forEach(b=>{
    b.addEventListener("click", ()=>{ editingExId = b.dataset.exid; render(); });
  });
  app.querySelectorAll('[data-action="cancel-form"]').forEach(b=>{
    b.addEventListener("click", ()=>{ editingExId = null; render(); });
  });
  app.querySelectorAll('[data-action="save-form"]').forEach(b=>{
    b.addEventListener("click", async ()=>{
      const name = app.querySelector("#form-name").value.trim();
      const group = app.querySelector("#form-group").value.trim();
      if(!name) return;
      if(b.dataset.exid === "__new__"){
        const plan = findPlan(currentPlanId);
        if(plan) plan.exercises.push({id: uid(), name, group});
      } else {
        const ex = findExercise(b.dataset.exid);
        if(ex){ ex.name = name; ex.group = group; }
      }
      editingExId = null;
      await saveData();
      render();
    });
  });

  app.querySelectorAll('[data-action="delete"]').forEach(b=>{
    b.addEventListener("click", async ()=>{
      if(!confirm("Diese Übung aus dem Trainingsplan nehmen? Sie taucht danach nicht mehr im Workout auf, bleibt aber in \"Workoutz\" weiterhin sichtbar.")) return;
      const ex = findExercise(b.dataset.exid);
      if(ex){ ex.removed = true; await saveData(); render(); }
    });
  });

  app.querySelectorAll('[data-action="chart"]').forEach(b=>{
    b.addEventListener("click", ()=>{ currentExId = b.dataset.exid; view = "exercise"; render(); });
  });

  app.querySelectorAll('[data-action="check-set"]').forEach(b=>{
    b.addEventListener("click", async ()=>{
      const exid = b.dataset.ex;
      const idx = parseInt(b.dataset.idx, 10);
      const wInput = app.querySelector(`.weight-input[data-ex="${exid}"][data-idx="${idx}"]`);
      const rInput = app.querySelector(`.reps-input[data-ex="${exid}"][data-idx="${idx}"]`);
      const w = parseFloat(wInput.value);
      const r = parseInt(rInput.value, 10);
      if(!(w > 0) || !(r > 0)){
        wInput.style.borderColor = w > 0 ? "var(--border)" : "var(--danger)";
        rInput.style.borderColor = r > 0 ? "var(--border)" : "var(--danger)";
        return;
      }
      if(!data.logs[exid]) data.logs[exid] = [];
      const today = todayStr();
      let entry = data.logs[exid].find(s => s.date === today);
      if(!entry){ entry = {date: today, sets: []}; data.logs[exid].push(entry); }
      entry.sets.push({weight:w, reps:r, at: Date.now()});
      startTimer(restState);
      await saveData();
      render();
    });
  });

  app.querySelectorAll('[data-action="uncheck-set"]').forEach(b=>{
    b.addEventListener("click", async ()=>{
      const exid = b.dataset.ex;
      const sessionSets = getSessionCheckedSets(exid);
      if(sessionSets.length === 0) return;
      const last = sessionSets[sessionSets.length - 1];
      const entry = (data.logs[exid]||[]).find(s => s.date === last.date);
      if(entry){
        const idx = entry.sets.findIndex(s => s.at === last.at);
        if(idx >= 0) entry.sets.splice(idx, 1);
        if(entry.sets.length === 0){
          data.logs[exid] = data.logs[exid].filter(s => s.date !== last.date);
        }
        await saveData();
        render();
      }
    });
  });

  app.querySelectorAll('[data-action="add-set-row"]').forEach(b=>{
    b.addEventListener("click", ()=>{
      extraRows[b.dataset.exid] = (extraRows[b.dataset.exid]||0) + 1;
      render();
    });
  });

  const restBtn = app.querySelector('[data-action="toggle-rest-timer"]');
  if(restBtn) restBtn.addEventListener("click", ()=>{
    restState.running ? stopTimer(restState) : startTimer(restState);
    updateRestUI();
  });

  app.querySelectorAll('.sheet-name-input').forEach(inp=>{
    inp.addEventListener("blur", async ()=>{
      const val = inp.value.trim();
      if(!val) { inp.value = findExercise(inp.dataset.exname)?.name || ""; return; }
      const ex = findExercise(inp.dataset.exname);
      if(ex && ex.name !== val){ ex.name = val; await saveData(); render(); }
    });
  });
  app.querySelectorAll('.sheet-group-input').forEach(inp=>{
    inp.addEventListener("blur", async ()=>{
      const ex = findExercise(inp.dataset.exgroup);
      const val = inp.value.trim();
      if(ex && ex.group !== val){ ex.group = val; await saveData(); render(); }
    });
  });
  app.querySelectorAll('.sheet-cell-input').forEach(inp=>{
    inp.addEventListener("blur", async ()=>{
      const { exid, date, at, field } = inp.dataset;
      const entry = (data.logs[exid]||[]).find(e => e.date === date);
      if(!entry) return;
      const idx = entry.sets.findIndex(s => String(s.at) === at);
      if(idx < 0) return;
      const raw = inp.value.trim();
      const num = parseFloat(raw);
      if(raw === "" || isNaN(num)){
        entry.sets.splice(idx, 1);
        if(entry.sets.length === 0){
          data.logs[exid] = data.logs[exid].filter(e => e.date !== date);
        }
      } else {
        entry.sets[idx][field] = num;
      }
      await saveData();
      render();
    });
  });
  app.querySelectorAll('[data-action="sheet-hide-ex"]').forEach(b=>{
    b.addEventListener("click", async ()=>{
      if(!confirm("Diese Zeile nur aus Workoutz entfernen? Die Übung bleibt in deinem Trainingsplan und ihr Fortschritt bleibt erhalten — sie verschwindet nur aus dieser Tabelle.")) return;
      const ex = findExercise(b.dataset.exid);
      if(ex){ ex.hiddenFromSheet = true; await saveData(); render(); }
    });
  });
  app.querySelectorAll('[data-action="sheet-delete-date"]').forEach(b=>{
    b.addEventListener("click", async ()=>{
      const date = b.dataset.date;
      const plan = findPlan(currentSheetPlanId);
      if(!plan) return;
      if(!confirm(`Die Einheit vom ${fmtDate(date)} für ALLE Übungen von ${esc(plan.name)} löschen? Das kann nicht rückgängig gemacht werden.`)) return;
      plan.exercises.forEach(ex=>{
        if(data.logs[ex.id]) data.logs[ex.id] = data.logs[ex.id].filter(e => e.date !== date);
      });
      await saveData();
      render();
    });
  });

  /* Account view events */
  const sbSaveBtn = app.querySelector("#sb-save-config");
  if(sbSaveBtn) sbSaveBtn.addEventListener("click", ()=>{
    const u = app.querySelector("#sb-url-input").value.trim();
    const k = app.querySelector("#sb-anon-input").value.trim();
    if(!u || !k) return;
    saveSupabaseConfig(u, k);
    initSupabase();
    authMsg = null;
    render();
  });
  const sbClearBtn = app.querySelector("#sb-clear-config");
  if(sbClearBtn) sbClearBtn.addEventListener("click", async ()=>{
    if(!confirm("Cloud-Verbindung entfernen? Deine lokalen Daten bleiben erhalten.")) return;
    if(sb) await sb.auth.signOut().catch(()=>{});
    clearSupabaseConfig();
    sb = null; sbSession = null;
    render();
  });
  app.querySelectorAll('[data-authmode]').forEach(b=>{
    b.addEventListener("click", ()=>{ authMode = b.dataset.authmode; authMsg = null; render(); });
  });
  const authSubmit = app.querySelector("#auth-submit");
  if(authSubmit) authSubmit.addEventListener("click", async ()=>{
    const email = app.querySelector("#auth-email").value.trim();
    const password = app.querySelector("#auth-password").value;
    if(!email || !password){ authMsg = { type:"error", text:"Bitte E-Mail und Passwort eingeben." }; render(); return; }
    if(authMode === "signin") await signIn(email, password);
    else await signUp(email, password);
  });
  const acctSyncNow = app.querySelector("#acct-sync-now");
  if(acctSyncNow) acctSyncNow.addEventListener("click", ()=> pullFromCloudAndMerge());
  const acctSignout = app.querySelector("#acct-signout");
  if(acctSignout) acctSignout.addEventListener("click", ()=> signOut());

  const acctExport = app.querySelector("#acct-export");
  if(acctExport) acctExport.addEventListener("click", exportBackup);
  const acctImport = app.querySelector("#acct-import");
  const acctImportFile = app.querySelector("#acct-import-file");
  if(acctImport && acctImportFile){
    acctImport.addEventListener("click", ()=> acctImportFile.click());
    acctImportFile.addEventListener("change", ()=>{
      if(acctImportFile.files && acctImportFile.files[0]) importBackup(acctImportFile.files[0]);
    });
  }
}

loadData();

if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  });
}
