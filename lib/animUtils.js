// Generic tween helpers returning Promises
// Requires TWEEN (tween.js) to be loaded in the global scope

export function tweenTo(object, props, duration, easing) {
  return new Promise((resolve) => {
    new TWEEN.Tween(object)
      .to(props, duration)
      .easing(easing || TWEEN.Easing.Quadratic.InOut)
      .onComplete(resolve)
      .start();
  });
}

export function tweenQuatTo(objectWithQuat, targetQuat, duration, easing) {
  return new Promise((resolve) => {
    const qStart = objectWithQuat.quaternion.clone();
    const tmp = { t: 0 };
    new TWEEN.Tween(tmp)
      .to({ t: 1 }, duration)
      .easing(easing || TWEEN.Easing.Quadratic.InOut)
      .onUpdate(() => {
        objectWithQuat.quaternion.copy(qStart).slerp(targetQuat, tmp.t);
        if (typeof objectWithQuat.updateMatrixWorld === 'function') {
          objectWithQuat.updateMatrixWorld(true);
        }
      })
      .onComplete(resolve)
      .start();
  });
}

export function tweenNumber(from, to, duration, easing, onUpdate) {
  return new Promise((resolve) => {
    const obj = { value: from };
    new TWEEN.Tween(obj)
      .to({ value: to }, duration)
      .easing(easing || TWEEN.Easing.Quadratic.InOut)
      .onUpdate(() => { if (onUpdate) onUpdate(obj.value); })
      .onComplete(resolve)
      .start();
  });
}
