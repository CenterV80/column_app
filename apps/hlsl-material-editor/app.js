"use strict";

// UE の Custom ノードと同じ感覚で書けるように、エディタの中身は
// 「float4 を return する関数の中身」として扱う。ヘルパー関数を書いた
// 場合は自動で切り出して UserEntry() より前に置く。

const STORE_CODE = "hlsl-editor/v2/code";
const STORE_PARAMS = "hlsl-editor/v2/params";

const DEFAULT_CODE = `// float4 を return してください（UE の Custom ノードと同じ感覚）。
// 組み込み変数は上のチップから挿入できます。

float NdotL = saturate(dot(Normal, LightVector));
float3 diffuse = BaseColor * NdotL;

// 環境光を少し足す
diffuse += BaseColor * 0.15;

// リムライト（Param1 で強さ調整）
float rim = pow(1.0 - saturate(dot(Normal, CameraVector)), 4.0);
diffuse += rim * Param1;

// Time で軽く脈動（Param2 で振幅）
diffuse *= 1.0 + Param2 * 0.3 * sin(Time * 3.0);

return float4(diffuse, 1.0);
`;

// ---------------------------------------------------------------- prelude

// Three.js が fragment shader の先頭に付ける宣言（precision, viewMatrix,
// cameraPosition）は重複させないこと。
const FRAG_PRELUDE = `
// ---- HLSL 互換 ----
#define float2 vec2
#define float3 vec3
#define float4 vec4
#define float2x2 mat2
#define float3x3 mat3
#define float4x4 mat4
#define half float
#define half2 vec2
#define half3 vec3
#define half4 vec4
#define int2 ivec2
#define int3 ivec3
#define int4 ivec4
#define bool2 bvec2
#define bool3 bvec3
#define bool4 bvec4
#define lerp mix
#define frac fract

uniform vec3 uLightDir;
uniform vec3 uBaseColor;
uniform vec4 uParams;
uniform float uTime;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2  saturate(vec2 x)  { return clamp(x, 0.0, 1.0); }
vec3  saturate(vec3 x)  { return clamp(x, 0.0, 1.0); }
vec4  saturate(vec4 x)  { return clamp(x, 0.0, 1.0); }
float rsqrt(float x) { return inversesqrt(x); }
float atan2(float y, float x) { return atan(y, x); }
float fmod(float a, float b) { return mod(a, b); }
vec2  fmod(vec2 a, vec2 b)   { return mod(a, b); }
vec3  fmod(vec3 a, vec3 b)   { return mod(a, b); }
float mul(float a, float b)  { return a * b; }
vec3  mul(mat3 m, vec3 v)    { return m * v; }
vec3  mul(vec3 v, mat3 m)    { return v * m; }
vec4  mul(mat4 m, vec4 v)    { return m * v; }
vec4  mul(vec4 v, mat4 m)    { return v * m; }

// ---- 組み込み変数 ----
vec2  UV;
vec3  Normal;
vec3  LightVector;
vec3  CameraVector;
vec3  WorldPosition;
vec3  BaseColor;
float Time;
float Param1;
float Param2;
float Param3;
float Param4;
`;

const FRAG_EPILOGUE = `
void main() {
  UV            = vUv;
  Normal        = normalize(vNormal);
  WorldPosition = vWorldPos;
  LightVector   = normalize(uLightDir);
  CameraVector  = normalize(cameraPosition - vWorldPos);
  BaseColor     = uBaseColor;
  Time          = uTime;
  Param1        = uParams.x;
  Param2        = uParams.y;
  Param3        = uParams.z;
  Param4        = uParams.w;

  gl_FragColor = UserEntry();
}
`;

const VERTEX_SHADER = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Three.js が実際に付ける宣言のうち、単体コンパイル検証に必要な最小限。
const TEST_PREFIX = `precision highp float;
precision highp int;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
`;

// ---------------------------------------------------------------- 変換

const RETURN_TYPES =
  "void|float|float2|float3|float4|half|half2|half3|half4|" +
  "vec2|vec3|vec4|int|int2|int3|int4|ivec2|ivec3|ivec4|" +
  "bool|bvec2|bvec3|bvec4|mat2|mat3|mat4|float2x2|float3x3|float4x4";

const FN_HEADER = new RegExp(
  "^(?:static\\s+|inline\\s+)*(" + RETURN_TYPES + ")\\s+([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)\\s*\\{"
);

