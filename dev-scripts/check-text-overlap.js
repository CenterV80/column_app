#!/usr/bin/env node
// Text-collision audit for apps/auto-battle-rpg.
//
// The game draws to a canvas at fixed coordinates, so a card name that is
// wider than its slot silently overlaps the text next to it — which is
// exactly what shipped once. This wraps fillText, walks every screen with
// the save file unlocked (longest card names present), and reports any two
// strings whose boxes intersect, plus any string that leaves the 320x288
// screen.
//
//   node dev-scripts/check-text-overlap.js [url]

const { chromium } = require("playwright");

const URL = process.argv[2] || "http://localhost:8123/apps/auto-battle-rpg/index.html";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const W = 320, H = 288;

const RECORDER = `
  window.__texts = [];
  window.__lastFrame = [];
  const proto = CanvasRenderingContext2D.prototype;
  const origText = proto.fillText;
  proto.fillText = function (s, x, y) {
    if (this.canvas && this.canvas.id === "screen" && String(s).trim()) {
      const size = parseInt(this.font, 10) || 16;
      window.__texts.push({ s: String(s), x, y, w: this.measureText(s).width, h: size });
    }
    return origText.apply(this, arguments);
  };
  // The game ends every frame by flushing the quantized image, so that call
  // is the frame boundary: it closes the batch we just recorded.
  const origPut = proto.putImageData;
  proto.putImageData = function () {
    if (this.canvas && this.canvas.id === "screen") {
      window.__lastFrame = window.__texts;
      window.__texts = [];
    }
    return origPut.apply(this, arguments);
  };
  window.__grab = () => window.__lastFrame.slice();
`;

// Two labels on the same row overlap when both their x and y ranges intersect.
// A string drawn twice a few pixels apart is a deliberate drop shadow.
function isShadowPair(a, b) {
  return a.s === b.s && Math.abs(a.x - b.x) <= 4 && Math.abs(a.y - b.y) <= 4;
}

function overlaps(a, b) {
  const ax2 = a.x + a.w, ay2 = a.y + a.h;
  const bx2 = b.x + b.w, by2 = b.y + b.h;
  const ix = Math.min(ax2, bx2) - Math.max(a.x, b.x);
  const iy = Math.min(ay2, by2) - Math.max(a.y, b.y);
  return ix > 1 && iy > 1;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--headless=new", "--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
  await page.addInitScript(RECORDER);
  await page.goto(URL);

  // Unlock everything so the widest card names and longest hints are on screen.
  await page.evaluate(() => localStorage.setItem("abrpg.save.v2", JSON.stringify({
    cleared: [1, 2, 3, 4, 5],
    seen: [1, 2, 3, 4, 5],
    decks: { 5: ["ifPinch", "power", "attack", "ifStrong", "guard", "attack"] },
  })));
  await page.reload();
  await page.waitForTimeout(1500);

  const key = async (k, wait = 260) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };

  const findings = [];
  async function audit(name) {
    await page.waitForTimeout(220);
    const items = await page.evaluate(() => window.__grab());
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (!isShadowPair(items[i], items[j]) && overlaps(items[i], items[j])) {
          findings.push(`${name}: 「${items[i].s}」と「${items[j].s}」が重なっています ` +
            `(x=${Math.round(items[i].x)},${Math.round(items[j].x)} y=${Math.round(items[i].y)})`);
        }
      }
    }
    items.forEach((t) => {
      if (t.x < 0 || t.y < 0 || t.x + t.w > W + 1 || t.y + t.h > H + 1) {
        findings.push(`${name}: 「${t.s}」が画面外にはみ出しています ` +
          `(x=${Math.round(t.x)}..${Math.round(t.x + t.w)}, 画面幅${W})`);
      }
    });
  }

  await audit("タイトル");
  await key("Shift");
  for (let i = 0; i < 4; i++) { await audit("あそびかた" + (i + 1)); await key("z"); }
  await key("Enter"); await audit("マップ");

  for (const stage of [0, 1, 2, 3, 4]) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    for (let i = 0; i < stage; i++) await key("ArrowDown", 120);
    await key("z"); await audit("てき情報(" + (stage + 1) + ")");
    await key("z"); await audit("さくせん(" + (stage + 1) + ")");
    await key("z"); await audit("カードえらび(" + (stage + 1) + ")");
    for (let i = 0; i < 9; i++) { await key("ArrowDown", 90); await audit("カードえらび(" + (stage + 1) + ")-" + i); }
    await key("x");
    await key("Enter", 700); await audit("バトル(" + (stage + 1) + ")");
    await key("Enter", 700); await audit("バトル終了(" + (stage + 1) + ")");
    await key("z", 500); await audit("リザルト(" + (stage + 1) + ")");
    await key("x", 300);
  }

  await browser.close();

  if (findings.length) {
    console.log("文字の重なり/はみ出しが見つかりました:\n");
    [...new Set(findings)].forEach((f) => console.log("  ✗ " + f));
    process.exit(1);
  }
  console.log("✓ 全画面で文字の重なり・画面外はみ出しなし");
})();
