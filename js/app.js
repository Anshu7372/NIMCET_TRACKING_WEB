/* NIMCET Rank 1 Tracker — UI. State lives in localStorage; export JSON for backup. */

const KEY = "nimcet-tracker-v1";
const POMO_KEY = "nimcet-pomo-v1";

/* ---------------- state ---------------- */
function defaultState() {
  return {
    v: 1,
    settings: {
      perDay: 240,
      restDay: 0,
      dryRunDate: "",
      examDate: "2027-06-06",
      startDate: todayStr(),
      profile: DEFAULT_PROFILE,
      theme: "",
    },
    progress: {},
    mistakes: [],
    mocks: [],
    papersDone: 0,
    mocksDone: 0,
    cycleIndex: 0,
    days: {},
    log: {},
    pomos: {},
    speedKit: {},
    quiz: {},
    bm: {},
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const d = defaultState();
      return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
    }
  } catch (e) { /* storage blocked or corrupt → fresh state */ }
  return defaultState();
}

let state = loadState();

// Bump when the syllabus/resources change: unticked saved day plans are rebuilt
// so they show the current syllabus and resources.
const DATA_V = 3;
function migrateData() {
  if (state.dataV === DATA_V) return;
  if ((state.dataV || 0) < 3) {
    // Target changed to NIMCET 2027 at 4 h/day.
    Object.assign(state.settings, { perDay: 240, examDate: "2027-06-06", dryRunDate: "" });
  }
  for (const [d, day] of Object.entries(state.days)) {
    if (!Object.values(day.checks || {}).some(Boolean)) delete state.days[d];
  }
  state.dataV = DATA_V;
}
migrateData();

// Old day snapshots are only needed for the streak; keep the saved state small.
function pruneDays() {
  const cutoff = addDays(todayStr(), -21);
  for (const d of Object.keys(state.days)) if (d < cutoff) delete state.days[d];
}

function save() {
  state.savedAt = Date.now();
  pruneDays();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { if (!cloud.ref) toast("⚠ Save failed — browser storage blocked. Export backup!"); }
  queueCloud();
}

/* ---------------- account sync (claude.ai artifact only) ---------------- */
// On claude.ai the page gets a private per-user document; elsewhere it stays browser-only.
const cloud = { ref: null, status: "local", timer: 0, writing: false, again: false };

function setSync(status) {
  cloud.status = status;
  const el = document.getElementById("syncState");
  if (!el) return;
  const txt = { local: "Browser only", synced: "☁ Saved to account", saving: "☁ Saving…", error: "⚠ Sync failed — export backup" };
  el.textContent = txt[status] || "";
  el.dataset.s = status;
}

function queueCloud() {
  if (!cloud.ref) return;
  clearTimeout(cloud.timer);
  setSync("saving");
  cloud.timer = setTimeout(writeCloud, 1500);
}

async function writeCloud() {
  if (cloud.writing) { cloud.again = true; return; }
  cloud.writing = true;
  try {
    const json = JSON.stringify(state);
    if (json.length > 240000) toast("⚠ Data bahut bada ho gaya — resolved mistakes delete karo ya export karo");
    await cloud.ref.set({ json, savedAt: state.savedAt || Date.now() });
    setSync("synced");
  } catch (e) {
    if (e && e.code === "unavailable") { setTimeout(writeCloud, 2000 + Math.random() * 2000); }
    else setSync("error");
  } finally {
    cloud.writing = false;
    if (cloud.again) { cloud.again = false; writeCloud(); }
  }
}

async function initCloud() {
  for (let i = 0; i < 6 && !(window.claude && window.claude.use); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(window.claude && window.claude.use)) return;
  try {
    const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    if (!db || !user) return;
    const id = await user.id();
    if (!id) return;
    cloud.ref = db.doc("data/users/" + id + "/tracker");
    const snap = await cloud.ref.get();
    const remote = snap.exists ? JSON.parse(snap.data().json || "null") : null;
    if (remote && (remote.savedAt || 0) > (state.savedAt || 0)) {
      const d = defaultState();
      state = { ...d, ...remote, settings: { ...d.settings, ...(remote.settings || {}) } };
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
      applyTheme(); render();
      setSync("synced");
    } else if (state.savedAt) {
      queueCloud();
    } else setSync("synced");
  } catch (e) {
    cloud.ref = null;
    setSync("local");
  }
}

/* In-page confirmation: first tap arms the button, second tap within 4 s runs it. */
function armed(el, label) {
  if (el.dataset.armed === "1") return true;
  el.dataset.armed = "1";
  const old = el.textContent;
  el.textContent = label || "Pakka? Dobara tap karo";
  el.classList.add("bad");
  setTimeout(() => { el.dataset.armed = ""; el.textContent = old; el.classList.remove("bad"); }, 4000);
  return false;
}

const ui = { tab: "today", openCh: new Set(), openLeaf: null, planPage: 0, synFilter: { sub: "", q: "", tough: false, status: "" }, promptLeaf: "", mistakeFilter: "open" };

/* ---------------- utils ---------------- */
const $ = (sel) => document.querySelector(sel);
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}
function uid() { return Math.random().toString(36).slice(2, 10); }
function subj(id) { return SUBJECTS.find((s) => s.id === id); }
function pct(a, b) { return b ? Math.min(100, Math.round((a / b) * 100)) : 0; }
function hrs(m) { return (m / 60).toFixed(m >= 600 ? 0 : 1); }
function copy(text) {
  const done = () => toast("Copied ✓ — Claude me paste karo");
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { toast("Copy failed — select karke copy karo"); }
  ta.remove();
}
function badgeDepth(d) { return `<span class="badge d${d}">${DEPTH[d].label}</span>`; }
function badgeW(w) { return `<span class="badge w">~${w} Q/paper</span>`; }
function leafOptions(selected) {
  let h = `<option value="">— General / not specific —</option>`;
  for (const ch of CHAPTERS) {
    h += `<optgroup label="${esc(ch.id + " · " + ch.name)}">`;
    LEAVES.filter((l) => l.ch === ch).forEach((l) => { h += `<option value="${l.id}" ${l.id === selected ? "selected" : ""}>${esc(l.name)}</option>`; });
    h += `</optgroup>`;
  }
  return h;
}

/* ---------------- progress application ---------------- */
function applyContent(item, sign) {
  const leaf = LEAF[item.leafId];
  if (!leaf) return;
  const p = lp(state, leaf.id);
  const wasDone = leafDone(state, leaf);
  p.mins = Math.max(0, p.mins + sign * (item.b - item.a));
  for (const st of item.steps) if (st.q && p.qs[st.kind] != null) p.qs[st.kind] = Math.max(0, p.qs[st.kind] + sign * st.q);
  p.last = todayStr();
  if (!wasDone && leafDone(state, leaf)) { startRevision(state, leaf, todayStr()); toast(`✓ "${leaf.name}" complete — kal se revision me aayega`); }
}

function nextChunk(sub, mins) {
  const leaf = LEAVES.find((l) => l.ch.subject === sub && remainingMins(state, l) > 0);
  if (!leaf) return null;
  const at = leaf.mins - remainingMins(state, leaf);
  const b = Math.min(leaf.mins, at + mins);
  return { type: "content", leafId: leaf.id, a: at, b, steps: leafWork(leaf, at, b) };
}

function revItems(date, mins) {
  const items = [];
  const due = dueRevisions(state, date);
  const cap = Math.max(2, Math.floor(mins / 7));
  due.slice(0, cap).forEach((l) => items.push({ type: "rev", leafId: l.id }));
  const tough = toughLeaves(state).filter((l) => state.progress[l.id].mins > 0 && !items.some((i) => i.leafId === l.id));
  if (tough.length) {
    tough.sort((a, b) => ((state.progress[a.id].rev || {}).last || "") < ((state.progress[b.id].rev || {}).last || "") ? -1 : 1);
    items.push({ type: "rev", leafId: tough[0].id, toughDrill: true });
  }
  dueMistakes(state, date).slice(0, Math.max(2, Math.floor(mins / 10))).forEach((m) => items.push({ type: "mistake", id: m.id }));
  return { items, backlog: Math.max(0, due.length - cap) };
}

function buildDay(date) {
  const sim = simulate(state, date, 1)[0];
  const blocks = sim.blocks.map((b) => {
    const blk = { title: b.title, mins: Math.round(b.mins), note: b.note || "", tag: b.tag || "", items: [] };
    if (b.tasks) blk.items = b.tasks.map((t) => ({ type: "content", leafId: t.leafId, a: t.a, b: t.b, steps: leafWork(LEAF[t.leafId], t.a, t.b) }));
    else if (b.weekly) {
      const since = addDays(date, -7);
      const wk = LEAVES.filter((l) => { const p = state.progress[l.id]; return p && p.last && p.last >= since && p.last < date; }).slice(0, 10);
      blk.items = wk.length ? wk.map((l) => ({ type: "rev", leafId: l.id })) : [{ type: "check", text: b.note }];
    }
    else if (b.rev) { const r = revItems(date, b.mins); blk.items = r.items; blk.backlog = r.backlog; if (!r.items.length) blk.items = [{ type: "check", text: "Aaj koi revision due nahi — is time me Maths ka next chunk karo (+25 min button)." }]; }
    else if (b.title === "Speed drill") {
      // Rotate through the weakest speed-kit items.
      const lvl = (k) => state.speedKit[k.id] || 0;
      const pool = SPEED_KIT.filter((k) => lvl(k) < 3);
      const list = pool.length ? pool : SPEED_KIT;
      const minL = Math.min(...list.map(lvl));
      const weakest = list.filter((k) => lvl(k) === minL);
      const k = weakest[Math.max(0, diffDays(state.settings.startDate, date)) % weakest.length];
      blk.items = [{ type: "check", text: `${k.name} — ${k.how}` }];
    }
    else blk.items = [{ type: "check", text: b.note || b.title }];
    return blk;
  });
  return { date, phase: sim.phase, kind: sim.kind, blocks, checks: {} };
}

function ensureDay(date) {
  if (!state.days[date]) { state.days[date] = buildDay(date); save(); }
  return state.days[date];
}

function toggleItem(date, bi, ii, value) {
  const day = state.days[date];
  const key = `${bi}-${ii}`;
  const blk = day.blocks[bi];
  const item = blk.items[ii];
  const was = day.checks[key];
  if (item.type === "content") {
    if (value && !was) applyContent(item, +1);
    if (!value && was) applyContent(item, -1);
  }
  if (item.type === "check" && ii === 0 && blk.tag) {
    const sign = value && !was ? 1 : !value && was ? -1 : 0;
    if (sign) {
      state.cycleIndex = Math.max(0, (state.cycleIndex || 0) + sign);
      if (blk.tag === "paper-analysis") state.papersDone = Math.max(0, (state.papersDone || 0) + sign);
      if (blk.tag === "mock-analysis") state.mocksDone = Math.max(0, (state.mocksDone || 0) + sign);
    }
  }
  day.checks[key] = value || undefined;
  save();
}

/* ---------------- header ---------------- */
function renderHeader() {
  const s = state.settings;
  const d1 = s.dryRunDate ? diffDays(todayStr(), s.dryRunDate) : 0;
  const d2 = diffDays(todayStr(), s.examDate);
  const parts = [];
  if (d1 > 0) parts.push(`Dry run (NIMCET ${s.dryRunDate.slice(0, 4)}): ${d1} din`);
  if (d2 > 0) parts.push(`Target (NIMCET ${s.examDate.slice(0, 4)}): ${d2} din`);
  parts.push(`${+(s.perDay / 60).toFixed(1)} hrs/day`);
  $("#headerSub").textContent = parts.join(" · ");
}

