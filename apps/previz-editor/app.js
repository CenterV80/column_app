/*
 * プレビズエディタ
 * 生成動画AIに渡すカットを、箱のキャラクターとカメラで先に組み立てるための簡易プレビズツール。
 * キャラクターは「体＝ボックス」「頭＝ボックス」「白い四角錐＝正面」で構成する。
 * 体の向き＝顔の向きで、頭だけを別に回すことはしない。
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

  // 肩幅を奥行きよりはっきり広くとると、どちらを向いているか一目で分かる
  const BODY_W = 0.64;
  const BODY_H = 1.12;
  const BODY_D = 0.26;
  const NECK_H = 0.08;
  const HEAD_W = 0.38;
  const HEAD_H = 0.34;
  const HEAD_D = 0.3;
  const HEAD_Y = BODY_H + NECK_H + HEAD_H / 2;

  // キャラの種別。当たり判定・注視点の高さ・立ち位置の間隔をここでまとめて持つ。
  const KIND = {
    human: { label: "ひと", suffix: "", radius: 0.5, lookH: 1.2, proxy: [0.82, 1.75, 0.72, 0.88] },
    giant: { label: "巨人", suffix: "巨人", radius: 1.5, lookH: 3.3, proxy: [2.6, 4.7, 1.5, 2.35] },
    dragon: { label: "竜", suffix: "竜", radius: 2.0, lookH: 1.9, proxy: [3.0, 2.8, 5.6, 1.3] },
  };

  const SENSOR_H = 20.25; // フルサイズ36mm幅を16:9で切り出したときの高さ(mm)
  const ASPECT = 16 / 9;
  const CAM_CSS = "#cfd6e4";
  const PROP_CSS = "#96a1b6";

  const STORAGE_KEY = "previz-editor.scene.v1";
  const VIDEO_W = 1280;
  const VIDEO_H = 720;
  const LOOK_H = 1.2; // キャラのどのあたりを見るか（胸から頭の間）

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
    propCount: 0,
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
  renderer.setClearColor(0x1d2430, 1);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // 全体を少し明るくし、フォグは遠くで効かせる（近景がくすまないように）
  const BG = 0x1d2430;
  scene.background = new THREE.Color(BG);
  // three r128 のフォグは sRGB に直したあとで混ぜられるので、
  // ここはリニアに変換せず背景と同じ値をそのまま渡す（変換すると地平線に暗い帯が出る）
  scene.fog = new THREE.Fog(BG, 26, 95);

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

  scene.add(new THREE.HemisphereLight(0xa9c0e0, 0x3b4352, 1.05));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.75);
  keyLight.position.set(5, 9, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -26;
  keyLight.shadow.camera.right = 26;
  keyLight.shadow.camera.top = 26;
  keyLight.shadow.camera.bottom = -26;
  keyLight.shadow.radius = 2;
  scene.add(keyLight);
  const fill = new THREE.DirectionalLight(0xa3b6d8, 0.55);
  fill.position.set(-6, 4, -5);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: col(0x3d4757), roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(60, 60, 0x99a6c0, 0x647089);
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

  // 見ている相手を示す印。カメラ視点で注視中だけ出す。
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.44, 0.5, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      // 相手の体の中に埋まって見えなくなるので、奥行きを見ずに手前へ描く
      depthTest: false,
      depthWrite: false,
    })
  );
  reticle.renderOrder = 999;
  reticle.visible = false;
  scene.add(reticle);

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

  // 正面を示す白い四角錐。頂点が正面(+Z)を向くようにジオメトリ側で寝かせる。
  function frontCone(radius, height, y, z) {
    const g = new THREE.ConeGeometry(radius, height, 4);
    g.rotateY(Math.PI / 4); // 面を上下左右に向ける
    g.rotateX(Math.PI / 2); // 頂点を +Z へ
    g.translate(0, y, z + height / 2);
    const m = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ color: col(0xffffff), roughness: 0.45, metalness: 0 })
    );
    m.castShadow = true;
    return m;
  }

  function slab(w, h, d, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function buildCharacter(colorIndex, kind) {
    if (kind === "giant") return buildGiant(colorIndex);
    if (kind === "dragon") return buildDragon(colorIndex);
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
      new THREE.BoxGeometry(0.16, NECK_H + 0.02, 0.16),
      new THREE.MeshStandardMaterial({ color: col(0x3a3f4a), roughness: 0.8 })
    );
    neck.position.y = BODY_H + NECK_H / 2;
    fx.add(neck);

    // 頭は体と一体。体の向き＝顔の向きなので、別に回すピボットは持たない。
    const head = new THREE.Mesh(new THREE.BoxGeometry(HEAD_W, HEAD_H, HEAD_D), headMat);
    head.position.y = HEAD_Y;
    head.castShadow = true;
    fx.add(head);

    const cone = frontCone(0.17, 0.44, HEAD_Y, HEAD_D / 2);
    fx.add(cone);

    // 指でつかみやすいように、見えない当たり判定を足す（揺れの外側に置いて的が動かないようにする）
    const proxy = hitProxy.apply(null, KIND.human.proxy);
    root.add(proxy);

    root.userData.fx = fx;
    root.userData.solids = [body, neck, head, cone]; // 実際に見えている面
    root.userData.proxy = proxy;
    return root;
  }

  // 巨人。人型と同じ作りのまま、背を高くして腕を足す。
  function buildGiant(colorIndex) {
    const color = COLORS[colorIndex % COLORS.length];
    const root = new THREE.Group();
    const fx = new THREE.Group();
    root.add(fx);

    const mat = new THREE.MeshStandardMaterial({ color: col(color.hex), roughness: 0.72, metalness: 0.04 });
    const headMat = new THREE.MeshStandardMaterial({
      color: col(color.hex).lerp(col(0xffffff), 0.1),
      roughness: 0.7,
      metalness: 0.04,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: col(0x3a3f4a), roughness: 0.8 });

    const legL = slab(0.62, 1.55, 0.6, -0.42, 0.775, 0, mat);
    const legR = slab(0.62, 1.55, 0.6, 0.42, 0.775, 0, mat);
    const body = slab(1.8, 1.75, 0.8, 0, 2.4, 0, mat);
    const armL = slab(0.5, 1.6, 0.52, -1.16, 2.45, 0, mat);
    const armR = slab(0.5, 1.6, 0.52, 1.16, 2.45, 0, mat);
    const neck = slab(0.4, 0.22, 0.4, 0, 3.38, 0, darkMat);
    const head = slab(1.0, 0.86, 0.82, 0, 3.92, 0, headMat);
    const cone = frontCone(0.42, 1.05, 3.92, 0.41);
    fx.add(legL, legR, body, armL, armR, neck, head, cone);

    const proxy = hitProxy.apply(null, KIND.giant.proxy);
    root.add(proxy);
    root.userData.fx = fx;
    root.userData.solids = [legL, legR, body, armL, armR, neck, head, cone];
    root.userData.proxy = proxy;
    return root;
  }

  // 竜。胴・首・尾・翼・脚を箱で組んで、横から見た形で分かるようにする。
  function buildDragon(colorIndex) {
    const color = COLORS[colorIndex % COLORS.length];
    const root = new THREE.Group();
    const fx = new THREE.Group();
    root.add(fx);

    const mat = new THREE.MeshStandardMaterial({ color: col(color.hex), roughness: 0.7, metalness: 0.05 });
    const headMat = new THREE.MeshStandardMaterial({
      color: col(color.hex).lerp(col(0xffffff), 0.12),
      roughness: 0.68,
    });
    const wingMat = new THREE.MeshStandardMaterial({
      color: col(color.hex).lerp(col(0x000000), 0.28),
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: col(0x3a3f4a), roughness: 0.8 });

    const parts = [];
    const add = (m) => {
      parts.push(m);
      fx.add(m);
      return m;
    };

    // 胴（前が太く後ろが細い）
    add(slab(1.15, 1.0, 1.5, 0, 1.45, 0.35, mat));
    add(slab(0.9, 0.8, 1.3, 0, 1.4, -0.95, mat));
    // 尾（後ろへ細くなる）
    add(slab(0.6, 0.55, 1.2, 0, 1.3, -2.1, mat));
    add(slab(0.38, 0.36, 1.2, 0, 1.12, -3.1, mat));
    add(slab(0.2, 0.2, 1.0, 0, 0.95, -4.0, mat));
    // 首（前へ持ち上がる）
    add(slab(0.6, 0.6, 0.9, 0, 1.85, 1.35, mat));
    add(slab(0.48, 0.5, 0.8, 0, 2.25, 2.0, mat));
    // 頭と鼻づら
    const head = add(slab(0.6, 0.55, 0.85, 0, 2.5, 2.7, headMat));
    add(slab(0.38, 0.3, 0.55, 0, 2.4, 3.3, headMat));
    // 角
    add(slab(0.1, 0.42, 0.1, -0.18, 2.85, 2.5, darkMat));
    add(slab(0.1, 0.42, 0.1, 0.18, 2.85, 2.5, darkMat));
    // 翼（左右に大きく張り出す）
    const wingL = add(slab(2.4, 0.09, 1.7, -1.75, 2.15, 0.1, wingMat));
    const wingR = add(slab(2.4, 0.09, 1.7, 1.75, 2.15, 0.1, wingMat));
    wingL.rotation.z = 0.26;
    wingR.rotation.z = -0.26;
    // 脚
    add(slab(0.32, 0.95, 0.34, -0.62, 0.48, 0.75, mat));
    add(slab(0.32, 0.95, 0.34, 0.62, 0.48, 0.75, mat));
    add(slab(0.3, 0.85, 0.32, -0.55, 0.43, -0.85, mat));
    add(slab(0.3, 0.85, 0.32, 0.55, 0.43, -0.85, mat));
    // 正面の印は鼻先に
    const cone = frontCone(0.2, 0.55, 2.42, 3.58);
    add(cone);

    const proxy = hitProxy.apply(null, KIND.dragon.proxy);
    root.add(proxy);
    root.userData.fx = fx;
    root.userData.solids = parts;
    root.userData.proxy = proxy;
    root.userData.headMesh = head;
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

  // 背景のめじるし。全部おなじ大きさにしておくと、見えた大きさがそのまま距離になる。
  function buildProp() {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: col(0x93a0b8), roughness: 0.85, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: col(0x6d7689), roughness: 0.9 });
    const base = slab(1.0, 0.3, 1.0, 0, 0.15, 0, dark);
    const post = slab(0.6, 3.6, 0.6, 0, 2.1, 0, mat);
    const cap = slab(0.84, 0.24, 0.84, 0, 4.02, 0, dark);
    root.add(base, post, cap);
    const proxy = hitProxy(1.1, 4.2, 1.1, 2.1);
    root.add(proxy);
    root.userData.solids = [base, post, cap];
    root.userData.proxy = proxy;
    return root;
  }

  // ---------------------------------------------------------------- オブジェクト管理

  // 名前は色そのもの。同じ色が複数いるときだけ番号を足す。
  function nameForColor(colorIndex, kind) {
    const label = COLORS[colorIndex % COLORS.length].label + KIND[kind].suffix;
    const same = state.objects.filter(
      (o) => o.type === "char" && o.kind === kind && o.colorIndex % COLORS.length === colorIndex % COLORS.length
    );
    return same.length ? label + (same.length + 1) : label;
  }

  function addCharacter(opts) {
    const o = opts || {};
    const kind = KIND[o.kind] ? o.kind : "human";
    const colorIndex = o.colorIndex != null ? o.colorIndex : state.charCount;
    const color = COLORS[colorIndex % COLORS.length];
    const root = buildCharacter(colorIndex, kind);
    root.userData.objId = state.nextId;

    const obj = {
      id: state.nextId++,
      type: "char",
      kind: kind,
      name: o.name || nameForColor(colorIndex, kind),
      colorIndex: colorIndex,
      css: color.css,
      root: root,
      keys: [],
      radius: KIND[kind].radius,
      lookH: KIND[kind].lookH,
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
      lookAt: null, // 見続ける相手（キャラのid）
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

  function addProp(opts) {
    const o = opts || {};
    const root = buildProp();
    root.userData.objId = state.nextId;
    const obj = {
      id: state.nextId++,
      type: "prop",
      name: o.name || "めじるし" + (state.propCount + 1),
      colorIndex: -1,
      css: PROP_CSS,
      root: root,
      keys: [], // 背景の目印なので、時間の記録は持たない
      radius: 0.75,
      lookH: 2,
      fx: { amp: 0, t: 0, spawn: 0 },
    };
    state.propCount++;
    scene.add(root);
    state.objects.push(obj);
    const p = o.pos || freeSpot(1.6);
    root.position.set(p.x, 0, p.z);
    root.rotation.y = o.ry || 0;
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
    const camObj = theCamera();
    if (camObj && camObj.lookAt === obj.id) camObj.lookAt = null;
  }

  const objById = (id) => state.objects.find((o) => o.id === id) || null;
  const selected = () => objById(state.selectedId);
  const theCamera = () => state.objects.find((o) => o.type === "camera") || null;

  function lookPoint(t) {
    return new THREE.Vector3(t.root.position.x, t.root.position.y + (t.lookH || LOOK_H), t.root.position.z);
  }

  // 注視中の「操作のとき」だけ、カメラを相手に向ける。
  // 再生やスクラブでは呼ばない。呼ぶとキーの回転を無視して全時間の見え方が変わり、
  // 注視を入り切りするたびにカット全体が変わってしまうため。
  function aimCamera() {
    const camObj = theCamera();
    if (!camObj || camObj.lookAt == null) return;
    const t = objById(camObj.lookAt);
    if (!t) {
      camObj.lookAt = null;
      return;
    }
    const f = lookPoint(t);
    camObj.root.lookAt(f);
  }

  // 相手を中心にした球面座標。注視中はこの上をすべらせて動かす。
  function orbitStateOf(camObj) {
    const t = objById(camObj.lookAt);
    if (!t) return null;
    const f = lookPoint(t);
    const off = camObj.root.position.clone().sub(f);
    const r = Math.max(0.5, off.length());
    return { f: f, r: r, theta: Math.atan2(off.x, off.z), phi: Math.acos(Math.max(-1, Math.min(1, off.y / r))) };
  }

  // 床にめり込まない範囲に上下の回り込みを収める。
  // 高さ側で切ると相手との距離が変わってしまうので、角度の側で止める。
  function clampPhi(o, phi) {
    const lo = 0.12;
    const hi = Math.max(lo, Math.min(Math.PI - 0.12, Math.acos(Math.max(-1, Math.min(1, (0.15 - o.f.y) / o.r)))));
    return Math.max(lo, Math.min(hi, phi));
  }

  function applyOrbit(camObj, o) {
    const s = Math.sin(o.phi);
    camObj.root.position.set(
      o.f.x + o.r * s * Math.sin(o.theta),
      Math.max(0.05, o.f.y + o.r * Math.cos(o.phi)),
      o.f.z + o.r * s * Math.cos(o.theta)
    );
    aimCamera();
  }

  // 注視の入り切り。同じ相手をもう一度指すと解除。
  function setLookAt(id) {
    const camObj = theCamera();
    if (!camObj) return;
    const next = camObj.lookAt === id ? null : id;
    camObj.lookAt = next;
    // 向けるのも記録するのも「いまの時間」だけ。他のキーには触らない。
    if (next != null) {
      aimCamera();
      autoKey(camObj);
    }
    updateLookUi();
    markDirty();
    showToast(next != null ? objById(next).name + "を見ながら動きます" : "見るのをやめました");
  }

  function updateLookUi() {
    const camObj = theCamera();
    const locked = camObj && camObj.lookAt != null;
    // 注視中は迷う操作がないので、カメラ視点の道具バーは引っ込める
    $("camTools").hidden = state.view !== "camera" || locked;
    const sel = selected();
    const btn = $("selLook");
    btn.hidden = !sel || sel.type !== "char";
    btn.classList.toggle("is-active", !!(locked && sel && camObj.lookAt === sel.id));
  }

  // 既存のキャラと重ならない立ち位置を、横一列→奥の列の順で探す
  function freeSpot(radius) {
    const r = radius || 0.5;
    const taken = state.objects
      .filter((o) => o.type !== "camera")
      .map((o) => ({ x: o.root.position.x, z: o.root.position.z, r: o.radius || 0.5 }));
    const step = Math.max(1.15, r * 2 + 0.5);
    for (let row = 0; row < 8; row++) {
      for (let c = 0; c < 5; c++) {
        const x = (c - 2) * step;
        const z = -row * step;
        if (!taken.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.3)) return { x: x, y: 0, z: z };
      }
    }
    return { x: (Math.random() - 0.5) * 10, y: 0, z: -12 };
  }

  // ---------------------------------------------------------------- キーフレーム

  function normalizeKey(k) {
    return {
      f: Math.round(k.f) || 0,
      p: { x: +k.p.x || 0, y: +k.p.y || 0, z: +k.p.z || 0 },
      r: { x: +k.r.x || 0, y: +k.r.y || 0, z: +k.r.z || 0 },
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
      lens: obj.type === "camera" ? fovToLens(r.fov) : 35,
    };
  }

  // 自動キーフレーム：トランスフォームを触ったら、その場で現在フレームに打つ
  function autoKey(obj) {
    // めじるしは背景の飾りなので、動かしても時間の記録はしない（保存だけする）
    if (obj.type === "prop") {
      markDirty();
      return;
    }
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
      lens: lerp(a.lens, b.lens, t),
    };
  }

  function applyFrame(frame) {
    state.objects.forEach((obj) => {
      const s = sample(obj, frame);
      if (!s) return;
      obj.root.position.set(s.p.x, s.p.y, s.p.z);
      obj.root.rotation.set(s.r.x, s.r.y, s.r.z);
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
    if (!obj || obj.type === "camera" || state.view === "camera") {
      selRing.visible = false;
      return;
    }
    selRing.visible = true;
    selRing.position.set(obj.root.position.x, obj.root.position.y + 0.012, obj.root.position.z);
    const sc = (obj.radius || 0.5) / 0.5;
    selRing.scale.set(sc, sc, sc);
  }

  // ---------------------------------------------------------------- プルプル

  // つかんでいる間はキャラクターが嫌がって震える。離すとバネのように数回ゆれて止まる。
  // dt は描画用に上限を付けてあるので、収まるまでの時間が描画の速さで変わらないよう、
  // 揺れの減衰だけは実時間(wall)で進める。
  function updateFx(dt, wall) {
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
      const step = Math.min(0.25, wall);
      fx.amp += (target - fx.amp) * Math.min(1, step * (target > fx.amp ? 18 : 5));
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
    // 動画の書き出し中は、こちらが1コマずつ描くので通常の描画は止める
    if (exporting) {
      clock.getDelta();
      return;
    }
    const wall = clock.getDelta();
    const dt = Math.min(0.05, wall);

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

    updateFx(dt, wall);
    if (trailsDirty) rebuildTrails();
    // ドラッグ中は毎フレーム自動キーが入るので、タイムラインの作り直しは間引く
    if (tlDirty && (!drag || clock.elapsedTime - lastTlRender > 0.12)) {
      lastTlRender = clock.elapsedTime;
      renderTimeline();
    }

    const camObj = theCamera();
    const useCamView = state.view === "camera" && camObj;
    if (camObj) camObj.root.userData.rig.visible = !useCamView;

    const lookT = camObj && camObj.lookAt != null ? objById(camObj.lookAt) : null;
    reticle.visible = !!(useCamView && lookT);
    if (reticle.visible) {
      const f = lookPoint(lookT);
      reticle.position.copy(f);
      reticle.quaternion.copy(camObj.root.quaternion); // いつもカメラを向く
      const sc = Math.max(0.3, camObj.root.position.distanceTo(f) * 0.09);
      reticle.scale.set(sc, sc, sc);
    }
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
  function ndcInFrame(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ev.clientX - rect.left - viewRect.x;
    const y = ev.clientY - rect.top - viewRect.y;
    return new THREE.Vector2((x / viewRect.w) * 2 - 1, -(y / viewRect.h) * 2 + 1);
  }

  // カメラ視点で画の中のキャラを指す
  function pickInFrame(ev) {
    const camObj = theCamera();
    if (!camObj || !viewRect) return null;
    raycaster.setFromCamera(ndcInFrame(ev), camObj.root);
    const solids = [];
    state.objects.forEach((o) => {
      if (o.type === "char" && o.root.userData.solids) solids.push.apply(solids, o.root.userData.solids);
    });
    const hit = raycaster.intersectObjects(solids, false)[0];
    return hit ? ownerOf(hit.object) : null;
  }

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
          sx: ev.clientX,
          sy: ev.clientY,
          tap: true, // 動かさずに離したら「その人を見る／やめる」
          mode: ev.shiftKey || ev.button === 2 ? "shift" : state.camMode,
          ref: subjectDist(camObj),
          orb: camObj.lookAt != null ? orbitStateOf(camObj) : null,
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
        if (camObj && camObj.lookAt != null) {
          const o = orbitStateOf(camObj);
          if (c.d > 0) o.r = Math.max(0.6, Math.min(60, o.r * (gesture.d / c.d)));
          o.theta -= (c.x - gesture.x) * 0.006;
          o.phi = clampPhi(o, o.phi - (c.y - gesture.y) * 0.006);
          applyOrbit(camObj, o);
          autoKey(camObj);
        } else if (camObj) {
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
      if (drag.tap && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 6) drag.tap = false;
      if (drag.orb) {
        // 注視中は、相手を中心にぐるっと回り込む
        drag.orb.theta -= dx * 0.006;
        drag.orb.phi = clampPhi(drag.orb, drag.orb.phi - dy * 0.006);
        applyOrbit(drag.obj, drag.orb);
      } else if (drag.mode === "shift") {
        shiftCamera(drag.obj, dx, dy, drag.ref);
      } else {
        const cam = drag.obj.root;
        cam.rotation.y -= dx * 0.004;
        cam.rotation.x = Math.max(-1.4, Math.min(1.4, cam.rotation.x - dy * 0.004));
      }
      if (!drag.tap) autoKey(drag.obj);
    } else if (drag.kind === "object") {
      applyObjectDrag(drag, ev, dx, dy);
      if (drag.obj.type === "camera") aimCamera();
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
    } else if (d.mode === "head" && obj.type === "camera") {
      // 上下の傾きはカメラだけの操作
      root.rotation.x = Math.max(-1.4, Math.min(1.4, root.rotation.x - dy * 0.006));
    }
  }

  function onPointerUp(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) gesture = null;

    // 追従の途中で指を離しても、最後は進んだ向きに合わせて記録し直す
    const d = drag;
    drag = null;
    if (d && d.kind === "camlook" && d.tap) {
      const t = pickInFrame(ev);
      setLookAt(t ? t.id : null);
      return;
    }
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
      if (camObj.lookAt != null) {
        const o = orbitStateOf(camObj);
        o.r = Math.max(0.6, Math.min(60, o.r * Math.exp(ev.deltaY * 0.001)));
        applyOrbit(camObj, o);
      } else {
        dollyCamera(camObj, -ev.deltaY * 0.004);
      }
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
      // 上下の傾きはカメラにしかないので、キャラを選んでいる間は出さない
      $("tools").querySelector('[data-mode="head"]').hidden = !isCam;
      if (!isCam && state.mode === "head") setMode("yaw");
    }
    tlDirty = true;
    updateLookUi();
    updateSelRing();
  }

  function setMode(mode) {
    state.mode = mode;
    $("tools").querySelectorAll(".ib").forEach((b) => b.classList.toggle("is-active", b.dataset.mode === mode));
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

  // undo を渡すと「もどす」付きで、少し長めに出る
  function showToast(text, undo) {
    const el = $("toast");
    const btn = $("toastAction");
    $("toastText").textContent = text;
    el.classList.toggle("has-action", !!undo);
    btn.hidden = !undo;
    if (undo) {
      btn.textContent = "もどす";
      btn.onclick = () => {
        hideToast();
        undo();
      };
    }
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("is-on"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 5000 : 1100);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    const el = $("toast");
    el.classList.remove("is-on");
    setTimeout(() => {
      el.hidden = true;
      el.classList.remove("has-action");
      $("toastAction").hidden = true;
    }, 220);
  }

  // キーを消す。消したものは「もどす」で戻せるようにしておく。
  function dropKey(obj, frame) {
    if (obj.keys.length <= 1) {
      showToast("最後のひとつは消せません");
      return false;
    }
    const gone = obj.keys.find((k) => k.f === frame);
    if (!gone || !deleteKeyAt(obj, frame)) return false;
    applyFrame(state.current);
    showToast("キーをけしました", () => {
      obj.keys.push(gone);
      obj.keys.sort((a, b) => a.f - b.f);
      markDirty();
      setFrame(gone.f);
      select(obj.id);
    });
    return true;
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
      if (obj.type === "prop") return; // 背景のめじるしは時間に関係しない
      const sel = obj.id === state.selectedId ? " is-selected" : "";
      const dropRow = tlDrag && tlDrag.kind === "key" && tlDrag.discard && tlDrag.obj.id === obj.id ? " is-dropping" : "";
      dots +=
        '<div class="tl-dot' + sel + '" data-obj="' + obj.id + '" title="' + escapeHtml(obj.name) +
        '"><span style="background:' + obj.css + '"></span></div>';
      let keys = "";
      obj.keys.forEach((k) => {
        const dropping =
          tlDrag && tlDrag.kind === "key" && tlDrag.discard && tlDrag.obj.id === obj.id && tlDrag.frame === k.f;
        keys +=
          '<div class="key' + (k.f === state.current ? " is-current" : "") + (dropping ? " is-discard" : "") +
          '" data-obj="' + obj.id +
          '" data-frame="' + k.f + '" style="left:' + frameToX(k.f) + "px;background:" + obj.css + '"></div>';
      });
      tracks += '<div class="tl-track' + sel + dropRow + '" data-obj="' + obj.id + '">' + keys + "</div>";
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
  let hintedDrop = false; // はらって消せることは、最初の1回だけ教える

  function tlPointerDown(ev) {
    const keyEl = ev.target.closest ? ev.target.closest(".key") : null;
    const laneRect = tlLanes.getBoundingClientRect();
    setPlaying(false);

    if (keyEl) {
      const obj = objById(+keyEl.dataset.obj);
      const frame = +keyEl.dataset.frame;
      select(obj.id);
      setFrame(frame);
      tlDrag = { kind: "key", obj: obj, frame: frame, sy: ev.clientY, discard: false };
      if (!hintedDrop) {
        hintedDrop = true;
        showToast("上か下にはらうと消せます");
      }
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
    } else if (tlDrag.kind === "key") {
      // レーンから大きく外したら「離せば消える」状態に入る。
      // 横にずらす操作と混ざらないよう、しきい値はレーンの高さより大きくとる。
      const want = Math.abs(ev.clientY - tlDrag.sy) > 34;
      if (want !== tlDrag.discard) {
        tlDrag.discard = want;
        tlDirty = true;
      }
      if (!tlDrag.discard && f !== tlDrag.frame) {
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
  }

  function tlPointerUp() {
    const d = tlDrag;
    tlDrag = null;
    if (d && d.kind === "key" && d.discard) {
      tlDirty = true;
      dropKey(d.obj, d.frame);
    }
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
    const lines = [];
    lines.push(
      "【ショット設計】" + state.fps + "fps / " + state.duration + "F (" +
        secs(state.duration).toFixed(2) + "秒) / 補間: " + (state.ease === "smooth" ? "ふんわり" : "まっすぐ")
    );

    state.objects.forEach((obj) => {
      if (obj.type === "prop") return;
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
      lookAt: (function () {
        const c = theCamera();
        if (!c || c.lookAt == null) return null;
        const i = state.objects.findIndex((o) => o.id === c.lookAt);
        return i < 0 ? null : i;
      })(),
      objects: state.objects.map((o) =>
        o.type === "prop"
          ? {
              type: "prop",
              name: o.name,
              pos: { x: o.root.position.x, y: o.root.position.y, z: o.root.position.z },
              ry: o.root.rotation.y,
            }
          : { type: o.type, kind: o.kind, name: o.name, colorIndex: o.colorIndex, keys: o.keys }
      ),
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

    state.propCount = 0;
    data.objects.forEach((o) => {
      if (o.type === "camera") addCamera({ keys: o.keys });
      else if (o.type === "prop") addProp({ name: o.name, pos: o.pos, ry: o.ry });
      else addCharacter({ name: o.name, kind: o.kind, colorIndex: o.colorIndex, keys: o.keys });
    });
    if (!theCamera()) addCamera({});
    if (typeof data.lookAt === "number" && state.objects[data.lookAt]) {
      const c = theCamera();
      if (c) c.lookAt = state.objects[data.lookAt].id;
    }

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

  // 近いほど白、遠いほど黒。距離そのままではなく逆数（視差）で割り当てる。
  // こうすると手前の 側の差が潰れず、デプス条件付けで使う絵に近い濃淡になる。
  const depthMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uNear: { value: 1 }, uFar: { value: 40 } },
    vertexShader: [
      "varying float vDist;",
      "void main() {",
      "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
      "  vDist = -mv.z;",
      "  gl_Position = projectionMatrix * mv;",
      "}",
    ].join("\n"),
    fragmentShader: [
      "uniform float uNear;",
      "uniform float uFar;",
      "varying float vDist;",
      "void main() {",
      "  float invN = 1.0 / max(uNear, 0.001);",
      "  float invF = 1.0 / max(uFar, 0.002);",
      "  float v = (1.0 / max(vDist, 0.001) - invF) / max(0.0001, invN - invF);",
      "  gl_FragColor = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);",
      "}",
    ].join("\n"),
  });

  // カット全体で同じ濃淡になるよう、映るものまでの距離を先に測っておく
  function depthRange(camObj) {
    let lo = Infinity;
    let hi = 0;
    const targets = state.objects.filter((o) => o.type !== "camera");
    const cp = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let f = 0; f <= state.duration; f++) {
      const cs = sample(camObj, f);
      cp.set(cs.p.x, cs.p.y, cs.p.z);
      targets.forEach((o) => {
        const t = o.keys.length ? sample(o, f) : null;
        p.set(
          t ? t.p.x : o.root.position.x,
          (t ? t.p.y : o.root.position.y) + (o.lookH || 1) * 0.5,
          t ? t.p.z : o.root.position.z
        );
        const d = cp.distanceTo(p);
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      });
    }
    if (!isFinite(lo)) {
      lo = 2;
      hi = 30;
    }
    return { near: Math.max(0.4, lo - 2), far: Math.max(lo + 4, hi + 6) };
  }

  // ---------------------------------------------------------------- 動画の書き出し

  let exporting = false;
  const loadedScripts = {};

  // ムーサは重いので、使うときだけ読み込む
  function loadScriptOnce(src) {
    if (loadedScripts[src]) return Promise.resolve();
    return new Promise((res, rej) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => {
        loadedScripts[src] = true;
        res();
      };
      el.onerror = () => rej(new Error("読み込めませんでした: " + src));
      document.head.appendChild(el);
    });
  }

  // このブラウザで使える形式を上から順に試す。H.264が使えればMP4になる。
  async function pickVideoFormat() {
    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
    const tries = [
      { codec: "avc1.640028", box: "avc", ext: "mp4", label: "MP4" },
      { codec: "avc1.4d0028", box: "avc", ext: "mp4", label: "MP4" },
      { codec: "avc1.42001f", box: "avc", ext: "mp4", label: "MP4" },
      { codec: "vp09.00.10.08", box: "V_VP9", ext: "webm", label: "WebM" },
    ];
    for (const t of tries) {
      try {
        const s = await VideoEncoder.isConfigSupported({
          codec: t.codec,
          width: VIDEO_W,
          height: VIDEO_H,
          bitrate: 8e6,
          framerate: state.fps,
        });
        if (s && s.supported) return t;
      } catch (e) {
        /* この形式は使えないだけなので次を試す */
      }
    }
    return null;
  }

  async function exportVideo(onProgress, opts) {
    const depth = !!(opts && opts.depth);
    const camObj = theCamera();
    if (!camObj) throw new Error("カメラがありません");
    const fmt = await pickVideoFormat();
    if (!fmt) throw new Error("このブラウザは動画の書き出しに対応していません");

    await loadScriptOnce(fmt.ext === "mp4" ? "vendor/mp4-muxer.js" : "vendor/webm-muxer.js");
    const lib = fmt.ext === "mp4" ? window.Mp4Muxer : window.WebMMuxer;
    const target = new lib.ArrayBufferTarget();
    const muxer = new lib.Muxer(
      fmt.ext === "mp4"
        ? {
            target: target,
            video: { codec: fmt.box, width: VIDEO_W, height: VIDEO_H, frameRate: state.fps },
            fastStart: "in-memory",
          }
        : {
            target: target,
            video: { codec: fmt.box, width: VIDEO_W, height: VIDEO_H, frameRate: state.fps },
          }
    );

    let failure = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => (failure = e),
    });
    encoder.configure({
      codec: fmt.codec,
      width: VIDEO_W,
      height: VIDEO_H,
      bitrate: 8e6,
      framerate: state.fps,
    });

    const keepFrame = state.current;
    const w = host.clientWidth;
    const h = host.clientHeight;
    const rigWas = camObj.root.userData.rig.visible;
    const bgWas = scene.background;
    exporting = true;
    setPlaying(false);
    renderer.setScissorTest(false);
    renderer.setSize(VIDEO_W, VIDEO_H, false);

    if (depth) {
      const rng = depthRange(camObj);
      depthMat.uniforms.uNear.value = rng.near;
      depthMat.uniforms.uFar.value = rng.far;
      scene.overrideMaterial = depthMat;
      scene.background = new THREE.Color(0x000000); // 何もない所は一番遠い扱い
    }

    try {
      for (let f = 0; f <= state.duration; f++) {
        if (failure) throw failure;
        applyFrame(f);
        // 補助の表示は映さない
        camObj.root.userData.rig.visible = false;
        trailGroup.visible = false;
        selRing.visible = false;
        reticle.visible = false;
        grid.visible = !depth; // マス目は距離の絵に混ざるので出さない
        renderer.setViewport(0, 0, VIDEO_W, VIDEO_H);
        renderer.render(scene, camObj.root);

        const frame = new VideoFrame(renderer.domElement, {
          timestamp: Math.round((f * 1e6) / state.fps),
          duration: Math.round(1e6 / state.fps),
        });
        encoder.encode(frame, { keyFrame: f % state.fps === 0 });
        frame.close();

        if (onProgress) onProgress(f + 1, state.duration + 1);
        // 画面が固まらないよう、ときどき処理を譲る
        if (encoder.encodeQueueSize > 8 || f % 4 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      await encoder.flush();
      if (failure) throw failure;
      muxer.finalize();
    } finally {
      try {
        if (encoder.state !== "closed") encoder.close();
      } catch (e) {
        /* すでに閉じていれば何もしなくてよい */
      }
      exporting = false;
      scene.overrideMaterial = null;
      scene.background = bgWas;
      grid.visible = state.grid;
      renderer.setSize(w, h, false);
      camObj.root.userData.rig.visible = rigWas;
      applyFrame(keepFrame);
      layout();
    }

    return {
      blob: new Blob([target.buffer], { type: fmt.ext === "mp4" ? "video/mp4" : "video/webm" }),
      ext: fmt.ext,
      label: fmt.label,
    };
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
        "<h3>動画</h3>" +
        '<button class="row-btn" id="bVideo">' + icon("i-cam") +
        "<span>動画を書き出す<small id=\"bVideoSub\">形式をしらべています…</small></span></button>" +
        '<button class="row-btn" id="bDepth">' + icon("i-cube") +
        "<span>デプスの動画を書き出す<small>近いほど白い、奥行きだけの映像</small></span></button>" +
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

    // 使える形式が分かったら、ボタンの説明に出す
    const vBtn = $("bVideo");
    const vSub = $("bVideoSub");
    pickVideoFormat().then((fmt) => {
      if (!$("bVideoSub")) return;
      if (!fmt) {
        vSub.textContent = "このブラウザでは書き出せません";
        vBtn.disabled = true;
        $("bDepth").disabled = true;
        return;
      }
      vSub.textContent =
        fmt.label + " / " + VIDEO_W + "×" + VIDEO_H + " / " + state.fps + "fps / " +
        secs(state.duration).toFixed(1) + "秒" + (fmt.ext === "mp4" ? "" : "（MP4非対応のブラウザです）");
    });

    // 通常の絵とデプス、どちらも同じ流れで書き出す
    const runExport = (btn, subEl, depth, filename) => async () => {
      if (btn.disabled) return;
      const others = [vBtn, $("bDepth")].filter(Boolean);
      others.forEach((b) => (b.disabled = true));
      const keep = subEl.textContent;
      const alive = () => document.body.contains(subEl);
      try {
        const out = await exportVideo(
          (done, total) => {
            if (alive()) subEl.textContent = "書き出し中… " + done + " / " + total + " コマ";
          },
          { depth: depth }
        );
        saveFile(URL.createObjectURL(out.blob), filename + "." + out.ext, true);
        if (alive()) subEl.textContent = "書き出しました（" + Math.round(out.blob.size / 1024) + " KB）";
      } catch (err) {
        if (alive()) subEl.textContent = "書き出せませんでした: " + (err && err.message ? err.message : err);
        showToast("動画を書き出せませんでした");
      } finally {
        others.forEach((b) => (b.disabled = false));
        setTimeout(() => {
          if (alive() && subEl.textContent.indexOf("書き出し中") < 0) subEl.textContent = keep;
        }, 4000);
      }
    };

    vBtn.onclick = runExport(vBtn, vSub, false, "previz");
    const dBtn = $("bDepth");
    dBtn.onclick = runExport(dBtn, dBtn.querySelector("small"), true, "previz_depth");

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
        li("i-head", "白い四角錐が正面", "肩幅を広くとってあるので、どちらを向いているか横からでも分かります。体の向き＝顔の向きです。") +
        li("i-turn", "向きだけ変えたいとき", "道具の「体のむき」で、位置はそのままに向きだけ直せます。動かしても向きを変えたくないときは、設定の「進む向きを向く」を切ってください。") +
        li("i-add", "色は 赤→青→緑→黄 の順", "追加した順に色が決まり、5人目からまた赤に戻ります。") +
        li("i-play", "時間をあわせてから動かす", "下のバーで時間を選んでから動かすと、その時間に自動で記録されます。記録した点は左右にドラッグでずらせます。") +
        li("i-trash", "記録した点を消す", "点をつまんで上か下にはらうと消えます。薄くなったところで指を離すと確定。消した直後に出る「もどす」で戻せます。") +
        li("i-look", "見たい人を画面でタップ", "カメラ視点でキャラをタップすると、その人を中心にドラッグで回り込めます。記録されるのはいまの時間のカメラだけで、他の時間の動きは変わりません。もう一度タップするか、何もない所をタップで解除。") +
        li("i-cam", "カメラからのぞく", "誰も見ていないときは、右の道具で「ふる」と「上下左右にずらす」を切り替えられます。前後はホイールか2本指でひろげる操作です。") +
        li("i-share", "動画で書き出す", "書き出しの画面から、カメラの画をそのまま動画（MP4）にできます。1コマずつ描いて作るので、再生が重い端末でもコマ落ちしません。") +
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

  const closePop = () => {
    $("pop").hidden = true;
    $("addPop").hidden = true;
  };

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
    // 奥行きの手がかり。同じ大きさのものを等間隔に置くと距離がつかみやすい。
    [
      [-8, -3], [8, -3],
      [-9.5, -13], [9.5, -13],
      [-11, -24], [11, -24],
      [-12.5, -36], [12.5, -36],
    ].forEach((p) => addProp({ pos: { x: p[0], z: p[1] } }));
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
      $("pop").hidden = true;
      $("addPop").hidden = !$("addPop").hidden;
    };

    $("addPop").addEventListener("click", (ev) => {
      const btn = ev.target.closest(".add-row");
      if (!btn) return;
      $("addPop").hidden = true;
      const what = btn.dataset.add;
      const obj =
        what === "prop"
          ? addProp({})
          : addCharacter({ kind: what, pos: freeSpot(KIND[what].radius), frame: state.current, pop: true });
      select(obj.id);
      markDirty();
      showToast(obj.name + "をふやしました");
    });

    $("viewBtn").onclick = () => {
      state.view = state.view === "camera" ? "editor" : "camera";
      const cam = state.view === "camera";
      useIcon($("viewIcon"), cam ? "#i-cube" : "#i-cam");
      setTip($("viewBtn"), cam ? "ぜんたいを見る" : "カメラからのぞく");
      $("framing").hidden = !cam;
      $("tools").hidden = cam;
      updateLookUi();
      if (cam) {
        const c = theCamera();
        if (c) select(c.id);
        showToast("カメラ視点");
      }
      updateSelRing();
    };

    $("tuneBtn").onclick = () => {
      $("addPop").hidden = true;
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
      if (!btn || btn.hidden) return;
      setMode(btn.dataset.mode);
      if (!canHover) showToast(btn.getAttribute("data-tip"));
    });

    $("camTools").addEventListener("click", (ev) => {
      const btn = ev.target.closest(".ib");
      if (!btn) return;
      state.camMode = btn.dataset.cam;
      $("camTools").querySelectorAll(".ib").forEach((b) => b.classList.toggle("is-active", b === btn));
      if (!canHover) showToast(btn.getAttribute("data-tip"));
    });

    $("selLook").onclick = () => {
      const obj = selected();
      if (obj && obj.type === "char") setLookAt(obj.id);
    };

    $("selDelete").onclick = () => {
      const obj = selected();
      if (!obj || obj.type === "camera") return;
      if (obj.type === "prop") {
        const at0 = state.objects.indexOf(obj);
        const snap0 = {
          name: obj.name,
          pos: { x: obj.root.position.x, y: obj.root.position.y, z: obj.root.position.z },
          ry: obj.root.rotation.y,
        };
        removeObject(obj);
        select(state.objects.length ? state.objects[0].id : null);
        markDirty();
        showToast(snap0.name + "をけしました", () => {
          const o = addProp(snap0);
          state.propCount--;
          state.objects.splice(state.objects.indexOf(o), 1);
          state.objects.splice(at0, 0, o);
          select(o.id);
          markDirty();
        });
        return;
      }
      // 戻せるように、消す前の姿を控えておく
      const at = state.objects.indexOf(obj);
      const snap = { name: obj.name, kind: obj.kind, colorIndex: obj.colorIndex, keys: JSON.parse(JSON.stringify(obj.keys)) };
      const camObj = theCamera();
      const wasLook = !!(camObj && camObj.lookAt === obj.id);
      removeObject(obj);
      select(state.objects.length ? state.objects[0].id : null);
      markDirty();
      showToast(snap.name + "をけしました", () => {
        const o = addCharacter(snap);
        state.charCount--; // 元からいた分なので色の順番は進めない
        state.objects.splice(state.objects.indexOf(o), 1);
        state.objects.splice(at, 0, o);
        const c = theCamera();
        if (wasLook && c) c.lookAt = o.id;
        applyFrame(state.current);
        select(o.id);
        markDirty();
      });
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
        if (obj) dropKey(obj, state.current);
      } else if (ev.key === "Escape") {
        closeSheet();
        closePop();
      } else if (["1", "2", "3", "4"].indexOf(ev.key) >= 0) {
        const bar = state.view === "camera" ? $("camTools") : $("tools");
        const btn = [...bar.querySelectorAll(".ib")].filter((b) => !b.hidden)[+ev.key - 1];
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
