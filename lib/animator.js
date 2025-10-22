// Lightweight animation manager for sequencing and guarding animations
// Usage:
//   const anim = createAnimationManager();
//   anim.run('spatula', () => runSpaatteliSequence(args));
//   // Optionally queue while another runs:
//   anim.run('spatula', next => someOtherAnim().then(next));

export function createAnimationManager() {
  const active = new Map();      // actorKey -> { promise, cancel }
  const queues = new Map();      // actorKey -> [fn]

  function _dequeue(actor) {
    const q = queues.get(actor);
    if (!q || q.length === 0) return;
    const fn = q.shift();
    if (fn) fn();
  }

  function run(actorKey, startFn, { queue = true } = {}) {
    return new Promise((resolve, reject) => {
      const begin = () => {
        try {
          const p = Promise.resolve().then(() => startFn());
          active.set(actorKey, { promise: p });
          p.then((res) => {
            // clear active and run next
            active.delete(actorKey);
            _dequeue(actorKey);
            resolve(res);
          }).catch((err) => {
            active.delete(actorKey);
            _dequeue(actorKey);
            reject(err);
          });
        } catch (e) {
          reject(e);
        }
      };

      if (active.has(actorKey)) {
        if (!queue) return reject(new Error(`Actor '${actorKey}' is busy`));
        const q = queues.get(actorKey) || [];
        q.push(begin);
        queues.set(actorKey, q);
      } else {
        begin();
      }
    });
  }

  function isRunning(actorKey) {
    return active.has(actorKey);
  }

  function clearQueue(actorKey) {
    queues.delete(actorKey);
  }

  return { run, isRunning, clearQueue };
}