/* ---------------- TODAY ---------------- */
function streak() {
  let n = 0;
  let d = todayStr();
  const ok = (x) => (state.log[x] || 0) >= 60 || dayComplete(x);
  if (!ok(d)) d = addDays(d, -1);
  while (ok(d)) { n++; d = addDays(d, -1); }
  return n;
}
function dayComplete(date) {
  const day = state.days[date];
  if (!day) return false;
  let total = 0, done = 0;
  day.blocks.forEach((b, bi) => b.items.forEach((_, ii) => { total++; if (day.checks[`${bi}-${ii}`]) done++; }));
  return total > 0 && done === total;
}
function weekMinutes() {
  let m = 0;
  for (let i = 0; i < 7; i++) m += state.log[addDays(todayStr(), -i)] || 0;
  return m;
}
function subjectProgress() {
  const t = totals();
  const out = {};
  for (const s of SUBJECTS) {
    let done = 0;
    LEAVES.filter((l) => l.ch.subject === s.id).forEach((l) => { done += Math.min(l.mins, (state.progress[l.id] || {}).mins || 0); });
    out[s.id] = { done, total: t[s.id].mins };
  }
  return out;
}
function weakAreas(n) {
  const rows = [];
  for (const l of LEAVES) {
    const p = state.progress[l.id];
    const mk = state.mistakes.filter((m) => m.leafId === l.id && !m.resolved).length;
    if (!p && !mk) continue;
    const score = mk * 3 + (p && p.tough ? 5 : 0) + (p && p.conf ? 5 - p.conf : 0);
    if (score > 0) rows.push({ l, score, mk, tough: p && p.tough, conf: p && p.conf });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, n);
}

function itemHtml(date, bi, ii, item, checked) {
  const key = `${bi}-${ii}`;
  if (item.type === "content") {
    const l = LEAF[item.leafId];
    const think = DEPTH[l.d].think;
    return `<div class="task ${checked ? "done" : ""}">
      <input type="checkbox" data-act="check" data-date="${date}" data-b="${bi}" data-i="${ii}" ${checked ? "checked" : ""}>
      <div class="tx">
        <div><b>${esc(l.name)}</b> ${badgeDepth(l.d)} ${badgeW(l.w)}</div>
        <div class="meta">${esc(l.ch.name)} → ${esc(l.topic)}</div>
        <ul>${item.steps.map((s) => `<li>${esc(s.text)}</li>`).join("")}</ul>
        <div class="meta">Think rule: <b>${think} min</b> socho → hint → retry → solution → re-solve list · Resources: ${esc(l.ch.subject === "M" && l.target.ncert ? l.ch.ncert : l.ch.obj)}</div>
        <div class="row" style="margin-top:6px">
          ${item.steps.some((s) => s.kind === "learn") ? `<button class="btn small primary" data-act="copyLeafPrompt" data-leaf="${l.id}">📋 Claude teach prompt</button>` : ""}
          <button class="btn small" data-act="openLeaf" data-leaf="${l.id}">Details</button>
          <button class="btn small" data-act="quickMistake" data-leaf="${l.id}">+ Mistake</button>
          <button class="btn small ${state.progress[l.id] && state.progress[l.id].tough ? "warn" : ""}" data-act="toggleTough" data-leaf="${l.id}">★ Tough</button>
        </div>
      </div></div>`;
  }
  if (item.type === "rev") {
    const l = LEAF[item.leafId];
    const p = state.progress[l.id] || {};
    const rated = checked;
    return `<div class="task ${rated ? "done" : ""}">
      <input type="checkbox" disabled ${rated ? "checked" : ""}>
      <div class="tx">
        <div><b>${esc(l.name)}</b> ${item.toughDrill ? `<span class="badge" style="color:var(--bad)">★ tough drill</span>` : ""} ${p.tough && !item.toughDrill ? `<span class="badge" style="color:var(--bad)">★</span>` : ""}</div>
        <div class="meta">${esc(l.ch.name)} · revision #${((p.rev || {}).count || 0) + 1}${p.notes ? " · note: " + esc(p.notes.slice(0, 80)) : ""}</div>
        <div class="meta">Blurt 2 min → formula check 2 min → 3 Qs (1 PYQ + purana galat) → rate:</div>
        ${rated ? `<div class="meta">Rated: <b>${esc(rated)}</b></div>` : `<div class="rate">
          <button class="btn small bad" data-act="rate" data-r="again" data-date="${date}" data-b="${bi}" data-i="${ii}">Again</button>
          <button class="btn small warn" data-act="rate" data-r="hard" data-date="${date}" data-b="${bi}" data-i="${ii}">Hard</button>
          <button class="btn small good" data-act="rate" data-r="good" data-date="${date}" data-b="${bi}" data-i="${ii}">Good</button>
          <button class="btn small primary" data-act="rate" data-r="easy" data-date="${date}" data-b="${bi}" data-i="${ii}">Easy</button></div>`}
      </div></div>`;
  }
  if (item.type === "mistake") {
    const m = state.mistakes.find((x) => x.id === item.id);
    if (!m) return "";
    const l = LEAF[m.leafId];
    return `<div class="task ${checked ? "done" : ""}">
      <input type="checkbox" disabled ${checked ? "checked" : ""}>
      <div class="tx">
        <div><b>Re-solve:</b> ${esc(m.ref || "question")} <span class="badge">${esc(m.type)}</span>${m.qid ? ` <button class="btn small primary" data-pact="retry" data-q="${esc(m.qid)}">↻ Practice me kholo</button>` : ""}</div>
        <div class="meta">${l ? esc(l.name) : "General"} · galti: ${esc(m.note)}</div>
        ${checked ? `<div class="meta">Result: <b>${esc(checked)}</b></div>` : `<div class="rate">
          <button class="btn small good" data-act="mres" data-r="solved" data-date="${date}" data-b="${bi}" data-i="${ii}">Solved ✓ (bina dekhe)</button>
          <button class="btn small bad" data-act="mres" data-r="failed" data-date="${date}" data-b="${bi}" data-i="${ii}">Failed ✗</button></div>`}
      </div></div>`;
  }
  return `<div class="task ${checked ? "done" : ""}">
    <input type="checkbox" data-act="check" data-date="${date}" data-b="${bi}" data-i="${ii}" ${checked ? "checked" : ""}>
    <div class="tx">${esc(item.text)}</div></div>`;
}

function renderToday() {
  const date = todayStr();
  const day = ensureDay(date);
  const sp = subjectProgress();
  const allDone = LEAVES.filter((l) => leafDone(state, l)).length;
  const weak = weakAreas(5);
  const ph = PHASES[day.phase] || PHASES.p1;
  const pomosToday = state.pomos[date] || 0;
  const bcolor = { "Maths — new": "var(--M)", "Spaced revision": "var(--bad)" };

  let blocks = "";
  day.blocks.forEach((b, bi) => {
    const color = bcolor[b.title] || (b.items.some((i) => i.type === "content") ? "var(--R)" : "var(--accent)");
    blocks += `<div class="block" style="border-left-color:${color}">
      <div class="bt"><span>${esc(b.title)}</span><span class="muted">${b.mins} min</span></div>
      ${b.note && b.items.some((i) => i.type !== "check") ? `<div class="meta">${esc(b.note)}</div>` : ""}
      ${b.items.map((it, ii) => itemHtml(date, bi, ii, it, day.checks[`${bi}-${ii}`])).join("")}
      ${b.backlog ? `<div class="meta">+${b.backlog} aur due hain → Revision tab / Sunday weekly revision me clear karo.</div>` : ""}
    </div>`;
  });

  const fresh = !Object.values(state.progress).some((p) => p.mins > 0) && !state.mocks.length;
  const setup = fresh ? `<div class="card infobox" style="margin-bottom:14px">
      <h3>👋 Day 1 setup (10 min, sirf ek baar)</h3>
      <ol class="steps">
        <li>claude.ai pe Project banao "NIMCET Rank 1" → <a href="#" data-act="copyMaster">Master prompt copy karo</a> → Project instructions me paste.</li>
        <li>Resources ready: NCERT 11 & 12 Maths (lecture + exercises), JEE Main PYQs (topic-wise), NIMCET PYQs, ek NIMCET test series.</li>
        <li>Settings me exam dates check karo. Guide tab 2 min me padh lo.</li>
        <li>Neeche ke plan se shuru karo — pehla task "Concept" hai → "📋 Claude teach prompt".</li>
      </ol></div>` : "";
  return `${setup}
  <div class="grid g4">
    <div class="card stat"><span class="l">Aaj</span><span class="v">${fmtDate(date, { weekday: "short", day: "numeric", month: "short" })}</span><span class="badge phase" style="background:${ph.color}">${esc(ph.name)}</span></div>
    <div class="card stat"><span class="l">Streak 🔥</span><span class="v">${streak()} din</span><span class="l">≥ 60 min ya poora plan</span></div>
    <div class="card stat"><span class="l">Is hafte</span><span class="v">${hrs(weekMinutes())} h</span><span class="l">target ${Math.round((state.settings.perDay * 6) / 60)} h · 🍅 aaj ${pomosToday}/${Math.round(state.settings.perDay / 30)}</span></div>
    <div class="card stat"><span class="l">Subtopics complete</span><span class="v">${allDone}/${LEAVES.length}</span><span class="l">revision due: ${dueRevisions(state, date).length}</span></div>
  </div>

  <div class="grid g2" style="margin-top:14px">
    <div class="card">
      <h2>Aaj ka plan · ${esc(day.kind)}</h2>
      <p class="meta">Pomodoro: ${Math.round(state.settings.perDay / 30)} × 25 min focus + 5 min break. Timer neeche right me hai. Har task ke baad tick karo — progress, questions count aur revision schedule auto update ho jayega.</p>
      ${blocks}
      <div class="row" style="margin-top:8px">
        <button class="btn" data-act="extra" data-sub="M">+25 min Maths (extra)</button>
        <button class="btn" data-act="extra" data-sub="R">+25 min Reasoning</button>
        <button class="btn" data-act="logManual">+25 min log (bina timer)</button>
        <button class="btn ghost" data-act="regen">↻ Regenerate</button>
      </div>
    </div>
    <div>
      <div class="card">
        <h3>Subject progress</h3>
        ${SUBJECTS.map((s) => `<div class="hbar"><span>${esc(s.name.split(" ")[0])}</span><div class="bar"><span style="width:${pct(sp[s.id].done, sp[s.id].total)}%;background:${s.color}"></span></div><span>${pct(sp[s.id].done, sp[s.id].total)}%</span></div>`).join("")}
      </div>
      <div class="card">
        <h3>⚠ Weak areas (auto)</h3>
        ${weak.length ? `<ul class="clean">${weak.map((w) => `<li><a href="#" data-act="openLeaf" data-leaf="${w.l.id}">${esc(w.l.name)}</a> <span class="meta">${w.mk ? w.mk + " mistakes · " : ""}${w.tough ? "★ tough · " : ""}${w.conf ? "conf " + w.conf + "/5" : ""}</span></li>`).join("")}</ul>` : `<p class="meta">Abhi data nahi. Tough topics ★ mark karo aur mistakes log karo — yaha top weak areas dikhenge aur revision me zyada aayenge.</p>`}
      </div>
      <div class="card soft">
        <h3>End-of-day checklist</h3>
        <ul class="clean">
          <li>☐ 5 min blurting: bina dekhe aaj ka sab likho</li>
          <li>☐ Galat/atke questions → Mistakes tab (type + sahi rule)</li>
          <li>☐ Mushkil laga? → ★ Tough mark karo</li>
          <li>☐ Formula card update</li>
          <li>☐ Claude ka "Learning profile update" → Claude tab me save</li>
        </ul>
      </div>
    </div>
  </div>`;
}

