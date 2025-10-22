import * as THREE from 'three';

// Create water materials (volume cylinder and an under-surface tint layer)
// Returns materials, uniforms, and a small controller API for reuse.
export function createWaterMaterials({ beakerRadius, waterHeight, indicatorTex }) {
  const fallbackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  fallbackTex.needsUpdate = true;
  const waterUniforms = {
    // Nearly clear water: very light tint
    uBaseWaterColor: { value: new THREE.Color(0xf2fbff) },
  // Much more saturated and distinct indicator hues
  uGreenColor: { value: new THREE.Color(0x00b15a) },  // neutral (vivid green)
  uYellowColor: { value: new THREE.Color(0xffc107) }, // acidic (saturated amber)
  uBlueColor: { value: new THREE.Color(0x0066ff) },   // basic (vivid blue)
  // Lower base opacity so water appears almost clear; indicator still tints when enabled
  uOpacity: { value: 0.22 },
    uRadius: { value: beakerRadius - 0.05 },
    uHalfHeight: { value: waterHeight / 2.0 },
  uIndicatorMap: { value: indicatorTex || fallbackTex },
    uGlobalConc: { value: 0.0 },
    uIndicatorEnabled: { value: 0.0 },
    uPHScore: { value: 0.0 },
    uLightDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
  uAmbient: { value: 0.35 }
  };

  const waterVert = `
    uniform float uHalfHeight;
    varying vec3 vPosLocal;
    varying vec3 vNormalWorld;
    void main() {
      vPosLocal = position;
      vNormalWorld = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const waterFrag = `
    uniform vec3 uBaseWaterColor;
    uniform vec3 uGreenColor;
    uniform vec3 uYellowColor;
    uniform vec3 uBlueColor;
    uniform float uOpacity;
    uniform float uRadius;
    uniform float uHalfHeight;
    uniform sampler2D uIndicatorMap;
    uniform float uGlobalConc;
    uniform float uIndicatorEnabled;
    uniform float uPHScore;
    uniform vec3 uLightDir;
    uniform float uAmbient;
  varying vec3 vPosLocal;
  varying vec3 vNormalWorld;
    void main() {
      vec2 uv = vec2(0.5 + 0.5 * (vPosLocal.x / uRadius), 0.5 + 0.5 * (vPosLocal.z / uRadius));
      float localConc = texture2D(uIndicatorMap, uv).g;
      float localDiffusion = localConc * 3.5;
      float globalBackground = uGlobalConc * 0.8;
    float conc = clamp(max(localDiffusion, globalBackground), 0.0, 1.0);
      float distanceFromCenter = length(vPosLocal.xz) / uRadius;
      float centerBoost = (1.0 - distanceFromCenter) * 0.3;
      conc = clamp(conc + (localDiffusion * centerBoost), 0.0, 1.0);
  // BTS mapping with smooth blending by pH: green (neutral), yellow (acidic), dark blue (basic)
  float acidMix = smoothstep(0.0, 1.0, uPHScore);
  float baseMix = smoothstep(0.0, 1.0, -uPHScore);
  float neutralMix = 1.0 - max(acidMix, baseMix);
  vec3 indicatorColor = neutralMix * uGreenColor + acidMix * uYellowColor + baseMix * uBlueColor;
      float depth01 = clamp((uHalfHeight - vPosLocal.y) / (uHalfHeight), 0.0, 1.0);
      float depthWeight = max(0.6, depth01);
      float sideBias = smoothstep(uRadius * 0.85, uRadius, length(vPosLocal.xz));
  // Tint strength follows indicator concentration when enabled
  float mixAmt = (uIndicatorEnabled > 0.5) ? conc : 0.0;
    vec3 baseColor = mix(uBaseWaterColor, indicatorColor, clamp(mixAmt, 0.0, 1.0));
  vec3 N = normalize(vNormalWorld);
      vec3 L = normalize(uLightDir);
      float lambertWrap = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
      vec3 color = baseColor * (uAmbient + lambertWrap);
      gl_FragColor = vec4(color, uOpacity);
    }
  `;

  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: waterVert,
    fragmentShader: waterFrag,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    // Use front faces only to avoid double-pass seam artifacts
    side: THREE.FrontSide
  });

  const waterTopUniforms = THREE.UniformsUtils.clone(waterUniforms);
  // Make the thin under-surface layer very subtle
  waterTopUniforms.uOpacity.value = 0.12;

  const waterTopVert = `
    varying vec3 vPosLocal;
    varying vec3 vNormalWorld;
    void main() {
      vPosLocal = position;
      vNormalWorld = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const waterTopFrag = `
    uniform vec3 uBaseWaterColor;
    uniform vec3 uGreenColor;
    uniform vec3 uYellowColor;
    uniform vec3 uBlueColor;
    uniform float uOpacity;
    uniform float uRadius;
    uniform sampler2D uIndicatorMap;
    uniform float uGlobalConc;
    uniform float uIndicatorEnabled;
    uniform float uPHScore;
    uniform vec3 uLightDir;
    uniform float uAmbient;
    varying vec3 vPosLocal;
    varying vec3 vNormalWorld;
    void main() {
      vec2 uv = vec2(0.5 + 0.5 * (vPosLocal.x / uRadius), 0.5 + 0.5 * (vPosLocal.z / uRadius));
  float localConc = texture2D(uIndicatorMap, uv).g;
  float localDiffusion = localConc * 2.5;
  float globalBackground = uGlobalConc * 0.8;
  float conc = clamp(max(localDiffusion, globalBackground), 0.0, 1.0);
  // Tint strength follows indicator concentration when enabled
  float mixAmt = (uIndicatorEnabled > 0.5) ? conc : 0.0;
  float acidMix = smoothstep(0.0, 1.0, uPHScore);
  float baseMix = smoothstep(0.0, 1.0, -uPHScore);
  float neutralMix = 1.0 - max(acidMix, baseMix);
  vec3 indicatorColor = neutralMix * uGreenColor + acidMix * uYellowColor + baseMix * uBlueColor;
  vec3 baseColor = mix(uBaseWaterColor, indicatorColor, clamp(mixAmt, 0.0, 1.0));
      vec3 N = normalize(vNormalWorld);
      vec3 L = normalize(uLightDir);
      float lambertWrap = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
      vec3 color = baseColor * (uAmbient + lambertWrap);
      gl_FragColor = vec4(color, uOpacity);
    }
  `;

  const waterTopMat = new THREE.ShaderMaterial({
    uniforms: waterTopUniforms,
    vertexShader: waterTopVert,
    fragmentShader: waterTopFrag,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide
  });

  // Controller API for reuse and decoupling from beaker specifics
  function setIndicatorEnabled(on) {
    const v = on ? 1.0 : 0.0;
    try { waterUniforms.uIndicatorEnabled.value = v; } catch {}
    try { waterTopUniforms.uIndicatorEnabled.value = v; } catch {}
  }

  function setPHScore(v) {
    try { waterUniforms.uPHScore.value = v; } catch {}
    try { waterTopUniforms.uPHScore.value = v; } catch {}
  }

  function setGlobalConc(v) {
    try { waterUniforms.uGlobalConc.value = v; } catch {}
    try { waterTopUniforms.uGlobalConc.value = v; } catch {}
  }

  function setIndicatorMap(tex) {
    const t = tex || fallbackTex;
    try { waterUniforms.uIndicatorMap.value = t; } catch {}
    try { waterTopUniforms.uIndicatorMap.value = t; } catch {}
  }

  function setColors({ base, green, yellow, blue }) {
    if (base) { try { waterUniforms.uBaseWaterColor.value.set(base); waterTopUniforms.uBaseWaterColor.value.set(base); } catch {} }
    if (green) { try { waterUniforms.uGreenColor.value.set(green); waterTopUniforms.uGreenColor.value.set(green); } catch {} }
    if (yellow) { try { waterUniforms.uYellowColor.value.set(yellow); waterTopUniforms.uYellowColor.value.set(yellow); } catch {} }
    if (blue) { try { waterUniforms.uBlueColor.value.set(blue); waterTopUniforms.uBlueColor.value.set(blue); } catch {} }
  }

  function setLight({ dir, ambient }) {
    if (dir) { try { waterUniforms.uLightDir.value.copy(dir.clone().normalize()); waterTopUniforms.uLightDir.value.copy(dir.clone().normalize()); } catch {} }
    if (ambient !== undefined) { try { waterUniforms.uAmbient.value = ambient; waterTopUniforms.uAmbient.value = ambient; } catch {} }
  }

  function setOpacity({ volume, top }) {
    if (volume !== undefined) { try { waterUniforms.uOpacity.value = volume; } catch {} }
    if (top !== undefined) { try { waterTopUniforms.uOpacity.value = top; } catch {} }
  }

  function setGeometry({ radius, halfHeight }) {
    if (radius !== undefined) { try { waterUniforms.uRadius.value = radius; waterTopUniforms.uRadius.value = radius; } catch {} }
    if (halfHeight !== undefined) { try { waterUniforms.uHalfHeight.value = halfHeight; } catch {} }
  }

  function dispose() {
    try { waterMat.dispose(); } catch {}
    try { waterTopMat.dispose(); } catch {}
    try { fallbackTex.dispose(); } catch {}
  }

  const controller = {
    setIndicatorEnabled,
    setPHScore,
    setGlobalConc,
    setIndicatorMap,
    setColors,
    setLight,
    setOpacity,
    setGeometry,
    dispose
  };

  return { waterUniforms, waterMat, waterTopUniforms, waterTopMat, controller };
}
