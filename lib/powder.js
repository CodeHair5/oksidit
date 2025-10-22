import * as THREE from 'three';

/**
 * Powder järjestelmä
 * -------------------
 * Vastaa jauhepartikkeleiden pudotuksesta, asettumisesta, pyörteestä (swirl) ja liukenemisesta.
 * Diffusion integraatio:
 *  - createPowder(...).setDiffusionManager(diffusionApi) liittää diffusionin.
 *  - Kun riittävästi (>=20) partikkelia on asettunut pohjalle ja swirl ei ole käynnissä, järjestelmä laukaisee plumen burstin.
 *  - Ennen 2025-09: plume syntyi aina (ja override värillä). Nyt: Gating → jos indikaattori EI ole päällä, plumea ei lisätä jonoon.
 *  - Tämä takaa: "Ei indikaattoria -> ei plumea".
 *
 * Logiikka:
 *  1. Settled centroid lasketaan (sx,sz)
 *  2. Muunnetaan beaker-local koordinaatiksi (lx,lz)
 *  3. Tarkistetaan diffusion.isIndicatorEnabled() → jos false: skip
 *  4. Muuten diffusion.addBottomSource(lx,lz,count,{ ignoreIndicator:false })
 *
 * Muut:
 *  - Swirl tyhjentää plumen (clearPlume kutsutaan diffusionista erillisessä logiikassa aikaisemmin) vähentämään visuaalista sotkua.
 *  - plumePerBurst on pienehkö (18) ja varsinainen hiukkasmäärä rajataan diffusion puolella spawnRate + maxActive parametreilla.
 */

try { window.__POWDER_FILE_PATH = import.meta && import.meta.url ? import.meta.url : '(no import.meta.url)'; } catch {}
// Powder particle system (batches of simple points) – haze & trail poistettu.
// API: const powder = createPowder(scene, { count, size, color });

