/*
 * プレビズエディタ
 * 生成動画AIに渡すカットを、箱人間とカメラで先に組み立てるための簡易プレビズツール。
 * キャラクターは「体＝ボックス」「頭＝ボックス」「白い四角錐＝頭の向き」で構成する。
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
  const CAM_COLOR = "#cfd6e4";

  const STORAGE_KEY = "previz-editor.scene.v1";

  const lensToFov = (mm) => 2 * Math.atan(SENSOR_H / 2 / mm) * (180 / Math.PI);

  // ---------------------------------------------------------------- 状態

  const state = {
    fps: 24,
    duration: 120,
    current: 0,
    playing: false,
    loop: true,
    ease: "linear",
    trails: true,
    grid: true,
    view: "editor", // "editor" | "camera"
    mode: "move", // "move" | "lift" | "yaw" | "head"
    objects: [],
    selectedId: null,
    nextId: 1,
    charCount: 0,
  };

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- three 基本

  const host = $("canvasHost");
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true, // PNG書き出しのため
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x0f1116, 1);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1116);
  scene.fog = new THREE.Fog(0x0f1116, 22, 60);

  const editorCam = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  const orbit = { target: new THREE.Vector3(0, 0.9, 0), radius: 9, theta: 0.6, phi: 1.15 };

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

  scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x2a2d36, 0.85));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
  keyLight.position.set(5, 9, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -12;
  keyLight.shadow.camera.right = 12;
  keyLight.shadow.camera.top = 12;
  keyLight.shadow.camera.bottom = -12;
  scene.add(keyLight);
  const fill = new THREE.DirectionalLight(0x8fa6d0, 0.3);
  fill.position.set(-6, 4, -5);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(40, 40, 0x5b657d, 0x343a48);
  grid.position.y = 0.006; // 床と同じ高さだとZファイティングで消えるので少し浮かせる
  scene.add(grid);

  const trailGroup = new THREE.Group();
  scene.add(trailGroup);

  // 選択ハイライト（足元のリング）
  const selRing = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.5, 40),
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

    const mat = new THREE.MeshStandardMaterial({ color: color.hex, roughness: 0.68, metalness: 0.04 });
    // 頭は体と地続きに見えないよう、少し明るい色にして首で間を空ける
    const headMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color.hex).lerp(new THREE.Color(0xffffff), 0.22),
      roughness: 0.66,
      metalness: 0.04,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(BODY_W, BODY_H, BODY_D), mat);
    body.position.y = BODY_H / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);

    const neck = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, NECK_H + 0.02, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.8 })
    );
    neck.position.y = BODY_H + NECK_H / 2;
    root.add(neck);

    // 頭は体とは別に回せるようにピボットを挟む
    const headPivot = new THREE.Group();
    headPivot.position.y = HEAD_Y;
    root.add(headPivot);

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
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0 })
    );
    cone.castShadow = true;
    headPivot.add(cone);

    root.userData.headPivot = headPivot;
    return root;
  }

  function buildCamRig(camera) {
    const rig = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x9fa8ba, roughness: 0.5, metalness: 0.2 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.46), bodyMat);
    box.castShadow = true;
    rig.add(box);

    const lensMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 16), bodyMat);
    lensMesh.rotation.x = Math.PI / 2;
    lensMesh.position.z = -0.32;
    rig.add(lensMesh);

    const frustum = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.75 })
    );
    rig.add(frustum);
    rig.userData.frustum = frustum;

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

  function addCharacter(opts) {
    const o = opts || {};
    const colorIndex = o.colorIndex != null ? o.colorIndex : state.charCount;
    const color = COLORS[colorIndex % COLORS.length];
    const root = buildCharacter(colorIndex);
    root.userData.objId = state.nextId;

    const obj = {
      id: state.nextId++,
      type: "char",
      name: o.name || "キャラ" + (state.charCount + 1),
      colorIndex: colorIndex,
      css: color.css,
      root: root,
      keys: [],
    };
    state.charCount++;
    scene.add(root);
    state.objects.push(obj);

    if (o.keys && o.keys.length) {
      obj.keys = o.keys.map(normalizeKey);
    } else {
      const p = o.pos || { x: 0, y: 0, z: 0 };
      const ry = o.ry != null ? o.ry : 0;
      root.position.set(p.x, p.y, p.z);
      root.rotation.y = ry;
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
      name: o.name || "カメラ",
      colorIndex: -1,
      css: CAM_COLOR,
      root: cam,
      keys: [],
    };
    state.objects.push(obj);

    if (o.keys && o.keys.length) {
      obj.keys = o.keys.map(normalizeKey);
    } else {
      const p = o.pos || { x: 0, y: 1.55, z: 5.4 };
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

  const fovToLens = (fov) => SENSOR_H / 2 / Math.tan((fov * Math.PI) / 180 / 2);

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
      r: {
        x: lerpAngle(a.r.x, b.r.x, t),
        y: lerpAngle(a.r.y, b.r.y, t),
        z: lerpAngle(a.r.z, b.r.z, t),
      },
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

  // ---------------------------------------------------------------- 軌跡ライン

  let trailsDirty = true;
  function markDirty() {
    trailsDirty = true;
    renderTimeline();
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
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: new THREE.Color(obj.css),
          transparent: true,
          opacity: 0.55,
        })
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

  // ---------------------------------------------------------------- 描画ループ

  let viewRect = null; // カメラ視点でのレターボックス内側（CSS px）

  function layout() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    editorCam.aspect = w / h;
    editorCam.updateProjectionMatrix();

    // カメラ視点は16:9の内側だけを描く
    let rw = w;
    let rh = w / ASPECT;
    if (rh > h) {
      rh = h;
      rw = h * ASPECT;
    }
    viewRect = { x: (w - rw) / 2, y: (h - rh) / 2, w: rw, h: rh };

    const framing = $("framing");
    const bar = viewRect.y;
    framing.querySelector(".letterbox-top").style.height = bar + "px";
    framing.querySelector(".letterbox-bottom").style.height = bar + "px";
    const safe = $("safeArea");
    safe.style.left = viewRect.x + "px";
    safe.style.top = viewRect.y + "px";
    safe.style.width = viewRect.w + "px";
    safe.style.height = viewRect.h + "px";

    renderTimeline();
  }

  const clock = new THREE.Clock();
  let frameAcc = 0;

  function tick() {
    requestAnimationFrame(tick);
    const dt = clock.getDelta();

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
        setFrame(f, true);
      }
    }

    if (trailsDirty) rebuildTrails();

    const camObj = state.objects.find((o) => o.type === "camera");
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

  // ---------------------------------------------------------------- 再生・フレーム操作

  function setFrame(f, silent) {
    const nf = Math.max(0, Math.min(state.duration, Math.round(f)));
    state.current = nf;
    applyFrame(nf);
    $("frameInput").value = nf;
    $("hudFrame").textContent = "F " + nf;
    $("hudTime").textContent = (nf / state.fps).toFixed(2) + "s";
    updatePlayhead();
    updateKeyHighlight();
    if (!silent) syncInspector();
    else syncInspectorValues();
  }

  function setPlaying(on) {
    state.playing = on;
    frameAcc = 0;
    $("playBtn").textContent = on ? "❚❚" : "▶";
  }

  function allKeyFrames() {
    const set = new Set();
    const obj = selected();
    const list = obj ? [obj] : state.objects;
    list.forEach((o) => o.keys.forEach((k) => set.add(k.f)));
    return Array.from(set).sort((a, b) => a - b);
  }

  // ---------------------------------------------------------------- ビューポート操作

  const raycaster = new THREE.Raycaster();
  const pointers = new Map();
  let drag = null;
  let pinchStart = null;

  function ndc(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  function pickObject(ev) {
    raycaster.setFromCamera(ndc(ev), editorCam);
    const targets = [];
    state.objects.forEach((o) => {
      if (o.type === "camera") targets.push(o.root.userData.rig);
      else targets.push(o.root);
    });
    const hits = raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      let n = hit.object;
      while (n) {
        if (n.userData && n.userData.objId != null) return { obj: objById(n.userData.objId), point: hit.point };
        n = n.parent;
      }
    }
    return null;
  }

  function onPointerDown(ev) {
    renderer.domElement.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size === 2) {
      drag = null;
      const p = Array.from(pointers.values());
      pinchStart = {
        dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
        radius: orbit.radius,
      };
      return;
    }

    if (state.view === "camera") {
      const camObj = state.objects.find((o) => o.type === "camera");
      if (camObj) {
        select(camObj.id);
        drag = { kind: "camlook", obj: camObj, x: ev.clientX, y: ev.clientY };
      }
      return;
    }

    const hit = pickObject(ev);
    if (hit && hit.obj) {
      select(hit.obj.id);
      setPlaying(false);
      drag = startObjectDrag(hit.obj, ev, hit.point);
    } else {
      drag = { kind: ev.shiftKey || ev.button === 2 ? "pan" : "orbit", x: ev.clientX, y: ev.clientY };
    }
  }

  function startObjectDrag(obj, ev, point) {
    const d = { kind: "object", obj: obj, x: ev.clientX, y: ev.clientY, mode: state.mode };
    if (state.mode === "move") {
      d.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -obj.root.position.y);
      const hitP = new THREE.Vector3();
      raycaster.setFromCamera(ndc(ev), editorCam);
      if (raycaster.ray.intersectPlane(d.plane, hitP)) {
        d.offset = obj.root.position.clone().sub(hitP);
      } else {
        d.offset = new THREE.Vector3();
      }
    }
    return d;
  }

  function onPointerMove(ev) {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size === 2 && pinchStart) {
      const p = Array.from(pointers.values());
      const dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (dist > 0) {
        if (state.view === "camera") {
          const camObj = state.objects.find((o) => o.type === "camera");
          if (camObj) {
            dollyCamera(camObj, (dist - pinchStart.dist) * 0.01);
            pinchStart.dist = dist;
            autoKey(camObj);
          }
        } else {
          orbit.radius = Math.max(1, Math.min(60, pinchStart.radius * (pinchStart.dist / dist)));
          updateEditorCam();
        }
      }
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
      const cam = drag.obj.root;
      cam.rotation.y -= dx * 0.004;
      cam.rotation.x = Math.max(-1.4, Math.min(1.4, cam.rotation.x - dy * 0.004));
      autoKey(drag.obj);
      syncInspectorValues();
    } else if (drag.kind === "object") {
      applyObjectDrag(drag, ev, dx, dy);
      autoKey(drag.obj);
      syncInspectorValues();
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
    if (pointers.size < 2) pinchStart = null;
    drag = null;
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
      const camObj = state.objects.find((o) => o.type === "camera");
      if (!camObj) return;
      dollyCamera(camObj, -ev.deltaY * 0.004);
      autoKey(camObj);
      syncInspectorValues();
    } else {
      orbit.radius = Math.max(1, Math.min(60, orbit.radius * Math.exp(ev.deltaY * 0.001)));
      updateEditorCam();
    }
  }

  // ---------------------------------------------------------------- 選択・インスペクタ

  function select(id) {
    state.selectedId = id;
    syncInspector();
    renderTimeline();
    updateSelRing();
  }

  function syncInspector() {
    const obj = selected();
    const chip = $("inspChip");
    const empty = $("inspEmpty");
    const fields = $("inspFields");

    if (!obj) {
      chip.style.background = "#3a3f4c";
      $("inspName").value = "";
      $("inspName").disabled = true;
      empty.hidden = false;
      fields.hidden = true;
      return;
    }
    $("inspName").disabled = false;
    $("inspName").value = obj.name;
    chip.style.background = obj.css;
    empty.hidden = true;
    fields.hidden = false;

    const isCam = obj.type === "camera";
    $("labRotY").textContent = isCam ? "パン" : "体の向き";
    $("labRotX").textContent = isCam ? "チルト" : "頭の向き";
    $("fovRow").hidden = !isCam;
    $("toolYawLabel").textContent = isCam ? "パン" : "体の向き";
    $("toolHeadLabel").textContent = isCam ? "チルト" : "頭の向き";
    $("delObjBtn").disabled = isCam;
    $("delObjBtn").style.opacity = isCam ? 0.4 : 1;

    syncInspectorValues();
  }

  let syncing = false;
  function syncInspectorValues() {
    const obj = selected();
    if (!obj) return;
    syncing = true;
    const r = obj.root;
    $("fX").value = r.position.x.toFixed(2);
    $("fY").value = r.position.y.toFixed(2);
    $("fZ").value = r.position.z.toFixed(2);
    $("fRotY").value = Math.round((r.rotation.y * 180) / Math.PI);
    if (obj.type === "camera") {
      $("fRotX").value = Math.round((r.rotation.x * 180) / Math.PI);
      const mm = Math.round(fovToLens(r.fov));
      $("fLens").value = mm;
      $("fLensOut").textContent = mm + "mm";
    } else {
      $("fRotX").value = Math.round((r.userData.headPivot.rotation.y * 180) / Math.PI);
    }
    syncing = false;
  }

  function fromInspector() {
    if (syncing) return;
    const obj = selected();
    if (!obj) return;
    const r = obj.root;
    r.position.set(+$("fX").value || 0, +$("fY").value || 0, +$("fZ").value || 0);
    r.rotation.y = ((+$("fRotY").value || 0) * Math.PI) / 180;
    if (obj.type === "camera") {
      r.rotation.x = ((+$("fRotX").value || 0) * Math.PI) / 180;
    } else {
      r.userData.headPivot.rotation.y = ((+$("fRotX").value || 0) * Math.PI) / 180;
    }
    autoKey(obj);
    updateSelRing();
  }

  // ---------------------------------------------------------------- タイムライン

  const tlLabels = $("tlLabels");
  const tlTracks = $("tlTracks");
  const tlRuler = $("tlRuler");
  const tlLanes = $("tlLanes");

  function laneWidth() {
    return tlLanes.clientWidth || 1;
  }

  function frameToX(f) {
    return (f / state.duration) * laneWidth();
  }

  function xToFrame(x) {
    return Math.round((x / laneWidth()) * state.duration);
  }

  function renderTimeline() {
    // ルーラー
    const w = laneWidth();
    const pxPerFrame = w / state.duration;
    const major = state.fps; // 1秒ごと
    let minor = Math.max(1, Math.round(state.fps / 4));
    if (pxPerFrame * minor < 7) minor = major;

    let html = "";
    for (let f = 0; f <= state.duration; f += minor) {
      const isMajor = f % major === 0;
      html += '<div class="tick' + (isMajor ? " major" : "") + '" style="left:' + frameToX(f) + 'px"></div>';
      if (isMajor && pxPerFrame * major > 26) {
        html += '<div class="tick-num" style="left:' + frameToX(f) + 'px">' + f + "</div>";
      }
    }
    tlRuler.innerHTML = html;

    // トラック
    let labels = "";
    let tracks = "";
    state.objects.forEach((obj) => {
      const sel = obj.id === state.selectedId ? " is-selected" : "";
      labels +=
        '<div class="tl-label' +
        sel +
        '" data-obj="' +
        obj.id +
        '"><span class="dot" style="background:' +
        obj.css +
        '"></span><span class="nm">' +
        escapeHtml(obj.name) +
        "</span></div>";

      let keys = "";
      obj.keys.forEach((k) => {
        const cur = k.f === state.current ? " is-current" : "";
        keys +=
          '<div class="key' +
          cur +
          '" data-obj="' +
          obj.id +
          '" data-frame="' +
          k.f +
          '" style="left:' +
          frameToX(k.f) +
          "px;background:" +
          obj.css +
          '"></div>';
      });
      tracks += '<div class="tl-track' + sel + '" data-obj="' + obj.id + '">' + keys + "</div>";
    });
    tlLabels.innerHTML = labels;
    tlTracks.innerHTML = tracks;
    $("frameTotal").textContent = "/ " + state.duration;
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
    return String(s).replace(/[&<>"']/g, (c) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // タイムライン上のポインタ操作（スクラブ／キーのドラッグ）
  let tlDrag = null;

  function tlPointerDown(ev) {
    const keyEl = ev.target.closest ? ev.target.closest(".key") : null;
    const laneRect = tlLanes.getBoundingClientRect();

    if (keyEl) {
      const obj = objById(+keyEl.dataset.obj);
      const frame = +keyEl.dataset.frame;
      select(obj.id);
      setPlaying(false);
      setFrame(frame);
      tlDrag = { kind: "key", obj: obj, frame: frame, el: keyEl };
    } else {
      const trackEl = ev.target.closest ? ev.target.closest(".tl-track") : null;
      if (trackEl) select(+trackEl.dataset.obj);
      setPlaying(false);
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

  function tlPointerUp() {
    tlDrag = null;
  }

  // ---------------------------------------------------------------- 書き出し

  const deg = (rad) => Math.round((rad * 180) / Math.PI);

  function normDeg(d) {
    let v = d % 360;
    if (v > 180) v -= 360;
    if (v < -180) v += 360;
    return v;
  }

  function shotText() {
    const dur = (state.duration / state.fps).toFixed(2);
    const lines = [];
    lines.push("【ショット設計】" + state.fps + "fps / " + state.duration + "F (" + dur + "秒) / 補間: " + (state.ease === "smooth" ? "スムーズ" : "リニア"));

    state.objects.forEach((obj) => {
      const a = sample(obj, 0);
      const b = sample(obj, state.duration);
      const dist = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z);
      const pos = (s) => "(" + s.p.x.toFixed(2) + ", " + s.p.y.toFixed(2) + ", " + s.p.z.toFixed(2) + ")";

      if (obj.type === "camera") {
        const parts = [];
        parts.push("位置 " + pos(a) + " → " + pos(b));
        if (dist > 0.05) parts.push("移動 " + dist.toFixed(2) + "m");
        const pan = normDeg(deg(b.r.y) - deg(a.r.y));
        const tilt = normDeg(deg(b.r.x) - deg(a.r.x));
        if (Math.abs(pan) >= 2) parts.push("パン " + (pan > 0 ? "+" : "") + pan + "°");
        if (Math.abs(tilt) >= 2) parts.push("チルト " + (tilt > 0 ? "+" : "") + tilt + "°");
        const la = Math.round(a.lens);
        const lb = Math.round(b.lens);
        parts.push(la === lb ? "レンズ " + la + "mm" : "レンズ " + la + "mm → " + lb + "mm");
        parts.push("キー " + obj.keys.length + "個");
        lines.push("■ " + obj.name + ": " + parts.join(" / "));
      } else {
        const parts = [];
        parts.push("位置 " + pos(a) + " → " + pos(b));
        parts.push(dist > 0.05 ? "移動 " + dist.toFixed(2) + "m" : "その場");
        parts.push("体の向き " + deg(a.r.y) + "° → " + deg(b.r.y) + "°");
        const ha = deg(a.h);
        const hb = deg(b.h);
        parts.push(ha === hb ? "頭 体に対して " + ha + "°" : "頭 " + ha + "° → " + hb + "°");
        parts.push("キー " + obj.keys.length + "個");
        const color = COLORS[obj.colorIndex % COLORS.length];
        lines.push("■ " + obj.name + "(" + color.label + "): " + parts.join(" / "));
      }
    });

    lines.push("");
    lines.push("※ 座標は右手系・単位メートル。+Z がキャラクターの正面、Y が高さ。");
    return lines.join("\n");
  }

  // 動画生成AIに投げるときの英語プロンプトのたたき台
  function promptDraft() {
    const camObj = state.objects.find((o) => o.type === "camera");
    const bits = [];
    if (camObj) {
      const a = sample(camObj, 0);
      const b = sample(camObj, state.duration);
      const move = new THREE.Vector3(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z);
      const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(a.r.x, a.r.y, 0, "YXZ"));
      const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, a.r.y, 0, "YXZ"));
      const along = move.dot(fwd);
      const side = move.dot(right);
      const rise = move.y;
      const moves = [];
      if (Math.abs(along) > 0.3) moves.push(along > 0 ? "slow dolly in" : "slow dolly out");
      if (Math.abs(side) > 0.3) moves.push(side > 0 ? "truck right" : "truck left");
      if (Math.abs(rise) > 0.2) moves.push(rise > 0 ? "crane up" : "crane down");
      const pan = normDeg(deg(b.r.y) - deg(a.r.y));
      if (Math.abs(pan) >= 4) moves.push(pan > 0 ? "pan left" : "pan right");
      const la = Math.round(a.lens);
      const lb = Math.round(b.lens);
      if (Math.abs(la - lb) >= 3) moves.push(lb > la ? "zoom in" : "zoom out");
      bits.push(moves.length ? moves.join(", ") : "locked-off camera");
      bits.push(la + "mm lens");
    }
    const chars = state.objects.filter((o) => o.type === "char");
    chars.forEach((o) => {
      const a = sample(o, 0);
      const b = sample(o, state.duration);
      const d = Math.hypot(b.p.x - a.p.x, b.p.z - a.p.z);
      const color = COLORS[o.colorIndex % COLORS.length].key;
      bits.push(color + " subject " + (d > 0.3 ? "walking " + d.toFixed(1) + "m" : "standing still"));
    });
    bits.push((state.duration / state.fps).toFixed(1) + "s shot");
    return bits.join(", ") + ".";
  }

  function serialize() {
    return {
      version: 1,
      fps: state.fps,
      duration: state.duration,
      ease: state.ease,
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

    state.fps = data.fps || 24;
    state.duration = Math.max(2, data.duration || 120);
    state.ease = data.ease === "smooth" ? "smooth" : "linear";

    data.objects.forEach((o) => {
      if (o.type === "camera") addCamera({ name: o.name, keys: o.keys });
      else addCharacter({ name: o.name, colorIndex: o.colorIndex, keys: o.keys });
    });
    if (!state.objects.some((o) => o.type === "camera")) addCamera({});

    $("sFps").value = state.fps;
    $("sDuration").value = state.duration;
    $("sEase").value = state.ease;
    const cam = state.objects.find((o) => o.type === "camera");
    if (cam) select(cam.id);
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
    const camObj = state.objects.find((o) => o.type === "camera");
    if (!camObj) return null;
    const keep = state.current;
    const w = host.clientWidth;
    const h = host.clientHeight;
    const rigWasVisible = camObj.root.userData.rig.visible;

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
    camObj.root.userData.rig.visible = rigWasVisible;
    applyFrame(keep);
    layout();
    return url;
  }

  function downloadDataUrl(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------------------------------------------------------------- モーダル

  function openModal(title, html) {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = html;
    $("modal").hidden = false;
  }

  function closeModal() {
    $("modal").hidden = true;
  }

  function openExport() {
    openModal(
      "書き出し",
      '<h3>ショット記述（日本語）</h3>' +
        '<textarea id="exShot" spellcheck="false" readonly></textarea>' +
        '<div class="modal-actions"><button class="btn" id="copyShot">コピー</button></div>' +
        "<h3>プロンプトのたたき台（英語）</h3>" +
        '<textarea id="exPrompt" style="height:70px" spellcheck="false" readonly></textarea>' +
        '<div class="modal-actions"><button class="btn" id="copyPrompt">コピー</button></div>' +
        "<h3>静止画（1280×720 PNG）</h3>" +
        '<p class="modal-note">first / last frame 条件付けに使う想定の書き出しです。</p>' +
        '<div class="modal-actions">' +
        '<button class="btn" id="pngFirst">先頭フレーム</button>' +
        '<button class="btn" id="pngCurrent">現在フレーム</button>' +
        '<button class="btn" id="pngLast">最終フレーム</button>' +
        "</div>" +
        "<h3>シーンデータ（JSON）</h3>" +
        '<div class="modal-actions">' +
        '<button class="btn" id="jsonSave">JSONで保存</button>' +
        '<button class="btn" id="jsonLoad">JSONを読み込み</button>' +
        '<input type="file" id="jsonFile" accept="application/json,.json" hidden>' +
        "</div>"
    );

    $("exShot").value = shotText();
    $("exPrompt").value = promptDraft();

    const copy = (el, btn) => {
      const text = $(el).value;
      const done = () => {
        btn.textContent = "コピーしました";
        setTimeout(() => (btn.textContent = "コピー"), 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => {
          $(el).select();
          document.execCommand("copy");
          done();
        });
      } else {
        $(el).select();
        document.execCommand("copy");
        done();
      }
    };

    $("copyShot").onclick = (e) => copy("exShot", e.currentTarget);
    $("copyPrompt").onclick = (e) => copy("exPrompt", e.currentTarget);

    const png = (frame, tag) => {
      const url = capturePng(frame);
      if (url) downloadDataUrl(url, "previz_" + tag + "_f" + frame + ".png");
    };
    $("pngFirst").onclick = () => png(0, "first");
    $("pngCurrent").onclick = () => png(state.current, "current");
    $("pngLast").onclick = () => png(state.duration, "last");

    $("jsonSave").onclick = () => {
      const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      downloadDataUrl(url, "previz-scene.json");
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    $("jsonLoad").onclick = () => $("jsonFile").click();
    $("jsonFile").onchange = (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          if (loadScene(JSON.parse(reader.result))) closeModal();
          else alert("シーンデータとして読めませんでした。");
        } catch (e) {
          alert("JSONの読み込みに失敗しました。");
        }
      };
      reader.readAsText(file);
    };
  }

  function openHelp() {
    openModal(
      "使い方",
      "<h3>考え方</h3>" +
        "<p>箱で組んだ人物とカメラでカットの動きだけを先に決めて、その結果を生成動画AIへの指示（構図・カメラワーク・人物の配置）に流し込むためのツールです。</p>" +
        "<h3>キャラクター</h3>" +
        "<ul>" +
        "<li>体と頭はボックス、白い四角錐が頭の向きを示します。</li>" +
        "<li>色は追加した順に <b>赤 → 青 → 緑 → 黄</b> で割り当てられます。</li>" +
        "<li>頭は体とは別に向きを変えられます（右上の「頭の向き」）。</li>" +
        "</ul>" +
        "<h3>操作</h3>" +
        "<ul>" +
        "<li>オブジェクトをクリックで選択、ドラッグで右上のモードに応じて操作。</li>" +
        "<li>何もない所をドラッグで視点回転、ホイール／ピンチでズーム、Shift+ドラッグで平行移動。</li>" +
        "<li>カメラ視点ではドラッグがそのままパン／チルト、ホイールで前後移動になります。</li>" +
        "</ul>" +
        "<h3>キーフレーム</h3>" +
        "<ul>" +
        "<li>タイムラインでフレームを合わせてから動かすと、<b>そのフレームに自動でキーが打たれます</b>（AUTO KEY）。</li>" +
        "<li>キーはドラッグで前後に動かせます。キーが2つ以上あれば間は自動で補間されます。</li>" +
        "</ul>" +
        "<h3>ショートカット</h3>" +
        "<ul>" +
        "<li><kbd>Space</kbd> 再生／停止</li>" +
        "<li><kbd>←</kbd> <kbd>→</kbd> 1フレーム移動（Shiftで10フレーム）</li>" +
        "<li><kbd>Delete</kbd> 現在フレームのキーを削除</li>" +
        "<li><kbd>1</kbd>〜<kbd>4</kbd> 操作モード切り替え</li>" +
        "</ul>"
    );
  }

  // ---------------------------------------------------------------- 初期化・イベント

  function defaultScene() {
    addCamera({ pos: { x: 0, y: 1.5, z: 5.6 }, lens: 35 });
    addCharacter({ pos: { x: -0.85, y: 0, z: 0 }, ry: Math.PI * 0.06 });
    addCharacter({ pos: { x: 0.95, y: 0, z: -0.4 }, ry: -Math.PI * 0.08 });
  }

  // 既存のキャラと重ならない立ち位置を、横一列→奥の列の順で探す
  function freeSpot() {
    const occupied = state.objects
      .filter((o) => o.type === "char")
      .map((o) => ({ x: o.root.position.x, z: o.root.position.z }));
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 4; col++) {
        const x = (col - 1.5) * 1.15;
        const z = -row * 1.4;
        if (!occupied.some((p) => Math.hypot(p.x - x, p.z - z) < 0.8)) return { x: x, y: 0, z: z };
      }
    }
    return { x: (Math.random() - 0.5) * 4, y: 0, z: -8 };
  }

  function bind() {
    const el = renderer.domElement;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    $("addCharBtn").onclick = () => {
      const obj = addCharacter({ pos: freeSpot(), frame: state.current });
      select(obj.id);
      markDirty();
    };

    $("viewSeg").addEventListener("click", (ev) => {
      const btn = ev.target.closest(".seg-btn");
      if (!btn) return;
      state.view = btn.dataset.view;
      $("viewSeg").querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
      $("framing").hidden = state.view !== "camera";
      $("toolStrip").hidden = state.view === "camera";
      $("viewportHint").textContent =
        state.view === "camera"
          ? "ドラッグでパン／チルト、ホイールで前後移動。動かすと自動でキーが入ります。"
          : "クリックで選択 / オブジェクトをドラッグで操作 / 何もない所をドラッグで視点回転";
      if (state.view === "camera") {
        const cam = state.objects.find((o) => o.type === "camera");
        if (cam) select(cam.id);
      }
      updateSelRing();
    });

    $("exportBtn").onclick = openExport;
    $("helpBtn").onclick = openHelp;
    $("modalClose").onclick = closeModal;
    $("modal").addEventListener("click", (ev) => {
      if (ev.target === $("modal")) closeModal();
    });

    $("toolStrip").addEventListener("click", (ev) => {
      const btn = ev.target.closest(".tool-btn");
      if (!btn) return;
      state.mode = btn.dataset.mode;
      $("toolStrip").querySelectorAll(".tool-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
    });

    ["fX", "fY", "fZ", "fRotY", "fRotX"].forEach((id) => {
      $(id).addEventListener("input", fromInspector);
    });

    $("fLens").addEventListener("input", () => {
      const obj = selected();
      if (!obj || obj.type !== "camera") return;
      const mm = +$("fLens").value;
      $("fLensOut").textContent = mm + "mm";
      obj.root.fov = lensToFov(mm);
      obj.root.updateProjectionMatrix();
      updateFrustum(obj.root);
      autoKey(obj);
    });

    $("inspName").addEventListener("input", () => {
      const obj = selected();
      if (!obj) return;
      obj.name = $("inspName").value;
      renderTimeline();
      saveSoon();
    });

    $("keyBtn").onclick = () => {
      const obj = selected();
      if (obj) autoKey(obj);
    };

    $("delKeyBtn").onclick = () => {
      const obj = selected();
      if (!obj) return;
      if (!deleteKeyAt(obj, state.current)) return;
      applyFrame(state.current);
      syncInspectorValues();
    };

    $("delObjBtn").onclick = () => {
      const obj = selected();
      if (!obj || obj.type === "camera") return;
      removeObject(obj);
      select(state.objects.length ? state.objects[0].id : null);
      markDirty();
    };

    $("sDuration").addEventListener("change", () => {
      state.duration = Math.max(2, Math.min(600, +$("sDuration").value || 120));
      $("sDuration").value = state.duration;
      state.objects.forEach((o) => {
        o.keys = o.keys.filter((k) => k.f <= state.duration);
        if (!o.keys.length) o.keys = [readKey(o, 0)];
      });
      setFrame(Math.min(state.current, state.duration));
      markDirty();
    });

    $("sFps").addEventListener("change", () => {
      state.fps = +$("sFps").value;
      setFrame(state.current);
      markDirty();
    });

    $("sEase").addEventListener("change", () => {
      state.ease = $("sEase").value;
      applyFrame(state.current);
      markDirty();
    });

    $("sLoop").addEventListener("change", () => (state.loop = $("sLoop").checked));
    $("sTrails").addEventListener("change", () => {
      state.trails = $("sTrails").checked;
      trailsDirty = true;
    });
    $("sGrid").addEventListener("change", () => (state.grid = $("sGrid").checked));

    // transport
    $("playBtn").onclick = () => setPlaying(!state.playing);
    $("toStartBtn").onclick = () => setFrame(0);
    $("toEndBtn").onclick = () => setFrame(state.duration);
    $("prevKeyBtn").onclick = () => {
      const fs = allKeyFrames().filter((f) => f < state.current);
      if (fs.length) setFrame(fs[fs.length - 1]);
    };
    $("nextKeyBtn").onclick = () => {
      const fs = allKeyFrames().filter((f) => f > state.current);
      if (fs.length) setFrame(fs[0]);
    };
    $("frameInput").addEventListener("change", () => setFrame(+$("frameInput").value || 0));

    // timeline
    [tlRuler, tlTracks].forEach((elm) => {
      elm.addEventListener("pointerdown", tlPointerDown);
      elm.addEventListener("pointermove", tlPointerMove);
      elm.addEventListener("pointerup", tlPointerUp);
      elm.addEventListener("pointercancel", tlPointerUp);
    });

    tlLabels.addEventListener("click", (ev) => {
      const row = ev.target.closest(".tl-label");
      if (row) select(+row.dataset.obj);
    });

    // keyboard
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
        if (obj && deleteKeyAt(obj, state.current)) {
          applyFrame(state.current);
          syncInspectorValues();
        }
      } else if (ev.key === "Escape") {
        closeModal();
      } else if (["1", "2", "3", "4"].indexOf(ev.key) >= 0) {
        const btn = $("toolStrip").querySelectorAll(".tool-btn")[+ev.key - 1];
        if (btn) btn.click();
      }
    });

    window.addEventListener("resize", layout);
    // タイムラインの行数が変わるとビューポートの高さも変わるので、要素側でも監視する
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => layout());
      ro.observe(host);
      ro.observe(tlLanes);
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
      $("sFps").value = state.fps;
      $("sDuration").value = state.duration;
      $("sEase").value = state.ease;
      const cam = state.objects.find((o) => o.type === "camera");
      if (cam) select(cam.id);
    }

    bind();
    layout();
    setFrame(0);
    setPlaying(false);
    renderTimeline();
    tick();
  }

  init();
})();
