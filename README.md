# NIMCET Rank 1 Tracker

**Live:** https://anshu7372.github.io/NIMCET_TRACKING_WEB/

A study tracker for **NIMCET 2027** built around **4 hours a day** (changeable in Settings). You only study. The tracker does the planning.

It is a static web app with no build step and no backend. Open `index.html`, or host it on GitHub Pages. Data is stored in your browser (localStorage). Use **Settings → Export** weekly as a backup.

## What's inside

| Tab | What it does |
|---|---|
| **Today** | Today's plan in 4 pomodoros. Each task names the book, the subtopic, the exact question range and the think-time rule. Ticking a task updates progress, question counts and the revision schedule. |
| **Plan** | Phase dates, daily/weekly templates, a month-by-month roadmap and a day-by-day schedule. The schedule is recalculated from your *actual* progress, so a missed day shifts the plan automatically. |
| **Syllabus** | Revised NIMCET syllabus (w.e.f. 2026), 169 subtopics in the order Subject → Chapter → Topic → Subtopic. Each has a depth level (D1/D2/D3), NEED/SKIP lists, estimated weightage, question targets (NCERT exercise / JEE Main PYQ / NIMCET PYQ, or test-series topic tests for non-maths), tricks, prerequisites, notes, confidence and a ★ tough flag. |
| **Revision** | Spaced revision (1-3-7-15-30-60-90 days; tough topics 1-2-4-7-12-20-30-45), Again/Hard/Good/Easy rating, the revision-pomodoro method, and all revision types. |
| **Tough & Mistakes** | ★ tough topics come up in revision more often. The mistake log re-surfaces each mistake at 1-3-7-21 days until you solve it 4 times. Analytics show where your mistakes happen. |
| **Practice Questions** | GATE-tracker style quiz on your own uploaded questions: filter by subject/chapter/subtopic, timer, A–D options (keys 1–4 + Enter), auto-check, "possible galti" diagnosis, reason buttons, and a Claude prompt. Wrong answers go to the mistake log automatically and come back for re-solve after 1-3-7-21 days; 3 wrong in one subtopic marks it ★ tough. |
| **Admin** | Upload question images (choose, drag-drop or paste a screenshot) with the correct option. No code needed. Answer key for many images at once (`ACBD`), source numbering auto-increments, edit/delete, export/import. On claude.ai questions are stored in the artifact (db + assets, owner-only upload); on GitHub Pages they stay in this browser (IndexedDB). |
| **Mocks** | Section-wise entry, NIMCET marking (+12/−3, +6/−1.5, +4/−1), score and accuracy trends, auto insights, analysis checklist and the 3-pass strategy. |
| **Claude** | A master teaching prompt, a per-subtopic prompt (depth, NEED/SKIP, your mistakes, your learning profile), a hint-only prompt, and mistake/mock/weekly-review prompts. |
| **Speed Kit** | Things to master first (squares, trig values, logs, the hex table…), the problem-solving protocol per depth level, and speed tricks by chapter. |

## Plan structure (4 hrs/day, target NIMCET 2027)

- **Mon–Sat:**
  - P1: speed drill + spaced revision
  - P2–P3: new Maths (NCERT lecture → NCERT exercise → JEE Main PYQs → NIMCET PYQs)
  - P4: Reasoning (Mon/Wed/Fri) · Computer (Tue/Thu) · English (Sat)
  - 5-minute recap
- **Sunday:** weekly revision. On the last Sunday of the month: a monthly test.
- **Phase 1:** full syllabus plus topic-wise PYQs (~410 h, ~7500 questions).

Resources used: NCERT lectures + exercises, JEE Main PYQs, NIMCET PYQs and a test series (topic tests + full mocks). No other books.
- **Phase 2:** 6 reserved PYQ papers (2020–2025), each as a paper day followed by an analysis day.
- **Phase 3:** 30 full mocks, each as a mock day, then analysis + fix, then a revision day.
- **Phase 4:** maintenance until the exam. The last 14 days are final revision.

At 4 hrs/day (110 min maths + 55 min second subject + 30 min spaced revision + speed drill/recap/breaks) the syllabus finishes around **late March 2027**, followed by 6 reserved PYQ papers, ~30 full mocks (mock + analysis + fix on one day, revision the next) and 14 days of final revision before NIMCET 2027 (~6 June 2027, update the date when the notification is out).

> Weightage figures are estimates from PYQ trends, not official numbers. Check the syllabus and exam date against the official notification (nimcet.admissions.nic.in) every year.

## NIMCET PYQ bank (2025 + 2026)

`js/pyq2025.js` and `js/pyq2026.js` hold all 120 questions of the actual NIMCET 2025 (8 June) and 2026 (6 June) papers: subtopic, depth asked, verified answer, key idea, common trap and flags. `js/pyq.js` builds the bank and per-subtopic counts. `pyq/<year>/q<n>.webp` are the question + option images, re-assembled from the response sheets' own images without answer ticks, candidate details or watermark.

- Every official-key answer was re-solved. 2025: all keys agree (8 questions carry an ambiguity note). 2026: Q107 uses the verified answer B (official key A looks wrong); Q44, Q62, Q74 carry a note.
- 13 questions of 2025 are outside the revised 2026 syllabus (vectors, normal/Poisson distribution, C programming, pipelining/TLB, compiler design, microprogramming, I/O organisation). They sit in the "Out of syllabus" practice set and are not added to the mistake log.
- Subtopic weightage = 50% estimate + 50% average questions per real paper; depth is raised to the level asked.

## Books

Maths uses only NCERT (topic-wise class/chapter/edition table in the Syllabus tab), JEE Main PYQs and NIMCET PYQs. Other sections (chapter lists in the Guide tab):

- Reasoning: R.S. Aggarwal, A Modern Approach to Verbal & Non-Verbal Reasoning (S. Chand, latest revised edition)
- Aptitude: R.S. Aggarwal, Quantitative Aptitude for Competitive Examinations (S. Chand, latest revised edition)
- Computer: Pradeep K. Sinha & Priti Sinha, Computer Fundamentals (BPB, 6th edition)
- English: Arihant, Objective General English by S.P. Bakshi (2026-27 edition)

## claude.ai artifact version

`node scripts/build-artifact.mjs` bundles everything into `dist/nimcet-tracker.html`, a single self-contained page. Published as a claude.ai artifact, it saves progress to a private per-user document in your account (`db` + `user` capabilities), so the same link works on phone and laptop. Outside claude.ai it falls back to browser storage.

## Hosting on GitHub Pages

Go to Settings → Pages → Deploy from branch, and pick this branch with `/ (root)`.

## Files

- `js/data.js`: syllabus, depth/NEED/SKIP, weightage, tricks, protocols, revision types
- `js/engine.js`: targets, time budgets, spaced revision, day-by-day planner
- `js/prompts.js`: Claude prompt builders
- `js/app.js`: UI
- `css/style.css`: styles (light/dark)
