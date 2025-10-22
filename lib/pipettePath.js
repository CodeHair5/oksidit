import * as THREE from 'three';
import { createAndAnimateDrops } from './animation.js';
import { TIP_CLEARANCE_ABOVE_WATER, OBSTACLE_MARGIN, MOVE_UP_MS, MOVE_ACROSS_MS, MOVE_DOWN_MS, RETURN_LOWER_MS } from './constants.js';

// Contract
// Inputs:
// - scene, dropperBottleGroup, beakerGroup
// - bottleHeight, beakerHeight, water, waterHeight, meniscus, meniscusUnder, beakerRadius
// - modelScale, addIndicatorAt
// - refillPipetteLiquid: function(mesh)
// Behavior: Clone pipette assembly, follow safe path (up -> across -> hover drop -> back across -> down),
// trigger drop sequence, then restore original assembly and optionally refill liquid.
export function runPipetteTransfer({
  scene,
  dropperBottleGroup,
  beakerGroup,
  bottleHeight,
  beakerHeight,
  water,
  waterHeight,
  meniscus,
  meniscusUnder,
  beakerRadius,
  modelScale,
  addIndicatorAt,
  addDiffusionSource,
  refillPipetteLiquid
}) {
  return new Promise((resolve) => {
    const assembly = dropperBottleGroup.getObjectByName('pipetteAssembly');
    if (!assembly) return resolve();

    // Hide original and clone with world transform
    assembly.visible = false;
    // Create a clone that shares geometries/materials to avoid heavy allocations
    function cloneWithSharedResources(src) {
      let dst;
      if (src.isMesh) {
        dst = new THREE.Mesh(src.geometry, src.material);
      } else if (src.isGroup) {
        dst = new THREE.Group();
      } else {
        dst = new THREE.Object3D();
      }
      dst.name = src.name;
      dst.position.copy(src.position);
      dst.quaternion.copy(src.quaternion);
      dst.scale.copy(src.scale);
      for (const child of src.children) {
        const clonedChild = cloneWithSharedResources(child);
        dst.add(clonedChild);
      }
      return dst;
    }
    const animatedPipette = cloneWithSharedResources(assembly);
    // Varmista että mahdollinen shadow proxy säilyy ja varjoflagit päälle
    try {
      animatedPipette.traverse(o=>{ if(o.isMesh){
        // Pipetin lasi: jotkut osat depthWrite=false -> shadowmapiin silti castShadow
        if(/pipette|tip|shadowproxy/i.test(o.name)) { o.castShadow = true; }
        o.receiveShadow = false;
      }});
    } catch {}
    animatedPipette.visible = true;
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    assembly.updateWorldMatrix(true, false);
    assembly.matrixWorld.decompose(worldPos, worldQuat, worldScale);
    animatedPipette.position.copy(worldPos);
    animatedPipette.quaternion.copy(worldQuat);
    animatedPipette.scale.copy(worldScale);
    const startPosition = worldPos.clone();
    scene.add(animatedPipette);

    // Compute target position for tip clearance above water
    const beakerWorldPos = new THREE.Vector3();
    beakerGroup.getWorldPosition(beakerWorldPos);
    const tipObjForAim = animatedPipette.getObjectByName('tipEnd') || animatedPipette.getObjectByName('pipetteTip') || animatedPipette.getObjectByName('pipette');
    const tipStart = new THREE.Vector3();
    tipObjForAim.getWorldPosition(tipStart);
    const desiredTipY = water.position.y + waterHeight / 2 + TIP_CLEARANCE_ABOVE_WATER;
    const deltaY = desiredTipY - tipStart.y;
    const targetPosition = new THREE.Vector3(beakerWorldPos.x, startPosition.y + deltaY, beakerWorldPos.z);

    // Clearance planning
    const bottleTopWorldY = dropperBottleGroup.position.y + bottleHeight;
    const beakerTopWorldY = beakerWorldPos.y + beakerHeight;
    const tipOffsetY = tipStart.y - animatedPipette.position.y; // usually negative
    const obstacleTop = Math.max(bottleTopWorldY, beakerTopWorldY, water.position.y + waterHeight / 2 + 0.5);
    const clearanceY = obstacleTop + OBSTACLE_MARGIN - tipOffsetY;

    const moveUpToClearance = new TWEEN.Tween(animatedPipette.position)
      .to({ y: clearanceY }, MOVE_UP_MS)
      .easing(TWEEN.Easing.Cubic.Out);
    const moveAcrossHigh = new TWEEN.Tween(animatedPipette.position)
      .to({ x: beakerWorldPos.x, z: beakerWorldPos.z }, MOVE_ACROSS_MS)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .onComplete(() => {
        // Run drop sequence while hovering
        const liveLiquid = animatedPipette.getObjectByName('pipetteLiquid');
        const originalLiquid = window.pipetteLiquid && window.pipetteLiquid !== liveLiquid ? window.pipetteLiquid : null;
        createAndAnimateDrops({
          scene,
          pipetteObject: animatedPipette,
          water,
          beakerGroup,
          waterHeight,
          beakerRadius,
          meniscus,
          meniscusUnder,
          addIndicatorAt,
          addDiffusionSource,
          modelScale,
          liquidMeshes: [liveLiquid, originalLiquid]
        }).then(() => moveBackHigh.start());
      });

    const moveBackHigh = new TWEEN.Tween(animatedPipette.position)
      .to({ x: startPosition.x, z: startPosition.z }, MOVE_ACROSS_MS)
      .easing(TWEEN.Easing.Quadratic.InOut);
    const lowerHomePos = new TWEEN.Tween(animatedPipette.position)
      .to({ y: startPosition.y }, MOVE_DOWN_MS)
      .easing(TWEEN.Easing.Cubic.In)
      .onComplete(() => {
        // Restore original
        const assemblyLocal = dropperBottleGroup.getObjectByName('pipetteAssembly');
        if (assemblyLocal) assemblyLocal.visible = true;
        scene.remove(animatedPipette);
        // Do not dispose shared resources; they belong to the original assembly
        // Refill pipette in bottle
        if (typeof refillPipetteLiquid === 'function' && window.pipetteLiquid) {
          refillPipetteLiquid(window.pipetteLiquid);
        }
        resolve();
      });

    // Chain moves
    moveUpToClearance.chain(moveAcrossHigh);
    moveBackHigh.chain(lowerHomePos);

    // Start
    // Aja pakotetut shadow flagit ennen animaation alkua jos helper saatavilla
    try { if (window.__refreshShadows) window.__refreshShadows(); } catch {}
    moveUpToClearance.start();
  });
}
