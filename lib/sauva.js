import * as THREE from 'three';
import { tweenTo, tweenQuatTo } from './animUtils.js';

// Stirring rod (sauva) as a reusable module
// API:
//   const sauva = createSauva(scene);
//   sauva.placeOnTable(pos, { yaw, tiltX, tiltZ });
//   await runSauvaSequence({ sauva, beakerGroup, beakerRadius, waterSurfaceY, durationSec });
//   sauva.update(dt);

export function createSauva(scene) {
    const sauvaGroup = new THREE.Group();
    sauvaGroup.name = 'sauvaGroup';

    // Geometry: thin cylinder (rod), pivoting reference at geometric center
    const RADIUS = 0.05;
    const LENGTH = 3.2;
    const rodGeo = new THREE.CylinderGeometry(RADIUS, RADIUS, LENGTH, 24);
    const rodMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.8, roughness: 0.35 });
    const rod = new THREE.Mesh(rodGeo, rodMat);
    rod.castShadow = true;
    rod.receiveShadow = true;
    rod.name = 'stirRod';
    sauvaGroup.add(rod);

    // Internal stirring pivot (created when needed)
    const stirPivot = new THREE.Object3D();
    stirPivot.name = 'sauvaStirPivot';
    stirPivot.visible = false; // added to scene only when stirring

    const state = {
        isAnimating: false,
        isSelected: false,
        pendingReturn: false,
        restPosition: new THREE.Vector3(),
        restQuaternion: new THREE.Quaternion(),
        stirring: false,
        stirElapsed: 0,
        stirDuration: 0,
        // stirring parameters
        mainRotationSpeed: 2.2, // rad/s
        wobbleRadius: 0.18,
        wobbleSpeed: 2.8, // rad/s
        length: LENGTH
    };

    scene.add(sauvaGroup);

    function placeOnTable(position, optionsOrYaw = 0) {
        const opts = (typeof optionsOrYaw === 'number') ? { yaw: optionsOrYaw } : (optionsOrYaw || {});
        const yaw = opts.yaw || 0;
        const tiltX = opts.tiltX ?? 0; // small pitch tweak
        const tiltZ = opts.tiltZ ?? 0; // small roll tweak
        sauvaGroup.position.copy(position);
        // Lay horizontally: rotate -90deg around X so cylinder lies on table
        sauvaGroup.rotation.set(-Math.PI / 2 + tiltX, yaw, tiltZ);
        // Align so the lowest point of the rod sits just above table using world bbox
        sauvaGroup.updateMatrixWorld(true);
        const bbox = new THREE.Box3().setFromObject(rod);
        const tableY = position.y;
    const LIFT_EPS = 0.004; // pienennetty jotta sauva lepää lähempänä pöytää
        const minY = bbox.min.y;
        const deltaY = (tableY + LIFT_EPS) - minY;
        sauvaGroup.position.y += deltaY;
        // Save rest pose
        state.restPosition.copy(sauvaGroup.position);
        sauvaGroup.getWorldQuaternion(state.restQuaternion);
    }

    function update(dt) {
        if (!state.stirring) return;
        state.stirElapsed += dt;
        // Spin around pivot Y
        stirPivot.rotation.y += state.mainRotationSpeed * dt;
        // Wobble pivot slightly in XZ plane
        const t = state.stirElapsed * state.wobbleSpeed;
        stirPivot.position.x = state.wobbleRadius * Math.cos(t);
        stirPivot.position.z = state.wobbleRadius * Math.sin(t);
        // Stop after duration
        if (state.stirElapsed >= state.stirDuration) {
            state.stirring = false;
            stirPivot.visible = false;
            // Keep sauva where it is (inside beaker) and detach from pivot
            // Re-parent back to scene to avoid keeping hidden pivot as parent
            const worldPos = new THREE.Vector3();
            const worldQuat = new THREE.Quaternion();
            sauvaGroup.getWorldPosition(worldPos);
            sauvaGroup.getWorldQuaternion(worldQuat);
            scene.attach(sauvaGroup);
            sauvaGroup.position.copy(worldPos);
            sauvaGroup.quaternion.copy(worldQuat);
            // Remove pivot from scene
            if (stirPivot.parent) stirPivot.parent.remove(stirPivot);
            state.isAnimating = false;
            state.isSelected = false;
        }
    }

    function select() {
        if (state.isAnimating) return false;
        if (state.isSelected) return true;
        state.isSelected = true;
        state.isAnimating = true;
        const targetY = sauvaGroup.position.y + 0.35;
        const T = (typeof window !== 'undefined' && window.TWEEN) ? window.TWEEN : null;
        const easeOut = T ? T.Easing.Quadratic.Out : ((k)=>k);
        return tweenTo(sauvaGroup.position, { y: targetY }, 220, easeOut).finally(() => {
            state.isAnimating = false;
            if (state.pendingReturn) {
                state.pendingReturn = false;
                returnToRest();
            }
        });
    }

    function returnToRest() {
        if (state.isAnimating) { state.pendingReturn = true; return Promise.resolve(false); }
        state.isAnimating = true;
        state.isSelected = false;
        const T = (typeof window !== 'undefined' && window.TWEEN) ? window.TWEEN : null;
        const easeOut = T ? T.Easing.Quadratic.Out : ((k)=>k);
        const easeInOut = T ? T.Easing.Quadratic.InOut : ((k)=>k);
        return tweenQuatTo(sauvaGroup, state.restQuaternion, 260, easeInOut)
            .then(() => tweenTo(sauvaGroup.position, { x: state.restPosition.x, y: state.restPosition.y, z: state.restPosition.z }, 260, easeOut))
            .then(() => { state.isAnimating = false; state.pendingReturn = false; return true; });
    }

    return { sauvaGroup, rod, placeOnTable, update, state, stirPivot, select, returnToRest };
}