// HLSL のセマンティクスと in/out 修飾子を落とす。型は #define で処理するので
// ここでは触らない。
function stripHlslSyntax(src) {
  return src
    .replace(/:\s*(SV_\w+|TEXCOORD\d*|COLOR\d*|NORMAL\d*|POSITION\d*|TANGENT\d*|BINORMAL\d*)\b/gi, "")
    .replace(/\b(?:in|out|inout)\s+(?=(?:float|half|int|uint|bool|vec|ivec|bvec|mat)\w*\s)/g, "")
    .replace(/\bstatic\s+/g, "");
}

// 対応する閉じ括弧の位置を返す（コメント・文字列は無視）。
function findMatchingBrace(src, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    const two = src.substr(i, 2);
    if (two === "//") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// トップレベルを「関数定義」と「それ以外（＝本体）」に分ける。
function splitTopLevel(src) {
  const fns = [];
  let body = "";
  let i = 0;
  let depth = 0;

  while (i < src.length) {
    const two = src.substr(i, 2);

    if (two === "//") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? src.length : nl;
      body += src.slice(i, end);
      i = end;
      continue;
    }
    if (two === "/*") {
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? src.length : close + 2;
      body += src.slice(i, end);
      i = end;
      continue;
    }

    if (depth === 0) {
      const m = src.slice(i).match(FN_HEADER);
      if (m) {
        const openIdx = i + m[0].length - 1;
        const closeIdx = findMatchingBrace(src, openIdx);
        if (closeIdx !== -1) {
          fns.push({
            returnType: m[1],
            name: m[2],
            params: m[3].trim(),
            body: src.slice(openIdx + 1, closeIdx),
            text: src.slice(i, closeIdx + 1),
          });
          i = closeIdx + 1;
          continue;
        }
      }
    }

    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth = Math.max(0, depth - 1);

    body += src[i];
    i++;
  }

  return { fns, body };
}

// 関数ごと貼られたときに、その引数を組み込み変数へ橋渡しする。
// UE の Custom ノードには引数が無いので、名前と型から素直に推測する。
const TYPE_ALIASES = {
  float2: "vec2", half2: "vec2",
  float3: "vec3", half3: "vec3",
  float4: "vec4", half4: "vec4",
  half: "float",
};

function normalizeType(type) {
  return TYPE_ALIASES[type] || type;
}

const BUILTIN_BY_NAME = [
  [/uv|texcoord/i, { vec2: "UV" }],
  [/normal/i, { vec3: "Normal" }],
  [/light/i, { vec3: "LightVector" }],
  [/view|camera|eye/i, { vec3: "CameraVector" }],
  [/world|position|^pos/i, { vec3: "WorldPosition" }],
  [/time/i, { float: "Time" }],
  [/colou?r|albedo/i, { vec3: "BaseColor", vec4: "vec4(BaseColor, 1.0)" }],
];

const BUILTIN_BY_TYPE = {
  vec2: "UV",
  vec3: "WorldPosition",
  vec4: "vec4(BaseColor, 1.0)",
  float: "Time",
};

const ZERO_BY_TYPE = { vec2: "vec2(0.0)", vec3: "vec3(0.0)", vec4: "vec4(0.0)", float: "0.0" };

function paramAliases(paramList) {
  const decls = [];
  const notes = [];

  for (const raw of paramList.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)/);
    if (!m) continue;

    const type = normalizeType(m[1]);
    const name = m[2];

    let source = null;
    for (const [re, map] of BUILTIN_BY_NAME) {
      if (re.test(name) && map[type]) {
        source = map[type];
        break;
      }
    }
    if (!source) source = BUILTIN_BY_TYPE[type] || null;

    if (source) {
      decls.push(`  ${type} ${name} = ${source};`);
      notes.push(`引数 ${name} は組み込みの ${source} に接続しました`);
    } else if (ZERO_BY_TYPE[type]) {
      decls.push(`  ${type} ${name} = ${ZERO_BY_TYPE[type]};`);
      notes.push(`引数 ${name} に対応する組み込み変数が無いので 0 で初期化しました`);
    }
  }

  return { decls, notes };
}

function isBlank(text) {
  return (
    text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .trim() === ""
  );
}

