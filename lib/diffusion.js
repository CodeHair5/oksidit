import * as THREE from 'three';

/**
 * Diffusion / Plume järjestelmä
 * ------------------------------------------------------------
 * Vastaa kahdesta asiasta:
 *  1) Indikaattorin leviämisestä (canvas -> texture blur, uGlobalConc kasvu)
 *  2) Plume partikkelipilvistä (pohja- ja pintalähteet) jotka visualisoivat paikallisia kemiallisia vaikutuksia.
 *
 * Plume arkkitehtuuri lyhyesti:
 *  - spawnQueue: taulukko objekteja { x, z, count, bottom, style?, rgb? }
 *      x,z            : beaker-local koordinaatit (keskipiste = 0,0)
 *      count          : kuinka monta partikkelia vielä pyydetään (yksi kierros kuluttaa 1)
 *      bottom (bool)  : jos true → partikkelit syntyvät veden pohjan lähellä (bottom plume)
 *      style          : { ignoreIndicator, saturation, opacity, brightness, color? } väliaikaiset uniform override arvot
 *      rgb            : per-partikkeli väri (lineaarinen 0..1), käytetään kun gate=0 (ignoreIndicator)
 *
 * Bottom plume flow:
 *  - powder laskeutuu → powder.js laskee asettuneiden partikkeleiden centroidin
 *  - powder.js kutsuu diffusion.addBottomSource(lx,lz,count, { color, ... }) jos indikaattori ON
 *  - update() prosessoi jonon ja luo partikkelit:
 *       * väliaikainen uniform override asetetaan (opacity, saturation, brightness, väri)
 *       * spawnParticle() asettaa per-partikkeli RGB + gate=0 (ei riippuvuutta indicator toggleen)
 *  - Indicator OFF: powder ei lisää lähdettä (gate toteutettu powder.js:ssä)
 *
 * Gating & näkyvyys:
 *  - uRequireIndicator + per-particle aGate ratkaisee discardaako fragment.
 *  - Bottom plume käyttää gate=0 (vGate<0.5) → aina renderöityy jos spawnattu, mutta powder.js ei spawnata jos indikaattori pois.
 *  - Pintalähteet (addSource) käyttävät gate=1 (respektoivat indikaattoria).
 *
 * Laajennettavuus:
 *  - ageSpreadStrength mahdollistaa savumaisen levenemisen ilman suurempaa spawnRatea.
 *  - baselineEmissionRate poistettu käytöstä (oletus 0) mutta API tukee yhä, jos halutaan takaisin.
 *
 * Julkinen API (window.diffusion):
 *  - addSource(x,z,count)
 *  - addBottomSource(x,z,count,{ color, ignoreIndicator, saturation, opacity, brightness })
 *  - plume.setConfig({ spawnRate, maxActive, baselineEmissionRate, ageSpreadStrength, requireIndicator, ... })
 *  - plume.setStyle({ opacity, saturation, brightness, edgeSoftness, lifePow, additive })
 *  - isIndicatorEnabled()
 *  - clearPlume(), debugPlumeBurst(), enablePlumeDebug(), primePlumeDebug()
 *
 * Suorituskyky:
 *  - maxParticles = 1000, aktiivinen cap säädettävissä (oletus ~500) → kevyet uniform & attribuuttipäivitykset per frame.
 */

