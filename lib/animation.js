import * as THREE from 'three';
import { createDropMaterial } from './materials.js';
// Legacy triggerRipplesAt removed – unified water provides userData.triggerRipple
import { DROP_COUNT, DROP_INTERVAL_MS } from './constants.js';

// Create and animate drops from a pipette tip to the beaker water surface.
// Relies on TWEEN being present globally (as in index.html setup).
export function createAndAnimateDrops({
  scene,
  pipetteObject,
  water,
  beakerGroup,
  waterHeight,
  beakerRadius,
  // meniscus / meniscusUnder ignored (legacy) but kept optional for backwards compatibility
  meniscus = null,
  meniscusUnder = null,
  addIndicatorAt,
  addDiffusionSource,
  modelScale = 0.25,
  liquidMeshes = []
}) {
  const tipObj = pipetteObject.getObjectByName('tipEnd')
    || pipetteObject.getObjectByName('pipetteTip')
    || pipetteObject.getObjectByName('pipette');
  const startPos = new THREE.Vector3();
  tipObj.getWorldPosition(startPos);

  const dropRadius = modelScale * 0.15;
  // Reuse geometry and material across all drops to reduce allocations
  const dropGeo = new THREE.SphereGeometry(dropRadius, 24, 24);
  const dropMat = createDropMaterial(0x004d00);

  // Animate liquid meshes (live clone + original in bottle) shrinking
  const duration = 1500;
  const liveLiquid = liquidMeshes[0] || null;
  const originalLiquid = liquidMeshes[1] || null;
  const liquidHeight = (liveLiquid && liveLiquid.geometry && liveLiquid.geometry.parameters.height) ? liveLiquid.geometry.parameters.height : 1.0;

  const runLiquidTween = (mesh) => {
    if (!mesh) return null;
    const baseY = typeof mesh.userData.baseY === 'number' ? mesh.userData.baseY : mesh.position.y;
    return new TWEEN.Tween({ s: 1, y: baseY })
      .to({ s: 0.05, y: baseY - liquidHeight / 2 }, duration)
      .easing(TWEEN.Easing.Linear.None)
      .onUpdate((o) => { mesh.scale.y = o.s; mesh.position.y = o.y; });
  };

  const t1 = runLiquidTween(liveLiquid);
  const t2 = runLiquidTween(originalLiquid);

  let finishedTweens = 0;
  const liquidDone = new Promise((resolve) => {
    const mark = () => { finishedTweens++; if ((t1 && t2 && finishedTweens === 2) || (t1 && !t2 && finishedTweens === 1) || (!t1 && !t2)) resolve(); };
    if (t1) t1.onComplete(mark).start(); else mark();
    if (t2) t2.onComplete(mark).start(); else {}
  });

  // schedule drops
  const dropsDone = new Promise((resolve) => {
    let made = 0;
    const makeOne = () => {
  const drop = new THREE.Mesh(dropGeo, dropMat);
      drop.position.copy(startPos);
      drop.position.x += (Math.random() - 0.5) * 0.05;
      drop.position.z += (Math.random() - 0.5) * 0.05;
      scene.add(drop);

      // Stretch & sway fall
      new TWEEN.Tween(drop.scale)
        .to({ y: 1.25, x: 0.88, z: 0.88 }, 180)
        .easing(TWEEN.Easing.Quadratic.Out)
        .yoyo(true)
        .repeat(1)
        .start();

      const targetY = water.position.y + waterHeight / 2;
      const yDist = Math.max(0.1, drop.position.y - targetY);
      const durationFall = Math.min(1300, Math.max(450, 180 * yDist));
      const baseX = drop.position.x;
      const baseZ = drop.position.z;
      const swayAmp = 0.02 + Math.random() * 0.03;
      const swayFreq = 2 + Math.random() * 2;
      const phase = Math.random() * Math.PI * 2;
      const tState = { t: 0 };

      new TWEEN.Tween(tState)
        .to({ t: 1 }, durationFall)
        .easing(TWEEN.Easing.Quadratic.In)
        .onUpdate(() => {
          drop.position.y = startPos.y + (targetY - startPos.y) * tState.t;
          const timeS = performance.now() / 1000.0;
          drop.position.x = baseX + Math.sin(timeS * swayFreq + phase) * swayAmp;
          drop.position.z = baseZ + Math.cos(timeS * (swayFreq * 0.9) + phase * 0.7) * swayAmp;
        })
        .onComplete(() => {
          // Unified ripple trigger
          try {
            if (water && water.userData && typeof water.userData.triggerRipple === 'function') {
              water.userData.triggerRipple(drop.position.clone());
            }
          } catch {}
          // Compute local beaker coordinates for indicator & diffusion
          try {
            if (beakerGroup) {
              const localHit = drop.position.clone();
              beakerGroup.worldToLocal(localHit);
              if (typeof addIndicatorAt === 'function') addIndicatorAt(localHit.x, localHit.z);
              if (typeof addDiffusionSource === 'function') addDiffusionSource(localHit.x, localHit.z);
            }
          } catch {}
          scene.remove(drop);
          made++;
          if (made >= DROP_COUNT) {
            // Dispose shared assets after the last drop finishes
            dropGeo.dispose();
            dropMat.dispose();
            resolve();
          }
        })
        .start();
    };

    makeOne();
    setTimeout(makeOne, DROP_INTERVAL_MS);
    setTimeout(makeOne, DROP_INTERVAL_MS * 2);
  });

  return Promise.all([dropsDone, liquidDone]);
}
