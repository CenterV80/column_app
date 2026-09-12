/*
 * プレビズエディタ
 * 生成動画AIに渡すカットを、箱のキャラクターとカメラで先に組み立てるための簡易プレビズツール。
 * キャラクターは「体＝ボックス」「頭＝ボックス」「白い四角錐＝頭の向き」で構成する。
 * スマホでの指ドラッグを主な操作にしていて、つかんでいる間はキャラクターが嫌がってプルプル震える。
 * トランスフォームを触ると、その時点の再生フレームに自動でキーフレームが打たれる。
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- 定数

  // キャラクターの色は 赤 → 青 → 緑 → 黄 の順に割り当てて循環させる。
  const COLORS = [
    { key: "red", label: "レッド", hex: 0xe2382b, css: "#e2382b" },
    { key: "blue", label: "ブルー", hex: 0x2f6fe0, css: "#2f6fe0" },
    { key: "green", label: "グリーン", hex: 0x29a84c, css: "#29a84c" },
    { key: "yellow", label: "イエロー", hex: 0xe8c11c, css: "#e8c11c" },
  ];

  const BODY_W = 0.5;
  const BODY_H = 1.12;
  const BODY_D = 0.3;
  const NECK_H = 0.08;
  const HEAD = 0.36;
  const HEAD_Y = BODY_H + NECK_H + HEAD / 2;

  const SENSOR_H = 20.25; // フルサイズ36mm幅を16:9で切り出したときの高さ(mm)
  const ASPECT = 16 / 9;
  const CAM_CSS = "#cfd6e4";

  const STORAGE_KEY = "previz-editor.scene.v1";

  const lensToFov = (mm) => 2 * Math.atan(SENSOR_H / 2 / mm) * (180 / Math.PI);
  const fovToLens = (fov) => SENSOR_H / 2 / Math.tan((fov * Math.PI) / 180 / 2);

  const $ = (id) => document.getElementById(id);
  const col = (c) => new THREE.Color(c).convertSRGBToLinear();
  const canHover = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // ---------------------------------------------------------------- 状態

  const state = {
    fps: 24,
    duration: 120,
    current: 0,
    playing: false,
    loop: true,
    ease: "smooth",
    trails: true,
    grid: true,
    autoFace: true, // 動かしたら、その進む向きに体も向ける
    view: "editor", // "editor" | "camera"
    mode: "move", // "move" | "lift" | "yaw" | "head"
    camMode: "look", // カメラ視点での操作: "look"=ふる / "shift"=上下左右にずらす
    objects: [],
    selectedId: null,
    nextId: 1,
    charCount: 0,
  };

  // ---------------------------------------------------------------- three 基本

  const host = $("canvasHost");
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true, // 画像書き出しのため
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x12141b, 1);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x12141b);
  scene.fog = new THREE.Fog(col(0x12141b), 9, 32);

  const editorCam = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  const orbit = { target: new THREE.Vector3(0, 0.95, 0), radius: 7.8, theta: 0.55, phi: 1.22 };

  function updateEditorCam() {
    const s = Math.sin(orbit.phi);
    editorCam.position.set(
      orbit.target.x + orbit.radius * s * Math.sin(orbit.theta),
      orbit.target.y + orbit.radius * Math.cos(orbit.phi),
      orbit.target.z + orbit.radius * s * Math.cos(orbit.theta)
    );
    editorCam.lookAt(orbit.target);
  }
  updateEditorCam();

  scene.add(new THREE.HemisphereLight(0x9db2d2, 0x2a2f3a, 0.75));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(5, 9, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -12;
  keyLight.shadow.camera.right = 12;
  keyLight.shadow.camera.top = 12;
  keyLight.shadow.camera.bottom = -12;
  keyLight.shadow.radius = 2;
  scene.add(keyLight);
  const fill = new THREE.DirectionalLight(0x93a9d2, 0.4);
  fill.position.set(-6, 4, -5);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: col(0x2c3340), roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(24, 24, 0x6b768f, 0x424b5e);
  // GridHelper は頂点カラーなので、こちらも個別にリニアへ寄せる
  (function () {
    const a = grid.geometry.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < a.count; i++) {
      c.setRGB(a.getX(i), a.getY(i), a.getZ(i)).convertSRGBToLinear();
      a.setXYZ(i, c.r, c.g, c.b);
    }
  })();
  grid.position.y = 0.006; // 床と同じ高さだとZファイティングで消えるので少し浮かせる
  scene.add(grid);

  const trailGroup = new THREE.Group();
  scene.add(trailGroup);

  // 選択ハイライト（足元のリング）
  const selRing = new THREE.Mesh(
    new THREE.RingGeometry(0.44, 0.51, 44),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
  );
  selRing.rotation.x = -Math.PI / 2;
  selRing.position.y = 0.012;
  selRing.visible = false;
  scene.add(selRing);

  // ---------------------------------------------------------------- リグ生成

  function buildCharacter(colorIndex) {
    const color = COLORS[colorIndex % COLORS.length];
    const root = new THREE.Group();

    // 揺れ用のグループ。キーフレームは root 側にしか書かないので、
    // ここをどれだけ揺らしてもアニメーションデータは汚れない。
    const fx = new THREE.Group();
    root.add(fx);

    const mat = new THREE.MeshStandardMaterial({ color: col(color.hex), roughness: 0.68, metalness: 0.04 });
    // 頭は体と地続きに見えないよう、少し明るい色にして首で間を空ける
    const headMat = new THREE.MeshStandardMaterial({
      color: col(color.hex).lerp(col(0xffffff), 0.1),
      roughness: 0.66,
      metalness: 0.04,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(BODY_W, BODY_H, BODY_D), mat);
    body.position.y = BODY_H / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    fx.add(body);

    const neck = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, NECK_H + 0.02, 0.14),
      new THREE.MeshStandardMaterial({ color: col(0x3a3f4a), roughness: 0.8 })
    );
    neck.position.y = BODY_H + NECK_H / 2;
    fx.add(neck);

    // 頭は体とは別に回せるようにピボットを挟む
    const headPivot = new THREE.Group();
    headPivot.position.y = HEAD_Y;
    fx.add(headPivot);

    const head = new THREE.Mesh(new THREE.BoxGeometry(HEAD, HEAD, HEAD), headMat);
    head.castShadow = true;
    headPivot.add(head);

    // 頭の向きを示す白い四角錐。頂点が正面(+Z)を向くようにジオメトリ側で寝かせる。
    const coneGeo = new THREE.ConeGeometry(0.16, 0.44, 4);
    coneGeo.rotateY(Math.PI / 4); // 面を上下左右に向ける
    coneGeo.rotateX(Math.PI / 2); // 頂点を +Z へ
    coneGeo.translate(0, 0, HEAD / 2 + 0.22);
    const cone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshStandardMaterial({ color: col(0xffffff), roughness: 0.45, metalness: 0 })
    );
    cone.castShadow = true;
    headPivot.add(cone);

    // 指でつかみやすいように、見えない当たり判定を足す（揺れの外側に置いて的が動かないようにする）。
    // 隣のキャラ（1.15m間隔）と重ならない幅に留める。
    const proxy = hitProxy(0.7, 1.75, 0.7, 0.88);
    root.add(proxy);

    root.userData.headPivot = headPivot;
    root.userData.fx = fx;
    root.userData.solids = [body, neck, head, cone]; // 実際に見えている面
    root.userData.proxy = proxy;
    return root;
  }

  // material.visible=false は描画されないが、レイキャストには引っかかる
  function hitProxy(w, h, d, y) {
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    proxy.position.y = y;
    return proxy;
  }

  function buildCamRig(camera) {
    const rig = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: col(0xa7b0c2), roughness: 0.5, metalness: 0.2 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.46), bodyMat);
    box.castShadow = true;
    rig.add(box);

    const lensMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 16), bodyMat);
    lensMesh.rotation.x = Math.PI / 2;
    lensMesh.position.z = -0.32;
    rig.add(lensMesh);

    const frustum = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: col(0xa8d3ff), transparent: true, opacity: 0.7 })
    );
    rig.add(frustum);
    rig.userData.frustum = frustum;

    const proxy = hitProxy(0.62, 0.62, 0.8, 0);
    rig.add(proxy);
    rig.userData.solids = [box, lensMesh];
    rig.userData.proxy = proxy;

    camera.add(rig);
    camera.userData.rig = rig;
    updateFrustum(camera);
    return rig;
  }

  // 画角に合わせて、カメラ前方の四角錐ワイヤーを引き直す
  function updateFrustum(camera) {
    const rig = camera.userData.rig;
    if (!rig) return;
    const d = 1.5;
    const h = Math.tan((camera.fov * Math.PI) / 180 / 2) * d;
    const w = h * ASPECT;
    const c = [
      [w, h, -d],
      [-w, h, -d],
      [-w, -h, -d],
      [w, -h, -d],
    ];
    const pts = [];
    for (let i = 0; i < 4; i++) {
      pts.push(0, 0, 0, c[i][0], c[i][1], c[i][2]);
      const n = c[(i + 1) % 4];
      pts.push(c[i][0], c[i][1], c[i][2], n[0], n[1], n[2]);
    }
    // 上方向がわかるように天辺に三角の印を足す
    pts.push(-w * 0.35, h, -d, 0, h * 1.45, -d, 0, h * 1.45, -d, w * 0.35, h, -d);
    const geo = rig.userData.frustum.geometry;
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    geo.computeBoundingSphere();
  }

  // ---------------------------------------------------------------- オブジェクト管理

  // 名前は色そのもの。同じ色が複数いるときだけ番号を足す。
  function nameForColor(colorIndex) {
    const label = COLORS[colorIndex % COLORS.length].label;
    const same = state.objects.filter((o) => o.type === "char" && o.colorIndex % COLORS.length === colorIndex % COLORS.length);
    return same.length ? label + (same.length + 1) : label;
  }

  function addCharacter(opts) {
    const o = opts || {};
    const colorIndex = o.colorIndex != null ? o.colorIndex : state.charCount;
    const color = COLORS[colorIndex % COLORS.length];
    const root = buildCharacter(colorIndex);
    root.userData.objId = state.nextId;

    const obj = {
      id: state.nextId++,
      type: "char",
      name: o.name || nameForColor(colorIndex),
      colorIndex: colorIndex,
      css: color.css,
      root: root,
      keys: [],
      fx: { amp: 0, t: Math.random() * 10, spawn: o.pop ? 1 : 0 },
    };
    state.charCount++;
    scene.add(root);
    state.objects.push(obj);

    if (o.keys && o.keys.length) {
      obj.keys = o.keys.map(normalizeKey);
    } else {
      const p = o.pos || { x: 0, y: 0, z: 0 };
      root.position.set(p.x, p.y, p.z);
      root.rotation.y = o.ry != null ? o.ry : 0;
      root.userData.headPivot.rotation.y = 0;
      obj.keys = [readKey(obj, o.frame != null ? o.frame : 0)];
    }
    return obj;
  }

  function addCamera(opts) {
    const o = opts || {};
    const lens = o.lens || 35;
    const cam = new THREE.PerspectiveCamera(lensToFov(lens), ASPECT, 0.08, 300);
    cam.rotation.order = "YXZ";
    cam.userData.objId = state.nextId;
    buildCamRig(cam);
    scene.add(cam);

    const obj = {
      id: state.nextId++,
      type: "camera",
      name: "カメラ",
      colorIndex: -1,
      css: CAM_CSS,
      root: cam,
      keys: [],
      fx: { amp: 0, t: 0, spawn: 0 },
    };
    state.objects.push(obj);

    if (o.keys && o.keys.length) {
      obj.keys = o.keys.map(normalizeKey);
    } else {
      const p = o.pos || { x: 0, y: 1.5, z: 5.6 };
      cam.position.set(p.x, p.y, p.z);
      cam.rotation.set(o.rx || 0, o.ry || 0, 0);
      obj.keys = [readKey(obj, 0)];
    }
    return obj;
  }

  function removeObject(obj) {
    scene.remove(obj.root);
    obj.root.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
        else n.material.dispose();
      }
    });
    state.objects = state.objects.filter((o) => o !== obj);
    if (state.selectedId === obj.id) state.selectedId = null;
  }

  const objById = (id) => state.objects.find((o) => o.id === id) || null;
  const selected = () => objById(state.selectedId);
  const theCamera = () => state.objects.find((o) => o.type === "camera") || null;

  // 既存のキャラと重ならない立ち位置を、横一列→奥の列の順で探す
  function freeSpot() {
    const taken = state.objects
      .filter((o) => o.type === "char")
      .map((o) => ({ x: o.root.position.x, z: o.root.position.z }));
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 4; col++) {
        const x = (col - 1.5) * 1.15;
        const z = -row * 1.4;
        if (!taken.some((p) => Math.hypot(p.x - x, p.z - z) < 0.8)) return { x: x, y: 0, z: z };
      }
    }
    return { x: (Math.random() - 0.5) * 4, y: 0, z: -8 };
  }

  // ---------------------------------------------------------------- キーフレーム

  function normalizeKey(k) {
    return {
      f: Math.round(k.f) || 0,
      p: { x: +k.p.x || 0, y: +k.p.y || 0, z: +k.p.z || 0 },
      r: { x: +k.r.x || 0, y: +k.r.y || 0, z: +k.r.z || 0 },
      h: +k.h || 0,
      lens: k.lens != null ? +k.lens : 35,
    };
  }

  // いまのトランスフォームをキーの形に読み出す
  function readKey(obj, frame) {
    const r = obj.root;
    return {
      f: frame,
      p: { x: r.position.x, y: r.position.y, z: r.position.z },
      r: { x: r.rotation.x, y: r.rotation.y, z: r.rotation.z },
      h: obj.type === "char" ? r.userData.headPivot.rotation.y : 0,
      lens: obj.type === "camera" ? fovToLens(r.fov) : 35,
    };
  }

  // 自動キーフレーム：トランスフォームを触ったら、その場で現在フレームに打つ
  function autoKey(obj) {
    const k = readKey(obj, state.current);
    const at = obj.keys.findIndex((x) => x.f === state.current);
    if (at >= 0) obj.keys[at] = k;
    else {
      obj.keys.push(k);
      obj.keys.sort((a, b) => a.f - b.f);
    }
    markDirty();
  }

  function deleteKeyAt(obj, frame) {
    if (obj.keys.length <= 1) return false; // 最低1つは残す
    const at = obj.keys.findIndex((x) => x.f === frame);
    if (at < 0) return false;
    obj.keys.splice(at, 1);
    markDirty();
    return true;
  }

  // 角度は近い方の回り方で補間する
  function lerpAngle(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  function sample(obj, frame) {
    const keys = obj.keys;
    if (!keys.length) return null;
    if (frame <= keys[0].f) return keys[0];
    if (frame >= keys[keys.length - 1].f) return keys[keys.length - 1];

    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].f <= frame) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const span = b.f - a.f;
    let t = span === 0 ? 0 : (frame - a.f) / span;
    if (state.ease === "smooth") t = smooth(t);

    return {
      f: frame,
      p: { x: lerp(a.p.x, b.p.x, t), y: lerp(a.p.y, b.p.y, t), z: lerp(a.p.z, b.p.z, t) },
      r: { x: lerpAngle(a.r.x, b.r.x, t), y: lerpAngle(a.r.y, b.r.y, t), z: lerpAngle(a.r.z, b.r.z, t) },
      h: lerpAngle(a.h, b.h, t),
      lens: lerp(a.lens, b.lens, t),
    };
  }

  function applyFrame(frame) {
    state.objects.forEach((obj) => {
      const s = sample(obj, frame);
      if (!s) return;
      obj.root.position.set(s.p.x, s.p.y, s.p.z);
      obj.root.rotation.set(s.r.x, s.r.y, s.r.z);
      if (obj.type === "char") obj.root.userData.headPivot.rotation.y = s.h;
      if (obj.type === "camera") {
        const fov = lensToFov(s.lens);
        if (Math.abs(fov - obj.root.fov) > 1e-4) {
          obj.root.fov = fov;
          obj.root.updateProjectionMatrix();
          updateFrustum(obj.root);
        }
      }
    });
    updateSelRing();
  }

  // ---------------------------------------------------------------- 更新フラグ

  let trailsDirty = true;
  let tlDirty = true;
  let lastTlRender = 0;

  function markDirty() {
    trailsDirty = true;
    tlDirty = true;
    saveSoon();
  }

  function rebuildTrails() {
    trailsDirty = false;
    while (trailGroup.children.length) {
      const c = trailGroup.children.pop();
      c.geometry.dispose();
      c.material.dispose();
      trailGroup.remove(c);
    }
    if (!state.trails) return;

    state.objects.forEach((obj) => {
      if (obj.keys.length < 2) return;
      const pts = [];
      const step = Math.max(1, Math.round(state.duration / 90));
      for (let f = 0; f <= state.duration; f += step) {
        const s = sample(obj, f);
        pts.push(new THREE.Vector3(s.p.x, obj.type === "camera" ? s.p.y : 0.03, s.p.z));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: col(obj.css), transparent: true, opacity: 0.75 })
      );
      trailGroup.add(line);
    });
  }

  function updateSelRing() {
    const obj = selected();
    if (!obj || obj.type !== "char" || state.view === "camera") {
      selRing.visible = false;
      return;
    }
    selRing.visible = true;
    selRing.position.set(obj.root.position.x, obj.root.position.y + 0.012, obj.root.position.z);
  }

  // ---------------------------------------------------------------- プルプル

  // つかんでいる間はキャラクターが嫌がって震える。離すとバネのように数回ゆれて止まる。
  function updateFx(dt) {
    state.objects.forEach((obj) => {
      if (obj.type !== "char") return;
      const fx = obj.fx;
      const g = obj.root.userData.fx;

      // 追加された直後のポンッと出る動き
      let pop = 1;
      if (fx.spawn > 0) {
        fx.spawn = Math.max(0, fx.spawn - dt / 0.42);
        const k = 1 - fx.spawn;
        pop = 0.35 + 0.65 * (1 - Math.pow(1 - k, 3)) + Math.sin(k * Math.PI) * 0.14;
      }

      const held = drag && drag.kind === "object" && drag.obj === obj;
      const target = held ? 1 : 0;
      // つかんだ瞬間は素早く、離したあとはゆっくり減衰させる
      fx.amp += (target - fx.amp) * Math.min(1, dt * (target > fx.amp ? 18 : 5));
      if (fx.amp < 0.0015 && !held) fx.amp = 0;

      const a = fx.amp;
      if (a === 0 && pop === 1) {
        if (g.rotation.z !== 0 || g.scale.y !== 1 || g.position.y !== 0) {
          g.rotation.set(0, 0, 0);
          g.position.y = 0;
          g.scale.set(1, 1, 1);
        }
        return;
      }

      fx.t += dt;
      const w = fx.t * 34;
      g.rotation.z = Math.sin(w) * 0.14 * a;
      g.rotation.x = Math.sin(w * 0.77 + 0.9) * 0.07 * a;
      g.position.y = Math.abs(Math.sin(w * 0.5)) * 0.04 * a;
      const sq = Math.sin(w * 0.5) * 0.05 * a;
      g.scale.set(pop * (1 - sq), pop * (1 + sq), pop * (1 - sq));
    });
  }

  // ---------------------------------------------------------------- 画面レイアウト

  let viewRect = null; // カメラ視点で実際に描く16:9の範囲（CSS px）

  function layout() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    editorCam.aspect = w / h;
    editorCam.updateProjectionMatrix();

    // 上のバーと下のタイムラインに隠れない範囲に16:9を収める
    const dockH = $("dock").offsetHeight || 0;
    document.documentElement.style.setProperty("--dock-h", dockH + "px");
    const pad = { top: 64, bottom: dockH + 22, x: 16 };
    const availW = Math.max(80, w - pad.x * 2);
    const availH = Math.max(60, h - pad.top - pad.bottom);
    let rw = availW;
    let rh = rw / ASPECT;
    if (rh > availH) {
      rh = availH;
      rw = rh * ASPECT;
    }
    viewRect = { x: (w - rw) / 2, y: pad.top + (availH - rh) / 2, w: rw, h: rh };

    const box = $("frameBox");
    box.style.left = viewRect.x + "px";
    box.style.top = viewRect.y + "px";
    box.style.width = viewRect.w + "px";
    box.style.height = viewRect.h + "px";

    tlDirty = true;
  }

  // ---------------------------------------------------------------- 描画ループ

  const clock = new THREE.Clock();
  let frameAcc = 0;

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, clock.getDelta());

    if (state.playing) {
      frameAcc += dt * state.fps;
      if (frameAcc >= 1) {
        let f = state.current + Math.floor(frameAcc);
        frameAcc -= Math.floor(frameAcc);
        if (f > state.duration) {
          if (state.loop) f = f % (state.duration + 1);
          else {
            f = state.duration;
            setPlaying(false);
          }
        }
        setFrame(f);
      }
    }

    updateFx(dt);
    if (trailsDirty) rebuildTrails();
    // ドラッグ中は毎フレーム自動キーが入るので、タイムラインの作り直しは間引く
    if (tlDirty && (!drag || clock.elapsedTime - lastTlRender > 0.12)) {
      lastTlRender = clock.elapsedTime;
      renderTimeline();
    }

    const camObj = theCamera();
    const useCamView = state.view === "camera" && camObj;
    if (camObj) camObj.root.userData.rig.visible = !useCamView;
    grid.visible = state.grid;
    trailGroup.visible = state.trails && !useCamView;
    if (useCamView) selRing.visible = false;

    const w = host.clientWidth;
    const h = host.clientHeight;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.clear();

    if (useCamView) {
      const r = viewRect;
      const y = h - r.y - r.h; // WebGLは左下原点
      renderer.setViewport(r.x, y, r.w, r.h);
      renderer.setScissor(r.x, y, r.w, r.h);
      renderer.setScissorTest(true);
      renderer.render(scene, camObj.root);
    } else {
      renderer.render(scene, editorCam);
    }
  }

  // ---------------------------------------------------------------- 再生・時間

  const secs = (f) => f / state.fps;

  function setFrame(f) {
    state.current = Math.max(0, Math.min(state.duration, Math.round(f)));
    applyFrame(state.current);
    $("timeRead").innerHTML =
      secs(state.current).toFixed(1) + "<i>/" + secs(state.duration).toFixed(1) + "s</i>";
    updatePlayhead();
    updateKeyHighlight();
    syncLens();
  }

  function setPlaying(on) {
    state.playing = on;
    frameAcc = 0;
    useIcon($("playIcon"), on ? "#i-pause" : "#i-play");
    $("playBtn").setAttribute("aria-label", on ? "とめる" : "再生");
  }

  function useIcon(svg, id) {
    const use = svg.querySelector("use");
    use.setAttribute("href", id);
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", id);
  }

  // ---------------------------------------------------------------- ビューポート操作

  const raycaster = new THREE.Raycaster();
  const pointers = new Map();
  let drag = null;
  let gesture = null;

  function ndc(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  function ownerOf(node) {
    let n = node;
    while (n) {
      if (n.userData && n.userData.objId != null) return objById(n.userData.objId);
      n = n.parent;
    }
    return null;
  }

  // 見えている面を最優先で拾い、どれにも当たらなかったときだけ当たり判定に頼る。
  // 当たり判定だけで判断すると、手前のキャラの見えない箱が奥のキャラを隠してしまう。
  function pickObject(ev) {
    raycaster.setFromCamera(ndc(ev), editorCam);

    const solids = [];
    const proxies = [];
    state.objects.forEach((o) => {
      const holder = o.type === "camera" ? o.root.userData.rig : o.root;
      if (holder.userData.solids) solids.push.apply(solids, holder.userData.solids);
      if (holder.userData.proxy) proxies.push(holder.userData.proxy);
    });

    const seen = raycaster.intersectObjects(solids, false);
    if (seen.length) return ownerOf(seen[0].object);

    const near = raycaster.intersectObjects(proxies, false);
    if (!near.length) return null;
    // 指が少しずれただけなら、いま選んでいるものを優先して外れないようにする
    const keep = near.find((h) => {
      const o = ownerOf(h.object);
      return o && o.id === state.selectedId;
    });
    return ownerOf((keep || near[0]).object);
  }

  // カメラから被写体（キャラの真ん中あたり）までの距離。
  // ずらす量をこれに合わせると、指の動きと画の動きが噛み合う。
  function subjectDist(camObj) {
    const chars = state.objects.filter((o) => o.type === "char");
    if (!chars.length) return 4;
    const c = new THREE.Vector3();
    chars.forEach((o) => c.add(o.root.position));
    c.divideScalar(chars.length);
    c.y += 0.9;
    return Math.max(1, camObj.root.position.distanceTo(c));
  }

  // カメラを画面と平行にずらす（水平＝カメラの真横、垂直＝ワールドの上下）
  function shiftCamera(camObj, dx, dy, ref) {
    const cam = camObj.root;
    const h = viewRect ? viewRect.h : host.clientHeight || 1;
    const k = (2 * Math.tan((cam.fov * Math.PI) / 180 / 2) * ref) / h;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    cam.position.addScaledVector(right, dx * k);
    cam.position.y = Math.max(0.05, cam.position.y - dy * k);
  }

  function pointerCenter() {
    const p = Array.from(pointers.values());
    return {
      x: (p[0].x + p[1].x) / 2,
      y: (p[0].y + p[1].y) / 2,
      d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
    };
  }

  function onPointerDown(ev) {
    // pointerup を取りこぼして古い指が残ると、次の操作がいきなり2本指扱いになってしまう。
    // 新しい操作の始まりでは必ず掃除する。
    if (ev.isPrimary) pointers.clear();
    try {
      renderer.domElement.setPointerCapture(ev.pointerId);
    } catch (e) {
      /* 掴み損ねても操作自体は続けられるので、ここで止めない */
    }
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    closePop();

    // 2本指：まわす＋ひろげる
    if (pointers.size === 2) {
      drag = null;
      const c = pointerCenter();
      gesture = { x: c.x, y: c.y, d: c.d, radius: orbit.radius };
      return;
    }

    if (state.view === "camera") {
      const camObj = theCamera();
      if (camObj) {
        select(camObj.id);
        setPlaying(false);
        drag = {
          kind: "camlook",
          obj: camObj,
          x: ev.clientX,
          y: ev.clientY,
          mode: ev.shiftKey || ev.button === 2 ? "shift" : state.camMode,
          ref: subjectDist(camObj),
        };
      }
      return;
    }

    const obj = pickObject(ev);
    if (obj) {
      select(obj.id);
      setPlaying(false);
      drag = startObjectDrag(obj, ev);
    } else {
      drag = { kind: ev.shiftKey || ev.button === 2 ? "pan" : "orbit", x: ev.clientX, y: ev.clientY };
    }
  }

  function startObjectDrag(obj, ev) {
    const d = { kind: "object", obj: obj, x: ev.clientX, y: ev.clientY, mode: state.mode };
    if (state.mode === "move") {
      d.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -obj.root.position.y);
      const hitP = new THREE.Vector3();
      raycaster.setFromCamera(ndc(ev), editorCam);
      d.offset = raycaster.ray.intersectPlane(d.plane, hitP)
        ? obj.root.position.clone().sub(hitP)
        : new THREE.Vector3();
      // 進んだ向きに体を向けるための基準点
      d.faceStart = obj.root.position.clone();
      d.faceFrom = obj.root.position.clone();
      d.yawTarget = obj.root.rotation.y;
      d.faced = false;
    }
    return d;
  }

  function onPointerMove(ev) {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size === 2 && gesture) {
      const c = pointerCenter();
      if (state.view === "camera") {
        const camObj = theCamera();
        if (camObj) {
          if (c.d > 0) dollyCamera(camObj, (c.d - gesture.d) * 0.012);
          shiftCamera(camObj, c.x - gesture.x, c.y - gesture.y, subjectDist(camObj));
          autoKey(camObj);
        }
      } else {
        if (c.d > 0) orbit.radius = Math.max(1.2, Math.min(60, gesture.radius * (gesture.d / c.d)));
        orbit.theta -= (c.x - gesture.x) * 0.006;
        orbit.phi = Math.max(0.08, Math.min(Math.PI - 0.08, orbit.phi - (c.y - gesture.y) * 0.006));
        updateEditorCam();
      }
      gesture.x = c.x;
      gesture.y = c.y;
      gesture.d = c.d;
      gesture.radius = orbit.radius;
      return;
    }

    if (!drag) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    drag.x = ev.clientX;
    drag.y = ev.clientY;

    if (drag.kind === "orbit") {
      orbit.theta -= dx * 0.006;
      orbit.phi = Math.max(0.08, Math.min(Math.PI - 0.08, orbit.phi - dy * 0.006));
      updateEditorCam();
    } else if (drag.kind === "pan") {
      const k = orbit.radius * 0.0016;
      const right = new THREE.Vector3().setFromMatrixColumn(editorCam.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(editorCam.matrix, 1);
      orbit.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      updateEditorCam();
    } else if (drag.kind === "camlook") {
      if (drag.mode === "shift") {
        shiftCamera(drag.obj, dx, dy, drag.ref);
      } else {
        const cam = drag.obj.root;
        cam.rotation.y -= dx * 0.004;
        cam.rotation.x = Math.max(-1.4, Math.min(1.4, cam.rotation.x - dy * 0.004));
      }
      autoKey(drag.obj);
    } else if (drag.kind === "object") {
      applyObjectDrag(drag, ev, dx, dy);
      autoKey(drag.obj);
      updateSelRing();
    }
  }

  function applyObjectDrag(d, ev, dx, dy) {
    const obj = d.obj;
    const root = obj.root;

    if (d.mode === "move") {
      const hitP = new THREE.Vector3();
      raycaster.setFromCamera(ndc(ev), editorCam);
      if (raycaster.ray.intersectPlane(d.plane, hitP)) {
        const next = hitP.add(d.offset);
        root.position.x = next.x;
        root.position.z = next.z;
      }
      // 歩いた向きに体も向ける（道具を切り替えずに配置と向きが決まるように）。
      if (obj.type === "char" && state.autoFace) {
        const sx = root.position.x - d.faceStart.x;
        const sz = root.position.z - d.faceStart.z;
        // 立ち位置をちょっと直しただけのときは回さない
        if (Math.hypot(sx, sz) > 0.25) {
          const ax = root.position.x - d.faceFrom.x;
          const az = root.position.z - d.faceFrom.z;
          if (Math.hypot(ax, az) > 0.15) {
            d.yawTarget = Math.atan2(ax, az); // 正面は +Z
            d.faceFrom.copy(root.position);
            d.faced = true;
          }
          if (d.faced) root.rotation.y = lerpAngle(root.rotation.y, d.yawTarget, 0.25);
        }
      }
    } else if (d.mode === "lift") {
      const dist = editorCam.position.distanceTo(root.position);
      const k = (dist * Math.tan((editorCam.fov * Math.PI) / 180 / 2) * 2) / (host.clientHeight || 1);
      root.position.y = Math.max(obj.type === "char" ? 0 : 0.05, root.position.y - dy * k);
    } else if (d.mode === "yaw") {
      root.rotation.y -= dx * 0.01;
    } else if (d.mode === "head") {
      if (obj.type === "char") {
        const hp = root.userData.headPivot;
        // 頭は体に対して±100°までひねれる
        hp.rotation.y = Math.max(-1.75, Math.min(1.75, hp.rotation.y - dx * 0.01));
      } else {
        root.rotation.x = Math.max(-1.4, Math.min(1.4, root.rotation.x - dy * 0.006));
      }
    }
  }

  function onPointerUp(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) gesture = null;

    // 追従の途中で指を離しても、最後は進んだ向きに合わせて記録し直す
    const d = drag;
    drag = null;
    if (d && d.kind === "object" && d.mode === "move" && d.obj.type === "char" && state.autoFace) {
      if (d.faced && Math.abs(d.obj.root.rotation.y - d.yawTarget) > 1e-4) {
        d.obj.root.rotation.y = d.yawTarget;
        autoKey(d.obj);
      }
    }
  }

  function dollyCamera(camObj, amount) {
    const cam = camObj.root;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    cam.position.addScaledVector(fwd, amount);
    cam.position.y = Math.max(0.05, cam.position.y);
  }

  function onWheel(ev) {
    ev.preventDefault();
    if (state.view === "camera") {
      const camObj = theCamera();
      if (!camObj) return;
      dollyCamera(camObj, -ev.deltaY * 0.004);
      autoKey(camObj);
    } else {
      orbit.radius = Math.max(1.2, Math.min(60, orbit.radius * Math.exp(ev.deltaY * 0.001)));
      updateEditorCam();
    }
  }

  // ---------------------------------------------------------------- 選択バッジ

  function select(id) {
    state.selectedId = id;
    const obj = objById(id);
    const badge = $("sel");

    if (!obj) {
      badge.hidden = true;
    } else {
      badge.hidden = false;
      $("selDot").style.background = obj.css;
      $("selName").textContent = obj.name;
      const isCam = obj.type === "camera";
      $("selLensWrap").hidden = !isCam;
      $("selDelete").hidden = isCam;
      syncLens();
      // 道具の意味はカメラのときだけ言い換える
      setTip($("tools").querySelector('[data-mode="yaw"]'), isCam ? "カメラをふる" : "体のむき");
      setTip($("tools").querySelector('[data-mode="head"]'), isCam ? "カメラの上下" : "頭のむき");
    }
    tlDirty = true;
    updateSelRing();
  }

  function setTip(el, text) {
    el.setAttribute("data-tip", text);
    el.setAttribute("aria-label", text);
  }

  function syncLens() {
    const obj = selected();
    if (!obj || obj.type !== "camera") return;
    const mm = Math.round(fovToLens(obj.root.fov));
    $("selLens").value = mm;
    $("selLensOut").textContent = mm + "mm";
  }

  let toastTimer = null;
  function showToast(text) {
    const el = $("toast");
    el.textContent = text;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("is-on"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("is-on");
      setTimeout(() => (el.hidden = true), 220);
    }, 1100);
  }

  // ---------------------------------------------------------------- タイムライン

  const tlDots = $("tlDots");
  const tlTracks = $("tlTracks");
  const tlRuler = $("tlRuler");
  const tlLanes = $("tlLanes");

  const laneWidth = () => tlLanes.clientWidth || 1;
  const frameToX = (f) => (f / state.duration) * laneWidth();
  const xToFrame = (x) => Math.round((x / laneWidth()) * state.duration);

  function renderTimeline() {
    tlDirty = false;
    const w = laneWidth();
    const pxPerSec = (w / state.duration) * state.fps;

    // 目盛りは秒だけ。細かい数字は出さない。
    let step = 1;
    while (pxPerSec * step < 40) step++;
    let html = "";
    for (let s = 0; s * state.fps <= state.duration; s += step) {
      const x = frameToX(s * state.fps);
      html += '<div class="tick" style="left:' + x + 'px"></div>';
      const cls = s === 0 ? " first" : x > w - 16 ? " last" : "";
      html += '<div class="tick-num' + cls + '" style="left:' + x + 'px">' + s + "s</div>";
    }
    tlRuler.innerHTML = html;

    let dots = "";
    let tracks = "";
    state.objects.forEach((obj) => {
      const sel = obj.id === state.selectedId ? " is-selected" : "";
      dots +=
        '<div class="tl-dot' + sel + '" data-obj="' + obj.id + '" title="' + escapeHtml(obj.name) +
        '"><span style="background:' + obj.css + '"></span></div>';
      let keys = "";
      obj.keys.forEach((k) => {
        keys +=
          '<div class="key' + (k.f === state.current ? " is-current" : "") + '" data-obj="' + obj.id +
          '" data-frame="' + k.f + '" style="left:' + frameToX(k.f) + "px;background:" + obj.css + '"></div>';
      });
      tracks += '<div class="tl-track' + sel + '" data-obj="' + obj.id + '">' + keys + "</div>";
    });
    tlDots.innerHTML = dots;
    tlTracks.innerHTML = tracks;
    updatePlayhead();
  }

  function updatePlayhead() {
    $("tlPlayhead").style.left = frameToX(state.current) + "px";
  }

  function updateKeyHighlight() {
    tlTracks.querySelectorAll(".key").forEach((el) => {
      el.classList.toggle("is-current", +el.dataset.frame === state.current);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  let tlDrag = null;

  function tlPointerDown(ev) {
    const keyEl = ev.target.closest ? ev.target.closest(".key") : null;
    const laneRect = tlLanes.getBoundingClientRect();
    setPlaying(false);

    if (keyEl) {
      const obj = objById(+keyEl.dataset.obj);
      const frame = +keyEl.dataset.frame;
      select(obj.id);
      setFrame(frame);
      tlDrag = { kind: "key", obj: obj, frame: frame };
    } else {
      const trackEl = ev.target.closest ? ev.target.closest(".tl-track") : null;
      if (trackEl) select(+trackEl.dataset.obj);
      tlDrag = { kind: "scrub" };
      setFrame(xToFrame(ev.clientX - laneRect.left));
    }
    ev.currentTarget.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }

  function tlPointerMove(ev) {
    if (!tlDrag) return;
    const laneRect = tlLanes.getBoundingClientRect();
    const f = Math.max(0, Math.min(state.duration, xToFrame(ev.clientX - laneRect.left)));

    if (tlDrag.kind === "scrub") {
      setFrame(f);
    } else if (tlDrag.kind === "key" && f !== tlDrag.frame) {
      const obj = tlDrag.obj;
      const k = obj.keys.find((x) => x.f === tlDrag.frame);
      if (!k) return;
      const clash = obj.keys.find((x) => x.f === f && x !== k);
      if (clash) obj.keys.splice(obj.keys.indexOf(clash), 1);
      k.f = f;
      obj.keys.sort((a, b) => a.f - b.f);
      tlDrag.frame = f;
      markDirty();
      setFrame(f);
    }
  }

  const tlPointerUp = () => (tlDrag = null);

  // ---------------------------------------------------------------- 書き出し

  const deg = (rad) => Math.round((rad * 180) / Math.PI);

  function normDeg(d) {
    let v = d % 360;
    if (v > 180) v -= 360;
    if (v < -180) v += 360;
    return v;
  }

  function shotText() {
    const lines = [];
    lines.push(
      "【ショット設計】" + state.fps + "fps / " + state.duration + "F (" +
        secs(state.duration).toFixed(2) + "秒) / 補間: " + (state.ease === "smooth" ? "ふんわり" : "まっすぐ")
    );

    state.objects.forEach((obj) => {
      const a = sample(obj, 0);
      const b = sample(obj, state.duration);
      const dist = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z);
      const pos = (s) => "(" + s.p.x.toFixed(2) + ", " + s.p.y.toFixed(2) + ", " + s.p.z.toFixed(2) + ")";
      const parts = ["位置 " + pos(a) + " → " + pos(b)];

      if (obj.type === "camera") {
        if (dist > 0.05) parts.push("移動 " + dist.toFixed(2) + "m");
        const pan = normDeg(deg(b.r.y) - deg(a.r.y));
        const tilt = normDeg(deg(b.r.x) - deg(a.r.x));
        if (Math.abs(pan) >= 2) parts.push("パン " + (pan > 0 ? "+" : "") + pan + "°");
        if (Math.abs(tilt) >= 2) parts.push("チルト " + (tilt > 0 ? "+" : "") + tilt + "°");
        const la = Math.round(a.lens);
        const lb = Math.round(b.lens);
        parts.push(la === lb ? "レンズ " + la + "mm" : "レンズ " + la + "mm → " + lb + "mm");
      } else {
        parts.push(dist > 0.05 ? "移動 " + dist.toFixed(2) + "m" : "その場");
        parts.push("体の向き " + deg(a.r.y) + "° → " + deg(b.r.y) + "°");
        const ha = deg(a.h);
        const hb = deg(b.h);
        parts.push(ha === hb ? "頭 体に対して " + ha + "°" : "頭 " + ha + "° → " + hb + "°");
      }
      parts.push("キー " + obj.keys.length + "個");
      lines.push("■ " + obj.name + ": " + parts.join(" / "));
    });

    lines.push("");
    lines.push("※ 座標は右手系・単位メートル。+Z がキャラクターの正面、Y が高さ。");
    return lines.join("\n");
  }

  // 動画生成AIに投げるときの英語プロンプトのたたき台
  function promptDraft() {
    const camObj = theCamera();
    const bits = [];
    if (camObj) {
      const a = sample(camObj, 0);
      const b = sample(camObj, state.duration);
      const move = new THREE.Vector3(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z);
      const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(a.r.x, a.r.y, 0, "YXZ"));
      const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, a.r.y, 0, "YXZ"));
      const along = move.dot(fwd);
      const side = move.dot(right);
      const moves = [];
      if (Math.abs(along) > 0.3) moves.push(along > 0 ? "slow dolly in" : "slow dolly out");
      if (Math.abs(side) > 0.3) moves.push(side > 0 ? "truck right" : "truck left");
      if (Math.abs(move.y) > 0.2) moves.push(move.y > 0 ? "crane up" : "crane down");
      const pan = normDeg(deg(b.r.y) - deg(a.r.y));
      if (Math.abs(pan) >= 4) moves.push(pan > 0 ? "pan left" : "pan right");
      const la = Math.round(a.lens);
      const lb = Math.round(b.lens);
      if (Math.abs(la - lb) >= 3) moves.push(lb > la ? "zoom in" : "zoom out");
      bits.push(moves.length ? moves.join(", ") : "locked-off camera");
      bits.push(la + "mm lens");
    }
    state.objects
      .filter((o) => o.type === "char")
      .forEach((o) => {
        const a = sample(o, 0);
        const b = sample(o, state.duration);
        const d = Math.hypot(b.p.x - a.p.x, b.p.z - a.p.z);
        const color = COLORS[o.colorIndex % COLORS.length].key;
        bits.push(color + " subject " + (d > 0.3 ? "walking " + d.toFixed(1) + "m" : "standing still"));
      });
    bits.push(secs(state.duration).toFixed(1) + "s shot");
    return bits.join(", ") + ".";
  }

  function serialize() {
    return {
      version: 1,
      fps: state.fps,
      duration: state.duration,
      ease: state.ease,
      autoFace: state.autoFace,
      objects: state.objects.map((o) => ({
        type: o.type,
        name: o.name,
        colorIndex: o.colorIndex,
        keys: o.keys,
      })),
    };
  }

  function loadScene(data) {
    if (!data || !Array.isArray(data.objects)) return false;
    state.objects.slice().forEach(removeObject);
    state.objects = [];
    state.charCount = 0;
    state.selectedId = null;

    state.fps = +data.fps || 24;
    state.duration = Math.max(2, +data.duration || 120);
    state.ease = data.ease === "linear" ? "linear" : "smooth";
    state.autoFace = data.autoFace !== false;

    data.objects.forEach((o) => {
      if (o.type === "camera") addCamera({ keys: o.keys });
      else addCharacter({ name: o.name, colorIndex: o.colorIndex, keys: o.keys });
    });
    if (!theCamera()) addCamera({});

    syncSettings();
    const cam = theCamera();
    select(cam ? cam.id : null);
    setFrame(0);
    markDirty();
    return true;
  }

  let saveTimer = null;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
      } catch (e) {
        /* 保存できなくても編集は続けられるので握りつぶす */
      }
    }, 400);
  }

  function capturePng(frame) {
    const camObj = theCamera();
    if (!camObj) return null;
    const keep = state.current;
    const w = host.clientWidth;
    const h = host.clientHeight;

    applyFrame(frame);
    camObj.root.userData.rig.visible = false;
    trailGroup.visible = false;
    selRing.visible = false;
    renderer.setScissorTest(false);
    renderer.setSize(1280, 720, false);
    renderer.setViewport(0, 0, 1280, 720);
    renderer.render(scene, camObj.root);
    const url = renderer.domElement.toDataURL("image/png");

    renderer.setSize(w, h, false);
    applyFrame(keep);
    layout();
    return url;
  }

  function saveFile(url, filename, revoke) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (revoke) setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      done();
    }
  }

  // ---------------------------------------------------------------- シート

  function openSheet(title, html) {
    $("sheetTitle").textContent = title;
    $("sheetBody").innerHTML = html;
    $("sheet").hidden = false;
  }

  const closeSheet = () => ($("sheet").hidden = true);

  const icon = (id) => '<svg><use href="#' + id + '"/></svg>';

  function openExport() {
    closePop();
    openSheet(
      "書き出す",
      '<button class="row-btn" id="bCopyShot">' + icon("i-copy") +
        "<span>ショットの説明をコピー<small>カメラと人の動きを文章にします</small></span></button>" +
        '<button class="row-btn" id="bCopyPrompt">' + icon("i-copy") +
        "<span>英語プロンプトをコピー<small>生成AIに渡すたたき台</small></span></button>" +
        "<h3>画像（1280×720）</h3>" +
        '<div class="chips"><button class="chip" data-png="first">さいしょ</button>' +
        '<button class="chip" data-png="current">いま</button>' +
        '<button class="chip" data-png="last">さいご</button></div>' +
        '<button class="row-btn" id="bSave">' + icon("i-save") +
        "<span>このシーンを保存<small>あとで読み込めます</small></span></button>" +
        '<button class="row-btn" id="bLoad">' + icon("i-open") +
        "<span>シーンを読み込む</span></button>" +
        '<input type="file" id="fJson" accept="application/json,.json" hidden>' +
        '<textarea id="exText" spellcheck="false" readonly hidden></textarea>'
    );

    const flash = (btn, msg) => {
      const span = btn.querySelector("span");
      const keep = span.innerHTML;
      span.textContent = msg;
      setTimeout(() => (span.innerHTML = keep), 1300);
    };

    // currentTarget はイベント終了後に null になるので、先に掴んでおく
    const onCopy = (make) => (e) => {
      const btn = e.currentTarget;
      copyText(make(), () => flash(btn, "コピーしました"));
    };
    $("bCopyShot").onclick = onCopy(shotText);
    $("bCopyPrompt").onclick = onCopy(promptDraft);

    $("sheetBody").querySelectorAll("[data-png]").forEach((btn) => {
      btn.onclick = () => {
        const which = btn.dataset.png;
        const f = which === "first" ? 0 : which === "last" ? state.duration : state.current;
        const url = capturePng(f);
        if (url) saveFile(url, "previz_" + which + "_f" + f + ".png");
      };
    });

    $("bSave").onclick = () => {
      const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: "application/json" });
      saveFile(URL.createObjectURL(blob), "previz-scene.json", true);
    };
    $("bLoad").onclick = () => $("fJson").click();
    $("fJson").onchange = (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          if (loadScene(JSON.parse(reader.result))) closeSheet();
          else showToast("読み込めませんでした");
        } catch (e) {
          showToast("読み込めませんでした");
        }
      };
      reader.readAsText(file);
    };
  }

  function openHelp() {
    closePop();
    const li = (ic, t, s) => "<li>" + icon(ic) + "<span><b>" + t + "</b><span>" + s + "</span></span></li>";
    openSheet(
      "つかいかた",
      "<p>箱の人とカメラでカットの動きだけ先に決めて、そのまま生成動画AIへの指示に使うための道具です。</p>" +
        '<ul class="howto">' +
        li("i-move", "指でドラッグして動かす", "歩いた向きに体も自動で向くので、道具を切り替えずに配置と向きが決まります。つかんでいる間、キャラは嫌がってプルプルします。何もない所をドラッグすると視点がまわり、2本指でひろげると寄り引きできます。") +
        li("i-head", "白い四角錐は頭の向き", "体とは別に向きを変えられるので、歩きながら横を見る芝居も作れます。") +
        li("i-turn", "向きだけ変えたいとき", "道具の「体のむき」で向きだけ直せます。動かしても向きを変えたくないときは、設定の「進む向きを向く」を切ってください。") +
        li("i-add", "色は 赤→青→緑→黄 の順", "追加した順に色が決まり、5人目からまた赤に戻ります。") +
        li("i-play", "時間をあわせてから動かす", "下のバーで時間を選んでから動かすと、その時間に自動で記録されます。記録した点は左右にドラッグでずらせます。") +
        li("i-cam", "カメラからのぞく", "右の道具で「ふる」と「上下左右にずらす」を切り替えられます。前後はホイールか2本指でひろげる操作、2本指を滑らせると上下左右にずれます。") +
        "</ul>" +
        (canHover
          ? "<h3>キーボード</h3><p><kbd>Space</kbd> 再生／とめる　<kbd>←</kbd><kbd>→</kbd> こま送り　" +
            "<kbd>Delete</kbd> いまの記録を消す　<kbd>1</kbd>〜<kbd>4</kbd> 道具きりかえ</p>"
          : "")
    );
  }

  // ---------------------------------------------------------------- 設定

  function syncSettings() {
    $("pDur").value = Math.min(15, Math.max(1, +secs(state.duration).toFixed(1)));
    $("pDurOut").textContent = secs(state.duration).toFixed(1) + "秒";
    $("pLoop").checked = state.loop;
    $("pFace").checked = state.autoFace;
    $("pTrails").checked = state.trails;
    $("pGrid").checked = state.grid;
    segSync($("pEase"), state.ease);
    segSync($("pFps"), String(state.fps));
  }

  function segSync(seg, value) {
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b.dataset.v === value));
  }

  const closePop = () => ($("pop").hidden = true);

  function setDuration(frames) {
    state.duration = Math.max(2, Math.round(frames));
    state.objects.forEach((o) => {
      o.keys = o.keys.filter((k) => k.f <= state.duration);
      if (!o.keys.length) o.keys = [readKey(o, 0)];
    });
    setFrame(Math.min(state.current, state.duration));
    markDirty();
  }

  // ---------------------------------------------------------------- 初期化

  function defaultScene() {
    addCamera({ pos: { x: 0, y: 1.45, z: 6.8 }, rx: -0.06, lens: 35 });
    addCharacter({ pos: { x: -0.85, y: 0, z: 0 }, ry: Math.PI * 0.06 });
    addCharacter({ pos: { x: 0.95, y: 0, z: -0.4 }, ry: -Math.PI * 0.08 });
  }

  function bind() {
    const el = renderer.domElement;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    $("addBtn").onclick = () => {
      const obj = addCharacter({ pos: freeSpot(), frame: state.current, pop: true });
      select(obj.id);
      markDirty();
      showToast(obj.name + " をふやしました");
    };

    $("viewBtn").onclick = () => {
      state.view = state.view === "camera" ? "editor" : "camera";
      const cam = state.view === "camera";
      useIcon($("viewIcon"), cam ? "#i-cube" : "#i-cam");
      setTip($("viewBtn"), cam ? "ぜんたいを見る" : "カメラからのぞく");
      $("framing").hidden = !cam;
      $("tools").hidden = cam;
      $("camTools").hidden = !cam;
      if (cam) {
        const c = theCamera();
        if (c) select(c.id);
        showToast("カメラ視点");
      }
      updateSelRing();
    };

    $("tuneBtn").onclick = () => {
      $("pop").hidden = !$("pop").hidden;
      if (!$("pop").hidden) syncSettings();
    };

    $("shareBtn").onclick = openExport;
    $("helpBtn").onclick = openHelp;
    $("sheetClose").onclick = closeSheet;
    $("sheet").addEventListener("click", (ev) => {
      if (ev.target === $("sheet")) closeSheet();
    });

    $("tools").addEventListener("click", (ev) => {
      const btn = ev.target.closest(".ib");
      if (!btn) return;
      state.mode = btn.dataset.mode;
      $("tools").querySelectorAll(".ib").forEach((b) => b.classList.toggle("is-active", b === btn));
      if (!canHover) showToast(btn.getAttribute("data-tip"));
    });

    $("camTools").addEventListener("click", (ev) => {
      const btn = ev.target.closest(".ib");
      if (!btn) return;
      state.camMode = btn.dataset.cam;
      $("camTools").querySelectorAll(".ib").forEach((b) => b.classList.toggle("is-active", b === btn));
      if (!canHover) showToast(btn.getAttribute("data-tip"));
    });

    $("selDelete").onclick = () => {
      const obj = selected();
      if (!obj || obj.type === "camera") return;
      removeObject(obj);
      select(state.objects.length ? state.objects[0].id : null);
      markDirty();
    };

    $("selLens").addEventListener("input", () => {
      const obj = selected();
      if (!obj || obj.type !== "camera") return;
      const mm = +$("selLens").value;
      $("selLensOut").textContent = mm + "mm";
      obj.root.fov = lensToFov(mm);
      obj.root.updateProjectionMatrix();
      updateFrustum(obj.root);
      autoKey(obj);
    });

    // 設定
    $("pDur").addEventListener("input", () => {
      const sec = +$("pDur").value;
      $("pDurOut").textContent = sec.toFixed(1) + "秒";
      setDuration(sec * state.fps);
    });

    $("pEase").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      state.ease = b.dataset.v;
      segSync($("pEase"), state.ease);
      applyFrame(state.current);
      markDirty();
    });

    $("pFps").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      const next = +b.dataset.v;
      const scale = next / state.fps;
      // 秒での見え方が変わらないよう、キーごと時間軸を伸縮させる
      state.fps = next;
      state.duration = Math.max(2, Math.round(state.duration * scale));
      state.objects.forEach((o) => {
        o.keys.forEach((k) => (k.f = Math.round(k.f * scale)));
        o.keys = o.keys.filter((k, i, arr) => arr.findIndex((x) => x.f === k.f) === i);
      });
      segSync($("pFps"), String(state.fps));
      setFrame(Math.round(state.current * scale));
      markDirty();
    });

    $("pLoop").onchange = () => (state.loop = $("pLoop").checked);
    $("pFace").onchange = () => {
      state.autoFace = $("pFace").checked;
      markDirty();
    };
    $("pTrails").onchange = () => {
      state.trails = $("pTrails").checked;
      trailsDirty = true;
    };
    $("pGrid").onchange = () => (state.grid = $("pGrid").checked);

    // 再生まわり
    $("playBtn").onclick = () => setPlaying(!state.playing);
    $("startBtn").onclick = () => setFrame(0);
    $("endBtn").onclick = () => setFrame(state.duration);

    [tlRuler, tlTracks].forEach((elm) => {
      elm.addEventListener("pointerdown", tlPointerDown);
      elm.addEventListener("pointermove", tlPointerMove);
      elm.addEventListener("pointerup", tlPointerUp);
      elm.addEventListener("pointercancel", tlPointerUp);
    });

    tlDots.addEventListener("click", (ev) => {
      const row = ev.target.closest(".tl-dot");
      if (row) select(+row.dataset.obj);
    });

    window.addEventListener("keydown", (ev) => {
      const t = ev.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (ev.key === " ") {
        ev.preventDefault();
        setPlaying(!state.playing);
      } else if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        setFrame(state.current - (ev.shiftKey ? 10 : 1));
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        setFrame(state.current + (ev.shiftKey ? 10 : 1));
      } else if (ev.key === "Delete" || ev.key === "Backspace") {
        const obj = selected();
        if (obj && deleteKeyAt(obj, state.current)) applyFrame(state.current);
      } else if (ev.key === "Escape") {
        closeSheet();
        closePop();
      } else if (["1", "2", "3", "4"].indexOf(ev.key) >= 0) {
        const bar = state.view === "camera" ? $("camTools") : $("tools");
        const btn = bar.querySelectorAll(".ib")[+ev.key - 1];
        if (btn) btn.click();
      }
    });

    window.addEventListener("resize", layout);
    if (window.ResizeObserver) {
      // タイムラインの行数が変わるとビューポートの安全域も変わるので要素側でも監視する
      const ro = new ResizeObserver(() => layout());
      ro.observe(host);
      ro.observe($("dock"));
    }
  }

  function init() {
    let restored = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) restored = loadScene(JSON.parse(raw));
    } catch (e) {
      restored = false;
    }
    if (!restored) {
      defaultScene();
      syncSettings();
      const cam = theCamera();
      if (cam) select(cam.id);
    }

    bind();
    layout();
    setFrame(state.current);
    setPlaying(false);
    tick();
  }

  init();
})();