// Diffusion manager: encapsulates indicator canvas/texture diffusion and particle plumes
export function createDiffusionManager({ beakerGroup, beakerRadius, waterSurfaceY, waterHeight }) {
  // Indicator diffusion (canvas-based)
  const indicatorSize = 256;
  const indicatorCanvas = document.createElement('canvas');
  indicatorCanvas.width = indicatorSize;
  indicatorCanvas.height = indicatorSize;
  const indicatorCtx = indicatorCanvas.getContext('2d');
  indicatorCtx.clearRect(0, 0, indicatorSize, indicatorSize);
  const indicatorTex = new THREE.CanvasTexture(indicatorCanvas);
  indicatorTex.wrapS = THREE.ClampToEdgeWrapping;
  indicatorTex.wrapT = THREE.ClampToEdgeWrapping;
  indicatorTex.minFilter = THREE.LinearFilter;
  indicatorTex.magFilter = THREE.LinearFilter;
  indicatorTex.needsUpdate = true;

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = indicatorSize;
  tmpCanvas.height = indicatorSize;
  const tmpCtx = tmpCanvas.getContext('2d');

  // Unified water uniforms (bound later)
  let waterUniforms = null;
  function bindUniforms({ water }) {
    waterUniforms = water;
    if (waterUniforms && waterUniforms.uIndicatorMap) {
      waterUniforms.uIndicatorMap.value = indicatorTex;
    }
    // If plume already exists, rewire its color uniforms to water so pH toggles propagate
    if (points && waterUniforms) {
      const u = points.material.uniforms;
      if (waterUniforms.uGreenColor) u.uGreenColor = waterUniforms.uGreenColor;
      if (waterUniforms.uYellowColor) u.uYellowColor = waterUniforms.uYellowColor;
      if (waterUniforms.uPHScore) u.uPHScore = waterUniforms.uPHScore;
      if (waterUniforms.uIndicatorEnabled) u.uIndicatorEnabled = waterUniforms.uIndicatorEnabled;
    }
  }

  // Add a local splat of indicator (beaker-local XZ)
  function addIndicatorAt(localX, localZ) {
    const r = (waterUniforms && waterUniforms.uRadius) ? waterUniforms.uRadius.value : (beakerRadius - 0.05);
    const u = 0.5 + (localX / (2.0 * r));
    const v = 0.5 + (localZ / (2.0 * r));
    const x = Math.floor(u * indicatorSize);
    const y = Math.floor(v * indicatorSize);
    const splatRadius = Math.floor(indicatorSize * 0.12);
    const grad = indicatorCtx.createRadialGradient(x, y, 1, x, y, splatRadius);
    grad.addColorStop(0, 'rgba(0,255,120,1.0)');
    grad.addColorStop(0.5, 'rgba(0,255,120,0.8)');
    grad.addColorStop(1, 'rgba(0,0,0,0.0)');
    indicatorCtx.globalCompositeOperation = 'lighter';
    indicatorCtx.fillStyle = grad;
    indicatorCtx.beginPath();
    indicatorCtx.arc(x, y, splatRadius, 0, Math.PI * 2);
    indicatorCtx.fill();
    indicatorCtx.globalCompositeOperation = 'source-over';
    indicatorTex.needsUpdate = true;
  }

  // Throttled diffusion/bleed into water color and global concentration
  let _diffuseAccum = 0;
  let _concAccum = 0;
  let _lastMean = 0;
  function step(dt) {
    _diffuseAccum += dt;
    if (_diffuseAccum < (1 / 30)) return; // ~30 Hz
    const dtStep = _diffuseAccum; _diffuseAccum = 0;
    const decay = Math.pow(0.999, Math.max(1.0, dtStep * 60.0));

    tmpCtx.clearRect(0, 0, indicatorSize, indicatorSize);
    tmpCtx.filter = 'blur(3.5px)';
    tmpCtx.drawImage(indicatorCanvas, 0, 0);
    tmpCtx.filter = 'blur(6.0px)';
    tmpCtx.globalAlpha = 0.3;
    tmpCtx.drawImage(indicatorCanvas, 0, 0);
    tmpCtx.globalAlpha = 1.0;
    tmpCtx.filter = 'blur(8.0px)';
    tmpCtx.globalAlpha = 0.15;
    tmpCtx.drawImage(indicatorCanvas, 0, 0);
    tmpCtx.globalAlpha = 1.0;
    tmpCtx.filter = 'none';

    indicatorCtx.globalAlpha = Math.max(decay, 0.998);
    indicatorCtx.clearRect(0, 0, indicatorSize, 0 + indicatorSize);
    indicatorCtx.drawImage(tmpCanvas, 0, 0);
    indicatorCtx.globalAlpha = 1.0;
    indicatorTex.needsUpdate = true;

    _concAccum += dtStep;
    let mean = _lastMean;
    if (_concAccum >= 0.25) {
      _concAccum = 0;
      const img = indicatorCtx.getImageData(0, 0, indicatorSize, indicatorSize);
      let sum = 0; const data = img.data;
      for (let i = 0; i < data.length; i += 4) sum += data[i + 1];
      mean = sum / (255.0 * (indicatorSize * indicatorSize));
      _lastMean = mean;
    }
    const target = Math.min(1.0, mean * 2.5);
    if (waterUniforms) {
      if (mean > 0.01) {
        const growthRate = 0.985;
        waterUniforms.uGlobalConc.value = waterUniforms.uGlobalConc.value * growthRate + target * (1 - growthRate);
      } else {
        waterUniforms.uGlobalConc.value = Math.max(waterUniforms.uGlobalConc.value * 0.999, target);
      }
    }
  // unified: no secondary uniforms
  }

  // Particle plumes inside water volume
  const maxParticles = 1000;
  const positions = new Float32Array(maxParticles * 3);
  const velocities = new Float32Array(maxParticles * 3);
  const life = new Float32Array(maxParticles);
  const drifts = new Float32Array(maxParticles * 2);
  // Stable outward expansion direction per particle (for age-based radial spread)
  const expandDirs = new Float32Array(maxParticles * 2);
  const colors = new Float32Array(maxParticles * 3); // per-particle RGB (linear)
  const gate = new Float32Array(maxParticles);       // 1=respect indicator gating, 0=ignore
  // Fade tracking for bottom plume particles (gate=0) kun swirl alkaa
  const fadeTimers = new Float32Array(maxParticles);      // sekunteja kulunut fade startista
  const fadeDurations = new Float32Array(maxParticles);   // kesto sekunteina (0 = ei fadea)
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aGate', new THREE.BufferAttribute(gate, 1));
  let points = null;
  // Event plumes (custom color, e.g., base/acid local effects)
  const evMaxParticles = 600;
  const evPositions = new Float32Array(evMaxParticles * 3);
  const evVelocities = new Float32Array(evMaxParticles * 3);
  const evLife = new Float32Array(evMaxParticles);
  const evGeometry = new THREE.BufferGeometry();
  evGeometry.setAttribute('position', new THREE.BufferAttribute(evPositions, 3));
  evGeometry.setAttribute('aLife', new THREE.BufferAttribute(evLife, 1));
  // Event plumes removed: use powder trails instead. Keep no-op API.
  let evPoints = null;
  let evMat = null;

  function ensurePoints() {
    if (points) return;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        // Link to water uniforms if available for color consistency
        uGreenColor: waterUniforms && waterUniforms.uGreenColor ? waterUniforms.uGreenColor : { value: new THREE.Color(0x00b15a) },
        uYellowColor: waterUniforms && waterUniforms.uYellowColor ? waterUniforms.uYellowColor : { value: new THREE.Color(0xffc107) },
        uPHScore: waterUniforms && waterUniforms.uPHScore ? waterUniforms.uPHScore : { value: 0.0 },
        uIndicatorEnabled: waterUniforms && waterUniforms.uIndicatorEnabled ? waterUniforms.uIndicatorEnabled : { value: 0.0 },
        uRequireIndicator: { value: 1.0 }, // if 1 respects indicator toggle; if 0 always visible (debug / baseline haze)
        uSize: { value: 8.0 },
  uOpacity: { value: 0.08 },          // lowered default opacity (was 0.12) for lighter overlap
        uSaturation: { value: 0.45 },       // 0 = grey, 1 = full indicator color
        uBrightness: { value: 0.85 },       // final brightness multiplier
        uEdgeSoftness: { value: 0.55 },     // controls disk falloff steepness
        uLifePow: { value: 1.2 },           // size curve exponent (affects size over life)
        uAlphaPow: { value: 1.2 },          // separate alpha fade exponent
        uMinAlpha: { value: 0.0 },          // floor for alpha (use small >0 to keep faint trace)
        uOverrideColor: { value: new THREE.Color(0x00ff80) }, // default override (unused until enabled)
        uUseOverride: { value: 0.0 }        // 1.0 = use override color instead of indicator blend
      },
      vertexShader: `
        uniform float uSize;
        uniform float uLifePow; // size curve exponent
        attribute float aLife; attribute vec3 aColor; attribute float aGate;
        varying float vLife; varying vec3 vCol; varying float vGate;
        void main() {
          vLife = aLife;
          vCol = aColor;
          vGate = aGate;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float sizeLife = pow(max(vLife, 0.0), uLifePow);
          float size = uSize * (0.4 + 0.6 * sqrt(sizeLife));
          float projected = size * (300.0 / max(1.0, -mvPosition.z));
          gl_PointSize = min(projected, 12.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uGreenColor; uniform vec3 uYellowColor; uniform vec3 uOverrideColor; uniform float uPHScore; uniform float uIndicatorEnabled; uniform float uRequireIndicator;
        uniform float uOpacity;
        uniform float uSaturation;
        uniform float uBrightness;
        uniform float uEdgeSoftness;
        uniform float uLifePow;   // size curve exponent (kept for compatibility if used in alpha later)
        uniform float uAlphaPow;  // alpha curve exponent
        uniform float uMinAlpha;  // minimum alpha clamp
        uniform float uUseOverride; // >0.5 => force override color
        varying float vLife; varying vec3 vCol; varying float vGate;
        void main() {
          if (vLife <= 0.0) discard;
          // Per-particle gate: if vGate<0.5 particle ignores indicator gating & pH coloring and uses vCol directly.
          if (vGate > 0.5 && uRequireIndicator > 0.5) {
            if (uIndicatorEnabled < 0.5) discard;
          }
          vec2 uv = gl_PointCoord - vec2(0.5);
          float r = length(uv);
          float inner = 0.45;
          float outer = mix(0.55, 0.70, clamp(uEdgeSoftness,0.0,1.0));
          float disc = 1.0 - smoothstep(inner, outer, r);
          float lifeK = clamp(vLife, 0.0, 1.0);
          float alphaLife = pow(lifeK, uAlphaPow);
          float alpha = disc * uOpacity * max(uMinAlpha, alphaLife);
          vec3 baseCol;
          if (vGate < 0.5) {
            baseCol = vCol; // custom per-particle color (bottom plume, reaction hue independent of current water color)
          } else {
            float acid = step(0.0001, uPHScore);
            vec3 indicator = mix(uGreenColor, uYellowColor, acid);
            baseCol = (uUseOverride > 0.5) ? uOverrideColor : indicator;
          }
          // Desaturate towards luminance
          float lum = dot(baseCol, vec3(0.299,0.587,0.114));
          vec3 desat = mix(vec3(lum), baseCol, clamp(uSaturation,0.0,1.0));
          vec3 finalCol = desat * uBrightness;
          gl_FragColor = vec4(finalCol, alpha);
        }
      `,
      // Start with normal blending for subtle look (can be toggled via API)
      blending: THREE.NormalBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true
    });
    points = new THREE.Points(geometry, mat);
    points.frustumCulled = false;
    points.renderOrder = 2.5;
    beakerGroup.add(points);
  }


  function ensureEventPoints() {
  function ensureEventPoints() { /* no-op */ }
  }

  // Plume configuration (runtime adjustable)
  const plumeConfig = {
  spawnRate: 6,           // Option 3: lower spawn rate (was 8) since we lengthen life for coverage
    spawnRateMultiplier: 1, // additional scalar
  lifeSeconds: 2.1,       // Option 3: longer life to preserve visible coverage with fewer spawns
  maxActive: Math.floor(maxParticles * 0.35), // reduce active cap further (~350) to cut stacking
    alphaCurveExp: 1.2,     // exponent for alpha fade
    sizeCurveExp: 1.2,      // exponent for size curve (maps to uLifePow)
    minAlpha: 0.0,          // floor alpha
    enabled: true,
  baselineEmissionRate: 0, // continuous surface haze disabled by default
  ageSpreadStrength: 0.18,  // slightly stronger lateral age spread to thin center
    // Spatial density suppression (Option 2)
    cellSize: 0.18,            // XZ grid cell size for local density tracking
    maxPerCell: 14,            // soft cap per cell – above this we start probabilistic suppression
    suppressionProbability: 0.7 // probability to drop a spawn if cell already over maxPerCell
  };

  function applyPlumeUniforms() {
    if (!points) return;
    const u = points.material.uniforms;
    u.uLifePow.value = plumeConfig.sizeCurveExp;
    u.uAlphaPow.value = plumeConfig.alphaCurveExp;
    u.uMinAlpha.value = plumeConfig.minAlpha;
  }

  const waterBottomY = waterSurfaceY - (waterHeight || 0); // approximate water bottom (local)
  let _bottomInjecting = false; // temp flag to adjust spawn height for bottom plumes

  function spawnParticle(localX, localZ, { rgb = [0,1,0], gated = true } = {}) {
    if (!plumeConfig.enabled) return;
    let idx = -1;
    let active = 0;
    for (let i = 0; i < maxParticles; i++) {
      if (life[i] > 0.0) active++; else if (idx === -1) idx = i;
    }
    if (active >= plumeConfig.maxActive) return; // respect cap
    for (let i = 0; i < maxParticles && idx === -1; i++) { if (life[i] <= 0.0) { idx = i; break; } } // fallback (should not hit)
    if (idx === -1) return;
    const j = idx * 3;
  // Broader lateral spread to avoid dense dark spot
  const spread = _bottomInjecting ? 0.16 : 0.09; // initial lateral jitter; further expansion handled over life
    positions[j] = localX + (Math.random() - 0.5) * spread;
    if (_bottomInjecting) {
      // Bottom emission: tight vertical band near bottom, slight upward bias
      const base = waterBottomY + 0.04; // lift modestly above absolute bottom to avoid z-fighting with floor
      positions[j + 1] = base + Math.random() * 0.05;
    } else {
      // Surface-ish band (legacy behavior)
      positions[j + 1] = waterSurfaceY - 0.18 - Math.random() * 0.12;
    }
    positions[j + 2] = localZ + (Math.random() - 0.5) * spread;
    const theta = Math.random() * Math.PI * 2; const speed = 0.2 + Math.random() * 0.5;
    velocities[j] = Math.cos(theta) * speed;
    velocities[j + 1] = -0.01 + Math.random() * 0.05;
    velocities[j + 2] = Math.sin(theta) * speed;
    const driftTheta = Math.random() * Math.PI * 2; const driftSpeed = 0.02 + Math.random() * 0.03;
    const di = idx * 2; drifts[di] = Math.cos(driftTheta) * driftSpeed; drifts[di + 1] = Math.sin(driftTheta) * driftSpeed;
  // Assign a stable outward expansion direction (randomized) used for progressive age-based spreading.
  const expTheta = Math.random() * Math.PI * 2;
  expandDirs[di] = Math.cos(expTheta);
  expandDirs[di + 1] = Math.sin(expTheta);
    life[idx] = 1.0;
    // Per-particle color & gate
    colors[j] = rgb[0]; colors[j + 1] = rgb[1]; colors[j + 2] = rgb[2];
    gate[idx] = gated ? 1.0 : 0.0;
    // Reset fade meta uudelle partikkelille
    fadeTimers[idx] = 0.0;
    fadeDurations[idx] = 0.0;
  }

  // Queue entries now carry layer/style info so bottom plumes actually spawn at bottom (fixing earlier surface spawn bug)
  const spawnQueue = [];
  function addSource(localX, localZ, count = 60) { ensurePoints(); spawnQueue.push({ x: localX, z: localZ, count, bottom: false, rgb: null }); }
  /**
   * Lisää bottom plume -lähde.
   * @param {number} localX Beaker-local X (0 = keski)
   * @param {number} localZ Beaker-local Z
   * @param {number} count  Partikkeleita pyydetty (kulutetaan 1 / spawn loop kierros)
   * @param {object} opts   Tyylivalinnat
   *   - color           : hex väri (lineaarinen muunnetaan THREE.Colorin kautta)
   *   - ignoreIndicator : jos true -> partikkelit renderöidään vaikka uIndicatorEnabled=0 & uRequireIndicator=1 (DEBUG / aiempi malli)
   *                        tuotantotilassa suositus: false (nyt powder gating hoitaa ettei plume synny jos indikaattori pois)
   *   - saturation / opacity / brightness : väliaikaiset uniform override arvot vain näihin partikkeihin
   */
  let _bottomPlumeDisabled = false; // mixing lockout flag
  // Käyttäjän säädettävä horisontaalinen offset kaikille bottom plume -lähteille (XZ)
  const bottomPlumeOffset = { x: 0, z: 0 };
  function addBottomSource(localX, localZ, count = 60, { color = 0x0b3c88, ignoreIndicator = true, saturation = 0.55, opacity = 0.14, brightness = 0.95 } = {}) {
    if (_bottomPlumeDisabled) return; // blocked after mixing starts
    ensurePoints();
    // Convert hex color to linear RGB 0..1
    const c = new THREE.Color(color);
    // Sovelletaan globaalia offsetia vain vaakasuunnassa (ei muuta partikkelien Y spawn -logiikkaa)
    const ox = localX + bottomPlumeOffset.x;
    const oz = localZ + bottomPlumeOffset.z;
    spawnQueue.push({ x: ox, z: oz, count, bottom: true, style: { ignoreIndicator, saturation, opacity, brightness }, rgb: [c.r, c.g, c.b] });
  }
  // Disable future bottom plumes and purge queued bottom entries
  function disableBottomPlumes({ clearExistingQueue = true } = {}) {
    _bottomPlumeDisabled = true;
    if (clearExistingQueue) {
      for (let i = spawnQueue.length - 1; i >= 0; i--) if (spawnQueue[i].bottom) spawnQueue.splice(i, 1);
    }
  }
  function enableBottomPlumes() { _bottomPlumeDisabled = false; }

  let _debugForce = false; let _debugT = 0;
  let _spawnAccum = 0; // fractional spawn accumulator
  function update(dt) {
    if (_debugForce) {
      _debugT += dt; if (_debugT > 0.12) { _debugT = 0; addSource(0,0,30); }
    }
    if (points) {
      // --- Build spatial density grid (local XZ) before spawning (Option 2) -----------------
      // Allocate / resize grid lazily based on current config
      const gridCell = plumeConfig.cellSize;
      const gridDim = Math.max(1, Math.ceil((beakerRadius * 2) / gridCell));
      if (!update._gridCounts || update._gridDim !== gridDim) {
        update._gridDim = gridDim;
        update._gridCounts = new Uint16Array(gridDim * gridDim);
      } else {
        update._gridCounts.fill(0);
      }
      const gCounts = update._gridCounts;
      const gDim = update._gridDim;
      const half = beakerRadius;
      function gridIndex(x, z) {
        const gx = Math.min(gDim - 1, Math.max(0, Math.floor((x + half) / gridCell)));
        const gz = Math.min(gDim - 1, Math.max(0, Math.floor((z + half) / gridCell)));
        return gz * gDim + gx;
      }
      // Populate grid with current live particles
      for (let i = 0; i < maxParticles; i++) {
        if (life[i] <= 0) continue;
        const j = i * 3;
        const gi = gridIndex(positions[j], positions[j + 2]);
        if (gCounts[gi] < 65535) gCounts[gi]++;
      }
      // (baseline surface haze removed — baselineEmissionRate left available if re-enabled via config)
      // Dynamic spawn budget based on config
  let spawnPerSecond = plumeConfig.spawnRate * plumeConfig.spawnRateMultiplier;
  // Slight stochastic throttling to avoid periodic pulses (keep deterministic enough)
  spawnPerSecond *= (0.9 + Math.random()*0.2);
  _spawnAccum += spawnPerSecond * dt;
  let budget = Math.floor(_spawnAccum);
  if (budget > 0) _spawnAccum -= budget;
  // Guarantee at least one spawn if queue not empty and accumulator very small to avoid visual disappearance
  if (budget === 0 && spawnQueue.length > 0) { budget = 1; _spawnAccum = 0; }
      while (budget > 0 && spawnQueue.length > 0) {
        const req = spawnQueue[0];
        let prevState = null;
        if (req.bottom) {
          // Apply temporary bottom style & indicator gating override per particle
          const u = points.material.uniforms;
          prevState = {
            require: u.uRequireIndicator.value,
            useOverride: u.uUseOverride.value,
            overrideColor: u.uOverrideColor.value.clone(),
            opacity: u.uOpacity.value,
            sat: u.uSaturation.value,
            bright: u.uBrightness.value
          };
          const st = req.style || {};
          if (st.ignoreIndicator) u.uRequireIndicator.value = 0.0;
            u.uOverrideColor.value.set(st.color !== undefined ? st.color : 0x0b3c88);
            u.uUseOverride.value = 1.0;
            if (st.opacity !== undefined) u.uOpacity.value = st.opacity; // bottom plume now lighter (0.14 default)
            if (st.saturation !== undefined) u.uSaturation.value = st.saturation;
            if (st.brightness !== undefined) u.uBrightness.value = st.brightness;
          _bottomInjecting = true;
        }

        const rgb = req.rgb ? req.rgb : [1,1,1];
        const gated = !req.bottom; // bottom plume: ungated (color independent)
        // Adaptive global thinning (existing behaviour)
        let allow = true;
        if (points) {
          const statsActive = getPlumeStats().active;
          if (statsActive > plumeConfig.maxActive * 0.85 && Math.random() < 0.5) allow = false;
        }
        // Local spatial suppression (Option 2)
        if (allow) {
          const gi = gridIndex(req.x, req.z);
            const localCount = gCounts[gi];
            if (localCount >= plumeConfig.maxPerCell && Math.random() < plumeConfig.suppressionProbability) {
              allow = false; // skip due to local crowding
            }
        }
        if (allow) {
          spawnParticle(req.x, req.z, { rgb, gated });
          // Increment grid count pre-emptively so subsequent spawns in same frame see updated density
          const gi2 = gridIndex(req.x, req.z);
          if (gCounts[gi2] < 65535) gCounts[gi2]++;
        }

        if (req.bottom) {
          // Restore previous uniforms after each spawn so mixed queue entries don't leak style
          const u = points.material.uniforms;
          if (prevState) {
            u.uRequireIndicator.value = prevState.require;
            u.uUseOverride.value = prevState.useOverride;
            u.uOverrideColor.value.copy(prevState.overrideColor);
            u.uOpacity.value = prevState.opacity;
            u.uSaturation.value = prevState.sat;
            u.uBrightness.value = prevState.bright;
          }
          _bottomInjecting = false;
        }

        req.count--; budget--;
        if (req.count <= 0) spawnQueue.shift();
      }
      const damping = Math.pow(0.96, Math.max(1.0, dt * 60.0));
      for (let i = 0; i < maxParticles; i++) {
        if (life[i] <= 0.0) continue;
        const j = i * 3; const di = i * 2;
        positions[j] += velocities[j] * dt + drifts[di] * dt;
        positions[j + 1] += velocities[j + 1] * dt;
        positions[j + 2] += velocities[j + 2] * dt + drifts[di + 1] * dt;
        // Age-based radial expansion: progressively push particles outward to create smoke-like widening
        // life[i] stores remaining life (1 -> newly spawned, 0 -> dead). Progress = 1 - remaining.
        const progress = 1.0 - life[i];
        if (progress > 0.0) {
          // Ease-out curve for smooth early slow expansion then faster mid/late spread
          const k = Math.pow(progress, 1.15);
          const radialSpeed = plumeConfig.ageSpreadStrength * k; // max speed scaled by config
          positions[j] += expandDirs[di] * radialSpeed * dt;
          positions[j + 2] += expandDirs[di + 1] * radialSpeed * dt;
        }
        velocities[j + 1] += 0.025 * dt;
        const jitter = 0.02 * dt;
        velocities[j] += (Math.random() - 0.5) * jitter;
        velocities[j + 2] += (Math.random() - 0.5) * jitter;
        const driftJitter = 0.005 * dt;
        drifts[di] += (Math.random() - 0.5) * driftJitter;
        drifts[di + 1] += (Math.random() - 0.5) * driftJitter;
        const dmag = Math.hypot(drifts[di], drifts[di + 1]);
        if (dmag > 0.05) { drifts[di] *= 0.95; drifts[di + 1] *= 0.95; }
        velocities[j] *= damping; velocities[j + 1] *= damping; velocities[j + 2] *= damping;
        positions[j + 1] = Math.min(positions[j + 1], waterSurfaceY - 0.01);
        const r = Math.hypot(positions[j], positions[j + 2]);
        if (r > beakerRadius * 0.98) { const s = (beakerRadius * 0.98) / r; positions[j] *= s; positions[j + 2] *= s; }
        // Normaalin elinkaaren kuluminen
        life[i] -= dt / plumeConfig.lifeSeconds; if (life[i] < 0.0) life[i] = 0.0;
        // Jos partikkeli on bottom (gate=0) ja sille on asetettu fade, skaalaa life ylärajalla
        if (gate[i] < 0.5 && fadeDurations[i] > 0.0) {
          fadeTimers[i] += dt;
          const k = Math.min(1.0, fadeTimers[i] / fadeDurations[i]);
          // Käänteinen progress (1 -> 0). Pidä partikkeli hengissä hiipumisen loppuun asti.
          const fadeLife = 1.0 - k;
          if (life[i] > fadeLife) life[i] = fadeLife;
          if (k >= 1.0) { life[i] = 0.0; fadeDurations[i] = 0.0; }
        }
      }
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.aLife.needsUpdate = true;
  geometry.attributes.aColor.needsUpdate = true;
  geometry.attributes.aGate.needsUpdate = true;
    }

    // Update event plumes
    if (evPoints) {
      // Event plumes removed
    }

  }

  // Event plumes (custom color)
  const evSpawnQueue = [];
  function addEventPlume(localX, localZ, colorHex = 0x12d65c, count = 90) {
    function addEventPlume(_x, _z, _colorHex = 0x12d65c, _count = 90) { return; }
  }

  function spawnEventParticle(localX, localZ) {
  function spawnEventParticle() { /* removed */ }
  }

  function reset() {
    indicatorCtx.clearRect(0, 0, indicatorSize, indicatorSize);
    indicatorTex.needsUpdate = true;
    if (waterUniforms) waterUniforms.uGlobalConc.value = 0.0;
  // unified: no secondary uniforms
    for (let i = 0; i < maxParticles; i++) { life[i] = 0.0; const j = i * 3; positions[j] = positions[j + 1] = positions[j + 2] = 0; velocities[j] = velocities[j + 1] = velocities[j + 2] = 0; }
    if (points) { geometry.attributes.position.needsUpdate = true; geometry.attributes.aLife.needsUpdate = true; }

    // Clear event plumes
    for (let i = 0; i < evMaxParticles; i++) { evLife[i] = 0.0; const j = i * 3; evPositions[j] = evPositions[j + 1] = evPositions[j + 2] = 0; evVelocities[j] = evVelocities[j + 1] = evVelocities[j + 2] = 0; }
    // No event plumes to clear
  }

  function dispose() {
    if (points && points.parent) points.parent.remove(points);
    if (geometry) geometry.dispose();
    if (points && points.material) points.material.dispose();
    if (evPoints && evPoints.parent) evPoints.parent.remove(evPoints);
    if (evGeometry) evGeometry.dispose();
    if (evPoints && evPoints.material) evPoints.material.dispose();
  }

  function clearEvents() {
    for (let i = 0; i < evMaxParticles; i++) evLife[i] = 0.0;
    if (evPoints) { evGeometry.attributes.aLife.needsUpdate = true; }
  }

  function setPlumeStyle({ opacity, saturation, brightness, edgeSoftness, lifePow, additive } = {}) {
    ensurePoints();
    const u = points.material.uniforms;
    if (opacity !== undefined) u.uOpacity.value = opacity;
    if (saturation !== undefined) u.uSaturation.value = saturation;
    if (brightness !== undefined) u.uBrightness.value = brightness;
    if (edgeSoftness !== undefined) u.uEdgeSoftness.value = edgeSoftness;
    if (lifePow !== undefined) { plumeConfig.sizeCurveExp = lifePow; u.uLifePow.value = lifePow; }
    if (additive !== undefined) {
      points.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      points.material.needsUpdate = true;
    }
  }

  // New: override color (null/undefined disables)
  function setPlumeColor(colorHex) {
    ensurePoints();
    const u = points.material.uniforms;
    if (colorHex === null || colorHex === undefined) {
      u.uUseOverride.value = 0.0;
    } else {
      u.uOverrideColor.value.set(colorHex);
      u.uUseOverride.value = 1.0;
    }
  }

  // New: configuration API for amount / life / curves
  /**
   * Päivitä plume-asetuksia ajoaikana.
   * Huom: baselineEmissionRate on oletuksena 0 (pois). ageSpreadStrength kontrolloi ikään perustuvaa sivusuuntaista leviämistä.
   */
  function setPlumeConfig({
    spawnRate,
    spawnRateMultiplier,
    lifeSeconds,
    maxActive,
    alphaCurveExp,
    sizeCurveExp,
    minAlpha,
    enabled,
    baselineEmissionRate,
    ageSpreadStrength,
    cellSize,
    maxPerCell,
    suppressionProbability,
    requireIndicator
  } = {}) {
    if (spawnRate !== undefined) plumeConfig.spawnRate = Math.max(0, spawnRate);
    if (spawnRateMultiplier !== undefined) plumeConfig.spawnRateMultiplier = Math.max(0, spawnRateMultiplier);
    if (lifeSeconds !== undefined) plumeConfig.lifeSeconds = Math.max(0.05, lifeSeconds);
    if (maxActive !== undefined) plumeConfig.maxActive = Math.min(maxParticles, Math.max(0, maxActive));
    if (alphaCurveExp !== undefined) plumeConfig.alphaCurveExp = Math.max(0.01, alphaCurveExp);
    if (sizeCurveExp !== undefined) plumeConfig.sizeCurveExp = Math.max(0.01, sizeCurveExp);
    if (minAlpha !== undefined) plumeConfig.minAlpha = Math.min(1.0, Math.max(0.0, minAlpha));
    if (enabled !== undefined) plumeConfig.enabled = !!enabled;
    if (baselineEmissionRate !== undefined) plumeConfig.baselineEmissionRate = Math.max(0, baselineEmissionRate);
    if (ageSpreadStrength !== undefined) plumeConfig.ageSpreadStrength = Math.max(0, ageSpreadStrength);
    if (cellSize !== undefined) plumeConfig.cellSize = Math.max(0.01, cellSize);
    if (maxPerCell !== undefined) plumeConfig.maxPerCell = Math.max(1, maxPerCell);
    if (suppressionProbability !== undefined) plumeConfig.suppressionProbability = Math.min(1, Math.max(0, suppressionProbability));
    if (requireIndicator !== undefined && points) points.material.uniforms.uRequireIndicator.value = requireIndicator ? 1.0 : 0.0;
    ensurePoints();
    applyPlumeUniforms();
  }

  function getPlumeStats() {
    let active = 0; for (let i = 0; i < maxParticles; i++) if (life[i] > 0) active++;
    return {
      active,
      free: maxParticles - active,
      max: maxParticles,
      queue: spawnQueue.reduce((s, q) => s + q.count, 0),
      config: { ...plumeConfig },
      overrideColor: points ? points.material.uniforms.uUseOverride.value > 0.5 : false
    };
  }

  // Initial uniforms sync when created later
  function initPlumeDefaults() { ensurePoints(); applyPlumeUniforms(); }

  // Encapsulated plume control object
  const plume = {
    setStyle: setPlumeStyle,
    setColor: setPlumeColor,
    setConfig: setPlumeConfig,
    getStats: getPlumeStats,
    enable: () => setPlumeConfig({ enabled: true }),
    disable: () => setPlumeConfig({ enabled: false })
  };
  // Clear plume particles & queue (used when swirling powder)
  function clearPlume() {
    if (points) {
      for (let i = 0; i < maxParticles; i++) life[i] = 0.0;
      geometry.attributes.aLife.needsUpdate = true;
    }
    spawnQueue.length = 0;
  }
  // Remove only existing bottom plume particles (identified by gate=0) without clearing gated (surface) ones.
  function clearBottomPlumeParticles() {
    if (!points) return;
    let cleared = 0;
    for (let i = 0; i < maxParticles; i++) {
      if (life[i] > 0 && gate[i] < 0.5) { // gate=0 → bottom plume particle
        life[i] = 0.0; fadeDurations[i] = 0.0; fadeTimers[i] = 0.0;
        cleared++;
      }
    }
    if (cleared > 0) geometry.attributes.aLife.needsUpdate = true;
    // Also purge queued bottom spawns (if API user forgot to call disable first)
    for (let i = spawnQueue.length - 1; i >= 0; i--) if (spawnQueue[i].bottom) spawnQueue.splice(i, 1);
    return cleared;
  }

  // Aloita pehmeä häivytys kaikille bottom plume -partikkeleille.
  function fadeOutBottomPlumes(durationSec = 0.6) {
    if (!points) return 0;
    let affected = 0;
    for (let i = 0; i < maxParticles; i++) {
      if (life[i] > 0.0 && gate[i] < 0.5) { // bottom plume
        fadeDurations[i] = durationSec;
        fadeTimers[i] = 0.0;
        if (life[i] <= 0.0) { fadeDurations[i] = 0.0; } else affected++;
      }
    }
    return affected;
  }

  // Debug helpers ---------------------------------------------------
  function debugPlumeBurst({ count = 150, overrideColor = 0xff00ff } = {}) {
    ensurePoints();
    setPlumeColor(overrideColor);
    setPlumeStyle({ opacity: 0.6, saturation: 1.0, brightness: 1.0, additive: true, edgeSoftness: 0.4 });
    setPlumeConfig({ spawnRate: 240, maxActive: 900, lifeSeconds: 2.2, minAlpha: 0.0 });
    // center burst
    const per = Math.max(1, Math.floor(count / 10));
    for (let ring = 0; ring < 10; ring++) {
      const rad = 0.02 * ring;
      for (let k = 0; k < per; k++) {
        const a = Math.random() * Math.PI * 2;
        addSource(Math.cos(a) * rad, Math.sin(a) * rad, 1);
      }
    }
  }
  function getActivePlumeCount() { return plume ? plume.getStats().active : 0; }
  function enablePlumeDebug() {
    ensurePoints();
    _debugForce = true; // timed center burst path
    setPlumeColor(0xff44dd);
    setPlumeStyle({ opacity: 0.95, saturation: 1.0, brightness: 1.2, additive: true, edgeSoftness: 0.35, lifePow: 1.0 });
    setPlumeConfig({ spawnRate: 480, maxActive: 980, lifeSeconds: 2.8, minAlpha: 0.0, requireIndicator: false });
    points.material.uniforms.uRequireIndicator.value = 0.0; // ignore indicator toggle
  }
  function disablePlumeDebug() {
    _debugForce = false;
    setPlumeColor(null);
    if (points) points.material.uniforms.uRequireIndicator.value = 1.0;
  }
  // Immediate strong visual burst (one-shot) for quick visibility
  function primePlumeDebug() {
    enablePlumeDebug();
    ensurePoints();
    // Direct particle injection bypassing queue for instant result
    for (let i = 0; i < 160; i++) {
      addSource((Math.random()-0.5)*0.3, (Math.random()-0.5)*0.3, 1);
    }
  }
  // -----------------------------------------------------------------
  // Backwards compatibility: keep root style method; expose new ones later in return value.

  // Expose API (plume control + legacy top-level style function)
  function isIndicatorEnabled() { return !!(waterUniforms && waterUniforms.uIndicatorEnabled && waterUniforms.uIndicatorEnabled.value > 0.5); }
  function setBottomPlumeOffset(x, z) {
    bottomPlumeOffset.x = x || 0;
    bottomPlumeOffset.z = z || 0;
  }
  function getBottomPlumeOffset() { return { x: bottomPlumeOffset.x, z: bottomPlumeOffset.z }; }
  const api = { indicatorTex, bindUniforms, addIndicatorAt, step, addSource, addBottomSource, update, reset, dispose, addEventPlume, clearEvents, setPlumeStyle, setPlumeColor, setPlumeConfig, plume, initPlumeDefaults, clearPlume, clearBottomPlumeParticles, debugPlumeBurst, getActivePlumeCount, enablePlumeDebug, disablePlumeDebug, primePlumeDebug, isIndicatorEnabled, disableBottomPlumes, enableBottomPlumes, setBottomPlumeOffset, getBottomPlumeOffset, fadeOutBottomPlumes };
  if (typeof window !== 'undefined') window.diffusion = api;
  return api;
}