// エディタの中身から fragment shader を組み立てる。
function buildFragmentShader(userCode) {
  const cleaned = stripHlslSyntax(userCode);
  const { fns, body } = splitTopLevel(cleaned);

  let entryBody = body;
  let helpers = fns;
  const notes = [];

  // 関数まるごと貼られた場合（main / CustomExpression など）は中身を取り出し、
  // 引数は組み込み変数へ橋渡しする。
  if (isBlank(body) && fns.length > 0) {
    const isVec4 = (t) => t === "float4" || t === "vec4";
    const named = fns.find(
      (f) => /^(main|CustomExpression|CustomExpr|Custom)$/i.test(f.name) && isVec4(f.returnType)
    );
    const target = named || [...fns].reverse().find((f) => isVec4(f.returnType));
    if (target) {
      const { decls, notes: aliasNotes } = paramAliases(target.params);
      entryBody = (decls.length ? decls.join("\n") + "\n" : "") + target.body;
      helpers = fns.filter((f) => f !== target);
      notes.push(`${target.name}() の中身を取り込みました`, ...aliasNotes);
    }
  }

  const helperSrc = helpers.map((f) => f.text).join("\n\n");

  const parts = [FRAG_PRELUDE];
  if (helperSrc.trim()) parts.push("// ---- ユーザー定義関数 ----\n" + helperSrc);
  parts.push("vec4 UserEntry() {\n" + entryBody + "\n}");
  parts.push(FRAG_EPILOGUE);

  return { source: parts.join("\n"), notes };
}

// ---------------------------------------------------------------- アプリ

