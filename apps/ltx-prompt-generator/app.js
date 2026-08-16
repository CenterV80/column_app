// WebLLM本体はモジュールの実行をブロックしないよう、動的import()で必要になった
// タイミング（モデル読み込み時）にのみ取得する。CDNへの接続に失敗しても
// フォーム・時間軸など他のUIは問題なく動作させるための対策。
const WEBLLM_CDN_URL = "https://esm.run/@mlc-ai/web-llm@0.2.84";
let webllmModulePromise = null;

function loadWebLLMModule() {
  if (!webllmModulePromise) {
    webllmModulePromise = import(WEBLLM_CDN_URL);
  }
  return webllmModulePromise;
}

// LTX-2.3 / LTX-2.5シングル / LTX-2.5マルチ の3つは、CLAUDE.mdに記録されている
// 過去の「複数モデルの仕様混同」の教訓を踏まえ、意図的に独立した定数として保持する。
// 内容を共有・使い回ししない。

const LTX23_SYSTEM_PROMPT = `あなたはLightricksの動画生成AI「LTX-2.3」向けのプロンプトを書く専門家です。
ユーザーは日本語で次の項目（メインアクション、動きの詳細、キャラクターと環境、カメラワークとライティング、任意で特筆すべき変化・出来事）と動画の長さ（秒）を入力します。

これらを踏まえ、LTX-2.3公式プロンプトガイドの構成に沿った英語プロンプトを1つ書いてください。

厳守事項:
- 出力は1つの流れる英語の段落。箇条書き・見出し・[camera: ...]のようなタグ形式は禁止。
- 要素の並び順は必ず「メインアクション → 精密な動き・モーションの詳細 → キャラクターと環境 → カメラワークとライティング（最後）」の順を守る。特筆すべき変化・出来事があれば、末尾に自然な形で織り込む。
- 全体でおよそ200語（英単語）以内。ただし入力情報が豊富なら200語に近い詳細な文章にしてよい（短すぎるより詳細な方が高品質）。
- 「2〜3秒に1つの主要な動作」が目安。指定された動画の長さに収まる数の動作に調整する。
- 出力は英語本文のみ。前置き・説明・日本語訳・タイトル・全体を囲む引用符は付けない。`;

const LTX25_SINGLE_SYSTEM_PROMPT = `あなたはLightricksの動画生成AI「LTX-2.5」向けのプロンプトを書く専門家です。今回は1カットの連続テイク「シングルショット」を作成します。
ユーザーは日本語で次の6項目（ショットタイプ、シーン・照明、アクション、キャラクター、カメラワーク、セリフ・音声）と、任意で動画の長さを入力します。

厳守事項:
- 出力は1つの流れる英語の段落。ショットリスト・番号付きビート・脚本のようなスラッグライン（[INT. ROOM - DAY]など）は使わない。
- 目安は4〜8文（入力が乏しければ短め、詳細なら長めでよい）。
- アクションは現在形の動詞で描写する（walks, turns, reaches など）。
- 感情は「sadly」のようなラベルではなく身体的な仕草で示す。
- カメラワークは、いつ・どう動くかに加え、動いた後の見え方も描写する。
- セリフは半角二重引用符 " " で囲み、言語・アクセントの指定があれば添える。
- 照明は1つの光源設定で一貫させ、混在させない。
- 出力は英語本文のみ。前置き・説明・日本語訳・タイトルは付けない。`;

const LTX25_MULTI_SYSTEM_PROMPT = `あなたはLightricksの動画生成AI「LTX-2.5」向けのプロンプトを書く専門家です。今回は2〜4カットをつなげた「マルチショット」を作成します。
ユーザーはカットごとに、シングルショットと同じ6項目（ショットタイプ、シーン・照明、アクション、キャラクター、カメラワーク、セリフ・音声）と各カットの秒数、任意で前のカットからの転換ヒントを入力し、末尾に任意でカットをまたいだ音声の連続性メモを入力します。

厳守事項:
- 出力全体は1つの流れる英語の文章（カットの切れ目のみ改行は許容）。番号付きショットリストにはしない。
- カットとカットの間には必ず明示的な転換表現を入れる（例: "The scene cuts to...", "In the next shot,..."）。転換ヒントが指定されていればそれを反映する。
- 各カットの冒頭でフレーミング（ショットタイプ・場所）を再提示し、前のカットからの続きだとわかるようにする。
- キャラクター・環境・照明・声・スタイルは、カットをまたいでも一貫性を保って描写する。
- 各カットの尺（秒）に見合った密度で描写する。
- カットをまたいだ音声の連続性が指定されていれば、文章内で明示する。
- セリフは半角二重引用符 " " で囲む。
- 出力は英語本文のみ。前置き・説明・日本語訳・タイトルは付けない。`;

