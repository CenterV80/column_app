import * as THREE from "three";
import { Octree } from "three/addons/math/Octree.js";
import { BufferGeometryUtils } from "three/addons/utils/BufferGeometryUtils.js";
import * as TX from "./textures.js";

// Merges a batch of small static meshes sharing one material into a single
// draw call. Safe to call only *after* the octree has already baked their
// world-space triangles, since the originals get discarded here.
function mergeBatch(group, meshes, material) {
  if (!meshes.length) return null;
  const geoms = meshes.map((m) => {
    m.updateMatrix();
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrix);
    return g;
  });
  const merged = BufferGeometryUtils.mergeBufferGeometries(geoms, false);
  meshes.forEach((m) => {
    group.remove(m);
    m.geometry.dispose();
  });
  geoms.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function cloneRepeat(tex, rx, ry) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(rx, ry);
  return t;
}

function applyMatSet(mat, set, rx, ry) {
  if (set.map) mat.map = cloneRepeat(set.map, rx, ry);
  if (set.normalMap) mat.normalMap = cloneRepeat(set.normalMap, rx, ry);
  if (set.roughnessMap) mat.roughnessMap = cloneRepeat(set.roughnessMap, rx, ry);
  if (set.metalnessMap) mat.metalnessMap = cloneRepeat(set.metalnessMap, rx, ry);
  return mat;
}

