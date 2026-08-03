import * as THREE from "three";
import { buildLevel } from "./level.js";
import { createPostFX } from "./postfx.js";
import { PlayerController } from "./player.js";
import { Weapon } from "./weapon.js";
import { Sentinel } from "./enemy.js";
import { ParticleSystem, TracerPool, BoltPool } from "./particles.js";
import { AudioEngine } from "./audio.js";
import { Hud } from "./hud.js";

const canvas = document.getElementById("scene");
const hud = new Hud();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.045, 500);
scene.add(camera); // required so children (weapon viewmodel) render

hud.showScreen("loadingScreen");
hud.setLoading(0.08, "テクスチャを生成中…");

await new Promise((r) => setTimeout(r, 10));

const level = buildLevel(scene);
hud.setLoading(0.55, "コリジョンを構築中…");
await new Promise((r) => setTimeout(r, 10));

const postfx = createPostFX(renderer, scene, camera, { width: window.innerWidth, height: window.innerHeight });
hud.setLoading(0.75, "システムを初期化中…");
await new Promise((r) => setTimeout(r, 10));

const audio = new AudioEngine();
const particles = new ParticleSystem(scene, 700);
const tracers = new TracerPool(scene, 28);
const bolts = new BoltPool(scene, 14);

const player = new PlayerController(camera, renderer.domElement, level.octree, level.playerSpawn);

const enemies = [];
function getEnemies() { return enemies; }

const weapon = new Weapon(camera, scene, {
  particles, tracers, audio, octree: level.octree, getEnemies,
});

hud.setLoading(1, "READY");
await new Promise((r) => setTimeout(r, 120));
hud.showScreen("startScreen");

// ---------------- game state ----------------
const state = {
  mode: "menu", // menu | playing | paused | ended
  wave: 0,
  score: 0,
  kills: 0,
  shots: 0,
  hits: 0,
  waveActive: false,
  waveClearDelay: 0,
  maxWaves: 6,
};

function spawnWave(n) {
  const count = Math.min(3 + n, 6, level.enemySpawns.length);
  const usedIdx = new Set();
  for (let i = 0; i < count; i++) {
    let idx;
    do { idx = Math.floor(Math.random() * level.enemySpawns.length); } while (usedIdx.has(idx) && usedIdx.size < level.enemySpawns.length);
    usedIdx.add(idx);
    const pos = level.enemySpawns[idx].clone();
    const s = new Sentinel(scene, pos, {
      octree: level.octree,
      particles, boltPool: bolts, audio,
      coverPoints: level.coverPoints,
      onBoltArrive: handleBoltArrive,
    });
    enemies.push(s);
  }
  state.wave = n;
  state.waveActive = true;
  hud.setWave(n);
  hud.setHostiles(count);
  hud.addKill(`WAVE ${n} — 敵性反応あり`);
}

function handleBoltArrive(pos, shooter) {
  if (!player.alive) return;
  const playerPos = camera.position;
  const dist = pos.distanceTo(playerPos);
  if (dist > 1.3) return;
  const dmg = 9 + Math.random() * 6;
  const dirToSource = new THREE.Vector3().subVectors(shooter.group.position, playerPos).setY(0).normalize();
  player.takeDamage(dmg, dirToSource);
  audio.playDamage();
}

player.onDamage = (amount, dirToSource) => {
  hud.flashDamage(computeIndicatorAngle(dirToSource));
};
player.onDeath = () => {
  endGame(false);
};
player.onFootstep = (intensity) => {
  audio.playFootstep(intensity);
};
player.onLand = () => {
  audio.playFootstep(1.2);
};

weapon.onFire = () => { state.shots++; };
weapon.onHit = (isCore, dead) => {
  state.hits++;
  hud.flashHitmarker(isCore);
};
weapon.onKill = (enemy) => {
  state.kills++;
  state.score += enemy ? 150 : 100;
  hud.setScore(state.score);
  hud.addKill(`センチネル撃破 +150`);
};
weapon.onAmmoChange = (inMag, reserve) => {
  hud.setAmmo(inMag, reserve);
  hud.showLowAmmo(inMag <= 5 && inMag > 0);
};
weapon.onReloadStart = () => hud.showReloadPrompt(false);
weapon.onDryFire = () => hud.showReloadPrompt(true);
// Weapon's constructor fires one ammo-change notification before main.js
// has a chance to attach this handler, so the HUD's static placeholder
// value would otherwise linger until the first shot or reload.
weapon.onAmmoChange(weapon.ammoInMag, weapon.reserve);

