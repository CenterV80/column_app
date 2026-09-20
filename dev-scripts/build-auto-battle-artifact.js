#!/usr/bin/env node
// Derives the Artifact build of apps/auto-battle-rpg from the repo page.
//
// Artifacts are published as a fragment: the host wraps the file in its own
// <!doctype>/<head>/<body>, so the document tags and the in-repo navigation
// link have to come off. Everything else — styles, the inlined font, the
// game itself — is shared, so the two builds can never drift.
//
//   node dev-scripts/build-auto-battle-artifact.js [outfile]

const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "apps", "auto-battle-rpg", "index.html");
const out = process.argv[2] || path.join(__dirname, "..", "apps", "auto-battle-rpg", ".artifact.html");

let html = fs.readFileSync(src, "utf8");

const cut = (re, label) => {
  if (!re.test(html)) {
    console.error(`could not find ${label} — page structure changed`);
    process.exit(1);
  }
  html = html.replace(re, "");
};

cut(/<!DOCTYPE html>\s*/i, "doctype");
cut(/<html lang="ja">\s*/i, "<html>");
cut(/<head>\s*/i, "<head>");
cut(/<meta charset="UTF-8">\s*/i, "charset meta");
cut(/<meta name="viewport"[^>]*>\s*/i, "viewport meta");
cut(/<\/head>\s*/i, "</head>");
cut(/<body>\s*/i, "<body>");
cut(/<\/body>\s*/i, "</body>");
cut(/<\/html>\s*/i, "</html>");

// The category link only exists inside the site, so the whole footer goes.
cut(/\s*<p id="footer">[\s\S]*?<\/p>\s*\n/, "site footer");

// An artifact is a single file, so the key art has to travel inside it.
const artDir = path.join(__dirname, "..", "apps", "auto-battle-rpg", "art");
html = html.replace(/"art\/([\w.-]+)"/g, (m, name) => {
  const file = path.join(artDir, name);
  if (!fs.existsSync(file)) {
    console.error(`missing art file: ${name}`);
    process.exit(1);
  }
  const mime = name.endsWith(".webp") ? "image/webp" : name.endsWith(".png") ? "image/png" : "image/jpeg";
  const b64 = fs.readFileSync(file).toString("base64");
  console.log(`  inlined ${name} (${(b64.length / 1024).toFixed(0)}KB base64)`);
  return `"data:${mime};base64,${b64}"`;
});

fs.writeFileSync(out, html.trimStart());
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)}KB)`);
