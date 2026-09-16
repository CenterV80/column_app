"use strict";

// Renders the interactive EV mapping chart into #ev-chart. Called from
// index.html once the article markdown (which contains the empty container
// div) has been injected into the DOM.
function initEvChart() {
  const root = document.getElementById("ev-chart");
  if (!root) return;

  // saturate((x - lo) / (hi - lo)), with the degenerate lo == hi case
  // falling back to a hard step so the curve never disappears.
  function ramp(x, lo, hi) {
    if (hi === lo) return x >= hi ? 1 : 0;
    const t = (x - lo) / (hi - lo);
    return Math.min(1, Math.max(0, t));
  }

  // fit(EV, b, c, fit(EV, a, b, Va, Vb), Vc)
  function fitValue(ev, p) {
    const t1 = ramp(ev, p.a, p.b);
    const t2 = ramp(ev, p.b, p.c);
    const inner = p.va + (p.vb - p.va) * t1;
    return inner + (p.vc - inner) * t2;
  }

  // lerp(lerp(Va, Vb, step((a+b)/2)), Vc, step((b+c)/2))
  function stepValue(ev, p) {
    const first = ev >= (p.a + p.b) / 2 ? p.vb : p.va;
    return ev >= (p.b + p.c) / 2 ? p.vc : first;
  }

  function makeSlider(labelText, id, min, max, step, value) {
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
    valSpan.textContent = value.toFixed(2);

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(valSpan);
    return { row, input, valSpan };
  }

  const aCtrl = makeSlider("a (明るい場所のEV)", "ev-a", -4, 8, 0.1, -1);
  const bCtrl = makeSlider("b (普通の場所のEV)", "ev-b", -4, 8, 0.1, 1);
  const cCtrl = makeSlider("c (暗い場所のEV)", "ev-c", -4, 8, 0.1, 4);
  const vaCtrl = makeSlider("Va (出力)", "ev-va", 0, 1, 0.01, 0);
  const vbCtrl = makeSlider("Vb (出力)", "ev-vb", 0, 1, 0.01, 0);
  const vcCtrl = makeSlider("Vc (出力)", "ev-vc", 0, 1, 0.01, 0.3);
  const probeCtrl = makeSlider("EV (読み取り位置)", "ev-probe", -4, 8, 0.1, 2);

  const controls = document.createElement("div");
  controls.className = "chart-controls";
  [aCtrl, bCtrl, cCtrl, vaCtrl, vbCtrl, vcCtrl, probeCtrl].forEach((c) => {
    controls.appendChild(c.row);
  });

  const svgWrap = document.createElement("div");
  svgWrap.className = "chart-svg-wrap";

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  legend.innerHTML =
    '<span><i style="border-top-color:#6d5bd0"></i>fit 2段(補間あり)</span>' +
    '<span><i style="border-top-color:#e0844a"></i>段切り替え(補間なし)</span>';

  const readout = document.createElement("div");
  readout.className = "chart-readout";

  root.appendChild(controls);
  root.appendChild(svgWrap);
  root.appendChild(legend);
  root.appendChild(readout);

  const W = 640;
  const H = 260;
  const marginLeft = 40;
  const marginRight = 16;
  const marginTop = 16;
  const marginBottom = 30;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;
  const xMin = -4;
  const xMax = 8;

  function sx(v) {
    return marginLeft + ((v - xMin) / (xMax - xMin)) * plotW;
  }
  function sy(v) {
    return marginTop + plotH - v * plotH;
  }

  const MIN_GAP = 0.1;

  // Keep a < b < c: dragging one threshold past a neighbour pushes it along.
  function readParams(moved) {
    let a = parseFloat(aCtrl.input.value);
    let b = parseFloat(bCtrl.input.value);
    let c = parseFloat(cCtrl.input.value);

    // The moved threshold is kept far enough from the ends of the axis that
    // the two it pushes still fit, so the three never collapse onto a point.
    if (moved === "a") {
      a = Math.min(a, xMax - 2 * MIN_GAP);
      b = Math.max(b, a + MIN_GAP);
      c = Math.max(c, b + MIN_GAP);
    } else if (moved === "c") {
      c = Math.max(c, xMin + 2 * MIN_GAP);
      b = Math.min(b, c - MIN_GAP);
      a = Math.min(a, b - MIN_GAP);
    } else {
      b = Math.max(xMin + MIN_GAP, Math.min(xMax - MIN_GAP, b));
      a = Math.min(a, b - MIN_GAP);
      c = Math.max(c, b + MIN_GAP);
    }

    aCtrl.input.value = String(a);
    bCtrl.input.value = String(b);
    cCtrl.input.value = String(c);

    return {
      a: a,
      b: b,
      c: c,
      va: parseFloat(vaCtrl.input.value),
      vb: parseFloat(vbCtrl.input.value),
      vc: parseFloat(vcCtrl.input.value),
    };
  }

  function render(moved) {
    const p = readParams(moved);
    const probe = parseFloat(probeCtrl.input.value);

    aCtrl.valSpan.textContent = p.a.toFixed(2);
    bCtrl.valSpan.textContent = p.b.toFixed(2);
    cCtrl.valSpan.textContent = p.c.toFixed(2);
    vaCtrl.valSpan.textContent = p.va.toFixed(2);
    vbCtrl.valSpan.textContent = p.vb.toFixed(2);
    vcCtrl.valSpan.textContent = p.vc.toFixed(2);
    probeCtrl.valSpan.textContent = probe.toFixed(2);

    const steps = 240;
    let fitPts = "";
    let stepPts = "";
    for (let i = 0; i <= steps; i++) {
      const ev = xMin + (i / steps) * (xMax - xMin);
      fitPts += `${sx(ev)},${sy(fitValue(ev, p))} `;
      stepPts += `${sx(ev)},${sy(stepValue(ev, p))} `;
    }

    let gridLines = "";
    for (let gx = xMin; gx <= xMax; gx += 2) {
      gridLines += `<line x1="${sx(gx)}" y1="${marginTop}" x2="${sx(gx)}" y2="${marginTop + plotH}" class="chart-grid" />`;
      gridLines += `<text x="${sx(gx)}" y="${marginTop + plotH + 16}" class="chart-tick" text-anchor="middle">${gx}</text>`;
    }
    for (let gy = 0; gy <= 1.0001; gy += 0.25) {
      gridLines += `<line x1="${marginLeft}" y1="${sy(gy)}" x2="${marginLeft + plotW}" y2="${sy(gy)}" class="chart-grid" />`;
      gridLines += `<text x="${marginLeft - 8}" y="${sy(gy) + 4}" class="chart-tick" text-anchor="end">${gy.toFixed(2)}</text>`;
    }

    const knots =
      `<circle cx="${sx(p.a)}" cy="${sy(p.va)}" r="4" class="chart-dot chart-dot-knot" />` +
      `<circle cx="${sx(p.b)}" cy="${sy(p.vb)}" r="4" class="chart-dot chart-dot-knot" />` +
      `<circle cx="${sx(p.c)}" cy="${sy(p.vc)}" r="4" class="chart-dot chart-dot-knot" />`;

    const probeX = sx(probe);
    const probeFit = fitValue(probe, p);

    svgWrap.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="EVに対する3段マッピングのグラフ">
        <g>${gridLines}</g>
        <line x1="${probeX}" y1="${marginTop}" x2="${probeX}" y2="${marginTop + plotH}" class="chart-probeline" />
        <polyline points="${stepPts}" class="chart-line chart-line-step" />
        <polyline points="${fitPts}" class="chart-line chart-line-value" />
        ${knots}
        <circle cx="${probeX}" cy="${sy(probeFit)}" r="4" class="chart-dot chart-dot-value" />
        <text x="${marginLeft + 4}" y="${marginTop + 12}" class="chart-tick">← 明るい</text>
        <text x="${marginLeft + plotW - 4}" y="${marginTop + 12}" class="chart-tick" text-anchor="end">暗い →</text>
        <line x1="${marginLeft}" y1="${marginTop + plotH}" x2="${marginLeft + plotW}" y2="${marginTop + plotH}" class="chart-axis" />
        <line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + plotH}" class="chart-axis" />
      </svg>
    `;

    readout.innerHTML =
      `EV = <strong>${probe.toFixed(2)}</strong>` +
      ` (EyeAdaptation ≒ <strong>${Math.pow(2, probe).toFixed(2)}</strong>)　` +
      `fit 2段 = <strong>${probeFit.toFixed(3)}</strong>　` +
      `段切り替え = <strong>${stepValue(probe, p).toFixed(3)}</strong>`;
  }

  aCtrl.input.addEventListener("input", () => render("a"));
  bCtrl.input.addEventListener("input", () => render("b"));
  cCtrl.input.addEventListener("input", () => render("c"));
  [vaCtrl, vbCtrl, vcCtrl, probeCtrl].forEach((ctrl) => {
    ctrl.input.addEventListener("input", () => render());
  });

  render();
}
