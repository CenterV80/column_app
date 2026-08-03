import * as THREE from "three";

function sparkTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,220,160,0.8)");
  grad.addColorStop(1, "rgba(255,180,80,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function smokeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(200,200,210,0.55)");
  grad.addColorStop(0.5, "rgba(160,160,175,0.25)");
  grad.addColorStop(1, "rgba(150,150,165,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class ParticleSystem {
  constructor(scene, maxCount = 600) {
    this.scene = scene;
    this.max = maxCount;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(maxCount * 3);
    this.colors = new Float32Array(maxCount * 3);
    this.sizes = new Float32Array(maxCount);
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));
    const mat = new THREE.PointsMaterial({
      size: 0.08, vertexColors: true, map: sparkTexture(), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;

    this.particles = [];
    for (let i = 0; i < maxCount; i++) {
      this.particles.push({
        active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        life: 0, maxLife: 1, size: 0.08, color: new THREE.Color(), gravity: -9,
      });
    }
    this.cursor = 0;

    this.smokeGroup = new THREE.Group();
    scene.add(this.smokeGroup);
    this.smokeTex = smokeTexture();
    this.smokes = [];
  }

  spawnBurst(origin, {
    count = 10, speed = 3, spread = 1, color = new THREE.Color(1, 0.7, 0.3),
    size = 0.07, life = 0.4, gravity = -9, dirBias = null, dirBiasStrength = 0.6,
  } = {}) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
      p.active = true;
      p.pos.copy(origin);
      const rand = new THREE.Vector3(
        (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2
      ).normalize();
      if (dirBias) {
        rand.lerp(dirBias, dirBiasStrength).normalize();
      }
      p.vel.copy(rand).multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      p.vel.x += (Math.random() - 0.5) * spread;
      p.vel.z += (Math.random() - 0.5) * spread;
      p.life = 0;
      p.maxLife = life * (0.6 + Math.random() * 0.8);
      p.size = size * (0.6 + Math.random() * 0.8);
      p.color.copy(color);
      p.gravity = gravity;
    }
  }

  spawnSmoke(origin, { count = 3, size = 0.5, rise = 0.6 } = {}) {
    for (let i = 0; i < count; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.smokeTex, transparent: true, opacity: 0.5, depthWrite: false,
      }));
      sp.position.copy(origin).addScaledVector(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.3, Math.random() - 0.5), 0.15);
      sp.scale.setScalar(size * (0.6 + Math.random() * 0.6));
      this.smokeGroup.add(sp);
      this.smokes.push({ sprite: sp, life: 0, maxLife: 1.1 + Math.random() * 0.5, rise });
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const p = this.particles[i];
      if (!p.active) { this.sizes[i] = 0; continue; }
      p.life += dt;
      if (p.life >= p.maxLife) { p.active = false; this.sizes[i] = 0; continue; }
      p.vel.y += p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      const t = p.life / p.maxLife;
      const idx = i * 3;
      this.positions[idx] = p.pos.x; this.positions[idx + 1] = p.pos.y; this.positions[idx + 2] = p.pos.z;
      this.colors[idx] = p.color.r; this.colors[idx + 1] = p.color.g; this.colors[idx + 2] = p.color.b;
      this.sizes[i] = p.size * (1 - t);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;

    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.life += dt;
      const t = s.life / s.maxLife;
      s.sprite.position.y += dt * s.rise;
      s.sprite.material.opacity = 0.45 * (1 - t);
      s.sprite.scale.multiplyScalar(1 + dt * 0.6);
      if (t >= 1) {
        this.smokeGroup.remove(s.sprite);
        s.sprite.material.dispose();
        this.smokes.splice(i, 1);
      }
    }
  }
}

export class TracerPool {
  constructor(scene, max = 24) {
    this.scene = scene;
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const geo = new THREE.CylinderGeometry(0.006, 0.006, 1, 5, 1, true);
      geo.rotateX(Math.PI / 2);
      geo.translate(0, 0, -0.5);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xfff2c0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.pool.push({ mesh, life: 0, maxLife: 0.06, active: false, length: 1 });
    }
    this.cursor = 0;
  }

  fire(origin, target, { color = 0xfff2c0 } = {}) {
    const slot = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    slot.active = true;
    slot.life = 0;
    slot.mesh.visible = true;
    slot.mesh.material.color.set(color);
    slot.mesh.position.copy(origin);
    slot.mesh.lookAt(target);
    slot.length = origin.distanceTo(target);
    slot.mesh.scale.set(1, 1, slot.length);
    slot.mesh.material.opacity = 0.9;
  }

  update(dt) {
    for (const slot of this.pool) {
      if (!slot.active) continue;
      slot.life += dt;
      const t = slot.life / slot.maxLife;
      slot.mesh.material.opacity = 0.9 * (1 - t);
      slot.mesh.scale.z = slot.length * (1 - t * 0.4);
      if (t >= 1) { slot.active = false; slot.mesh.visible = false; }
    }
  }
}

export class BoltPool {
  constructor(scene, max = 12) {
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const geo = new THREE.SphereGeometry(0.05, 8, 6);
      geo.scale(1, 1, 2.6);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: 0x5be8ff, transparent: true, opacity: 0.95 });
      const mesh = new THREE.Mesh(geo, mat);
      // Intensity starts at 0 and is only raised while a bolt is actually in
      // flight (see fire()/update()) — pooled lights sitting idle at nonzero
      // intensity would otherwise add a permanent light-loop cost per pixel
      // for every object in the scene, for every unused slot in the pool.
      const light = new THREE.PointLight(0x5be8ff, 0, 3.5, 2);
      mesh.add(light);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({
        mesh, light, active: false, from: new THREE.Vector3(), to: new THREE.Vector3(),
        t: 0, duration: 0.28, onArrive: null,
      });
    }
    this.cursor = 0;
  }

  fire(from, to, duration, onArrive) {
    const slot = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    slot.active = true;
    slot.from.copy(from);
    slot.to.copy(to);
    slot.t = 0;
    slot.duration = duration;
    slot.onArrive = onArrive;
    slot.mesh.visible = true;
    slot.mesh.position.copy(from);
    slot.mesh.lookAt(to);
    slot.light.intensity = 3;
  }

  update(dt) {
    for (const slot of this.pool) {
      if (!slot.active) continue;
      slot.t += dt / slot.duration;
      if (slot.t >= 1) {
        slot.active = false;
        slot.mesh.visible = false;
        slot.light.intensity = 0;
        if (slot.onArrive) slot.onArrive(slot.to);
        continue;
      }
      slot.mesh.position.lerpVectors(slot.from, slot.to, slot.t);
    }
  }
}