const NEGATIVE_SYSTEM_PROMPT = `あなたはLTXシリーズの動画生成AI向けのネガティブプロンプトを書く専門家です。
直前に生成された英語のポジティブプロンプトと、ユーザーが入力した「避けたい要素」の日本語メモ（任意）をもとに、英語のネガティブプロンプトを1つ書いてください。

厳守事項:
- 5〜8個程度の明確な概念に絞る。40項目のような長いリストは禁止。
- カンマ区切りの単語・短い句のリストとして出力する（文章にしない）。
- 一般的な語（例: blurry, distorted hands, low resolution, watermark, lens flare）から、文脈上ほんとうに関連しそうなものだけを選ぶ。
- 出力はカンマ区切りリストのみ。前置き・説明・日本語は付けない。`;

const STORAGE_KEY = "ltx-prompt-generator-state";

const webgpuWarning = document.getElementById("webgpu-warning");
const mainGrid = document.getElementById("main-grid");

const versionSelect = document.getElementById("version-select");
const shotModeRow = document.getElementById("shot-mode-row");
const shotModeSelect = document.getElementById("shot-mode-select");
const cutCountRow = document.getElementById("cut-count-row");
const cutCountSelect = document.getElementById("cut-count-select");

const singleDurationRow = document.getElementById("single-duration-row");
const totalSecondsInput = document.getElementById("total-seconds");
const totalSecondsValue = document.getElementById("total-seconds-value");
const cutsDurationRow = document.getElementById("cuts-duration-row");
const timelineBar = document.getElementById("timeline-bar");

const promptForm = document.getElementById("prompt-form");
const fields23 = document.getElementById("fields-2-3");
const fields25 = document.getElementById("fields-2-5");
const singleFields = document.getElementById("single-fields");
const cutsContainer = document.getElementById("cuts-container");
const multiContinuityRow = document.getElementById("multi-continuity-row");

const genNegativeCheckbox = document.getElementById("gen-negative");
const negativeHints = document.getElementById("negative-hints");
const generateBtn = document.getElementById("generate-btn");

const modelControls = document.getElementById("model-controls");
const modelSelect = document.getElementById("model-select");
const loadModelBtn = document.getElementById("load-model-btn");
const statusDiv = document.getElementById("status");
const loadProgress = document.getElementById("load-progress");

const outputSection = document.getElementById("output-section");
const outputPositive = document.getElementById("output-positive");
const copyPositiveBtn = document.getElementById("copy-positive-btn");
const outputNegativeCard = document.getElementById("output-negative-card");
const outputNegative = document.getElementById("output-negative");
const copyNegativeBtn = document.getElementById("copy-negative-btn");

let engine = null;

const state = {
  version: "2.5",
  shotMode: "single",
  cutCount: 2,
  totalSeconds: 6,
  cuts: [{ seconds: 3 }, { seconds: 3 }, { seconds: 3 }, { seconds: 3 }],
};

function updateStatus(text) {
  statusDiv.textContent = text;
}

function currentMode() {
  if (state.version === "2.3") return "2.3";
  return state.shotMode === "multi" ? "2.5-multi" : "2.5-single";
}

function checkWebGPU() {
  if (!("gpu" in navigator)) {
    webgpuWarning.hidden = false;
    modelControls.hidden = true;
    promptForm.hidden = true;
    updateStatus("WebGPU非対応のため利用できません");
    return false;
  }
  updateStatus("準備完了。モデルを読み込んでください");
  return true;
}

