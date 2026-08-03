import * as THREE from "three";
import { Capsule } from "three/addons/math/Capsule.js";

const STATE = { PATROL: "patrol", ALERT: "alert", COMBAT: "combat", DEAD: "dead" };

function holoMaterial(color, opacity = 0.55) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.9, transparent: true, opacity,
    roughness: 0.35, metalness: 0.1, depthWrite: false,
  });
}

function edgeOverlay(geometry, color) {
  const edges = new THREE.EdgesGeometry(geometry, 20);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, toneMapped: false });
  return new THREE.LineSegments(edges, mat);
}

function buildSentinel() {
  const group = new THREE.Group();
  const color = 0x49d7ff;
  const mat = holoMaterial(color, 0.62);
  const hitMeshes = [];

  function part(w, h, d, x, y, z, name) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.name = name;
    mesh.userData.isCore = false;
    group.add(mesh);
    mesh.add(edgeOverlay(geo, 0xbdf3ff));
    hitMeshes.push(mesh);
    return mesh;
  }

  const pelvis = part(0.26, 0.22, 0.16, 0, 0.95, 0, "pelvis");
  const torso = part(0.32, 0.42, 0.18, 0, 1.32, 0, "torso");
  const head = part(0.18, 0.2, 0.18, 0, 1.68, 0, "head");

  const legL = new THREE.Group(); legL.position.set(-0.1, 0.85, 0); group.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.1, 0.85, 0); group.add(legR);
  const thighL = part(0.11, 0.42, 0.12, 0, -0.2, 0, "thighL"); legL.add(thighL); thighL.position.set(0, 0, 0);
  const thighR = part(0.11, 0.42, 0.12, 0, -0.2, 0, "thighR"); legR.add(thighR);
  const shinL = part(0.09, 0.4, 0.1, 0, -0.62, 0, "shinL"); legL.add(shinL);
  const shinR = part(0.09, 0.4, 0.1, 0, -0.62, 0, "shinR"); legR.add(shinR);

  const armL = new THREE.Group(); armL.position.set(-0.24, 1.5, 0); group.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.24, 1.5, 0); group.add(armR);
  const upperArmL = part(0.09, 0.34, 0.09, 0, -0.16, 0, "upperArmL"); armL.add(upperArmL);
  const upperArmR = part(0.09, 0.34, 0.09, 0, -0.16, 0, "upperArmR"); armR.add(upperArmR);
  const foreArmL = part(0.08, 0.3, 0.08, 0, -0.46, 0, "foreArmL"); armL.add(foreArmL);
  const foreArmR = part(0.08, 0.3, 0.08, 0, -0.46, 0, "foreArmR"); armR.add(foreArmR);

  const coreGeo = new THREE.SphereGeometry(0.075, 16, 16);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.set(0, 1.32, 0.1);
  core.userData.isCore = true;
  core.name = "core";
  group.add(core);
  hitMeshes.push(core);
  // Off by default (see Sentinel.update) — only lit up briefly on hit/death.
  const coreLight = new THREE.PointLight(0x8be9ff, 0, 3, 2);
  coreLight.visible = false;
  core.add(coreLight);

  // muzzle point on right forearm
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.16, 0);
  foreArmR.add(muzzle);

  group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  return { group, hitMeshes, core, coreLight, legL, legR, armL, armR, torso, head, muzzle, mat, coreMat };
}

let idCounter = 0;

export class Sentinel {
  constructor(scene, spawnPos, deps) {
    this.id = idCounter++;
    this.scene = scene;
    this.deps = deps; // { octree, getPlayerPos, particles, boltPool, audio, coverPoints }
    const built = buildSentinel();
    Object.assign(this, built);
    this.group.position.copy(spawnPos);
    scene.add(this.group);

    this.baseY = spawnPos.y;
    this.capsule = new Capsule(
      spawnPos.clone().add(new THREE.Vector3(0, 0.3, 0)),
      spawnPos.clone().add(new THREE.Vector3(0, 1.6, 0)),
      0.3
    );

    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;
    this.state = STATE.PATROL;
    this.stateT = 0;
    this.facing = Math.random() * Math.PI * 2;
    this.targetFacing = this.facing;
    this.moveDir = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.patrolTarget = this._pickPatrolPoint(spawnPos);
    this.fireTimer = 1 + Math.random();
    this.losTimer = 0;
    this.hasLOS = false;
    this.staggerT = 0;
    this.walkPhase = Math.random() * 10;
    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.strafeTimer = 2 + Math.random() * 2;
    this.deathT = 0;
    this.removed = false;
    this.alertedOnce = false;
  }

