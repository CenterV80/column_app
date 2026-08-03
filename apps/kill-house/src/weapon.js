import * as THREE from "three";
import { makeMetalPanel } from "./textures.js";

const MUZZLE_LOCAL = new THREE.Vector3(0, 0.045, -0.95);
const NEG_DIR = new THREE.Vector3();
const HIT_SPARK_COLOR = new THREE.Color(0x7ee8ff);
const WORLD_SPARK_COLOR = new THREE.Color(0xd8d0b8);

function polymerMat(color = 0x1b1e22) {
  // Unlit on purpose: these parts sit centimeters from the camera in ADS,
  // and a lit dark polymer there is at the mercy of exactly which way each
  // face happens to catch the scene's key lights — easy to end up reading
  // as a flat black silhouette. A hand-picked flat tone stays readable
  // regardless of camera angle, while the metal parts (barrel, rail, sight)
  // keep real PBR shading for contrast.
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6) });
}
function metalMat() {
  // See polymerMat() — unlit for the same close-range-readability reason,
  // just keeping its brushed-metal texture map for surface detail instead
  // of a flat tone.
  const set = makeMetalPanel(51, { tint: "#565c62", panels: 2, size: 128 });
  const m = new THREE.MeshBasicMaterial({ map: set.map });
  m.map.repeat.set(1, 3);
  return m;
}

function buildRifle() {
  const rig = new THREE.Group();
  const poly = polymerMat(0x1b1e22);
  const poly2 = polymerMat(0x24272b);
  const metal = metalMat();
  const grip = polymerMat(0x141517);

  const body = new THREE.Group();
  rig.add(body);

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, 0.46), poly);
  receiver.position.set(0, 0, -0.05);
  body.add(receiver);

  const upperRail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.4), metal);
  upperRail.position.set(0, 0.075, -0.08);
  body.add(upperRail);

  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.075, 0.34), poly2);
  handguard.position.set(0, -0.005, -0.42);
  body.add(handguard);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.42, 12), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.01, -0.72);
  body.add(barrel);

  const flashHider = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.014, 0.09, 10), metal);
  flashHider.rotation.x = Math.PI / 2;
  flashHider.position.set(0, 0.01, -0.94);
  body.add(flashHider);

  const stockArm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.22), metal);
  stockArm.position.set(0, 0.01, 0.22);
  stockArm.userData.hideOnADS = true;
  body.add(stockArm);
  const stockPad = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.13, 0.045), poly);
  stockPad.position.set(0, 0.005, 0.34);
  stockPad.userData.hideOnADS = true;
  body.add(stockPad);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.24, 0.075), poly2);
  mag.position.set(0, -0.17, -0.02);
  mag.rotation.x = 0.16;
  body.add(mag);

  const pistolGrip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.16, 0.06), grip);
  pistolGrip.position.set(0, -0.11, 0.1);
  pistolGrip.rotation.x = -0.28;
  body.add(pistolGrip);

  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), metal);
  trigger.position.set(0, -0.045, 0.04);
  body.add(trigger);

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.03), grip);
  foregrip.position.set(0, -0.08, -0.5);
  body.add(foregrip);

  // red dot sight
  const sightBase = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.075, 0.09), metal);
  sightBase.position.set(0, 0.098, -0.1);
  body.add(sightBase);
  const sightRiser = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.03, 0.05), metal);
  sightRiser.position.set(0, 0.128, -0.1);
  body.add(sightRiser);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.3, metalness: 0.8 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 8, 16), ringMat);
  ring.position.set(0, 0.14, -0.1);
  body.add(ring);
  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(0.024, 16),
    new THREE.MeshBasicMaterial({ color: 0x1a3a2e, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  glass.position.set(0, 0.14, -0.098);
  body.add(glass);
  const reticle = new THREE.Mesh(
    new THREE.CircleGeometry(0.0028, 10),
    new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false })
  );
  reticle.position.set(0, 0.14, -0.094);
  body.add(reticle);
  const sightPostFront = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.02, 0.014), metal);
  sightPostFront.position.set(0, 0.115, -0.28);
  body.add(sightPostFront);

  // muzzle flash sprite + light
  const flashTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.3, "rgba(255,200,110,0.95)");
    grad.addColorStop(1, "rgba(255,140,40,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flashSprite.scale.set(0.22, 0.22, 0.22);
  flashSprite.position.copy(MUZZLE_LOCAL);
  body.add(flashSprite);
  const muzzleLight = new THREE.PointLight(0xffaa55, 0, 4, 2);
  muzzleLight.position.copy(MUZZLE_LOCAL);
  muzzleLight.visible = false;
  body.add(muzzleLight);

  rig.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  return { rig, body, flashSprite, muzzleLight, reticle };
}

