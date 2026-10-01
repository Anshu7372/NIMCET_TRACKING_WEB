/*
 * NIMCET PYQ papers (built-in practice bank). Rows come from pyq2025.js and
 * pyq2026.js; this file turns them into question objects and per-subtopic
 * counts used for weightage, depth and the syllabus badges.
 */
// Numbering restarts per section; Computer (1–20) and English (21–30) share the last section.
const PYQ_SECTIONS = [
  { id: "M", name: "Mathematics", from: 1, to: 50, offset: 0 },
  { id: "R", name: "Analytical Ability & Logical Reasoning", from: 51, to: 90, offset: 50 },
  { id: "C", name: "Computer Awareness", from: 91, to: 110, offset: 90 },
  { id: "E", name: "General English", from: 111, to: 120, offset: 90 },
];

function buildPaper(year, date, rows) {
  return {
    year, date, label: `NIMCET ${year}`,
    qs: rows.map(([n, leaf, d, ans, key, trap, flag, off, oos]) => {
      const sec = PYQ_SECTIONS.find((s) => n >= s.from && n <= s.to);
      return { year, n, leaf: leaf || "", d, ans, key, trap: trap && trap !== "—" ? trap : "", flag: flag || "", off: off || "", oos: oos || "",
        sec: sec.id, paperQ: n - sec.offset, secName: sec.name };
    }),
  };
}

const PYQ_PAPERS = [
  buildPaper(2026, "2026-06-06", PYQ_2026_ROWS),
  buildPaper(2025, "2025-06-08", PYQ_2025_ROWS),
];
const PYQ_2026 = PYQ_PAPERS[0];
const PYQ_ALL = PYQ_PAPERS.flatMap((p) => p.qs);

// Per subtopic: questions asked (in-syllabus only), per year and the highest depth asked.
const PYQ_COUNTS = {};
for (const q of PYQ_ALL) {
  if (!q.leaf) continue;
  const c = (PYQ_COUNTS[q.leaf] = PYQ_COUNTS[q.leaf] || { n: 0, d: 0, byYear: {}, refs: [] });
  c.n++;
  c.byYear[q.year] = (c.byYear[q.year] || 0) + 1;
  c.d = Math.max(c.d, q.d);
  c.refs.push(`${q.year}-${q.n}`);
}
