export class Hud {
  constructor() {
    this.el = {
      hud: document.getElementById("hud"),
      overlay: document.getElementById("overlay"),
      startScreen: document.getElementById("startScreen"),
      pauseScreen: document.getElementById("pauseScreen"),
      endScreen: document.getElementById("endScreen"),
      loadingScreen: document.getElementById("loadingScreen"),
      loadingFill: document.getElementById("loadingFill"),
      loadingLabel: document.getElementById("loadingLabel"),
      startBtn: document.getElementById("startBtn"),
      resumeBtn: document.getElementById("resumeBtn"),
      retryBtn: document.getElementById("retryBtn"),
      crosshair: document.getElementById("crosshair"),
      hitmarker: document.getElementById("hitmarker"),
      damageFlash: document.getElementById("damageFlash"),
      dmgIndicators: document.getElementById("dmgIndicators"),
      healthBar: document.getElementById("healthBar"),
      armorBar: document.getElementById("armorBar"),
      ammoInMag: document.getElementById("ammoInMag"),
      ammoReserve: document.getElementById("ammoReserve"),
      reloadPrompt: document.getElementById("reloadPrompt"),
      lowAmmoWarn: document.getElementById("lowAmmoWarn"),
      killFeed: document.getElementById("killFeed"),
      waveLabel: document.getElementById("waveLabel"),
      hostileCount: document.getElementById("hostileCount"),
      scoreValue: document.getElementById("scoreValue"),
      staminaWrap: document.getElementById("staminaWrap"),
      staminaBar: document.getElementById("staminaBar"),
      endTitle: document.getElementById("endTitle"),
      endStats: document.getElementById("endStats"),
      sensSlider: document.getElementById("sensSlider"),
      fovSlider: document.getElementById("fovSlider"),
      ssaoToggle: document.getElementById("ssaoToggle"),
      bloomToggle: document.getElementById("bloomToggle"),
      grainToggle: document.getElementById("grainToggle"),
      gunbobToggle: document.getElementById("gunbobToggle"),
    };
  }

  showHudLayer() { this.el.hud.classList.remove("hidden"); }
  hideHudLayer() { this.el.hud.classList.add("hidden"); }

  showScreen(name) {
    for (const s of ["startScreen", "pauseScreen", "endScreen", "loadingScreen"]) {
      this.el[s].classList.toggle("hidden", s !== name);
    }
    this.el.overlay.classList.remove("hidden");
  }
  hideOverlay() { this.el.overlay.classList.add("hidden"); }

  setLoading(frac, label) {
    this.el.loadingFill.style.width = `${Math.round(frac * 100)}%`;
    if (label) this.el.loadingLabel.textContent = label;
  }

  setHealth(hp, max) {
    const frac = Math.max(0, hp / max);
    this.el.healthBar.style.width = `${frac * 100}%`;
    this.el.healthBar.classList.toggle("low", frac < 0.3);
  }
  setArmor(a, max) {
    const frac = Math.max(0, a / max);
    this.el.armorBar.style.width = `${frac * 100}%`;
  }

  setAmmo(inMag, reserve) {
    this.el.ammoInMag.textContent = inMag;
    this.el.ammoReserve.textContent = reserve;
    this.el.ammoInMag.style.color = inMag <= 5 ? "#ff6a5c" : "";
  }

  showReloadPrompt(show) { this.el.reloadPrompt.classList.toggle("show", show); }
  showLowAmmo(show) { this.el.lowAmmoWarn.classList.toggle("show", show); }

  flashHitmarker(crit) {
    const el = this.el.hitmarker;
    el.classList.remove("show", "crit");
    void el.offsetWidth;
    el.classList.add("show");
    if (crit) el.classList.add("crit");
  }

  flashDamage(angleRad) {
    this.el.damageFlash.classList.remove("hit");
    void this.el.damageFlash.offsetWidth;
    this.el.damageFlash.classList.add("hit");
    if (angleRad !== null && angleRad !== undefined) {
      const arrow = document.createElement("div");
      arrow.className = "dmgArrow";
      arrow.style.transform = `rotate(${angleRad}rad)`;
      this.el.dmgIndicators.appendChild(arrow);
      setTimeout(() => arrow.remove(), 1000);
    }
  }

  addKill(text) {
    const el = document.createElement("div");
    el.className = "killEntry";
    el.textContent = text;
    this.el.killFeed.appendChild(el);
    setTimeout(() => el.remove(), 3000);
    while (this.el.killFeed.children.length > 5) this.el.killFeed.removeChild(this.el.killFeed.firstChild);
  }

  setWave(n) { this.el.waveLabel.textContent = `WAVE ${n}`; }
  setHostiles(n) { this.el.hostileCount.textContent = `残り ${n}`; }
  setScore(n) { this.el.scoreValue.textContent = n; }

  setCrosshairSpread(frac) {
    this.el.crosshair.style.setProperty("--spread", `${6 + frac * 26}px`);
  }
  setCrosshairVisible(v) { this.el.crosshair.classList.toggle("hidden-ch", !v); }

  setStamina(show, frac) {
    this.el.staminaWrap.classList.toggle("show", show);
    this.el.staminaBar.style.width = `${Math.max(0, frac) * 100}%`;
  }

  setLowHealthPulse() {}

  bindSettings(cb) {
    this.el.sensSlider.addEventListener("input", () => cb("sensitivity", parseFloat(this.el.sensSlider.value)));
    this.el.fovSlider.addEventListener("input", () => cb("fov", parseFloat(this.el.fovSlider.value)));
    this.el.ssaoToggle.addEventListener("change", () => cb("ssao", this.el.ssaoToggle.checked));
    this.el.bloomToggle.addEventListener("change", () => cb("bloom", this.el.bloomToggle.checked));
    this.el.grainToggle.addEventListener("change", () => cb("grain", this.el.grainToggle.checked));
    this.el.gunbobToggle.addEventListener("change", () => cb("gunbob", this.el.gunbobToggle.checked));
  }

  setEndStats(title, { score, wave, kills, accuracy }) {
    this.el.endTitle.textContent = title;
    this.el.endStats.innerHTML = `
      <div><b>${score}</b>SCORE</div>
      <div><b>${wave}</b>WAVE</div>
      <div><b>${kills}</b>KILLS</div>
      <div><b>${accuracy}%</b>ACCURACY</div>
    `;
  }
}
