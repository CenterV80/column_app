"use strict";

// Renders the interactive trapezoid-curve chart into #scan-chart. Called
// from index.html once the article markdown (which contains the empty
// container div) has been injected into the DOM.
function initScanChart() {
  const root = document.getElementById("scan-chart");
  if (!root) return;

  // Mirrors the HLSL: value = saturate(1 - (diff - plateau) / slope)
  function scanValue(level, scanLevel, plateau, slope) {
    const diff = Math.abs(level - scanLevel);
    const v = 1 - (diff - plateau) / slope;
    return Math.min(1, Math.max(0, v));
  }

  function makeSlider(labelText, id, min, max, step, value, fmt) {
    const row = document.createElement("div");
    row.className = "chart-slider-row";

    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = labelText;

    const input = document.createElement("input");
    input.type = "range";
    input.id = id;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    const valSpan = document.createElement("span");
    valSpan.className = "chart-slider-value";
    valSpan.textContent = fmt(value);

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(valSpan);
    return { row, input, valSpan };
  }

  const plateauCtrl = makeSlider("Plateau", "scan-plateau", 0, 5, 0.1, 0.5, (v) => Number(v).toFixed(1));
  const slopeCtrl = makeSlider("Slope", "scan-slope", 0.2, 10, 0.1, 1.5, (v) => Number(v).toFixed(1));
  const scanCtrl = makeSlider("走査レベル (0-255)", "scan-level", 0, 255, 1, 128, (v) => Number(v).toFixed(0));
  const speedCtrl = makeSlider("Speed (階調/秒)", "scan-speed", 1, 200, 1, 40, (v) => Number(v).toFixed(0));

  const controls = document.createElement("div");
  controls.className = "chart-controls";
  controls.appendChild(plateauCtrl.row);
  controls.appendChild(slopeCtrl.row);
  controls.appendChild(scanCtrl.row);
  controls.appendChild(speedCtrl.row);

  const playBar = document.createElement("div");
  playBar.className = "chart-playbar";
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "chart-play-btn";
  playBtn.textContent = "▶ 走査アニメーション";
  playBar.appendChild(playBtn);

  const svgWrap = document.createElement("div");
  svgWrap.className = "chart-svg-wrap";

  const readout = document.createElement("div");
  readout.className = "chart-readout";

  const stripLabel = document.createElement("div");
  stripLabel.className = "scan-strip-label";
  stripLabel.textContent = "プレビュー: 0(黒)〜255(白)のグラデーション上でハイライトされる部分";

  const stripWrap = document.createElement("div");
  stripWrap.className = "scan-strip";
  const stripGradient = document.createElement("div");
  stripGradient.className = "scan-strip-gradient";
  const stripOverlayWrap = document.createElement("div");
  stripOverlayWrap.className = "scan-strip-overlay";
  stripWrap.appendChild(stripGradient);
  stripWrap.appendChild(stripOverlayWrap);

  root.appendChild(controls);
  root.appendChild(playBar);
  root.appendChild(svgWrap);
  root.appendChild(readout);
  root.appendChild(stripLabel);
  root.appendChild(stripWrap);

  const W = 640;
  const H = 260;
  const marginLeft = 40;
  const marginRight = 16;
  const marginTop = 16;
  const marginBottom = 30;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;
  const xMax = 255;

  let playing = false;
  let animStart = 0;
  let rafId = null;
  let lastRenderAt = 0;

  function sx(v) {
    return marginLeft + (v / xMax) * plotW;
  }
  function sy(v) {
    return marginTop + plotH - v * plotH;
  }

  function render() {
    const plateau = parseFloat(plateauCtrl.input.value);
    const slope = parseFloat(slopeCtrl.input.value);
    const scanLevel = parseFloat(scanCtrl.input.value);

    plateauCtrl.valSpan.textContent = plateau.toFixed(1);
    slopeCtrl.valSpan.textContent = slope.toFixed(1);
    scanCtrl.valSpan.textContent = scanLevel.toFixed(0);
    speedCtrl.valSpan.textContent = parseFloat(speedCtrl.input.value).toFixed(0);

    const steps = 220;
    let linePts = "";
    for (let i = 0; i <= steps; i++) {
      const level = (i / steps) * xMax;
      const v = scanValue(level, scanLevel, plateau, slope);
      linePts += `${sx(level)},${sy(v)} `;
    }

    let gridLines = "";
    for (let gx = 0; gx <= xMax; gx += 32) {
      gridLines += `<line x1="${sx(gx)}" y1="${marginTop}" x2="${sx(gx)}" y2="${marginTop + plotH}" class="chart-grid" />`;
      gridLines += `<text x="${sx(gx)}" y="${marginTop + plotH + 16}" class="chart-tick" text-anchor="middle">${gx}</text>`;
    }
    for (let gy = 0; gy <= 1.0001; gy += 0.25) {
      gridLines += `<line x1="${marginLeft}" y1="${sy(gy)}" x2="${marginLeft + plotW}" y2="${sy(gy)}" class="chart-grid" />`;
      gridLines += `<text x="${marginLeft - 8}" y="${sy(gy) + 4}" class="chart-tick" text-anchor="end">${gy.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") || "0"}</text>`;
    }

    const probeX = sx(scanLevel);

    svgWrap.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="階調に対する台形カーブのグラフ">
        <g>${gridLines}</g>
        <line x1="${probeX}" y1="${marginTop}" x2="${probeX}" y2="${marginTop + plotH}" class="chart-probeline" />
        <polyline points="${linePts}" class="chart-line chart-line-value" />
        <circle cx="${probeX}" cy="${sy(1)}" r="4" class="chart-dot chart-dot-value" />
        <line x1="${marginLeft}" y1="${marginTop + plotH}" x2="${marginLeft + plotW}" y2="${marginTop + plotH}" class="chart-axis" />
        <line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + plotH}" class="chart-axis" />
      </svg>
    `;

    readout.innerHTML =
      `走査レベル = <strong>${scanLevel.toFixed(0)}</strong>　` +
      `Plateau = <strong>${plateau.toFixed(1)}</strong>　` +
      `Slope = <strong>${slope.toFixed(1)}</strong>　` +
      `完全点灯する階調の幅 = <strong>±${plateau.toFixed(1)}</strong>、消灯するまでの幅 = <strong>±${(plateau + slope).toFixed(1)}</strong>`;

    const cols = 128;
    let rects = "";
    for (let i = 0; i < cols; i++) {
      const level = ((i + 0.5) / cols) * xMax;
      const v = scanValue(level, scanLevel, plateau, slope);
      const x = (i / cols) * 100;
      const w = 100 / cols + 0.5;
      rects += `<rect x="${x}%" y="0" width="${w}%" height="100%" fill="#ffce54" fill-opacity="${v.toFixed(3)}" />`;
    }
    stripOverlayWrap.innerHTML = `<svg viewBox="0 0 100 10" preserveAspectRatio="none" width="100%" height="100%">${rects}</svg>`;
  }

  function animLoop(now) {
    if (!playing) return;
    if (now - lastRenderAt >= 50) {
      lastRenderAt = now;
      const elapsed = (now - animStart) / 1000;
      const speed = parseFloat(speedCtrl.input.value);
      const level = Math.floor(elapsed * speed) % 256;
      scanCtrl.input.value = String(level < 0 ? level + 256 : level);
      render();
    }
    rafId = requestAnimationFrame(animLoop);
  }

  function setPlaying(next) {
    playing = next;
    scanCtrl.input.disabled = playing;
    playBtn.classList.toggle("is-playing", playing);
    playBtn.textContent = playing ? "⏸ 一時停止" : "▶ 走査アニメーション";

    if (playing) {
      const speed = parseFloat(speedCtrl.input.value);
      const currentLevel = parseFloat(scanCtrl.input.value);
      animStart = performance.now() - (currentLevel / speed) * 1000;
      lastRenderAt = 0;
      rafId = requestAnimationFrame(animLoop);
    } else if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  playBtn.addEventListener("click", () => setPlaying(!playing));
  plateauCtrl.input.addEventListener("input", render);
  slopeCtrl.input.addEventListener("input", render);
  scanCtrl.input.addEventListener("input", render);
  speedCtrl.input.addEventListener("input", render);

  render();
}
