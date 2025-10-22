// Simple notification helper for unified message handling
// Usage:
//   const notify = createNotifier(document.getElementById('info'));
//   notify.info('Hello');
//   notify.success('Done', { duration: 1500 });
//   notify.error('Oops');
// The notifier debounces repeat messages and supports auto-hide.

export function createNotifier(target) {
  const el = (typeof target === 'string') ? document.querySelector(target) : target;
  let hideTimer = null;
  let lastMsg = '';

  function set(text, opts = {}) {
    if (!el) return;
    const { level = 'info', duration = 0 } = opts;
    if (text === lastMsg && level === el.dataset.level) return; // de-dup
    lastMsg = text;
    el.dataset.level = level;
    el.style.display = text ? 'block' : 'none';
    el.style.opacity = 1;
    el.innerText = text || '';
    // Basic styling by level (inline to avoid CSS dependency)
    const colors = {
      info: '#ffffff',
      success: '#ffffff',
      warn: '#ffe6a8',
      error: '#ffb8b8'
    };
    el.style.color = colors[level] || colors.info;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (duration && duration > 0) {
      hideTimer = setTimeout(() => {
        el.style.opacity = 0;
        // small fade-out
        setTimeout(() => { if (el) { el.style.display = 'none'; el.innerText = ''; } }, 220);
      }, duration);
    }
  }

  return {
    show: (msg, opts) => set(msg, { level: 'info', ...(opts || {}) }),
    info: (msg, opts) => set(msg, { level: 'info', ...(opts || {}) }),
    success: (msg, opts) => set(msg, { level: 'success', ...(opts || {}) }),
    warn: (msg, opts) => set(msg, { level: 'warn', ...(opts || {}) }),
    error: (msg, opts) => set(msg, { level: 'error', ...(opts || {}) }),
    clear: () => set('', { level: 'info' })
  };
}