/* ---------------- PLAN ---------------- */
function renderPlan() {
  const pr = projection(state);
  const s = state.settings;
  const b = dayBudget(s.perDay);
  const t = totals();
  const totalH = Object.values(t).reduce((x, y) => x + y.mins, 0) / 60;
  const examIdx = pr.days.findIndex((d) => d.date === s.examDate);
  // What actually fits before the exam.
  const beforeExam = pr.days.filter((d) => d.date < s.examDate);
  const mocksBefore = beforeExam.filter((d) => ["Mock", "Mock + analysis", "Final: mock"].includes(d.kind)).length;
  const papersBefore = beforeExam.filter((d) => d.kind.startsWith("PYQ paper")).length;
  const sylDone = pr.p1End && pr.p1End < s.examDate;
  const warnLate = !sylDone || mocksBefore < 15;

  // month roadmap
  const months = {};
  pr.days.forEach((d) => {
    const k = d.date.slice(0, 7);
    const m = (months[k] = months[k] || { phases: new Set(), ch: new Set(), study: 0, mocks: 0, papers: 0 });
    m.phases.add(d.phase);
    if (d.kind === "Study day") m.study++;
    if (d.kind === "Mock" || d.kind === "Final: mock") m.mocks++;
    if (d.kind === "PYQ paper") m.papers++;
    d.blocks.forEach((bl) => (bl.tasks || []).forEach((tk) => m.ch.add(LEAF[tk.leafId].ch.id)));
  });
  const monthRows = Object.entries(months).slice(0, 24).map(([k, m]) => `<tr>
      <td><b>${fmtDate(k + "-01", { month: "short", year: "numeric" })}</b></td>
      <td>${[...m.phases].filter((p) => PHASES[p]).map((p) => `<span class="badge phase" style="background:${PHASES[p].color}">${esc(PHASES[p].name.split("·")[0])}</span>`).join(" ")}</td>
      <td>${[...m.ch].map((c) => esc(CHAPTERS.find((x) => x.id === c).name)).join(", ") || (m.papers ? m.papers + " PYQ papers" : "") || (m.mocks ? m.mocks + " mocks" : "Revision")}</td>
    </tr>`).join("");

  // day list
  const per = 14;
  const start = ui.planPage * per;
  const slice = pr.days.slice(start, start + per);
  const dayRows = slice.map((d) => {
    const ph = PHASES[d.phase] || PHASES.p1;
    const lines = d.blocks.map((bl) => {
      if (bl.tasks) return bl.tasks.map((tk) => {
        const l = LEAF[tk.leafId];
        const steps = leafWork(l, tk.a, tk.b).map((x) => x.text).join(" · ");
        return `<div class="ln">• <b>${esc(l.name)}</b> <span class="muted">(${Math.round(tk.b - tk.a)} min)</span> — ${esc(steps)}</div>`;
      }).join("");
      return `<div class="ln">• ${esc(bl.title)} <span class="muted">(${Math.round(bl.mins)} min)</span></div>`;
    }).join("");
    return `<div class="day ${d.date === todayStr() ? "today" : ""}"><h4>${fmtDate(d.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
      <span class="badge phase" style="background:${ph.color}">${esc(d.kind)}</span></h4>${lines}</div>`;
  }).join("");

  return `
  <div class="card">
    <h2>Full plan (${+(s.perDay / 60).toFixed(1)} hrs/day) — auto-adjusts to your real progress</h2>
    <p class="meta">Ye plan roz tumhari actual progress se dobara calculate hota hai. Ek din miss hua to plan khud aage khisak jayega — planning tumhe nahi karni.</p>
    <div class="grid g4">
      <div class="stat"><span class="l">Total new-content time</span><span class="v">${Math.round(totalH)} h</span><span class="l">${Object.values(t).reduce((x, y) => x + y.qs, 0)} questions</span></div>
      <div class="stat"><span class="l">Phase 1 ends (syllabus)</span><span class="v">${pr.p1End ? fmtDate(pr.p1End, { month: "short", year: "numeric" }) : "✓ done"}</span></div>
      <div class="stat"><span class="l">PYQ papers phase</span><span class="v">${pr.p2Start ? fmtDate(pr.p2Start, { month: "short", year: "numeric" }) : "—"}</span></div>
      <div class="stat"><span class="l">Mocks phase ends</span><span class="v">${pr.p3End ? fmtDate(pr.p3End, { month: "short", year: "numeric" }) : "—"}</span></div>
    </div>
    <div class="${warnLate ? "warnbox" : "infobox"}" style="margin-top:10px">
      ${sylDone ? `✓ ${+(s.perDay / 60).toFixed(1)} hrs/day pe syllabus <b>${fmtDate(pr.p1End)}</b> tak poora. Exam (${fmtDate(s.examDate)}) se pehle: <b>${papersBefore} PYQ papers + ~${mocksBefore} full mocks</b> + last 14 din final revision.` : `⚠ ${+(s.perDay / 60).toFixed(1)} hrs/day pe syllabus exam (${fmtDate(s.examDate)}) se pehle poora nahi hoga (projected ${pr.p1End ? fmtDate(pr.p1End) : "—"}).`}
      ${warnLate ? " Mocks kam pad rahe hain — roz ka time badhao (Settings) ya weekends pe extra 🍅 lagao (Today → +25 min)." : ""}
      <span class="meta">Exam date approx hai — official notification aate hi Settings me update karo, plan apne aap adjust hoga.</span>
    </div>
  </div>

  <div class="grid g2" style="margin-top:14px">
    <div class="card">
      <h3>Daily template (${s.perDay} min)</h3>
      <table>
        <tr><th>Block</th><th>Time</th><th>Kya</th></tr>
        <tr><td>🍅 Start</td><td>${b.speed}+${b.rev} min</td><td>Speed drill + spaced revision (due list, 1 tough, mistakes)</td></tr>
        <tr><td>🍅 Maths</td><td>${b.maths} min</td><td>Maths new: NCERT lecture → NCERT exercise → JEE Main PYQs → NIMCET PYQs</td></tr>
        <tr><td>🍅 2nd subject</td><td>${b.sec} min</td><td>Mon/Wed/Fri Reasoning · Tue/Thu Computer · Sat English</td></tr>
        <tr><td>End</td><td>${b.recap} min</td><td>Blurting recap + tracker update</td></tr>
        <tr><td>Breaks</td><td>${b.breaks} min</td><td>5 min har pomodoro ke baad (phone nahi, paani + walk)</td></tr>
      </table>
    </div>
    <div class="card">
      <h3>Weekly template</h3>
      <table>
        <tr><th>Day</th><th>Plan</th></tr>
        <tr><td>Mon–Sat</td><td>Study day (upar wala template)</td></tr>
        <tr><td>Sunday</td><td>Weekly revision: hafte ke subtopics ${Math.round(50 * s.perDay / 120)} · mistakes ${Math.round(25 * s.perDay / 120)} · ${b.big ? 40 : 20} mixed timed Qs ${Math.round(25 * s.perDay / 120)} · formula sheet ${Math.round(10 * s.perDay / 120)} min</td></tr>
        <tr><td>Last Sunday</td><td>Monthly test: ${b.big ? 60 : 30} Qs timed + analysis</td></tr>
        <tr><td>Phase 2</td><td>${b.big ? "Ek din me: PYQ paper + analysis + fix" : "Paper day ↔ analysis day"} (${MOCK_PLAN.reservedPyqYears.join(", ")} papers reserved — inhe topic-wise practice me mat use karna)</td></tr>
        <tr><td>Phase 3/4</td><td>${b.big ? "Din 1: mock + analysis + fix · Din 2: revision + mixed practice" : "Mock → analysis + fix → revision day (3-day cycle)"}</td></tr>
        <tr><td>Last 14 days</td><td>Final revision + mock every 2nd day</td></tr>
      </table>
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <h3>Month-by-month roadmap</h3>
    <div class="scroll-x"><table><tr><th>Month</th><th>Phase</th><th>Chapters / focus</th></tr>${monthRows}</table></div>
  </div>

  <div class="card" style="margin-top:14px">
    <h3>Day-by-day schedule</h3>
    <div class="pager">
      <button class="btn" data-act="planPage" data-d="-1" ${ui.planPage === 0 ? "disabled" : ""}>← Prev</button>
      <span class="meta">${fmtDate(slice[0].date)} – ${fmtDate(slice[slice.length - 1].date)}</span>
      <button class="btn" data-act="planPage" data-d="1">Next →</button>
    </div>
    ${examIdx >= 0 ? `<p class="meta">Exam day is day #${examIdx + 1} from today.</p>` : ""}
    ${dayRows}
  </div>`;
}

/* ---------------- SYLLABUS ---------------- */
function leafDetail(l) {
  const p = state.progress[l.id] || { qs: { ncert: 0, prac: 0, pyq: 0 }, mins: 0, conf: 0 };
  const b = bookNames(l);
  const mk = state.mistakes.filter((m) => m.leafId === l.id);
  const st = leafStatus(state, l);
  const qInput = (k, label, target) => target ? `<label class="f">${esc(label)} (target ${target})<input type="number" min="0" value="${p.qs[k] || 0}" data-act="leafQ" data-leaf="${l.id}" data-k="${k}"></label>` : "";
  return `<div class="leaf-detail">
    <dl class="kv">
      <dt>Depth</dt><dd>${badgeDepth(l.d)} ${esc(DEPTH[l.d].text)}${l.d > l.d0 ? ` <b>(NIMCET PYQ me isi level pe poocha gaya — depth badhayi)</b>` : ""}</dd>
      <dt>NEED ✔</dt><dd>${esc(l.need)}</dd>
      <dt>SKIP ✘</dt><dd>${esc(l.skip || "Depth level se aage mat jao.")}</dd>
      ${l.tip ? `<dt>Trick ⚡</dt><dd>${esc(l.tip)}</dd>` : ""}
      <dt>Weightage</dt><dd>~${l.w} Q/paper (PYQ-trend estimate ${l.w0} aur asli papers ka average blend — ${PYQ_PAPERS.map((p) => `${p.year}: ${l.y26 ? l.y26.byYear[p.year] || 0 : 0} Q`).join(", ")})</dd>
      <dt>Targets</dt><dd>${l.target.ncert ? `NCERT ${l.target.ncert} · ` : ""}${esc(b.prac)} ${l.target.prac} · NIMCET PYQ ${l.target.pyq} · time ~${Math.round(l.mins)} min</dd>
      <dt>Think rule</dt><dd>${DEPTH[l.d].think} min socho → hint → ${DEPTH[l.d].think} min retry → solution → ⟳ re-solve list</dd>
      <dt>Resources</dt><dd>${esc(l.ch.ncert ? l.ch.ncert + " · " : "")}${esc(l.ch.obj)}</dd>
    </dl>
    ${l.y26 ? `<div class="infobox" style="margin-top:10px"><b>NIMCET PYQs me ${l.y26.n} question (${PYQ_PAPERS.map((p) => `${p.year}: ${l.y26.byYear[p.year] || 0}`).join(", ")}):</b>
      <ul style="margin:4px 0">${PYQ_ALL.filter((q) => q.leaf === l.id).map((q) => `<li><b>${q.year} · ${esc(q.secName.split(" ")[0])} Q${q.paperQ}</b> (${esc(DEPTH[q.d].short)}) — ${esc(q.key)}</li>`).join("")}</ul>
      <button class="btn small primary" data-pact="practiceLeaf" data-leaf="${l.id}">▶ Ye questions practice karo</button></div>` : ""}
    <div class="form" style="margin-top:10px">
      ${qInput("ncert", "NCERT solved", l.target.ncert)}
      ${qInput("prac", b.prac + " solved", l.target.prac)}
      ${qInput("pyq", "NIMCET PYQs solved", l.target.pyq)}
      <label class="f">Confidence (1–5)<select data-act="leafConf" data-leaf="${l.id}">${[0, 1, 2, 3, 4, 5].map((c) => `<option value="${c}" ${p.conf === c ? "selected" : ""}>${c || "—"}</option>`).join("")}</select></label>
      <label class="f">Status<select data-act="leafStatus" data-leaf="${l.id}">
        ${[["", "Auto (" + st + ")"], ["todo", "Not started"], ["doing", "In progress"], ["done", "Completed"], ["mastered", "Mastered"]].map(([v, t]) => `<option value="${v}" ${(p.status || "") === v ? "selected" : ""}>${t}</option>`).join("")}
      </select></label>
    </div>
    <label class="f" style="margin-top:10px">Meri notes — kaha galti hoti hai / kya yaad rakhna hai<textarea data-act="leafNotes" data-leaf="${l.id}" placeholder="e.g. domain check bhool jata hu log equations me">${esc(p.notes || "")}</textarea></label>
    <div class="row" style="margin-top:8px">
      <button class="btn primary small" data-act="copyLeafPrompt" data-leaf="${l.id}">📋 Claude teach prompt</button>
      <button class="btn small" data-act="copyHint" data-leaf="${l.id}">📋 Hint-only prompt</button>
      <button class="btn small" data-act="quickMistake" data-leaf="${l.id}">+ Mistake</button>
      <span class="meta">Minutes done: ${Math.round(p.mins || 0)}/${Math.round(l.mins)} · Revisions: ${(p.rev && p.rev.count) || 0}${p.rev ? " · next " + fmtDate(p.rev.due) : ""} · Mistakes: ${mk.length}</span>
    </div>
  </div>`;
}

function pyq26Analysis() {
  const years = PYQ_PAPERS.map((p) => p.year);
  const cnt = (p, pred) => p.qs.filter(pred).length;
  const rows = SUBJECTS.map((s) => {
    const chs = CHAPTERS.filter((c) => c.subject === s.id).map((c) => ({
      c, per: PYQ_PAPERS.map((p) => cnt(p, (q) => LEAF[q.leaf] && LEAF[q.leaf].ch === c)),
      d: [1, 2, 3].map((k) => PYQ_ALL.filter((q) => LEAF[q.leaf] && LEAF[q.leaf].ch === c && q.d === k).length),
    })).filter((r) => r.per.some(Boolean)).sort((a, b) => b.per.reduce((x, y) => x + y, 0) - a.per.reduce((x, y) => x + y, 0));
    return `<tr><td colspan="${years.length + 2}" style="color:${s.color}"><b>${esc(s.name)}</b></td></tr>` +
      chs.map((r) => `<tr><td>${esc(r.c.name)}</td>${r.per.map((n) => `<td><b>${n}</b></td>`).join("")}<td class="meta">D1 ${r.d[0]} · D2 ${r.d[1]} · D3 ${r.d[2]}</td></tr>`).join("");
  }).join("");
  const oos = PYQ_ALL.filter((q) => q.oos);
  const oosBy = {};
  oos.forEach((q) => { oosBy[q.oos] = (oosBy[q.oos] || 0) + 1; });
  return `<details class="chapter" ${ui.openCh.has("pyq26") ? "open" : ""} data-ch="pyq26">
    <summary><span class="name">📊 NIMCET ${years.join(" + ")} paper analysis (asli papers, answers verified)</span><span class="badge">${PYQ_ALL.length} Q</span></summary>
    <div class="body">
      <ul>
        <li><b>Maths:</b> 2025 me Trigonometry (heights & distances 5 Q!), Calculus aur Coordinate geometry; 2026 me Sets + Logic + Functions (9). Dono saal P&C/Binomial kam (1–4). Level zyada tar D1–D2; D3 ~7 per paper (matrix tricks, AP systems, hyperbola, Leibniz).</li>
        <li><b>Syllabus change:</b> 2025 me Vectors (6 Q), Normal/Poisson distribution aur C programming, pipelining, compiler, microprogramming jaise Computer Q aaye the — revised 2026 syllabus me ye nahi hain aur 2026 paper me bhi nahi aaye. Ye ${oos.length} questions "🚫 Out of syllabus" set me hain.</li>
        <li><b>Naye topics (2026):</b> Mathematical logic, symmetric difference, moments/kurtosis; Computer me Software + Internet + Email + OS (2026: 9 Q).</li>
        <li><b>Reasoning:</b> numerical reasoning (%, ratio, ages, averages, SI/CI) dono saal sabse zyada; syllogism + critical reasoning; series aur coding with alternating shifts; 1 tough puzzle har saal.</li>
        <li><b>English:</b> SVA, tenses (stative verbs, past perfect), articles by sound, idioms/phrasal verbs, synonyms/antonyms, 1–2 RC.</li>
      </ul>
      <div class="scroll-x"><table><tr><th>Chapter</th>${years.map((y) => `<th>${y}</th>`).join("")}<th>Level (dono saal)</th></tr>${rows}</table></div>
      <p class="meta"><b>Out of syllabus (2025):</b> ${Object.entries(oosBy).map(([k, v]) => `${esc(k)} ${v}`).join(" · ")}</p>
      <p class="meta">2026 Q107 (Computer Q17) ki official key galat lagti hai — practice me verified answer use hota hai. Flawed/ambiguous questions pe practice me ⚠ note dikhega.</p>
      <div class="row"><button class="btn small primary" data-pact="fullPaper" data-year="2026">▶ 2026 paper</button><button class="btn small primary" data-pact="fullPaper" data-year="2025">▶ 2025 paper</button></div>
    </div></details>`;
}

function renderSyllabus() {
  const f = ui.synFilter;
  const t = totals();
  let html = `<div class="card">
    <h2>Full syllabus — chapter → topic → subtopic</h2>
    <p class="meta">Har subtopic pe: depth (D1/D2/D3), NEED/SKIP, estimated weightage, question targets (NCERT / JEE Main PYQ / NIMCET PYQ), think-time rule, tricks. ★ = tough (revision me baar-baar aayega). Weightage PYQ trends se estimate hai — official NIMCET notification se syllabus ek baar zaroor match karo.</p>
    <div class="row">
      <select data-act="synSub"><option value="">All subjects</option>${SUBJECTS.map((s) => `<option value="${s.id}" ${f.sub === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      <select data-act="synStatus"><option value="">Any status</option>${[["todo", "Not started"], ["doing", "In progress"], ["done", "Completed"], ["mastered", "Mastered"]].map(([v, n]) => `<option value="${v}" ${f.status === v ? "selected" : ""}>${n}</option>`).join("")}</select>
      <label class="row"><input type="checkbox" data-act="synTough" ${f.tough ? "checked" : ""}> Only ★ tough</label>
      <input type="search" placeholder="Search subtopic…" value="${esc(f.q)}" data-act="synQ" style="flex:1;min-width:160px">
      <button class="btn small" data-act="expandAll">Expand all</button>
      <button class="btn small" data-act="collapseAll">Collapse</button>
    </div>
    <div class="grid g4" style="margin-top:10px">${SUBJECTS.map((s) => `<div class="meta"><b style="color:${s.color}">${esc(s.name)}</b><br>${s.qs} Qs × ${s.plus} (−${s.minus}) · ${t[s.id].leaves} subtopics · ~${Math.round(t[s.id].mins / 60)} h · ${t[s.id].qs} practice Qs</div>`).join("")}</div>
  </div>`;

  html += pyq26Analysis();
  for (const s of SUBJECTS) {
    if (f.sub && f.sub !== s.id) continue;
    let chHtml = "";
    for (const ch of CHAPTERS.filter((c) => c.subject === s.id)) {
      const leaves = LEAVES.filter((l) => l.ch === ch).filter((l) => {
        if (f.tough && !(state.progress[l.id] || {}).tough) return false;
        if (f.status && leafStatus(state, l) !== f.status) return false;
        if (f.q && !(l.name + " " + l.topic + " " + ch.name).toLowerCase().includes(f.q.toLowerCase())) return false;
        return true;
      });
      if (!leaves.length) continue;
      const all = LEAVES.filter((l) => l.ch === ch);
      const w = all.reduce((x, l) => x + l.w, 0);
      const done = all.reduce((x, l) => x + Math.min(l.mins, (state.progress[l.id] || {}).mins || 0), 0);
      const tot = all.reduce((x, l) => x + l.mins, 0);
      const open = ui.openCh.has(ch.id) || f.q || f.tough || f.status;
      const y26ch = PYQ_ALL.filter((q) => LEAF[q.leaf] && LEAF[q.leaf].ch === ch);
      let body = `${ch.ncertMap ? `<div class="scroll-x" style="margin-bottom:8px"><table><tr><th>Topic</th><th>NCERT book & chapter</th><th>Edition</th></tr>${ch.ncertMap.map(([t, ref, ed]) => `<tr><td>${esc(t)}</td><td>${esc(ref)}</td><td><span class="badge" style="color:${ed.startsWith("New") ? "var(--good)" : ed.startsWith("Old") ? "var(--warn)" : "var(--muted)"}">${esc(ed)}</span></td></tr>`).join("")}</table></div>` : ""}
        ${y26ch.length ? `<div class="meta"><b>NIMCET PYQs:</b> ${PYQ_PAPERS.map((p) => `${p.year}: ${y26ch.filter((q) => q.year === p.year).length}`).join(" · ")} questions (D1 ${y26ch.filter((q) => q.d === 1).length} · D2 ${y26ch.filter((q) => q.d === 2).length} · D3 ${y26ch.filter((q) => q.d === 3).length})</div>` : ""}
        <div class="meta"><b>Resources:</b> ${esc(ch.obj)}</div>
        ${ch.prereq.length ? `<div class="meta"><b>Pehle ye aana chahiye:</b> ${ch.prereq.map(esc).join(" · ")}</div>` : ""}
        <div class="meta"><b>Speed tricks:</b><ul style="margin:2px 0">${ch.speed.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
      let lastTopic = "";
      for (const l of leaves) {
        if (l.topic !== lastTopic) { body += `<div class="topic">${esc(l.topic)}</div>`; lastTopic = l.topic; }
        const p = state.progress[l.id] || {};
        const st = leafStatus(state, l);
        body += `<div class="leaf">
          <div class="leaf-head" data-act="toggleLeaf" data-leaf="${l.id}">
            <span class="dot ${st}"></span>
            <span class="nm">${esc(l.name)}</span>
            ${l.y26 ? `<span class="badge" style="color:var(--bad)" title="${PYQ_PAPERS.map((p) => `${p.year}: ${l.y26.byYear[p.year] || 0}`).join(", ")}">PYQ: ${l.y26.n}Q</span>` : ""} ${badgeW(l.w)} ${badgeDepth(l.d)}
            <button class="star ${p.tough ? "on" : ""}" data-act="toggleTough" data-leaf="${l.id}" title="Mark tough">★</button>
          </div>
          <div class="bar" style="margin:6px 0 0 18px;height:4px"><span style="width:${pct(p.mins || 0, l.mins)}%;background:${s.color}"></span></div>
          ${ui.openLeaf === l.id ? leafDetail(l) : ""}
        </div>`;
      }
      chHtml += `<details class="chapter" data-ch="${ch.id}" ${open ? "open" : ""}>
        <summary><span class="name">${esc(ch.id)} · ${esc(ch.name)}</span>${y26ch.length ? `<span class="badge" style="color:var(--bad)">PYQ: ${y26ch.length}Q</span>` : ""}<span class="badge w">~${w.toFixed(1)} Q</span><span class="badge">${pct(done, tot)}%</span></summary>
        <div class="body">${body}</div></details>`;
    }
    if (chHtml) html += `<h2 style="margin:18px 0 8px;color:${s.color}">${esc(s.name)}</h2>${chHtml}`;
  }
  return html;
}

/* ---------------- REVISION ---------------- */
function renderRevision() {
  const today = todayStr();
  const due = dueRevisions(state, today);
  const upcoming = [];
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, i);
    const n = LEAVES.filter((l) => { const p = state.progress[l.id]; return p && p.rev && p.rev.due === d; }).length;
    const m = state.mistakes.filter((x) => !x.resolved && x.due === d).length;
    upcoming.push({ d, n, m });
  }
  const dueM = dueMistakes(state, today);
  return `
  <div class="grid g2">
    <div class="card">
      <h2>Due today (${due.length} subtopics · ${dueM.length} mistakes)</h2>
      <p class="meta">Today tab ka P1 inme se top items leta hai (tough + overdue + low confidence pehle). Time ho to yaha se aur clear karo.</p>
      ${due.length ? due.map((l) => {
        const p = state.progress[l.id];
        return `<div class="task"><div class="tx"><b>${esc(l.name)}</b> ${p.tough ? `<span class="badge" style="color:var(--bad)">★ tough</span>` : ""}
          <div class="meta">${esc(l.ch.name)} · stage ${p.rev.stage} · due ${fmtDate(p.rev.due)} · conf ${p.conf || "—"}/5</div>
          <div class="rate">${["again", "hard", "good", "easy"].map((r) => `<button class="btn small ${{ again: "bad", hard: "warn", good: "good", easy: "primary" }[r]}" data-act="rateDirect" data-leaf="${l.id}" data-r="${r}">${r[0].toUpperCase() + r.slice(1)}</button>`).join("")}</div></div></div>`;
      }).join("") : `<p class="meta">Kuch due nahi ✓</p>`}
      ${dueM.map((m) => { const l = LEAF[m.leafId]; return `<div class="task"><div class="tx"><b>Re-solve:</b> ${esc(m.ref || "question")} <span class="badge">${esc(m.type)}</span>${m.qid ? ` <button class="btn small primary" data-pact="retry" data-q="${esc(m.qid)}">↻ Dobara solve</button>` : ""}<div class="meta">${l ? esc(l.name) : "General"} · ${esc(m.note)}</div>
        <div class="rate"><button class="btn small good" data-act="mresDirect" data-id="${m.id}" data-r="solved">Solved ✓</button><button class="btn small bad" data-act="mresDirect" data-id="${m.id}" data-r="failed">Failed ✗</button></div></div></div>`; }).join("")}
    </div>
    <div>
      <div class="card">
        <h3>Next 7 days</h3>
        <table><tr><th>Date</th><th>Subtopics</th><th>Mistakes</th></tr>${upcoming.map((u) => `<tr><td>${fmtDate(u.d, { weekday: "short", day: "numeric", month: "short" })}</td><td>${u.n}</td><td>${u.m}</td></tr>`).join("")}</table>
      </div>
      <div class="card">
        <h3>🍅 Revision pomodoro (25 min)</h3>
        <ol class="steps">${REVISION_POMODORO.map((r) => `<li>${esc(r.text)}</li>`).join("")}</ol>
        <p class="meta">Timer me "Revision 25" mode chuno — ye cues khud dikhayega.</p>
        <h3>Rating ka matlab</h3>
        <ul class="clean meta">
          <li><b>Again</b> — bhool gaya → kal wapas, confidence −1</li>
          <li><b>Hard</b> — atak ke yaad aaya → same stage, aadhe gap me wapas</li>
          <li><b>Good</b> — theek yaad → next interval (1-3-7-15-30-60-90)</li>
          <li><b>Easy</b> — turant → 2 stage jump, confidence +1</li>
          <li>★ Tough topics ke intervals chhote: 1-2-4-7-12-20-30-45</li>
        </ul>
      </div>
    </div>
  </div>
  <div class="card" style="margin-top:14px">
    <h3>All revision types (plan me already built-in)</h3>
    <div class="scroll-x"><table><tr><th>Type</th><th>Kab</th><th>Kaise</th></tr>
      ${REVISION_TYPES.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.when)}</td><td>${esc(r.how)}</td></tr>`).join("")}</table></div>
  </div>`;
}

/* ---------------- TOUGH & MISTAKES ---------------- */
function mistakeForm(prefLeaf, mockId) {
  return `<div class="form">
    <label class="f">Subtopic<select id="mkLeaf">${leafOptions(prefLeaf)}</select></label>
    <label class="f">Source<select id="mkSource">${["Practice", "PYQ", "Mock", "Revision", "Monthly test"].map((x) => `<option ${mockId && x === "Mock" ? "selected" : ""}>${x}</option>`).join("")}</select></label>
    <label class="f">Question ref<input id="mkRef" placeholder="e.g. RDS Obj Q23 / Mock 4 Q17"></label>
    <label class="f">Mistake type<select id="mkType">${MISTAKE_TYPES.map((x) => `<option>${esc(x)}</option>`).join("")}</select></label>
  </div>
  <div class="form" style="margin-top:10px;grid-template-columns:1fr 1fr">
    <label class="f">Kya galti hui?<textarea id="mkNote" placeholder="e.g. log equation me domain check nahi kiya"></textarea></label>
    <label class="f">Sahi rule / next time kya karunga<textarea id="mkFix" placeholder="e.g. answer ke baad argument > 0 check"></textarea></label>
  </div>
  <div class="row" style="margin-top:8px"><button class="btn primary" data-act="addMistake" data-mock="${mockId || ""}">Save mistake</button><label class="row meta"><input type="checkbox" id="mkTough"> Is subtopic ko ★ tough bhi mark karo</label></div>`;
}

function renderMistakes() {
  const tough = toughLeaves(state);
  const f = ui.mistakeFilter;
  const list = state.mistakes.filter((m) => (f === "open" ? !m.resolved : f === "resolved" ? m.resolved : true)).slice().reverse();
  const byType = {};
  const byCh = {};
  state.mistakes.filter((m) => !m.resolved).forEach((m) => {
    byType[m.type] = (byType[m.type] || 0) + 1;
    const l = LEAF[m.leafId];
    const k = l ? l.ch.name : "General";
    byCh[k] = (byCh[k] || 0) + 1;
  });
  const bars = (obj) => {
    const max = Math.max(1, ...Object.values(obj));
    return Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><div class="bar"><span style="width:${(v / max) * 100}%"></span></div><span>${v}</span></div>`).join("") || `<p class="meta">No data yet.</p>`;
  };
  return `
  <div class="grid g2">
    <div class="card">
      <h2>★ Tough topics (${tough.length})</h2>
      <p class="meta">Jo topic mushkil lage use ★ mark karo. Ye revision me chhote intervals pe aayega + roz 1 "tough drill" P1 me. Claude prompt me bhi "tough" flag jaata hai (extra visuals + checks).</p>
      <div class="row"><select id="toughAdd" style="flex:1;min-width:0">${leafOptions("")}</select><button class="btn" data-act="addTough">★ Add</button></div>
      ${tough.map((l) => { const p = state.progress[l.id]; return `<div class="task"><div class="tx"><b>${esc(l.name)}</b> <span class="meta">${esc(l.ch.name)}</span>
        <div class="meta">conf ${p.conf || "—"}/5 · ${p.rev ? "next revision " + fmtDate(p.rev.due) : "abhi padhna baaki"} · mistakes ${state.mistakes.filter((m) => m.leafId === l.id && !m.resolved).length}</div>
        <textarea data-act="leafNotes" data-leaf="${l.id}" placeholder="Kyu tough hai? Kaha atakta hu?" style="min-height:50px">${esc(p.notes || "")}</textarea>
        <div class="row"><button class="btn small primary" data-act="copyLeafPrompt" data-leaf="${l.id}">📋 Re-teach prompt</button><button class="btn small" data-act="toggleTough" data-leaf="${l.id}">Remove ★</button></div></div></div>`; }).join("")}
    </div>
    <div class="card">
      <h2>Kaha galti kar raha hu? (analysis)</h2>
      <h3>By type</h3>${bars(byType)}
      <h3 style="margin-top:12px">By chapter</h3>${bars(byCh)}
      <div class="row" style="margin-top:10px"><button class="btn primary" data-act="copyMistakePrompt">📋 Claude: analyse my mistakes</button></div>
    </div>
  </div>
  <div class="card" style="margin-top:14px" id="mistakeFormCard">
    <h2>+ Log a mistake / re-solve question</h2>
    <p class="meta">Har galat ya "solution dekh ke hua" question yaha daalo. Ye 1-3-7-21 din pe bina solution dekhe re-solve ke liye revision me aayega. 4 baar solved → resolved.</p>
    ${mistakeForm(ui.prefLeaf || "", "")}
  </div>
  <div class="card" style="margin-top:14px">
    <div class="row between"><h2>Mistake log (${list.length})</h2>
      <select data-act="mkFilter">${[["open", "Open"], ["resolved", "Resolved"], ["all", "All"]].map(([v, n]) => `<option value="${v}" ${f === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="scroll-x"><table><tr><th>Date</th><th>Subtopic</th><th>Type</th><th>Galti → Sahi</th><th>Next</th><th></th></tr>
      ${list.map((m) => { const l = LEAF[m.leafId]; return `<tr><td>${fmtDate(m.date, { day: "numeric", month: "short" })}</td><td>${l ? esc(l.name) : "General"}<div class="meta">${esc(m.source)} ${esc(m.ref || "")}</div></td><td>${esc(m.type)}</td><td>${esc(m.note)}${m.fix ? `<div class="meta">→ ${esc(m.fix)}</div>` : ""}</td><td>${m.resolved ? "✓" : fmtDate(m.due, { day: "numeric", month: "short" }) + ` (${m.solved || 0}/4)`}</td><td>${m.qid ? `<button class="btn small" data-pact="retry" data-q="${esc(m.qid)}">↻ Dobara solve</button>` : ""}<button class="btn small ghost" data-act="delMistake" data-id="${m.id}">✕</button></td></tr>`; }).join("")}
    </table></div>
  </div>`;
}

/* ---------------- MOCKS ---------------- */
function lineChart(series, maxY) {
  const W = 600, H = 200, P = 30;
  const n = Math.max(2, ...series.map((s) => s.data.length));
  const x = (i) => P + (i * (W - 2 * P)) / (n - 1);
  const y = (v) => H - P - (v / maxY) * (H - 2 * P);
  let g = `<line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="var(--line)"/>`;
  [0, 0.5, 1].forEach((f) => { g += `<text x="2" y="${y(maxY * f) + 4}" font-size="10" fill="var(--muted)">${Math.round(maxY * f)}</text><line x1="${P}" x2="${W - P}" y1="${y(maxY * f)}" y2="${y(maxY * f)}" stroke="var(--line)" stroke-dasharray="3 4"/>`; });
  for (const s of series) {
    const pts = s.data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" points="${pts}"/>`;
    s.data.forEach((v, i) => { g += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${s.color}"><title>${esc(s.name)}: ${v}</title></circle>`; });
  }
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg></div>`;
}

function mockInsights(m) {
  const sc = mockScore(m);
  const out = [];
  let neg = 0;
  for (const s of SUBJECTS) {
    const x = sc.secs[s.id];
    neg += x.wrong * s.minus;
    if (x.att && x.acc < 80) out.push(`${s.name}: accuracy ${x.acc}% (<80%). ${x.wrong} galat → −${x.wrong * s.minus} negative + ${x.wrong * s.plus} marks jo mil sakte the = ${x.lost} ka farak. Guessing kam karo.`);
    if (s.id === "M" && x.time > 70) out.push(`Maths me ${x.time} min — 70 min limit. Pass-1 me sirf sure-shot Qs.`);
    if (s.id === "R" && x.time > 30) out.push(`Reasoning ${x.time} min — 30 min limit (45 sec/Q).`);
    if (x.att && x.att < s.qs * 0.6 && x.acc >= 90) out.push(`${s.name}: accuracy ${x.acc}% achhi hai par attempts kam (${x.att}/${s.qs}) — speed par kaam karo.`);
  }
  if (neg) out.push(`Negative marking se total ${neg} marks gaye.`);
  if (m.skipped) out.push(`${m.skipped} questions skip kiye jo aa sakte the → Pass-2 strategy + time management.`);
  return out;
}

function renderMocks() {
  const mocks = state.mocks;
  const last = mocks[mocks.length - 1];
  const chart = mocks.length ? lineChart([{ name: "Total", color: "var(--accent)", data: mocks.map((m) => mockScore(m).total) }], Math.max(200, ...mocks.map((m) => mockScore(m).total))) : `<p class="meta">Pehla mock add karo — graph yaha aayega.</p>`;
  const accChart = mocks.length ? lineChart(SUBJECTS.map((s) => ({ name: s.name, color: s.color, data: mocks.map((m) => mockScore(m).secs[s.id].acc) })), 100) : "";
  return `
  <div class="grid g2">
    <div class="card">
      <h2>+ Add mock / PYQ paper</h2>
      <div class="form">
        <label class="f">Name<input id="mkName" placeholder="Mock 1 / NIMCET 2023"></label>
        <label class="f">Date<input type="date" id="mkDate" value="${todayStr()}"></label>
        <label class="f">Type<select id="mkKind"><option value="mock">Mock</option><option value="pyq">PYQ paper</option></select></label>
      </div>
      <div class="scroll-x" style="margin-top:10px"><table><tr><th>Section</th><th>Attempted</th><th>Correct</th><th>Time (min)</th></tr>
        ${SUBJECTS.map((s) => `<tr><td>${esc(s.name.split(" ")[0])} <span class="meta">/${s.qs}</span></td><td><input type="number" min="0" max="${s.qs}" id="mk_${s.id}_att"></td><td><input type="number" min="0" max="${s.qs}" id="mk_${s.id}_cor"></td><td><input type="number" min="0" id="mk_${s.id}_time"></td></tr>`).join("")}
      </table></div>
      <div class="form" style="margin-top:10px">
        <label class="f">Skipped but could solve<input type="number" min="0" id="mkSkipped"></label>
      </div>
      <label class="f" style="margin-top:10px">Notes (feel, strategy, kya galat hua)<textarea id="mkNotes"></textarea></label>
      <button class="btn primary" data-act="addMock" style="margin-top:8px">Save & analyse</button>
    </div>
    <div class="card">
      <h2>Mock analysis checklist (60 min)</h2>
      <ol class="steps">
        <li>Score + section-wise accuracy (auto, neeche).</li>
        <li>Har <b>galat</b> Q: reason type choose karo → Mistake log (Tough & Mistakes tab).</li>
        <li>Har <b>skipped</b> Q: bina time limit solve karo. Ho gaya → "Skipped but could solve".</li>
        <li>Har <b>sahi par slow</b> (&gt;2 min) Q: faster method dhundo (Claude se pucho).</li>
        <li>Top 2 weak subtopics → ★ tough + agle din "fix" block me 15 Qs each.</li>
        <li>Section time: plan vs actual. Next mock ke liye 3 rules likho.</li>
        <li>Claude "Mock analysis" prompt se second opinion.</li>
      </ol>
      <h3>3-pass strategy</h3>
      <ul class="clean meta">
        <li><b>Pass 1</b> — sure-shot, &lt;1 min wale. Sab sections me.</li>
        <li><b>Pass 2</b> — medium, 1–2 min wale.</li>
        <li><b>Pass 3</b> — hard, sirf agar time bacha. Guess only after eliminating 2 options.</li>
      </ul>
    </div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Score trend (/1000)</h3>${chart}</div>
    <div class="card"><h3>Section accuracy %</h3>${accChart || `<p class="meta">—</p>`}<div class="row meta">${SUBJECTS.map((s) => `<span><span class="dot" style="display:inline-block;background:${s.color}"></span> ${esc(s.name.split(" ")[0])}</span>`).join(" ")}</div></div>
  </div>
  ${last ? `<div class="card" style="margin-top:14px">
    <div class="row between"><h2>Latest: ${esc(last.name)} — ${mockScore(last).total}/1000</h2><button class="btn primary" data-act="copyMockPrompt">📋 Claude mock analysis prompt</button></div>
    <ul>${mockInsights(last).map((x) => `<li>${esc(x)}</li>`).join("") || "<li>Solid mock 👍</li>"}</ul>
    <h3>Is mock ki mistakes add karo</h3>
    ${mistakeForm("", last.id)}
  </div>` : ""}
  <div class="card" style="margin-top:14px">
    <h3>All mocks</h3>
    <div class="scroll-x"><table><tr><th>Date</th><th>Name</th><th>Total</th>${SUBJECTS.map((s) => `<th>${esc(s.name.split(" ")[0])}</th>`).join("")}<th></th></tr>
      ${mocks.slice().reverse().map((m) => { const sc = mockScore(m); return `<tr><td>${fmtDate(m.date, { day: "numeric", month: "short", year: "2-digit" })}</td><td>${esc(m.name)}${m.kind === "pyq" ? ' <span class="badge">PYQ</span>' : ""}</td><td><b>${sc.total}</b></td>${SUBJECTS.map((s) => `<td>${sc.secs[s.id].score} <span class="meta">(${sc.secs[s.id].acc}%)</span></td>`).join("")}<td><button class="btn small ghost" data-act="delMock" data-id="${m.id}">✕</button></td></tr>`; }).join("")}
    </table></div>
  </div>`;
}

/* ---------------- CLAUDE ---------------- */
function renderClaude() {
  const leaf = LEAF[ui.promptLeaf] || LEAVES.find((l) => remainingMins(state, l) > 0) || LEAVES[0];
  const p = state.progress[leaf.id];
  const mk = state.mistakes.filter((m) => m.leafId === leaf.id);
  return `
  <div class="card">
    <h2>Claude se kaise padhna hai</h2>
    <ol class="steps">
      <li><b>Ek baar:</b> claude.ai pe ek Project banao "NIMCET Rank 1" → neeche wala <b>Master prompt</b> Project instructions me paste karo.</li>
      <li><b>Har naye subtopic pe:</b> Today tab me "📋 Claude teach prompt" dabao → Project me nayi chat → paste. Isme depth, NEED/SKIP, weightage, tumhari galtiyaan sab hota hai — na upar-upar se, na zarurat se zyada deep.</li>
      <li>Claude chunks me padhayega (story → what → why → how → when → interactive visual → check question) aur tumhare jawab ka wait karega.</li>
      <li>End me Claude "Learning profile update" dega → neeche <b>My learning profile</b> me add karo. Next prompts automatically usko include karenge.</li>
      <li>Practice me atke → "Hint-only prompt" (solution nahi, hint ladder).</li>
    </ol>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card">
      <h3>My learning profile</h3>
      <p class="meta">Tum kaise jaldi samajhte ho — Claude isi hisaab se padhayega. Har session ke baad update karo.</p>
      <textarea id="profile" style="min-height:180px">${esc(state.settings.profile)}</textarea>
      <button class="btn primary" data-act="saveProfile" style="margin-top:6px">Save profile</button>
    </div>
    <div class="card">
      <h3>Quick prompts</h3>
      <div class="stack">
        <button class="btn" data-act="copyMaster">📋 Master prompt (Project instructions)</button>
        <button class="btn" data-act="copyHint" data-leaf="">📋 Hint-only prompt</button>
        <button class="btn" data-act="copyMistakePrompt">📋 Analyse my mistakes</button>
        <button class="btn" data-act="copyMockPrompt">📋 Analyse latest mock</button>
        <button class="btn" data-act="copyWeekly">📋 Weekly review</button>
      </div>
    </div>
  </div>
  <div class="card" style="margin-top:14px">
    <h3>Subtopic teach prompt</h3>
    <div class="row"><select data-act="promptLeaf" style="flex:1;min-width:0">${leafOptions(leaf.id)}</select><button class="btn primary" data-act="copyLeafPrompt" data-leaf="${leaf.id}">📋 Copy</button></div>
    <pre class="prompt">${esc(subtopicPrompt(leaf, p, state.settings.profile, mk))}</pre>
  </div>`;
}

/* ---------------- SPEED KIT ---------------- */
function renderSpeed() {
  const lv = ["Not started", "Learning", "Fast", "Instant"];
  return `
  <div class="card">
    <h2>Speed Kit — pehle ye aana chahiye</h2>
    <p class="meta">Roz P1 ke pehle 5 min: ek item drill karo. Target: sab "Instant". NIMCET me Maths ke liye ~84 sec/Q aur Reasoning ke liye ~45 sec/Q milte hain — speed yahi se aati hai.</p>
    ${SPEED_KIT.map((k) => { const v = state.speedKit[k.id] || 0; return `<div class="task"><div class="tx"><b>${esc(k.name)}</b><div class="meta">${esc(k.how)}</div>
      <div class="rate">${lv.map((n, i) => `<button class="btn small ${v === i ? "primary" : ""}" data-act="speedLv" data-id="${k.id}" data-v="${i}">${n}</button>`).join("")}</div></div></div>`; }).join("")}
  </div>
  <div class="card">
    <h2>Problem-solving protocol (har question pe)</h2>
    <div class="grid g2">${PROTOCOL.map((p) => `<div class="card soft"><h3>${esc(p.level)} <span class="badge">${esc(p.think)}</span></h3><ol class="steps">${p.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>`).join("")}</div>
  </div>
  <div class="card">
    <h2>Chapter-wise speed tricks</h2>
    ${CHAPTERS.map((c) => `<details class="chapter"><summary><span class="name">${esc(c.id)} · ${esc(c.name)}</span></summary><div class="body"><ul>${c.speed.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${c.prereq.length ? `<div class="meta"><b>Prerequisites:</b> ${c.prereq.map(esc).join(" · ")}</div>` : ""}</div></details>`).join("")}
  </div>`;
}

/* ---------------- GUIDE ---------------- */
function renderGuide() {
  const t = totals();
  return `
  <div class="card">
    <h2>Roz kya karna hai (bas itna)</h2>
    <ol class="steps">
      <li>Tracker kholo → <b>Today</b> tab. Timer start karo.</li>
      <li>Blocks upar se neeche karo. Har task me likha hai: kaunsi book, kaunsa subtopic, kitne questions (Q range), kitna time, think rule.</li>
      <li>Naya subtopic → "📋 Claude teach prompt" → Claude se padho → fir book ke questions.</li>
      <li>Task complete → ✔ tick. Galat/atka question → "+ Mistake". Mushkil laga → "★ Tough".</li>
      <li>Revision items → rating do (Again/Hard/Good/Easy). Tracker agla revision khud schedule karega.</li>
      <li>Sunday → weekly revision. Mahine ka last Sunday → monthly test.</li>
    </ol>
    <p class="meta">Planning tracker karta hai. Tum sirf padhai karo. Miss hua din → plan khud adjust.</p>
  </div>
  <div class="card">
    <h2>Resource order har subtopic me</h2>
    <p class="meta">Sirf ye resources: <b>NCERT lecture + exercises</b>, <b>JEE Main PYQs</b>, <b>NIMCET PYQs</b>, <b>test series</b>. Koi extra book nahi.</p>
    <ol class="steps">
      <li><b>NCERT lecture</b> — concept (doubt ho to "📋 Claude teach prompt"). Jo topic NCERT me nahi (logic, logs, pair of lines, properties of triangles) wo lecture/Claude se.</li>
      <li><b>NCERT exercise</b> — us subtopic ke relevant questions (count task me likha hai). Base pakka.</li>
      <li><b>JEE Main PYQs</b> — topic-wise, MCQ level practice. Sirf NIMCET syllabus wale subtopics.</li>
      <li><b>NIMCET PYQs (topic-wise)</b> — purane saal. ${MOCK_PLAN.reservedPyqYears.join(", ")} ke papers Phase 2 ke full-length tests ke liye bacha ke rakho.</li>
      <li><b>Test series</b> — Reasoning / Computer / English ke topic tests, aur Phase 3 me full mocks.</li>
    </ol>
    <p class="meta">Syllabus: ${esc(SYLLABUS_VERSION)}.</p>
  </div>
  <div class="card">
    <h2>Books (Reasoning, Aptitude, Computer, English)</h2>
    <p class="meta">Maths: sirf NCERT (lecture + exercise) + JEE Main PYQs + NIMCET PYQs — Syllabus tab me har chapter ka NCERT table (class, chapter, new/old edition). Baaki sections ke liye ye books, NIMCET 2025 + 2026 syllabus ke hisaab se chapters:</p>
    <div class="scroll-x"><table><tr><th>Section</th><th>Book & edition</th><th>Kaunse chapters</th></tr>
      ${BOOK_PLAN.map((b) => `<tr><td><b>${esc(b.sub)}</b></td><td>${esc(b.book)}</td><td>${esc(b.chapters)}</td></tr>`).join("")}
    </table></div>
    <p class="meta">Chapter names book ke index se match karo — numbering edition ke hisaab se alag ho sakti hai. Har chapter ke baad NIMCET PYQs (Practice tab) + test series ke topic tests.</p>
  </div>
  <div class="card">
    <h2>Depth levels</h2>
    ${[1, 2, 3].map((d) => `<p>${badgeDepth(d)} ${esc(DEPTH[d].text)} <span class="meta">Think time: ${DEPTH[d].think} min.</span></p>`).join("")}
  </div>
  <div class="card">
    <h2>Numbers behind the plan</h2>
    <table><tr><th>Subject</th><th>Paper</th><th>Subtopics</th><th>Practice Qs</th><th>Time</th></tr>
    ${SUBJECTS.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.qs} Q × ${s.plus} (−${s.minus})</td><td>${t[s.id].leaves}</td><td>${t[s.id].qs}</td><td>~${Math.round(t[s.id].mins / 60)} h</td></tr>`).join("")}
    </table>
    <p class="meta">Exam: 120 MCQs, 1000 marks, 2 hr, CBT. Section timers: Maths 70 min · Reasoning 30 min · Computer + English 20 min. 25% negative marking.</p>
  </div>
  <div class="card warnbox">
    <h3>Honest note</h3>
    <p>100% marks ki guarantee koi plan nahi de sakta — exam day pe paper, nerves aur competition bhi matter karte hain. Ye plan tumhe rank 1 ke <b>level ki preparation</b> tak le jaane ke liye bana hai: revised 2026 syllabus sahi depth pe, ~${Object.values(t).reduce((x, y) => x + y.qs, 0)} practice Qs (NCERT + JEE Main PYQ + NIMCET PYQ + test series), spaced revision, 6 PYQ papers + 30 mocks. Weightage numbers PYQ trends se estimate hain, official nahi. Har saal official notification (nimcet.admissions.nic.in) se syllabus aur exam date check karo aur Settings me dates update karo.</p>
  </div>`;
}

/* ---------------- SETTINGS ---------------- */
function renderSettings() {
  const s = state.settings;
  return `
  <div class="card">
    <h2>Settings</h2>
    <div class="form">
      <label class="f">Study minutes per day<input type="number" min="60" max="360" step="15" id="setPerDay" value="${s.perDay}" style="width:auto"></label>
      <label class="f">Weekly revision day<select id="setRest">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => `<option value="${i}" ${s.restDay === i ? "selected" : ""}>${d}</option>`).join("")}</select></label>
      <label class="f">Dry-run exam date (optional)<input type="date" id="setDry" value="${s.dryRunDate}"></label>
      <label class="f">Target exam date (NIMCET 2027)<input type="date" id="setExam" value="${s.examDate}"></label>
    </div>
    <p class="meta">Dates official notification aane pe update karo (NIMCET aam taur pe June me hota hai).</p>
    <button class="btn primary" data-act="saveSettings">Save settings</button>
  </div>
  <div class="card">
    <h2>Backup</h2>
    <p class="meta">${cloud.ref ? "Data tumhare claude.ai account me private save hota hai (sirf tum dekh sakte ho) — phone aur laptop dono pe same link kholo." : "Data sirf is browser me save hota hai."} Fir bhi har hafte backup lo.</p>
    <div class="row">
      <button class="btn" data-act="export">⬇ Export JSON</button>
      <button class="btn" data-act="copyBackup">📋 Copy backup text</button>
      <label class="btn">⬆ Import JSON file<input type="file" id="importFile" accept="application/json" hidden></label>
    </div>
    <label class="f" style="margin-top:10px">Ya backup text yaha paste karke import karo<textarea id="importText" style="min-height:60px"></textarea></label>
    <div class="row" style="margin-top:8px">
      <button class="btn" data-act="importText">Import pasted text</button>
      <button class="btn bad" data-act="reset">Reset everything</button>
    </div>
  </div>`;
}

/* ---------------- render ---------------- */
const VIEWS = { today: renderToday, plan: renderPlan, syllabus: renderSyllabus, revision: renderRevision, mistakes: renderMistakes, mocks: renderMocks, claude: renderClaude, speed: renderSpeed, guide: renderGuide, settings: renderSettings };

function render() {
  renderHeader();
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === ui.tab));
  const y = window.scrollY;
  $("#view").innerHTML = VIEWS[ui.tab]();
  window.scrollTo(0, y);
}
function go(tab) { ui.tab = tab; render(); window.scrollTo(0, 0); }

/* ---------------- events ---------------- */
document.getElementById("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) go(b.dataset.tab);
});

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.tagName === "SELECT" || (el.tagName === "INPUT" && el.type !== "checkbox") || el.tagName === "TEXTAREA") return;
  const a = el.dataset.act;
  const leafId = el.dataset.leaf;
  switch (a) {
    case "check":
      toggleItem(el.dataset.date, +el.dataset.b, +el.dataset.i, el.checked);
      render(); break;
    case "rate": {
      const day = state.days[el.dataset.date];
      const item = day.blocks[+el.dataset.b].items[+el.dataset.i];
      const gap = rateRevision(state, item.leafId, el.dataset.r, todayStr());
      day.checks[`${el.dataset.b}-${el.dataset.i}`] = el.dataset.r;
      save(); toast(`Next revision in ${gap} day(s)`); render(); break;
    }
    case "rateDirect": {
      const gap = rateRevision(state, leafId, el.dataset.r, todayStr());
      save(); toast(`Next revision in ${gap} day(s)`); render(); break;
    }
    case "mres": {
      const day = state.days[el.dataset.date];
      const item = day.blocks[+el.dataset.b].items[+el.dataset.i];
      resolveMistake(item.id, el.dataset.r);
      day.checks[`${el.dataset.b}-${el.dataset.i}`] = el.dataset.r;
      save(); render(); break;
    }
    case "mresDirect": resolveMistake(el.dataset.id, el.dataset.r); save(); render(); break;
    case "toggleTough": {
      e.stopPropagation();
      const p = lp(state, leafId);
      p.tough = !p.tough;
      save(); toast(p.tough ? "★ Tough — revision me zyada aayega" : "Tough hataya"); render(); break;
    }
    case "toggleLeaf": ui.openLeaf = ui.openLeaf === leafId ? null : leafId; render(); break;
    case "openLeaf": {
      e.preventDefault();
      const l = LEAF[leafId];
      ui.openLeaf = leafId; ui.openCh.add(l.ch.id); ui.synFilter = { sub: "", q: "", tough: false, status: "" };
      go("syllabus");
      setTimeout(() => { const n = document.querySelector(`[data-leaf="${leafId}"].leaf-head`); if (n) n.scrollIntoView({ block: "center" }); }, 30);
      break;
    }
    case "quickMistake":
      ui.prefLeaf = leafId; go("mistakes");
      setTimeout(() => { const c = $("#mistakeFormCard"); if (c) c.scrollIntoView({ block: "start" }); }, 30);
      break;
    case "copyLeafPrompt": {
      const l = LEAF[leafId];
      copy(subtopicPrompt(l, state.progress[l.id], state.settings.profile, state.mistakes.filter((m) => m.leafId === l.id)));
      break;
    }
    case "copyHint": copy(hintPrompt(LEAF[leafId])); break;
    case "copyMaster": e.preventDefault(); copy(masterPrompt(state.settings.profile)); break;
    case "copyMistakePrompt": copy(mistakePrompt(state)); break;
    case "copyMockPrompt": copy(mockPrompt(state)); break;
    case "copyWeekly": copy(weeklyPrompt(state)); break;
    case "saveProfile": state.settings.profile = $("#profile").value; save(); toast("Profile saved ✓"); break;
    case "extra": {
      const ch = nextChunk(el.dataset.sub, 25);
      if (!ch) { toast("Is subject ka syllabus complete ✓"); break; }
      const day = ensureDay(todayStr());
      day.blocks.push({ title: `Extra 🍅 — ${subj(el.dataset.sub).name.split(" ")[0]}`, mins: 25, note: "", items: [ch] });
      save(); render(); break;
    }
    case "logManual": addLog(25); toast("+25 min logged"); render(); break;
    case "regen": {
      const day = state.days[todayStr()];
      if (day && Object.values(day.checks).some(Boolean) && !armed(el, "Ticks hat jayenge (progress rahega) — dobara tap")) break;
      delete state.days[todayStr()]; ensureDay(todayStr()); render(); break;
    }
    case "planPage": ui.planPage = Math.max(0, ui.planPage + +el.dataset.d); render(); break;
    case "expandAll": CHAPTERS.forEach((c) => ui.openCh.add(c.id)); render(); break;
    case "collapseAll": ui.openCh.clear(); ui.openLeaf = null; render(); break;
    case "addTough": {
      const id = $("#toughAdd").value;
      if (!id) { toast("Subtopic choose karo"); break; }
      lp(state, id).tough = true; save(); render(); break;
    }
    case "addMistake": {
      const m = {
        id: uid(), date: todayStr(), leafId: $("#mkLeaf").value, source: $("#mkSource").value, ref: $("#mkRef").value.trim(),
        type: $("#mkType").value, note: $("#mkNote").value.trim(), fix: $("#mkFix").value.trim(),
        stage: 0, due: addDays(todayStr(), 1), solved: 0, resolved: false, mockId: el.dataset.mock || "",
      };
      if (!m.note) { toast("Kya galti hui — likho"); break; }
      if ($("#mkTough").checked && m.leafId) lp(state, m.leafId).tough = true;
      state.mistakes.push(m); ui.prefLeaf = m.leafId;
      save(); toast("Mistake saved — kal re-solve ke liye aayega"); render(); break;
    }
    case "delMistake": if (armed(el, "Delete?")) { state.mistakes = state.mistakes.filter((m) => m.id !== el.dataset.id); save(); render(); } break;
    case "addMock": {
      const m = { id: uid(), name: $("#mkName").value.trim() || `Mock ${state.mocks.length + 1}`, date: $("#mkDate").value || todayStr(), kind: $("#mkKind").value, sections: {}, skipped: +$("#mkSkipped").value || 0, notes: $("#mkNotes").value.trim() };
      let bad = false;
      SUBJECTS.forEach((s) => {
        const att = +$(`#mk_${s.id}_att`).value || 0, cor = +$(`#mk_${s.id}_cor`).value || 0;
        if (cor > att || att > s.qs) bad = true;
        m.sections[s.id] = { att, cor, time: +$(`#mk_${s.id}_time`).value || 0 };
      });
      if (bad) { toast("Check: correct ≤ attempted ≤ total"); break; }
      state.mocks.push(m); state.mocks.sort((x, y) => (x.date < y.date ? -1 : 1));
      save(); toast(`Saved: ${mockScore(m).total}/1000`); render(); break;
    }
    case "delMock": if (armed(el, "Delete?")) { state.mocks = state.mocks.filter((m) => m.id !== el.dataset.id); save(); render(); } break;
    case "speedLv": state.speedKit[el.dataset.id] = +el.dataset.v; save(); render(); break;
    case "saveSettings": {
      const s = state.settings;
      s.perDay = Math.min(360, Math.max(60, +$("#setPerDay").value || 120));
      s.restDay = +$("#setRest").value;
      s.dryRunDate = $("#setDry").value;
      s.examDate = $("#setExam").value || s.examDate;
      const day = state.days[todayStr()];
      if (day && !Object.values(day.checks).some(Boolean)) delete state.days[todayStr()];
      save(); toast("Saved ✓ — plan recalculated"); render(); break;
    }
    case "export": exportBackup(); break;
    case "copyBackup": copy(JSON.stringify(state)); break;
    case "importText": {
      try { importState($("#importText").value); } catch (err) { toast("Invalid backup text"); }
      break;
    }
    case "reset":
      if (armed(el, "Sab data delete hoga — dobara tap karo")) { state = defaultState(); save(); render(); }
      break;
  }
});

async function exportBackup() {
  const data = JSON.stringify(state, null, 1);
  const filename = `nimcet-tracker-${todayStr()}.json`;
  if (window.claude && window.claude.use) {
    const dl = await window.claude.use("downloads");
    if (dl) {
      try { await dl.save({ filename, data }); toast("Backup saved ✓"); } catch (e) { toast("Save cancel hua — 'Copy backup text' use karo"); }
      return;
    }
  }
  const a2 = document.createElement("a");
  a2.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  a2.download = filename; a2.click();
}

function importState(txt) {
  const s = JSON.parse(txt);
  if (!s.progress || !s.settings) throw new Error("bad file");
  state = { ...defaultState(), ...s, settings: { ...defaultState().settings, ...s.settings } };
  save(); toast("Imported ✓"); render();
}

document.addEventListener("change", (e) => {
  const el = e.target;
  const a = el.dataset.act;
  if (el.id === "importFile") {
    const f = el.files[0];
    if (!f) return;
    f.text().then((txt) => {
      try { importState(txt); } catch (err) { toast("Invalid backup file"); }
    });
    return;
  }
  if (!a) return;
  const leafId = el.dataset.leaf;
  switch (a) {
    case "leafQ": lp(state, leafId).qs[el.dataset.k] = Math.max(0, +el.value || 0); save(); break;
    case "leafConf": lp(state, leafId).conf = +el.value; save(); break;
    case "leafStatus": {
      const p = lp(state, leafId);
      p.status = el.value;
      if ((el.value === "done" || el.value === "mastered") && !p.rev) startRevision(state, LEAF[leafId], todayStr());
      save(); render(); break;
    }
    case "leafNotes": lp(state, leafId).notes = el.value; save(); toast("Note saved"); break;
    case "synSub": ui.synFilter.sub = el.value; render(); break;
    case "synStatus": ui.synFilter.status = el.value; render(); break;
    case "synTough": ui.synFilter.tough = el.checked; render(); break;
    case "promptLeaf": ui.promptLeaf = el.value; render(); break;
    case "mkFilter": ui.mistakeFilter = el.value; render(); break;
  }
});

document.addEventListener("input", (e) => {
  if (e.target.dataset.act === "synQ") {
    ui.synFilter.q = e.target.value;
    clearTimeout(render._q);
    render._q = setTimeout(() => { render(); const i = document.querySelector('[data-act="synQ"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
  }
});

document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d.classList && d.classList.contains("chapter") && d.dataset.ch) {
    if (d.open) ui.openCh.add(d.dataset.ch); else ui.openCh.delete(d.dataset.ch);
  }
}, true);

function resolveMistake(id, r) {
  const m = state.mistakes.find((x) => x.id === id);
  if (!m) return;
  if (r === "solved") {
    m.solved = (m.solved || 0) + 1;
    m.stage = Math.min(MISTAKE_INTERVALS.length - 1, (m.stage || 0) + 1);
    if (m.solved >= 4) { m.resolved = true; toast("Resolved ✓ — ye galti ab pakki theek"); }
    else m.due = addDays(todayStr(), MISTAKE_INTERVALS[m.stage]);
  } else {
    m.stage = 0; m.due = addDays(todayStr(), 1);
    toast("Kal phir aayega — solution ki key idea note karo");
  }
}

function addLog(mins) {
  const d = todayStr();
  state.log[d] = (state.log[d] || 0) + mins;
  save();
}

/* ---------------- theme ---------------- */
function applyTheme() {
  const t = state.settings.theme;
  if (t) document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
}
$("#themeBtn").addEventListener("click", () => {
  const dark = state.settings.theme ? state.settings.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  state.settings.theme = dark ? "light" : "dark";
  save(); applyTheme();
});

/* ---------------- pomodoro ---------------- */
const MODES = { focus: 25, revision: 25, break: 5, mock: 120 };
let pomo = { mode: "focus", endAt: 0, left: MODES.focus * 60, running: false };
try { const p = JSON.parse(localStorage.getItem(POMO_KEY)); if (p && MODES[p.mode]) pomo = p; } catch (e) { /* ignore */ }
function savePomo() { try { localStorage.setItem(POMO_KEY, JSON.stringify(pomo)); } catch (e) { /* ignore */ } }

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.frequency.value = 880;
      g.gain.setValueAtTime(0.2, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
    });
  } catch (e) { /* no audio */ }
}

