/* =====================================================================
   Stundenbuch – App-Logik
   Aufbau:
     1. Einstellungen & Hilfsfunktionen
     2. Daten bereinigen & Statistik berechnen
     3. Supabase: Anmeldung, Laden, Speichern, Live-Updates
     4. Darstellung der vier Bereiche
     5. Diagramme (SVG)
     6. Ereignisse (Klicks, Formulare)
     7. Start
   ===================================================================== */
(() => {
"use strict";

/* ---------- 1. Einstellungen & Hilfsfunktionen ---------- */
const DEFAULT_SUBJECTS = [
  { name: "Mechanik 1", goal: 300 },
  { name: "Elektrotechnik", goal: 300 },
  { name: "BWL", goal: 120 },
  { name: "QM/Messtechnik", goal: 180 },
];
const STREAK_MIN = 20;                     // Minuten, ab denen ein Tag für die Serie zählt
const MAX_SUBJECTS = 8;
const FOCUS_LABELS = ["", "abgelenkt", "zäh", "okay", "gut drin", "im Flow"];
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const RANKS = [[30, "Chefkonstrukteur"], [23, "Oberingenieur"], [17, "Senior-Ingenieur"], [12, "Ingenieur"], [8, "Junior-Ingenieur"], [5, "Werkstudent"], [3, "Tutor"], [1, "Erstsemester"]];
const TABS = ["heute", "statistik", "rangliste", "profil"];

const S = {
  sb: null, user: null, phase: "boot",     // boot | auth | setup | app
  authMode: "login",                       // login | signup | reset | recovery
  profiles: {}, sessions: [], groups: [], members: [],
  activeGroup: null, inviteCode: null,
  tab: "heute", selSubject: null, stopDraft: null, stopConfirm: false, addFocus: null,
  range: "7", lbPeriod: "week", lbMetric: "__all",
  editDraft: null, confirmDel: null, groupConfirm: null,
  subjDraft: null, nickDraft: "", deferred: false,
  pending: 0, reloadWanted: false, channel: null, loadedFor: null,
};

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const startOfDay = (d) => { d = new Date(d); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const addDays = (d, n) => { d = new Date(d); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); };
const dayKey = (d) => { d = new Date(d); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const weekStart = (d) => { const s = startOfDay(d); return addDays(s, -((s.getDay() + 6) % 7)); };
const isoWeek = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); };
const fmtDate = (d) => pad(d.getDate()) + "." + pad(d.getMonth() + 1) + ".";
const fmtDur = (min) => { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`; };
const fmtH = (min) => (min / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " h";
const fmt1 = (x) => x.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sv = (slot) => `var(--s${(((slot % 8) + 8) % 8) + 1})`;
const rankName = (lv) => (RANKS.find(([min]) => lv >= min) || RANKS[RANKS.length - 1])[1];
const lvStart = (L) => 30 * L * (L - 1);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const shortId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} },
};

/* ---------- 2. Daten bereinigen & Statistik ---------- */
function normProfile(row) {
  if (!row) return null;
  const subjects = (Array.isArray(row.subjects) ? row.subjects : []).filter((x) => x && typeof x === "object").slice(0, 24).map((x, i) => ({
    id: String(x.id || "s" + i).slice(0, 40),
    name: String(x.name || "Fach").slice(0, 40),
    slot: Number.isInteger(x.slot) ? ((x.slot % 8) + 8) % 8 : i % 8,
    goal: Math.max(0, Math.min(6000, Number(x.goal) || 0)),
    archived: !!x.archived,
  }));
  const tm = row.timer && typeof row.timer === "object" && isFinite(Number(row.timer.startedAt)) ? { s: String(row.timer.s || ""), startedAt: Number(row.timer.startedAt) } : null;
  return { id: row.id, nick: typeof row.nick === "string" ? row.nick.slice(0, 30) : "", subjects, timer: tm, created: Date.parse(row.created_at) || 0 };
}
function normSess(r) {
  const t = Date.parse(r.started_at), m = Number(r.minutes);
  if (!isFinite(t) || !(m > 0)) return null;
  const f = Number(r.focus);
  return { id: r.id, u: r.user_id, s: String(r.subject_id || ""), t, m: Math.min(m, 720), f: f >= 1 && f <= 5 ? f : null };
}
const me = () => S.profiles[S.user && S.user.id] || null;
const sessionsOf = (uid) => S.sessions.filter((x) => x.u === uid);
const active = (p) => p.subjects.filter((s) => !s.archived);
const subjMap = (p) => { const m = {}; if (p) p.subjects.forEach((s) => (m[s.id] = s)); return m; };
const timerLive = (p) => !!(p && p.timer && Date.now() - p.timer.startedAt < 12 * 3600e3);
function nameOf(uid) { const p = S.profiles[uid]; return (p && p.nick) || "Ohne Namen"; }

function statsFor(uid) {
  const p = S.profiles[uid];
  const sess = sessionsOf(uid);
  const byDay = new Map(); let total = 0;
  for (const x of sess) { const k = dayKey(x.t); byDay.set(k, (byDay.get(k) || 0) + x.m); total += x.m; }
  const todayMin = byDay.get(dayKey(new Date())) || 0;
  let cur = 0, d = startOfDay(new Date());
  if (todayMin < STREAK_MIN) d = addDays(d, -1);
  while ((byDay.get(dayKey(d)) || 0) >= STREAK_MIN) { cur++; d = addDays(d, -1); }
  let best = 0, run = 0, prev = null;
  [...byDay.keys()].filter((k) => byDay.get(k) >= STREAK_MIN).sort().forEach((k) => {
    run = prev && dayKey(addDays(prev, 1)) === k ? run + 1 : 1; best = Math.max(best, run); prev = new Date(k + "T00:00");
  });
  const goals = p ? active(p).filter((s) => s.goal > 0) : [];
  const ws = new Map();
  for (const x of sess) { const k = dayKey(weekStart(x.t)) + "|" + x.s; ws.set(k, (ws.get(k) || 0) + x.m); }
  let goalHits = 0; const perWeek = new Map();
  for (const [k, v] of ws) { const [w, s] = k.split("|"); const g = goals.find((z) => z.id === s); if (g && v >= g.goal) { goalHits++; perWeek.set(w, (perWeek.get(w) || 0) + 1); } }
  const allGoalWeek = goals.length > 1 && [...perWeek.values()].some((c) => c >= goals.length);
  const xp = Math.round(total) + 50 * goalHits;
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * xp) / 30)) / 2));
  return { p, sess, byDay, total, todayMin, cur, best, goalHits, allGoalWeek, xp, level };
}

const BADGES = [
  { name: "Erste Einheit", icon: "1", desc: "Deine erste Lerneinheit eingetragen.", test: (s) => s.sess.length > 0 },
  { name: "Drei am Stück", icon: "3T", desc: "3 Tage in Folge mindestens 20 Minuten gelernt.", test: (s) => s.best >= 3 },
  { name: "Wochenserie", icon: "7T", desc: "7 Tage in Folge mindestens 20 Minuten gelernt.", test: (s) => s.best >= 7 },
  { name: "Dauerläufer", icon: "30T", desc: "30 Tage in Folge mindestens 20 Minuten gelernt.", test: (s) => s.best >= 30 },
  { name: "10 Stunden", icon: "10h", desc: "Insgesamt 10 Stunden gelernt.", test: (s) => s.total >= 600 },
  { name: "50 Stunden", icon: "50h", desc: "Insgesamt 50 Stunden gelernt.", test: (s) => s.total >= 3000 },
  { name: "100 Stunden", icon: "100", desc: "Insgesamt 100 Stunden gelernt.", test: (s) => s.total >= 6000 },
  { name: "Ziel erreicht", icon: "✓", desc: "Ein Wochenziel in einem Fach geschafft.", test: (s) => s.goalHits > 0 },
  { name: "Volle Woche", icon: "✓✓", desc: "In einer Woche alle Wochenziele geschafft (ab 2 Fächern mit Ziel).", test: (s) => s.allGoalWeek },
  { name: "Deep Work", icon: "90", desc: "90 Minuten am Stück mit Fokus 4 oder 5.", test: (s) => s.sess.some((x) => x.m >= 90 && x.f >= 4) },
  { name: "Frühschicht", icon: "6", desc: "Eine Einheit zwischen 4 und 7 Uhr begonnen.", test: (s) => s.sess.some((x) => { const h = new Date(x.t).getHours(); return h >= 4 && h < 7; }) },
  { name: "Nachtschicht", icon: "22", desc: "Eine Einheit nach 22 Uhr begonnen.", test: (s) => s.sess.some((x) => new Date(x.t).getHours() >= 22) },
];

/* ---------- 3. Supabase ---------- */
function friendlyError(e) {
  const m = String((e && (e.message || e.error_description)) || e || "").toLowerCase();
  if (m.includes("invalid login")) return "E-Mail oder Passwort stimmt nicht.";
  if (m.includes("email not confirmed")) return "Bestätige zuerst deine E-Mail über den Link in deinem Postfach.";
  if (m.includes("already registered") || m.includes("already been registered") || m.includes("already exists")) return "Mit dieser E-Mail gibt es schon ein Konto. Melde dich an.";
  if (m.includes("password") && (m.includes("at least") || m.includes("weak") || m.includes("should be"))) return "Das Passwort ist zu schwach. Nimm mindestens 8 Zeichen.";
  if (m.includes("same") && m.includes("password")) return "Das neue Passwort muss sich vom alten unterscheiden.";
  if (m.includes("rate limit") || m.includes("too many") || (e && e.status === 429)) return "Zu viele Versuche. Warte ein paar Minuten und versuch es dann noch einmal.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "Neue Registrierungen sind gerade abgeschaltet.";
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("load failed")) return "Keine Verbindung zum Server. Prüfe dein Internet.";
  if (m.includes("keine gruppe")) return "Zu diesem Code gibt es keine Gruppe. Prüfe die Schreibweise.";
  if (m.includes("gruppe ist voll")) return "Diese Gruppe ist voll (50 Mitglieder).";
  if (m.includes("höchstens 10 gruppen")) return "Du kannst höchstens 10 Gruppen erstellen.";
  if (m.includes("row-level security") || (e && e.code === "42501")) return "Dafür fehlt dir die Berechtigung.";
  if (m.includes("jwt") && m.includes("expired")) return "Deine Anmeldung ist abgelaufen. Lade die Seite neu.";
  return "Das hat nicht geklappt" + (e && e.message ? ": " + e.message : ".");
}
function banner(text) { $("#bannerText").textContent = text; $("#banner").hidden = false; }

async function fetchAllSessions() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await S.sb.from("sessions").select("id,user_id,subject_id,started_at,minutes,focus").order("started_at", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
async function loadAll() {
  const [pr, gr, gm, ss] = await Promise.all([
    S.sb.from("profiles").select("id,nick,subjects,timer,created_at"),
    S.sb.from("groups").select("id,name,code,owner_id,created_at").order("created_at", { ascending: true }),
    S.sb.from("group_members").select("group_id,user_id,joined_at"),
    fetchAllSessions(),
  ]);
  for (const r of [pr, gr, gm]) if (r.error) throw r.error;
  const profiles = {}; pr.data.forEach((row) => { const p = normProfile(row); if (p) profiles[p.id] = p; });
  // Eigenes Profil nicht durch einen älteren Stand überschreiben, solange gerade gespeichert wird
  if (S.pending > 0 && me()) profiles[S.user.id] = me();
  S.profiles = profiles;
  S.groups = gr.data || [];
  S.members = gm.data || [];
  S.sessions = ss.map(normSess).filter(Boolean).sort((a, b) => a.t - b.t);
  const saved = store.get("stundenbuch-gruppe");
  if (!S.groups.find((g) => g.id === S.activeGroup)) S.activeGroup = S.groups.find((g) => g.id === saved) ? saved : (S.groups[0] ? S.groups[0].id : null);
}
let reloadTimer = null;
function scheduleReload(delay = 600) {
  if (!S.user) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    if (S.pending > 0) { S.reloadWanted = true; return; }
    try { await loadAll(); render(); } catch (_) {}
  }, delay);
}
function subscribeLive() {
  if (S.channel) return;
  const on = () => scheduleReload();
  S.channel = S.sb.channel("stundenbuch-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, on)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, on)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_members" }, on)
    .subscribe();
}
function unsubscribeLive() { if (S.channel) { S.sb.removeChannel(S.channel); S.channel = null; } }

// Jede Änderung läuft hierüber: Fehler anzeigen, danach frisch laden.
async function dbWrite(fn) {
  S.pending++;
  try { const r = await fn(); if (r && r.error) throw r.error; return r || true; }
  catch (e) { banner(friendlyError(e)); S.reloadWanted = true; return null; }
  finally {
    S.pending--;
    if (S.pending === 0 && S.reloadWanted) { S.reloadWanted = false; scheduleReload(50); }
  }
}
function profileRow(p) {
  return { id: p.id, nick: p.nick, subjects: p.subjects, timer: p.timer, updated_at: new Date().toISOString() };
}
function saveMyProfile() { const p = me(); return dbWrite(() => S.sb.from("profiles").upsert(profileRow(p))); }
function setMyProfile(patch) { S.profiles[S.user.id] = { ...me(), ...patch }; render(); return saveMyProfile(); }
function addSession(x) {
  const row = { id: uuid(), user_id: S.user.id, subject_id: x.s, started_at: new Date(x.t).toISOString(), minutes: x.m, focus: x.f || null };
  S.sessions.push(normSess(row)); S.sessions.sort((a, b) => a.t - b.t); render();
  return dbWrite(() => S.sb.from("sessions").insert(row));
}
function updateSession(id, patch) {
  const x = S.sessions.find((z) => z.id === id); if (!x) return;
  Object.assign(x, { s: patch.subject_id, m: patch.minutes, f: patch.focus }); render();
  return dbWrite(() => S.sb.from("sessions").update(patch).eq("id", id));
}
function deleteSession(id) {
  S.sessions = S.sessions.filter((z) => z.id !== id); render();
  return dbWrite(() => S.sb.from("sessions").delete().eq("id", id));
}

async function handleSession(session) {
  if (!session) {
    S.user = null; S.loadedFor = null; S.profiles = {}; S.sessions = []; S.groups = []; S.members = [];
    unsubscribeLive();
    if (S.authMode === "recovery") S.authMode = "login";
    S.phase = "auth"; render(); return;
  }
  S.user = session.user;
  if (S.authMode === "recovery") { S.phase = "auth"; render(); return; }
  if (S.loadedFor === session.user.id) return;
  S.loadedFor = session.user.id;
  S.phase = "boot"; $("#bootMsg").textContent = "Lade deine Daten …"; render();
  try { await loadAll(); }
  catch (e) { S.loadedFor = null; $("#bootMsg").textContent = friendlyError(e) + " Lade die Seite neu."; return; }
  subscribeLive();
  S.subjDraft = null;
  S.phase = me() ? "app" : "setup";
  if (S.phase === "setup") S.tab = "profil";
  render();
}

/* ---------- 4. Darstellung ---------- */
let raf = false;
function render() { if (raf) return; raf = true; requestAnimationFrame(() => { raf = false; doRender(); }); }
function setHTML(el, html) {
  const a = document.activeElement;
  if (a && el.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) { S.deferred = true; return; }
  el.innerHTML = html;
}
document.addEventListener("focusout", () => { if (S.deferred) { S.deferred = false; setTimeout(render, 0); } });
function showView(name) { for (const v of ["boot", "auth", ...TABS]) $("#view-" + v).hidden = v !== name; }

function doRender() {
  renderTags();
  if (S.phase === "boot") { $("#tabs").hidden = true; showView("boot"); return; }
  if (S.phase === "auth") { $("#tabs").hidden = true; showView("auth"); renderAuth(); return; }
  if (S.phase === "setup") {
    $("#tabs").hidden = true; $("#setupIntro").hidden = false; $("#saveProfile").textContent = "Los geht's"; $("#accountArea").hidden = true;
    showView("profil"); renderProfile(); return;
  }
  $("#setupIntro").hidden = true; $("#saveProfile").textContent = "Speichern"; $("#accountArea").hidden = false;
  $("#tabs").hidden = false;
  document.querySelectorAll("#tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
  $("#liveDot").hidden = !timerLive(me());
  showView(S.tab);
  if (S.tab === "heute") renderHeute();
  else if (S.tab === "statistik") renderStats();
  else if (S.tab === "rangliste") renderRangliste();
  else renderProfile();
}

function renderTags() {
  const now = new Date();
  let h = `<span class="tag c1"><small>KW</small>${pad(isoWeek(now))}</span>`;
  if (S.phase === "app" && me()) {
    const st = statsFor(S.user.id);
    h += `<span class="tag c2"><small>Level</small>${st.level}</span><span class="tag c3"><small>Serie</small>${st.cur} ${st.cur === 1 ? "Tag" : "Tage"}</span>`;
  }
  $("#tags").innerHTML = h;
}

/* --- Anmeldung --- */
function renderAuth() {
  const m = S.authMode;
  $("#authSwitch").hidden = m === "reset" || m === "recovery";
  document.querySelectorAll("#authSwitch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
  $("#authTitle").textContent = { login: "Anmelden", signup: "Konto erstellen", reset: "Passwort zurücksetzen", recovery: "Neues Passwort festlegen" }[m];
  $("#authSubmit").textContent = { login: "Anmelden", signup: "Registrieren", reset: "Link senden", recovery: "Passwort speichern" }[m];
  $("#fEmail").hidden = m === "recovery";
  $("#fPass").hidden = m === "reset";
  $("#fPass2").hidden = !(m === "signup" || m === "recovery");
  $("#authPass").setAttribute("autocomplete", m === "login" ? "current-password" : "new-password");
  $("#forgotBtn").hidden = m !== "login";
  $("#backToLogin").hidden = m !== "reset";
  const info = $("#authInfo");
  info.hidden = !(m === "reset" || m === "signup" || m === "recovery");
  info.textContent = m === "reset" ? "Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst." : m === "signup" ? "Mindestens 8 Zeichen. Deine Lerndaten sehen nur Leute, mit denen du in einer Gruppe bist." : "Wähle ein neues Passwort mit mindestens 8 Zeichen.";
}

/* --- Heute --- */
function renderHeute() {
  const p = me(); const subs = active(p); const smap = subjMap(p);
  if (!S.selSubject || !subs.find((s) => s.id === S.selSubject)) S.selSubject = subs[0] ? subs[0].id : null;
  const running = p.timer; const rating = !!S.stopDraft;
  const tEl = $("#timer");
  tEl.classList.toggle("running", !!running && !rating);
  tEl.classList.toggle("rating", rating);
  $("#timerState").textContent = rating ? "Bewerten" : running ? "Läuft" : "Bereit";

  setHTML($("#chips"), subs.length ? subs.map((s) => {
    const on = running ? running.s === s.id : S.selSubject === s.id;
    return `<button type="button" class="chip" data-subj="${esc(s.id)}" aria-pressed="${on}" ${running ? "disabled" : ""}><i class="sw" style="background:${sv(s.slot)}"></i>${esc(s.name)}</button>`;
  }).join("") : `<span>Noch keine Fächer. Leg unter „Profil“ welche an.</span>`);

  let acts = "";
  if (rating) acts = "";
  else if (running && S.stopConfirm) acts = `<div class="confirm">Timer ohne Speichern abbrechen? <button type="button" class="btn sm" id="cancelYes">Ja, abbrechen</button><button type="button" class="btn sm" id="cancelNo">Nein</button></div>`;
  else if (running) acts = `<button type="button" class="btn big stop" id="btnStop">Stopp</button><button type="button" class="btn sm" id="btnCancel">Abbrechen</button>`;
  else acts = `<button type="button" class="btn big go" id="btnStart" ${S.selSubject ? "" : "disabled"}>Start</button>`;
  $("#timerActions").innerHTML = acts;

  if (running) {
    const t0 = new Date(running.startedAt); const sub = smap[running.s];
    $("#timerSince").textContent = "seit " + pad(t0.getHours()) + ":" + pad(t0.getMinutes()) + (dayKey(t0) !== dayKey(new Date()) ? " am " + fmtDate(t0) : "");
    $("#timerMeta").textContent = rating ? "Gestoppt. Wie lief es?" : (sub ? sub.name : "Fach") + " läuft. Du kannst die Seite schließen oder das Gerät wechseln.";
  } else { $("#timerSince").textContent = ""; $("#timerMeta").textContent = "Fach antippen, Start drücken, lernen."; }
  tickReadout();

  // Nachtragen
  const sel = $("#addSubj"); const sig = subs.map((s) => s.id + ":" + s.name).join("|");
  if (sel.dataset.sig !== sig) {
    const keep = sel.value;
    sel.innerHTML = subs.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
    if (subs.find((s) => s.id === keep)) sel.value = keep;
    sel.dataset.sig = sig;
  }
  $("#addSubmit").disabled = !subs.length;

  const st = statsFor(S.user.id);
  const today = dayKey(new Date());
  const ts = st.sess.filter((x) => dayKey(x.t) === today).reverse();
  $("#todayTotal").textContent = ts.length ? fmtDur(st.todayMin) + " · " + ts.length + (ts.length === 1 ? " Einheit" : " Einheiten") : "";
  setHTML($("#todayList"), ts.length ? ts.map((x) => sessRow(x, smap, false)).join("") : `<p class="empty">Heute noch nichts eingetragen.</p>`);

  // Level
  const L = st.level, a = lvStart(L), b = lvStart(L + 1), pct = Math.round(((st.xp - a) / (b - a)) * 100);
  const left = Math.max(0, STREAK_MIN - st.todayMin);
  $("#levelCard").innerHTML = `
    <div class="lvl">
      <div class="lvl-num" aria-hidden="true">${L}</div>
      <div class="stack" style="gap:8px">
        <div><div class="lvl-title">Level ${L} · ${rankName(L)}</div><div class="small mono muted">${st.xp.toLocaleString("de-DE")} XP · noch ${(b - st.xp).toLocaleString("de-DE")} bis Level ${L + 1}</div></div>
        <div class="meter" role="progressbar" aria-label="Fortschritt zum nächsten Level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      </div>
    </div>
    <div class="stat3">
      <div class="mini"><div class="v">${st.cur}</div><div class="k">Serie (Tage)</div></div>
      <div class="mini"><div class="v">${st.best}</div><div class="k">Rekord</div></div>
      <div class="mini"><div class="v">${fmtH(st.total)}</div><div class="k">Gesamt</div></div>
    </div>
    <div class="streak-note ${left ? "" : "ok"}">${left ? `Noch ${left} min, dann zählt heute für deine Serie.` : "Heute zählt für deine Serie. ✓"}</div>`;

  // Wochenziele
  const ws = weekStart(new Date()), we = addDays(ws, 7);
  $("#goalWeek").textContent = "KW " + pad(isoWeek(ws)) + " · " + fmtDate(ws) + "–" + fmtDate(addDays(ws, 6));
  const wk = {}; st.sess.forEach((x) => { if (x.t >= ws.getTime() && x.t < we.getTime()) wk[x.s] = (wk[x.s] || 0) + x.m; });
  const daysLeft = 7 - ((new Date().getDay() + 6) % 7);
  setHTML($("#goals"), subs.length ? subs.map((s) => {
    const v = wk[s.id] || 0;
    if (!s.goal) return `<div class="goal"><div class="nm"><i class="sw" style="background:${sv(s.slot)}"></i><span>${esc(s.name)}</span></div><div class="num">${fmtH(v)} · kein Ziel</div></div>`;
    const pc = Math.min(100, (v / s.goal) * 100), done = v >= s.goal;
    return `<div class="goal">
      <div class="nm"><i class="sw" style="background:${sv(s.slot)}"></i><span>${esc(s.name)}</span>${done ? '<span class="pill">geschafft</span>' : ""}</div>
      <div class="num">${fmtH(v)} / ${fmtH(s.goal)}</div>
      <div class="bar" role="progressbar" aria-label="${esc(s.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pc)}"><i class="${pc > 0 && pc < 100 ? "has" : ""}" style="width:${pc}%;background:${sv(s.slot)}"></i></div>
      ${done ? "" : `<div class="hint">noch ${fmtDur(s.goal - v)}, etwa ${fmtDur(Math.ceil((s.goal - v) / daysLeft))} pro Tag bis Sonntag</div>`}
    </div>`;
  }).join("") : `<p class="empty">Keine Fächer angelegt.</p>`);

  // Abzeichen
  const earned = BADGES.map((bd) => ({ ...bd, ok: !!bd.test(st) }));
  $("#badgeCount").textContent = earned.filter((x) => x.ok).length + " von " + earned.length;
  clearTips("bd");
  $("#badges").innerHTML = earned.map((bd) => `<div class="badge ${bd.ok ? "" : "locked"}" tabindex="0" data-tip="${tipKey("bd", `<b>${esc(bd.name)}</b><div>${esc(bd.desc)}</div><div class="mono small">${bd.ok ? "freigeschaltet" : "noch offen"}</div>`)}"><div class="disc">${esc(bd.icon)}</div><span class="bn">${esc(bd.name)}</span></div>`).join("");
}

function renderFocusPicker(el, value) {
  el.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-f="${n}" aria-pressed="${value === n}"><b>${n}</b><span>${FOCUS_LABELS[n]}</span></button>`).join("");
}
function renderStopForm() {
  const f = $("#stopForm");
  if (!S.stopDraft) { f.hidden = true; f.innerHTML = ""; return; }
  const d = S.stopDraft; f.hidden = false;
  f.innerHTML = `
    <div class="q">Wie fokussiert warst du?</div>
    <div class="focus5" id="stopFocus" role="group" aria-label="Fokus"></div>
    <label class="quick small" style="font-weight:700">Dauer <input class="inp" type="number" id="stopMin" min="1" max="720" value="${d.m}"> Minuten</label>
    ${d.m > 360 ? `<p class="small" style="font-weight:700">Der Timer lief über 6 Stunden. Stimmt die Dauer? Du kannst sie oben korrigieren.</p>` : ""}
    <div class="row-btns" id="stopBtns">
      <button type="button" class="btn big save" id="stopSave">Speichern</button>
      <button type="button" class="btn sm" id="stopDiscard">Verwerfen</button>
    </div>`;
  renderFocusPicker($("#stopFocus"), d.f);
}
function tickReadout() {
  const p = me(); const el = $("#readout");
  if (!p || !p.timer) { el.textContent = "00:00:00"; return; }
  const end = S.stopDraft ? S.stopDraft.endAt : Date.now();
  const sec = Math.max(0, Math.floor((end - p.timer.startedAt) / 1000));
  el.textContent = pad(Math.floor(sec / 3600)) + ":" + pad(Math.floor((sec % 3600) / 60)) + ":" + pad(sec % 60);
}
function dots(f) {
  if (!f) return "";
  let h = `<span class="dots" title="Fokus ${f} von 5">`;
  for (let i = 1; i <= 5; i++) h += `<i class="${i <= f ? "on" : ""}"></i>`;
  return h + "</span>";
}
function sessRow(x, smap, editable) {
  const s = smap[x.s]; const d = new Date(x.t);
  const name = s ? s.name + (s.archived ? " (archiviert)" : "") : "Gelöschtes Fach";
  const color = s ? sv(s.slot) : "var(--heat0)";
  const when = WD[d.getDay()] + " " + fmtDate(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  const editing = editable && S.editDraft && S.editDraft.id === x.id;
  let act = "";
  if (editing) {
    const ed = S.editDraft; const p = me();
    const opts = active(p).concat(p.subjects.filter((z) => z.archived && z.id === x.s)).map((z) => `<option value="${esc(z.id)}" ${z.id === ed.s ? "selected" : ""}>${esc(z.name)}</option>`).join("");
    act = `<div class="act">
      <select class="inp" id="ed-s" style="width:auto;max-width:12rem" aria-label="Fach">${opts}</select>
      <input class="inp" id="ed-m" type="number" min="1" max="720" value="${esc(ed.m)}" style="width:6em" aria-label="Minuten"><span class="small">min</span>
      <select class="inp" id="ed-f" style="width:auto" aria-label="Fokus"><option value="">Fokus –</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${ed.f === n ? "selected" : ""}>Fokus ${n}</option>`).join("")}</select>
      <button type="button" class="btn sm c" data-ed-save="${esc(x.id)}">Speichern</button>
      <button type="button" class="btn sm" data-ed-cancel>Abbrechen</button>
      ${S.confirmDel === x.id ? `<span class="confirm">Wirklich löschen? <button type="button" class="btn sm danger" data-del-yes="${esc(x.id)}">Ja</button><button type="button" class="btn sm" data-del-no>Nein</button></span>` : `<button type="button" class="btn sm danger" data-del="${esc(x.id)}">Löschen</button>`}
    </div>`;
  }
  return `<div class="row">
    <span class="when">${when}</span>
    <span class="what"><i class="sw" style="background:${color}"></i><span>${esc(name)}</span>${dots(x.f)}</span>
    <span class="dur">${fmtDur(x.m)}${editable && !editing ? ` <button type="button" class="linkbtn small" data-edit="${esc(x.id)}">ändern</button>` : ""}</span>
    ${act}
  </div>`;
}

/* --- Statistik --- */
function rangeInfo() {
  const today = startOfDay(new Date());
  if (S.range === "12w") {
    const end = addDays(weekStart(today), 7), start = addDays(end, -84);
    return { start, end, prevStart: addDays(start, -84), weekly: true, days: Math.round((addDays(today, 1) - start) / 864e5), last: today };
  }
  const n = S.range === "30" ? 30 : 7;
  const end = addDays(today, 1), start = addDays(end, -n);
  return { start, end, prevStart: addDays(start, -n), weekly: false, days: n, last: today };
}
function renderStats() {
  const p = me(); const smap = subjMap(p); const all = sessionsOf(S.user.id); const R = rangeInfo();
  document.querySelectorAll("#rangeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === S.range)));
  $("#rangeLabel").textContent = fmtDate(R.start) + "–" + fmtDate(R.last);
  const inR = all.filter((x) => x.t >= R.start.getTime() && x.t < R.end.getTime());
  const inP = all.filter((x) => x.t >= R.prevStart.getTime() && x.t < R.start.getTime());
  const tot = inR.reduce((a, x) => a + x.m, 0), ptot = inP.reduce((a, x) => a + x.m, 0);
  const fx = inR.filter((x) => x.f), fm = fx.reduce((a, x) => a + x.m, 0);
  const avgF = fm ? fx.reduce((a, x) => a + x.f * x.m, 0) / fm : null;
  const days = new Set(inR.map((x) => dayKey(x.t))).size;
  const diff = tot - ptot;
  $("#kpis").innerHTML = `
    <div class="kpi"><div class="k">Lernzeit</div><div class="v">${fmtH(tot)}</div><div class="d">${tot || ptot ? (diff >= 0 ? "+" : "−") + fmtH(Math.abs(diff)) + " zum Zeitraum davor" : "noch keine Daten"}</div></div>
    <div class="kpi"><div class="k">Ø pro Tag</div><div class="v">${fmtDur(tot / Math.max(1, R.days))}</div><div class="d">an ${days} von ${R.days} Tagen gelernt</div></div>
    <div class="kpi"><div class="k">Einheiten</div><div class="v">${inR.length}</div><div class="d">${inR.length ? "Ø " + fmtDur(tot / inR.length) + " pro Einheit" : "–"}</div></div>
    <div class="kpi"><div class="k">Ø Fokus</div><div class="v">${avgF ? fmt1(avgF) : "–"}<span class="small"> / 5</span></div><div class="d">nach Lernzeit gewichtet</div></div>`;

  const used = new Set(inR.map((x) => x.s));
  const series = p.subjects.filter((s) => !s.archived || used.has(s.id)).map((s) => ({ id: s.id, name: s.name, color: sv(s.slot) }));
  if (inR.some((x) => !smap[x.s])) series.push({ id: "__x", name: "Gelöschtes Fach", color: "var(--heat0)" });
  const sid = (x) => (smap[x.s] ? x.s : "__x");

  const buckets = [];
  if (R.weekly) for (let i = 0; i < 12; i++) { const a = addDays(R.start, i * 7); buckets.push({ a, b: addDays(a, 7), label: "KW" + pad(isoWeek(a)), full: "KW " + pad(isoWeek(a)) + " · " + fmtDate(a) + "–" + fmtDate(addDays(a, 6)) }); }
  else for (let i = 0; i < R.days; i++) { const a = addDays(R.start, i); buckets.push({ a, b: addDays(a, 1), label: R.days <= 7 ? WD[a.getDay()] : String(a.getDate()), full: WD[a.getDay()] + " " + fmtDate(a) }); }
  buckets.forEach((bk) => { bk.parts = {}; bk.total = 0; inR.forEach((x) => { if (x.t >= bk.a.getTime() && x.t < bk.b.getTime()) { const k = sid(x); bk.parts[k] = (bk.parts[k] || 0) + x.m; bk.total += x.m; } }); });
  $("#barTitle").textContent = R.weekly ? "Lernzeit pro Woche" : "Lernzeit pro Tag";
  $("#barLegend").innerHTML = series.length > 1 ? series.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span>`).join("") : "";
  clearTips("bc");
  const every = buckets.length > 14 ? 5 : 1;
  $("#barChart").innerHTML = barSVG($("#barChart"), buckets.map((bk, i) => ({
    label: i % every === 0 || i === buckets.length - 1 ? bk.label : "",
    segs: series.filter((s) => bk.parts[s.id] > 0).map((s) => ({ v: bk.parts[s.id], color: s.color })),
    highlight: !R.weekly && dayKey(bk.a) === dayKey(new Date()),
    tip: tipKey("bc", `<b>${esc(bk.full)}</b>` + (bk.total ? series.filter((s) => bk.parts[s.id] > 0).map((s) => `<div class="tr"><span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span><span class="mono">${fmtDur(bk.parts[s.id])}</span></div>`).join("") + `<div class="tr"><span><b>Gesamt</b></span><span class="mono">${fmtDur(bk.total)}</span></div>` : "<div>nichts gelernt</div>")),
  })), { height: 240, label: "Lernzeit pro " + (R.weekly ? "Woche" : "Tag") + " nach Fach" });

  const bySub = {}, fBy = {};
  inR.forEach((x) => { const k = sid(x); bySub[k] = (bySub[k] || 0) + x.m; if (x.f) { const o = fBy[k] || (fBy[k] = { w: 0, m: 0 }); o.w += x.f * x.m; o.m += x.m; } });
  const maxS = Math.max(1, ...Object.values(bySub));
  setHTML($("#bySubject"), tot ? series.map((s) => ({ ...s, v: bySub[s.id] || 0 })).sort((a, b) => b.v - a.v).map((s) => {
    const f = fBy[s.id]; const n = inR.filter((x) => sid(x) === s.id).length; const w = (s.v / maxS) * 100;
    return `<div class="srow"><div class="nm"><i class="sw" style="background:${s.color}"></i><span>${esc(s.name)}</span></div><div class="track"><i class="${w > 0 && w < 100 ? "has" : ""}" style="width:${w}%;background:${s.color}"></i></div><div class="val">${fmtH(s.v)} · ${Math.round((s.v / tot) * 100)} %</div><div class="meta">${n} ${n === 1 ? "Einheit" : "Einheiten"}${f ? " · Ø Fokus " + fmt1(f.w / f.m) : ""}</div></div>`;
  }).join("") : `<p class="empty">In diesem Zeitraum gibt es noch keine Einheiten.</p>`);

  const HB = [[0, 6, "0–6"], [6, 8, "6"], [8, 10, "8"], [10, 12, "10"], [12, 14, "12"], [14, 16, "14"], [16, 18, "16"], [18, 20, "18"], [20, 22, "20"], [22, 24, "22"]];
  const hb = HB.map(([a, b, l]) => { const xs = inR.filter((x) => { const h = new Date(x.t).getHours(); return h >= a && h < b; }); const m = xs.reduce((s, x) => s + x.m, 0); const fz = xs.filter((x) => x.f); const fzm = fz.reduce((s, x) => s + x.m, 0); return { a, b, l, m, f: fzm ? fz.reduce((s, x) => s + x.f * x.m, 0) / fzm : null }; });
  clearTips("hc");
  $("#hourChart").innerHTML = barSVG($("#hourChart"), hb.map((h) => ({
    label: h.l, segs: h.m ? [{ v: h.m, color: "var(--s7)" }] : [], top: h.f ? fmt1(h.f) : "",
    tip: tipKey("hc", `<b>${pad(h.a)}–${pad(h.b)} Uhr</b><div class="tr"><span>Lernzeit</span><span class="mono">${fmtDur(h.m)}</span></div><div class="tr"><span>Ø Fokus</span><span class="mono">${h.f ? fmt1(h.f) : "–"}</span></div>`),
  })), { height: 210, label: "Lernzeit nach Tageszeit" });

  renderHeatmap(all);

  const hist = inR.slice().reverse();
  $("#histCount").textContent = hist.length ? hist.length + (hist.length === 1 ? " Einheit" : " Einheiten") : "";
  setHTML($("#history"), hist.length ? hist.slice(0, 60).map((x) => sessRow(x, smap, true)).join("") + (hist.length > 60 ? `<p class="small muted" style="padding-top:8px">Die neuesten 60 Einheiten werden angezeigt.</p>` : "") : `<p class="empty">Keine Einheiten in diesem Zeitraum.</p>`);
}

