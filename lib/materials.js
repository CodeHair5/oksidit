import * as THREE from 'three';

// Create a drop material that is opaque so transmissive glass includes it.
export function createDropMaterial(color = 0x12d65c) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.0,
    roughness: 0.25,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide
  });
}
