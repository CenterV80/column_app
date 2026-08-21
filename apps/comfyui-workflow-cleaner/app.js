// ComfyUI workflow cleaner
//
// Takes a ComfyUI workflow JSON (either the normal "UI" export with
// {nodes, links, ...}, or the "Save (API Format)" export which is a flat
// {id: {class_type, inputs, ...}} map) and, given one output node the user
// wants to keep, removes every node that isn't an ancestor of it — i.e.
// dead branches that never feed into the chosen output.

const OUTPUT_TYPE_HINTS = [
  "save", "preview", "vhs_video", "videocombine", "combine",
];

// KJNodes' Set/Get nodes ("variable nodes") are virtual: GetNode has no real
// graph link, it resolves its value by matching its saved name (widgets_values[0])
// against a SetNode with the same name elsewhere in the graph. We special-case
// them below so pruning doesn't strand a GetNode's matching SetNode.
const SET_NODE_TYPE = "SetNode";
const GET_NODE_TYPE = "GetNode";

let parsedData = null;
let parsedFormat = null; // "ui" | "api"
let nodeOptions = []; // [{id, label, isCandidate}]

const fileInput = document.getElementById("file-input");
const fileNameEl = document.getElementById("file-name");
const jsonInput = document.getElementById("json-input");
const parseBtn = document.getElementById("parse-btn");
const parseStatus = document.getElementById("parse-status");

const stepSelect = document.getElementById("step-select");
const formatBadge = document.getElementById("format-badge");
const nodeFilter = document.getElementById("node-filter");
const nodeSelect = document.getElementById("node-select");
const cleanBtn = document.getElementById("clean-btn");

const stepResult = document.getElementById("step-result");
const resultStats = document.getElementById("result-stats");
const jsonOutput = document.getElementById("json-output");
const copyBtn = document.getElementById("copy-btn");
const downloadBtn = document.getElementById("download-btn");
const copyStatus = document.getElementById("copy-status");

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  fileNameEl.textContent = file.name;
  file.text().then((text) => {
    jsonInput.value = text;
  });
});

parseBtn.addEventListener("click", () => {
  setStatus(parseStatus, "", "");
  stepSelect.classList.add("hidden");
  stepResult.classList.add("hidden");

  let data;
  try {
    data = JSON.parse(jsonInput.value);
  } catch (e) {
    setStatus(parseStatus, "JSONの解析に失敗しました: " + e.message, "error");
    return;
  }

  const format = detectFormat(data);
  if (!format) {
    setStatus(
      parseStatus,
      "ComfyUIのワークフローJSONとして認識できませんでした。",
      "error"
    );
    return;
  }

  parsedData = data;
  parsedFormat = format;
  nodeOptions = buildNodeOptions(data, format);

  if (nodeOptions.length === 0) {
    setStatus(parseStatus, "ノードが見つかりませんでした。", "error");
    return;
  }

  formatBadge.textContent = format === "ui" ? "通常のワークフロー（UI形式）" : "APIエクスポート形式";
  setStatus(parseStatus, `${nodeOptions.length} 個のノードを読み込みました。`, "ok");
  renderNodeOptions("");
  stepSelect.classList.remove("hidden");
});

nodeFilter.addEventListener("input", () => {
  renderNodeOptions(nodeFilter.value.trim().toLowerCase());
});

