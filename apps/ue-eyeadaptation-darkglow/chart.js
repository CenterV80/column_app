"use strict";

// Renders the interactive Normal/DarkGlow/Total curve chart into
// #darkglow-chart. Called from index.html once the article markdown
// (which contains the empty container div) has been injected into the DOM.
function initDarkGlowChart() {
  const root = document.getElementById("darkglow-chart");
  if (!root) return;

  // The final `/ EyeAdaptation` cancels Auto Exposure's own boost, so the
  // on-screen brightness of the base emissive term is constant regardless
  // of EyeAdaptation - that's the whole point of dividing instead of
  // multiplying. Only the additive DarkGlow term actually varies.
  function normal(_ea) {
    return 1;
  }
  function darkGlowRaw(ea, k) {
    return 1 - Math.exp(-Math.max(ea - 1, 0) * k);
  }
  function total(ea, k, glow) {
    return normal(ea) + glow * darkGlowRaw(ea, k);
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

  const kCtrl = makeSlider("k (立ち上がり)", "darkglow-k", 0.2, 8, 0.1, 3, (v) => Number(v).toFixed(1));
  const glowCtrl = makeSlider("GlowIntensity", "darkglow-glow", 0, 1.5, 0.05, 0.4, (v) => Number(v).toFixed(2));
  const eaCtrl = makeSlider("EyeAdaptation (プローブ)", "darkglow-ea", 0, 4, 0.05, 1.8, (v) => Number(v).toFixed(2));

  const controls = document.createElement("div");
  controls.className = "chart-controls";
  controls.appendChild(kCtrl.row);
  controls.appendChild(glowCtrl.row);
  controls.appendChild(eaCtrl.row);

  const svgWrap = document.createElement("div");
  svgWrap.className = "chart-svg-wrap";

  const readout = document.createElement("div");
  readout.className = "chart-readout";

  root.appendChild(controls);
  root.appendChild(svgWrap);
  root.appendChild(readout);

  const W = 640;
  const H = 320;
  const marginLeft = 46;
  const marginRight = 16;
  const marginTop = 16;
  const marginBottom = 34;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;
  const xMax = 4;

  function fmtTick(v) {
    const s = v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return s === "" ? "0" : s;
  }

  function render() {
    const k = parseFloat(kCtrl.input.value);
    const glow = parseFloat(glowCtrl.input.value);
    const ea = parseFloat(eaCtrl.input.value);

    kCtrl.valSpan.textContent = k.toFixed(1);
    glowCtrl.valSpan.textContent = glow.toFixed(2);
    eaCtrl.valSpan.textContent = ea.toFixed(2);

    const yMax = Math.max(1.2, 1 + glow) + 0.3;

    function sx(v) {
      return marginLeft + (v / xMax) * plotW;
    }
    function sy(v) {
      return marginTop + plotH - (v / yMax) * plotH;
    }

    const steps = 160;
    let normalPts = "";
    let glowPts = "";
    let totalPts = "";
    for (let i = 0; i <= steps; i++) {
      const eaX = (i / steps) * xMax;
      const nY = normal(eaX);
      const gY = glow * darkGlowRaw(eaX, k);
      const tY = nY + gY;
      normalPts += `${sx(eaX)},${sy(nY)} `;
      glowPts += `${sx(eaX)},${sy(gY)} `;
      totalPts += `${sx(eaX)},${sy(tY)} `;
    }

    let gridLines = "";
    for (let gx = 0; gx <= xMax; gx++) {
      gridLines += `<line x1="${sx(gx)}" y1="${marginTop}" x2="${sx(gx)}" y2="${marginTop + plotH}" class="chart-grid" />`;
      gridLines += `<text x="${sx(gx)}" y="${marginTop + plotH + 18}" class="chart-tick" text-anchor="middle">${gx}</text>`;
    }
    const yStep = yMax > 2 ? 0.5 : 0.25;
    for (let gy = 0; gy <= yMax + 0.001; gy += yStep) {
      gridLines += `<line x1="${marginLeft}" y1="${sy(gy)}" x2="${marginLeft + plotW}" y2="${sy(gy)}" class="chart-grid" />`;
      gridLines += `<text x="${marginLeft - 8}" y="${sy(gy) + 4}" class="chart-tick" text-anchor="end">${fmtTick(gy)}</text>`;
    }

    const breakX = sx(1);
    const probeX = sx(ea);
    const probeNormalY = sy(normal(ea));
    const probeGlowY = sy(glow * darkGlowRaw(ea, k));
    const probeTotalY = sy(total(ea, k, glow));

    svgWrap.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="EyeAdaptationに対するNormal項・DarkGlow項・画面上の明るさのグラフ">
        <g>${gridLines}</g>
        <line x1="${breakX}" y1="${marginTop}" x2="${breakX}" y2="${marginTop + plotH}" class="chart-breakline" />
        <text x="${breakX}" y="${marginTop - 4}" class="chart-tick" text-anchor="middle">EA=1.0</text>
        <polyline points="${normalPts}" class="chart-line chart-line-normal" />
        <polyline points="${glowPts}" class="chart-line chart-line-glow" />
        <polyline points="${totalPts}" class="chart-line chart-line-total" />
        <line x1="${probeX}" y1="${marginTop}" x2="${probeX}" y2="${marginTop + plotH}" class="chart-probeline" />
        <circle cx="${probeX}" cy="${probeNormalY}" r="4" class="chart-dot chart-dot-normal" />
        <circle cx="${probeX}" cy="${probeGlowY}" r="4" class="chart-dot chart-dot-glow" />
        <circle cx="${probeX}" cy="${probeTotalY}" r="4" class="chart-dot chart-dot-total" />
        <line x1="${marginLeft}" y1="${marginTop + plotH}" x2="${marginLeft + plotW}" y2="${marginTop + plotH}" class="chart-axis" />
        <line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + plotH}" class="chart-axis" />
      </svg>
      <div class="chart-legend">
        <span class="chart-legend-item"><i class="chart-swatch chart-swatch-normal"></i>Normal項 (常に1、除算で露出と相殺)</span>
        <span class="chart-legend-item"><i class="chart-swatch chart-swatch-glow"></i>DarkGlow項 (×GlowIntensity)</span>
        <span class="chart-legend-item"><i class="chart-swatch chart-swatch-total"></i>画面上の明るさ (Normal + DarkGlow)</span>
      </div>
    `;

    readout.innerHTML =
      `EyeAdaptation = <strong>${ea.toFixed(2)}</strong> のとき　` +
      `Normal項 = <strong>${normal(ea).toFixed(3)}</strong>　` +
      `DarkGlow項 = <strong>${(glow * darkGlowRaw(ea, k)).toFixed(3)}</strong>　` +
      `画面上の明るさ = <strong>${total(ea, k, glow).toFixed(3)}</strong>`;
  }

  kCtrl.input.addEventListener("input", render);
  glowCtrl.input.addEventListener("input", render);
  eaCtrl.input.addEventListener("input", render);

  render();
}
