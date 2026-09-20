#!/usr/bin/env node
// Layout audit for apps/auto-battle-rpg.
//
// The UI is DOM now, so the old canvas text-overlap check no longer applies.
// What can still go wrong is text that gets clipped by its box, controls that
// are too small to tap, and anything that pushes the page sideways. This walks
// every screen with all cards unlocked (the longest names and descriptions on
// screen) and reports those.
//
//   node dev-scripts/check-layout.js [url]

const { chromium } = require("playwright");

const URL = process.argv[2] || "http://localhost:8123/apps/auto-battle-rpg/index.html";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MIN_TAP = 40; // px; the design targets 48

const AUDIT = `(() => {
  const out = [];
  const seen = new Set();
  document.querySelectorAll("#app *").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return;

    // text clipped by its own box
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText && cs.overflow !== "visible") {
      if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis") {
        out.push({ kind: "clip", text: el.textContent.trim().slice(0, 28), w: el.clientWidth, need: el.scrollWidth });
      }
      if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== "auto" && cs.overflowY !== "scroll") {
        out.push({ kind: "clipY", text: el.textContent.trim().slice(0, 28), h: el.clientHeight, need: el.scrollHeight });
      }
    }

    // anything hanging outside the app frame, unless it lives in a
    // horizontal scroller, where overflowing is the point
    const inScroller = (() => {
      for (let n = el.parentElement; n && n.id !== "app"; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX;
        if (o === "auto" || o === "scroll") return true;
      }
      return false;
    })();
    const app = document.getElementById("app").getBoundingClientRect();
    if (!inScroller && (r.right > app.right + 1 || r.left < app.left - 1)) {
      const key = "out:" + el.className + el.textContent.trim().slice(0, 12);
      if (!seen.has(key)) { seen.add(key);
        out.push({ kind: "outside", text: (el.textContent.trim() || el.className).slice(0, 28),
                   left: Math.round(r.left - app.left), right: Math.round(r.right - app.right) }); }
    }

    // tap targets
    if (el.matches("button, [role=button]") && !el.disabled) {
      if (r.height < ${MIN_TAP} || r.width < ${MIN_TAP}) {
        out.push({ kind: "tiny", text: (el.textContent.trim() || el.getAttribute("aria-label") || el.className).slice(0, 28),
                   w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
  });
  // horizontal page scroll
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    out.push({ kind: "hscroll", text: "ページが横スクロールしています",
               w: document.documentElement.scrollWidth, need: window.innerWidth });
  }
  return out;
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--headless=new", "--no-sandbox"] });
  const findings = [];

  // narrow and wide phones: text wrapping differs enough to hide bugs
  for (const vp of [{ width: 320, height: 640 }, { width: 390, height: 800 }, { width: 430, height: 900 }]) {
    const page = await browser.newPage({ viewport: vp, hasTouch: true, isMobile: true });
    page.on("pageerror", (e) => findings.push(`[${vp.width}px] JSエラー: ${e}`));
    await page.goto(URL);
    await page.evaluate(() => localStorage.setItem("abrpg.save.v2", JSON.stringify({
      cleared: [1, 2, 3, 4], seen: [1, 2, 3, 4, 5],
      decks: { 5: ["ifPinch", "power", "attack", "ifStrong", "guard", "attack"] },
    })));
    await page.reload();
    await page.waitForTimeout(400);

    const audit = async (name) => {
      await page.waitForTimeout(160);
      const hits = await page.evaluate(AUDIT);
      hits.forEach((f) => {
        const where = `[${vp.width}px] ${name}`;
        if (f.kind === "clip") findings.push(`${where}: 「${f.text}」が幅に収まっていません (${f.w}px 枠 / ${f.need}px 必要)`);
        else if (f.kind === "clipY") findings.push(`${where}: 「${f.text}」が高さに収まっていません (${f.h}px 枠 / ${f.need}px 必要)`);
        else if (f.kind === "outside") findings.push(`${where}: 「${f.text}」が画面の外に出ています (左${f.left} 右${f.right})`);
        else if (f.kind === "tiny") findings.push(`${where}: 「${f.text}」のタップ領域が小さすぎます (${f.w}x${f.h}px)`);
        else if (f.kind === "hscroll") findings.push(`${where}: ${f.text} (${f.w}px / ${f.need}px)`);
      });
    };

    const click = async (sel, wait = 320) => { await page.locator(sel).first().click(); await page.waitForTimeout(wait); };
    const byName = async (name, wait = 320) => {
      await page.getByRole("button", { name }).first().click();
      await page.waitForTimeout(wait);
    };

    await audit("タイトル");
    await byName("あそびかた"); await audit("あそびかた");
    await byName("とじる");
    await byName("はじめる"); await audit("ステージ");

    for (let i = 0; i < 5; i++) {
      await page.locator(".stage").nth(i).click(); await page.waitForTimeout(300);
      await audit(`てき情報(${i + 1})`);
      await byName("さくせんへ"); await audit(`さくせん(${i + 1})`);

      await page.locator(".slot .main").first().click(); await page.waitForTimeout(300);
      await audit(`カードえらび(${i + 1})`);
      await byName("やめる");

      const plan = page.getByRole("button", { name: "ためしうち" });
      if (await plan.isEnabled()) { await plan.click(); await page.waitForTimeout(300); await audit(`ためしうち(${i + 1})`); await byName("さくせんへ"); }

      await byName("たたかう", 500); await audit(`バトル(${i + 1})`);
      await byName("さいごまで", 500); await audit(`バトル終了(${i + 1})`);
      await byName("けっかを見る", 400); await audit(`けっか(${i + 1})`);
      await byName("ステージへ");
    }
    await page.close();
  }

  await browser.close();

  const uniq = [...new Set(findings)];
  if (uniq.length) {
    console.log("レイアウトの問題が見つかりました:\n");
    uniq.forEach((f) => console.log("  ✗ " + f));
    process.exit(1);
  }
  console.log("✓ 全画面・3つの画面幅で、文字の切れ・はみ出し・小さすぎるタップ領域なし");
})();
