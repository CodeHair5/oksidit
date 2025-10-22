import * as THREE from 'three';

// Luo kiinteän aineen purkki (jauhepurkki) ja palauta olio, jossa on geometria, jauhe, ja label-funktiot
export function createSolidJar({ position = new THREE.Vector3(0, 0, 0), radius = 0.8, height = 1.4, solidCode = 'CaO' } = {}) {
    const group = new THREE.Group();
    // Keep legacy name for interaction targeting
    group.name = 'solidSample';
    // Lasipurkki
    const jarGeo = new THREE.CylinderGeometry(radius, radius, height, 32, 1, true);
    const jarMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.0,
        roughness: 0.08,
        transparent: true,
        opacity: 1.0,
        transmission: 0.98,
        ior: 1.5,
        thickness: 0.12,
        attenuationColor: new THREE.Color(0xfefefe),
        attenuationDistance: 2.0,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const jarMesh = new THREE.Mesh(jarGeo, jarMat);
    jarMesh.name = 'solidJar';
    jarMesh.castShadow = true;
    group.add(jarMesh);
    // Pohja
    const jarBottomGeo = new THREE.CircleGeometry(radius, 32);
    const jarBottom = new THREE.Mesh(jarBottomGeo, jarMat);
    jarBottom.name = 'solidJarBottom';
    jarBottom.rotation.x = -Math.PI / 2;
    jarBottom.position.y = -height / 2 + 0.01;
    jarBottom.receiveShadow = true;
    group.add(jarBottom);
    // Jauhe
    const powderColors = {
        CaO: 0xffffff,
        Na2O: 0xfff2a8,
        MgO: 0xf7f7f7
    };
    const powderMat = new THREE.MeshStandardMaterial({ color: powderColors[solidCode] || 0xffffff, roughness: 0.9, metalness: 0.0 });
    const powderGeom = new THREE.CylinderGeometry(radius - 0.05, radius - 0.05, 0.35, 32);
    const powderMesh = new THREE.Mesh(powderGeom, powderMat);
    // Legacy-compatible name so raycaster predicates keep working
    powderMesh.name = 'solidSample';
    powderMesh.position.y = -height / 2 + 0.2;
    powderMesh.castShadow = true;
    group.add(powderMesh);
    // Sijoitus
    group.position.copy(position);
    // Label-funktio (jos halutaan lisätä tarra myöhemmin)
    function setPowderType(code) {
        powderMesh.material.color.setHex(powderColors[code] || 0xffffff);
        powderMesh.material.needsUpdate = true;
    }
    return {
        group,
        jarMesh,
        jarBottom,
        powderMesh,
        setPowderType,
        radius,
        height
    };
}