  _pickPatrolPoint(near) {
    const pts = this.deps.coverPoints;
    if (!pts || !pts.length) return near.clone();
    return pts[Math.floor(Math.random() * pts.length)].clone();
  }

  applyDamage(amount, isCore, hitPoint, hitDir) {
    if (!this.alive) return false;
    this.health -= amount;
    this.staggerT = 0.18;
    this.coreLight.intensity = isCore ? 6 : 3;
    this.coreLight.visible = true;
    if (this.state === STATE.PATROL) this._enterAlert();
    if (this.health <= 0) {
      this._die();
      return true;
    }
    return false;
  }

  _die() {
    this.alive = false;
    this.state = STATE.DEAD;
    this.deathT = 0;
    this.deps.particles.spawnBurst(this._headWorld(), {
      count: 42, speed: 4.2, spread: 3, color: new THREE.Color(0x9be9ff),
      size: 0.06, life: 0.7, gravity: 0.5,
    });
    this.deps.audio.playCoreExplode(this.group.position);
    this.coreLight.intensity = 8;
    this.coreLight.visible = true;
  }

  _headWorld() {
    const p = new THREE.Vector3();
    this.head.getWorldPosition(p);
    return p;
  }

  _enterAlert() {
    if (this.state === STATE.DEAD) return;
    if (this.state === STATE.PATROL) {
      this.state = STATE.ALERT;
      this.stateT = 0;
      this.deps.audio.playAlert(this.group.position);
    }
  }

  _checkLOS(playerPos) {
    const eye = this._headWorld();
    const dir = playerPos.clone().sub(eye);
    const dist = dir.length();
    dir.normalize();
    if (!this.deps.octree.rayIntersect) return dist < 40;
    const ray = new THREE.Ray(eye, dir);
    const hit = this.deps.octree.rayIntersect(ray);
    if (!hit) return dist < 40;
    return hit.distance > dist - 0.3;
  }

  _faceToward(target, dt, speed = 6) {
    const dx = target.x - this.group.position.x;
    const dz = target.z - this.group.position.z;
    this.targetFacing = Math.atan2(dx, dz);
    let diff = this.targetFacing - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.facing += diff * Math.min(1, dt * speed);
    this.group.rotation.y = this.facing;
  }

  _moveToward(target, dt, speed) {
    const to = target.clone().sub(this.group.position);
    to.y = 0;
    const dist = to.length();
    if (dist < 0.15) { this.velocity.set(0, 0, 0); return dist; }
    to.normalize();
    this.velocity.lerp(to.multiplyScalar(speed), Math.min(1, dt * 5));
    const delta = this.velocity.clone().multiplyScalar(dt);
    this.capsule.translate(new THREE.Vector3(delta.x, 0, delta.z));
    this._resolveCollisions();
    this.group.position.set(
      (this.capsule.start.x + this.capsule.end.x) / 2,
      this.baseY,
      (this.capsule.start.z + this.capsule.end.z) / 2
    );
    return dist;
  }

  _resolveCollisions() {
    if (!this.deps.octree.capsuleIntersect) return;
    const result = this.deps.octree.capsuleIntersect(this.capsule);
    if (result && Math.abs(result.normal.y) < 0.6) {
      this.capsule.translate(result.normal.multiplyScalar(result.depth));
    }
  }

  update(dt, playerPos, playerAlive) {
    if (this.state === STATE.DEAD) { this._updateDeath(dt); return; }
    if (this.staggerT > 0) this.staggerT -= dt;

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.22;
      this.hasLOS = playerAlive && this._checkLOS(playerPos);
      if (this.hasLOS && this.state === STATE.PATROL) this._enterAlert();
      if (this.hasLOS && this.state === STATE.ALERT && this.stateT > 0.4) {
        this.state = STATE.COMBAT;
        this.stateT = 0;
      }
      if (!this.hasLOS && this.state === STATE.COMBAT) {
        this.stateT2 = (this.stateT2 || 0) + this.losTimer;
      }
    }
    this.stateT += dt;