export function createPowder(scene, opts = {}) {
  const count = opts.count ?? 600;
  const size = opts.size ?? 0.03;
  const color = opts.color ?? 0xffffff;
  const defaultVerticalSpread = opts.verticalSpread ?? 0.25;
  const defaultVelocityYRange = opts.velocityYRange ?? [-0.2, 0.25];
  const defaultRadialJitter = opts.radialJitter ?? 0.35;
  const batches = [];

  // Trail/bloom poistettu → ei ylimääräistä Points-shaderia.

  function makeBatch(spawnCfg) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const settledFlags = new Uint8Array(count); // 1 = on bottom (has touched)
    const material = new THREE.PointsMaterial({ size, color, transparent: true, opacity: 1.0 });
    const points = new THREE.Points(geometry, material);
    points.visible = false;
    points.name = 'powderParticles';
    scene.add(points);

    for (let i = 0; i < count; i++) resetParticle(i);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const state = {
      dropping: false,
      dropElapsed: 0,
      bottomYWorld: 0,
      beakerCenterWorld: new THREE.Vector3(),
      beakerRadius: 0.95,
      swirling: false,
      swirlElapsed: 0,
      swirlDuration: 0,
      swirlCenterWorld: new THREE.Vector3(),
      swirlStrength: 0.0,
      swirlInward: 0.0,
  swirlDrag: 1.2,
  swirlDir: 1.0, // +1 = CCW, -1 = CW
      // Dissolve is independent of swirling so fade can continue after motion stops
      dissolveActive: false,
      dissolveElapsed: 0,
      dissolveDurationSec: 0,
      dead: false,
      waterSurfaceY: Infinity,
    };

    function resetParticle(i) {
      const radialJitter = spawnCfg.radialJitter ?? defaultRadialJitter;
      const r = Math.random() * radialJitter;
      const a = Math.random() * Math.PI * 2;
      positions[i * 3 + 0] = Math.cos(a) * r;
      // Vertical spawn: only BELOW origin (simulate coming from spoon underside)
      const vSpread = spawnCfg.verticalSpread ?? defaultVerticalSpread; // total band
      // random y in [-vSpread, 0]
      positions[i * 3 + 1] = -Math.random() * vSpread;
      positions[i * 3 + 2] = Math.sin(a) * r;
      // Stronger horizontal velocity jitter
      velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.18;
      const vyRange = spawnCfg.velocityYRange ?? defaultVelocityYRange;
      velocities[i * 3 + 1] = vyRange[0] + Math.random() * (vyRange[1] - vyRange[0]);
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.18;
    }

    return { geometry, positions, velocities, material, points, state, resetParticle, settledFlags };
  }

  function hasPowder() { return batches.some(b => b.points.visible); }

  function clear() {
    for (const b of batches) {
      if (b.points.parent) b.points.parent.remove(b.points);
      b.material.dispose();
      b.geometry.dispose();
      b.state.dead = true;
    }
    batches.length = 0;
  }

  // verticalSpread / velocityYRange / radialJitter ovat valinnaisia overrideja per spawn.
  function spawnAt(worldPos, { bottomYWorld, centerWorld, beakerRadius, waterSurfaceY, onEnterWater, verticalSpread, velocityYRange, radialJitter, beakerGroup } = {}) {
    const b = makeBatch({ verticalSpread, velocityYRange, radialJitter });
    batches.push(b);
    const { points, material, state, geometry, positions, resetParticle } = b;
    for (let i = 0; i < count; i++) resetParticle(i);
    if (b.settledFlags) b.settledFlags.fill(0);
    geometry.attributes.position.needsUpdate = true;
    points.position.copy(worldPos);
    points.quaternion.set(0, 0, 0, 1);
    points.visible = true;
    material.opacity = 1.0;
    state.dropping = true;
    state.dropElapsed = 0;
  state.bottomYWorld = (typeof bottomYWorld === 'number') ? bottomYWorld : 0;
  state.waterSurfaceY = (typeof waterSurfaceY === 'number') ? waterSurfaceY : Infinity;
    // Safety: ensure bottom is below spawn so particles can fall
    if (!(state.bottomYWorld < worldPos.y - 0.01)) {
      state.bottomYWorld = worldPos.y - 0.5; // half-meter below spawn as fallback
    }
  if (centerWorld) state.beakerCenterWorld.copy(centerWorld);
  state._beakerGroup = beakerGroup || null;
    if (typeof beakerRadius === 'number') state.beakerRadius = beakerRadius;
  state.onEnterWater = (typeof onEnterWater === 'function') ? onEnterWater : null;
    state.enterNotified = false;
    // Uusi jauhe → sallitaan jälleen pohjan plume (jos aiempi sekoitus oli estänyt)
    try { if (diffusion && typeof diffusion.enableBottomPlumes === 'function') diffusion.enableBottomPlumes(); } catch {}
  }

  // Optional diffusion manager hook (set via setDiffusionManager)
  let diffusion = null;
  // Rate limiting for plume spawns
  let plumeSpawnAccum = 0;
  const plumeSpawnInterval = 0.12; // seconds between spawn bursts
  const plumePerBurst = 18;        // particles requested per burst
  const plumeRadiusJitter = 0.18;  // scatter around cluster center
  function setDiffusionManager(d) { diffusion = d; }

  function startSwirl({ centerWorld, durationSec = 1.4, strength = 0.35, inward = 0.08, drag = 1.2, dissolve = false, dissolveDurationSec = null, direction = 'ccw', bottomPlumeFadeSec = null } = {}) {
    for (const b of batches) {
      const { state, material, points } = b;
      if (!points.visible) continue;
      if (state.dropping) continue; // skip until settled
      if (centerWorld) state.swirlCenterWorld.copy(centerWorld);
      state.swirlDuration = Math.max(0.2, durationSec + 1.0); // +1s extra visibility
      state.swirlElapsed = 0;
      state.swirlStrength = Math.max(0, strength);
      state.swirlInward = Math.max(0, inward);
      state.swirlDrag = Math.max(0, drag);
      state.swirling = true;
      state.swirlDir = (direction === 'cw') ? -1.0 : 1.0;
      // dissolve
      state.dissolveActive = !!dissolve;
      state.dissolveElapsed = 0;
      state.dissolveDurationSec = (dissolveDurationSec == null) ? state.swirlDuration : Math.max(0.1, dissolveDurationSec);
      material.opacity = 1.0;
    }
    // Mixing just started: immediately block further bottom plume spawns and remove existing bottom plume particles
    try {
      if (diffusion && typeof diffusion.disableBottomPlumes === 'function') diffusion.disableBottomPlumes({ clearExistingQueue: true });
      // If no explicit fade given, tie fade length to swirlDuration (already extended by +1s above)
      const effectiveFade = (bottomPlumeFadeSec == null) ? (Math.max(0.05, (durationSec + 1.0))) : Math.max(0.05, bottomPlumeFadeSec);
      if (diffusion && typeof diffusion.fadeOutBottomPlumes === 'function') {
        diffusion.fadeOutBottomPlumes(effectiveFade);
      } else if (diffusion && typeof diffusion.clearBottomPlumeParticles === 'function') {
        diffusion.clearBottomPlumeParticles(); // fallback
      }
    } catch {}
  }

  function stopSwirl() {
    for (const b of batches) {
      b.state.swirling = false; // keep dissolveActive as-is
    }
    // Swirl finished: allow plume again (no action needed besides clearing accum)
    plumeSpawnAccum = 0;
  }

  function update(dt) {
  // Trail/bloom ei käytössä → ei emissio- tai fade-logiikkaa.

    for (const b of batches) {
      const { geometry, positions, velocities, material, points, state } = b;
      if (state.dead) continue;
      if (!points.visible && !state.dropping && !state.swirling && !state.dissolveActive) continue;

      // Drop
      if (state.dropping) {
  const g = 6.0;
        const bottomY = state.bottomYWorld || 0;
        const eps = 0.01;
        let bottomHits = 0;
        for (let i = 0; i < count; i++) {
          // Apply gravity; if underwater, apply buoyancy to reduce effective gravity
          const baseY = points.position.y + positions[i * 3 + 1];
          const inWater = isFinite(state.waterSurfaceY) ? (baseY <= state.waterSurfaceY - 0.001) : false;
          // First underwater entry callback (once per batch)
          if (inWater && !state.enterNotified && state.onEnterWater) {
            state.enterNotified = true;
            try {
              const baseX0 = points.position.x + positions[i * 3 + 0];
              const baseZ0 = points.position.z + positions[i * 3 + 2];
              state.onEnterWater(new THREE.Vector3(baseX0, state.waterSurfaceY, baseZ0));
            } catch {}
          }
          velocities[i * 3 + 1] -= g * dt;
          if (inWater) {
            // Reduce effective gravity moderately and add lighter viscous damping underwater
            velocities[i * 3 + 1] += (g * 0.45) * dt; // buoyancy: net 0.55g
            velocities[i * 3 + 1] *= 0.93;            // vertical drag (lighter than before)
            velocities[i * 3 + 0] *= 0.975;           // lateral drag
            velocities[i * 3 + 2] *= 0.975;
          }
          // Integrate positions
          positions[i * 3 + 0] += velocities[i * 3 + 0] * dt;
          positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
          positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
          // Trail emission poistettu
          const worldY = points.position.y + positions[i * 3 + 1];
          if (worldY <= bottomY + eps) {
            positions[i * 3 + 1] = (bottomY + eps) - points.position.y;
            velocities[i * 3 + 1] = 0;
            velocities[i * 3 + 0] *= 0.96;
            velocities[i * 3 + 2] *= 0.96;
            bottomHits++;
            b.settledFlags[i] = 1; // mark settled
          }
          const worldX = points.position.x + positions[i * 3 + 0];
          const worldZ = points.position.z + positions[i * 3 + 2];
          const dx = worldX - state.beakerCenterWorld.x;
          const dz = worldZ - state.beakerCenterWorld.z;
          const r = Math.hypot(dx, dz);
          const maxR = Math.max(0.0, state.beakerRadius - 0.06);
          if (r > maxR) {
            const s = maxR / (r + 1e-6);
            const clampedX = state.beakerCenterWorld.x + dx * s;
            const clampedZ = state.beakerCenterWorld.z + dz * s;
            positions[i * 3 + 0] = clampedX - points.position.x;
            positions[i * 3 + 2] = clampedZ - points.position.z;
            velocities[i * 3 + 0] *= 0.8;
            velocities[i * 3 + 2] *= 0.8;
          }
        }
        geometry.attributes.position.needsUpdate = true;
    // (trail geometry päivitystä ei ole)
        state.dropElapsed += dt;
        // End dropping when most particles have touched bottom, with a safety timeout
        const hitFrac = bottomHits / count;
        if (hitFrac >= 0.6 || state.dropElapsed >= 8.0) {
          state.dropping = false;
        }
      }

      // Swirl motion
      if (!state.dropping && state.swirling) {
        const bottomY = state.bottomYWorld || 0;
        const eps = 0.01;
        const maxR = Math.max(0.0, state.beakerRadius - 0.06);
        const t = state.swirlElapsed;
        const T = Math.max(0.001, state.swirlDuration);
        let fade = 1.0;
        if (t > T * 0.7) {
          const k = (t - T * 0.7) / (T * 0.3);
          fade = Math.max(0.0, 1.0 - k);
        }
        const strength = state.swirlStrength * fade;
        const inward = state.swirlInward * fade;
        const drag = Math.max(0.0, state.swirlDrag);
        for (let i = 0; i < count; i++) {
          const worldY = points.position.y + positions[i * 3 + 1];
          if (worldY <= bottomY + eps) {
            positions[i * 3 + 1] = (bottomY + eps) - points.position.y;
            velocities[i * 3 + 1] = 0;
          }
          const worldX = points.position.x + positions[i * 3 + 0];
          const worldZ = points.position.z + positions[i * 3 + 2];
          const dx = worldX - state.swirlCenterWorld.x;
          const dz = worldZ - state.swirlCenterWorld.z;
          const r = Math.hypot(dx, dz) + 1e-6;
          // Tangent (CCW) = (-dz, dx); apply direction multiplier for CW inversion
          const dirMul = state.swirlDir;
          const tx = (-dz / r) * dirMul;
          const tz = (dx / r) * dirMul;
          velocities[i * 3 + 0] += (tx * strength - (dx / r) * inward) * dt;
          velocities[i * 3 + 2] += (tz * strength - (dz / r) * inward) * dt;
          positions[i * 3 + 0] += velocities[i * 3 + 0] * dt;
          positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
          const newWorldX = points.position.x + positions[i * 3 + 0];
          const newWorldZ = points.position.z + positions[i * 3 + 2];
          const ndx = newWorldX - state.beakerCenterWorld.x;
          const ndz = newWorldZ - state.beakerCenterWorld.z;
          const nr = Math.hypot(ndx, ndz);
          if (nr > maxR) {
            const s = maxR / (nr + 1e-6);
            const clampedX = state.beakerCenterWorld.x + ndx * s;
            const clampedZ = state.beakerCenterWorld.z + ndz * s;
            positions[i * 3 + 0] = clampedX - points.position.x;
            positions[i * 3 + 2] = clampedZ - points.position.z;
            velocities[i * 3 + 0] *= 0.85;
            velocities[i * 3 + 2] *= 0.85;
          }
          const damp = Math.exp(-drag * dt);
          velocities[i * 3 + 0] *= damp;
          velocities[i * 3 + 2] *= damp;
        }
        geometry.attributes.position.needsUpdate = true;
        state.swirlElapsed += dt;
        if (state.swirlElapsed >= state.swirlDuration) {
          state.swirling = false;
        }
      }

      // Dissolve fade independent of swirling
      if (state.dissolveActive) {
        state.dissolveElapsed += dt;
        const dur = Math.max(0.001, state.dissolveDurationSec || 1.0);
        const k = Math.min(1.0, state.dissolveElapsed / dur);
        const newOpacity = Math.max(0.0, 1.0 - k);
        material.opacity = newOpacity;
        if (newOpacity <= 0.02) {
          points.visible = false;
          state.dissolveActive = false;
        }
      }
    }

    // Optional cleanup of fully invisible batches
    for (let i = batches.length - 1; i >= 0; i--) {
      const b = batches[i];
      if (!b.points.visible && !b.state.dropping && !b.state.swirling && !b.state.dissolveActive) {
        // keep geometry for reuse? For simplicity, keep batch to allow reactivation if needed
        // No action
      }
    }

    // Emit diffusion plume sources from settled powder clusters near bottom (if diffusion present and not swirling)
    if (diffusion) {
      let anySwirling = batches.some(b => b.state.swirling);
      if (!anySwirling) {
        plumeSpawnAccum += dt;
        if (plumeSpawnAccum >= plumeSpawnInterval) {
          plumeSpawnAccum = 0;
          // Find first active batch with many settled particles
            for (const b of batches) {
              if (!b.points.visible || b.state.dropping) continue;
              const settled = b.settledFlags;
              if (!settled) continue;
              // Compute approximate centroid of settled particles
              let sx = 0, sz = 0, sc = 0;
              for (let i = 0; i < settled.length; i++) {
                if (settled[i] === 1) {
                  sx += b.positions[i * 3 + 0];
                  sz += b.positions[i * 3 + 2];
                  sc++;
                }
              }
              if (sc < 20) continue; // not enough settled yet
              sx /= sc; sz /= sc;
              const wx = b.points.position.x + sx;
              const wz = b.points.position.z + sz;
              // Muunna centroidi beakerGroupin paikalliseen koordinaatistoon (jolloin rotaatio huomioidaan)
              let lx, lz;
              if (b.state._beakerGroup) {
                const tmpWorld = new THREE.Vector3(wx, b.state.bottomYWorld, wz);
                const local = tmpWorld.clone();
                // worldToLocal muunnos
                b.state._beakerGroup.worldToLocal(local);
                lx = local.x;
                lz = local.z;
              } else {
                // Fallback: pelkkä translatiivinen erotus (aiempi logiikka)
                lx = wx - b.state.beakerCenterWorld.x;
                lz = wz - b.state.beakerCenterWorld.z;
              }
              // Emit a bottom-localized plume at true powder centroid (no added offset)
              // Previous implementation spawned many surface-ish particles via addSource.
              // We now use the unified plume system's bottom injection helper which:
              //  - Temporarily overrides style (blue, slightly denser, indicator-independent)
              //  - Spawns particles in a tight band above the water bottom
              // One call with count=plumePerBurst is enough (spawnParticle adds its own small spread).
              if (diffusion.addBottomSource) {
                // Gate plume emission: if indicator is NOT enabled, skip spawning entirely.
                if (typeof diffusion.isIndicatorEnabled === 'function' && !diffusion.isIndicatorEnabled()) {
                  break; // do not emit plume this burst
                }
                // Convert world coordinates of centroid to beaker-local (diffusion expects local XZ)
                // Dynamic plume color: should match eventual mixed solution color.
                // Simplified logic for BASE powder being added:
                //  - If current solution is acidic (pHScore > 0) choose green (approaching neutralization)
                //  - Otherwise (neutral or already basic) choose blue.
                // If chem state unavailable, fall back to blue.
                let reactionColor = 0x0b3c88; // blue (basic / neutral outcome)
                try {
                  const st = window.currentBeaker && typeof window.currentBeaker.getChemState === 'function'
                    ? window.currentBeaker.getChemState() : null;
                  if (st && typeof st.pHScore === 'number') {
                    if (st.pHScore > 0.15) { // acidic threshold
                      // Use same green as water's uGreenColor default (indicator acid-side transition toward neutral)
                      reactionColor = 0x00b15a;
                    } else {
                      reactionColor = 0x0b3c88; // blue target for base/neutral
                    }
                  }
                } catch {}
                diffusion.addBottomSource(lx, lz, plumePerBurst, {
                  color: reactionColor,
                  // Now respect indicator: do not force visibility when indicator disabled
                  ignoreIndicator: false,
                  saturation: 0.70,
                  opacity: 0.23,
                  brightness: 1.00
                });
              } else {
                // Fallback (shouldn't happen): retain old surface emission path
                for (let k = 0; k < plumePerBurst; k++) {
                  const a = Math.random() * Math.PI * 2; const r = Math.random() * plumeRadiusJitter;
                  diffusion.addSource(wx + Math.cos(a) * r, wz + Math.sin(a) * r, 1);
                }
              }
              break; // only one batch per burst
            }
        }
      } else {
        // Swirling: älä tyhjennä plumea heti, jotta pohjaplume voi häipyä pehmeästi fadeOutBottomPlumes-logiikalla.
        // (Jos haluat edelleen estää uusien pintapilvien kertymisen, spawn gate jo hoitaa sen disableBottomPlumes kautta.)
      }
    }
  }

  return {
    hasPowder,
    clear,
    spawnAt,
    startSwirl,
    stopSwirl,
    update,
  setDiffusionManager,
    // Removed haze-related API methods; keep placeholder for getActiveHazeCount returning 0
    setHazeColor: () => {},
    getActiveHazeCount: () => 0,
    _debugForceSpawn: () => 0,
    // Expose defaults so caller can introspect / tweak
    defaults: {
      verticalSpread: defaultVerticalSpread,
      velocityYRange: defaultVelocityYRange,
      radialJitter: defaultRadialJitter
    }
  };
}

// (Haze auto visibility test removed)

// Optional global exposure helper: if window exists, wrap factory to store last instance
if (typeof window !== 'undefined') {
  const _origCreate = createPowder;
  // Redefine exported function? We cannot re-export easily after declaration, so provide helper
  window.__wrapCreatePowderForDebug = function(scene, opts = {}) {
    const inst = _origCreate(scene, opts);
    window.__powderLast = inst; // always store last
    if (!window.powder) window.powder = inst; // first one becomes window.powder for convenience
    return inst;
  };
  // Usage in app: replace createPowder(...) call with window.__wrapCreatePowderForDebug(...)
}
