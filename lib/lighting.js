import * as THREE from 'three';

/**
 * createLabLighting
 * Lisää laboratoriohenkisen, hieman tummemman ja kerroksellisen valaistuksen.
 * - Ambient hyvin matala (tasaa varjot hienovaraisesti)
 * - HemisphereLight tuo kylmän ylävalon + lämpimän heijasteen alhaalta
 * - PointLight (yläpuolinen "valaisin") voimakkaammilla varjoilla
 * - Accent RectAreaLight (valinnainen) voi tuoda sivuheijastetta – jätetty pois oletuksena
 * - Taustadome: gradienttisphere BackSide, joka on hienovarainen sinertävän-harmaa -> hieman tummempi alaosa
 *
 * Options:
 *  {
 *    ambientIntensity = 0.18,
 *    hemiSkyColor = 0xaec6dc,
 *    hemiGroundColor = 0x30241a,
 *    hemiIntensity = 0.55,
 *    pointColor = 0xffffff,
 *    pointIntensity = 1.6,
 *    pointHeight = 9.0,
 *    pointDistance = 40,
 *    backgroundTop = '#d2d9df',
 *    backgroundMid = '#b6c0c7',
 *    backgroundBottom = '#3a4250'
 *  }
 */
export function createLabLighting(scene, renderer, opts = {}) {
  const stronger = !!opts.strongerShadows;
  const mood = opts.mood || 'default'; // 'default' | 'dramatic'
  const moodMul = (key, base) => {
    if (mood === 'dramatic') {
      if (key === 'ambient') return base * 0.25; // paljon tummempi
      if (key === 'hemi') return base * 0.5;
      if (key === 'point') return base * 1.1;
    }
    return base;
  };
  // Jos halutaan selkeämmät varjot, tiputetaan ambient ja hemisfäärin intensityä hiukan
  const ambientBase = (opts.ambientIntensity ?? 0.18) * (stronger ? 0.55 : 1.0);
  const ambient = new THREE.AmbientLight(0xffffff, moodMul('ambient', ambientBase));
  scene.add(ambient);

  const hemiIntensityBase = (opts.hemiIntensity ?? 0.55) * (stronger ? 0.75 : 1.0);
  const hemi = new THREE.HemisphereLight(
    opts.hemiSkyColor ?? 0xaec6dc,
    opts.hemiGroundColor ?? 0x30241a,
    moodMul('hemi', hemiIntensityBase)
  );
  scene.add(hemi);

  let point = null;
  if (!opts.disablePointLight) {
    // Matala ja himmeä point-valo varjoihin ilman hotspotin fokusoitumista
    point = new THREE.PointLight(
      opts.pointColor ?? 0xffffff,
      (opts.pointLowIntensity ?? 0.55), // huomattavasti pienempi intensiteetti
      opts.pointDistance ?? 25,
      2
    );
    point.position.set(1.2, 1.15, 1.4); // lähelle pöytää ja hieman sivuun ettei keskity ellipsiksi
    point.castShadow = true;
    point.shadow.mapSize.set(1024,1024);
    point.shadow.bias = -0.00045;
    point.shadow.normalBias = 0.02;
    scene.add(point);
  }

  // Valinnainen SpotLight rajatumpia, terävämpiä varjoja varten
  // Directional ja Spot poistettu käytöstä hotspotin minimoimiseksi
  let spot = null;
  let directional = null;

  // Pieni sivutäyte (valinnainen, kommentoitu)
  // const fill = new THREE.PointLight(0x7aa4ff, 0.35, 25, 2); fill.position.set(-6,4,-4); scene.add(fill);

  // Taustadome gradientilla – luodaan vain jos ei jo ole selkeää custom backgroundia
  if (!scene.userData._labGradientBackground) {
    try {
      const geo = new THREE.SphereGeometry(60, 48, 32);
      const gradMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color(opts.backgroundTop || '#d2d9df') },
          uMid: { value: new THREE.Color(opts.backgroundMid || '#b6c0c7') },
          uBottom: { value: new THREE.Color(opts.backgroundBottom || '#3a4250') }
        },
        vertexShader: `varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying float vY; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; void main(){ float h = clamp(vY*0.5+0.5,0.0,1.0); vec3 c; if(h>0.55){ float k=(h-0.55)/0.45; c=mix(uMid,uTop,clamp(k,0.0,1.0)); } else { float k=h/0.55; c=mix(uBottom,uMid,clamp(k,0.0,1.0)); } gl_FragColor=vec4(c,1.0); }`
      });
      const dome = new THREE.Mesh(geo, gradMat);
      dome.name = 'labGradientDome';
      scene.add(dome);
      scene.userData._labGradientBackground = dome;
    } catch {}
  }

  // Tee varjojen kontrastia maltillisemmaksi toneMappingExposurella
  if (renderer) {
    if (mood === 'dramatic') {
      renderer.toneMappingExposure = 0.78; // huomattavasti tummempi
    } else {
      renderer.toneMappingExposure = stronger ? 0.9 : 0.95;
    }
    renderer.physicallyCorrectLights = true;
  }

  return { ambient, hemi, point, spot, directional };
}
