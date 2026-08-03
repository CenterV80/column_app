import * as THREE from "three";

function ctx2d(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")];
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise2D(rng, size) {
  const grid = 8;
  const cells = [];
  for (let y = 0; y <= grid; y++) {
    const row = [];
    for (let x = 0; x <= grid; x++) row.push(rng());
    cells.push(row);
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const gx = u * grid, gy = v * grid;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = Math.min(x0 + 1, grid), y1 = Math.min(y0 + 1, grid);
    const tx = smooth(gx - x0), ty = smooth(gy - y0);
    const a = lerp(cells[y0][x0], cells[y0][x1], tx);
    const b = lerp(cells[y1][x0], cells[y1][x1], tx);
    return lerp(a, b, ty);
  };
}

function fbm(rng, size, octaves = 4) {
  const layers = [];
  for (let i = 0; i < octaves; i++) layers.push(valueNoise2D(rng, size));
  return (u, v) => {
    let sum = 0, amp = 0.5, freq = 1, total = 0;
    for (let i = 0; i < layers.length; i++) {
      sum += layers[i]((u * freq) % 1, (v * freq) % 1) * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / total;
  };
}

function heightToNormalMap(size, heightFn, strength = 2.2) {
  const [c, g] = ctx2d(size);
  const img = g.createImageData(size, size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) h[y * size + x] = heightFn(x / size, y / size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = at(x - 1, y), r = at(x + 1, y), u = at(x, y - 1), d = at(x, y + 1);
      const nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function finishTex(canvas, { repeat = [4, 4], anisotropy = 8, srgb = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = anisotropy;
  if (srgb) tex.encoding = THREE.sRGBEncoding;
  tex.needsUpdate = true;
  return tex;
}

export function makeConcrete(seed = 1, { tint = "#7d8388", size = 512 } = {}) {
  const rng = mulberry32(seed);
  const noise = fbm(rng, size, 5);
  const fine = fbm(mulberry32(seed + 99), size, 2);
  const [c, g] = ctx2d(size);
  const base = { r: 0, g: 0, b: 0 };
  const hex = tint.replace("#", "");
  base.r = parseInt(hex.slice(0, 2), 16);
  base.g = parseInt(hex.slice(2, 4), 16);
  base.b = parseInt(hex.slice(4, 6), 16);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let n = noise(u, v) * 0.75 + fine(u * 3, v * 3) * 0.25;
      n = THREE.MathUtils.clamp(n, 0, 1);
      const shade = 0.55 + n * 0.65;
      const streak = Math.sin((v * 40 + noise(u * 2, v) * 6)) * 0.02;
      const i = (y * size + x) * 4;
      img.data[i] = base.r * shade + streak * 255;
      img.data[i + 1] = base.g * shade + streak * 255;
      img.data[i + 2] = base.b * shade + streak * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // grime streaks
  g.globalAlpha = 0.12;
  g.strokeStyle = "#10130f";
  for (let i = 0; i < 26; i++) {
    const x = rng() * size;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + rng() * 30 - 15, size * 0.4, x + rng() * 40 - 20, size * 0.7, x + rng() * 20 - 10, size);
    g.lineWidth = 2 + rng() * 6;
    g.stroke();
  }
  g.globalAlpha = 1;
  const albedo = finishTex(c, { srgb: true });
  const rough = finishTex(document.createElement("canvas"), {});
  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = roughCanvas.height = size;
  const rg = roughCanvas.getContext("2d");
  rg.drawImage(c, 0, 0);
  rg.globalCompositeOperation = "saturation";
  rg.fillStyle = "#808080";
  rg.fillRect(0, 0, size, size);
  const roughness = finishTex(roughCanvas, {});
  const normal = finishTex(heightToNormalMap(size, noise, 1.6), {});
  return { map: albedo, normalMap: normal, roughnessMap: roughness };
}

export function makeMetalPanel(seed = 2, { tint = "#4b5761", panels = 4, size = 512 } = {}) {
  const rng = mulberry32(seed);
  const [c, g] = ctx2d(size);
  const hex = tint.replace("#", "");
  const r0 = parseInt(hex.slice(0, 2), 16), g0 = parseInt(hex.slice(2, 4), 16), b0 = parseInt(hex.slice(4, 6), 16);
  g.fillStyle = `rgb(${r0},${g0},${b0})`;
  g.fillRect(0, 0, size, size);
  // brushed streaks
  const img = g.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    const streak = (Math.sin(y * 0.9) * 0.5 + rng() - 0.5) * 10;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = (Math.sin((x + streak) * 0.15) * 0.5 + 0.5) * 14 - 7;
      img.data[i] = THREE.MathUtils.clamp(img.data[i] + n, 0, 255);
      img.data[i + 1] = THREE.MathUtils.clamp(img.data[i + 1] + n, 0, 255);
      img.data[i + 2] = THREE.MathUtils.clamp(img.data[i + 2] + n, 0, 255);
    }
  }
  g.putImageData(img, 0, 0);
  // panel seams
  const cell = size / panels;
  g.strokeStyle = "rgba(10,12,14,0.55)";
  g.lineWidth = 3;
  for (let i = 1; i < panels; i++) {
    g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, size); g.stroke();
    g.beginPath(); g.moveTo(0, i * cell); g.lineTo(size, i * cell); g.stroke();
  }
  // rivets
  g.fillStyle = "rgba(15,17,19,0.6)";
  for (let py = 0; py < panels; py++) {
    for (let px = 0; px < panels; px++) {
      const cx = px * cell + 10, cy = py * cell + 10;
      [[cx, cy], [cx + cell - 20, cy], [cx, cy + cell - 20], [cx + cell - 20, cy + cell - 20]].forEach(([x, y]) => {
        g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
      });
    }
  }
  // rust streaks
  g.globalAlpha = 0.18;
  for (let i = 0; i < 10; i++) {
    const x = rng() * size, y0 = rng() * size * 0.3;
    const grad = g.createLinearGradient(x, y0, x + rng() * 10 - 5, y0 + size * 0.5);
    grad.addColorStop(0, "rgba(120,60,20,0.9)");
    grad.addColorStop(1, "rgba(120,60,20,0)");
    g.fillStyle = grad;
    g.fillRect(x - 6, y0, 12 + rng() * 10, size * 0.5);
  }
  g.globalAlpha = 1;
  const albedo = finishTex(c, { srgb: true, repeat: [1, 1] });
  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = roughCanvas.height = size;
  const rg = roughCanvas.getContext("2d");
  rg.fillStyle = "#3a3a3a"; rg.fillRect(0, 0, size, size);
  rg.drawImage(c, 0, 0);
  rg.globalCompositeOperation = "multiply";
  rg.fillStyle = "#555"; rg.fillRect(0, 0, size, size);
  const roughness = finishTex(roughCanvas, { repeat: [1, 1] });
  const normal = finishTex(heightToNormalMap(size, fbm(rng, size, 3), 1.2), { repeat: [1, 1] });
  return { map: albedo, normalMap: normal, roughnessMap: roughness, metalnessMap: albedo };
}

export function makeFloorGrating(seed = 3, { size = 512 } = {}) {
  const rng = mulberry32(seed);
  const [c, g] = ctx2d(size);
  g.fillStyle = "#2b2f33";
  g.fillRect(0, 0, size, size);
  const noise = fbm(rng, size, 5);
  const img = g.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = noise(u, v);
      const i = (y * size + x) * 4;
      const shade = 32 + n * 40;
      img.data[i] += shade; img.data[i + 1] += shade + 3; img.data[i + 2] += shade + 6;
    }
  }
  g.putImageData(img, 0, 0);
  // painted safety stripes border
  g.save();
  g.translate(size / 2, size / 2);
  g.strokeStyle = "rgba(255,180,40,0.55)";
  g.lineWidth = size * 0.05;
  g.setLineDash([size * 0.05, size * 0.05]);
  g.strokeRect(-size * 0.46, -size * 0.46, size * 0.92, size * 0.92);
  g.restore();
  // scuffs
  g.globalAlpha = 0.25;
  for (let i = 0; i < 60; i++) {
    g.fillStyle = rng() > 0.5 ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.15)";
    g.beginPath();
    g.ellipse(rng() * size, rng() * size, rng() * 18 + 3, rng() * 5 + 1, rng() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const albedo = finishTex(c, { srgb: true, repeat: [10, 10] });
  const normal = finishTex(heightToNormalMap(size, noise, 1.4), { repeat: [10, 10] });
  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = roughCanvas.height = size;
  const rg = roughCanvas.getContext("2d");
  rg.fillStyle = "#8a8a8a"; rg.fillRect(0, 0, size, size); rg.globalAlpha = 0.5; rg.drawImage(c, 0, 0);
  const roughness = finishTex(roughCanvas, { repeat: [10, 10] });
  return { map: albedo, normalMap: normal, roughnessMap: roughness };
}