// Move rod from table to beaker and start stirring animation
export function runSauvaSequence({ sauva, beakerGroup, beakerRadius, waterSurfaceY, durationSec = 5 }) {
    return new Promise((resolve) => {
        if (!sauva || sauva.state.isAnimating) return resolve();
        const { sauvaGroup, stirPivot, state } = sauva;
        state.isAnimating = true;

        // Targets
        const beakerWorld = new THREE.Vector3();
        beakerGroup.getWorldPosition(beakerWorld);
        const beakerCenterXZ = { x: beakerWorld.x, z: beakerWorld.z };
        // Ensure travel height clears the beaker rim noticeably to avoid sidewall intersection
        const beakerTopY = waterSurfaceY * 2.0;
        const baseSafe = Math.max(sauvaGroup.position.y + 0.8, waterSurfaceY + 1.2);
        const safeY = Math.max(baseSafe, beakerTopY + 2.3); // go above rim by 0.3
        const insertY = waterSurfaceY + 0.35; // immersion depth

        // Easing helpers
        const easeInOut = TWEEN.Easing.Quadratic.InOut;
        const easeOut = TWEEN.Easing.Quadratic.Out;
        const easeLinear = (k) => k;
        const tweenPos = (to, dur, ease) => tweenTo(sauvaGroup.position, to, dur, ease);

        // 1) Rotate upright first (preserving current yaw)
        const qVertical = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sauvaGroup.rotation.y, 0));

    tweenQuatTo(sauvaGroup, qVertical, 350, easeInOut)
            // 2) Rise up to safe height
            .then(() => tweenPos({ y: safeY }, 300, easeOut))
            // 3) Move above beaker (no intersection with glass)
            .then(() => tweenPos({ x: beakerCenterXZ.x, z: beakerCenterXZ.z }, 650, easeInOut))
            // 4) Lower into liquid
            .then(() => tweenPos({ y: insertY }, 350, easeOut))
            // 5) Stir exactly two fast rotations with slight tilt and top-end circle
            .then(() => new Promise((res) => {
                // Prepare pivot at beaker center
                stirPivot.position.set(beakerCenterXZ.x, insertY, beakerCenterXZ.z);
                stirPivot.rotation.set(0, 0, 0);
                // Attach pivot to sauva's parent to keep coordinates consistent
                if (!stirPivot.parent) (sauvaGroup.parent || sauvaGroup).add(stirPivot);
                stirPivot.visible = true;

                // Preserve world transform and parent sauva under pivot
                const worldPos = new THREE.Vector3();
                const worldQuat = new THREE.Quaternion();
                sauvaGroup.getWorldPosition(worldPos);
                sauvaGroup.getWorldQuaternion(worldQuat);
                stirPivot.add(sauvaGroup);
                sauvaGroup.position.copy(stirPivot.worldToLocal(worldPos.clone()));
                sauvaGroup.quaternion.copy(worldQuat);

                // Give small radial offset so top draws a circle; also apply slight tilt
                const radial = Math.max(0.15, beakerRadius * 0.25);
                sauvaGroup.position.x += radial;
                const tiltAngle = THREE.MathUtils.degToRad(12);
                const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tiltAngle);
                sauvaGroup.quaternion.multiply(qTilt);

                // Spin pivot: 2 full turns
                const startYRot = stirPivot.rotation.y;
                const targetYRot = startYRot + Math.PI * 4; // two rotations
                const tween = new TWEEN.Tween(stirPivot.rotation)
                    .to({ y: targetYRot }, 1200)
                    .easing(easeLinear)
                    .onComplete(() => {
                        // Detach sauva, keep world transform
                        const wPos2 = new THREE.Vector3();
                        const wQuat2 = new THREE.Quaternion();
                        sauvaGroup.getWorldPosition(wPos2);
                        sauvaGroup.getWorldQuaternion(wQuat2);
                        // Reattach to scene root (or previous parent)
                        const parent = stirPivot.parent;
                        if (parent) parent.add(sauvaGroup);
                        sauvaGroup.position.copy(wPos2);
                        sauvaGroup.quaternion.copy(wQuat2);
                        // Cleanup pivot
                        if (stirPivot.parent) stirPivot.parent.remove(stirPivot);
                        stirPivot.visible = false;
                        res();
                    })
                    .start();
            }))
            // 6) Lift out to safe height
            .then(() => tweenPos({ y: safeY }, 350, easeOut))
            .then(() => {
                // Signal powder system to stop swirl/dissolve (water returns to unstirred)
                try { if (window && window._powder && typeof window._powder.stopSwirl === 'function') window._powder.stopSwirl(); } catch {}
            })
            // 7) Move back above original rest position
            .then(() => tweenPos({ x: state.restPosition.x, z: state.restPosition.z }, 700, easeInOut))
            // 8) Rotate back to rest orientation
            .then(() => tweenQuatTo(sauvaGroup, state.restQuaternion, 350, easeInOut))
            // 9) Lower to table
            .then(() => tweenPos({ y: state.restPosition.y }, 300, easeOut))
            .then(() => {
                state.isAnimating = false;
                state.isSelected = false;
                resolve();
            });
    });
}

// Animator factory for sauva to encapsulate animation entry points
export function createSauvaAnimator(sauva, defaultOptions = {}) {
    return {
        // Start the standard beaker stirring sequence; options can override durationSec, etc.
        stirAtBeaker: (args = {}) => runSauvaSequence({ sauva, ...defaultOptions, ...args }),
        setOptions: (opts) => Object.assign(defaultOptions, opts),
        getOptions: () => ({ ...defaultOptions })
    };
}