class ShellPool {
  constructor(scene, count = 14) {
    this.scene = scene;
    this.pool = [];
    const geo = new THREE.BoxGeometry(0.012, 0.03, 0.012);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc99a3d, roughness: 0.35, metalness: 0.85 });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, vel: new THREE.Vector3(), angVel: new THREE.Vector3(), life: 0, active: false });
    }
    this.cursor = 0;
  }
  eject(worldPos, worldQuat, sideDir, upDir) {
    const s = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    s.active = true; s.life = 0;
    s.mesh.visible = true;
    s.mesh.position.copy(worldPos);
    s.mesh.quaternion.copy(worldQuat);
    s.vel.copy(sideDir).multiplyScalar(1.2 + Math.random() * 0.8).addScaledVector(upDir, 1.4 + Math.random());
    s.angVel.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
  }
  update(dt) {
    for (const s of this.pool) {
      if (!s.active) continue;
      s.life += dt;
      s.vel.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotateX(s.angVel.x * dt);
      s.mesh.rotateY(s.angVel.y * dt);
      s.mesh.rotateZ(s.angVel.z * dt);
      if (s.life > 1.4 || s.mesh.position.y < -30) { s.active = false; s.mesh.visible = false; }
    }
  }
}

export class Weapon {
  constructor(camera, scene, { particles, tracers, audio, octree, getEnemies }) {
    this.camera = camera;
    this.scene = scene;
    this.particles = particles;
    this.tracers = tracers;
    this.audio = audio;
    this.octree = octree;
    this.getEnemies = getEnemies;

    const built = buildRifle();
    this.rig = built.rig;
    this.body = built.body;
    this.flashSprite = built.flashSprite;
    this.muzzleLight = built.muzzleLight;
    this.reticle = built.reticle;
    this._adsHiddenParts = [];
    this.body.traverse((o) => { if (o.userData.hideOnADS) this._adsHiddenParts.push(o); });

    // Dedicated viewmodel fill light, attached to the camera itself (not the
    // moving rig) at a fixed point just in front of the eye — closer to the
    // camera than any part of the gun in either hip-fire or ADS. The scene's
    // key lights (moon/floodlights) come from above and behind, so without
    // this the gun renders as a near-black silhouette up close; a light
    // fixed in front of it, facing back toward the camera-facing surfaces,
    // is the standard way FPS viewmodels fake their own lighting rig.
    this.viewFill = new THREE.PointLight(0xc7d6f0, 1.8, 1.8, 1.4);
    this.viewFill.position.set(0.05, 0.08, 0.05);
    camera.add(this.viewFill);

    this.basePos = new THREE.Vector3(0.24, -0.2, -0.42);
    // Puts the red-dot far enough from the eye to read as a real 1x reflex
    // sight rather than a magnified scope. Pushing this further back would
    // shrink the dot more but starts dragging the stock (fixed ~0.44 behind
    // the sight on the model) into the near plane, so the rear-of-gun parts
    // are hidden during ADS instead (see _setAdsPartsVisible) the way most
    // FPS viewmodels do — the stock is against your shoulder, out of frame.
    this.adsPos = new THREE.Vector3(0, -0.079, -0.34);
    this.rig.position.copy(this.basePos);
    camera.add(this.rig);

    this.shells = new ShellPool(scene);

    // Reused every shot instead of allocated fresh — this weapon can fire at
    // 720rpm, and _fireRay()/_ejectShell() run on every one of those shots.
    this._ray = {
      dir: new THREE.Vector3(), origin: new THREE.Vector3(),
      right: new THREE.Vector3(), up: new THREE.Vector3(),
      muzzleWorld: new THREE.Vector3(), finalPoint: new THREE.Vector3(),
      raycaster: new THREE.Raycaster(), hitMeshes: [], meshToEnemy: new Map(),
    };
    this._shellScratch = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), right: new THREE.Vector3(), up: new THREE.Vector3() };

    this.magSize = 30;
    this.ammoInMag = 30;
    this.reserve = 150;
    this.fireInterval = 60 / 720;
    this.fireTimer = 0;
    this.autoFire = false;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 1.85;
    this.isADS = false;
    this.adsLerp = 0;
    this.heat = 0;
    this.baseSpread = 0.014;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilPitchVel = 0;
    this.recoilYawVel = 0;
    this.viewKick = 0;
    this.sway = new THREE.Vector2();
    this.swayTarget = new THREE.Vector2();
    this.bobT = 0;
    this.mouseDX = 0; this.mouseDY = 0;

    this.onFire = null;
    this.onReloadStart = null;
    this.onReloadEnd = null;
    this.onAmmoChange = null;
    this.onHit = null;
    this.onKill = null;
    this.onDryFire = null;

    this._onMouseMove = (e) => {
      if (!document.pointerLockElement) return;
      this.mouseDX += (e.movementX || 0);
      this.mouseDY += (e.movementY || 0);
    };
    window.addEventListener("mousemove", this._onMouseMove);

    this._notifyAmmo();
  }

  dispose() {
    window.removeEventListener("mousemove", this._onMouseMove);
  }

  _notifyAmmo() {
    if (this.onAmmoChange) this.onAmmoChange(this.ammoInMag, this.reserve);
  }

  startFire() { this.autoFire = true; }
  stopFire() { this.autoFire = false; }

  requestReload() {
    if (this.isReloading || this.ammoInMag >= this.magSize || this.reserve <= 0) return;
    this.isReloading = true;
    this.reloadTimer = 0;
    if (this.onReloadStart) this.onReloadStart();
    this.audio.playReload(0);
  }

  setADS(active) {
    this.isADS = active;
    for (const o of this._adsHiddenParts) o.visible = !active;
  }

  _spreadAngle() {
    let s = this.baseSpread + this.heat * 0.05;
    if (this.isADS) s *= 0.28;
    return s;
  }

  _tryShoot() {
    if (this.isReloading) return;
    if (this.ammoInMag <= 0) {
      if (this.onDryFire) this.onDryFire();
      this.audio.playEmptyClick();
      return;
    }
    this.ammoInMag--;
    this._notifyAmmo();
    this._fireRay();
    this._recoilKick();
    this._muzzleFlash();
    this._ejectShell();
    this.audio.playGunshot(null);
    this.heat = Math.min(1, this.heat + 0.12);
    if (this.onFire) this.onFire();
    if (this.ammoInMag <= 0 && this.reserve > 0) {
      this.requestReload();
    }
  }

  _fireRay() {
    const s = this._ray;
    const dir = s.dir;
    this.camera.getWorldDirection(dir);
    const spread = this._spreadAngle();
    if (spread > 0) {
      s.right.crossVectors(dir, this.camera.up).normalize();
      s.up.crossVectors(s.right, dir).normalize();
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      dir.addScaledVector(s.right, Math.cos(a) * r).addScaledVector(s.up, Math.sin(a) * r).normalize();
    }
    const origin = s.origin;
    this.camera.getWorldPosition(origin);

    s.raycaster.set(origin, dir);
    s.raycaster.near = 0.05;
    s.raycaster.far = 120;
    const enemies = this.getEnemies();
    const hitMeshes = s.hitMeshes;
    const meshToEnemy = s.meshToEnemy;
    hitMeshes.length = 0;
    meshToEnemy.clear();
    for (const en of enemies) {
      if (!en.alive) continue;
      en.hitMeshes.forEach((m) => { hitMeshes.push(m); meshToEnemy.set(m, en); });
    }

    let closestEnemyHit = null;
    if (hitMeshes.length) {
      const hits = s.raycaster.intersectObjects(hitMeshes, false);
      if (hits.length) closestEnemyHit = hits[0];
    }

    const worldHit = this.octree ? this._raycastOctree(origin, dir, 120) : null;

    const muzzleWorld = s.muzzleWorld;
    this.flashSprite.getWorldPosition(muzzleWorld);

    const finalPoint = s.finalPoint.copy(origin).addScaledVector(dir, 100);
    let hitEnemy = null;

    if (closestEnemyHit && (!worldHit || closestEnemyHit.distance < worldHit.distance)) {
      hitEnemy = meshToEnemy.get(closestEnemyHit.object);
      finalPoint.copy(closestEnemyHit.point);
    } else if (worldHit) {
      finalPoint.copy(worldHit.point);
    }

    this.tracers.fire(muzzleWorld, finalPoint, { color: 0xfff2c0 });
    NEG_DIR.copy(dir).negate();

    if (hitEnemy) {
      const isCore = closestEnemyHit.object.userData.isCore === true;
      const dmg = isCore ? 62 : 24;
      const dead = hitEnemy.applyDamage(dmg, isCore, finalPoint, dir);
      this.particles.spawnBurst(finalPoint, {
        count: 10, speed: 2.2, color: HIT_SPARK_COLOR, size: 0.05, life: 0.35, gravity: -2,
        dirBias: NEG_DIR, dirBiasStrength: 0.5,
      });
      this.audio.playHitmarker(isCore);
      if (this.onHit) this.onHit(isCore, dead);
      if (dead && this.onKill) this.onKill(hitEnemy);
    } else {
      this.particles.spawnBurst(finalPoint, {
        count: 7, speed: 1.6, color: WORLD_SPARK_COLOR, size: 0.045, life: 0.5, gravity: -6,
        dirBias: NEG_DIR, dirBiasStrength: 0.6,
      });
      this.particles.spawnSmoke(finalPoint, { count: 1, size: 0.18 });
    }
  }

  _raycastOctree(origin, dir, far) {
    if (!this.octree.rayIntersect) return null;
    this._octreeRay = this._octreeRay || new THREE.Ray();
    this._octreeRay.set(origin, dir);
    const result = this.octree.rayIntersect(this._octreeRay);
    if (!result || result.distance > far) return null;
    return { point: result.position, distance: result.distance };
  }

  _recoilKick() {
    const vertical = THREE.MathUtils.degToRad(0.85 + Math.random() * 0.5) * (this.isADS ? 0.6 : 1);
    const horizontal = THREE.MathUtils.degToRad((Math.random() - 0.5) * 0.9) * (this.isADS ? 0.6 : 1);
    this.recoilPitchVel += vertical * 26;
    this.recoilYawVel += horizontal * 26;
    this.viewKick = Math.min(1, this.viewKick + 0.55);
  }

  _muzzleFlash() {
    this.flashSprite.material.opacity = 1;
    this.flashSprite.rotation.z = Math.random() * Math.PI;
    const s = 0.16 + Math.random() * 0.08;
    this.flashSprite.scale.set(s, s, s);
    this.muzzleLight.intensity = 9;
    this.muzzleLight.visible = true;
  }

  _ejectShell() {
    const s = this._shellScratch;
    const worldPos = s.pos, worldQuat = s.quat, right = s.right, up = s.up;
    this.body.getWorldPosition(worldPos);
    this.body.getWorldQuaternion(worldQuat);
    right.set(1, 0, 0).applyQuaternion(worldQuat);
    worldPos.addScaledVector(right, 0.05);
    up.set(0, 1, 0).applyQuaternion(worldQuat);
    worldPos.addScaledVector(up, 0.02);
    right.set(1, 0.3, 0.2).applyQuaternion(worldQuat).normalize();
    up.set(0, 1, 0).applyQuaternion(worldQuat).normalize();
    this.shells.eject(worldPos, worldQuat, right, up);
  }

  update(dt, { isMoving, speed, sprinting, crouching, onGround }) {
    this.fireTimer -= dt;
    if (this.autoFire && !this.isReloading && this.fireTimer <= 0) {
      this.fireTimer = this.fireInterval;
      this._tryShoot();
    }
    this.heat = Math.max(0, this.heat - dt * 0.5);

    if (this.isReloading) {
      this.reloadTimer += dt;
      if (this.reloadTimer > this.reloadDuration * 0.55 && this.reloadTimer - dt <= this.reloadDuration * 0.55) {
        this.audio.playReload(1);
      }
      if (this.reloadTimer >= this.reloadDuration) {
        this.isReloading = false;
        const need = this.magSize - this.ammoInMag;
        const take = Math.min(need, this.reserve);
        this.ammoInMag += take;
        this.reserve -= take;
        this._notifyAmmo();
        if (this.onReloadEnd) this.onReloadEnd();
      }
    }

    // ADS lerp
    const adsGoal = this.isADS && !this.isReloading ? 1 : 0;
    this.adsLerp += (adsGoal - this.adsLerp) * Math.min(1, dt * 11);

    // recoil spring recovery (visual camera kick)
    this.recoilPitchVel += (0 - this.recoilPitch) * 55 * dt;
    this.recoilPitchVel *= Math.exp(-9 * dt);
    this.recoilPitch += this.recoilPitchVel * dt;
    this.recoilYawVel += (0 - this.recoilYaw) * 40 * dt;
    this.recoilYawVel *= Math.exp(-8 * dt);
    this.recoilYaw += this.recoilYawVel * dt;
    this.viewKick *= Math.exp(-6 * dt);

    this.camera.rotateX(this.recoilPitch * dt);
    this.camera.rotateY(this.recoilYaw * dt);

    // sway from mouse
    this.swayTarget.set(
      THREE.MathUtils.clamp(-this.mouseDX * 0.0009, -0.045, 0.045),
      THREE.MathUtils.clamp(-this.mouseDY * 0.0009, -0.045, 0.045)
    );
    this.mouseDX *= 0.001; this.mouseDY *= 0.001;
    this.sway.lerp(this.swayTarget, Math.min(1, dt * 8));

    // procedural bob
    const moveSpeed = isMoving && onGround ? (sprinting ? 1.6 : crouching ? 0.55 : 1) : 0;
    this.bobT += dt * (sprinting ? 11 : 8) * (moveSpeed || 0.35);
    const bobX = Math.sin(this.bobT) * 0.012 * moveSpeed;
    const bobY = Math.abs(Math.cos(this.bobT)) * 0.01 * moveSpeed;

    const pos = new THREE.Vector3().lerpVectors(this.basePos, this.adsPos, this._easeInOut(this.adsLerp));
    pos.x += this.sway.x * (1 - this.adsLerp * 0.7) + bobX * (1 - this.adsLerp);
    pos.y += this.sway.y * (1 - this.adsLerp * 0.7) + bobY * (1 - this.adsLerp) - this.viewKick * 0.035;
    pos.z += this.viewKick * 0.05;
    this.rig.position.copy(pos);
    this.rig.rotation.set(-bobY * 0.6 * (1 - this.adsLerp), this.sway.x * 0.4, this.sway.x * 0.6 + this.viewKick * 0.05);

    // flash / light decay
    this.flashSprite.material.opacity *= Math.exp(-dt * 40);
    this.muzzleLight.intensity *= Math.exp(-dt * 30);
    this.muzzleLight.visible = this.muzzleLight.intensity > 0.05;

    this.shells.update(dt);
  }

  _easeInOut(t) { return t * t * (3 - 2 * t); }

  get adsFovMul() { return 1 - this._easeInOut(this.adsLerp) * 0.32; }
  get spreadFrac() { return THREE.MathUtils.clamp((this._spreadAngle() / 0.09), 0, 1); }
}
