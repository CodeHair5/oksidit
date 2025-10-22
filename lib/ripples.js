import * as THREE from 'three';

// Create meniscus ripple ShaderMaterial and uniforms
// Returns materials, uniforms, and a small controller API for reuse.
export function createMeniscusMaterials({ beakerRadius, indicatorTex, waterUniforms }) {
  // Ensure we always have a valid texture bound to sampler uniforms
  const fallbackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  fallbackTex.needsUpdate = true;
  const tex = indicatorTex || fallbackTex;
  const meniscusUniforms = {
    uTime: { value: 0 },
    uStartTime: { value: -1000 },
    uRippleCenter: { value: new THREE.Vector2(0, 0) },
    uAmp: { value: 0.12 },
    uWaveNum: { value: 14.0 },
    uSpeed: { value: 6.0 },
    uDecay: { value: 1.2 },
    uAmp2: { value: 0.08 },
    uWaveNum2: { value: 22.0 },
    uSpeed2: { value: 9.0 },
    uDecay2: { value: 1.8 },
    uPhase2: { value: 1.1 },
    uRadius: { value: beakerRadius - 0.05 },
  uStartTimeReflect: { value: -1000 },
  // Lower reflection strength to reduce bright rings
  uReflect: { value: 0.25 },
  // Match near-clear water tone so meniscus looks clear when indicator is off
  uBaseColor: { value: new THREE.Color(0xf2fbff) },
    // Much more saturated indicator colors to improve visibility while keeping translucency
    uGreenColor: { value: new THREE.Color(0x00b15a) },
    uYellowColor: { value: new THREE.Color(0xffc107) },
  uBlueColor: { value: new THREE.Color(0x0066ff) },
  uIndicatorMap: { value: tex },
    uGlobalConc: { value: waterUniforms ? waterUniforms.uGlobalConc.value : 0.0 },
    uIndicatorEnabled: { value: waterUniforms && waterUniforms.uIndicatorEnabled ? waterUniforms.uIndicatorEnabled.value : 0.0 },
    uPHScore: { value: waterUniforms && waterUniforms.uPHScore ? waterUniforms.uPHScore.value : 0.0 },
    uLightDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
  uLightColor: { value: new THREE.Color(0xffffff) },
  // Softer overall lighting for a clearer look
  uAmbient: { value: 0.18 },
  uHemiStrength: { value: 0.18 },
  uSpecStrength: { value: 0.15 },
  uFresnelStrength: { value: 0.25 },
    // Lower opacity to make meniscus truly translucent
    uOpacity: { value: 0.22 }
  };

  const vertexShader = `
    uniform float uTime;
    uniform float uStartTime;
    uniform vec2 uRippleCenter;
    uniform float uAmp;
    uniform float uWaveNum;
    uniform float uSpeed;
    uniform float uDecay;
    uniform float uAmp2;
    uniform float uWaveNum2;
    uniform float uSpeed2;
    uniform float uDecay2;
    uniform float uPhase2;
    uniform float uRadius;
    uniform float uStartTimeReflect;
    uniform float uReflect;
    varying vec3 vNormalWorld;
    varying vec3 vPosWorld;
    varying vec2 vPosLocalXZ;

    float heightAt(vec2 p, float time) {
      float dist = length(p - uRippleCenter);
      float t = max(0.0, time - uStartTime);
      float env1 = exp(-uDecay * t) * exp(-dist * 2.0);
      float env2 = exp(-uDecay2 * t) * exp(-dist * 1.6);
      float w1 = uAmp * env1 * sin(uWaveNum * dist - t * uSpeed);
      float w2 = uAmp2 * env2 * sin(uWaveNum2 * dist - t * uSpeed2 + uPhase2);
      // Circle wall reflection
      float r = length(uRippleCenter);
      vec2 dir = r > 1e-5 ? (uRippleCenter / r) : vec2(1.0, 0.0);
      vec2 mirrorCenter = dir * max(0.0, 2.0 * uRadius - r);
      float distRef = length(p - mirrorCenter);
      float tr = max(0.0, time - uStartTimeReflect);
      float envRef = exp(-uDecay2 * tr) * exp(-distRef * 1.8);
      float wRef = uReflect * envRef * sin(uWaveNum * distRef - tr * uSpeed);
      float h = w1 + w2 + wRef;
      // Edge fade: force displacement to 0 near outer radius so sidewall joins seamlessly (removes visuaalinen rako)
      float edge = clamp(length(p) / uRadius, 0.0, 1.0);
      float edgeFade = 1.0 - smoothstep(0.96, 1.0, edge);
      return h * edgeFade;
    }

    void main() {
      vec3 pos = position;
      vec2 p = vec2(pos.x, pos.z);
      float h = heightAt(p, uTime);
      pos.y += h;
      vPosLocalXZ = p;
      float eps = 0.01;
      float hx = heightAt(p + vec2(eps, 0.0), uTime) - h;
      float hz = heightAt(p + vec2(0.0, eps), uTime) - h;
      vec3 dx = vec3(1.0, hx/eps, 0.0);
      vec3 dz = vec3(0.0, hz/eps, 1.0);
      vec3 n = normalize(cross(dz, dx));
      vec4 worldPos = modelMatrix * vec4(pos, 1.0);
      vPosWorld = worldPos.xyz;
      vNormalWorld = normalize((modelMatrix * vec4(n, 0.0)).xyz);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  const fragmentShader = `
    uniform vec3 uBaseColor; 
    uniform vec3 uGreenColor; 
    uniform vec3 uYellowColor;
    uniform vec3 uBlueColor;
    uniform vec3 uLightDir; 
    uniform vec3 uLightColor; 
    uniform float uAmbient; 
    uniform float uOpacity; 
    uniform float uHemiStrength; 
    uniform float uSpecStrength; 
    uniform float uFresnelStrength; 
    uniform float uRadius; 
    uniform sampler2D uIndicatorMap; 
    uniform float uGlobalConc; 
    uniform float uIndicatorEnabled;
    uniform float uPHScore;
    varying vec3 vNormalWorld; 
    varying vec3 vPosWorld; 
    varying vec2 vPosLocalXZ;

    float sampleConcRadial(vec2 uv) {
      float c = 0.0;
      vec2 center = vec2(0.5);
      for (int i = 0; i < 4; i++) {
        float t = float(i) / 3.0; // 0.0 .. 1.0
        vec2 uvt = mix(center, uv, 1.0 - t);
        c = max(c, texture2D(uIndicatorMap, uvt).g);
      }
      return c;
    }

    void main() {
      vec3 N = normalize(vNormalWorld);
      vec3 L = normalize(uLightDir);
      float lambertWrap = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
      vec3 sky = vec3(0.85, 0.93, 1.0);
      vec3 ground = vec3(0.20, 0.25, 0.30);
      float hemiT = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 hemi = mix(ground, sky, hemiT) * uHemiStrength;
      vec3 V = normalize(cameraPosition - vPosWorld);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 48.0) * uSpecStrength;
      float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0) * uFresnelStrength;
      vec2 uv = vec2(0.5 + 0.5 * (vPosLocalXZ.x / uRadius), 0.5 + 0.5 * (vPosLocalXZ.y / uRadius));
    float concMap = sampleConcRadial(uv);
    float localDiffusion = concMap * 2.8;
    float globalBackground = uGlobalConc * 0.7;
    float conc = clamp(max(localDiffusion, globalBackground), 0.0, 1.0);
  float acidMix = smoothstep(0.0, 1.0, uPHScore);
  float baseMix = smoothstep(0.0, 1.0, -uPHScore);
  float neutralMix = 1.0 - max(acidMix, baseMix);
  vec3 indicatorColor = neutralMix * uGreenColor + acidMix * uYellowColor + baseMix * uBlueColor;
  // Tint strength follows concentration when indicator is enabled
  float mixAmt = (uIndicatorEnabled > 0.5) ? conc : 0.0;
    vec3 tintedBase = mix(uBaseColor, indicatorColor, clamp(mixAmt, 0.0, 1.0));
      vec3 base = tintedBase * (uAmbient + lambertWrap) + hemi;
      vec3 color = base * uLightColor + (spec + fres) * uLightColor;
      gl_FragColor = vec4(color, uOpacity);
    }
  `;

  const meniscusMat = new THREE.ShaderMaterial({
    uniforms: meniscusUniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    premultipliedAlpha: false,
    // Render only front side to avoid overly bright double blending
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: false
  });

  // Create under-surface material sharing indicator and global conc
  const meniscusUnderUniforms = THREE.UniformsUtils.clone(meniscusUniforms);
  meniscusUnderUniforms.uIndicatorMap = meniscusUniforms.uIndicatorMap;
  meniscusUnderUniforms.uGlobalConc = meniscusUniforms.uGlobalConc;

  const meniscusUnderMat = new THREE.ShaderMaterial({
    uniforms: meniscusUnderUniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    premultipliedAlpha: false,
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: false
  });

  // Soften under layer a bit
  meniscusUnderUniforms.uAmp.value *= 0.8;
  meniscusUnderUniforms.uAmp2.value *= 0.8;
  // Make under layer extremely subtle if ever shown
  meniscusUnderUniforms.uOpacity.value = 0.12;

  // Controller API for reuse
  function updateTime(tSec) {
    try { meniscusUniforms.uTime.value = tSec; } catch {}
    try { meniscusUnderUniforms.uTime.value = tSec; } catch {}
  }

  function setIndicatorProxy(water) {
    try { meniscusUniforms.uGlobalConc.value = water.uGlobalConc.value; } catch {}
    try { meniscusUniforms.uIndicatorEnabled.value = water.uIndicatorEnabled.value; } catch {}
    try { meniscusUniforms.uPHScore.value = water.uPHScore.value; } catch {}
    try { meniscusUnderUniforms.uGlobalConc.value = water.uGlobalConc.value; } catch {}
    try { meniscusUnderUniforms.uIndicatorEnabled.value = water.uIndicatorEnabled.value; } catch {}
    try { meniscusUnderUniforms.uPHScore.value = water.uPHScore.value; } catch {}
  }

  function setIndicatorMap(tex) {
    try { meniscusUniforms.uIndicatorMap.value = tex; } catch {}
    try { meniscusUnderUniforms.uIndicatorMap.value = tex; } catch {}
  }

  function setParams({ amp, waveNum, speed, decay, amp2, waveNum2, speed2, decay2, phase2, reflect, opacity, ambient, lightDir }) {
    if (amp !== undefined) { meniscusUniforms.uAmp.value = amp; meniscusUnderUniforms.uAmp.value = amp; }
    if (waveNum !== undefined) { meniscusUniforms.uWaveNum.value = waveNum; meniscusUnderUniforms.uWaveNum.value = waveNum; }
    if (speed !== undefined) { meniscusUniforms.uSpeed.value = speed; meniscusUnderUniforms.uSpeed.value = speed; }
    if (decay !== undefined) { meniscusUniforms.uDecay.value = decay; meniscusUnderUniforms.uDecay.value = decay; }
    if (amp2 !== undefined) { meniscusUniforms.uAmp2.value = amp2; meniscusUnderUniforms.uAmp2.value = amp2; }
    if (waveNum2 !== undefined) { meniscusUniforms.uWaveNum2.value = waveNum2; meniscusUnderUniforms.uWaveNum2.value = waveNum2; }
    if (speed2 !== undefined) { meniscusUniforms.uSpeed2.value = speed2; meniscusUnderUniforms.uSpeed2.value = speed2; }
    if (decay2 !== undefined) { meniscusUniforms.uDecay2.value = decay2; meniscusUnderUniforms.uDecay2.value = decay2; }
    if (phase2 !== undefined) { meniscusUniforms.uPhase2.value = phase2; meniscusUnderUniforms.uPhase2.value = phase2; }
    if (reflect !== undefined) { meniscusUniforms.uReflect.value = reflect; meniscusUnderUniforms.uReflect.value = reflect; }
    if (opacity !== undefined) { meniscusUniforms.uOpacity.value = opacity; meniscusUnderUniforms.uOpacity.value = Math.min(opacity, 0.12); }
    if (ambient !== undefined) { meniscusUniforms.uAmbient.value = ambient; meniscusUnderUniforms.uAmbient.value = ambient; }
    if (lightDir) { const n = lightDir.clone().normalize(); meniscusUniforms.uLightDir.value.copy(n); meniscusUnderUniforms.uLightDir.value.copy(n); }
  }

  function triggerAtLocal({ x, z, timeSec }) {
    const center = new THREE.Vector2(x, z);
    const r = center.length();
    const dir = r > 1e-5 ? center.clone().normalize() : new THREE.Vector2(1, 0);
    const mirrorCenter = dir.multiplyScalar(Math.max(0, 2.0 * meniscusUniforms.uRadius.value - r));
    meniscusUniforms.uRippleCenter.value.set(center.x, center.y);
    meniscusUniforms.uStartTime.value = timeSec;
    meniscusUniforms.uStartTimeReflect.value = timeSec + 0.15;
    meniscusUnderUniforms.uRippleCenter.value.set(center.x, center.y);
    meniscusUnderUniforms.uStartTime.value = timeSec;
    meniscusUnderUniforms.uStartTimeReflect.value = timeSec + 0.15;
  }

  function triggerAtWorld({ beakerGroup, worldPos, timeSec }) {
    const local = beakerGroup.worldToLocal(worldPos.clone());
    triggerAtLocal({ x: local.x, z: local.z, timeSec });
  }

  function dispose() {
    try { meniscusMat.dispose(); } catch {}
    try { meniscusUnderMat.dispose(); } catch {}
  }

  const controller = { updateTime, setIndicatorProxy, setIndicatorMap, setParams, triggerAtLocal, triggerAtWorld, dispose };

  return { meniscusMat, meniscusUniforms, meniscusUnderMat, meniscusUnderUniforms, controller };
}

// Utility to update ripple uniforms when a drop hits the surface (uniforms-based API)
export function triggerRipplesAtWithUniforms({ meniscusUniforms, meniscusUnderUniforms, hitWorldPosition, beakerGroup, beakerRadius, timeSec }) {
  const localPos = beakerGroup.worldToLocal(hitWorldPosition.clone());
  const rippleCenter = new THREE.Vector2(localPos.x, localPos.z);
  const normLen = rippleCenter.length();
  const clamped = normLen > beakerRadius ? rippleCenter.multiplyScalar(beakerRadius / normLen) : rippleCenter;

  meniscusUniforms.uRippleCenter.value.copy(clamped);
  meniscusUniforms.uStartTime.value = timeSec;
  meniscusUniforms.uStartTimeReflect.value = timeSec + 0.15;

  if (meniscusUnderUniforms) {
    meniscusUnderUniforms.uRippleCenter.value.copy(clamped);
    meniscusUnderUniforms.uStartTime.value = timeSec;
    meniscusUnderUniforms.uStartTimeReflect.value = timeSec + 0.15;
  }
}
// Ripple helpers for meniscus shaders (top & underside)
export function triggerRipplesAt(scene, meniscus, meniscusUnder, beakerRadius, hitWorldPosition, addIndicatorAt) {
  const rippleTime = performance.now() / 1000.0;
  // Convert hit to meniscus local for center
  const localHit = hitWorldPosition.clone();
  meniscus.worldToLocal(localHit);
  const rippleCenter = { x: localHit.x, z: localHit.z };

  if (meniscus.material && meniscus.material.uniforms) {
    const u = meniscus.material.uniforms;
    u.uStartTime.value = rippleTime;
    u.uRippleCenter.value.set(rippleCenter.x, rippleCenter.z);
    const r = Math.hypot(rippleCenter.x, rippleCenter.z);
    const radius = u.uRadius ? u.uRadius.value : (beakerRadius - 0.05);
    const travel = Math.max(0, radius - r);
    const speed = u.uSpeed.value;
    u.uStartTimeReflect.value = u.uStartTime.value + travel / Math.max(0.001, speed);
  }

  if (meniscusUnder && meniscusUnder.material && meniscusUnder.material.uniforms) {
    const u = meniscusUnder.material.uniforms;
    u.uStartTime.value = rippleTime;
    u.uRippleCenter.value.set(rippleCenter.x, rippleCenter.z);
    const r = Math.hypot(rippleCenter.x, rippleCenter.z);
    const radius = u.uRadius ? u.uRadius.value : (beakerRadius - 0.05);
    const travel = Math.max(0, radius - r);
    const speed = u.uSpeed.value;
    u.uStartTimeReflect.value = u.uStartTime.value + travel / Math.max(0.001, speed);
  }

  if (typeof addIndicatorAt === 'function') {
    addIndicatorAt(rippleCenter.x, rippleCenter.z);
  }
}
