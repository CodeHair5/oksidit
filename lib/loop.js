// Animation loop encapsulation
// Usage:
//   const loop = createLoop({ renderer, scene, camera, updates: [fn...] });
//   loop.start();
import * as THREE from 'three';

export function createLoop({ renderer, scene, camera, updates = [], onPreRender }) {
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    const elapsedTime = clock.elapsedTime;
    try { if (typeof TWEEN !== 'undefined') TWEEN.update(); } catch {}
    for (const fn of updates) {
      try { fn({ deltaTime, elapsedTime }); } catch {}
    }
    if (typeof onPreRender === 'function') {
      try { onPreRender({ deltaTime, elapsedTime }); } catch {}
    }
    renderer.render(scene, camera);
  }
  return {
    start: () => animate()
  };
}