cleanBtn.addEventListener("click", () => {
  const selectedId = nodeSelect.value;
  if (!selectedId) return;

  const before = nodeOptions.length;
  let cleaned;
  let keptCount;
  if (parsedFormat === "api") {
    const result = pruneApi(parsedData, selectedId);
    cleaned = result.data;
    keptCount = result.keptCount;
  } else {
    const result = pruneUi(parsedData, selectedId);
    cleaned = result.data;
    keptCount = result.keptCount;
  }

  jsonOutput.value = JSON.stringify(cleaned, null, 2);
  resultStats.textContent =
    `${before} 個のノード中 ${keptCount} 個を残し、${before - keptCount} 個を削除しました。`;
  stepResult.classList.remove("hidden");
  setStatus(copyStatus, "", "");
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(jsonOutput.value);
    setStatus(copyStatus, "コピーしました。", "ok");
  } catch (e) {
    setStatus(copyStatus, "コピーに失敗しました。手動で選択してコピーしてください。", "error");
  }
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([jsonOutput.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "workflow_cleaned.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

function setStatus(el, text, kind) {
  el.textContent = text;
  el.classList.remove("error", "ok");
  if (kind) el.classList.add(kind);
}

function detectFormat(data) {
  if (data && typeof data === "object" && Array.isArray(data.nodes) && Array.isArray(data.links)) {
    return "ui";
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const keys = Object.keys(data);
    if (
      keys.length > 0 &&
      keys.every((k) => data[k] && typeof data[k] === "object" && !Array.isArray(data[k]) && "class_type" in data[k])
    ) {
      return "api";
    }
  }
  return null;
}

function looksLikeOutput(typeName) {
  const lower = (typeName || "").toLowerCase();
  return OUTPUT_TYPE_HINTS.some((hint) => lower.includes(hint));
}

function buildNodeOptions(data, format) {
  const options = [];
  if (format === "api") {
    for (const id of Object.keys(data)) {
      const node = data[id];
      const title = (node._meta && node._meta.title) || node.class_type;
      const isCandidate = looksLikeOutput(node.class_type) || looksLikeOutput(title);
      options.push({ id, label: `${id}: ${title}`, isCandidate });
    }
    options.sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id));
  } else {
    for (const node of data.nodes) {
      const title = node.title || node.type;
      const isCandidate = looksLikeOutput(node.type) || looksLikeOutput(node.title);
      options.push({ id: node.id, label: `${node.id}: ${title}`, isCandidate });
    }
    options.sort((a, b) => Number(a.id) - Number(b.id));
  }
  return options;
}

function renderNodeOptions(filterText) {
  nodeSelect.innerHTML = "";
  const filtered = nodeOptions.filter((opt) =>
    !filterText || opt.label.toLowerCase().includes(filterText)
  );
  for (const opt of filtered) {
    const el = document.createElement("option");
    el.value = String(opt.id);
    el.textContent = (opt.isCandidate ? "★ " : "") + opt.label;
    nodeSelect.appendChild(el);
  }
  const firstCandidate = filtered.find((o) => o.isCandidate);
  if (firstCandidate) {
    nodeSelect.value = String(firstCandidate.id);
  } else if (filtered.length > 0) {
    nodeSelect.value = String(filtered[0].id);
  }
}

// --- API format pruning ---
// Nodes reference upstream nodes via inputs whose value is [sourceNodeId, outputIndex].
function pruneApi(data, keepId) {
  const keep = new Set();

  function visit(id) {
    if (keep.has(id) || !data[id]) return;
    keep.add(id);
    const inputs = data[id].inputs || {};
    for (const value of Object.values(inputs)) {
      if (Array.isArray(value) && value.length === 2 && (typeof value[0] === "string" || typeof value[0] === "number")) {
        visit(String(value[0]));
      }
    }
  }

  visit(String(keepId));

  const result = {};
  for (const id of Object.keys(data)) {
    if (keep.has(id)) result[id] = data[id];
  }
  return { data: result, keptCount: keep.size };
}

// --- UI format pruning ---
// Nodes reference upstream nodes via inputs[].link -> links[linkId] -> origin node id.
function pruneUi(data, keepId) {
  const targetId = coerceId(keepId, data.nodes);
  const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
  const linksById = new Map(data.links.map((l) => [l[0], l]));
  const keep = new Set();

  const setNodesByName = new Map();
  for (const node of data.nodes) {
    if (node.type === SET_NODE_TYPE) {
      const name = Array.isArray(node.widgets_values) ? node.widgets_values[0] : undefined;
      if (name !== undefined) {
        if (!setNodesByName.has(name)) setNodesByName.set(name, []);
        setNodesByName.get(name).push(node.id);
      }
    }
  }

  function visit(id) {
    if (keep.has(id)) return;
    const node = nodesById.get(id);
    if (!node) return;
    keep.add(id);
    for (const input of node.inputs || []) {
      if (input.link !== null && input.link !== undefined) {
        const link = linksById.get(input.link);
        if (link) visit(link[1]);
      }
    }
    if (node.type === GET_NODE_TYPE) {
      const name = Array.isArray(node.widgets_values) ? node.widgets_values[0] : undefined;
      for (const setId of setNodesByName.get(name) || []) visit(setId);
    }
  }

  visit(targetId);

  const newNodes = data.nodes.filter((n) => keep.has(n.id));

  const keepLinkIds = new Set();
  for (const node of newNodes) {
    for (const input of node.inputs || []) {
      if (input.link !== null && input.link !== undefined) {
        const link = linksById.get(input.link);
        if (link && keep.has(link[1])) keepLinkIds.add(link[0]);
      }
    }
  }

  const newLinks = data.links.filter((l) => keepLinkIds.has(l[0]));

  for (const node of newNodes) {
    if (Array.isArray(node.outputs)) {
      for (const output of node.outputs) {
        if (Array.isArray(output.links)) {
          output.links = output.links.filter((linkId) => keepLinkIds.has(linkId));
        }
      }
    }
  }

  const result = { ...data, nodes: newNodes, links: newLinks };
  if ("last_node_id" in result) {
    result.last_node_id = newNodes.reduce((max, n) => Math.max(max, n.id), 0);
  }
  if ("last_link_id" in result) {
    result.last_link_id = newLinks.reduce((max, l) => Math.max(max, l[0]), 0);
  }

  return { data: result, keptCount: keep.size };
}

function coerceId(id, nodes) {
  const asNumber = Number(id);
  const hasNumericIds = nodes.length > 0 && typeof nodes[0].id === "number";
  return hasNumericIds && !Number.isNaN(asNumber) ? asNumber : id;
}
