import * as THREE from 'three';

// Simple preloader overlay with progress + start button
export function initPreloader(options = {}) {
  const required = new Set(options.required || []);
  const ready = new Set();
  let userClicked = false;

  // Create styles
  const style = document.createElement('style');
  style.textContent = `
    #preloaderOverlay { position:fixed; inset:0; background:linear-gradient(180deg,#f8fafc,#e5e9ef); display:flex; align-items:center; justify-content:center; z-index:9999; }
    .preloader-card { width:min(520px,92vw); border-radius:16px; padding:24px; box-shadow:0 10px 30px rgba(0,0,0,0.12); background:#ffffffcc; backdrop-filter: blur(6px); color:#1f2937; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
    .preloader-title { margin:0 0 8px; font-size:22px; font-weight:700; letter-spacing:0.2px; }
    .preloader-sub { margin:0 0 16px; font-size:14px; color:#4b5563; }
    .preloader-bar { height:10px; background:#e5e7eb; border-radius:999px; overflow:hidden; }
    .preloader-fill { height:100%; width:0%; background:linear-gradient(90deg,#60a5fa,#34d399); transition:width .2s ease; }
    .preloader-row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:10px; }
    .preloader-progress { font-size:13px; color:#374151; }
    .preloader-btn { margin-top:16px; width:100%; padding:10px 14px; font-size:15px; font-weight:600; color:white; background:#111827; border:none; border-radius:10px; cursor:pointer; box-shadow:0 6px 14px rgba(17,24,39,0.18); }
    .preloader-btn[disabled] { opacity:.6; cursor:not-allowed; box-shadow:none; }
    .preloader-hints { margin-top:10px; font-size:12px; color:#6b7280; }
  `;
  document.head.appendChild(style);

  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = 'preloaderOverlay';
  overlay.innerHTML = `
    <div class="preloader-card">
      <h1 class="preloader-title">Laboratoriosimulaatio</h1>
      <p class="preloader-sub">Valmistellaan grafiikoita ja materiaaleja…</p>
      <div class="preloader-bar"><div class="preloader-fill" id="plFill"></div></div>
      <div class="preloader-row">
        <div class="preloader-progress" id="plText">Ladataan…</div>
        <div class="preloader-progress" id="plCount">0%</div>
      </div>
      <button class="preloader-btn" id="plStart" disabled>Aloita simulaatio</button>
      <div class="preloader-hints">Vinkit: R = alusta, G = lisää hapanta kaasua. Voit valita kaasun ja kiinteän aineen valikoista.</div>
    </div>`;
  document.body.appendChild(overlay);

  const fill = overlay.querySelector('#plFill');
  const text = overlay.querySelector('#plText');
  const count = overlay.querySelector('#plCount');
  const startBtn = overlay.querySelector('#plStart');

  // Track loading via default manager so existing loaders report progress
  let total = 0;
  let loaded = 0;
  const mgr = THREE.DefaultLoadingManager;
  const updateUI = () => {
    const pct = total > 0 ? Math.floor((loaded / total) * 100) : (ready.has('assets') ? 100 : 0);
    fill.style.width = pct + '%';
    count.textContent = pct + '%';
    if (total > 0) {
      text.textContent = `Ladattu ${loaded}/${total} resurssia`;
    }
    // Enable start when user can start: all required flags satisfied
    const allReady = Array.from(required).every(k => ready.has(k));
    startBtn.disabled = !allReady;
    if (allReady) {
      text.textContent = 'Valmis. Voit aloittaa simulaation.';
      fill.style.width = '100%';
      count.textContent = '100%';
    }
  };

  mgr.onStart = (_url, _itemsLoaded, itemsTotal) => {
    total = itemsTotal;
    loaded = 0;
    updateUI();
  };
  mgr.onProgress = (_url, itemsLoaded, itemsTotal) => {
    total = itemsTotal;
    loaded = itemsLoaded;
    updateUI();
  };
  mgr.onLoad = () => {
    ready.add('assets');
    updateUI();
  };
  mgr.onError = (url) => {
    text.textContent = `Virhe ladattaessa: ${url}`;
  };

  startBtn.addEventListener('click', () => {
    userClicked = true;
    // If all requirements met, resolve immediately in waitForStart
    checkResolve();
  });

  let resolveStart;
  const waitPromise = new Promise(res => { resolveStart = res; });
  const checkResolve = () => {
    const allReady = Array.from(required).every(k => ready.has(k));
    if (userClicked && allReady && resolveStart) {
      // Fade out overlay
      overlay.style.transition = 'opacity .25s ease';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 260);
      resolveStart();
    }
  };

  return {
    signalReady(name) {
      if (name) ready.add(name);
      updateUI();
      checkResolve();
    },
    waitForStart() { return waitPromise; }
  };
}
