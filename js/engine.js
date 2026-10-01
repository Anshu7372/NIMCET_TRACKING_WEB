/*
 * Planning engine: question targets, time budgets, spaced revision and the
 * day-by-day schedule. Pure functions over (data, state) — no DOM here.
 */

const DAY_MS = 86400000;

/* ---------- dates (local, YYYY-MM-DD) ---------- */
function ymd(d) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function parseYmd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function diffDays(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / DAY_MS);
}
function todayStr() {
  return ymd(new Date());
}
function fmtDate(s, opts) {
  return parseYmd(s).toLocaleDateString("en-IN", opts || { day: "numeric", month: "short", year: "numeric" });
}

/* ---------- leaves ---------- */
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

// Subtopics the current NCERT does not cover — learn them from lecture/Claude
// and move their NCERT share to JEE Main PYQs.
const NO_NCERT_TOPICS = ["Logarithms", "Pair of Straight Lines", "Mathematical Logic"];
const NO_NCERT_LEAVES = [
  "Characteristic", "Common roots", "Location of roots",
  "Rank of a word", "Derangements", "Special matrices", "Rank of a matrix",
  "Sine rule", "Half-angle formulas", "Intermediate Value", "Moments",
];

const RULES = {
  // Maths: NCERT exercises → JEE Main PYQs (prac) → NIMCET PYQs.
  M: { learn: [25, 40, 55], ncert: [6, 10, 12], prac: (w, d) => Math.round(8 + 35 * w) + (d === 3 ? 5 : 0), minPerQ: 2.5, pracMinPerQ: 3, ncertMinPerQ: 3.5 },
  // Other subjects: lecture → test-series topic tests (prac) → NIMCET PYQs.
  R: { learn: [25, 35, 45], ncert: [0, 0, 0], prac: (w) => Math.round(10 + 25 * w), minPerQ: 1.5 },
  C: { learn: [30, 40, 50], ncert: [0, 0, 0], prac: (w) => Math.round(10 + 30 * w), minPerQ: 2 },
  E: { learn: [20, 20, 20], ncert: [0, 0, 0], prac: (w) => Math.round(10 + 20 * w), minPerQ: 1.5 },
};

function buildLeaves() {
  const leaves = [];
  CHAPTERS.forEach((ch, ci) => {
    ch.topics.forEach((tp) => {
      tp.leaves.forEach((lf) => {
        const [name, w0, d0, need, skip, tip] = lf;
        const id = `${ch.id}:${slug(name)}`;
        // Blend the PYQ-trend estimate with the real NIMCET 2026 paper, and never
        // keep the depth below the level that was actually asked.
        const y26 = typeof PYQ_COUNTS !== "undefined" && PYQ_COUNTS[id] ? PYQ_COUNTS[id] : null;
        const w = Math.round((0.6 * w0 + 0.4 * (y26 ? y26.n : 0)) * 10) / 10 || 0.1;
        const d = Math.max(d0, y26 ? y26.d : 0);
        const r = RULES[ch.subject];
        const noNcert =
          ch.subject !== "M" ||
          NO_NCERT_TOPICS.includes(tp.name) ||
          NO_NCERT_LEAVES.some((k) => name.startsWith(k));
        let ncert = noNcert ? 0 : r.ncert[d - 1];
        let prac = r.prac(w, d) + (ch.subject === "M" && noNcert ? r.ncert[d - 1] : 0);
        const pyq = Math.max(3, Math.round(12 * w));
        const learn = r.learn[d - 1];
        const ncertMin = r.ncertMinPerQ || r.minPerQ;
        const pracMin = r.pracMinPerQ || r.minPerQ;
        const mins = Math.round(learn + ncertMin * ncert + pracMin * prac + r.minPerQ * pyq);
        leaves.push({
          id,
          ch, chIndex: ci, topic: tp.name, name, w, w0, d, d0, y26, need, skip, tip: tip || "",
          target: { ncert, prac, pyq },
          learn, mins, minPerQ: r.minPerQ, ncertMinPerQ: ncertMin, pracMinPerQ: pracMin,
        });
      });
    });
  });
  return leaves;
}