function pomoDone() {
  const m = pomo.mode;
  beep();
  if (m !== "break") {
    addLog(MODES[m]);
    const d = todayStr();
    state.pomos[d] = (state.pomos[d] || 0) + 1;
    save();
    try { if (window.Notification && Notification.permission === "granted") new Notification("🍅 Pomodoro done!", { body: "5 min break lo. Tracker me task tick karo." }); } catch (e) { /* ignore */ }
    toast(`🍅 ${MODES[m]} min logged. Break time!`);
    pomo = { mode: "break", endAt: 0, left: MODES.break * 60, running: false };
  } else {
    toast("Break over — next pomodoro start karo");
    pomo = { mode: "focus", endAt: 0, left: MODES.focus * 60, running: false };
  }
  savePomo();
  if (ui.tab === "today") render();
}

function pomoTick() {
  if (pomo.running) {
    pomo.left = Math.max(0, Math.round((pomo.endAt - Date.now()) / 1000));
    if (pomo.left <= 0) { pomo.running = false; pomoDone(); }
  }
  const mm = String(Math.floor(pomo.left / 60)).padStart(2, "0"), ss = String(pomo.left % 60).padStart(2, "0");
  $("#pomoTime").textContent = `${mm}:${ss}`;
  $("#pomoStart").textContent = pomo.running ? "Pause" : "Start";
  $("#pomoMode").value = pomo.mode;
  $("#pomo").classList.toggle("running", pomo.running);
  $("#pomoCount").textContent = `🍅 ${state.pomos[todayStr()] || 0}`;
  let cue = "";
  if (pomo.mode === "revision") {
    const el = MODES.revision - pomo.left / 60;
    const c = REVISION_POMODORO.filter((r) => r.at <= el).pop();
    cue = c ? c.text : "";
  } else if (pomo.mode === "focus") cue = pomo.running ? "Phone door. Sirf current task." : "";
  else if (pomo.mode === "break") cue = "Paani, stretch, screen se door.";
  else cue = "Maths 70 · Reasoning 30 · Comp+Eng 20";
  $("#pomoCue").textContent = cue;
}

