import * as THREE from 'three';
/**
 * Lightweight procedural caustic under the beaker.
 * Not a physically correct photon caustic – just a layered animated interference pattern
 * that breaks up the big uniform ellipse into moving bright filaments.
 *
 * Usage:
 *   const caustic = createCausticEffect({ scene, beakerGroup, beakerRadius });
 *   // In loop: caustic.update(elapsedTime);
 *   // Debug helpers (index adds window.__causticIntensity etc.).
 */
export function createCausticEffect({ scene, beakerGroup, beakerRadius }) {
  const radius = beakerRadius || 1.0;
  // Plane sized a bit larger than beaker footprint so soft edge can fade out.
  const geo = new THREE.PlaneGeometry(radius * 4.0, radius * 4.0, 1, 1);
  geo.rotateX(-Math.PI / 2); // lay flat (XZ plane)

  const uniforms = {
    uTime: { value: 0 },
    uRadius: { value: radius * 1.05 }, // soft mask radius
    uIntensity: { value: 0.75 },       // overall brightness scaling
    uColor: { value: new THREE.Color(0xfff3d4) }, // warm light tone
    uScale1: { value: 9.0 },           // frequency layer 1
    uScale2: { value: 17.0 },          // frequency layer 2 (higher frequency)
    uSpeed1: { value: 0.35 },
    uSpeed2: { value: 0.55 },
    uSharpness: { value: 1.25 },       // increases filament contrast
    uSoftEdge: { value: 0.25 },        // how wide edge falloff band is
    uNoiseWarp: { value: 0.35 },       // warps coordinates to reduce repetition
    uRippleMix: { value: 0.45 },       // mixes an outward radial pulse
    uBaseLift: { value: 0.15 }         // base brightness inside footprint to slightly lift shadow
  };

  const vert = /* glsl */`
    varying vec2 vUv2; // centered UV (-1..1)
    void main(){
      vec3 p = position;
      vUv2 = p.xz; // since we rotated plane, x & z are our local axes (range ~[-2R,2R])
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
    }
  `;

  const frag = /* glsl */`
    precision mediump float;
    varying vec2 vUv2;
    uniform float uTime; uniform float uRadius; uniform float uIntensity; uniform vec3 uColor;
    uniform float uScale1,uScale2,uSpeed1,uSpeed2,uSharpness,uSoftEdge,uNoiseWarp,uRippleMix,uBaseLift;
    // Simple hash noise (cheap)
    float hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
    // Coordinate warp to break symmetry
    vec2 warp(vec2 p, float t){
      float h1 = hash21(floor(p*0.25)+t*0.5);
      float h2 = hash21(floor(p.yx*0.25)-t*0.35);
      return p + vec2(h1, h2)*uNoiseWarp*1.2 + 0.07*sin(vec2(p.y, p.x)*0.75 + t*0.8);
    }
    void main(){
      float t = uTime;
      // Centered coords (we built plane large, so scale to radius domain)
      vec2 p = vUv2; // length units ~ world units
      float r = length(p);
      // Soft circular mask
      float edgeStart = uRadius * (1.0 - uSoftEdge);
      float mask = smoothstep(uRadius, edgeStart, r);
      if (mask <= 0.0001) discard; // outside (fully transparent)

      // Normalized coord inside mask
      vec2 q = p / max(uRadius, 1e-4);
      // Warp for irregular caustic flow
      vec2 pw = warp(q*3.0, t);

      // Layered interference pattern (two anisotropic wave fields)
      float a = sin(pw.x * uScale1 + t * uSpeed1*6.283) * sin(pw.y * (uScale1*0.85) - t * uSpeed1*5.1);
      float b = sin(pw.x * (uScale2*0.55) - t * uSpeed2*4.6) * cos(pw.y * uScale2 + t * uSpeed2*5.7);
      float c = sin((pw.x+pw.y) * (uScale2*0.35) + t * (uSpeed1+uSpeed2)*3.1);
      float base = a*b + 0.35*c;

      // Enhance filament contrast
      float filaments = pow(abs(base), uSharpness);

      // Add a subtle outward pulsing ring component to mimic dynamic focusing
      float pulse = 0.0;
      if (uRippleMix > 0.001) {
        float wave = sin(r * (12.0 + 4.0*sin(t*0.7)) - t*3.5);
        float envelope = exp(-r * 2.5);
        pulse = wave * envelope * uRippleMix;
      }

      float brightness = filaments + pulse;
      // Normalize & shape
      brightness = pow(brightness, 0.9);

      // Slight lift so region isn't too dark between filaments
      brightness = brightness * (0.85 + uBaseLift) + uBaseLift*0.4;

      vec3 col = uColor * brightness * uIntensity * mask;
      // Alpha based on brightness but keep soft edge
      float alpha = clamp(brightness * 0.85, 0.0, 1.0) * mask;
      // Premultiplied style additive look (we rely on Additive blending)
      gl_FragColor = vec4(col, alpha);
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'beakerCaustic';
  // Place just above shadow catcher so it brightens over shadow
  mesh.position.y = 0.0025;
  // Align with beaker world position (follow by parenting to beaker group)
  if (beakerGroup) beakerGroup.add(mesh);

  function update(elapsedTime){
    uniforms.uTime.value = elapsedTime;
  }

  return { mesh, uniforms, update };
}
