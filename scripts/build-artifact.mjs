// Bundles index.html + css + js into one self-contained page for claude.ai
// artifacts (the publish step adds its own doctype/head/body skeleton).
// Usage: node scripts/build-artifact.mjs  →  dist/nimcet-tracker.html
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const title = html.match(/<title>([\s\S]*?)<\/title>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const css = readFileSync("css/style.css", "utf8");
const scripts = [...body.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const js = scripts.map((f) => `/* ${f} */\n` + readFileSync(f, "utf8")).join("\n");
const markup = body.replace(/\s*<script src="[^"]+"><\/script>/g, "").trim();

const out = `<title>${title}</title>
<style>
${css}
</style>
${markup}
<script>
${js.replace(/<\/script/gi, "<\\/script")}
</script>
`;
mkdirSync("dist", { recursive: true });
writeFileSync("dist/nimcet-tracker.html", out);
console.log(`dist/nimcet-tracker.html ${(out.length / 1024).toFixed(0)} KB`);