export function buildLevel(scene) {
  const visualGroup = new THREE.Group();
  const colliderGroup = new THREE.Group();
  scene.add(visualGroup);

  // ---------- shared texture sets ----------
  const texConcreteFloor = TX.makeFloorGrating(11);
  const texConcreteWallLight = TX.makeConcrete(3, { tint: "#8a9096" });
  const texConcreteWallDark = TX.makeConcrete(4, { tint: "#565b60" });
  const texMetalContainer1 = TX.makeMetalPanel(21, { tint: "#3f5a4c", panels: 5 });
  const texMetalContainer2 = TX.makeMetalPanel(22, { tint: "#6a4630", panels: 5 });
  const texMetalDark = TX.makeMetalPanel(23, { tint: "#2c3236", panels: 3 });
  const texSandbag = TX.makeSandbag(31);
  const texCaution = TX.makeCautionStripe();
  const texChainlink = TX.makeChainlinkAlpha();

  function stdMat(set, { rx = 1, ry = 1, roughness = 0.85, metalness = 0.05, color = 0xffffff } = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    applyMatSet(m, set, rx, ry);
    return m;
  }

  const matFloor = stdMat(texConcreteFloor, { rx: 14, ry: 14, roughness: 0.95, metalness: 0.08 });
  const matWallLight = stdMat(texConcreteWallLight, { rx: 3, ry: 1.6, roughness: 0.92 });
  const matWallDark = stdMat(texConcreteWallDark, { rx: 3, ry: 1.6, roughness: 0.95 });
  const matContainerGreen = stdMat(texMetalContainer1, { rx: 1, ry: 1, roughness: 0.55, metalness: 0.6 });
  const matContainerRust = stdMat(texMetalContainer2, { rx: 1, ry: 1, roughness: 0.6, metalness: 0.5 });
  const matMetalDark = stdMat(texMetalDark, { rx: 1, ry: 1, roughness: 0.5, metalness: 0.7 });
  const matSandbag = stdMat(texSandbag, { rx: 2, ry: 1, roughness: 1.0 });
  const matBarrier = new THREE.MeshStandardMaterial({ color: 0x8f9296, roughness: 0.85, metalness: 0.05 });

  const collidables = [];

  function addBox(w, h, d, pos, mat, { collide = true, rotY = 0, name = "" } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    visualGroup.add(mesh);
    if (collide) collidables.push(mesh);
    return mesh;
  }

  // ---------- ground ----------
  const groundGeo = new THREE.PlaneGeometry(140, 140);
  const ground = new THREE.Mesh(groundGeo, matFloor);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  visualGroup.add(ground);
  collidables.push(ground);

  // ---------- perimeter walls ----------
  const yardSize = 46;
  const wallH = 4.2, wallT = 1;
  [
    [0, wallH / 2, -yardSize, yardSize * 2, wallH, wallT, 0],
    [0, wallH / 2, yardSize, yardSize * 2, wallH, wallT, 0],
    [-yardSize, wallH / 2, 0, yardSize * 2, wallH, wallT, Math.PI / 2],
    [yardSize, wallH / 2, 0, yardSize * 2, wallH, wallT, Math.PI / 2],
  ].forEach(([x, y, z, w, h, d, rotY], i) => {
    addBox(w, h, d, new THREE.Vector3(x, y, z), i % 2 === 0 ? matWallDark : matWallLight, { rotY });
  });

  // corner watchtower posts + floodlight rig
  const towerPositions = [
    new THREE.Vector3(-yardSize + 3, 0, -yardSize + 3),
    new THREE.Vector3(yardSize - 3, 0, -yardSize + 3),
    new THREE.Vector3(-yardSize + 3, 0, yardSize - 3),
    new THREE.Vector3(yardSize - 3, 0, yardSize - 3),
  ];
  const floodlights = [];
  towerPositions.forEach((p, idx) => {
    const poleH = 8;
    addBox(0.5, poleH, 0.5, new THREE.Vector3(p.x, poleH / 2, p.z), matMetalDark);
    const headGroup = new THREE.Group();
    headGroup.position.set(p.x, poleH, p.z);
    visualGroup.add(headGroup);
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.7), matMetalDark);
    headMesh.rotation.x = -0.5;
    headMesh.castShadow = true;
    headGroup.add(headMesh);

    const spot = new THREE.SpotLight(0xbfe0ff, idx < 2 ? 90 : 55, 60, THREE.MathUtils.degToRad(38), 0.45, 1.4);
    spot.position.set(0, 0, 0);
    const target = new THREE.Object3D();
    target.position.set(-p.x * 0.35, -poleH, -p.z * 0.35);
    headGroup.add(target);
    spot.target = target;
    // Only one floodlight casts shadows — every extra shadow-casting light
    // is a full extra shadow-map render pass over the whole level per frame,
    // and one is plenty to sell the "lit compound at night" look.
    if (idx === 0) {
      spot.castShadow = true;
      spot.shadow.mapSize.set(768, 768);
      spot.shadow.bias = -0.0015;
      spot.shadow.camera.far = 70;
    }
    headGroup.add(spot);

    // visible light cone (fake volumetric)
    const coneGeo = new THREE.ConeGeometry(7, 22, 24, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xbfe0ff, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.copy(target.position).multiplyScalar(0.5);
    cone.lookAt(headGroup.localToWorld(target.position.clone()));
    cone.rotateX(Math.PI / 2);
    headGroup.add(cone);

    floodlights.push({ spot, group: headGroup });
  });

  // ---------- central two-story building ----------
  const bH = 3.4;
  const buildingOrigin = new THREE.Vector3(6, 0, -4);
  // ground floor walls with window/door gaps (built as segmented boxes)
  const gf = new THREE.Group();
  gf.position.copy(buildingOrigin);
  visualGroup.add(gf);

  function wallSeg(w, h, d, x, y, z, mat = matWallLight) {
    const m = addBox(w, h, d, new THREE.Vector3(0, 0, 0), mat);
    m.position.set(x, y, z);
    gf.add(m);
    m.position.set(x, y, z);
    return m;
  }
  // footprint 14 x 10, walls with a door gap on south side and window gaps
  wallSeg(14, bH, 0.6, 0, bH / 2, -5);
  wallSeg(0.6, bH, 10, -7, bH / 2, 0);
  wallSeg(0.6, bH, 10, 7, bH / 2, 0);
  wallSeg(5, bH, 0.6, -4.5, bH / 2, 5);
  wallSeg(5, bH, 0.6, 4.5, bH / 2, 5);
  // second floor
  const floorY = bH;
  wallSeg(14.6, 0.4, 10.6, 0, floorY + 0.2, 0, matWallDark);
  wallSeg(14, bH, 0.6, 0, floorY + bH / 2, -5, matWallDark);
  wallSeg(0.6, bH, 4, -7, floorY + bH / 2, -3, matWallDark);
  wallSeg(0.6, bH, 4, 7, floorY + bH / 2, -3, matWallDark);
  wallSeg(0.6, 1.1, 10, -7, floorY + bH - 0.55, 0, matWallDark);
  wallSeg(0.6, 1.1, 10, 7, floorY + bH - 0.55, 0, matWallDark);
  // roof
  wallSeg(14.6, 0.4, 10.6, 0, floorY + bH + 0.2, 0, matWallDark);
  // balcony railing on south edge of floor 2
  const railGeo = new THREE.BoxGeometry(14, 0.9, 0.08);
  const rail = new THREE.Mesh(railGeo, matMetalDark);
  rail.position.set(0, floorY + 0.65, 5);
  rail.castShadow = true;
  gf.add(rail); collidables.push(rail);

  // stairs (outside, east side) leading to floor 2
  const stairsGroup = new THREE.Group();
  stairsGroup.position.set(7.6, 0, 3);
  gf.add(stairsGroup);
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.28, 0.7), matWallDark);
    step.position.set(0, 0.14 + i * (bH / steps), -i * 0.68);
    step.castShadow = true; step.receiveShadow = true;
    stairsGroup.add(step);
    collidables.push(step);
  }
  visualGroup.add(stairsGroup);

  // interior floor slab for 2nd story walkable
  const interiorFloor = new THREE.Mesh(new THREE.BoxGeometry(13.6, 0.3, 9.6), matWallDark);
  interiorFloor.position.set(0, floorY, 0);
  gf.add(interiorFloor);
  collidables.push(interiorFloor);

  // window glow (interior emissive light strip)
  const winLight = new THREE.PointLight(0xffb066, 6, 10, 2);
  winLight.position.set(buildingOrigin.x, 1.6, buildingOrigin.z);
  visualGroup.add(winLight);

  // ---------- yard cover ----------
  function jerseyBarrier(x, z, rotY = 0) {
    const geo = new THREE.BoxGeometry(2.2, 0.8, 0.6);
    const m = addBox(2.2, 0.8, 0.6, new THREE.Vector3(x, 0.4, z), matBarrier, { rotY });
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.21, 0.16, 0.61), new THREE.MeshStandardMaterial({ map: cloneRepeat(texCaution, 2, 1), roughness: 0.7 }));
    stripe.position.set(0, 0.1, 0);
    m.add(stripe);
    return m;
  }
  [[-16, 8, 0], [-13.5, 8, 0], [10, 20, 0.3], [12.3, 20, 0.3], [-4, -18, 0.6]].forEach(([x, z, rotY]) => jerseyBarrier(x, z, rotY));

  const sandbagMeshes = [];
  function sandbagWall(x, z, rotY = 0, len = 3) {
    for (let i = 0; i < len; i++) {
      const off = (i - (len - 1) / 2) * 0.85;
      const dx = Math.cos(rotY) * off, dz = -Math.sin(rotY) * off;
      sandbagMeshes.push(addBox(0.9, 0.5, 0.55, new THREE.Vector3(x + dx, 0.25, z + dz), matSandbag, { rotY }));
      sandbagMeshes.push(addBox(0.9, 0.5, 0.55, new THREE.Vector3(x + dx, 0.72, z + dz), matSandbag, { rotY }));
    }
  }
  sandbagWall(-20, -14, 0, 4);
  sandbagWall(16, -20, Math.PI / 2, 3);
  sandbagWall(-6, 16, 0.3, 3);

  function container(x, z, rotY, mat) {
    const c = addBox(2.44, 2.6, 12, new THREE.Vector3(x, 1.3, z), mat, { rotY });
    return c;
  }
  container(-24, 2, 0, matContainerGreen);
  container(-24, -10.5, 0, matContainerRust);
  container(20, -8, Math.PI / 2, matContainerGreen);

  const crateMeshes = [];
  function crateCluster(x, z, count = 5) {
    const rng0 = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    for (let i = 0; i < count; i++) {
      const s = 0.55 + (Math.abs(Math.sin(rng0 + i)) * 0.35);
      const px = x + (Math.sin(rng0 * (i + 2)) * 1.6);
      const pz = z + (Math.cos(rng0 * (i + 3)) * 1.6);
      crateMeshes.push(addBox(s, s, s, new THREE.Vector3(px, s / 2, pz), matContainerRust, { rotY: rng0 * i }));
    }
  }
  crateCluster(15, 10, 6);
  crateCluster(-8, -22, 5);

  // fuel barrels
  const barrelMeshes = [];
  function barrel(x, z) {
    const geo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 16);
    const m = new THREE.Mesh(geo, matMetalDark);
    m.position.set(x, 0.55, z);
    m.castShadow = true; m.receiveShadow = true;
    visualGroup.add(m);
    collidables.push(m);
    barrelMeshes.push(m);
  }
  [[18, 14], [18.9, 14.6], [17.4, 15.2], [-18, 18], [-18.9, 18.7]].forEach(([x, z]) => barrel(x, z));

  // chain-link fence accents along a yard divider
  const fenceMat = new THREE.MeshStandardMaterial({
    map: texChainlink, alphaMap: texChainlink, transparent: true, side: THREE.DoubleSide,
    color: 0xaeb6bd, roughness: 0.6, metalness: 0.4,
  });
  const fenceGeo = new THREE.PlaneGeometry(20, 2.4);
  const fence = new THREE.Mesh(fenceGeo, fenceMat);
  fence.position.set(-2, 1.2, -20);
  fence.castShadow = false;
  visualGroup.add(fence);
  collidables.push(fence);

  // ---------- sky ----------
  const skyGeo = new THREE.SphereGeometry(300, 24, 16);
  const skyMat = new THREE.MeshBasicMaterial({ map: TX.makeSkyGradient(), side: THREE.BackSide, fog: false });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  visualGroup.add(sky);

  const starGeo = new THREE.SphereGeometry(295, 24, 16);
  const starMat = new THREE.MeshBasicMaterial({
    map: TX.makeStarfield(), side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
  });
  const stars = new THREE.Mesh(starGeo, starMat);
  visualGroup.add(stars);

  const moonGeo = new THREE.SphereGeometry(6, 24, 24);
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xdfe9ff, fog: false });
  const moon = new THREE.Mesh(moonGeo, moonMat);
  moon.position.set(-90, 110, -140);
  visualGroup.add(moon);

  // soft glow halo so the moon doesn't read as a flat disc pasted on the sky
  const glowTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(225,235,255,0.9)");
    grad.addColorStop(0.25, "rgba(200,220,255,0.35)");
    grad.addColorStop(1, "rgba(200,220,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  moonGlow.position.copy(moon.position);
  moonGlow.scale.setScalar(48);
  visualGroup.add(moonGlow);

  // ---------- lighting ----------
  scene.fog = new THREE.FogExp2(0x0a1220, 0.014);

  const hemi = new THREE.HemisphereLight(0x2b3c55, 0x0a0d10, 0.55);
  scene.add(hemi);

  const moonLight = new THREE.DirectionalLight(0x8fb0ff, 0.6);
  moonLight.position.set(-40, 60, -30);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(1536, 1536);
  moonLight.shadow.camera.left = -55;
  moonLight.shadow.camera.right = 55;
  moonLight.shadow.camera.top = 55;
  moonLight.shadow.camera.bottom = -55;
  moonLight.shadow.camera.far = 200;
  moonLight.shadow.bias = -0.0008;
  moonLight.shadow.normalBias = 0.02;
  scene.add(moonLight);
  scene.add(moonLight.target);

  // rooftop beacon (pulsing red)
  const beacon = new THREE.PointLight(0xff3320, 0, 14, 2);
  beacon.position.set(buildingOrigin.x, bH * 2 + 0.6, buildingOrigin.z);
  visualGroup.add(beacon);

  // ---------- collision octree ----------
  // fromGraphNode(node) traverses `node` itself plus descendants and bakes
  // world-space triangles, so calling it per collidable mesh (without ever
  // reparenting) keeps the render graph untouched while still collecting
  // every collider into one shared octree.
  const worldOctree = new Octree();
  visualGroup.updateMatrixWorld(true);
  collidables.forEach((m) => worldOctree.fromGraphNode(m));

  // Collision data is now baked into the octree as static triangles, so the
  // small per-prop meshes can be collapsed into a handful of draw calls
  // without touching gameplay.
  mergeBatch(visualGroup, sandbagMeshes, matSandbag);
  mergeBatch(visualGroup, crateMeshes, matContainerRust);
  mergeBatch(visualGroup, barrelMeshes, matMetalDark);

  const playerSpawn = new THREE.Vector3(0, 2, 30);
  const enemySpawns = [
    new THREE.Vector3(6, 0.1, -8),
    new THREE.Vector3(-10, 0.1, -6),
    new THREE.Vector3(16, 0.1, 6),
    new THREE.Vector3(-18, 0.1, 4),
    new THREE.Vector3(4, bH + 0.15, -2),
    new THREE.Vector3(-20, 0.1, -12),
    new THREE.Vector3(18, 0.1, -6),
    new THREE.Vector3(0, 0.1, 20),
  ];
  const coverPoints = [
    new THREE.Vector3(-16, 0.1, 8), new THREE.Vector3(10, 0.1, 20),
    new THREE.Vector3(-20, 0.1, -14), new THREE.Vector3(16, 0.1, -20),
    new THREE.Vector3(-6, 0.1, 16), new THREE.Vector3(15, 0.1, 10),
    new THREE.Vector3(-24, 0.1, -3), new THREE.Vector3(20, 0.1, -8),
  ];

  const updatables = [];
  let beaconT = 0;
  updatables.push((dt) => {
    beaconT += dt;
    beacon.intensity = (Math.sin(beaconT * 3) * 0.5 + 0.5) * 6;
  });

  return {
    visualGroup, octree: worldOctree,
    playerSpawn, enemySpawns, coverPoints,
    lights: { hemi, moonLight, floodlights, beacon },
    updatables,
  };
}