$("#pomoStart").addEventListener("click", () => {
  if (pomo.running) { pomo.running = false; }
  else {
    pomo.running = true; pomo.endAt = Date.now() + pomo.left * 1000;
    try { if (window.Notification && Notification.permission === "default") Notification.requestPermission(); } catch (e) { /* ignore */ }
  }
  savePomo(); pomoTick();
});
$("#pomoReset").addEventListener("click", () => { pomo = { mode: pomo.mode, endAt: 0, left: MODES[pomo.mode] * 60, running: false }; savePomo(); pomoTick(); });
$("#pomoMode").addEventListener("change", (e) => { pomo = { mode: e.target.value, endAt: 0, left: MODES[e.target.value] * 60, running: false }; savePomo(); pomoTick(); });
$("#pomoToggle").addEventListener("click", () => { $("#pomo").classList.toggle("collapsed"); $("#pomoToggle").textContent = $("#pomo").classList.contains("collapsed") ? "▴" : "▾"; });

/* ---------------- boot ---------------- */
applyTheme();
render();
setSync("local");
initCloud();
setInterval(pomoTick, 500);
pomoTick();
// Day rollover while the tab stays open.
let lastDay = todayStr();
setInterval(() => { if (todayStr() !== lastDay) { lastDay = todayStr(); render(); } }, 60000);
