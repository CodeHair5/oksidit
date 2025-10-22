// Simple interaction manager to centralize raycasting and click routing
// Usage:
//   const im = createInteractionManager({ scene, camera });
//   im.onName('beakerGroup', (ctx) => { ...; return true; }, { priority: 10 });
//   im.onPredicate(ctx => ctx.hasName('solidSample'), handler, { priority: 20 });
//   im.attach(); // starts listening to window clicks
//   im.dispose(); // removes listeners

import * as THREE from 'three';

export function createInteractionManager({ scene, camera, dom = window } = {}) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const handlers = []; // { predicate, handler, priority }
  let attached = false;

  function _buildContextFromObject(event, object) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    mouse.x = (event.clientX / width) * 2 - 1;
    mouse.y = -(event.clientY / height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = []; // not used in this variant
    const ancestors = [];
    const names = new Set();
    let cur = object;
    while (cur) {
      if (typeof cur.name === 'string' && cur.name.length) {
        names.add(cur.name);
      }
      ancestors.push(cur);
      cur = cur.parent;
    }
    const ctx = {
      event,
      raycaster,
      mouse,
      intersects,
      object,
      ancestors,
      names,
      hasName: (name) => names.has(name),
      firstByName: (name) => ancestors.find(n => n.name === name) || null,
      setInfo: (text) => {
        const el = document.getElementById('info');
        if (el) el.innerText = text;
      }
    };
    return ctx;
  }

  function _dispatchMulti(event, intersects) {
    // Build a candidate list across intersects with priorities
    const candidates = [];
    for (let idx = 0; idx < intersects.length; idx++) {
      const obj = intersects[idx].object;
      const ctx = _buildContextFromObject(event, obj);
      for (const h of handlers) {
        let match = false;
        try { match = h.predicate(ctx); } catch { match = false; }
        if (match) {
          candidates.push({ ctx, handler: h.handler, priority: h.priority || 0, depthIndex: idx });
        }
      }
    }
    // Sort by priority desc, then by depth (prefer closer intersect first on tie)
    candidates.sort((a, b) => (b.priority - a.priority) || (a.depthIndex - b.depthIndex));
    for (const c of candidates) {
      try {
        const res = c.handler(c.ctx);
        if (res === true) return true;
      } catch (e) {
        console.warn('Interaction handler error', e);
      }
    }
    return false;
  }

  function _onClick(event) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    mouse.x = (event.clientX / width) * 2 - 1;
    mouse.y = -(event.clientY / height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    if (!intersects || intersects.length === 0) return;
    _dispatchMulti(event, intersects);
  }

  function onPredicate(predicate, handler, { priority = 0 } = {}) {
    handlers.push({ predicate, handler, priority });
    return () => {
      const idx = handlers.findIndex(h => h.predicate === predicate && h.handler === handler);
      if (idx >= 0) handlers.splice(idx, 1);
    };
  }

  function onName(name, handler, { priority = 0 } = {}) {
    return onPredicate((ctx) => ctx.hasName(name), handler, { priority });
  }

  function attach() {
    if (attached) return;
    dom.addEventListener('click', _onClick);
    attached = true;
  }

  function dispose() {
    if (!attached) return;
    dom.removeEventListener('click', _onClick);
    attached = false;
  }

  return { onPredicate, onName, attach, dispose };
}