export function makeSandbag(seed = 4, { size = 256 } = {}) {
  const rng = mulberry32(seed);
  const [c, g] = ctx2d(size);
  g.fillStyle = "#6b6248";
  g.fillRect(0, 0, size, size);
  const rows = 8;
  for (let r = 0; r < rows; r++) {
    const y = (r / rows) * size;
    const offset = (r % 2) * 14;
    g.strokeStyle = "rgba(30,26,18,0.5)";
    g.lineWidth = 3;
    g.beginPath();
    for (let x = -20; x < size + 20; x += 26) {
      g.moveTo(x + offset, y);
      g.quadraticCurveTo(x + 13 + offset, y + size / rows * 0.5, x + 26 + offset, y);
    }
    g.stroke();
  }
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * 22;
    img.data[i] += n; img.data[i + 1] += n * 0.9; img.data[i + 2] += n * 0.7;
  }
  g.putImageData(img, 0, 0);
  const albedo = finishTex(c, { srgb: true, repeat: [3, 2] });
  const normal = finishTex(heightToNormalMap(size, fbm(rng, size, 4), 2.4), { repeat: [3, 2] });
  return { map: albedo, normalMap: normal };
}

export function makeChainlinkAlpha(size = 256) {
  const [c, g] = ctx2d(size);
  g.clearRect(0, 0, size, size);
  g.strokeStyle = "rgba(220,225,230,0.9)";
  g.lineWidth = size * 0.02;
  const step = size / 8;
  for (let i = -8; i <= 16; i++) {
    g.beginPath();
    g.moveTo(i * step, 0);
    g.lineTo(i * step + size, size);
    g.stroke();
    g.beginPath();
    g.moveTo(i * step, size);
    g.lineTo(i * step + size, 0);
    g.stroke();
  }
  const tex = finishTex(c, { repeat: [12, 6] });
  tex.premultiplyAlpha = false;
  return tex;
}

export function makeCautionStripe(size = 256) {
  const [c, g] = ctx2d(size);
  g.fillStyle = "#151515";
  g.fillRect(0, 0, size, size);
  g.fillStyle = "#f2b31c";
  const w = size / 6;
  for (let i = -1; i < 8; i++) {
    g.save();
    g.translate(i * w * 1.6, 0);
    g.rotate(Math.PI / 4);
    g.fillRect(-w / 2, -size, w, size * 3);
    g.restore();
  }
  return finishTex(c, { srgb: true, repeat: [4, 1] });
}

export function makeSkyGradient() {
  const w = 2, h = 256;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, "#050912");
  grad.addColorStop(0.35, "#0a1424");
  grad.addColorStop(0.62, "#122238");
  grad.addColorStop(0.82, "#2a3a52");
  grad.addColorStop(1.0, "#4a5a6e");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  tex.needsUpdate = true;
  return tex;
}

export function makeStarfield(size = 1024, count = 900) {
  const rng = mulberry32(777);
  const [c, g] = ctx2d(size);
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const x = rng() * size, y = rng() * size * 0.7;
    const r = rng() * 1.1 + 0.15;
    const a = rng() * 0.7 + 0.15;
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
