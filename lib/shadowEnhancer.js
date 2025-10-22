import * as THREE from 'three';

/**
 * enhanceShadows(scene, { envMapIntensity=0.4, forceCast=true, forceReceive=true, glassNames=[] })
 * - Leikkaa kaikilta MeshStandard/Physical materiaaleilta envMapIntensity (pienempi = vähemmän lit flat).
 * - Asettaa castShadow/receiveShadow flagit ellei nimessä ole 'noShadow'.
 * - Mahdollistaa listan (glassNames) joissa castShadow jää pois mutta receiveShadow pidetään (lasin realistisempi varjo – usein tarvitaan dummy varjo mesh erikseen, mutta tämä on kevyt ratkaisu).
 */
export function enhanceShadows(scene, opts = {}) {
  const envTarget = opts.envMapIntensity ?? 0.4;
  const forceCast = opts.forceCast !== false;
  const forceReceive = opts.forceReceive !== false;
  const glassNames = new Set(opts.glassNames || []);
  scene.traverse(obj => {
    if (obj.isMesh) {
      const mat = obj.material;
      const name = obj.name || '';
      if (mat && (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial)) {
        if (typeof mat.envMapIntensity === 'number') {
          mat.envMapIntensity = envTarget;
          mat.needsUpdate = true;
        }
      }
      if (!/noShadow/i.test(name)) {
        if (forceReceive) obj.receiveShadow = true;
        if (forceCast && !glassNames.has(name)) obj.castShadow = true;
        if (glassNames.has(name)) {
          // lasille vain kevyt varjo (jätetään castShadow false)
          obj.castShadow = false;
        }
      }
    }
  });
}