function computeIndicatorAngle(dirToSource) {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0; fwd.normalize();
  const d = dirToSource.clone(); d.y = 0; d.normalize();
  const angle = Math.atan2(
    fwd.x * d.z - fwd.z * d.x,
    fwd.x * d.x + fwd.z * d.z
  );
  return angle;
}

function endGame(won) {
  state.mode = "ended";
  player.controls.unlock();
  const accuracy = state.shots > 0 ? Math.round((state.hits / state.shots) * 100) : 0;
  hud.setEndStats(won ? "MISSION COMPLETE" : "KIA — シミュレーション終了", {
    score: state.score, wave: state.wave, kills: state.kills, accuracy,
  });
  hud.showScreen("endScreen");
}

// ---------------- input / lock lifecycle ----------------
player.controls.addEventListener("lock", () => {
  hud.hideOverlay();
  hud.showHudLayer();
  audio.ensure(); audio.resume();
  if (state.mode === "menu" || state.mode === "ended") {
    state.mode = "playing";
    if (!state.waveActive && state.wave === 0) spawnWave(1);
  } else if (state.mode === "paused") {
    state.mode = "playing";
  }
});
player.controls.addEventListener("unlock", () => {
  if (state.mode === "playing") {
    state.mode = "paused";
    hud.showScreen("pauseScreen");
  }
});

document.getElementById("startBtn").addEventListener("click", () => player.controls.lock());
document.getElementById("resumeBtn").addEventListener("click", () => player.controls.lock());
document.getElementById("retryBtn").addEventListener("click", () => window.location.reload());

hud.bindSettings((key, value) => {
  if (key === "sensitivity") player.sensitivity = value;
  if (key === "fov") player.baseFov = value;
  if (key === "ssao" || key === "bloom" || key === "grain") {
    postfx.setQuality({
      ssao: hud.el.ssaoToggle.checked,
      bloom: hud.el.bloomToggle.checked,
      grain: hud.el.grainToggle.checked,
    });
  }
});
postfx.setQuality({ ssao: true, bloom: true, grain: true });

window.addEventListener("mousedown", (e) => {
  if (!player.controls.isLocked) return;
  if (e.button === 0) weapon.startFire();
  if (e.button === 2) weapon.setADS(true);
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) weapon.stopFire();
  if (e.button === 2) weapon.setADS(false);
});
window.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => {
  if (!player.controls.isLocked) return;
  if (e.code === "KeyR") weapon.requestReload();
});
window.addEventListener("blur", () => { weapon.stopFire(); weapon.setADS(false); });

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- main loop ----------------
const clock = new THREE.Clock();
let elapsed = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  player.controls.pointerSpeed = player.sensitivity;

  if (state.mode === "playing") {
    player.update(dt, { aimingDownSights: weapon.isADS });
    weapon.update(dt, {
      isMoving: player.isMoving, speed: player.speedFactor,
      sprinting: player.sprinting, crouching: player.crouching, onGround: player.onFloor,
    });

    const playerPos = camera.position;
    for (const en of enemies) en.update(dt, playerPos, player.alive);

    // cleanup dead+removed
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].removed) enemies.splice(i, 1);
    }

    const aliveCount = enemies.filter((e) => e.alive).length;
    hud.setHostiles(aliveCount);

    if (state.waveActive && aliveCount === 0 && enemies.length === 0) {
      state.waveActive = false;
      state.waveClearDelay = 3.2;
    }
    if (!state.waveActive && state.waveClearDelay > 0) {
      state.waveClearDelay -= dt;
      if (state.waveClearDelay <= 0) {
        if (state.wave >= state.maxWaves) {
          endGame(true);
        } else {
          spawnWave(state.wave + 1);
        }
      }
    }

    hud.setHealth(player.health, player.maxHealth);
    hud.setArmor(player.armor, player.maxArmor);
    hud.setCrosshairSpread(weapon.spreadFrac + (player.sprinting ? 0.6 : 0));
    hud.setCrosshairVisible(!weapon.isADS);
    hud.setStamina(player.sprinting || player.stamina < 0.98, player.stamina);

    camera.fov = player.baseFov * (player.sprinting ? 1.05 : 1) * weapon.adsFovMul;
    camera.updateProjectionMatrix();

    audio.setListener(camera.position, (() => { const d = new THREE.Vector3(); camera.getWorldDirection(d); return d; })());
  }

  particles.update(dt);
  tracers.update(dt);
  bolts.update(dt);
  for (const fn of level.updatables) fn(dt);

  postfx.gradePass.uniforms.time.value = elapsed;
  postfx.gradePass.uniforms.lowHealth.value = state.mode === "playing" ? THREE.MathUtils.clamp(1 - player.health / 35, 0, 1) : 0;

  postfx.composer.render();
}

tick();
