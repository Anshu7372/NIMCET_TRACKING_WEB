/*
 * Practice Questions + Admin.
 *
 * Admin uploads a question image + correct option (A–D) tagged to a syllabus
 * subtopic. Practice serves them GATE-tracker style: filters → one question at
 * a time with timer → auto-check → diagnosis → wrong answers go to the
 * mistake log automatically (and come back for re-solve 1-3-7-21 days later).
 *
 * Storage for the question bank:
 *  - on claude.ai (artifact): shared `db` collection "questions" + images in `assets`
 *    (only the owner/editors can upload; practice works on every device);
 *  - elsewhere (GitHub Pages / file): IndexedDB in this browser.
 * Attempts live in the tracker state (state.quiz / state.bm), which already syncs.
 */

const OPTS = ["A", "B", "C", "D"];
// Exam pace per subject (seconds per question).
const EXPECTED_SECS = { M: 84, R: 45, C: 60, E: 36 };

let QBANK = [];
let QBYID = {};

/* ---------------- storage backends ---------------- */
const localBank = {
  kind: "local",
  canWrite: true,
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("nimcet-qbank", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("q", { keyPath: "id" });
      r.onsuccess = () => { this._db = r.result; res(r.result); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction("q", mode);
      const out = fn(t.objectStore("q"));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  async list() { return (await this.tx("readonly", (s) => s.getAll())) || []; },
  async add(q, blob) { q.img = await blobToDataUrl(blob); await this.tx("readwrite", (s) => s.put(q)); return q; },
  async update(q) { await this.tx("readwrite", (s) => s.put(q)); },
  async remove(q) { await this.tx("readwrite", (s) => s.delete(q.id)); },
  imgUrl(q) { return typeof q.img === "string" && q.img.startsWith("data:image/") ? q.img : ""; },
};

const cloudBank = {
  kind: "cloud",
  canWrite: false,
  db: null,
  assets: null,
  async list() {
    const snap = await this.db.collection("questions").get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  },
  async add(q, blob) {
    const up = await this.assets.upload(blob);
    q.imgId = up.id;
    const { id, ...body } = q;
    await this.db.collection("questions").doc(id).set(body);
    return q;
  },
  async update(q) { const { id, ...body } = q; await this.db.collection("questions").doc(id).set(body); },
  async remove(q) {
    await this.db.collection("questions").doc(q.id).delete();
    if (q.imgId && this.assets) { try { await this.assets.delete(q.imgId); } catch (e) { /* orphan is harmless */ } }
  },
  imgUrl(q) { return typeof q.imgId === "string" && /^[0-9a-f]{32}$/.test(q.imgId) ? "/_blob/" + q.imgId : ""; },
};

let bank = localBank;
let bankReady = false;
let bankError = "";

function indexBank(list) {
  QBANK = list.filter((q) => q && q.id && OPTS.includes(q.ans)).sort((a, b) => (a.at || 0) - (b.at || 0));
  QBYID = Object.fromEntries(QBANK.map((q) => [q.id, q]));
}

async function initBank() {
  // Prefer the account-backed bank on claude.ai.
  for (let i = 0; i < 6 && !(window.claude && window.claude.use); i++) await new Promise((r) => setTimeout(r, 500));
  if (window.claude && window.claude.use) {
    try {
      const [db, assets] = await Promise.all([window.claude.use("db"), window.claude.use("assets")]);
      if (db) {
        cloudBank.db = db;
        cloudBank.assets = assets;
        cloudBank.canWrite = !!assets;
        bank = cloudBank;
        db.collection("questions").onSnapshot(
          (snap) => { indexBank(snap.docs.map((d) => ({ ...d.data(), id: d.id }))); bankReady = true; refreshPractice(); },
          () => { bankError = "Question bank load nahi hua — page reload karo."; refreshPractice(); },
        );
        return;
      }
    } catch (e) { /* fall through to local */ }
  }
  try { indexBank(await localBank.list()); } catch (e) { bankError = "Is browser me question storage (IndexedDB) blocked hai."; }
  bankReady = true;
  refreshPractice();
}

function refreshPractice() {
  const t = document.getElementById("adminTab");
  if (t) t.hidden = !bank.canWrite;
  if (ui.tab === "practice" || ui.tab === "admin" || ui.tab === "mistakes") render();
}

/* ---------------- image helpers ---------------- */
function blobToDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
async function dataUrlToBlob(u) { return (await fetch(u)).blob(); }

// Downscale big screenshots so storage stays small; keep text readable.
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, 1400 / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    let blob = await new Promise((r) => c.toBlob(r, "image/webp", 0.85));
    if (!blob || blob.type !== "image/webp") blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

/* ---------------- practice engine ---------------- */
ui.pq = { f: { sub: "", ch: "", leaf: "", st: "new", src: "", order: "added" }, list: null, idx: 0, given: "", guess: false, res: null, t0: 0, done: [], why: "" };
ui.adm = { leaf: "", src: "", items: [], key: "", saving: false, editing: null, filter: "" };

const leafOf = (q) => LEAF[q.leaf];
const subjectOf = (q) => (leafOf(q) ? leafOf(q).ch.subject : "M");

function practiceList(f) {
  let list = QBANK.filter((q) => {
    const l = leafOf(q);
    if (f.sub && (!l || l.ch.subject !== f.sub)) return false;
    if (f.ch && (!l || l.ch.id !== f.ch)) return false;
    if (f.leaf && q.leaf !== f.leaf) return false;
    if (f.src && !String(q.src || "").toLowerCase().includes(f.src.toLowerCase())) return false;
    const a = state.quiz[q.id];
    if (f.st === "new") return !a;
    if (f.st === "wrong") return a && !a.ok;
    if (f.st === "bm") return !!state.bm[q.id];
    return true;
  });
  if (f.order === "shuffle") for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list.map((q) => q.id);
}

// Likely reason for a wrong answer — a guess; the student confirms with one tap.
function diagnose(q, g, secs, guess) {
  const l = leafOf(q);
  const exp = EXPECTED_SECS[subjectOf(q)];
  const lines = [];
  let type = "Concept gap";
  const p = l ? state.progress[l.id] : null;
  if (l && (!p || !p.mins) && !leafDone(state, l)) {
    type = "Topic abhi padha nahi";
    lines.push(`"${l.name}" abhi tumhare plan me padhna baaki hai — pehle concept padho (Claude teach prompt), phir ye question dobara karo.`);
  } else if (guess) {
    type = "Wrong guess";
    lines.push("Tumne guess mark kiya tha — is concept pe confidence nahi hai. NIMCET me −25% negative hai: 2 options eliminate kiye bina guess mat karo.");
  } else if (secs > 0 && secs < exp * 0.3) {
    type = "Silly / misread";
    lines.push(`Sirf ${secs} sec me answer diya — question dhyan se padho ('NOT', 'minimum', 'at least', units).`);
  } else if (secs > exp * 2.5) {
    type = "Time pressure";
    lines.push(`${Math.round(secs / 60 * 10) / 10} min lage (exam pace ~${exp} sec). Approach slow hai — Claude se fast method pucho.`);
  } else {
    lines.push(`Concept gap lag raha hai: "${l ? l.name : "is topic"}" ka concept / formula dobara dekho.`);
  }
  if (secs > exp * 2.5 && type !== "Time pressure") lines.push(`Time bhi ${Math.round(secs)} sec laga (exam pace ~${exp} sec).`);
  if (l && l.tip) lines.push("Shortcut yaad karo: " + l.tip);
  if (q.trap) lines.push("Common trap: " + q.trap);
  return { type, lines };
}

function qRef(q) { return `${q.src || "Practice Q"}${leafOf(q) ? " — " + leafOf(q).name : ""}`; }

function recordAttempt(q, g, secs, guess) {
  const prev = state.quiz[q.id];
  const ok = g === q.ans;
  state.quiz[q.id] = { g, ok, at: todayStr(), n: (prev ? prev.n : 0) + 1, t: Math.round(secs), guess: !!guess };
  const mid = "q-" + q.id;
  const m = state.mistakes.find((x) => x.id === mid);
  let diag = null;
  if (!ok) {
    diag = diagnose(q, g, secs, guess);
    const note = `Mera: ${g || "—"} · Sahi: ${q.ans}. ${diag.lines[0]}`;
    if (m) {
      // Wrong again: back to day 1 of the re-solve schedule.
      Object.assign(m, { date: todayStr(), type: diag.type, note, resolved: false, stage: 0, due: addDays(todayStr(), 1) });
    } else {
      state.mistakes.push({
        id: mid, qid: q.id, date: todayStr(), leafId: q.leaf || "", source: "Practice", ref: qRef(q),
        type: diag.type, note, fix: q.conc || (leafOf(q) ? "Revise: " + leafOf(q).name : ""),
        stage: 0, due: addDays(todayStr(), 1), solved: 0, resolved: false,
      });
    }
    if (q.leaf) {
      // Three wrong answers in one subtopic → mark it tough so it comes back more often.
      const wrongHere = QBANK.filter((x) => x.leaf === q.leaf && state.quiz[x.id] && !state.quiz[x.id].ok).length;
      if (wrongHere >= 3 && !lp(state, q.leaf).tough) { lp(state, q.leaf).tough = true; diag.lines.push("Is subtopic me 3+ galat — ★ tough mark ho gaya (revision me zyada aayega)."); }
    }
  } else if (m && !m.resolved) {
    resolveMistake(m.id, "solved");
  }
  save();
  return { ok, diag };
}

function claudePrompt(q) {
  const l = leafOf(q);
  const a = state.quiz[q.id];
  const m = state.mistakes.find((x) => x.id === "q-" + q.id);
  return `Tum mere NIMCET coach ho. Question ka screenshot attach kar raha hoon.
Source: ${q.src || "—"}
Topic: ${l ? `${l.ch.name} → ${l.topic} → ${l.name} (${DEPTH[l.d].label})` : "—"}
Mera answer: ${a ? a.g || "—" : "—"} · Sahi answer: ${q.ans}
Time laga: ${a ? a.t + " sec" : "—"} (exam pace ~${EXPECTED_SECS[subjectOf(q)]} sec)
${m ? "Meri galti (mera andaza): " + m.type + " — " + m.note : ""}

1) Sahi answer step by step samjhao (Hinglish, simple, NIMCET level).
2) Mera answer kyu galat hai — kaunsa concept / trap miss hua, exactly batao.
3) Is type ke question ka fastest approach (option elimination / shortcut) — exam me ${EXPECTED_SECS[subjectOf(q)]} sec me kaise ho.
4) Isi concept pe 2 similar NIMCET-level MCQs do (answers baad me jab main maangu).`;
}

/* ---------------- practice views ---------------- */
function statusLine() {
  if (bankError) return `<div class="warnbox">${esc(bankError)}</div>`;
  if (!bankReady) return `<p class="meta">Questions load ho rahe hain…</p>`;
  return "";
}

function renderPractice() {
  const P = ui.pq;
  if (P.list) return renderSession();
  const f = P.f;
  const att = QBANK.filter((q) => state.quiz[q.id]).length;
  const cor = QBANK.filter((q) => state.quiz[q.id] && state.quiz[q.id].ok).length;
  const wrong = att - cor;
  if (bankReady && !QBANK.length) {
    return `${statusLine()}<div class="card"><h2>Practice Questions</h2>
      <p>Abhi koi question upload nahi hua. ${bank.canWrite ? `<a href="#" data-pact="goAdmin">Admin</a> page pe question ka image + sahi option upload karo — yahan apne aap aa jayega.` : "Owner ke upload karne ke baad questions yahan dikhenge."}</p>
      <ul class="clean meta"><li>✔ Subject / chapter / subtopic / source se filter</li><li>✔ Option chuno → page khud check karega, timer ke saath</li>
      <li>✔ Galat hua → kyu hua (possible galti) + kya revise karna hai</li><li>✔ Galat question apne aap Mistake log me → 1-3-7-21 din pe dobara solve</li></ul></div>`;
  }
  const chOpts = CHAPTERS.filter((c) => !f.sub || c.subject === f.sub).map((c) => {
    const n = QBANK.filter((q) => leafOf(q) && leafOf(q).ch.id === c.id).length;
    return n ? `<option value="${c.id}" ${f.ch === c.id ? "selected" : ""}>${esc(c.name)} (${n})</option>` : "";
  }).join("");
  const leafOpts = f.ch ? LEAVES.filter((l) => l.ch.id === f.ch).map((l) => {
    const n = QBANK.filter((q) => q.leaf === l.id).length;
    return n ? `<option value="${l.id}" ${f.leaf === l.id ? "selected" : ""}>${esc(l.name)} (${n})</option>` : "";
  }).join("") : "";
  const n = practiceList(f).length;
  return `${statusLine()}
  <div class="grid g4">
    <div class="card stat"><span class="l">Attempted</span><span class="v">${att}/${QBANK.length}</span></div>
    <div class="card stat"><span class="l">Accuracy</span><span class="v">${pct(cor, att)}%</span></div>
    <div class="card stat"><span class="l">Abhi galat (retry karo)</span><span class="v">${wrong}</span></div>
    <div class="card stat"><span class="l">Bookmarked</span><span class="v">${QBANK.filter((q) => state.bm[q.id]).length}</span></div>
  </div>
  <div class="card" style="margin-top:14px">
    <h2>Questions chuno</h2>
    <div class="form">
      <label class="f">Subject<select data-pf="sub"><option value="">Sab subjects</option>${SUBJECTS.map((s) => { const k = QBANK.filter((q) => subjectOf(q) === s.id).length; return k ? `<option value="${s.id}" ${f.sub === s.id ? "selected" : ""}>${esc(s.name)} (${k})</option>` : ""; }).join("")}</select></label>
      <label class="f">Chapter<select data-pf="ch"><option value="">Sab chapters</option>${chOpts}</select></label>
      ${f.ch ? `<label class="f">Subtopic<select data-pf="leaf"><option value="">Sab subtopics</option>${leafOpts}</select></label>` : ""}
      <label class="f">Kaunse<select data-pf="st">${[["new", "Naye (attempt nahi kiye)"], ["wrong", "Galat wale (retry)"], ["all", "Sab"], ["bm", "Bookmarked"]].map(([v, t]) => `<option value="${v}" ${f.st === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="f">Source contains<input data-pf="src" value="${esc(f.src)}" placeholder="e.g. NIMCET 2023 / JEE 2024"></label>
      <label class="f">Order<select data-pf="order"><option value="added" ${f.order === "added" ? "selected" : ""}>Upload order</option><option value="shuffle" ${f.order === "shuffle" ? "selected" : ""}>Shuffle</option></select></label>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn primary" data-pact="start" ${n ? "" : "disabled"}>▶ Start (${n} questions)</button>
      <button class="btn" data-pact="retryAll" ${wrong ? "" : "disabled"}>❌ Saare galat retry (${wrong})</button>
    </div>
    <p class="meta" style="margin-top:8px">Pace: Maths ~84 sec · Reasoning ~45 sec · Computer ~60 sec · English ~36 sec per question. Negative marking yaad rakho — guess sirf 2 options hata ke.</p>
  </div>`;
}

function renderSession() {
  const P = ui.pq;
  if (P.idx >= P.list.length) {
    const d = P.done, cor = d.filter((x) => x.ok).length;
    const leaves = [...new Set(d.filter((x) => !x.ok).map((x) => (QBYID[x.id] || {}).leaf).filter(Boolean))];
    return `<div class="grid g4"><div class="card stat"><span class="l">Sahi</span><span class="v">${cor}/${d.length}</span></div><div class="card stat"><span class="l">Accuracy</span><span class="v">${pct(cor, d.length)}%</span></div></div>
      ${leaves.length ? `<div class="card" style="margin-top:14px"><h3>Ye subtopics revise karo (galat questions Mistake log me save ho gaye)</h3><ul class="clean">${leaves.map((id) => `<li><a href="#" data-act="openLeaf" data-leaf="${id}">${esc(LEAF[id] ? LEAF[id].name : id)}</a></li>`).join("")}</ul></div>` : ""}
      <div class="row" style="margin-top:14px"><button class="btn primary" data-pact="exit">← Practice home</button>${d.some((x) => !x.ok) ? `<button class="btn" data-pact="retrySession">Galat wale dobara</button>` : ""}<button class="btn" data-pact="goMistakes">Mistake log →</button></div>`;
  }
  const q = QBYID[P.list[P.idx]];
  if (!q) { P.idx++; return renderSession(); }
  const l = leafOf(q);
  const res = P.res;
  const prev = state.quiz[q.id];
  const img = bank.imgUrl(q);
  const m = state.mistakes.find((x) => x.id === "q-" + q.id);
  const opts = OPTS.map((o) => {
    const chosen = P.given === o;
    const cls = res ? (o === q.ans ? "opt-ok" : chosen ? "opt-bad" : "") : "";
    return `<label class="opt ${cls}"><input type="radio" name="qopt" value="${o}" data-popt="${o}" ${chosen ? "checked" : ""} ${res ? "disabled" : ""}><b>${o}</b></label>`;
  }).join("");
  return `<div class="card qcard">
    <div class="row">
      <span class="badge">Q ${P.idx + 1}/${P.list.length}</span>
      ${q.src ? `<span class="badge">${esc(q.src)}</span>` : ""}
      ${res && l ? `<span class="badge" style="color:var(--good)">${esc(l.ch.name)} › ${esc(l.name)}</span>` : ""}
      ${prev && !res ? `<span class="badge" style="color:${prev.ok ? "var(--good)" : "var(--bad)"}">pehle: ${prev.ok ? "sahi" : "galat"}</span>` : ""}
      <span class="qtimer" id="qTimer">0:00</span>
      <button class="btn small ghost" data-pact="bm">${state.bm[q.id] ? "★ Bookmarked" : "☆ Bookmark"}</button>
    </div>
    ${img ? `<img class="qimg" src="${esc(img)}" alt="Question ${P.idx + 1}${q.src ? " — " + esc(q.src) : ""}">` : `<p class="meta">Image nahi mili.</p>`}
    <div class="opts">${opts}</div>
    ${!res ? `<label class="row meta"><input type="checkbox" id="qGuess" ${P.guess ? "checked" : ""}> Guess kiya hai (sure nahi)</label>
      <div class="row"><button class="btn primary" data-pact="submit">Submit</button><button class="btn" data-pact="skip">Skip →</button><button class="btn ghost" data-pact="exit">✕ Exit</button></div>` : ""}
    ${res ? `<div class="qres ${res.ok ? "good" : "bad"}">
      <h2>${res.ok ? "✅ Sahi!" : "❌ Galat"}</h2>
      <p>Sahi answer: <b>${esc(q.ans)}</b>${!res.ok ? ` · Tumhara: <b>${esc(state.quiz[q.id].g || "—")}</b>` : ""} · Time: ${state.quiz[q.id].t} sec</p>
      ${q.conc ? `<p><b>Concept / hint:</b> ${esc(q.conc)}</p>` : ""}
      ${res.diag ? `<p><b>Possible galti:</b></p><ul>${res.diag.lines.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        ${l ? `<p><b>Ye revise karo:</b> <a href="#" data-act="openLeaf" data-leaf="${l.id}">${esc(l.ch.name)} › ${esc(l.topic)} › ${esc(l.name)}</a></p>` : ""}
        <p class="meta">✓ Mistake log me save ho gaya — kal re-solve ke liye aayega. Asli reason choose karo:</p>
        <div class="rate">${MISTAKE_TYPES.map((t) => `<button class="btn small ${m && m.type === t ? "primary" : ""}" data-pact="reason" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>
        <label class="f" style="margin-top:8px">Kyu galat hua? (apne words me — Mistake log me jayega)<textarea id="qWhy" style="min-height:56px" placeholder="e.g. sign galat liya, formula me 2 bhool gaya">${esc(P.why)}</textarea></label>
        <div class="row"><button class="btn small" data-pact="saveWhy">Save reason</button></div>` : ""}
      <div class="row" style="margin-top:8px">
        <button class="btn primary" data-pact="next">Next →</button>
        <button class="btn" data-pact="claude">📋 Claude se samjho (prompt copy)</button>
        <button class="btn ghost" data-pact="exit">✕ Exit</button>
      </div></div>` : ""}
  </div>`;
}

/* ---------------- admin view ---------------- */
function nextSrc(src) {
  // "NIMCET 2023 Q12" → "NIMCET 2023 Q13"
  const m = /^(.*?)(\d+)\s*$/.exec(src || "");
  return m ? m[1] + (+m[2] + 1) : src;
}

function renderAdmin() {
  if (!bank.canWrite) return `<div class="card"><h2>Admin</h2><p>Sirf owner questions upload kar sakta hai.</p></div>`;
  const A = ui.adm;
  const where = bank.kind === "cloud"
    ? "Questions tumhare claude.ai artifact me save hote hain — practice har device pe dikhegi."
    : "Questions sirf <b>is browser</b> me save hote hain. Doosre device pe chahiye to neeche Export → wahan Import.";
  const items = A.items.map((it, i) => `<div class="upl">
      <img src="${it.preview}" alt="Upload ${i + 1}">
      <div class="stack">
        <div class="row"><b>#${i + 1}</b>
          <label class="f">Source<input data-ait="${i}" data-k="src" value="${esc(it.src)}"></label>
          <label class="f">Correct<select data-ait="${i}" data-k="ans"><option value="">—</option>${OPTS.map((o) => `<option ${it.ans === o ? "selected" : ""}>${o}</option>`).join("")}</select></label>
          <button class="btn small ghost" data-pact="dropItem" data-i="${i}">✕</button></div>
      </div></div>`).join("");
  const list = QBANK.filter((q) => !A.filter || (q.src || "").toLowerCase().includes(A.filter.toLowerCase()) || (leafOf(q) && leafOf(q).name.toLowerCase().includes(A.filter.toLowerCase()))).slice().reverse();
  const edit = A.editing ? QBYID[A.editing] : null;
  return `${statusLine()}
  <div class="card">
    <h2>Admin — question upload</h2>
    <p class="meta">${where}</p>
    <ol class="steps meta">
      <li>Subtopic chuno (sab images isi subtopic me jayengi).</li>
      <li>Image(s) choose karo, drag karo, ya screenshot <b>Ctrl+V / paste</b> karo.</li>
      <li>Har image ka sahi option (A–D) chuno — ya kai images ke liye answer key ek saath likho (e.g. <code>ACBDA</code>).</li>
      <li>Save → Practice page pe turant aa jayega.</li>
    </ol>
    <div class="form">
      <label class="f">Subtopic<select id="aLeaf">${leafOptions(A.leaf)}</select></label>
      <label class="f">Source (next image me number apne aap +1)<input id="aSrc" value="${esc(A.src)}" placeholder="e.g. NIMCET 2023 Q12 / RDS Obj Ch8 Q5"></label>
      <label class="f">Answer key (optional)<input id="aKey" value="${esc(A.key)}" placeholder="e.g. ACBD" autocomplete="off"></label>
    </div>
    <div class="drop" id="aDrop" tabindex="0">
      <p><b>Image yaha drop / paste karo</b> ya</p>
      <label class="btn">📷 Choose image(s)<input type="file" id="aFiles" accept="image/*" multiple hidden></label>
    </div>
    ${items ? `<div class="upls">${items}</div>` : ""}
    <div class="form" style="margin-top:10px;grid-template-columns:1fr 1fr">
      <label class="f">Concept / hint (optional — galat hone pe dikhega)<textarea id="aConc" style="min-height:50px"></textarea></label>
      <label class="f">Common trap (optional)<textarea id="aTrap" style="min-height:50px"></textarea></label>
    </div>
    <div class="row" style="margin-top:8px"><button class="btn primary" data-pact="saveItems" ${A.items.length && !A.saving ? "" : "disabled"}>${A.saving ? "Saving…" : `💾 Save ${A.items.length || ""} question(s)`}</button></div>
  </div>

  ${edit ? `<div class="card" id="editCard"><h3>Edit question</h3>
    <div class="upl"><img src="${esc(bank.imgUrl(edit))}" alt="Editing">
    <div class="form">
      <label class="f">Subtopic<select id="eLeaf">${leafOptions(edit.leaf)}</select></label>
      <label class="f">Source<input id="eSrc" value="${esc(edit.src || "")}"></label>
      <label class="f">Correct<select id="eAns">${OPTS.map((o) => `<option ${edit.ans === o ? "selected" : ""}>${o}</option>`).join("")}</select></label>
      <label class="f">Concept / hint<input id="eConc" value="${esc(edit.conc || "")}"></label>
      <label class="f">Trap<input id="eTrap" value="${esc(edit.trap || "")}"></label>
    </div></div>
    <div class="row"><button class="btn primary" data-pact="saveEdit">Save changes</button><button class="btn" data-pact="cancelEdit">Cancel</button></div></div>` : ""}

  <div class="card">
    <div class="row between"><h3>Uploaded questions (${QBANK.length})</h3><input id="aFilter" value="${esc(A.filter)}" placeholder="Search source / subtopic" style="max-width:240px"></div>
    <div class="scroll-x"><table><tr><th>Image</th><th>Subtopic</th><th>Source</th><th>Ans</th><th>Attempts</th><th></th></tr>
    ${list.slice(0, 200).map((q) => { const a = state.quiz[q.id]; return `<tr>
      <td><img class="thumb" src="${esc(bank.imgUrl(q))}" alt="" loading="lazy"></td>
      <td>${leafOf(q) ? esc(leafOf(q).name) + `<div class="meta">${esc(leafOf(q).ch.name)}</div>` : "—"}</td>
      <td>${esc(q.src || "")}</td><td><b>${esc(q.ans)}</b></td>
      <td>${a ? (a.ok ? "✓" : "✗") + ` ×${a.n}` : "—"}</td>
      <td class="row"><button class="btn small" data-pact="edit" data-q="${q.id}">Edit</button><button class="btn small ghost" data-pact="del" data-q="${q.id}">Delete</button></td></tr>`; }).join("")}
    </table></div>
    ${list.length > 200 ? `<p class="meta">Pehle 200 dikhaye — search se filter karo.</p>` : ""}
  </div>

  <div class="card">
    <h3>Backup / move question bank</h3>
    <p class="meta">Export me images bhi hoti hain. GitHub link wale browser se claude.ai link pe (ya ulta) questions le jaane ke liye bhi yahi use karo.</p>
    <div class="row"><button class="btn" data-pact="exportBank">⬇ Export questions</button>
      <label class="btn">⬆ Import questions<input type="file" id="aImport" accept="application/json" hidden></label></div>
  </div>`;
}

async function addFiles(files) {
  const A = ui.adm;
  const key = (document.getElementById("aKey") || {}).value || A.key;
  A.key = key;
  A.leaf = (document.getElementById("aLeaf") || {}).value ?? A.leaf;
  A.src = (document.getElementById("aSrc") || {}).value ?? A.src;
  let src = A.items.length ? nextSrc(A.items[A.items.length - 1].src) : A.src;
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    try {
      const blob = await compressImage(f);
      const letter = (key.toUpperCase().replace(/[^ABCD]/g, "")[A.items.length] || "");
      A.items.push({ blob, preview: URL.createObjectURL(blob), src, ans: letter });
      src = nextSrc(src);
    } catch (e) { toast("Ye image read nahi hui: " + f.name); }
  }
  render();
}

async function saveItems() {
  const A = ui.adm;
  A.leaf = document.getElementById("aLeaf").value;
  const conc = document.getElementById("aConc").value.trim();
  const trap = document.getElementById("aTrap").value.trim();
  if (!A.leaf) { toast("Pehle subtopic chuno"); return; }
  const missing = A.items.findIndex((it) => !OPTS.includes(it.ans));
  if (missing >= 0) { toast(`#${missing + 1} ka sahi option chuno`); return; }
  A.saving = true; render();
  let saved = 0;
  try {
    for (const it of A.items) {
      const q = { id: uid() + uid(), leaf: A.leaf, src: it.src.trim(), ans: it.ans, conc, trap, at: Date.now() + saved };
      await bank.add(q, it.blob);
      if (bank.kind === "local") { QBANK.push(q); QBYID[q.id] = q; }
      saved++;
    }
    A.src = nextSrc(A.items[A.items.length - 1].src);
    A.items.forEach((it) => URL.revokeObjectURL(it.preview));
    A.items = []; A.key = "";
    toast(`✓ ${saved} question(s) save — Practice page pe aa gaye`);
  } catch (e) {
    A.items = A.items.slice(saved);
    toast(e && e.code === "quota_or_state" ? "Storage full — purane questions delete karo" : e && e.code === "too_large" ? "Image bahut badi hai" : "Save fail hua — dobara try karo");
  } finally { A.saving = false; render(); }
}

async function exportBank() {
  const out = [];
  for (const q of QBANK) {
    let img = bank.imgUrl(q);
    if (img && !img.startsWith("data:")) { try { img = await blobToDataUrl(await (await fetch(img)).blob()); } catch (e) { img = ""; } }
    out.push({ ...q, imgId: undefined, img });
  }
  const data = JSON.stringify({ kind: "nimcet-questions", v: 1, questions: out });
  const filename = `nimcet-questions-${todayStr()}.json`;
  const dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null;
  if (dl) { try { await dl.save({ filename, data }); toast("Exported ✓"); } catch (e) { toast("Export cancel hua"); } return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  a.download = filename; a.click();
}

async function importBank(file) {
  try {
    const j = JSON.parse(await file.text());
    if (!j || j.kind !== "nimcet-questions" || !Array.isArray(j.questions)) throw new Error("bad");
    let n = 0;
    for (const x of j.questions) {
      if (!OPTS.includes(x.ans) || typeof x.img !== "string" || !x.img.startsWith("data:image/") || QBYID[x.id]) continue;
      const q = { id: String(x.id).replace(/[^\w-]/g, "").slice(0, 40) || uid() + uid(), leaf: LEAF[x.leaf] ? x.leaf : "", src: String(x.src || "").slice(0, 120), ans: x.ans, conc: String(x.conc || "").slice(0, 1000), trap: String(x.trap || "").slice(0, 1000), at: +x.at || Date.now() };
      await bank.add(q, await dataUrlToBlob(x.img));
      if (bank.kind === "local") { QBANK.push(q); QBYID[q.id] = q; }
      n++;
    }
    toast(`✓ ${n} questions imported`);
    render();
  } catch (e) { toast("Invalid questions file"); }
}

/* ---------------- events ---------------- */
function startSession(ids) {
  Object.assign(ui.pq, { list: ids, idx: 0, given: "", guess: false, res: null, t0: Date.now(), done: [], why: "" });
  if (ui.tab !== "practice") go("practice"); else { render(); window.scrollTo(0, 0); }
}

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-pact]");
  if (!el) return;
  const P = ui.pq, A = ui.adm;
  const q = P.list ? QBYID[P.list[P.idx]] : null;
  switch (el.dataset.pact) {
    case "goAdmin": e.preventDefault(); go("admin"); break;
    case "goMistakes": go("mistakes"); break;
    case "start": startSession(practiceList(P.f)); break;
    case "retryAll": startSession(QBANK.filter((x) => state.quiz[x.id] && !state.quiz[x.id].ok).map((x) => x.id)); break;
    case "retry":
      if (!QBYID[el.dataset.q]) { toast(bankReady ? "Ye question bank me nahi mila" : "Questions load ho rahe hain…"); break; }
      startSession([el.dataset.q]); break;
    case "retrySession": startSession(P.done.filter((x) => !x.ok).map((x) => x.id)); break;
    case "exit": P.list = null; render(); break;
    case "skip": P.idx++; Object.assign(P, { given: "", guess: false, res: null, t0: Date.now(), why: "" }); render(); break;
    case "bm": if (q) { if (state.bm[q.id]) delete state.bm[q.id]; else state.bm[q.id] = 1; save(); render(); } break;
    case "submit": {
      if (!q) break;
      if (!P.given) { toast("Pehle option chuno"); break; }
      P.guess = !!(document.getElementById("qGuess") || {}).checked;
      const secs = Math.round((Date.now() - P.t0) / 1000);
      P.res = recordAttempt(q, P.given, secs, P.guess);
      P.done.push({ id: q.id, ok: P.res.ok });
      render(); break;
    }
    case "next": P.idx++; Object.assign(P, { given: "", guess: false, res: null, t0: Date.now(), why: "" }); render(); window.scrollTo(0, 0); break;
    case "reason": {
      const m = q && state.mistakes.find((x) => x.id === "q-" + q.id);
      if (m) { m.type = el.dataset.t; save(); render(); }
      break;
    }
    case "saveWhy": {
      const m = q && state.mistakes.find((x) => x.id === "q-" + q.id);
      const why = (document.getElementById("qWhy") || {}).value || "";
      if (m && why.trim()) { P.why = why; m.note = `Mera: ${state.quiz[q.id].g} · Sahi: ${q.ans}. ${why.trim()}`; save(); toast("Reason Mistake log me save ✓"); }
      break;
    }
    case "claude": if (q) copy(claudePrompt(q)); break;
    case "dropItem": { const it = A.items.splice(+el.dataset.i, 1)[0]; if (it) URL.revokeObjectURL(it.preview); render(); break; }
    case "saveItems": saveItems(); break;
    case "edit": A.editing = el.dataset.q; render(); setTimeout(() => { const c = document.getElementById("editCard"); if (c) c.scrollIntoView({ block: "start" }); }, 30); break;
    case "cancelEdit": A.editing = null; render(); break;
    case "saveEdit": {
      const x = QBYID[A.editing];
      if (!x) break;
      const upd = { ...x, leaf: document.getElementById("eLeaf").value, src: document.getElementById("eSrc").value.trim(), ans: document.getElementById("eAns").value, conc: document.getElementById("eConc").value.trim(), trap: document.getElementById("eTrap").value.trim() };
      try { await bank.update(upd); if (bank.kind === "local") { Object.assign(x, upd); } A.editing = null; toast("Saved ✓"); render(); } catch (err) { toast("Save fail hua"); }
      break;
    }
    case "del": {
      if (!armed(el, "Delete? dobara tap")) break;
      const x = QBYID[el.dataset.q];
      if (!x) break;
      try {
        await bank.remove(x);
        if (bank.kind === "local") indexBank(QBANK.filter((y) => y.id !== x.id));
        toast("Deleted"); render();
      } catch (err) { toast("Delete fail hua"); }
      break;
    }
    case "exportBank": exportBank(); break;
  }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.pf) {
    const f = ui.pq.f;
    f[el.dataset.pf] = el.value;
    if (el.dataset.pf === "sub") { f.ch = ""; f.leaf = ""; }
    if (el.dataset.pf === "ch") f.leaf = "";
    render();
  } else if (el.dataset.popt) {
    ui.pq.given = el.dataset.popt;
  } else if (el.dataset.ait !== undefined) {
    ui.adm.items[+el.dataset.ait][el.dataset.k] = el.value;
  } else if (el.id === "aFiles") {
    addFiles([...el.files]); el.value = "";
  } else if (el.id === "aImport") {
    if (el.files[0]) importBank(el.files[0]); el.value = "";
  } else if (el.id === "aLeaf") ui.adm.leaf = el.value;
  else if (el.id === "aSrc") ui.adm.src = el.value;
  else if (el.id === "aKey") {
    ui.adm.key = el.value;
    const k = el.value.toUpperCase().replace(/[^ABCD]/g, "");
    ui.adm.items.forEach((it, i) => { if (k[i]) it.ans = k[i]; });
    render();
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "aFilter") {
    ui.adm.filter = e.target.value;
    clearTimeout(renderAdmin._t);
    renderAdmin._t = setTimeout(() => { render(); const i = document.getElementById("aFilter"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
  }
});

// Paste a screenshot anywhere on the Admin tab.
document.addEventListener("paste", (e) => {
  if (ui.tab !== "admin" || !bank.canWrite) return;
  const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); addFiles(files); }
});
document.addEventListener("dragover", (e) => { if (ui.tab === "admin" && e.target.closest("#aDrop")) { e.preventDefault(); e.target.closest("#aDrop").classList.add("over"); } });
document.addEventListener("dragleave", (e) => { const d = e.target.closest && e.target.closest("#aDrop"); if (d) d.classList.remove("over"); });
document.addEventListener("drop", (e) => {
  const d = e.target.closest && e.target.closest("#aDrop");
  if (!d) return;
  e.preventDefault(); d.classList.remove("over");
  addFiles([...e.dataTransfer.files]);
});

// Keyboard: 1–4 / A–D choose, Enter submits / next.
document.addEventListener("keydown", (e) => {
  if (ui.tab !== "practice" || !ui.pq.list || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const P = ui.pq;
  const k = e.key.toUpperCase();
  const map = { 1: "A", 2: "B", 3: "C", 4: "D", A: "A", B: "B", C: "C", D: "D" };
  if (!P.res && map[k]) { P.given = map[k]; const r = document.querySelector(`[data-popt="${map[k]}"]`); if (r) r.checked = true; }
  else if (e.key === "Enter") { const b = document.querySelector(P.res ? '[data-pact="next"]' : '[data-pact="submit"]'); if (b) b.click(); }
});

// Live question timer.
setInterval(() => {
  const t = document.getElementById("qTimer");
  if (!t || !ui.pq.list || ui.pq.res) return;
  const s = Math.round((Date.now() - ui.pq.t0) / 1000);
  t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}, 1000);

VIEWS.practice = renderPractice;
VIEWS.admin = renderAdmin;
if (location.hash === "#practice" || location.hash === "#admin") go(location.hash.slice(1));
initBank();
