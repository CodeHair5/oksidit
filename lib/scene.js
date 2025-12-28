import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// (Removed RGBELoader: no external env files are loaded)
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createLabLighting } from './lighting.js';
import { enhanceShadows } from './shadowEnhancer.js';

// Centralized scene setup: camera, renderer, controls, lights, background, env map, floor, resize
// Returns { scene, camera, renderer, controls }
export function createScene() {
  const scene = new THREE.Scene();
  // Restored internal canvas gradient background (legacy look for better glass contrast)
  try {
    const cnv = document.createElement('canvas');
    cnv.width = 1024; cnv.height = 512;
    const g = cnv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, cnv.height);
    grad.addColorStop(0.00, '#fafbfc');
    grad.addColorStop(0.55, '#eef1f4');
    grad.addColorStop(1.00, '#dfe4ea');
    g.fillStyle = grad; g.fillRect(0,0,cnv.width,cnv.height);
    const bgTex = new THREE.CanvasTexture(cnv);
    bgTex.needsUpdate = true;
    scene.background = bgTex;
  } catch {}

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 6, 12);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1.0); // opaque clear (scene gradient shows)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Ensure correct output color space for sRGB textures
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.body.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // Layered lab lighting (ambient low + hemisphere + point shadow light + gradient dome)
  const labLights = createLabLighting(scene, renderer, {
    ambientIntensity: 0.14, // hieman enemmän täytettä vaaleampiin varjoihin
    hemiSkyColor: 0xaec6dc,
    hemiGroundColor: 0x30241a,
    hemiIntensity: 0.44, // nostettu hieman
    pointIntensity: 0.55,
    pointHeight: 9.0,
    backgroundTop: '#d2d9df',
    backgroundMid: '#aeb8c0',
    backgroundBottom: '#2d333d',
    strongerShadows: false,
    enableSpotLight: false,
    enableDirectional: false,
    disablePointLight: false,
    mood: 'default'
  });

  // Lisätään erikseen hyvin pehmeä, matala-intensiteettinen directional varjoihin ilman hotspotia
  try {
  const softDir = new THREE.DirectionalLight(0xffffff, 0.30);
  // Reposition: keskitetty katsojan (kameran) suuntaan niin että varjot menevät poispäin käyttäjästä.
  // Kamera ~ (0,6,12) katsomassa origoa -> asetetaan valo hieman kameran ylä-/etualueelle.
  // Vanha sijainti (6.4, 6.6, -5.4) -> uusi (0, 7.2, 13.0)
  softDir.position.set(0, 7.2, 13.0);
    softDir.castShadow = true;
    softDir.shadow.mapSize.set(1024,1024);
    softDir.shadow.camera.near = 0.5;
    softDir.shadow.camera.far = 40;
    softDir.shadow.camera.left = -15;
    softDir.shadow.camera.right = 15;
    softDir.shadow.camera.top = 15;
    softDir.shadow.camera.bottom = -15;
    // Hieman pienempi negatiivinen bias + suurempi normalBias pehmeämpiin varjojen reunoihin
    softDir.shadow.bias = -0.00009;
    softDir.shadow.normalBias = 0.06; // kasvatettu -> vähentää akuutteja kovia reunoja
    scene.add(softDir);
  } catch {}

  // Pieni hienosäätö beakeriin: lisätään varmuuden vuoksi hiukan roughnessia jos liian kirkas
  try {
    const g = scene.getObjectByName('beakerGroup');
    if (g) {
      g.traverse(m=>{
        if(m.isMesh && /beaker$/i.test(m.name) && m.material){
          if (m.material.roughness < 0.065) { m.material.roughness = 0.065; m.material.needsUpdate = true; }
          if (m.material.specularIntensity > 0.5) { m.material.specularIntensity = 0.5; m.material.needsUpdate = true; }
        }
      });
    }
  } catch {}

  // Environment map: no file/network loads — use RoomEnvironment via PMREM
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envRT = pmrem.fromScene(room);
    scene.environment = envRT.texture;
    enhanceShadows(scene, { envMapIntensity: 0.20, glassNames: ['beakerGlass','solidJarGlass'] });
    try { pmrem.dispose(); } catch {}
  } catch {}

  // Floor (wood)
  try {
    const floorGeometry = new THREE.PlaneGeometry(30, 30);
    const texLoader = new THREE.TextureLoader();
    const repeatConfig = (t) => { if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); t.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 8; } };
    let woodColor, woodRough, woodBump;
    woodColor = texLoader.load(
      'https://threejs.org/examples/textures/hardwood2_diffuse.jpg',
      (t)=>repeatConfig(t),
      undefined,
      ()=>{ // fallback: simple flat color texture
        const c = document.createElement('canvas'); c.width=c.height=4; const g=c.getContext('2d'); g.fillStyle='#b28a5a'; g.fillRect(0,0,4,4); woodColor = new THREE.CanvasTexture(c); repeatConfig(woodColor);
      }
    );
    woodRough = texLoader.load(
      'https://threejs.org/examples/textures/hardwood2_roughness.jpg',
      (t)=>repeatConfig(t),
      undefined,
      ()=>{ 
        // Fallback procedural roughness texture (mid-frequency noise)
        const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
        for(let y=0;y<32;y++){ for(let x=0;x<32;x++){ const n = (Math.sin(x*0.7)+Math.sin(y*0.6))*0.5 + 0.5; const v = Math.floor(140 + 80*n); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x,y,1,1);} }
        woodRough = new THREE.CanvasTexture(c); repeatConfig(woodRough);
      }
    );
    woodBump = texLoader.load(
      'https://threejs.org/examples/textures/hardwood2_bump.jpg',
      (t)=>repeatConfig(t),
      undefined,
      ()=>{ woodBump = null; }
    );
    const floorMaterial = new THREE.MeshStandardMaterial({
      map: woodColor,
      roughnessMap: woodRough || undefined,
      bumpMap: woodBump || undefined,
      bumpScale: woodBump ? 0.03 : 0.0,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    // Shadow catcher (vahvistaa varjojen kontrastia erottamalla varjon materiaalista)
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(30,30), new THREE.ShadowMaterial({ opacity: 0.18 })); // hieman vaaleampi varjopohja pehmennystä varten
    shadowCatcher.rotation.x = -Math.PI/2;
    shadowCatcher.position.y = 0.001; // aivan lattian yläpuolelle välttämään z-fighting
    shadowCatcher.receiveShadow = true;
    shadowCatcher.name = 'shadowCatcher';
    scene.add(shadowCatcher);
  } catch {}

  // Resize handler
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  // Pakotettu varjojen aktivointi: käy läpi objektit kun ensimmäinen renderöinti on todennäköisesti valmis
  function forceShadowFlags() {
    scene.traverse(obj => {
      if (obj.isMesh) {
        // Älä pakota lasin varjoa jos nimi viittaa lasiin
        const name = (obj.name || '').toLowerCase();
        const isGlass = /glass|beaker/.test(name); // pipette saa nyt varjon
        obj.receiveShadow = true;
        if (!isGlass) obj.castShadow = true; else obj.castShadow = false;
      }
    });
    // Tarkennetaan spotin shadowcamera jos spot on käytössä
    try {
      const spot = (scene.children.find(c => c.isSpotLight));
      if (spot) {
        spot.shadow.mapSize.set(2048,2048);
        spot.shadow.camera.near = 2;
        spot.shadow.camera.far = 60;
        spot.shadow.bias = -0.00018;
        spot.shadow.normalBias = 0.012;
        spot.updateMatrixWorld();
      }
      // Option: siirrä pointLight pois varjolaskennasta selkeämmän suunnatun varjon saamiseksi
      const point = scene.children.find(c => c.isPointLight);
      if (point) {
        // Voit kommentoida tämän pois jos haluat myös point-varjot
        point.castShadow = false;
      }
    } catch {}
  }

  // Tee useampi yritys (myöhään ilmestyvien objektien varalta)
  setTimeout(forceShadowFlags, 300);
  setTimeout(forceShadowFlags, 1200);
  setTimeout(forceShadowFlags, 3000);
  // Lisätään vielä myöhäinen pass (esim. mallin lataus viivästyy, pipetti ilmestyy myöhemmin)
  setTimeout(forceShadowFlags, 6000);

  // Debug helper nopeaan varjojen uudelleenpakottamiseen ja beaker-hotspotin testaamiseen
  if (typeof window !== 'undefined') {
    window.__refreshShadows = () => forceShadowFlags();
    window.__toggleBeakerRoughness = () => {
      const beaker = scene.getObjectByName('beakerGroup');
      if (!beaker) return;
      beaker.traverse(m=>{
        if (m.isMesh && /beaker/i.test(m.name) && m.material && m.material.roughness !== undefined) {
          m.material.roughness = (m.material.roughness < 0.12) ? 0.18 : 0.06;
          m.material.needsUpdate = true;
          console.log('Beaker roughness now', m.material.roughness);
        }
      });
    };
  }

  // Ympäristömapin on/off debug helper (varjojen kontrastin vertailuun)
  if (typeof window !== 'undefined') {
    window.__toggleEnv = () => {
      if (scene.environment) { window.__savedEnv = scene.environment; scene.environment = null; } else { scene.environment = window.__savedEnv || null; }
    };
    window.__shadowDebug = () => {
      const dir = scene.children.find(o=>o.isDirectionalLight);
      const spot = scene.children.find(o=>o.isSpotLight);
      console.log('Directional:',dir); console.log('Spot:',spot);
      scene.traverse(o=>{ if(o.isMesh && (o.castShadow||o.receiveShadow)) console.log(o.name, 'cast:',o.castShadow,'recv:',o.receiveShadow); });
    };
    // Water surface debug helpers
    window.__waterTint = (hex,strength) => { try { const w = scene.getObjectByName('unifiedWater'); if(!w) return; const u=w.material.uniforms; u.uSurfaceTint.value.setHex(hex); if(strength!==undefined) u.uSurfaceTintStrength.value=strength; console.log('water tint set',hex,strength);} catch(e){console.warn(e);} };
    window.__waterGloss = (amp,power) => { const w=scene.getObjectByName('unifiedWater'); if(!w) return; const u=w.material.uniforms; if(amp!==undefined) u.uSurfaceGloss.value=amp; if(power!==undefined) u.uSurfaceGlossPower.value=power; console.log('water gloss',u.uSurfaceGloss.value,u.uSurfaceGlossPower.value); };
    window.__waterFresnel = (boost) => { const w=scene.getObjectByName('unifiedWater'); if(!w) return; w.material.uniforms.uSurfaceFresnelBoost.value=boost; console.log('water fresnel boost',boost); };
    window.__waterEdge = (vign, darkening) => { const w=scene.getObjectByName('unifiedWater'); if(!w) return; const u=w.material.uniforms; if(vign!==undefined) u.uEdgeVignette.value=vign; if(darkening!==undefined) u.uEdgeDarkening.value=darkening; console.log('water edge vignette/dark',u.uEdgeVignette.value,u.uEdgeDarkening.value); };
    window.__waterDepthSat = (s) => { const w=scene.getObjectByName('unifiedWater'); if(!w) return; w.material.uniforms.uDepthSaturation.value=s; console.log('water depth saturation',s); };
  // Directional light adjustment helpers (bright ellipse mitigation)
  window.__lightIntensity = (v)=>{ const d=scene.children.find(o=>o.isDirectionalLight); if(d){ d.intensity=v; console.log('dir.intensity=',v);} };
  window.__lightDir = (x,y,z)=>{ const d=scene.children.find(o=>o.isDirectionalLight); if(d){ d.position.set(x,y,z); d.target?.updateMatrixWorld(); console.log('dir.pos=',d.position.toArray()); } };
  window.__ellipsePreset = ()=>{ const d=scene.children.find(o=>o.isDirectionalLight); if(!d) return; d.intensity=1.25; d.position.set(3.2,15.2,3.5); console.log('Applied ellipse reduction preset'); };
    window.__beakerRoughness = (r) => {
      const g = scene.getObjectByName('beakerGroup'); if(!g) return;
      g.traverse(m=>{ if(m.isMesh && /beaker$/i.test(m.name) && m.material && m.material.roughness!==undefined){ m.material.roughness = r; m.material.needsUpdate=true; console.log('beaker roughness ->',r);} });
    };
    window.__beakerIOR = (v) => {
      const g = scene.getObjectByName('beakerGroup'); if(!g) return;
      g.traverse(m=>{ if(m.isMesh && /beaker$/i.test(m.name) && m.material && m.material.ior!==undefined){ m.material.ior = v; m.material.needsUpdate=true; console.log('beaker ior ->',v);} });
    };
    window.__toggleBeakerInner = () => {
      const g = scene.getObjectByName('beakerGroup'); if(!g) return;
      const inner = g.getObjectByName('beakerInnerDulling'); if(!inner) return;
      inner.visible = !inner.visible; console.log('inner shell visible:', inner.visible);
    };
    window.__shadowLevel = (f=1.0) => {
      // Skaalaa nopeasti varjojen kontrastia: pienempi f -> vaaleammat varjot
      const dir = scene.children.find(o=>o.isDirectionalLight);
      if (dir) dir.intensity = 1.45 * f;
      const amb = scene.children.find(o=>o.isAmbientLight); if(amb) amb.intensity = 0.14 * (0.85 + 0.35*(1-f));
      const hemi = scene.children.find(o=>o.isHemisphereLight); if(hemi) hemi.intensity = 0.44 * (0.9 + 0.4*(1-f));
      const sc = scene.getObjectByName('shadowCatcher'); if(sc && sc.material && sc.material.opacity!==undefined) sc.material.opacity = 0.22 * (0.6 + 0.4*f);
      console.log('Shadow level adjusted (f=',f,')');
    };
    window.__boostShadows = () => {
      const dir = scene.children.find(o=>o.isDirectionalLight); if(dir){ dir.intensity = 3.2; dir.shadow.bias = -0.00008; dir.shadow.normalBias = 0.006; }
      const spot = scene.children.find(o=>o.isSpotLight); if(spot){ spot.intensity = 3.0; }
      enhanceShadows(scene, { envMapIntensity: 0.10, glassNames: ['beakerGlass','pipetteGlass','solidJarGlass'] });
    };

    // --- Hotspot suppression toggle ---
    let __hotspotState = null;
    window.__hotspotSuppress = (on=true, opts={}) => {
      const dir = scene.children.find(o=>o.isDirectionalLight);
      const beakerGroup = scene.getObjectByName('beakerGroup');
      if (on) {
        if (!__hotspotState) {
          const beakerMesh = (()=>{ let found=null; beakerGroup?.traverse(m=>{ if(!found && m.isMesh && /beaker$/i.test(m.name)) found=m; }); return found; })();
          __hotspotState = {
            dirPos: dir ? dir.position.clone() : null,
            dirIntensity: dir ? dir.intensity : null,
            beakerParams: beakerMesh && beakerMesh.material ? {
              roughness: beakerMesh.material.roughness,
              specularIntensity: beakerMesh.material.specularIntensity,
              transmission: beakerMesh.material.transmission,
              envMapIntensity: beakerMesh.material.envMapIntensity
            } : null
          };
        }
        if (dir) {
          const targetPos = opts.lightPos || new THREE.Vector3(5.2, 17.5, 6.8);
          dir.position.copy(targetPos);
          dir.intensity = (opts.lightIntensity !== undefined) ? opts.lightIntensity : 1.10;
          dir.target?.updateMatrixWorld();
        }
        if (beakerGroup) {
          beakerGroup.traverse(m=>{
            if (m.isMesh && /beaker$/i.test(m.name) && m.material) {
              if (m.material.roughness !== undefined) m.material.roughness = (opts.beakerRoughness !== undefined) ? opts.beakerRoughness : Math.max(m.material.roughness, 0.09);
              if (m.material.specularIntensity !== undefined) m.material.specularIntensity = (opts.specular !== undefined) ? opts.specular : 0.30;
              if (m.material.transmission !== undefined && opts.reduceTransmission) m.material.transmission = Math.min(m.material.transmission, 0.94);
              if (m.material.envMapIntensity !== undefined && opts.scaleEnv !== false) m.material.envMapIntensity = Math.min(m.material.envMapIntensity, 0.52);
              m.material.needsUpdate = true;
            }
          });
        }
        console.log('[Hotspot] suppression ON');
      } else {
        if (!__hotspotState) { console.log('[Hotspot] no stored state'); return; }
        const beakerMesh = (()=>{ let found=null; beakerGroup?.traverse(m=>{ if(!found && m.isMesh && /beaker$/i.test(m.name)) found=m; }); return found; })();
        if (dir && __hotspotState.dirPos) dir.position.copy(__hotspotState.dirPos);
        if (dir && __hotspotState.dirIntensity!=null) dir.intensity = __hotspotState.dirIntensity;
        if (beakerMesh && beakerMesh.material && __hotspotState.beakerParams) {
          const bp = __hotspotState.beakerParams;
          if (beakerMesh.material.roughness !== undefined) beakerMesh.material.roughness = bp.roughness;
          if (beakerMesh.material.specularIntensity !== undefined) beakerMesh.material.specularIntensity = bp.specularIntensity;
          if (beakerMesh.material.transmission !== undefined) beakerMesh.material.transmission = bp.transmission;
          if (beakerMesh.material.envMapIntensity !== undefined) beakerMesh.material.envMapIntensity = bp.envMapIntensity;
          beakerMesh.material.needsUpdate = true;
        }
        console.log('[Hotspot] suppression OFF (restored)');
      }

      // --- Lighting profile toggle (softClassic vs dramatic) ---
      (function(){
        let stored = null;
        function captureState(){
          const dir = scene.children.find(o=>o.isDirectionalLight);
          const amb = scene.children.find(o=>o.isAmbientLight);
          const hemi = scene.children.find(o=>o.isHemisphereLight);
          const spot = scene.children.find(o=>o.isSpotLight);
          const sc = scene.getObjectByName('shadowCatcher');
          stored = {
            dirPos: dir?dir.position.clone():null,
              dirIntensity: dir?dir.intensity:null,
              ambient: amb?amb.intensity:null,
              hemi: hemi?hemi.intensity:null,
              spotIntensity: spot?spot.intensity:null,
              exposure: renderer.toneMappingExposure,
              shadowOpacity: sc && sc.material? sc.material.opacity : null
          };
        }
        function applySoftClassic(){
          const dir = scene.children.find(o=>o.isDirectionalLight);
          const amb = scene.children.find(o=>o.isAmbientLight);
          const hemi = scene.children.find(o=>o.isHemisphereLight);
          const spot = scene.children.find(o=>o.isSpotLight);
          const sc = scene.getObjectByName('shadowCatcher');
          // Softer: more fill, less directional specular driver, higher angle to reduce ellipse
          if(dir){ dir.intensity = 0.85; dir.position.set(6.5,18.5,7.2); dir.shadow.bias = -0.00008; dir.shadow.normalBias = 0.024; }
          if(amb){ amb.intensity = 0.32; }
          if(hemi){ hemi.intensity = 0.62; }
          if(spot){ spot.intensity = 1.35; }
          if(sc && sc.material){ sc.material.opacity = 0.18; }
          renderer.toneMappingExposure = 0.95;
          // Slight glass mellow (do not overwrite hotspotSuppress stored state) – just scale envMap for glass objects
          const glassNames = ['beakerGlass','solidJarGlass','pipetteGlass'];
          scene.traverse(o=>{ if(o.isMesh && glassNames.includes(o.name) && o.material && o.material.envMapIntensity!==undefined){ o.material.envMapIntensity = Math.min(o.material.envMapIntensity,0.55); } });
        }
        function applyDramatic(){
          const dir = scene.children.find(o=>o.isDirectionalLight);
          const amb = scene.children.find(o=>o.isAmbientLight);
          const hemi = scene.children.find(o=>o.isHemisphereLight);
          const spot = scene.children.find(o=>o.isSpotLight);
          const sc = scene.getObjectByName('shadowCatcher');
          if(dir && stored?.dirPos){ dir.position.copy(stored.dirPos); }
          if(dir && stored?.dirIntensity!=null) dir.intensity = stored.dirIntensity;
          if(amb && stored?.ambient!=null) amb.intensity = stored.ambient;
          if(hemi && stored?.hemi!=null) hemi.intensity = stored.hemi;
          if(spot && stored?.spotIntensity!=null) spot.intensity = stored.spotIntensity;
          if(sc && sc.material && stored?.shadowOpacity!=null) sc.material.opacity = stored.shadowOpacity;
          if(stored?.exposure!=null) renderer.toneMappingExposure = stored.exposure;
        }
        window.__lightingProfile = (mode) => {
          if(!stored) captureState();
          if(mode === 'softClassic') { applySoftClassic(); console.log('[LightingProfile] softClassic applied'); }
          else if(mode === 'dramatic') { applyDramatic(); console.log('[LightingProfile] dramatic restored'); }
          else { console.log('Unknown profile, use softClassic | dramatic'); }
        };
      })();

      // --- Beaker glass material profile toggle ---
      (function(){
        let originalBright = null;
        function findBeaker(){
          const g = scene.getObjectByName('beakerGroup'); if(!g) return null;
          let mesh=null; g.traverse(m=>{ if(!mesh && m.isMesh && /beaker$/i.test(m.name)) mesh=m; });
          return mesh;
        }
        function findInner(){
          const g = scene.getObjectByName('beakerGroup'); if(!g) return null; return g.getObjectByName('beakerInnerDulling');
        }
        window.__beakerGlassProfile = (mode='legacySoft', opts={}) => {
          const mesh = findBeaker(); if(!mesh){ console.log('No beaker mesh'); return; }
          const mat = mesh.material; if(!mat){ console.log('Beaker has no material'); return; }
          const inner = findInner();
          if(!originalBright){
            originalBright = {
              roughness: mat.roughness,
              specularIntensity: mat.specularIntensity,
              envMapIntensity: mat.envMapIntensity,
              transmission: mat.transmission,
              ior: mat.ior,
              thickness: mat.thickness,
              clearcoat: mat.clearcoat,
              clearcoatRoughness: mat.clearcoatRoughness,
              innerVisible: inner?inner.visible:false,
              innerParams: inner && inner.material ? {
                roughness: inner.material.roughness,
                opacity: inner.material.opacity
              }:null
            };
          }
          if(mode==='legacySoft') {
            // Softer, diffused: spread specular, lower env, optional inner diffuser ON
              if(mat.roughness!==undefined) mat.roughness = opts.roughness ?? 0.12;
              if(mat.specularIntensity!==undefined) mat.specularIntensity = opts.specularIntensity ?? 0.30;
              if(mat.envMapIntensity!==undefined) mat.envMapIntensity = opts.envMapIntensity ?? 0.38;
              if(mat.transmission!==undefined) mat.transmission = opts.transmission ?? 0.95;
              if(mat.ior!==undefined) mat.ior = opts.ior ?? 1.45;
              if(mat.thickness!==undefined) mat.thickness = opts.thickness ?? 0.08;
              if(mat.clearcoat!==undefined) mat.clearcoat = opts.clearcoat ?? 0.12;
              if(mat.clearcoatRoughness!==undefined) mat.clearcoatRoughness = opts.clearcoatRoughness ?? 0.90;
              if(inner){
                inner.visible = true;
                if(inner.material){
                  if(inner.material.roughness!==undefined) inner.material.roughness = 0.85;
                  if(inner.material.opacity!==undefined) inner.material.opacity = 0.15;
                  inner.material.needsUpdate = true;
                }
              }
              mat.needsUpdate = true;
              console.log('[BeakerGlassProfile] legacySoft applied');
          } else if(mode==='brightCurrent') {
              // Restore stored original bright (initial) values
              if(originalBright){
                if(mat.roughness!==undefined && originalBright.roughness!=null) mat.roughness = originalBright.roughness;
                if(mat.specularIntensity!==undefined && originalBright.specularIntensity!=null) mat.specularIntensity = originalBright.specularIntensity;
                if(mat.envMapIntensity!==undefined && originalBright.envMapIntensity!=null) mat.envMapIntensity = originalBright.envMapIntensity;
                if(mat.transmission!==undefined && originalBright.transmission!=null) mat.transmission = originalBright.transmission;
                if(mat.ior!==undefined && originalBright.ior!=null) mat.ior = originalBright.ior;
                if(mat.thickness!==undefined && originalBright.thickness!=null) mat.thickness = originalBright.thickness;
                if(mat.clearcoat!==undefined && originalBright.clearcoat!=null) mat.clearcoat = originalBright.clearcoat;
                if(mat.clearcoatRoughness!==undefined && originalBright.clearcoatRoughness!=null) mat.clearcoatRoughness = originalBright.clearcoatRoughness;
                if(inner){
                  inner.visible = originalBright.innerVisible;
                  if(inner.material && originalBright.innerParams){
                    if(inner.material.roughness!==undefined) inner.material.roughness = originalBright.innerParams.roughness;
                    if(inner.material.opacity!==undefined) inner.material.opacity = originalBright.innerParams.opacity;
                    inner.material.needsUpdate = true;
                  }
                }
                mat.needsUpdate = true;
                console.log('[BeakerGlassProfile] brightCurrent restored');
              } else {
                console.log('No stored original state; call legacySoft first to capture.');
              }
          } else {
            console.log('Unknown beakerGlassProfile mode. Use legacySoft | brightCurrent');
          }
        };
      })();
    };

  }

  return { scene, camera, renderer, controls };
}