/* --- Rangliste & Gruppen --- */
function groupUserIds(gid) { return S.members.filter((m) => m.group_id === gid).map((m) => m.user_id); }
function inviteLink(code) { return location.origin + location.pathname + "?gruppe=" + encodeURIComponent(code); }
function renderRangliste() {
  // Einladung aus einem Link
  const inv = $("#inviteCard");
  if (S.inviteCode && !S.groups.find((g) => g.code === S.inviteCode)) {
    inv.hidden = false;
    inv.innerHTML = `<h2>Einladung</h2><p>Du wurdest in eine Lerngruppe eingeladen. Code: <span class="code">${esc(S.inviteCode)}</span></p><div class="row-btns"><button type="button" class="btn c" id="inviteJoin">Beitreten</button><button type="button" class="btn sm" id="inviteIgnore">Nicht jetzt</button><span class="msg" id="inviteMsg"></span></div>`;
  } else inv.hidden = true;

  const area = $("#groupArea");
  if (!S.groups.length) {
    setHTML(area, `<div class="card"><h2>Noch keine Gruppe</h2><p>Erstelle unten eine Gruppe und schick deinen Freunden den Einladungslink. Oder tritt mit einem Code bei, den du bekommen hast.</p></div>`);
    return;
  }
  const g = S.groups.find((x) => x.id === S.activeGroup) || S.groups[0];
  const ids = groupUserIds(g.id).filter((id) => S.profiles[id]);
  const order = ids.slice().sort((a, b) => (S.profiles[a].created - S.profiles[b].created) || (a < b ? -1 : 1));
  const slotOf = {}; order.forEach((id, i) => (slotOf[id] = i % 8));

  const names = new Map();
  order.forEach((id) => active(S.profiles[id]).forEach((s) => { const k = s.name.trim().toLowerCase(); if (!names.has(k)) names.set(k, s.name.trim()); }));
  if (S.lbMetric !== "__all" && !names.has(S.lbMetric)) S.lbMetric = "__all";
  const pStart = S.lbPeriod === "week" ? weekStart(new Date()).getTime() : S.lbPeriod === "month" ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() : 0;
  const match = (id) => { const sm = subjMap(S.profiles[id]); return (x) => S.lbMetric === "__all" || (sm[x.s] && sm[x.s].name.trim().toLowerCase() === S.lbMetric); };

  const rows = order.map((id) => {
    const st = statsFor(id); const mf = match(id); const pr = S.profiles[id];
    return { id, st, v: st.sess.filter((x) => x.t >= pStart && mf(x)).reduce((a, x) => a + x.m, 0), live: timerLive(pr) ? subjMap(pr)[pr.timer.s] || { name: "" } : null };
  }).sort((a, b) => b.v - a.v);
  const max = Math.max(1, ...rows.map((r) => r.v));

  const ws = weekStart(new Date()); const todayIdx = (new Date().getDay() + 6) % 7;
  const race = order.slice(0, 8).map((id) => {
    const mf = match(id); const sess = sessionsOf(id); const cum = []; let acc = 0;
    for (let d = 0; d < 7; d++) { const a = addDays(ws, d).getTime(), b = addDays(ws, d + 1).getTime(); acc += sess.filter((x) => x.t >= a && x.t < b && mf(x)).reduce((s, x) => s + x.m, 0); cum.push(acc); }
    return { id, name: nameOf(id), color: sv(slotOf[id]), cum };
  });

  const isOwner = g.owner_id === S.user.id;
  const groupBtns = S.groups.length > 1 ? `<div class="seg" role="group" aria-label="Gruppe wählen">${S.groups.map((x) => `<button type="button" data-group="${esc(x.id)}" aria-pressed="${x.id === g.id}">${esc(x.name)}</button>`).join("")}</div>` : "";
  const confirm = S.groupConfirm === "leave" ? `<span class="confirm">Gruppe wirklich verlassen? <button type="button" class="btn sm danger" id="leaveYes">Ja</button><button type="button" class="btn sm" id="gcNo">Nein</button></span>`
    : S.groupConfirm === "dissolve" ? `<span class="confirm">Gruppe für alle auflösen? <button type="button" class="btn sm danger" id="dissolveYes">Ja, auflösen</button><button type="button" class="btn sm" id="gcNo">Nein</button></span>`
    : `<button type="button" class="btn sm" id="leaveBtn">Verlassen</button>${isOwner ? `<button type="button" class="btn sm danger" id="dissolveBtn">Auflösen</button>` : ""}`;

  clearTips("rc");
  const html = `
    ${groupBtns}
    <div class="card">
      <div class="group-head">
        <h2>${esc(g.name)} <span class="aside">${ids.length} ${ids.length === 1 ? "Mitglied" : "Mitglieder"}</span></h2>
        <div class="row-btns">${confirm}</div>
      </div>
      <div class="invite-box">
        <div class="row-btns"><span class="lbl">Einladungscode</span><span class="code">${esc(g.code)}</span></div>
        <div class="row-btns"><button type="button" class="btn sm y" data-copy="${esc(inviteLink(g.code))}">Einladungslink kopieren</button><span class="small muted" style="word-break:break-all">${esc(inviteLink(g.code))}</span></div>
        <span class="msg small" id="copyMsg"></span>
      </div>
      <div class="toolbar" style="margin:0">
        <div class="seg" role="group" aria-label="Zeitraum">
          ${[["week", "Diese Woche"], ["month", "Dieser Monat"], ["all", "Gesamt"]].map(([k, l]) => `<button type="button" data-p="${k}" aria-pressed="${S.lbPeriod === k}">${l}</button>`).join("")}
        </div>
        <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>Fach</span>
          <select class="inp" id="lbMetric" style="width:auto;min-width:11rem"><option value="__all">Alle Fächer</option>${[...names].map(([k, v]) => `<option value="${esc(k)}" ${S.lbMetric === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
        </label>
      </div>
      <div class="board">${rows.map((r, i) => `
        <div class="brow ${r.id === S.user.id ? "me" : ""} ${r.v > 0 && i < 3 ? "p" + (i + 1) : ""}">
          <div class="rk">${i + 1}</div>
          <div class="who"><span class="n">${esc(nameOf(r.id))}</span><span class="m"><span>Level ${r.st.level}</span><span>Serie ${r.st.cur} ${r.st.cur === 1 ? "Tag" : "Tage"}</span>${r.live ? `<span class="live">● lernt gerade ${esc(r.live.name)}</span>` : ""}</span></div>
          <div class="tot">${fmtH(r.v)}</div>
          <div class="bar"><i style="width:${(r.v / max) * 100}%;background:${sv(slotOf[r.id])}"></i></div>
        </div>`).join("")}
        ${ids.length < 2 ? `<p class="empty">Noch bist du allein in dieser Gruppe. Schick deinen Freunden den Einladungslink.</p>` : ""}
      </div>
    </div>
    <div class="card">
      <h2>Wochenrennen <span class="aside">aufsummierte Lernzeit seit Montag</span></h2>
      <div class="legend">${race.length > 1 ? race.map((r) => `<span><i class="sw" style="background:${r.color}"></i>${esc(r.name)}${r.id === S.user.id ? " (du)" : ""}</span>`).join("") : ""}</div>
      <div class="chart" id="raceChart"></div>
    </div>`;
  setHTML(area, html);
  const rc = $("#raceChart"); if (rc) rc.innerHTML = raceSVG(rc, race, todayIdx, ws);
}

/* --- Profil --- */
function ensureDraft() {
  if (S.subjDraft) return;
  const p = me();
  if (p) { S.subjDraft = active(p).map((s) => ({ ...s, goalH: s.goal / 60 })); S.nickDraft = p.nick; }
  else { S.subjDraft = DEFAULT_SUBJECTS.map((s, i) => ({ id: "", name: s.name, slot: i, goal: s.goal, goalH: s.goal / 60 })); S.nickDraft = ""; }
}
function renderProfile() {
  ensureDraft();
  const nick = $("#nickInput"); if (document.activeElement !== nick) nick.value = S.nickDraft || "";
  setHTML($("#subjEditor"), S.subjDraft.length ? S.subjDraft.map((s, i) => `
    <div class="se-row">
      <i class="sw" style="background:${sv(s.slot)}"></i>
      <label class="field"><span>Fach</span><input id="se-name-${i}" data-i="${i}" data-k="name" maxlength="40" value="${esc(s.name)}"></label>
      <label class="field"><span>Ziel h/Woche</span><input id="se-goal-${i}" data-i="${i}" data-k="goalH" type="number" min="0" max="100" step="0.5" value="${esc(s.goalH)}"></label>
      <button type="button" class="btn sm rm" data-rm="${i}">Entfernen</button>
    </div>`).join("") : `<p class="empty">Noch keine Fächer. Füge mindestens eins hinzu.</p>`);
  $("#addSubjBtn").disabled = S.subjDraft.length >= MAX_SUBJECTS;
  if (S.user) $("#accEmail").textContent = S.user.email || "";
}
async function saveProfileForm() {
  ensureDraft();
  const msg = $("#saveMsg"); msg.className = "msg";
  const nick = String(S.nickDraft || "").trim().slice(0, 30);
  if (!nick) { msg.textContent = "Gib einen Spitznamen ein."; msg.classList.add("err"); return; }
  const draft = S.subjDraft.map((s) => ({ ...s, name: String(s.name || "").trim() })).filter((s) => s.name);
  if (!draft.length) { msg.textContent = "Leg mindestens ein Fach an."; msg.classList.add("err"); return; }
  const lower = draft.map((s) => s.name.toLowerCase());
  if (new Set(lower).size !== lower.length) { msg.textContent = "Zwei Fächer heißen gleich. Benenne eins um."; msg.classList.add("err"); return; }
  const prev = me();
  const used = new Set(draft.filter((s) => s.id).map((s) => s.slot));
  const out = draft.map((s) => {
    let slot = s.slot;
    if (!s.id) { slot = [0, 1, 2, 3, 4, 5, 6, 7].find((n) => !used.has(n)) ?? 0; used.add(slot); }
    return { id: s.id || shortId(), name: s.name, slot, goal: Math.round(Math.max(0, Math.min(100, Number(s.goalH) || 0)) * 60), archived: false };
  });
  const withData = new Set(sessionsOf(S.user.id).map((x) => x.s));
  if (prev) prev.subjects.forEach((s) => { if (!out.find((o) => o.id === s.id) && (s.archived || withData.has(s.id))) out.push({ ...s, archived: true }); });
  S.profiles[S.user.id] = { id: S.user.id, nick, subjects: out, timer: prev ? prev.timer : null, created: prev ? prev.created : Date.now() };
  S.subjDraft = null;
  msg.textContent = "Speichere …";
  const ok = await saveMyProfile();
  if (ok) {
    msg.textContent = "Gespeichert."; msg.classList.add("ok");
    if (S.phase === "setup") { S.phase = "app"; S.tab = S.inviteCode ? "rangliste" : "heute"; }
    setTimeout(() => { if (msg.textContent === "Gespeichert.") msg.textContent = ""; }, 2500);
  } else { msg.textContent = ""; if (!prev) delete S.profiles[S.user.id]; }
  render();
}

/* ---------- 5. Diagramme ---------- */
const TIPS = new Map(); let tipSeq = 0;
function tipKey(prefix, html) { const k = prefix + ++tipSeq; TIPS.set(k, html); return k; }
function clearTips(prefix) { for (const k of TIPS.keys()) if (k.startsWith(prefix)) TIPS.delete(k); }
const tipEl = $("#tip");
function showTip(el, x, y) {
  const html = TIPS.get(el.getAttribute("data-tip")); if (!html) { tipEl.hidden = true; return; }
  tipEl.innerHTML = html; tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tipEl.style.left = Math.max(8, left) + "px"; tipEl.style.top = Math.max(8, top) + "px";
}
document.addEventListener("pointermove", (e) => { const t = e.target.closest && e.target.closest("[data-tip]"); if (t) showTip(t, e.clientX, e.clientY); else if (e.pointerType === "mouse") tipEl.hidden = true; });
document.addEventListener("pointerdown", (e) => { const t = e.target.closest && e.target.closest("[data-tip]"); if (t) showTip(t, e.clientX, e.clientY); else tipEl.hidden = true; });
addEventListener("scroll", () => (tipEl.hidden = true), { passive: true, capture: true });

function niceTick(maxMin) { for (const t of [15, 30, 60, 120, 180, 300, 600, 1200, 1800, 3000, 6000]) if (maxMin / t <= 5) return t; return 12000; }
function hoursLabel(v, isTop) { return (v / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + (isTop ? " h" : ""); }
function barSVG(el, items, opt) {
  const W = Math.max(300, Math.floor(el.clientWidth || 600)), H = opt.height || 220;
  const padL = 44, padR = 6, padT = items.some((i) => i.top) ? 24 : 12, padB = 26;
  const max = Math.max(0, ...items.map((it) => it.segs.reduce((a, s) => a + s.v, 0)));
  const tick = niceTick(Math.max(max, 60)), top = Math.max(tick, Math.ceil(max / tick) * tick);
  const iw = W - padL - padR, ih = H - padT - padB, bw = iw / items.length, barW = Math.max(6, Math.min(36, bw * 0.66));
  const y = (v) => padT + ih - (v / top) * ih;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || "")}">`;
  for (let v = 0; v <= top + 0.001; v += tick) { const yy = Math.round(y(v)) + 0.5; s += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" class="${v === 0 ? "axis" : "grid"}"/><text x="${padL - 7}" y="${yy + 4}" text-anchor="end">${hoursLabel(v, v === top)}</text>`; }
  items.forEach((it, i) => {
    const cx = padL + bw * i + bw / 2, x = cx - barW / 2;
    if (it.highlight) s += `<rect x="${(padL + bw * i + 1).toFixed(1)}" y="${padT}" width="${(bw - 2).toFixed(1)}" height="${ih}" fill="var(--ink)" fill-opacity=".07"/>`;
    let acc = 0;
    it.segs.forEach((sg, j) => {
      const y0 = y(acc), y1 = y(acc + sg.v); acc += sg.v;
      const bottom = y0, h = Math.max(1, bottom - y1);
      const isTop = j === it.segs.length - 1;
      if (isTop) { const r = Math.min(5, h / 2, barW / 2); s += `<path d="M${x.toFixed(1)},${bottom.toFixed(1)} V${(y1 + r).toFixed(1)} Q${x.toFixed(1)},${y1.toFixed(1)} ${(x + r).toFixed(1)},${y1.toFixed(1)} H${(x + barW - r).toFixed(1)} Q${(x + barW).toFixed(1)},${y1.toFixed(1)} ${(x + barW).toFixed(1)},${(y1 + r).toFixed(1)} V${bottom.toFixed(1)} Z" fill="${sg.color}" stroke="var(--edge)" stroke-width="2"/>`; }
      else s += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${sg.color}" stroke="var(--edge)" stroke-width="2"/>`;
    });
    if (it.top) s += `<text x="${cx.toFixed(1)}" y="${(y(acc) - 7).toFixed(1)}" text-anchor="middle" class="strong">${esc(it.top)}</text>`;
    if (it.label) s += `<text x="${cx.toFixed(1)}" y="${H - 7}" text-anchor="middle" ${it.highlight ? 'class="strong"' : ""}>${esc(it.label)}</text>`;
    s += `<rect class="hit" x="${(padL + bw * i).toFixed(1)}" y="${padT}" width="${bw.toFixed(1)}" height="${ih}" data-tip="${it.tip}"/>`;
  });
  return s + "</svg>";
}
function heatColor(v) {
  if (!v) return "var(--heat0)";
  if (v < 30) return "color-mix(in oklab, var(--s1) 30%, var(--heat0))";
  if (v < 60) return "color-mix(in oklab, var(--s1) 55%, var(--heat0))";
  if (v < 120) return "color-mix(in oklab, var(--s1) 78%, var(--heat0))";
  return "var(--s1)";
}
function renderHeatmap(all) {
  const byDay = new Map(); all.forEach((x) => { const k = dayKey(x.t); byDay.set(k, (byDay.get(k) || 0) + x.m); });
  const weeks = 18, cell = 14, g = 4, padL = 26, padT = 18;
  const start = addDays(weekStart(new Date()), -(weeks - 1) * 7), today = startOfDay(new Date());
  const W = padL + weeks * (cell + g), H = padT + 7 * (cell + g);
  clearTips("hm");
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lernkalender der letzten 18 Wochen">`;
  ["Mo", "", "Mi", "", "Fr", "", "So"].forEach((l, r) => { if (l) s += `<text x="0" y="${padT + r * (cell + g) + 11}">${l}</text>`; });
  let lastM = -1;
  for (let w = 0; w < weeks; w++) {
    const wsd = addDays(start, w * 7);
    if (wsd.getMonth() !== lastM) { lastM = wsd.getMonth(); if (w < weeks - 1) s += `<text x="${padL + w * (cell + g)}" y="11">${MON[lastM]}</text>`; }
    for (let r = 0; r < 7; r++) {
      const d = addDays(wsd, r); if (d > today) continue;
      const v = byDay.get(dayKey(d)) || 0; const isToday = dayKey(d) === dayKey(today);
      const k = tipKey("hm", `<b>${WD[d.getDay()]} ${fmtDate(d)}${d.getFullYear()}</b><div>${v ? fmtDur(v) : "nichts gelernt"}${v >= STREAK_MIN ? " · zählt für Serie" : ""}</div>`);
      s += `<rect x="${padL + w * (cell + g)}" y="${padT + r * (cell + g)}" width="${cell}" height="${cell}" rx="3" fill="${heatColor(v)}" stroke="var(--edge)" stroke-width="${isToday ? 2.5 : 1.2}" stroke-opacity="${v || isToday ? 1 : 0.35}" data-tip="${k}"/>`;
    }
  }
  $("#heatmap").innerHTML = s + "</svg>";
  $("#heatLegend").innerHTML = `weniger <i style="background:var(--heat0)"></i><i style="background:${heatColor(10)}"></i><i style="background:${heatColor(45)}"></i><i style="background:${heatColor(90)}"></i><i style="background:${heatColor(200)}"></i> mehr <span style="margin-left:8px">(unter 30 min · 30–60 min · 1–2 h · über 2 h)</span>`;
}
function raceSVG(el, race, todayIdx, ws) {
  const W = Math.max(300, Math.floor(el.clientWidth || 600)), H = 230;
  const direct = race.length <= 4;
  const padL = 44, padR = direct ? 90 : 12, padT = 14, padB = 26;
  const max = Math.max(60, ...race.map((r) => r.cum[todayIdx] || 0));
  const tick = niceTick(max), top = Math.ceil(max / tick) * tick;
  const iw = W - padL - padR, ih = H - padT - padB;
  const x = (d) => padL + (iw * d) / 6, y = (v) => padT + ih - (v / top) * ih;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Aufsummierte Lernzeit dieser Woche je Person">`;
  for (let v = 0; v <= top + 0.001; v += tick) { const yy = Math.round(y(v)) + 0.5; s += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" class="${v === 0 ? "axis" : "grid"}"/><text x="${padL - 7}" y="${yy + 4}" text-anchor="end">${hoursLabel(v, v === top)}</text>`; }
  ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].forEach((l, d) => { s += `<text x="${x(d)}" y="${H - 7}" text-anchor="middle" ${d === todayIdx ? 'class="strong"' : ""}>${l}</text>`; });
  const labels = [];
  race.forEach((r) => {
    const pts = r.cum.slice(0, todayIdx + 1).map((v, d) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`);
    s += `<polyline points="${pts.join(" ")}" fill="none" stroke="var(--edge)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
    s += `<polyline points="${pts.join(" ")}" fill="none" stroke="${r.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    const lx = x(todayIdx), ly = y(r.cum[todayIdx]);
    s += `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="5.5" fill="${r.color}" stroke="var(--edge)" stroke-width="2"/>`;
    labels.push({ y: ly, r });
  });
  if (direct) { labels.sort((a, b) => a.y - b.y); let last = -99; labels.forEach((l) => { const yy = Math.max(l.y, last + 14); last = yy; const n = l.r.name.length > 11 ? l.r.name.slice(0, 10) + "…" : l.r.name; s += `<text x="${(x(todayIdx) + 11).toFixed(1)}" y="${(yy + 4).toFixed(1)}" class="strong">${esc(n)}</text>`; }); }
  for (let d = 0; d <= todayIdx; d++) {
    const day = addDays(ws, d);
    const k = tipKey("rc", `<b>bis ${WD[day.getDay()]} ${fmtDate(day)}</b>` + race.slice().sort((a, b) => b.cum[d] - a.cum[d]).map((r) => `<div class="tr"><span><i class="sw" style="background:${r.color}"></i>${esc(r.name)}</span><span class="mono">${fmtH(r.cum[d])}</span></div>`).join(""));
    const x0 = d === 0 ? padL : (x(d - 1) + x(d)) / 2, x1 = d === 6 ? W - padR : (x(d) + x(d + 1)) / 2;
    s += `<rect class="hit" x="${x0.toFixed(1)}" y="${padT}" width="${(x1 - x0).toFixed(1)}" height="${ih}" data-tip="${k}"/>`;
  }
  return s + "</svg>";
}

/* ---------- 6. Ereignisse ---------- */
async function copyText(text, msgEl) {
  try { await navigator.clipboard.writeText(text); if (msgEl) { msgEl.textContent = "Kopiert. Schick den Link an deine Freunde."; msgEl.className = "msg small ok"; } }
  catch (_) { if (msgEl) { msgEl.textContent = "Kopieren ging nicht. Markiere den Link und kopiere ihn von Hand."; msgEl.className = "msg small err"; } }
}
async function joinGroup(code, msgEl) {
  const c = String(code || "").trim().toUpperCase();
  if (c.length < 4) { msgEl.textContent = "Gib den Code ein."; msgEl.className = "msg err"; return false; }
  msgEl.textContent = "Trete bei …"; msgEl.className = "msg";
  const r = await dbWrite(() => S.sb.rpc("join_group", { invite_code: c }));
  if (!r) { msgEl.textContent = ""; return false; }
  S.activeGroup = r.data && r.data.id; store.set("stundenbuch-gruppe", S.activeGroup);
  await loadAll(); render();
  msgEl.textContent = "Beigetreten."; msgEl.className = "msg ok";
  return true;
}
function clearInvite() {
  S.inviteCode = null;
  try { const u = new URL(location.href); u.searchParams.delete("gruppe"); history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (_) {}
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  const p = S.user && me();

  if (t.id === "bannerClose") { $("#banner").hidden = true; return; }
  if (t.dataset.tab) { S.tab = t.dataset.tab; S.editDraft = null; S.confirmDel = null; S.groupConfirm = null; render(); scrollTo({ top: 0 }); return; }
  if (t.dataset.mode) { S.authMode = t.dataset.mode; $("#authMsg").textContent = ""; render(); return; }
  if (t.id === "forgotBtn") { S.authMode = "reset"; $("#authMsg").textContent = ""; render(); return; }
  if (t.id === "backToLogin") { S.authMode = "login"; $("#authMsg").textContent = ""; render(); return; }

  // Stoppuhr
  if (t.dataset.subj && !t.disabled) { S.selSubject = t.dataset.subj; render(); return; }
  if (t.id === "btnStart" && p && S.selSubject) { setMyProfile({ timer: { s: S.selSubject, startedAt: Date.now() } }); return; }
  if (t.id === "btnStop" && p && p.timer) {
    const end = Date.now();
    S.stopDraft = { s: p.timer.s, t: p.timer.startedAt, endAt: end, m: Math.max(1, Math.round((end - p.timer.startedAt) / 60000)), f: null };
    renderStopForm(); render(); return;
  }
  if (t.id === "btnCancel") { S.stopConfirm = true; render(); return; }
  if (t.id === "cancelNo") { S.stopConfirm = false; render(); return; }
  if (t.id === "cancelYes") { S.stopConfirm = false; setMyProfile({ timer: null }); return; }
  if (t.closest("#stopFocus") && t.dataset.f) { S.stopDraft.f = Number(t.dataset.f); renderFocusPicker($("#stopFocus"), S.stopDraft.f); return; }
  if (t.id === "stopSave" && S.stopDraft) {
    const d = S.stopDraft; const m = Math.max(1, Math.min(720, Math.round(Number($("#stopMin").value) || d.m)));
    S.stopDraft = null; renderStopForm();
    S.profiles[S.user.id] = { ...me(), timer: null };
    await addSession({ s: d.s, t: d.t, m, f: d.f });
    saveMyProfile(); return;
  }
  if (t.id === "stopDiscard") { $("#stopBtns").innerHTML = `<div class="confirm">Einheit wirklich verwerfen? <button type="button" class="btn sm" id="discardYes">Ja, verwerfen</button><button type="button" class="btn sm" id="discardNo">Nein</button></div>`; return; }
  if (t.id === "discardNo") { renderStopForm(); return; }
  if (t.id === "discardYes") { S.stopDraft = null; renderStopForm(); setMyProfile({ timer: null }); return; }

  // Nachtragen
  if (t.closest("#quickMin") && t.dataset.min) { $("#addMin").value = t.dataset.min; syncAddTime(); return; }
  if (t.closest("#addFocus") && t.dataset.f) { const f = Number(t.dataset.f); S.addFocus = S.addFocus === f ? null : f; renderFocusPicker($("#addFocus"), S.addFocus); return; }

  // Statistik & Verlauf
  if (t.closest("#rangeSeg") && t.dataset.range) { S.range = t.dataset.range; S.editDraft = null; render(); return; }
  if (t.dataset.edit) { const x = S.sessions.find((z) => z.id === t.dataset.edit); if (x) { S.editDraft = { id: x.id, s: x.s, m: x.m, f: x.f }; S.confirmDel = null; render(); } return; }
  if (t.hasAttribute("data-ed-cancel")) { S.editDraft = null; S.confirmDel = null; render(); return; }
  if (t.dataset.edSave) { const ed = S.editDraft; if (!ed) return; const m = Math.max(1, Math.min(720, Math.round(Number(ed.m) || 1))); S.editDraft = null; updateSession(t.dataset.edSave, { subject_id: ed.s, minutes: m, focus: ed.f || null }); return; }
  if (t.dataset.del) { S.confirmDel = t.dataset.del; render(); return; }
  if (t.hasAttribute("data-del-no")) { S.confirmDel = null; render(); return; }
  if (t.dataset.delYes) { S.confirmDel = null; S.editDraft = null; deleteSession(t.dataset.delYes); return; }

  // Rangliste & Gruppen
  if (t.dataset.group) { S.activeGroup = t.dataset.group; store.set("stundenbuch-gruppe", S.activeGroup); S.groupConfirm = null; render(); return; }
  if (t.dataset.p) { S.lbPeriod = t.dataset.p; render(); return; }
  if (t.dataset.copy) { copyText(t.dataset.copy, $("#copyMsg")); return; }
  if (t.id === "leaveBtn") { S.groupConfirm = "leave"; render(); return; }
  if (t.id === "dissolveBtn") { S.groupConfirm = "dissolve"; render(); return; }
  if (t.id === "gcNo") { S.groupConfirm = null; render(); return; }
  if (t.id === "leaveYes" || t.id === "dissolveYes") {
    const gid = S.activeGroup; S.groupConfirm = null;
    const ok = t.id === "leaveYes"
      ? await dbWrite(() => S.sb.from("group_members").delete().eq("group_id", gid).eq("user_id", S.user.id))
      : await dbWrite(() => S.sb.from("groups").delete().eq("id", gid));
    if (ok) { S.activeGroup = null; await loadAll().catch(() => {}); }
    render(); return;
  }
  if (t.id === "inviteJoin") { if (await joinGroup(S.inviteCode, $("#inviteMsg"))) clearInvite(); render(); return; }
  if (t.id === "inviteIgnore") { clearInvite(); render(); return; }

  // Profil
  if (t.id === "addSubjBtn") { ensureDraft(); if (S.subjDraft.length < MAX_SUBJECTS) { const used = new Set(S.subjDraft.map((s) => s.slot)); S.subjDraft.push({ id: "", name: "", slot: [0, 1, 2, 3, 4, 5, 6, 7].find((n) => !used.has(n)) ?? 0, goal: 0, goalH: 0 }); renderProfile(); const inp = $("#se-name-" + (S.subjDraft.length - 1)); if (inp) inp.focus(); } return; }
  if (t.dataset.rm !== undefined && t.closest("#subjEditor")) { ensureDraft(); S.subjDraft.splice(Number(t.dataset.rm), 1); renderProfile(); return; }
  if (t.id === "saveProfile") { saveProfileForm(); return; }
  if (t.id === "logoutBtn") { await S.sb.auth.signOut(); return; }
  if (t.id === "deleteBtn") { $("#deleteArea").innerHTML = `<span class="confirm">Alle deine Daten werden endgültig gelöscht. <button type="button" class="btn sm danger" id="deleteYes">Ja, Konto löschen</button><button type="button" class="btn sm" id="deleteNo">Nein</button></span>`; return; }
  if (t.id === "deleteNo") { $("#deleteArea").innerHTML = `<button type="button" class="btn danger sm" id="deleteBtn">Konto löschen</button>`; return; }
  if (t.id === "deleteYes") {
    const r = await dbWrite(() => S.sb.rpc("delete_my_account"));
    if (r) { await S.sb.auth.signOut(); $("#authMsg").textContent = "Dein Konto wurde gelöscht."; }
    return;
  }
  if (t.id === "exportBtn") { exportData(); return; }
  if (t.id === "importYes") { runImport(); return; }
  if (t.id === "importNo") { pendingImport = null; $("#importMsg").textContent = ""; return; }
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.closest && t.closest("#subjEditor") && t.dataset.k) { ensureDraft(); const s = S.subjDraft[Number(t.dataset.i)]; if (s) s[t.dataset.k] = t.value; return; }
  if (t.id === "nickInput") { S.nickDraft = t.value; return; }
  if (t.id === "stopMin" && S.stopDraft) { S.stopDraft.m = Number(t.value) || S.stopDraft.m; return; }
  if (t.id === "ed-m" && S.editDraft) { S.editDraft.m = t.value; return; }
  if (t.id === "addMin") syncAddTime();
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "ed-s" && S.editDraft) S.editDraft.s = t.value;
  if (t.id === "ed-f" && S.editDraft) S.editDraft.f = t.value ? Number(t.value) : null;
  if (t.id === "lbMetric") { S.lbMetric = t.value; render(); }
  if (t.id === "addDate" || t.id === "addTime") $("#addTime").dataset.touched = "1";
});

// Anmeldeformular
$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#authMsg"); msg.className = "msg";
  const email = $("#authEmail").value.trim(), pass = $("#authPass").value, pass2 = $("#authPass2").value;
  const m = S.authMode;
  if (m !== "recovery" && !/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = "Gib eine gültige E-Mail-Adresse ein."; msg.classList.add("err"); return; }
  if (m !== "reset" && pass.length < 8) { msg.textContent = "Das Passwort braucht mindestens 8 Zeichen."; msg.classList.add("err"); return; }
  if ((m === "signup" || m === "recovery") && pass !== pass2) { msg.textContent = "Die beiden Passwörter stimmen nicht überein."; msg.classList.add("err"); return; }
  const btn = $("#authSubmit"); btn.disabled = true; msg.textContent = "Einen Moment …";
  try {
    if (m === "login") {
      const { error } = await S.sb.auth.signInWithPassword({ email, password: pass }); if (error) throw error;
      msg.textContent = "";
    } else if (m === "signup") {
      const { data, error } = await S.sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: location.origin + location.pathname } }); if (error) throw error;
      if (!data.session) { msg.textContent = "Fast geschafft: Bestätige deine E-Mail über den Link in deinem Postfach, dann melde dich an."; msg.classList.add("ok"); S.authMode = "login"; render(); }
      else msg.textContent = "";
    } else if (m === "reset") {
      const { error } = await S.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error;
      msg.textContent = "Falls es ein Konto mit dieser E-Mail gibt, kommt gleich eine E-Mail mit einem Link."; msg.classList.add("ok");
    } else if (m === "recovery") {
      const { error } = await S.sb.auth.updateUser({ password: pass }); if (error) throw error;
      S.authMode = "login"; msg.textContent = "";
      const { data } = await S.sb.auth.getSession(); await handleSession(data.session);
    }
  } catch (err) { msg.textContent = friendlyError(err); msg.classList.add("err"); }
  finally { btn.disabled = false; $("#authPass").value = ""; $("#authPass2").value = ""; }
});

$("#pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#pwMsg"); msg.className = "msg";
  const a = $("#pwNew").value, b = $("#pwNew2").value;
  if (a.length < 8) { msg.textContent = "Mindestens 8 Zeichen."; msg.classList.add("err"); return; }
  if (a !== b) { msg.textContent = "Die Passwörter stimmen nicht überein."; msg.classList.add("err"); return; }
  const { error } = await S.sb.auth.updateUser({ password: a });
  if (error) { msg.textContent = friendlyError(error); msg.classList.add("err"); return; }
  $("#pwNew").value = ""; $("#pwNew2").value = "";
  msg.textContent = "Passwort geändert."; msg.classList.add("ok");
});

$("#joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (await joinGroup($("#joinCode").value, $("#joinMsg"))) $("#joinCode").value = "";
});
$("#createForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#createMsg"); const name = $("#createName").value.trim();
  if (!name) { msg.textContent = "Gib einen Namen ein."; msg.className = "msg err"; return; }
  msg.textContent = "Erstelle …"; msg.className = "msg";
  const r = await dbWrite(() => S.sb.rpc("create_group", { group_name: name }));
  if (!r) { msg.textContent = ""; return; }
  $("#createName").value = "";
  S.activeGroup = r.data && r.data.id; store.set("stundenbuch-gruppe", S.activeGroup);
  await loadAll().catch(() => {}); render();
  msg.textContent = "Erstellt. Kopier oben den Einladungslink."; msg.className = "msg ok";
});

function syncAddTime() {
  const tm = $("#addTime"); if (tm.dataset.touched) return;
  const m = Number($("#addMin").value) || 45; const d = new Date(Date.now() - m * 60000);
  tm.value = pad(d.getHours()) + ":" + pad(d.getMinutes()); $("#addDate").value = dayKey(d);
}
$("#addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#addMsg"); msg.className = "msg";
  const s = $("#addSubj").value, m = Math.round(Number($("#addMin").value)), date = $("#addDate").value, time = $("#addTime").value || "12:00";
  const fail = (txt) => { msg.textContent = txt; msg.classList.add("err"); };
  if (!s) return fail("Wähle ein Fach.");
  if (!m || m < 1 || m > 720) return fail("Die Dauer muss zwischen 1 und 720 Minuten liegen.");
  const t = new Date(date + "T" + time).getTime();
  if (!date || !isFinite(t)) return fail("Datum oder Uhrzeit ist ungültig.");
  if (t > Date.now() + 60000) return fail("Die Einheit liegt in der Zukunft. Prüfe Datum und Beginn.");
  const ok = await addSession({ s, t, m, f: S.addFocus });
  if (!ok) return;
  msg.textContent = "Eingetragen: " + fmtDur(m) + "."; msg.classList.add("ok");
  delete $("#addTime").dataset.touched; $("#addMin").value = 45; S.addFocus = null; renderFocusPicker($("#addFocus"), null); syncAddTime();
  setTimeout(() => { if (msg.textContent.startsWith("Eingetragen")) msg.textContent = ""; }, 3000);
});

/* --- Export & Import --- */
function exportData() {
  const p = me(); if (!p) return;
  const data = { app: "stundenbuch", version: 2, exported_at: new Date().toISOString(), profile: { nick: p.nick, subjects: p.subjects },
    sessions: sessionsOf(S.user.id).map((x) => ({ subject_id: x.s, started_at: new Date(x.t).toISOString(), minutes: x.m, focus: x.f })) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "stundenbuch-" + dayKey(new Date()) + ".json";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
let pendingImport = null;
// Liest beide Formate: Sicherung der Browser-Version (Schlüssel "members/…") und den Export dieser Version
function parseBackup(obj) {
  if (obj && obj.app === "stundenbuch" && Array.isArray(obj.sessions)) {
    return { subjects: (obj.profile && obj.profile.subjects) || [], sessions: obj.sessions.map((x) => ({ s: String(x.subject_id), t: Date.parse(x.started_at), m: Number(x.minutes), f: x.focus || null })) };
  }
  const keys = obj && typeof obj === "object" ? Object.keys(obj) : [];
  const profKey = keys.find((k) => /^members\/[^/]+$/.test(k));
  if (!profKey) return null;
  const sessions = [];
  keys.filter((k) => k.startsWith(profKey + "/months/")).forEach((k) => (obj[k].sessions || []).forEach((x) => sessions.push({ s: String(x.s), t: Number(x.t), m: Number(x.m), f: x.f || null })));
  return { subjects: obj[profKey].subjects || [], sessions };
}
$("#importFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; const msg = $("#importMsg");
  if (!f) return;
  try {
    const parsed = parseBackup(JSON.parse(await f.text()));
    if (!parsed) throw new Error();
    parsed.sessions = parsed.sessions.filter((x) => isFinite(x.t) && x.m >= 1 && x.m <= 720);
    pendingImport = parsed;
    msg.innerHTML = `${parsed.sessions.length} Einheiten gefunden. Übernehmen? Doppelte werden übersprungen. <button type="button" class="btn sm c" id="importYes">Ja, übernehmen</button><button type="button" class="btn sm" id="importNo">Abbrechen</button>`;
  } catch (_) { msg.textContent = "Die Datei ist keine gültige Stundenbuch-Sicherung."; }
});
async function runImport() {
  const imp = pendingImport; pendingImport = null; const msg = $("#importMsg");
  if (!imp) return;
  const p = me();
  const byName = {}; p.subjects.forEach((s) => (byName[s.name.trim().toLowerCase()] = s));
  const oldName = {}; imp.subjects.forEach((s) => (oldName[String(s.id)] = String(s.name || "Fach").trim()));
  const subjects = p.subjects.slice(); let changed = false;
  const map = {};
  for (const [oid, nm] of Object.entries(oldName)) {
    let s = byName[nm.toLowerCase()];
    if (!s) {
      const used = new Set(subjects.map((z) => z.slot));
      s = { id: shortId(), name: nm.slice(0, 40), slot: [0, 1, 2, 3, 4, 5, 6, 7].find((n) => !used.has(n)) ?? subjects.length % 8, goal: 0, archived: active({ subjects }).length >= MAX_SUBJECTS };
      subjects.push(s); byName[nm.toLowerCase()] = s; changed = true;
    }
    map[oid] = s.id;
  }
  if (changed) { S.profiles[S.user.id] = { ...p, subjects }; if (!(await saveMyProfile())) return; }
  const existing = new Set(sessionsOf(S.user.id).map((x) => x.t + "|" + x.m));
  const rows = imp.sessions.filter((x) => map[x.s] && !existing.has(x.t + "|" + x.m)).map((x) => ({ id: uuid(), user_id: S.user.id, subject_id: map[x.s], started_at: new Date(x.t).toISOString(), minutes: Math.round(x.m), focus: x.f >= 1 && x.f <= 5 ? x.f : null }));
  msg.textContent = "Übernehme " + rows.length + " Einheiten …";
  for (let i = 0; i < rows.length; i += 200) {
    const ok = await dbWrite(() => S.sb.from("sessions").insert(rows.slice(i, i + 200)));
    if (!ok) { msg.textContent = "Import abgebrochen."; return; }
  }
  await loadAll().catch(() => {}); render();
  msg.textContent = rows.length + " Einheiten übernommen.";
}

/* ---------- 7. Start ---------- */
let lastDay = dayKey(new Date());
setInterval(() => {
  if (S.phase === "app" && S.tab === "heute") tickReadout();
  const k = dayKey(new Date()); if (k !== lastDay) { lastDay = k; render(); }
}, 1000);
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(render, 150); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleReload(100); });
setInterval(() => { if (S.phase === "app" && document.visibilityState === "visible") scheduleReload(0); }, 120000);

// Macht aus jeder kopierten Variante die reine Projektadresse:
// "https://abc.supabase.co/rest/v1/" -> "https://abc.supabase.co"
// "https://supabase.com/dashboard/project/abc/…" -> "https://abc.supabase.co"
function projectUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (u.hostname.endsWith(".supabase.co")) return "https://" + u.hostname;
    const m = u.pathname.match(/\/project\/([a-z0-9]{10,})/i);
    if (u.hostname.endsWith("supabase.com") && m) return "https://" + m[1].toLowerCase() + ".supabase.co";
    return u.origin; // eigener Server oder eigene Domain
  } catch (_) { return null; }
}

async function init() {
  renderFocusPicker($("#addFocus"), null); syncAddTime();
  try {
    const q = new URLSearchParams(location.search).get("gruppe"); if (q) S.inviteCode = q.trim().toUpperCase().slice(0, 12);
    const h = (location.hash || "").slice(1); if (TABS.includes(h)) S.tab = h;
  } catch (_) {}
  if (S.inviteCode) S.tab = "rangliste";
  render();
  const cfg = window.STUNDENBUCH_CONFIG || {};
  if (!window.supabase || typeof window.supabase.createClient !== "function") { $("#bootMsg").textContent = "Die Datei supabase.js fehlt. Lade alle Dateien aus dem Projektordner hoch."; return; }
  if (!cfg.supabaseUrl || /DEIN/.test(cfg.supabaseUrl + cfg.supabaseKey)) { $("#bootMsg").textContent = "Fast fertig: Trag in config.js die Adresse und den Schlüssel deines Supabase-Projekts ein (README, Schritt 3)."; return; }
  const url = projectUrl(cfg.supabaseUrl);
  if (!url) { $("#bootMsg").textContent = "Die Adresse in config.js stimmt nicht. Sie muss so aussehen: https://abcdefgh.supabase.co (README, Schritt 3)."; return; }
  S.sb = window.supabase.createClient(url, String(cfg.supabaseKey).trim(), { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  S.sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") S.authMode = "recovery";
    // Supabase empfiehlt: im Callback nicht direkt weitere Anfragen abwarten
    setTimeout(() => handleSession(session), 0);
  });
  const { data } = await S.sb.auth.getSession();
  handleSession(data.session);
}
init();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
})();
