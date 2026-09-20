const { chromium } = require('playwright');
// Verifies the touch gestures that replaced the D-pad: tap-to-edit a slot,
// drag-to-reorder, tap-to-delete, and that progression still persists.
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--headless=new','--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/apps/auto-battle-rpg/index.html');
  await page.evaluate(() => localStorage.setItem('abrpg.save.v2', JSON.stringify({
    cleared: [1,2,3,4], seen: [1,2,3,4,5], decks: { 5: ['attack','heal','guard'] } })));
  await page.reload(); await page.waitForTimeout(1500);

  const cv = page.locator('#screen');
  const L = async (lx, ly) => { const b = await cv.boundingBox(); return [b.x + lx/320*b.width, b.y + ly/512*b.height]; };
  const tap = async (lx, ly, w=300) => { const [x,y] = await L(lx,ly); await page.mouse.click(x,y); await page.waitForTimeout(w); };
  const drag = async (lx, ly, ly2) => {
    const [x,y] = await L(lx,ly); const [,y2] = await L(lx,ly2);
    await page.mouse.move(x,y); await page.mouse.down();
    await page.mouse.move(x, y-6, {steps:3}); await page.mouse.move(x, y2, {steps:14});
    await page.mouse.up(); await page.waitForTimeout(350);
  };
  const deck = () => page.evaluate(() => window.__abrpgDeck);
  const screen = () => page.evaluate(() => window.__abrpgScreen);

  await tap(160, 384);                 // はじめる
  await tap(160, 93 + 4*74);           // stage 5
  await tap(238, 426);                 // さくせんへ
  console.log('1. 初期デッキ:', (await deck()).join(','));

  await drag(120, 144, 240);           // slot1 -> position 3
  console.log('2. ドラッグ後  :', (await deck()).join(','), '(attack が下がれば成功)');

  await drag(120, 240, 140);           // back up
  console.log('3. 戻す        :', (await deck()).join(','));

  await tap(120, 288);                 // slot 4 (empty) -> picker
  console.log('4. 画面        :', await screen());
  await tap(83, 306);                  // ためる? tile (row 5, col 1 => i=8)
  console.log('5. カード追加  :', (await deck()).join(','));

  await tap(285, 288);                 // けす on slot 4
  console.log('6. 削除後      :', (await deck()).join(','));

  await tap(80, 485);                  // ためしうち
  console.log('7. 画面        :', await screen());
  await tap(80, 470);                  // さくせんへ
  await page.reload(); await page.waitForTimeout(1400);
  console.log('8. リロード後の保存:', JSON.stringify((await page.evaluate(() => JSON.parse(localStorage.getItem('abrpg.save.v2')).decks['5']))));

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();
