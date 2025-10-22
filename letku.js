import * as THREE from 'three';

export function createLetku(scene, gasNozzle, beakerNozzle, hoseRestingPoint, isHoseAttached) {
    let hoseMesh;

    function updateHose(hoseEndPoint, isHoseAttached) {
        if (hoseMesh) {
            scene.remove(hoseMesh);
            hoseMesh.geometry.dispose();
            hoseMesh.material.dispose();
        }
        // Kiinnitetään letku kaasupullon vaakasylinterin päähän, hieman sylinterin sisälle
        const startPoint = new THREE.Vector3();
        gasNozzle.getWorldPosition(startPoint);
        startPoint.x -= 0.1;

        const endPointTarget = new THREE.Vector3();
        beakerNozzle.getWorldPosition(endPointTarget);
        const currentEndPoint = isHoseAttached ? endPointTarget : hoseEndPoint;

        // Ylimääräinen kontrollipiste kaasupullon suuttimen tasolle, irti kaasupullosta keitinlasiin päin
        const extraControl = startPoint.clone();
        extraControl.x += 1.0; // Säädä tarvittaessa, vie irti pullosta

        // Normaalin käyrän kontrollipiste
        const controlPoint = new THREE.Vector3().lerpVectors(startPoint, currentEndPoint, 0.5);
        controlPoint.y -= 1.5;
        controlPoint.x += 0.5;

        const curve = new THREE.CatmullRomCurve3([startPoint, extraControl, controlPoint, currentEndPoint]);
        const hoseGeo = new THREE.TubeGeometry(curve, 20, 0.05, 8, false);
        const hoseMat = new THREE.MeshPhysicalMaterial({
            color: 0x1e1e1e,
            metalness: 0.0,
            roughness: 0.95,
            specularIntensity: 0.15,
            specularColor: new THREE.Color(0x2a2a2a),
            sheen: 0.2,
            sheenRoughness: 0.85,
        });
        hoseMesh = new THREE.Mesh(hoseGeo, hoseMat);
        hoseMesh.name = 'hoseMesh';
        hoseMesh.castShadow = true;
        scene.add(hoseMesh);
        return hoseMesh;
    }
    return { updateHose };
}
