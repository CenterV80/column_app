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

// The category link only exists inside the site; drop that line, keep the
// keyboard help around it.
cut(/\s*<br>\s*\n\s*<a href="\.\.\/\.\.\/categories\/mini-apps\/index\.html">[^<]*<\/a>\s*\n/, "category link");

fs.writeFileSync(out, html.trimStart());
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)}KB)`);