const LEAVES = buildLeaves();
const LEAF = Object.fromEntries(LEAVES.map((l) => [l.id, l]));

function bookNames(leaf) {
  const s = leaf.ch.subject;
  if (s === "M") return { ncert: "NCERT exercise", prac: "JEE Main PYQs", pyq: "NIMCET PYQs" };
  return { ncert: "", prac: "Test series topic test", pyq: "NIMCET PYQs" };
}

/* Segments of a leaf in minutes: learn → NCERT → objective book → PYQ. */
function leafSegments(leaf) {
  const b = bookNames(leaf);
  const segs = [{ kind: "learn", mins: leaf.learn, q: 0, label: leaf.ch.subject === "M" && leaf.target.ncert ? "NCERT lecture + concept (Claude prompt for doubts)" : "Lecture / concept (Claude prompt)" }];
  if (leaf.target.ncert) segs.push({ kind: "ncert", mins: leaf.target.ncert * leaf.ncertMinPerQ, q: leaf.target.ncert, label: b.ncert });
  segs.push({ kind: "prac", mins: leaf.target.prac * leaf.pracMinPerQ, q: leaf.target.prac, label: b.prac });
  segs.push({ kind: "pyq", mins: leaf.target.pyq * leaf.minPerQ, q: leaf.target.pyq, label: b.pyq });
  return segs;
}

/* What falls inside minute range [a, b) of a leaf → list of concrete steps. */
function leafWork(leaf, a, b) {
  const out = [];
  let t = 0;
  for (const s of leafSegments(leaf)) {
    const s0 = t, s1 = t + s.mins;
    t = s1;
    const lo = Math.max(a, s0), hi = Math.min(b, s1);
    if (hi - lo < 0.5) continue;
    if (s.kind === "learn") {
      out.push({ kind: "learn", mins: hi - lo, text: `${s.label} — ${Math.round(hi - lo)} min` });
    } else {
      const q0 = Math.round(((lo - s0) / s.mins) * s.q) + 1;
      const q1 = Math.round(((hi - s0) / s.mins) * s.q);
      if (q1 < q0) { out.push({ kind: s.kind, mins: hi - lo, q: 0, text: `${s.label}: pichhla question poora karo` }); continue; }
      out.push({ kind: s.kind, mins: hi - lo, q: q1 - q0 + 1, from: q0, to: q1, of: s.q,
        text: `${s.label}: Q ${q0}–${q1} (${q1 - q0 + 1} Qs of ${s.q})` });
    }
  }
  return out;
}

/* ---------- totals ---------- */
function totals() {
  const bySub = {};
  for (const l of LEAVES) {
    const s = l.ch.subject;
    bySub[s] = bySub[s] || { mins: 0, qs: 0, leaves: 0, w: 0 };
    bySub[s].mins += l.mins;
    bySub[s].qs += l.target.ncert + l.target.prac + l.target.pyq;
    bySub[s].leaves++;
    bySub[s].w += l.w;
  }
  return bySub;
}

/* ---------- state helpers ---------- */
function lp(state, id) {
  if (!state.progress[id]) state.progress[id] = { mins: 0, qs: { ncert: 0, prac: 0, pyq: 0 }, status: "", conf: 0, tough: false, notes: "", rev: null };
  return state.progress[id];
}
function leafStatus(state, leaf) {
  const p = state.progress[leaf.id];
  if (!p) return "todo";
  if (p.status) return p.status;
  if (p.mins >= leaf.mins) return "done";
  if (p.mins > 0) return "doing";
  return "todo";
}
function leafDone(state, leaf) {
  const s = leafStatus(state, leaf);
  return s === "done" || s === "mastered";
}
function remainingMins(state, leaf) {
  if (leafDone(state, leaf)) return 0;
  const p = state.progress[leaf.id];
  return Math.max(0, leaf.mins - (p ? p.mins : 0));
}

