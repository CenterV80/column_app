#!/usr/bin/env node
// Interaction check for apps/auto-battle-rpg.
//
// The deck screen carries the game: tapping a slot swaps the card, dragging
// the handle reorders it, and order is what decides a battle. This drives
// those gestures for real and asserts the deck that comes out.
//
//   node dev-scripts/check-touch-gestures.js [url]

const { chromium } = require("playwright");

const URL = process.argv[2] || "http://localhost:8123/apps/auto-battle-rpg/index.html";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(got)}${ok ? "" : "  期待: " + JSON.stringify(want)}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--headless=new", "--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(URL);
  await page.evaluate(() => localStorage.setItem("abrpg.save.v2", JSON.stringify({
    cleared: [1, 2, 3, 4], seen: [1, 2, 3, 4, 5],
    decks: { 5: ["attack", "heal", "guard"] },
  })));
  await page.reload();
  await page.waitForTimeout(400);

  const state = () => page.evaluate(() => window.__abrpg);
  const deck = async () => (await state()).deck;
  const byName = async (n, w = 320) => { await page.getByRole("button", { name: n }).first().click(); await page.waitForTimeout(w); };

  await byName("はじめる");
  await page.locator(".stage").nth(4).click();
  await page.waitForTimeout(300);
  await byName("さくせんへ");
  check("保存されたデッキを読み込む", await deck(), ["attack", "heal", "guard"]);

  // drag slot 1 down past slot 3
  async function dragSlot(from, dy) {
    const handle = page.locator(".slot .handle").nth(from);
    const b = await handle.boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 6, { steps: 3 });
    await page.mouse.move(cx, cy + dy, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(350);
  }
  const rowH = await page.locator(".slot").first().evaluate((el) => el.getBoundingClientRect().height + 8);
  await dragSlot(0, rowH * 2);
  check("ハンドルを下へドラッグして並べ替え", await deck(), ["heal", "guard", "attack"]);
  await dragSlot(2, -rowH * 2);
  check("元に戻す", await deck(), ["attack", "heal", "guard"]);

  // tap a slot body -> picker -> choose a card replaces that slot
  await page.locator(".slot .main").nth(1).click();
  await page.waitForTimeout(300);
  check("スロットをタップでカード選択へ", (await state()).screen, "pick");
  await page.locator(".pick:not(.locked)").first().click();
  await page.waitForTimeout(300);
  check("選んだカードがそのスロットに入る", (await deck())[1], "attack");

  // add into the empty slot at the end
  await page.getByText("＋ カードを追加").click();
  await page.waitForTimeout(300);
  await page.locator(".pick:not(.locked)").nth(1).click();
  await page.waitForTimeout(300);
  check("空きスロットへの追加", (await deck()).length, 4);

  // delete
  await page.locator(".slot .del").nth(3).click();
  await page.waitForTimeout(300);
  check("削除", (await deck()).length, 3);

  // persistence
  await page.reload();
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("abrpg.save.v2")).decks["5"]);
  check("リロード後も保存されている", saved, ["attack", "attack", "guard"]);

  // a battle still runs end to end from the rebuilt deck
  await byName("はじめる");
  await page.locator(".stage").nth(0).click();
  await page.waitForTimeout(300);
  await byName("さくせんへ");
  await byName("たたかう", 600);
  await byName("さいごまで", 600);
  await byName("けっかを見る", 400);
  check("バトルが最後まで進む", (await state()).screen, "result");

  if (errors.length) { failures++; console.log("  ✗ JSエラー:", errors); }
  await browser.close();

  console.log(failures ? `\n${failures} 件失敗` : "\n✓ タップ・ドラッグ・削除・保存すべて期待どおり");
  process.exit(failures ? 1 : 0);
})();
