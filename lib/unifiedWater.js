import * as THREE from 'three';

// Unified water mesh: volume side + top cap in one geometry.
// aCapFlag (1 = top surface vertex, 0 = side) → ripple displacement & fresnel only on cap.
// (Refactored) Removed turbidity/scatter/extra alpha so look matches root water (almost clear with indicator tint).
export function createUnifiedWater({ radius, height, radialSegments = 64, capRings = 40, indicatorTex, diffusionUniformProxy }) {
  const halfHeight = height / 2;
  // Build cylinder side (open top/bottom).
  const sideGeo = new THREE.CylinderGeometry(radius, radius, height, radialSegments, 1, true);
  sideGeo.rotateY(Math.PI); // optional orientation normalization

  // Build top cap as high-resolution polar grid (improves ripple detail vs single fan)
  const capPositions = [];
  const capNormals = [];
  // center to edge rings
  for (let r = 0; r <= capRings; r++) {
    const frac = r / capRings;
    const rad = frac * radius;
    for (let s = 0; s <= radialSegments; s++) {
      const theta = (s / radialSegments) * Math.PI * 2;
      const x = Math.cos(theta) * rad;
      const z = Math.sin(theta) * rad;
      capPositions.push(x, halfHeight, z);
      capNormals.push(0, 1, 0);
    }
  }
  // indices for quad strips
  const capIndices = [];
  const ringStride = radialSegments + 1;
  for (let r = 0; r < capRings; r++) {
    for (let s = 0; s < radialSegments; s++) {
      const i0 = r * ringStride + s;
      const i1 = i0 + 1;
      const i2 = i0 + ringStride;
      const i3 = i2 + 1;
  // two triangles (winding korjattu myötäpäivästä vastapäivään ylhäältä katsottuna)
  // Alkuperäinen järjestys (i0,i2,i1) käänsi normaalin mahdollisesti alaspäin kun yhdistetty computeVertexNormals tehtiin.
  // Muutetaan winding: (i0,i1,i2) ja (i2,i1,i3) -> varmistaa että yläpinnan normaalit osoittavat ylöspäin FrontSide cullingille.
  capIndices.push(i0, i1, i2);
  capIndices.push(i2, i1, i3);
    }
  }

  // Merge into one BufferGeometry
  const unified = new THREE.BufferGeometry();
  // Collect attributes
  const sidePos = sideGeo.attributes.position.array;
  const sideNorm = sideGeo.attributes.normal.array;
  const capPos = new Float32Array(capPositions);
  const capNorm = new Float32Array(capNormals);
  const sideCount = sideGeo.attributes.position.count;
  const capCount = capPositions.length / 3;

  const totalCount = sideCount + capCount;
  const positions = new Float32Array(totalCount * 3);
  const normals = new Float32Array(totalCount * 3);
  const aCapFlag = new Float32Array(totalCount);

  positions.set(sidePos, 0);
  normals.set(sideNorm, 0);
  for (let i = 0; i < sideCount; i++) aCapFlag[i] = 0;
  positions.set(capPos, sidePos.length);
  normals.set(capNorm, sideNorm.length);
  for (let i = 0; i < capCount; i++) aCapFlag[sideCount + i] = 1;

  unified.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  unified.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  unified.setAttribute('aCapFlag', new THREE.BufferAttribute(aCapFlag, 1));

  // Indices: reuse existing then shift cap indices.
  // sideGeo is indexed; capGeo is indexed. We'll merge indices referencing combined vertex buffer.
  const sideIndex = sideGeo.index ? sideGeo.index.array : null;
  const capIndex = capIndices;
  let indices = [];
  if (sideIndex) {
    indices = indices.concat(Array.from(sideIndex));
  } else {
    for (let i = 0; i < sideCount; i++) indices.push(i);
  }
  if (capIndex) {
    for (let i = 0; i < capIndex.length; i++) indices.push(capIndex[i] + sideCount);
  } else {
    for (let i = 0; i < capCount; i++) indices.push(sideCount + i);
  }
  unified.setIndex(indices);
  unified.computeVertexNormals();

  // --- Edge ring normal blending (side ↔ top) to reduce brightness discontinuity
  (function blendEdgeRingNormals(){
    const posAttr = unified.getAttribute('position');
    const normAttr = unified.getAttribute('normal');
    if (!posAttr || !normAttr) return;
    // Build lookup for cap outer ring: it's the last ring in cap grid (r = capRings)
    const ringStride = radialSegments + 1;
    const capOuterStart = sideCount + (capRings * ringStride); // first vertex of outer ring
    // Side top ring: vertices with y ~ +halfHeight (within small epsilon) in side section
    const sideIndicesTop = [];
    for (let i=0;i<sideCount;i++){
      const y = posAttr.getY(i);
      if (Math.abs(y - halfHeight) < 1e-4) sideIndicesTop.push(i);
    }
    // For each angular segment, average side top normal with corresponding cap outer normal
    for (let s=0; s<= radialSegments; s++){
      const capIdx = capOuterStart + s;
      // Map s to closest side vertex at same angle: CylinderGeometry order matches segments
      const sideIdx = sideIndicesTop[s % sideIndicesTop.length];
      const nx = (normAttr.getX(capIdx) + normAttr.getX(sideIdx))*0.5;
      const ny = (normAttr.getY(capIdx) + normAttr.getY(sideIdx))*0.5;
      const nz = (normAttr.getZ(capIdx) + normAttr.getZ(sideIdx))*0.5;
      const invLen = 1.0/Math.sqrt(nx*nx+ny*ny+nz*nz);
      const fx = nx*invLen, fy = ny*invLen, fz = nz*invLen;
      normAttr.setXYZ(capIdx, fx, fy, fz);
      normAttr.setXYZ(sideIdx, fx, fy, fz);
    }
    normAttr.needsUpdate = true;
  })();

  // --- Seam smoothing: CylinderGeometry duplicates vertices at the 0/2π seam for UVs.
  // Averaging those duplicate normals reduces a visible lighting discontinuity on one side.
  (function smoothSideSeam(){
    const posAttr = unified.getAttribute('position');
    const normAttr = unified.getAttribute('normal');
    if (!posAttr || !normAttr) return;
    const vCount = posAttr.count;
    // Only process the side part (exclude cap vertices which start at sideCount)
    const map = new Map();
    const epsKey = (x)=> x.toFixed(5);
    for (let i=0;i<sideCount;i++){
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      const key = epsKey(x)+','+epsKey(y)+','+epsKey(z);
      let arr = map.get(key); if(!arr){ arr=[]; map.set(key,arr);} arr.push(i);
    }
    const nx = new THREE.Vector3();
    for (const arr of map.values()){
      if (arr.length < 2) continue; // not a duplicate group
      // average normals
      nx.set(0,0,0);
      for (const idx of arr){
        nx.x += normAttr.getX(idx);
        nx.y += normAttr.getY(idx);
        nx.z += normAttr.getZ(idx);
      }
      nx.normalize();
      for (const idx of arr){
        normAttr.setXYZ(idx, nx.x, nx.y, nx.z);
      }
    }
    normAttr.needsUpdate = true;
  })();

  const fallbackTex = new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);
  fallbackTex.needsUpdate = true;

  const uniforms = {
    uBaseWaterColor: { value: new THREE.Color(0xf2fbff) },            // very light tint
    uGreenColor: { value: new THREE.Color(0x00b15a) },                // indicator neutral
    uYellowColor: { value: new THREE.Color(0xffc107) },               // acidic
    uBlueColor: { value: new THREE.Color(0x0066ff) },                 // basic
    uRadius: { value: radius },
    uHalfHeight: { value: halfHeight },
    uIndicatorMap: { value: indicatorTex || fallbackTex },
    uGlobalConc: { value: 0.0 },
    uIndicatorEnabled: { value: 0.0 },
    uPHScore: { value: 0.0 },
    uLightDir: { value: new THREE.Vector3(0.5,1.0,0.3).normalize() },
    uAmbient: { value: 0.35 },                                        // match root water ambient
    uTime: { value: 0.0 },
    uRippleAmp1: { value: 0.12 },
    uRippleAmp2: { value: 0.075 },
    uWaveNum1: { value: 14.0 },
    uWaveNum2: { value: 22.0 },
    uSpeed1: { value: 6.0 },
    uSpeed2: { value: 9.0 },
    uDecay1: { value: 1.2 },
    uDecay2: { value: 1.8 },
    uPhase2: { value: 1.1 },
    uRippleCenter: { value: new THREE.Vector2(0,0) },
    uStartTime: { value: -1000 },
    uStartTimeReflect: { value: -1000 },
    uReflect: { value: 0.25 },
    uOpacity: { value: 0.22 },                                        // lowered → clearer like root version
    uFresnel: { value: 0.22 },                                        // subtle fresnel
    uRippleStrength: { value: 1.0 },
    uRippleNormalBoost: { value: 1.2 },                               // slightly milder normal exaggeration
    uRippleContrast: { value: 0.9 },                                   // gentler crest light/darken
    uEdgeDarkening: { value: 0.0 },
    // Surface realism pass additions
    uSurfaceTint: { value: new THREE.Color(0xd7f5ff) },                // subtle cooler tint for top film
    uSurfaceTintStrength: { value: 0.25 },
    uSurfaceFresnelBoost: { value: 1.4 },                              // multiplies cap-only fresnel
    uSurfaceGloss: { value: 0.38 },                                    // pseudo specular amplitude
    uSurfaceGlossPower: { value: 42.0 },                               // higher → tighter highlight
    uEdgeVignette: { value: 0.55 },                                    // darken extreme rim on cap
    uDepthSaturation: { value: 0.35 }                                   // deepen color with depth
  };

  // Vertex shader: displace only cap vertices (aCapFlag==1) using ripple function with edge fade.
  const vert = `
    precision mediump float;
    precision mediump int;
    attribute float aCapFlag;
    uniform float uTime; uniform float uStartTime; uniform float uStartTimeReflect;
    uniform vec2 uRippleCenter; uniform float uRadius;
  uniform float uRippleAmp1, uRippleAmp2, uWaveNum1, uWaveNum2, uSpeed1, uSpeed2, uDecay1, uDecay2, uPhase2, uReflect, uRippleNormalBoost, uRippleStrength;
  varying vec3 vPosLocal; varying vec3 vNormalWorld; varying float vCap; varying vec3 vPosWorld; varying float vRippleH;
    float rippleHeight(vec2 p, float time) {
      float dist = length(p - uRippleCenter);
      float t = max(0.0, time - uStartTime);
      float env1 = exp(-uDecay1 * t) * exp(-dist * 2.0);
      float env2 = exp(-uDecay2 * t) * exp(-dist * 1.6);
      float w1 = uRippleAmp1 * env1 * sin(uWaveNum1 * dist - t * uSpeed1);
      float w2 = uRippleAmp2 * env2 * sin(uWaveNum2 * dist - t * uSpeed2 + uPhase2);
      // reflection
      float r = length(uRippleCenter);
      vec2 dir = r > 1e-5 ? (uRippleCenter / r) : vec2(1.0,0.0);
      vec2 mirrorCenter = dir * max(0.0, 2.0 * uRadius - r);
      float distRef = length(p - mirrorCenter);
      float tr = max(0.0, time - uStartTimeReflect);
      float envRef = exp(-uDecay2 * tr) * exp(-distRef * 1.8);
      float wRef = uReflect * envRef * sin(uWaveNum1 * distRef - tr * uSpeed1);
      float h = w1 + w2 + wRef;
      float edge = clamp(length(p) / uRadius, 0.0, 1.0);
  float edgeFade = 1.0 - smoothstep(0.985, 1.0, edge);
  return h * edgeFade * uRippleStrength;
    }
    void main(){
      vCap = aCapFlag;
      vec3 pos = position;
      vec3 n = normal;
      if (vCap > 0.5) {
        vec2 p = pos.xz; 
        float h = rippleHeight(p, uTime);
        pos.y += h;
        vRippleH = h; // pass height to fragment for contrast shading
        // Derive normal from height field for stronger shading
  float eps = 0.012;
  // Central differences to reduce directional bias
  float hL = rippleHeight(p - vec2(eps,0.0), uTime);
  float hR = rippleHeight(p + vec2(eps,0.0), uTime);
  float hD = rippleHeight(p - vec2(0.0,eps), uTime);
  float hU = rippleHeight(p + vec2(0.0,eps), uTime);
  float dhdx = (hR - hL) / (2.0*eps);
  float dhdz = (hU - hD) / (2.0*eps);
  vec3 gradN = normalize(vec3(-dhdx, 1.0, -dhdz));
  n = normalize(mix(normal, gradN, clamp(uRippleNormalBoost,0.0,1.2)));
      } else {
        vRippleH = 0.0;
      }
      vPosLocal = pos;
  // depthNorm removed (no turbidity logic)
      vec4 worldPos = modelMatrix * vec4(pos,1.0);
      vPosWorld = worldPos.xyz;
      vNormalWorld = normalize(mat3(modelMatrix) * n);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  const frag = `
    precision mediump float;
    precision mediump int;
    uniform vec3 uBaseWaterColor, uGreenColor, uYellowColor, uBlueColor;
    uniform float uRadius, uHalfHeight, uGlobalConc, uIndicatorEnabled, uPHScore, uOpacity, uAmbient, uFresnel;
    uniform sampler2D uIndicatorMap;
    uniform vec3 uLightDir;
  uniform float uRippleContrast; uniform float uEdgeDarkening;
  uniform vec3 uSurfaceTint; uniform float uSurfaceTintStrength; uniform float uSurfaceFresnelBoost;
  uniform float uSurfaceGloss; uniform float uSurfaceGlossPower; uniform float uEdgeVignette; uniform float uDepthSaturation;
  varying vec3 vPosLocal; varying vec3 vNormalWorld; varying float vCap; varying vec3 vPosWorld; varying float vRippleH;
    float sat(float x){ return clamp(x,0.0,1.0); }
    void main(){
      vec2 uv = vec2(0.5 + 0.5 * (vPosLocal.x / uRadius), 0.5 + 0.5 * (vPosLocal.z / uRadius));
      float localConc = texture2D(uIndicatorMap, uv).g;
      float localDiff = localConc * 3.5;
      float globalB = uGlobalConc * 0.8;
      float conc = sat(max(localDiff, globalB));
      float dCenter = length(vPosLocal.xz) / uRadius;
      conc = sat(conc + localDiff * (1.0 - dCenter) * 0.3);
      float acidMix = smoothstep(0.0, 1.0, uPHScore);
      float baseMix = smoothstep(0.0, 1.0, -uPHScore);
      float neutralMix = 1.0 - max(acidMix, baseMix);
      vec3 indicatorColor = neutralMix * uGreenColor + acidMix * uYellowColor + baseMix * uBlueColor;
      float mixAmt = (uIndicatorEnabled > 0.5) ? conc : 0.0;
  vec3 baseColor = mix(uBaseWaterColor, indicatorColor, sat(mixAmt));
  // Depth saturation (y downwards from surface)
  float depthFactor = clamp((uHalfHeight - (vPosLocal.y + uHalfHeight)) / (2.0*uHalfHeight), 0.0, 1.0);
  baseColor = mix(baseColor, baseColor * (1.0 + 0.45 * uDepthSaturation), depthFactor);
      vec3 N = normalize(vNormalWorld);
      vec3 L = normalize(uLightDir);
      float lambertWrap = sat(dot(N,L)*0.5 + 0.5);
      vec3 finalCol = baseColor * (uAmbient + lambertWrap);
  // Subtle fresnel (cap gets boosted)
      vec3 V = normalize(cameraPosition - vPosWorld);
      float fres = pow(1.0 - sat(dot(N,V)), 3.0) * uFresnel;
  float fresFactor = mix(0.18, 1.0, vCap);
  float fresBoost = (vCap > 0.5 ? uSurfaceFresnelBoost : 1.0);
  finalCol += fres * 0.30 * baseColor * fresFactor * fresBoost;
      // Ripple ring shading only on cap
      if (vCap > 0.5) {
        float slopeMag = 1.0 - sat(vNormalWorld.y);
        float ringBoost = pow(slopeMag, 0.55) * 0.45; // slightly softer than old 0.55*0.55
        float edgeR = length(vPosLocal.xz)/uRadius;
        float ringEdgeFade = 1.0 - smoothstep(0.985, 1.0, edgeR);
        finalCol += ringBoost * ringEdgeFade * (0.30 * baseColor + 0.10);
        // Crest/trough contrast (cap only)
        finalCol += finalCol * vRippleH * (uRippleContrast * 0.5);
        // Surface tint
        finalCol = mix(finalCol, uSurfaceTint, clamp(uSurfaceTintStrength,0.0,1.0));
        // Edge vignette (cap only)
        if (uEdgeVignette > 0.001) {
          float radial = length(vPosLocal.xz)/uRadius;
          float vign = smoothstep(0.70, 1.0, radial);
          finalCol *= mix(1.0, 0.88, vign * uEdgeVignette);
        }
        // Pseudo specular highlight (simple phong-ish)
        vec3 R = reflect(-L, N);
        float spec = pow(max(dot(R,V),0.0), uSurfaceGlossPower) * uSurfaceGloss;
        finalCol += spec;
      }
      if (uEdgeDarkening > 0.001) {
        float radial = length(vPosLocal.xz)/uRadius;
        float edgeFactor = mix(1.0, 0.95 + 0.05 * radial, clamp(uEdgeDarkening,0.0,1.0));
        finalCol *= edgeFactor;
      }
      gl_FragColor = vec4(finalCol, uOpacity);
    }
  `;

  // NOTE: Original (toimiva) vesiversio käytti FrontSide + depthWrite:false.
  // DoubleSide + depthWrite:true aiheutti näkyvän pystysuuntaisen "epäjatkuvuus"-sauman
  // sylinterin UV-sauman kohdalle (erilainen valon/Fresnelin kertymä kahden vastakkaisen normaalin vuoksi).
  // Palautetaan siksi FrontSide + depthWrite:false oletukseksi.
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide
  });

  const mesh = new THREE.Mesh(unified, material);
  mesh.name = 'unifiedWater';
  mesh.renderOrder = 2; // initial; may change via render harness

  // ---------------- Render configuration harness ----------------
  // We experiment with combinations of depthWrite & renderOrder and an optional depth pre-pass.
  // Modes (päivitetty vastaamaan uutta baselinea):
  // 0: depthWrite=false, renderOrder=2 (baseline FrontSide)
  // 1: depthWrite=false, renderOrder=2 (sama – varattu kokeiluille)
  // 2: depthWrite=false, renderOrder=6 (glass jälkeen)
  // 3: depthWrite=true,  renderOrder=6 (harvemmin tarpeen, voi tuoda artefakteja)
  // 4: depth pre-pass (depth only) sitten color pass depthWrite=false renderOrder=6
  let depthPrePass = null;
  function ensureDepthPrePass(){
    if (!depthPrePass){
      const depthMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      depthMat.colorWrite = false; // depth only
      depthMat.depthWrite = true;
      depthMat.transparent = false;
      depthPrePass = new THREE.Mesh(unified.clone(), depthMat);
      depthPrePass.name = 'unifiedWaterDepthPrePass';
      depthPrePass.frustumCulled = false;
    }
    return depthPrePass;
  }
  function detachPrePass(){ if (depthPrePass && depthPrePass.parent) depthPrePass.parent.remove(depthPrePass); }
  function applyRenderMode(mode){
    detachPrePass();
    switch(mode){
      case 0: // baseline
        material.depthWrite = false; material.transparent = true; mesh.renderOrder = 2; break;
      case 1: // identical to baseline (placeholder for experiments)
        material.depthWrite = false; material.transparent = true; mesh.renderOrder = 2; break;
      case 2:
        material.depthWrite = false; material.transparent = true; mesh.renderOrder = 6; break;
      case 3: // allow depth write after glass (might reintroduce seam -> debug only)
        material.depthWrite = true; material.transparent = true; mesh.renderOrder = 6; break;
      case 4: {
        const pre = ensureDepthPrePass();
        if (mesh.parent) mesh.parent.add(pre);
        pre.renderOrder = 5.9; // just before main pass
        material.depthWrite = false; material.transparent = true; mesh.renderOrder = 6; break;
      }
      default:
        console.warn('[UnifiedWater] Unknown render mode', mode); return;
    }
    mesh.userData.currentRenderMode = mode;
  }
  applyRenderMode(0);
  mesh.userData.setRenderConfig = (cfg)=>{
    if (cfg.mode !== undefined) applyRenderMode(cfg.mode);
    if (cfg.edgeDarkening !== undefined) uniforms.uEdgeDarkening.value = cfg.edgeDarkening;
  };
  mesh.userData.cycleRenderModes = ()=>{
    const cur = mesh.userData.currentRenderMode || 0;
    const next = (cur + 1) % 5;
    applyRenderMode(next);
    return next;
  };
  // ----------------------------------------------------------------

  function updateTime(t){ uniforms.uTime.value = t; }
  function triggerRipple(worldPos, beakerGroup){
    // convert to local XZ (beaker local space)
    const local = beakerGroup.worldToLocal(worldPos.clone());
    // Clamp ripple center inside radius to avoid extreme distances
    const r = Math.hypot(local.x, local.z);
    const radius = uniforms.uRadius.value;
    if (r > radius) {
      const s = radius / r;
      local.x *= s; local.z *= s;
    }
    uniforms.uRippleCenter.value.set(local.x, local.z);
    // Use the unified shader clock (uTime) so (uTime - uStartTime) starts at 0 -> ripple visible immediately
    const t = uniforms.uTime.value;
    uniforms.uStartTime.value = t;
    uniforms.uStartTimeReflect.value = t + 0.15;
  }
  function setIndicatorMap(tex){ uniforms.uIndicatorMap.value = tex || fallbackTex; }
  function setChem({ globalConc, enabled, ph }) {
    if (globalConc !== undefined) uniforms.uGlobalConc.value = globalConc;
    if (enabled !== undefined) uniforms.uIndicatorEnabled.value = enabled ? 1.0 : 0.0;
    if (ph !== undefined) uniforms.uPHScore.value = ph;
  }
  function dispose(){
    if (depthPrePass){ depthPrePass.geometry.dispose(); depthPrePass.material.dispose(); }
    unified.dispose(); material.dispose(); fallbackTex.dispose();
  }

  return {
    mesh,
    uniforms,
    updateTime,
    triggerRipple,
    setIndicatorMap,
    setChem,
    setRenderConfig: mesh.userData.setRenderConfig,
    cycleRenderModes: mesh.userData.cycleRenderModes,
    dispose
  };
}