/* ---------- spaced revision ---------- */
const INTERVALS = { normal: [1, 3, 7, 15, 30, 60, 90], tough: [1, 2, 4, 7, 12, 20, 30, 45] };
const MISTAKE_INTERVALS = [1, 3, 7, 21];

function startRevision(state, leaf, day) {
  const p = lp(state, leaf.id);
  if (!p.rev) p.rev = { stage: 0, due: addDays(day, 1), last: null, count: 0 };
}

function rateRevision(state, leafId, rating, day) {
  const p = lp(state, leafId);
  if (!p.rev) p.rev = { stage: 0, due: day, last: null, count: 0 };
  const iv = p.tough ? INTERVALS.tough : INTERVALS.normal;
  let stage = p.rev.stage;
  let gap;
  if (rating === "again") { stage = 0; gap = 1; p.conf = Math.max(1, (p.conf || 3) - 1); }
  else if (rating === "hard") { gap = Math.max(1, Math.round(iv[Math.min(stage, iv.length - 1)] * 0.5)); }
  else if (rating === "good") { stage = stage + 1; gap = iv[Math.min(stage, iv.length - 1)]; }
  else { stage = stage + 2; gap = iv[Math.min(stage, iv.length - 1)]; p.conf = Math.min(5, (p.conf || 3) + 1); }
  p.rev = { stage, due: addDays(day, gap), last: day, count: (p.rev.count || 0) + 1 };
  return gap;
}

function dueRevisions(state, day) {
  const due = [];
  for (const l of LEAVES) {
    const p = state.progress[l.id];
    if (p && p.rev && p.rev.due <= day) due.push(l);
  }
  const score = (l) => {
    const p = state.progress[l.id];
    return (p.tough ? 100 : 0) + diffDays(p.rev.due, day) * 2 + (5 - (p.conf || 3)) * 5;
  };
  return due.sort((a, b) => score(b) - score(a));
}

function dueMistakes(state, day) {
  return state.mistakes.filter((m) => !m.resolved && m.due <= day).sort((a, b) => (a.due < b.due ? -1 : 1));
}

function toughLeaves(state) {
  return LEAVES.filter((l) => state.progress[l.id] && state.progress[l.id].tough);
}

/* ---------- mocks ---------- */
function mockScore(m) {
  let total = 0;
  const secs = {};
  for (const s of SUBJECTS) {
    const x = (m.sections && m.sections[s.id]) || {};
    const att = +x.att || 0, cor = +x.cor || 0;
    const wrong = Math.max(0, att - cor);
    const score = cor * s.plus - wrong * s.minus;
    secs[s.id] = { att, cor, wrong, score, acc: att ? Math.round((cor / att) * 100) : 0, time: +x.time || 0, max: s.qs * s.plus, lost: wrong * (s.plus + s.minus) };
    total += score;
  }
  return { total, secs };
}

/* ---------- day template ---------- */
function dayBudget(perDay) {
  const big = perDay >= 210;                         // 3.5 h+ days get longer revision/recap
  const breaks = Math.round(perDay / 8);             // ~5 min per pomodoro
  const rev = big ? 30 : 20, recap = big ? 10 : 5;
  const fixed = 5 + rev + recap;                     // speed drill + spaced revision + recap
  const content = Math.max(20, perDay - breaks - fixed);
  const maths = Math.round((content * 2) / 3);
  return { breaks, speed: 5, rev, recap, maths, sec: content - maths, big };
}

const SEC_BY_WEEKDAY = { 1: "R", 2: "C", 3: "R", 4: "C", 5: "R", 6: "E" };

function isLastSundayOfMonth(day) {
  // Last occurrence of this weekday in its month.
  const d = parseYmd(day);
  return parseYmd(addDays(day, 7)).getMonth() !== d.getMonth();
}

/*
 * Simulate the plan from `from` for `days` days using a COPY of progress.
 * Returns day objects: { date, phase, kind, blocks: [{title, mins, tasks:[{leafId, a, b, steps}]|note}] }
 */