class HlslEditorApp {
  constructor() {
    this.el = {
      code: document.getElementById("code"),
      status: document.getElementById("status"),
      snippets: document.getElementById("snippets"),
      canvasWrap: document.getElementById("canvasWrap"),
      compileBtn: document.getElementById("compileBtn"),
      resetBtn: document.getElementById("resetBtn"),
      meshSelect: document.getElementById("meshSelect"),
      autoRotate: document.getElementById("autoRotate"),
      params: document.getElementById("params"),
      paramsToggle: document.getElementById("paramsToggle"),
      panes: document.getElementById("panes"),
    };

    this.uniforms = {
      uLightDir: { value: new THREE.Vector3(0.5, 0.5, 0.7) },
      uBaseColor: { value: new THREE.Color(0x4da3ff) },
      uParams: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) },
      uTime: { value: 0 },
    };

    this.timeScale = 1;
    this.clock = { last: performance.now(), elapsed: 0 };
    this.rotation = { x: 0, y: 0 };
    this.autoRotate = true;

    this.initThree();
    this.initSnippets();
    this.initPresets();
    this.initTabs();
    this.initParams();
    this.initEditor();
    this.loadState();
    this.compile();
    this.animate();
  }

  // -------------------------------------------------------------- three

  initThree() {
    const wrap = this.el.canvasWrap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x202227);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0, 3.6);

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (err) {
      this.setStatus("err", "WebGL を初期化できませんでした: " + err.message);
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    wrap.appendChild(this.renderer.domElement);

    this.gl = this.renderer.getContext();
    this.setGeometry("sphere");

    // display:none ⇄ 表示 の切り替えでもサイズが追従するように ResizeObserver。
    this.resize();
    if (window.ResizeObserver) {
      new ResizeObserver(() => this.resize()).observe(wrap);
    }
    window.addEventListener("resize", () => this.resize());

    this.initPointerDrag(wrap);
  }

  setGeometry(kind) {
    const geo = {
      sphere: () => new THREE.SphereGeometry(1, 64, 48),
      cube: () => new THREE.BoxGeometry(1.5, 1.5, 1.5, 8, 8, 8),
      plane: () => new THREE.PlaneGeometry(2.4, 2.4, 32, 32),
      torus: () => new THREE.TorusGeometry(0.9, 0.38, 32, 96),
      cylinder: () => new THREE.CylinderGeometry(0.8, 0.8, 1.8, 48, 8),
    }[kind]();

    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.mesh = new THREE.Mesh(geo, this.material || this.fallbackMaterial());
    this.scene.add(this.mesh);
  }

  fallbackMaterial() {
    return new THREE.MeshBasicMaterial({ color: 0x555a63, wireframe: true });
  }

  initPointerDrag(wrap) {
    let dragging = false;
    let last = { x: 0, y: 0 };

    wrap.addEventListener("pointerdown", (e) => {
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
      wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      this.rotation.y += (e.clientX - last.x) * 0.008;
      this.rotation.x += (e.clientY - last.y) * 0.008;
      last = { x: e.clientX, y: e.clientY };
    });
    const stop = (e) => {
      dragging = false;
      if (wrap.hasPointerCapture && wrap.hasPointerCapture(e.pointerId)) {
        wrap.releasePointerCapture(e.pointerId);
      }
    };
    wrap.addEventListener("pointerup", stop);
    wrap.addEventListener("pointercancel", stop);
  }

  resize() {
    if (!this.renderer) return;
    const wrap = this.el.canvasWrap;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) return; // 非表示タブ
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  animate = () => {
    requestAnimationFrame(this.animate);
    if (!this.renderer) return;

    const now = performance.now();
    const dt = (now - this.clock.last) / 1000;
    this.clock.last = now;
    this.clock.elapsed += dt * this.timeScale;
    this.uniforms.uTime.value = this.clock.elapsed;

    if (this.mesh) {
      if (this.autoRotate) this.rotation.y += dt * 0.5;
      this.mesh.rotation.x = this.rotation.x;
      this.mesh.rotation.y = this.rotation.y;
    }
    this.renderer.render(this.scene, this.camera);
  };

  // -------------------------------------------------------------- compile

  // Three.js のシェーダコンパイルは描画時に走り、失敗しても例外は飛ばない
  // （黙って真っ黒になる）。先に自分でコンパイルして検証する。
  validate(fragSource) {
    if (!this.gl) return { ok: true };
    const gl = this.gl;
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(shader, TEST_PREFIX + fragSource);
    gl.compileShader(shader);
    const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    const log = gl.getShaderInfoLog(shader) || "";
    gl.deleteShader(shader);
    return { ok, log, prefixLines: TEST_PREFIX.split("\n").length - 1 };
  }

  formatError(log, fragSource, prefixLines) {
    const lines = (TEST_PREFIX + fragSource).split("\n");
    const out = [];
    for (const raw of log.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/i);
      if (m) {
        const n = parseInt(m[2], 10);
        const src = (lines[n - 1] || "").trim();
        out.push(`${m[1]}: ${m[3]}`);
        if (src) out.push(`   → ${src}`);
      } else {
        out.push(line);
      }
    }
    return out.join("\n");
  }

  compile() {
    const userCode = this.el.code.value;
    let built;
    try {
      built = buildFragmentShader(userCode);
    } catch (err) {
      this.setStatus("err", "コードを解析できませんでした: " + err.message);
      return;
    }

    const res = this.validate(built.source);
    if (!res.ok) {
      this.setStatus("err", this.formatError(res.log, built.source, res.prefixLines));
      return; // 直前の正常なマテリアルを残す
    }

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: built.source,
      side: THREE.DoubleSide,
    });

    if (this.material) this.material.dispose();
    this.material = material;
    if (this.mesh) this.mesh.material = material;

    const extra = [];
    if (built.notes.length) extra.push(...built.notes.map((n) => "· " + n));
    if (res.log && res.log.trim()) extra.push(this.formatError(res.log, built.source, res.prefixLines));
    this.setStatus("ok", ["✓ コンパイル成功", ...extra].join("\n"));
    this.saveState();
  }

  setStatus(state, text) {
    this.el.status.dataset.state = state;
    this.el.status.textContent = text;
  }

  // -------------------------------------------------------------- UI

  initEditor() {
    const code = this.el.code;
    let timer;

    code.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.compile(), 400);
    });

    // Tab でインデント（フォーカスが飛ばないように）
    code.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        this.insertAtCursor("    ");
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.compile();
      }
    });

    this.el.compileBtn.addEventListener("click", () => this.compile());
    this.el.resetBtn.addEventListener("click", () => {
      if (confirm("テンプレートに戻しますか？")) {
        code.value = DEFAULT_CODE;
        this.compile();
      }
    });
  }

  insertAtCursor(text) {
    const code = this.el.code;
    const start = code.selectionStart;
    const end = code.selectionEnd;
    code.value = code.value.slice(0, start) + text + code.value.slice(end);
    code.selectionStart = code.selectionEnd = start + text.length;
    code.focus();
    code.dispatchEvent(new Event("input"));
  }

  initSnippets() {
    const items = [
      ["UV", "UV"],
      ["Normal", "Normal"],
      ["LightVector", "LightVector"],
      ["CameraVector", "CameraVector"],
      ["WorldPosition", "WorldPosition"],
      ["Time", "Time"],
      ["BaseColor", "BaseColor"],
      ["Param1", "Param1"],
      ["Param2", "Param2"],
      ["Param3", "Param3"],
      ["Param4", "Param4"],
      ["saturate()", "saturate()"],
      ["lerp()", "lerp(, , )"],
      ["dot()", "dot(, )"],
      ["frac()", "frac()"],
      ["Lambert", "saturate(dot(Normal, LightVector))"],
      ["Fresnel", "pow(1.0 - saturate(dot(Normal, CameraVector)), 4.0)"],
    ];

    for (const [label, text] of items) {
      const btn = document.createElement("button");
      btn.className = "chip";
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", () => this.insertAtCursor(text));
      this.el.snippets.appendChild(btn);
    }
  }

  initPresets() {
    const presets = [
      ["✨ Metallic Gold", () => `// ゴールドメタリック - Param1で光沢度調整
float3 diffuse = BaseColor;

// フレネル（エッジで明るい）
float fresnel = pow(1.0 - saturate(dot(Normal, CameraVector)), 3.0);

// 拡散反射
float nDotL = saturate(dot(Normal, LightVector));
diffuse = mix(diffuse * 0.5, diffuse, nDotL);

// スペキュラー（高光沢）
float3 halfway = normalize(LightVector + CameraVector);
float spec = pow(saturate(dot(Normal, halfway)), 32.0 + Param1 * 96.0);
diffuse += vec3(1.0) * spec * 1.2;

// フレネルリム
diffuse += fresnel * BaseColor * 0.4;

return float4(diffuse, 1.0);`],

      ["💧 Oil Film", () => `// 油膜の虹色 - 視線角度で色が変わる
float fresnel = pow(1.0 - saturate(dot(Normal, CameraVector)), 2.0);

// フレネル値に基づいて虹色を生成
float3 color1 = vec3(1.0, 0.2, 0.8);   // マゼンタ
float3 color2 = vec3(0.2, 1.0, 1.0);   // シアン
float3 iridescent = mix(color1, color2, fresnel);

// ベースカラーとブレンド
float3 result = mix(BaseColor * 0.3, iridescent, 0.8);

// わずかな拡散反射
result += saturate(dot(Normal, LightVector)) * 0.2;

return float4(result, 1.0);`],

      ["🌀 Plasma", () => `// プラズマエフェクト - Param1で波の速さ、Param2で密度調整
float3 pos = WorldPosition;

// 複数の正弦波を重ねる
float wave1 = sin(pos.x * 5.0 + Time * Param1 * 3.0) * 0.5 + 0.5;
float wave2 = sin(pos.y * 5.0 + Time * Param1 * 2.0) * 0.5 + 0.5;
float wave3 = sin(pos.z * 5.0 + Time * Param1 * 2.5) * 0.5 + 0.5;

// 波の合成
float plasma = (wave1 + wave2 + wave3) / 3.0;
plasma = pow(plasma, 2.0 - Param2);

// 色を波に応じて変更
float3 color = mix(
  vec3(0.0, 1.0, 1.0),  // シアン
  vec3(1.0, 0.0, 1.0),  // マゼンタ
  plasma
);

// ベースカラーとブレンド
color = mix(BaseColor * 0.3, color, 0.8);

return float4(color, 1.0);`],

      ["🪞 Chrome Brushed", () => `// ブラッシュドメタルクローム - ノーマルの微細性状をシミュレート
float3 normal = Normal;

// UVパターンで微細な筋を作る
float brushed = frac(UV.x * 20.0) * 0.1 + 0.9;

// フレネル基盤のスペキュラー
float fresnel = pow(1.0 - saturate(dot(Normal, CameraVector)), 1.5);
float3 halfway = normalize(LightVector + CameraVector);
float spec = pow(saturate(dot(Normal, halfway)), 64.0);

// 拡散反射
float diffuse = saturate(dot(Normal, LightVector)) * 0.4 + 0.3;

// ブラッシュ効果を加える
spec *= brushed;
diffuse *= brushed;

float3 result = BaseColor * diffuse + vec3(1.0) * spec * 1.5 + fresnel * 0.3;

return float4(result, 1.0);`],

      ["🌊 Caustics Water", () => `// 水面の光の屈折パターン - Param1で速度調整
float2 uv = UV * 3.0;

// 2つのノイズ的な波を時間で動かす
float wave1 = sin(uv.x + Time * Param1 * 2.0) * sin(uv.y + Time * Param1);
float wave2 = sin(uv.y * 2.0 + Time * Param1 * 1.5) * sin(uv.x * 2.0 + Time * Param1);

float caustic = wave1 * wave2;
caustic = pow(saturate(caustic * 0.5 + 0.5), 2.0);

// ライティング
float nDotL = saturate(dot(Normal, LightVector));

// 水のような色合い
float3 deepColor = vec3(0.0, 0.1, 0.3);
float3 shallowColor = vec3(0.0, 0.5, 0.8);

float3 result = mix(deepColor, shallowColor, caustic * nDotL);
result += vec3(0.5, 0.8, 1.0) * caustic * 0.5;

return float4(result, 1.0);`],

      ["👻 Hologram", () => `// ホログラム - スキャンラインと発光
float3 col = BaseColor;

// スキャンラインパターン
float scanline = abs(sin(UV.y * 100.0 + Time * 10.0)) * 0.3 + 0.7;

// フレネルで輪郭を強調
float rim = pow(1.0 - saturate(dot(Normal, CameraVector)), 2.0);

// グリッチパターン
float glitch = frac(sin(dot(UV, vec2(12.9898, 78.233)) + Time * 3.0) * 43758.5453);
float glitchStrength = step(0.95, glitch) * 0.5;

// 結合
float3 result = col * scanline;
result += rim * vec3(0.0, 1.0, 1.0) * 0.8;
result += glitchStrength * vec3(1.0, 0.0, 1.0);

return float4(result, 1.0);`],

      ["🔥 Fire Glow", () => `// 炎のようなグロー - Param1で効果の強さ調整
float3 pos = WorldPosition + vec3(sin(Time * Param1), 0.0, 0.0) * 0.3;

// Y軸に基づく高さの効果
float height = (pos.y + 1.0) * 0.5;
height = pow(saturate(height), 1.5);

// 炎っぽいカラーグラデーション
float3 fireColor = mix(
  vec3(1.0, 0.3, 0.0),  // オレンジ
  vec3(1.0, 1.0, 0.0),  // 黄
  height
);

// ゆらぎ効果
float flicker = sin(pos.x * 3.0 + Time * 5.0) * 0.5 + 0.5;
fireColor = mix(fireColor, vec3(1.0), flicker * 0.3 * Param1);

// リム効果で外側が明るい
float rim = pow(1.0 - saturate(dot(Normal, CameraVector)), 2.0);
fireColor += rim * vec3(1.0, 0.5, 0.0) * 0.5;

return float4(fireColor, 1.0);`],

      ["⚡ Aurora", () => `// オーロラ - Param1で動きの速さ調整
float3 pos = WorldPosition;
float time = Time * Param1 * 0.5;

// ノイズ的な動き
float wave1 = sin(pos.x * 2.0 + time) * sin(pos.y + time * 0.7);
float wave2 = sin(pos.z * 1.5 + time * 1.3) * cos(pos.x + time * 0.5);

// 流れるような効果
float flow = (wave1 + wave2) * 0.5 + 0.5;
flow = smoothstep(0.3, 0.7, flow);

// 緑とピンクの虹極光色
float3 greenAurora = vec3(0.0, 1.0, 0.3);
float3 pinkAurora = vec3(1.0, 0.2, 0.8);

float3 aurora = mix(greenAurora, pinkAurora, sin(time) * 0.5 + 0.5);
aurora *= flow;

// ベースカラーをブレンド
float3 result = BaseColor * 0.2 + aurora * 0.8;

// フレネルリム
float rim = pow(1.0 - saturate(dot(Normal, CameraVector)), 2.5);
result += rim * aurora * 0.3;

return float4(result, 1.0);`],

      ["✨ Iridescent", () => `// 虹色の光沢 - 角度依存で色が変わる
float3 viewDir = normalize(CameraVector);
float3 normal = normalize(Normal);

// 視線に基づいて虹色を生成
float angle = acos(dot(viewDir, normal));
angle = angle / 3.14159;  // 0-1に正規化

// 虹色のパレット
float3 color1 = vec3(1.0, 0.0, 0.0);  // 赤
float3 color2 = vec3(1.0, 1.0, 0.0);  // 黄
float3 color3 = vec3(0.0, 1.0, 0.0);  // 緑
float3 color4 = vec3(0.0, 1.0, 1.0);  // シアン
float3 color5 = vec3(0.0, 0.0, 1.0);  // 青

float3 rainbow;
if (angle < 0.33) {
  rainbow = mix(color1, color2, angle / 0.33);
} else if (angle < 0.66) {
  rainbow = mix(color2, color3, (angle - 0.33) / 0.33);
} else {
  rainbow = mix(color3, color4, (angle - 0.66) / 0.34);
}

// スペキュラーを加える
float3 halfway = normalize(viewDir + LightVector);
float spec = pow(saturate(dot(normal, halfway)), 32.0);

float3 result = rainbow * 0.9 + vec3(1.0) * spec * 0.3;

return float4(result, 1.0);`],

      ["🌀 Liquid Swirl", () => `// 液体の渦 - Param1で回転速度、Param2で密度調整
float2 uv = UV - 0.5;

// 極座標
float angle = atan(uv.y, uv.x) + Time * Param1 * 2.0;
float radius = length(uv);

// 渦パターン
float swirl = sin(radius * 20.0 - angle) * 0.5 + 0.5;
swirl = pow(swirl, 2.0 - Param2 * 0.5);

// 色の変化
float3 color1 = vec3(0.1, 0.3, 0.9);  // 深い青
float3 color2 = vec3(0.0, 1.0, 0.8);  // シアン

float3 result = mix(color1, color2, swirl);

// ライティング
float nDotL = saturate(dot(Normal, LightVector));
result = result * (0.5 + nDotL * 0.5);

// リム効果
float rim = pow(1.0 - saturate(dot(Normal, CameraVector)), 2.0);
result += rim * color2 * 0.3;

return float4(result, 1.0);`],

      ["📊 Wireframe", () => `// ワイアーフレーム風 - Param1でグリッド密度調整
float2 uv = UV * (1.0 + Param1 * 5.0);

// グリッドパターン
float gridX = frac(uv.x);
float gridY = frac(uv.y);

// グリッドラインを検出
float lineWidth = 0.05;
float grid = 0.0;
if (gridX < lineWidth || gridX > 1.0 - lineWidth) grid = 1.0;
if (gridY < lineWidth || gridY > 1.0 - lineWidth) grid = 1.0;

// ベースカラーとグリッドをブレンド
float3 result = mix(BaseColor * 0.3, vec3(0.0, 1.0, 0.5), grid);

// ライティング
float nDotL = saturate(dot(Normal, LightVector));
result = result * (0.6 + nDotL * 0.4);

// グロー
result += grid * vec3(0.0, 0.8, 1.0) * 0.5;

return float4(result, 1.0);`],
    ];

    // プリセット用の div を作成
    const presetContainer = document.createElement("div");
    presetContainer.style.marginTop = "8px";
    presetContainer.style.marginBottom = "8px";
    presetContainer.style.paddingBottom = "8px";
    presetContainer.style.borderBottom = "1px solid #333";

    const label = document.createElement("div");
    label.style.fontSize = "11px";
    label.style.color = "#999";
    label.style.marginBottom = "4px";
    label.style.textTransform = "uppercase";
    label.style.letterSpacing = "0.5px";
    label.textContent = "プリセット";
    presetContainer.appendChild(label);

    for (const [label, fn] of presets) {
      const btn = document.createElement("button");
      btn.className = "chip";
      btn.type = "button";
      btn.textContent = label;
      btn.style.fontSize = "12px";
      btn.addEventListener("click", () => {
        this.el.code.value = fn();
        this.compile();
      });
      presetContainer.appendChild(btn);
    }

    this.el.snippets.parentNode.insertBefore(presetContainer, this.el.snippets.nextSibling);
  }

  initTabs() {
    const buttons = document.querySelectorAll(".tab-btn");
    const panes = {
      editor: document.getElementById("paneEditor"),
      preview: document.getElementById("panePreview"),
    };

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
        for (const [key, pane] of Object.entries(panes)) {
          pane.classList.toggle("is-active", key === btn.dataset.tab);
        }
        this.resize();
      });
    });
  }

  initParams() {
    const bind = (id, fmt, onChange) => {
      const input = document.getElementById(id);
      const out = document.getElementById(id + "V");
      const apply = () => {
        if (out) out.textContent = fmt(input.value);
        onChange(input.value);
        this.saveState();
      };
      input.addEventListener("input", apply);
      return apply;
    };

    const deg = (v) => `${Math.round(v)}°`;
    const num = (v) => parseFloat(v).toFixed(2);

    const updateLight = () => {
      const yaw = (parseFloat(document.getElementById("lightYaw").value) * Math.PI) / 180;
      const pitch = (parseFloat(document.getElementById("lightPitch").value) * Math.PI) / 180;
      this.uniforms.uLightDir.value.set(
        Math.cos(pitch) * Math.sin(yaw),
        Math.sin(pitch),
        Math.cos(pitch) * Math.cos(yaw)
      );
    };

    this.applyLightYaw = bind("lightYaw", deg, updateLight);
    this.applyLightPitch = bind("lightPitch", deg, updateLight);
    this.applyTimeScale = bind("timeScale", (v) => `${parseFloat(v).toFixed(1)}x`, (v) => {
      this.timeScale = parseFloat(v);
    });

    const setParam = (i) => (v) => {
      const key = ["x", "y", "z", "w"][i];
      this.uniforms.uParams.value[key] = parseFloat(v);
    };
    this.applyParam1 = bind("param1", num, setParam(0));
    this.applyParam2 = bind("param2", num, setParam(1));
    this.applyParam3 = bind("param3", num, setParam(2));
    this.applyParam4 = bind("param4", num, setParam(3));

    const color = document.getElementById("baseColor");
    this.applyColor = () => {
      this.uniforms.uBaseColor.value.set(color.value);
      this.saveState();
    };
    color.addEventListener("input", this.applyColor);

    this.el.meshSelect.addEventListener("change", (e) => {
      this.setGeometry(e.target.value);
      this.saveState();
    });

    this.el.autoRotate.addEventListener("change", (e) => {
      this.autoRotate = e.target.checked;
      this.saveState();
    });

    // モバイルではパラメータを畳んでおき、コード欄を潰さない
    this.el.paramsToggle.addEventListener("click", () => {
      const open = this.el.params.classList.toggle("is-open");
      this.el.paramsToggle.setAttribute("aria-expanded", String(open));
      this.resize();
    });
  }

  // -------------------------------------------------------------- state

  saveState() {
    try {
      localStorage.setItem(STORE_CODE, this.el.code.value);
      localStorage.setItem(
        STORE_PARAMS,
        JSON.stringify({
          lightYaw: document.getElementById("lightYaw").value,
          lightPitch: document.getElementById("lightPitch").value,
          timeScale: document.getElementById("timeScale").value,
          baseColor: document.getElementById("baseColor").value,
          param1: document.getElementById("param1").value,
          param2: document.getElementById("param2").value,
          param3: document.getElementById("param3").value,
          param4: document.getElementById("param4").value,
          mesh: this.el.meshSelect.value,
          autoRotate: this.el.autoRotate.checked,
        })
      );
    } catch (err) {
      /* localStorage 無効環境では黙って諦める */
    }
  }

  loadState() {
    let saved = null;
    try {
      saved = localStorage.getItem(STORE_CODE);
    } catch (err) {
      /* noop */
    }
    this.el.code.value = saved && saved.trim() ? saved : DEFAULT_CODE;

    let params = {};
    try {
      params = JSON.parse(localStorage.getItem(STORE_PARAMS) || "{}");
    } catch (err) {
      params = {};
    }

    const set = (id, value) => {
      if (value === undefined || value === null) return;
      document.getElementById(id).value = value;
    };
    set("lightYaw", params.lightYaw);
    set("lightPitch", params.lightPitch);
    set("timeScale", params.timeScale);
    set("baseColor", params.baseColor);
    set("param1", params.param1);
    set("param2", params.param2);
    set("param3", params.param3);
    set("param4", params.param4);

    if (params.mesh) {
      this.el.meshSelect.value = params.mesh;
      this.setGeometry(params.mesh);
    }
    if (params.autoRotate !== undefined) {
      this.el.autoRotate.checked = params.autoRotate;
      this.autoRotate = params.autoRotate;
    }

    this.applyLightYaw();
    this.applyLightPitch();
    this.applyTimeScale();
    this.applyParam1();
    this.applyParam2();
    this.applyParam3();
    this.applyParam4();
    this.applyColor();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if (typeof THREE === "undefined") {
    const status = document.getElementById("status");
    status.dataset.state = "err";
    status.textContent = "Three.js を読み込めませんでした。ネットワーク接続を確認してください。";
    return;
  }
  window.hlslApp = new HlslEditorApp();
});