function renderTimelineBar() {
  timelineBar.innerHTML = "";
  if (currentMode() === "2.5-multi") {
    const activeCuts = state.cuts.slice(0, state.cutCount);
    const total = activeCuts.reduce((sum, c) => sum + (c?.seconds || 0), 0) || 1;
    activeCuts.forEach((c, i) => {
      const seconds = c?.seconds || 0;
      const seg = document.createElement("div");
      seg.className = "timeline-segment";
      seg.style.width = `${(seconds / total) * 100}%`;
      seg.textContent = `カット${i + 1} ${seconds}秒`;
      timelineBar.append(seg);
    });
  } else {
    const seg = document.createElement("div");
    seg.className = "timeline-segment";
    seg.style.width = "100%";
    seg.textContent = `${state.totalSeconds}秒`;
    timelineBar.append(seg);
  }
}

function renderCutBlocks(n) {
  cutsContainer.innerHTML = "";
  const fieldDefs = [
    ["shot-type", "ショットタイプ"],
    ["scene-lighting", "シーン・照明"],
    ["action", "アクション（現在形）"],
    ["character", "キャラクター"],
    ["camera", "カメラワーク"],
    ["audio", "セリフ・音声"],
  ];

  for (let i = 1; i <= n; i++) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "cut-block";
    fieldset.dataset.cut = String(i);

    const legend = document.createElement("legend");
    legend.textContent = `カット${i}`;
    fieldset.append(legend);

    const grid = document.createElement("div");
    grid.className = "field-grid";

    fieldDefs.forEach(([key, labelText]) => {
      const label = document.createElement("label");
      label.textContent = labelText;
      const textarea = document.createElement("textarea");
      textarea.id = `cut-${i}-${key}`;
      textarea.rows = 2;
      label.append(document.createElement("br"), textarea);
      grid.append(label);
    });

    if (i >= 2) {
      const label = document.createElement("label");
      label.textContent = "前のカットからの転換（任意）";
      const textarea = document.createElement("textarea");
      textarea.id = `cut-${i}-transition`;
      textarea.rows = 2;
      label.append(document.createElement("br"), textarea);
      grid.append(label);
    }

    fieldset.append(grid);
    cutsContainer.append(fieldset);
  }
}

function ensureCutBlocks(n) {
  if (cutsContainer.querySelectorAll("fieldset.cut-block").length === n) return;
  renderCutBlocks(n);
}

function renderCutsDurationRow() {
  cutsDurationRow.innerHTML = "";
  for (let i = 0; i < state.cutCount; i++) {
    const item = document.createElement("div");
    item.className = "cut-duration-item";

    const label = document.createElement("label");
    label.textContent = `カット${i + 1}`;
    label.htmlFor = `cut-seconds-${i + 1}`;

    const input = document.createElement("input");
    input.type = "number";
    input.id = `cut-seconds-${i + 1}`;
    input.min = "1";
    input.max = "15";
    input.value = state.cuts[i]?.seconds ?? 3;
    input.addEventListener("input", () => {
      state.cuts[i] = state.cuts[i] || {};
      state.cuts[i].seconds = Number(input.value) || 1;
      renderTimelineBar();
      saveState();
    });

    item.append(label, input);
    cutsDurationRow.append(item);
  }
}

function ensureCutsDurationRow() {
  if (cutsDurationRow.children.length === state.cutCount) return;
  renderCutsDurationRow();
}

function updateVisibility() {
  const mode = currentMode();

  shotModeRow.hidden = state.version !== "2.5";
  cutCountRow.hidden = mode !== "2.5-multi";

  fields23.hidden = mode !== "2.3";
  fields25.hidden = state.version !== "2.5";
  singleFields.hidden = mode !== "2.5-single";
  cutsContainer.hidden = mode !== "2.5-multi";
  multiContinuityRow.hidden = mode !== "2.5-multi";

  singleDurationRow.hidden = mode === "2.5-multi";
  cutsDurationRow.hidden = mode !== "2.5-multi";

  if (mode === "2.5-multi") {
    ensureCutBlocks(state.cutCount);
    ensureCutsDurationRow();
  }

  renderTimelineBar();
}

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

