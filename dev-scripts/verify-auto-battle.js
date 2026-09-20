#!/usr/bin/env node
// Balance checker for apps/auto-battle-rpg.
//
// The game is fully deterministic, so solvability is decidable: brute-force
// every deck orderable from the cards the player owns at each stage and
// report the shortest winning one. Run after touching card or stage numbers.
//
//   node dev-scripts/verify-auto-battle.js

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(
  path.join(__dirname, "..", "apps", "auto-battle-rpg", "index.html"),
  "utf8"
);

const START = "// ENGINE START";
const END = "// ENGINE END";
const from = html.indexOf(START);
const to = html.indexOf(END);
if (from < 0 || to < 0) {
  console.error("engine markers not found in index.html");
  process.exit(1);
}

const engineSrc = html.slice(from, to);
const factory = new Function(
  engineSrc + "\nreturn { CARDS, STAGES, START_CARDS, MAX_DECK, simulate };"
);
const { CARDS, STAGES, START_CARDS, MAX_DECK, simulate } = factory();

function poolFor(stageIndex) {
  const pool = START_CARDS.slice();
  for (let i = 0; i < stageIndex; i++) {
    STAGES[i].reward.forEach((c) => {
      if (pool.indexOf(c) < 0) pool.push(c);
    });
  }
  return pool;
}

// Enumerate every deck of length 1..maxLen over pool, shortest first.
function* decks(pool, maxLen) {
  for (let len = 1; len <= maxLen; len++) {
    const idx = new Array(len).fill(0);
    for (;;) {
      yield idx.map((i) => pool[i]);
      let p = len - 1;
      while (p >= 0) {
        idx[p]++;
        if (idx[p] < pool.length) break;
        idx[p] = 0;
        p--;
      }
      if (p < 0) break;
    }
  }
}

let allOk = true;

STAGES.forEach((stage, si) => {
  const pool = poolFor(si);
  const maxLen = Math.min(MAX_DECK, pool.length >= 8 ? 5 : 6);
  let tried = 0;
  let best = null;
  let wins = 0;

  for (const deck of decks(pool, maxLen)) {
    tried++;
    const r = simulate(stage, deck);
    if (r.result === "win") {
      wins++;
      if (!best) best = deck.slice();
    }
  }

  const rate = ((wins / tried) * 100).toFixed(2);
  if (!best) {
    allOk = false;
    console.log(
      `✗ ステージ${stage.id} ${stage.name}: 勝てるデッキなし ` +
        `(所持${pool.length}枚 / ${tried}通り検証)`
    );
    return;
  }

  console.log(
    `✓ ステージ${stage.id} ${stage.name.padEnd(6, "　")} ` +
      `所持${pool.length}枚 ${tried}通り中 勝ち${wins}通り (${rate}%)`
  );
  console.log(`    最短の解: ${best.map((c) => CARDS[c].name).join(" → ")}`);

  // A stage that almost anything beats has no puzzle in it; flag it.
  if (si > 0 && Number(rate) > 25) {
    console.log(`    ⚠ かんたんすぎる可能性 (勝率${rate}%)`);
  }
});

// Hints are written by hand and quote stage numbers. A hint that disagrees
// with the data it describes is shown to the player next to the real figure,
// so the numbers are checked here rather than by eye.
console.log("\nヒント文と実データの照合");
let hintOk = true;
STAGES.forEach((st) => {
  const facts = new Set([String(st.hp)]);
  if (st.armor) facts.add(String(st.armor));
  st.pattern.forEach((a) => { if (a.v) facts.add(String(a.v)); });
  st.pattern.forEach((a, i) => facts.add(String(i + 1)));
  facts.add(String(st.pattern.length));
  // small counting words ("1ターン", "1回") are prose, not data
  ["1", "2", "3"].forEach((n) => facts.add(n));
  const quoted = st.hint.match(/[0-9]+/g) || [];
  const bad = quoted.filter((n) => !facts.has(n));
  if (bad.length) {
    hintOk = false; allOk = false;
    console.log(`  ✗ ステージ${st.id} ${st.name}: ヒントの ${bad.join(", ")} が実データに存在しません` +
      ` (HP${st.hp} まもり${st.armor || 0} ${st.pattern.map((a) => (a.t + (a.v || ""))).join(" ")})`);
  }
});
if (hintOk) console.log("  ✓ 全ステージ、ヒントの数値は実データと一致");

// A card that never actually fires in any winning deck is a trap: it reads as
// an option but cannot be played. かいふく was exactly that before it became a
// once-per-battle resource, so this is now checked every run.
console.log("\nカードごとの実効性（勝ちデッキの中で実際に発動した回数）");
const FIRE = {
  attack: (e) => e.t === "attack",
  heal: (e) => e.t === "heal" && e.amt > 0,
  guard: (e) => e.t === "guard",
  reckless: (e) => e.t === "reckless",
  plus2: (e) => e.t === "boost" && e.card === "plus2",
  times2: (e) => e.t === "boost" && e.card === "times2",
  power: (e) => e.t === "boost" && e.card === "power",
  ifHalf: (e) => e.t === "cond" && e.card === "ifHalf" && e.ok,
  ifStrong: (e) => e.t === "cond" && e.card === "ifStrong" && e.ok,
  ifCharge: (e) => e.t === "cond" && e.card === "ifCharge" && e.ok,
  ifPinch: (e) => e.t === "cond" && e.card === "ifPinch" && e.ok,
};
const fired = {};
Object.keys(FIRE).forEach((id) => { fired[id] = 0; });
STAGES.forEach((stage, si) => {
  const pool = poolFor(si);
  const maxLen = Math.min(MAX_DECK, pool.length >= 8 ? 5 : 6);
  for (const deck of decks(pool, maxLen)) {
    const r = simulate(stage, deck);
    if (r.result !== "win") continue;
    Object.keys(FIRE).forEach((id) => {
      if (deck.indexOf(id) >= 0 && r.events.some(FIRE[id])) fired[id]++;
    });
  }
});
Object.keys(FIRE).forEach((id) => {
  const n = fired[id];
  const ok = n > 0;
  if (!ok) allOk = false;
  console.log(`  ${ok ? "✓" : "✗"} ${CARDS[id].name.padEnd(12, "　")} ${n} 通りの勝ちデッキで発動` +
    (ok ? "" : "  ← 使いようのない罠カードです"));
});

// The boss should demand the 累乗 combo, not raw attrition.
const boss = STAGES[STAGES.length - 1];
const noPower = poolFor(STAGES.length - 1).filter((c) => c !== "power");
let bossWinsWithoutPower = 0;
for (const deck of decks(noPower, 5)) {
  if (simulate(boss, deck).result === "win") bossWinsWithoutPower++;
}
console.log(
  `\nボス: るいじょう抜きの勝ちデッキ ${bossWinsWithoutPower}通り ` +
    (bossWinsWithoutPower === 0 ? "(想定どおり必須)" : "(必須ではない)")
);

process.exit(allOk ? 0 : 1);
