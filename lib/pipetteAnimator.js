import * as THREE from 'three';
import { runPipetteTransfer } from './pipettePath.js';

// Animator for pipette/dropper related movements
// Usage:
//   const anim = createPipetteAnimator({ scene, dropperBottleGroup, bottleHeight, beakerGroup, beakerHeight, water, waterHeight, meniscus, meniscusUnder, beakerRadius, modelScale, addIndicatorAt, addDiffusionSource, refillPipetteLiquid });
//   await anim.raise();
//   await anim.transfer();
//   await anim.lower();
export function createPipetteAnimator(deps) {
  const {
    scene,
    dropperBottleGroup,
    bottleHeight,
    beakerGroup,
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
  } = deps;

  function getAssembly() {
    return dropperBottleGroup.getObjectByName('pipetteAssembly');
  }

  function tweenTo(target, props, duration, easing) {
    return new Promise((resolve) => {
      new TWEEN.Tween(target).to(props, duration)
        .easing(easing || TWEEN.Easing.Quadratic.InOut)
        .onComplete(resolve)
        .start();
    });
  }

  async function raise() {
    const assembly = getAssembly();
    if (!assembly) return;
    const targetY = bottleHeight + 0.7;
    await tweenTo(assembly.position, { y: targetY }, 300, TWEEN.Easing.Bounce.Out);
  }

  async function lower() {
    const assembly = getAssembly();
    if (!assembly) return;
    await tweenTo(assembly.position, { y: bottleHeight }, 300, TWEEN.Easing.Bounce.Out);
  }

  function transfer() {
    return runPipetteTransfer({
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
    });
  }

  return { raise, lower, transfer };
}