function buildPromptFor(mode) {
  if (mode === "2.3") {
    const user = `以下の入力をもとに、LTX-2.3向けの英語プロンプトを1つ生成してください。

[メインアクション]
${val("f23-main-action") || "指定なし"}
[動きの詳細]
${val("f23-motion") || "指定なし"}
[キャラクターと環境]
${val("f23-char-env") || "指定なし"}
[カメラワークとライティング]
${val("f23-camera-lighting") || "指定なし"}
[特筆すべき変化・出来事]
${val("f23-change") || "指定なし"}
[動画の長さ]
${state.totalSeconds}秒`;
    return { system: LTX23_SYSTEM_PROMPT, user };
  }

  if (mode === "2.5-single") {
    const user = `以下の入力をもとに、LTX-2.5（シングルショット）向けの英語プロンプトを1つ生成してください。

[ショットタイプ]
${val("f25-shot-type") || "指定なし"}
[シーン・照明]
${val("f25-scene-lighting") || "指定なし"}
[アクション]
${val("f25-action") || "指定なし"}
[キャラクター]
${val("f25-character") || "指定なし"}
[カメラワーク]
${val("f25-camera") || "指定なし"}
[セリフ・音声]
${val("f25-audio") || "指定なし"}
[動画の長さ（任意）]
${state.totalSeconds}秒`;
    return { system: LTX25_SINGLE_SYSTEM_PROMPT, user };
  }

  // 2.5-multi
  const parts = [];
  for (let i = 1; i <= state.cutCount; i++) {
    const seconds = state.cuts[i - 1]?.seconds ?? 3;
    const transitionLine =
      i >= 2 ? `\n[前のカットからの転換] ${val(`cut-${i}-transition`) || "指定なし"}` : "";
    parts.push(
      `--- カット${i}（${seconds}秒） ---\n` +
        `[ショットタイプ] ${val(`cut-${i}-shot-type`) || "指定なし"}\n` +
        `[シーン・照明] ${val(`cut-${i}-scene-lighting`) || "指定なし"}\n` +
        `[アクション] ${val(`cut-${i}-action`) || "指定なし"}\n` +
        `[キャラクター] ${val(`cut-${i}-character`) || "指定なし"}\n` +
        `[カメラワーク] ${val(`cut-${i}-camera`) || "指定なし"}\n` +
        `[セリフ・音声] ${val(`cut-${i}-audio`) || "指定なし"}` +
        transitionLine,
    );
  }
  const user = `以下の入力をもとに、LTX-2.5（マルチショット・${state.cutCount}カット）向けの英語プロンプトを1つ生成してください。

${parts.join("\n\n")}

[カットをまたいだ音声の連続性（任意）]
${val("f25-multi-continuity") || "指定なし"}`;
  return { system: LTX25_MULTI_SYSTEM_PROMPT, user };
}

async function loadModel(modelId) {
  loadModelBtn.disabled = true;
  generateBtn.disabled = true;
  loadProgress.hidden = false;
  loadProgress.value = 0;
  try {
    updateStatus("WebLLMライブラリを読み込み中...");
    const webllm = await loadWebLLMModule();
    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        updateStatus(report.text || "モデルを読み込み中...");
        if (typeof report.progress === "number") {
          loadProgress.value = report.progress;
        }
      },
    });
    updateStatus("モデルの準備ができました");
    generateBtn.disabled = false;
  } catch (err) {
    console.error(err);
    updateStatus(`モデルの読み込みに失敗しました: ${err.message}`);
  } finally {
    loadModelBtn.disabled = false;
  }
}

async function generateNegative() {
  outputNegativeCard.hidden = false;
  outputNegative.value = "";
  const hints = negativeHints.value.trim();
  const user = `以下は生成済みのポジティブプロンプトです。

"""
${outputPositive.value.trim()}
"""

避けたい要素（任意・日本語）: ${hints || "指定なし"}

上記を踏まえてネガティブプロンプトを作成してください。`;

  const stream = await engine.chat.completions.create({
    messages: [
      { role: "system", content: NEGATIVE_SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    temperature: 0.5,
    stream: true,
  });
  for await (const chunk of stream) {
    outputNegative.value += chunk.choices[0]?.delta?.content ?? "";
  }
}

async function handleGenerate(e) {
  e.preventDefault();
  if (!engine) {
    updateStatus("先にモデルを読み込んでください");
    return;
  }

  generateBtn.disabled = true;
  outputSection.hidden = false;
  outputNegativeCard.hidden = true;
  outputPositive.value = "";

  try {
    const mode = currentMode();
    const { system, user } = buildPromptFor(mode);
    updateStatus("生成中...");

    const stream = await engine.chat.completions.create({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
      stream: true,
    });
    for await (const chunk of stream) {
      outputPositive.value += chunk.choices[0]?.delta?.content ?? "";
    }

    updateStatus("生成が完了しました");

    if (genNegativeCheckbox.checked) {
      updateStatus("ネガティブプロンプトを生成中...");
      await generateNegative();
      updateStatus("生成が完了しました");
    }

    saveState();
  } catch (err) {
    console.error(err);
    updateStatus(`エラー: ${err.message}`);
  } finally {
    generateBtn.disabled = false;
  }
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = "✅ コピーしました";
    setTimeout(() => {
      btn.textContent = original;
    }, 1500);
  } catch (err) {
    updateStatus(`コピーに失敗しました: ${err.message}`);
  }
}

function collectAllFieldValues() {
  const ids = [
    "f23-main-action",
    "f23-motion",
    "f23-char-env",
    "f23-camera-lighting",
    "f23-change",
    "f25-shot-type",
    "f25-scene-lighting",
    "f25-action",
    "f25-character",
    "f25-camera",
    "f25-audio",
    "f25-multi-continuity",
    "negative-hints",
  ];
  const values = {};
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) values[id] = el.value;
  });
  document.querySelectorAll("#cuts-container textarea").forEach((el) => {
    values[el.id] = el.value;
  });
  return values;
}

