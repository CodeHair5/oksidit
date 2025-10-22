import * as THREE from 'three';

// Animator for hose movements/attachments
// Usage:
//   const hoseAnimator = createHoseAnimator({ hoseEndPointRef, hoseRestingPointRef, updateCallback, beakerNozzle });
//   await hoseAnimator.liftTip(1.0, 200);
//   await hoseAnimator.attachToNozzle();
//   await hoseAnimator.detachToRest();
export function createHoseAnimator({ hoseEndPointRef, hoseRestingPointRef, updateCallback, beakerNozzle }) {
  function tweenEndPoint(to, duration, easing) {
    return new Promise((resolve) => {
      const obj = { y: hoseEndPointRef.y };
      new TWEEN.Tween(obj)
        .to({ y: to }, duration)
        .easing(easing || TWEEN.Easing.Quadratic.Out)
        .onUpdate(() => {
          hoseEndPointRef.y = obj.y;
          if (typeof updateCallback === 'function') updateCallback();
        })
        .onComplete(() => {
          hoseEndPointRef.y = to;
          if (typeof updateCallback === 'function') updateCallback();
          resolve();
        })
        .start();
    });
  }

  async function liftTip(deltaY = 1.0, duration = 200) {
    const targetY = (hoseRestingPointRef?.y ?? 0) + deltaY;
    await tweenEndPoint(targetY, duration, TWEEN.Easing.Quadratic.Out);
  }

  async function attachToNozzle() {
    if (!beakerNozzle) return;
    const world = new THREE.Vector3();
    beakerNozzle.getWorldPosition(world);
    hoseEndPointRef.copy(world);
    if (typeof updateCallback === 'function') updateCallback();
  }

  async function detachToRest() {
    if (hoseRestingPointRef) hoseEndPointRef.copy(hoseRestingPointRef);
    if (typeof updateCallback === 'function') updateCallback();
  }

  return { liftTip, attachToNozzle, detachToRest };
}
