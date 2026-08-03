import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { Capsule } from "three/addons/math/Capsule.js";

const GRAVITY = 27;
const STEPS_PER_FRAME = 5;
const RADIUS = 0.34;
const STAND_HEIGHT = 1.62;
const CROUCH_HEIGHT = 0.95;
const EYE_OFFSET = 0.15;

export class PlayerController {
  constructor(camera, domElement, octree, spawnPos) {
    this.camera = camera;
    this.octree = octree;
    this.controls = new PointerLockControls(camera, domElement);

    this.collider = new Capsule(
      spawnPos.clone().add(new THREE.Vector3(0, RADIUS, 0)),
      spawnPos.clone().add(new THREE.Vector3(0, STAND_HEIGHT, 0)),
      RADIUS
    );
    this.velocity = new THREE.Vector3();
    this.onFloor = false;
    this.crouching = false;
    this.crouchLerp = 0;
    this.sprinting = false;
    this.stamina = 1;

    this.health = 100;
    this.maxHealth = 100;
    this.armor = 60;
    this.maxArmor = 60;
    this.alive = true;

    this.keys = new Set();
    this.wantsJump = false;
    this.footstepTimer = 0;
    this.lastGroundY = spawnPos.y;
    this.landDip = 0;

    this.sensitivity = 1.4;
    this.baseFov = 78;
    this.sprintFovMul = 1;

    this.onDamage = null;
    this.onDeath = null;
    this.onFootstep = null;
    this.onLand = null;

    this._bindInput();
  }

  _bindInput() {
    this._onKeyDown = (e) => {
      this.keys.add(e.code);
      if (e.code === "Space") this.wantsJump = true;
      if (e.code === "KeyC" || e.code === "ControlLeft" || e.code === "ControlRight") this.crouching = true;
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      if (e.code === "KeyC" || e.code === "ControlLeft" || e.code === "ControlRight") this.crouching = false;
    };
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
  }

  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
  }

  get isMoving() {
    return this.keys.has("KeyW") || this.keys.has("KeyA") || this.keys.has("KeyS") || this.keys.has("KeyD");
  }

  get speedFactor() {
    const v = this.velocity.clone(); v.y = 0;
    return v.length();
  }

  teleport(pos) {
    this.collider.start.copy(pos).add(new THREE.Vector3(0, RADIUS, 0));
    this.collider.end.copy(pos).add(new THREE.Vector3(0, STAND_HEIGHT, 0));
    this.velocity.set(0, 0, 0);
  }

  takeDamage(amount, worldDirToSource) {
    if (!this.alive) return;
    let remaining = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, remaining * 0.65);
      this.armor -= absorbed;
      remaining -= absorbed;
    }
    this.health = Math.max(0, this.health - remaining);
    if (this.onDamage) this.onDamage(amount, worldDirToSource);
    if (this.health <= 0 && this.alive) {
      this.alive = false;
      if (this.onDeath) this.onDeath();
    }
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  _forwardVector() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    return dir;
  }

  _sideVector() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    dir.cross(this.camera.up);
    return dir;
  }

  _collisions() {
    const result = this.octree.capsuleIntersect(this.collider);
    this.onFloor = false;
    if (result) {
      this.onFloor = result.normal.y > 0.35;
      if (!this.onFloor) {
        this.velocity.addScaledVector(result.normal, -result.normal.dot(this.velocity));
      }
      if (result.depth >= 1e-10) {
        this.collider.translate(result.normal.multiplyScalar(result.depth));
      }
    }
  }

  _substep(dt, aimingDownSights) {
    const wantSprint = this.keys.has("ShiftLeft") && this.isMoving && !this.crouching && this.stamina > 0.02 && !aimingDownSights;
    this.sprinting = wantSprint;
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt * 0.32);
    else this.stamina = Math.min(1, this.stamina + dt * 0.18);

    let speed;
    if (this.crouching) speed = 2.4;
    else if (aimingDownSights) speed = 2.7;
    else if (this.sprinting) speed = 7.4;
    else speed = 4.3;

    if (!this.onFloor) speed *= 0.9;

    const speedDelta = dt * speed * (this.onFloor ? 10 : 4);
    let moveX = 0, moveZ = 0;
    if (this.keys.has("KeyW")) moveZ += 1;
    if (this.keys.has("KeyS")) moveZ -= 1;
    if (this.keys.has("KeyD")) moveX += 1;
    if (this.keys.has("KeyA")) moveX -= 1;
    const len = Math.hypot(moveX, moveZ) || 1;
    moveX /= len; moveZ /= len;

    if (moveZ !== 0) this.velocity.addScaledVector(this._forwardVector(), moveZ * speedDelta);
    if (moveX !== 0) this.velocity.addScaledVector(this._sideVector(), moveX * speedDelta);

    if (this.onFloor && this.wantsJump && !this.crouching) {
      this.velocity.y = 7.1;
      this.onFloor = false;
    }

    let damping = Math.exp(-5 * dt) - 1;
    if (!this.onFloor) {
      this.velocity.y -= GRAVITY * dt;
      damping *= 0.08;
    } else {
      damping *= 1;
    }
    this.velocity.addScaledVector(this.velocity, damping);

    const deltaPosition = this.velocity.clone().multiplyScalar(dt);
    this.collider.translate(deltaPosition);
    this._collisions();
  }

  update(dt, { aimingDownSights = false } = {}) {
    if (!this.controls.isLocked || !this.alive) { this.wantsJump = false; return; }
    const stepDt = Math.min(dt, 0.05) / STEPS_PER_FRAME;
    const wasOnFloor = this.onFloor;
    for (let i = 0; i < STEPS_PER_FRAME; i++) this._substep(stepDt, aimingDownSights);
    this.wantsJump = false;

    if (this.collider.end.y < -20) this.teleport(new THREE.Vector3(0, 2, 0));

    // crouch eye-height smoothing
    const targetCrouch = this.crouching ? 1 : 0;
    this.crouchLerp += (targetCrouch - this.crouchLerp) * Math.min(1, dt * 9);

    const eyeY = this.collider.end.y - EYE_OFFSET - this.crouchLerp * (STAND_HEIGHT - CROUCH_HEIGHT);
    this.camera.position.set(this.collider.end.x, eyeY, this.collider.end.z);

    if (!wasOnFloor && this.onFloor) {
      this.landDip = THREE.MathUtils.clamp(Math.abs(this.velocity.y) * 0.02, 0, 0.12);
      if (this.onLand) this.onLand();
    }
    this.landDip *= Math.exp(-dt * 10);

    if (this.onFloor && this.isMoving && this.controls.isLocked) {
      const stepInterval = this.sprinting ? 0.32 : this.crouching ? 0.52 : 0.42;
      this.footstepTimer += dt;
      if (this.footstepTimer >= stepInterval) {
        this.footstepTimer = 0;
        if (this.onFootstep) this.onFootstep(this.sprinting ? 1 : this.crouching ? 0.4 : 0.7);
      }
    } else {
      this.footstepTimer = 0;
    }
  }

  get bobPhaseSpeed() {
    return this.speedFactor;
  }
}