function simulate(state, from, days) {
  const s = state.settings;
  const budget = dayBudget(s.perDay);
  const rest = s.restDay; // 0 = Sunday
  const queues = { M: [], R: [], C: [], E: [] };
  const done = {};
  for (const l of LEAVES) {
    const rem = remainingMins(state, l);
    if (rem > 0) queues[l.ch.subject].push({ leaf: l, at: l.mins - rem });
    else done[l.id] = true;
  }
  let completedAny = LEAVES.some((l) => done[l.id]);
  let studiedAny = LEAVES.some((l) => state.progress[l.id] && state.progress[l.id].mins > 0);
  let papers = state.papersDone || 0;
  let mocks = state.mocksDone || 0;
  let cycle = state.cycleIndex || 0; // position inside the 2- or 3-day cycle
  const exam = s.examDate;
  const out = [];
  // Non-study days were written for 2 h; scale them to the daily time.
  const f = s.perDay / 120;
  const sc = (m) => Math.round(m * f);

  const take = (sub, mins) => {
    const tasks = [];
    let left = mins;
    const q = queues[sub];
    while (left > 0.5 && q.length) {
      const cur = q[0];
      const room = cur.leaf.mins - cur.at;
      const use = Math.min(room, left);
      tasks.push({ leafId: cur.leaf.id, a: cur.at, b: cur.at + use });
      studiedAny = true;
      cur.at += use;
      left -= use;
      if (cur.leaf.mins - cur.at < 0.5) { q.shift(); completedAny = true; }
    }
    return { tasks, left };
  };
  const contentLeft = () => queues.M.length + queues.R.length + queues.C.length + queues.E.length > 0;

  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const wd = parseYmd(date).getDay();
    const toExam = exam ? diffDays(date, exam) : 9999;
    const day = { date, blocks: [] };

    if (toExam === 0) {
      day.phase = "exam"; day.kind = "Exam day";
      day.blocks.push({ title: "NIMCET 🎯", mins: 0, note: "Light revision of formula cards only. 3-pass strategy. All the best!" });
      out.push(day); continue;
    }
    if (toExam < 0 && exam) {
      // After the target exam the plan still continues (useful if the exam is a dry run).
    }
    const finalWindow = toExam > 0 && toExam <= 14 && !contentLeft();

    if (wd === rest && studiedAny && !finalWindow) {
      day.phase = contentLeft() ? "p1" : finalWindow ? "final" : papers < MOCK_PLAN.reservedPyqYears.length ? "p2" : mocks < MOCK_PLAN.mockCount ? "p3" : "p4";
      if (isLastSundayOfMonth(date) && completedAny) {
        day.kind = "Monthly revision test";
        day.blocks.push(
          { title: "Monthly test (timed)", mins: sc(60), note: `Is mahine ke chapters se ${budget.big ? 60 : 30} mixed Qs (JEE Main + NIMCET PYQ level), timer ke saath.` },
          { title: "Test analysis", mins: sc(30), note: "Har galat Q → Mistakes tab. Weak subtopics ko ★ tough mark karo." },
          { title: "Weekly spaced revision backlog", mins: sc(30), note: "Due list clear karo + mistake log." },
        );
      } else {
        day.kind = "Weekly revision";
        day.blocks.push(
          { title: "Weekly revision: is hafte ke subtopics", mins: sc(50), note: "Har subtopic: blurt 2 min → formula sheet → 3 Qs.", weekly: true },
          { title: "Mistake log re-solve", mins: sc(25), note: "Is hafte ke galat questions bina solution dekhe." },
          { title: `${budget.big ? 40 : 20} mixed Qs (timed)`, mins: sc(25), note: "Maths 84 sec/Q pace. Galat → mistake log." },
          { title: "Formula sheet + speed kit", mins: sc(10), note: "Formula sheets update karo." },
        );
      }
      out.push(day); continue;
    }

    if (finalWindow) {
      day.phase = "final";
      const mockDay = toExam % 2 === 0;
      day.kind = mockDay ? "Final: mock" : "Final: revision";
      if (mockDay) {
        day.blocks.push({ title: "Full mock (2 hr, exam timing)", mins: 120, note: budget.big ? "Exam wale time (2–4 PM) pe do." : "Exam wale time (2–4 PM) pe do. Analysis kal subah 20 min." });
        if (budget.big) day.blocks.push({ title: "Mock analysis + formula sheet of weak topics", mins: s.perDay - 120, note: "Galtiyan → Mistakes tab. Sirf revise, naya kuch nahi." });
      } else {
        day.blocks.push({ title: "Final revision", mins: s.perDay, note: "Formula sheets → tough topics → mistake log (barabar time). Naya kuch nahi." });
      }
      out.push(day); continue;
    }

    if (contentLeft()) {
      day.phase = "p1"; day.kind = "Study day";
      let revMins = completedAny ? budget.rev : 0;
      const mathMins = budget.maths + (revMins ? 0 : budget.rev);
      day.blocks.push({ title: "Speed drill", mins: budget.speed, note: "Speed Kit tab se 1 item (squares/trig/log…)." });
      if (revMins) day.blocks.push({ title: "Spaced revision", mins: revMins, rev: true, note: "Due list + 1 tough topic + mistakes." });
      let m = take("M", mathMins);
      let secSub = SEC_BY_WEEKDAY[wd] || "R";
      const order = [secSub, ...["R", "C", "E"].filter((x) => x !== secSub)];
      let secMins = budget.sec + m.left;
      const secTasks = [];
      for (const sub of order) {
        if (secMins < 0.5) break;
        const r = take(sub, secMins);
        secTasks.push(...r.tasks);
        secMins = r.left;
      }
      if (secMins > 0.5) { const extra = take("M", secMins); m.tasks.push(...extra.tasks); }
      if (m.tasks.length) day.blocks.push({ title: "Maths — new", mins: m.tasks.reduce((x, t) => x + t.b - t.a, 0), tasks: m.tasks });
      if (secTasks.length) {
        const subs = [...new Set(secTasks.map((t) => LEAF[t.leafId].ch.subject))];
        day.blocks.push({ title: subs.map((x) => SUBJECTS.find((y) => y.id === x).name.split(" ")[0]).join(" + ") + " — new", mins: secTasks.reduce((x, t) => x + t.b - t.a, 0), tasks: secTasks });
      }
      day.blocks.push({ title: "Recap (blurting) + tracker update", mins: budget.recap, note: "Bina dekhe likho jo aaj padha. Galtiyan → Mistakes tab." });
      out.push(day); continue;
    }

    if (papers < MOCK_PLAN.reservedPyqYears.length) {
      day.phase = "p2";
      if (cycle % 2 === 0 && budget.big) {
        // Long day: paper + analysis + fix on the same day.
        day.kind = "PYQ paper + analysis";
        day.blocks.push(
          { title: `Full paper: NIMCET ${MOCK_PLAN.reservedPyqYears[papers]}`, mins: 120, note: "Exact exam timing & section timers. Mocks tab me score daalo (type: PYQ paper).", tag: "cycle" },
          { title: "Paper analysis", mins: 60, note: "Har galat/skipped Q ka reason (Mistakes tab). Section-wise time dekho.", tag: "paper-analysis" },
          { title: "Weak subtopic fix + spaced revision", mins: s.perDay - 180, rev: true },
        );
        papers++;
        cycle += 2;
        out.push(day); continue;
      }
      if (cycle % 2 === 0) {
        day.kind = "PYQ paper";
        day.blocks.push({ title: `Full paper: NIMCET ${MOCK_PLAN.reservedPyqYears[papers]}`, mins: 120, note: "Exact exam timing & section timers. Mocks tab me score daalo (type: PYQ paper).", tag: "cycle" });
      } else {
        day.kind = "Paper analysis";
        day.blocks.push(
          { title: "Paper analysis", mins: 60, note: "Har galat/skipped Q ka reason (Mistakes tab). Section-wise time dekho.", tag: "paper-analysis" },
          { title: "Weak subtopic fix", mins: 40, note: "Analysis me jo 2 subtopics weak nikle, unke 15–15 Qs." },
          { title: "Spaced revision", mins: 20, rev: true },
        );
        papers++;
      }
      cycle++;
      out.push(day); continue;
    }

    day.phase = mocks < MOCK_PLAN.mockCount ? "p3" : "p4";
    const c = cycle % 3;
    if (c === 0 && budget.big) {
      // Long day: mock + analysis + fix on the same day; next day is a revision day.
      day.kind = "Mock + analysis";
      day.blocks.push(
        { title: `Full mock #${mocks + 1}`, mins: 120, note: "Exam timing, 3-pass strategy. Mocks tab me score + mistakes.", tag: "cycle" },
        { title: "Mock analysis", mins: 60, note: "Mocks tab ka analysis checklist follow karo. Claude 'Mock analysis' prompt use karo.", tag: "mock-analysis" },
        { title: "Fix: weakest 2 subtopics", mins: s.perDay - 180, note: "15 Qs each (JEE Main / NIMCET PYQ), D-level protocol ke saath." },
      );
      mocks++;
      cycle += 2;
      out.push(day); continue;
    }
    if (c === 0) {
      day.kind = "Mock";
      day.blocks.push({ title: `Full mock #${mocks + 1}`, mins: 120, note: "Exam timing, 3-pass strategy. Mocks tab me score + mistakes.", tag: "cycle" });
    } else if (c === 1) {
      day.kind = "Mock analysis";
      day.blocks.push(
        { title: "Mock analysis", mins: 60, note: "Mocks tab ka analysis checklist follow karo. Claude 'Mock analysis' prompt use karo.", tag: "mock-analysis" },
        { title: "Fix: weakest 2 subtopics", mins: 40, note: "15 Qs each, D-level protocol ke saath." },
        { title: "Spaced revision", mins: 20, rev: true },
      );
      mocks++;
    } else {
      day.kind = "Revision & practice";
      day.blocks.push(
        { title: "Revision day: start", mins: 0, note: "Aaj revision day hai — tick karo shuru karne pe.", tag: "cycle" },
        { title: "Spaced revision + tough topics", mins: sc(45), rev: true },
        { title: "Mistake log re-solve", mins: sc(30) },
        { title: `Mixed timed practice (${budget.big ? 60 : 30} Qs)`, mins: sc(45), note: "Sab subjects mix, section time limits ke saath." },
      );
    }
    cycle++;
    out.push(day);
  }
  return out;
}

/* Horizon long enough to reach the end of the whole plan (or 2 years). */
function projection(state) {
  const from = todayStr();
  const days = simulate(state, from, 800);
  const last = (pred) => { for (let i = days.length - 1; i >= 0; i--) if (pred(days[i])) return days[i].date; return null; };
  const first = (pred) => { const d = days.find(pred); return d ? d.date : null; };
  return {
    days,
    p1End: last((d) => d.phase === "p1" && d.kind === "Study day"),
    p2Start: first((d) => d.phase === "p2"),
    p2End: last((d) => d.phase === "p2"),
    p3Start: first((d) => d.phase === "p3"),
    p3End: last((d) => d.phase === "p3"),
  };
}

const PHASES = {
  p1: { name: "Phase 1 · Syllabus + topic-wise PYQs", color: "#4f7cff" },
  p2: { name: "Phase 2 · Year-wise PYQ papers", color: "#16a37f" },
  p3: { name: "Phase 3 · Full mocks", color: "#d9822b" },
  p4: { name: "Phase 4 · Maintenance (mocks + weak areas)", color: "#b35fd6" },
  final: { name: "Final revision", color: "#e0485a" },
  exam: { name: "Exam", color: "#e0485a" },
};