    if (this.state === STATE.PATROL) {
      this._faceToward(this.patrolTarget, dt, 2.2);
      const dist = this._moveToward(this.patrolTarget, dt, 1.1);
      this._animateWalk(dt, 0.7);
      if (dist < 0.4) this.patrolTarget = this._pickPatrolPoint(this.group.position);
    } else if (this.state === STATE.ALERT) {
      this._faceToward(playerPos, dt, 4);
      this._animateWalk(dt, 0);
      this.velocity.multiplyScalar(0.9);
    } else if (this.state === STATE.COMBAT) {
      this._faceToward(playerPos, dt, 5);
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 1.5 + Math.random() * 2; }
      const toPlayer = playerPos.clone().sub(this.group.position); toPlayer.y = 0;
      const dist = toPlayer.length();
      const right = new THREE.Vector3(toPlayer.z, 0, -toPlayer.x).normalize();
      let moveTarget;
      if (dist < 7) {
        moveTarget = this.group.position.clone().addScaledVector(toPlayer.clone().normalize(), -3).addScaledVector(right, this.strafeDir * 3);
      } else if (dist > 16) {
        moveTarget = playerPos.clone();
      } else {
        moveTarget = this.group.position.clone().addScaledVector(right, this.strafeDir * 3);
      }
      this._moveToward(moveTarget, dt, 2.4);
      this._animateWalk(dt, 1);

      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && this.hasLOS) {
        this.fireTimer = 1.15 + Math.random() * 1.1;
        this._fireBolt(playerPos);
      }
      if (!this.hasLOS && (this.stateT2 || 0) > 2.5) {
        this.state = STATE.PATROL;
        this.stateT = 0; this.stateT2 = 0;
        this.patrolTarget = this._pickPatrolPoint(this.group.position);
      }
    }

    // The glow reads through bloom on the unlit core mesh and the emissive
    // body material; a real-time light per Sentinel isn't needed for that
    // and would add a shader light-loop iteration per fragment for every
    // simultaneous enemy, so coreLight only flashes briefly on hit/death
    // (see applyDamage/_die) and decays back out here. `visible` (not just
    // intensity) is what keeps an idle light out of the renderer's active
    // light list, so it has to be toggled explicitly.
    this.coreLight.intensity *= Math.exp(-dt * 6);
    this.coreLight.visible = this.coreLight.intensity > 0.02;
    this.mat.emissiveIntensity = (this.state === STATE.COMBAT ? 2.1 : 1.5) + (this.staggerT > 0 ? 1.2 : 0);
    this.mat.color.setHex(this.staggerT > 0 ? 0xffffff : (this.state === STATE.COMBAT ? 0xff5c4a : 0x49d7ff));
    this.mat.emissive.copy(this.mat.color);
  }

  _animateWalk(dt, intensity) {
    const speed = this.velocity.length();
    this.walkPhase += dt * (3 + speed * 2) * (intensity > 0 ? 1 : 0.3);
    const swing = Math.sin(this.walkPhase) * 0.5 * intensity * Math.min(1, speed);
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.6;
    this.armR.rotation.x = swing * 0.6 + (this.state === STATE.COMBAT ? -0.9 : 0);
    this.torso.position.y = 1.32 + Math.abs(Math.sin(this.walkPhase * 2)) * 0.015 * intensity;
  }

  _fireBolt(playerPos) {
    const from = new THREE.Vector3();
    this.muzzle.getWorldPosition(from);
    const lead = playerPos.clone();
    const spread = 0.55;
    lead.x += (Math.random() - 0.5) * spread;
    lead.y += (Math.random() - 0.5) * spread * 0.6 + 0.1;
    lead.z += (Math.random() - 0.5) * spread;
    this.deps.boltPool.fire(from, lead, 0.4 + from.distanceTo(lead) * 0.01, (arrivePos) => {
      this.deps.onBoltArrive && this.deps.onBoltArrive(arrivePos, this);
    });
    this.deps.audio.playEnemyBolt(from);
    this.armR.rotation.x = -1.3;
  }

  _updateDeath(dt) {
    this.deathT += dt;
    const t = Math.min(1, this.deathT / 0.7);
    const flicker = Math.random() > 0.6 ? 1 : 0.3;
    this.group.traverse((o) => { if (o.isMesh && o.material && o.material.opacity !== undefined) o.material.opacity = (1 - t) * 0.5 * flicker; });
    this.group.scale.setScalar(1 - t * 0.3);
    this.group.position.y = this.baseY - t * 0.4;
    this.coreLight.intensity = Math.max(0, 8 * (1 - t * 2));
    this.coreLight.visible = this.coreLight.intensity > 0.02;
    if (t >= 1 && !this.removed) {
      this.removed = true;
      this.scene.remove(this.group);
      this.dispose();
    }
  }

  // Removing a group from the scene does not free its GPU-side buffers —
  // every kill spawns a brand-new Sentinel with brand-new geometries, so
  // without this every wave permanently leaks the previous wave's meshes.
  dispose() {
    const disposedMaterials = new Set();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (!disposedMaterials.has(m)) { disposedMaterials.add(m); m.dispose(); }
      }
    });
  }
}