function restoreFieldValues(fields) {
  if (!fields) return;
  Object.entries(fields).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
}

function saveState() {
  const data = {
    version: state.version,
    shotMode: state.shotMode,
    cutCount: state.cutCount,
    totalSeconds: state.totalSeconds,
    cuts: state.cuts.slice(0, state.cutCount),
    modelId: modelSelect.value,
    genNegative: genNegativeCheckbox.checked,
    fields: collectAllFieldValues(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error("Failed to save state:", err);
  }
}

function loadSavedState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse saved state:", err);
    return null;
  }
}

function init() {
  checkWebGPU();

  const saved = loadSavedState();
  if (saved) {
    state.version = saved.version ?? state.version;
    state.shotMode = saved.shotMode ?? state.shotMode;
    state.cutCount = saved.cutCount ?? state.cutCount;
    state.totalSeconds = saved.totalSeconds ?? state.totalSeconds;
    if (Array.isArray(saved.cuts) && saved.cuts.length) {
      state.cuts = saved.cuts.map((c) => ({ seconds: c?.seconds ?? 3 }));
      while (state.cuts.length < 4) state.cuts.push({ seconds: 3 });
    }
  }

  versionSelect.value = state.version;
  shotModeSelect.value = state.shotMode;
  cutCountSelect.value = String(state.cutCount);
  totalSecondsInput.value = String(state.totalSeconds);
  totalSecondsValue.textContent = `${state.totalSeconds}秒`;

  updateVisibility();

  if (saved) {
    restoreFieldValues(saved.fields);
    if (saved.modelId) modelSelect.value = saved.modelId;
    if (typeof saved.genNegative === "boolean") {
      genNegativeCheckbox.checked = saved.genNegative;
    }
  }
}

versionSelect.addEventListener("change", () => {
  state.version = versionSelect.value;
  updateVisibility();
  saveState();
});

shotModeSelect.addEventListener("change", () => {
  state.shotMode = shotModeSelect.value;
  updateVisibility();
  saveState();
});

cutCountSelect.addEventListener("change", () => {
  state.cutCount = Number(cutCountSelect.value);
  while (state.cuts.length < state.cutCount) state.cuts.push({ seconds: 3 });
  updateVisibility();
  saveState();
});

totalSecondsInput.addEventListener("input", () => {
  state.totalSeconds = Number(totalSecondsInput.value);
  totalSecondsValue.textContent = `${state.totalSeconds}秒`;
  renderTimelineBar();
  saveState();
});

loadModelBtn.addEventListener("click", () => loadModel(modelSelect.value));

promptForm.addEventListener("submit", handleGenerate);

copyPositiveBtn.addEventListener("click", () => copyToClipboard(outputPositive.value, copyPositiveBtn));
copyNegativeBtn.addEventListener("click", () => copyToClipboard(outputNegative.value, copyNegativeBtn));

mainGrid.addEventListener("input", (e) => {
  if (e.target.matches("textarea, input[type='number']")) saveState();
});
mainGrid.addEventListener("change", (e) => {
  if (e.target.matches("select, input[type='checkbox']")) saveState();
});

document.addEventListener("DOMContentLoaded", init);
