import * as THREE from 'three';
import { tweenTo, tweenQuatTo } from './animUtils.js';

// Spaatteli (lusikka) + jauhepartikkelit kapseloituna moduliksi
// Käyttö:
//   const spatula = createSpaatteli(scene);
//   await runSpaatteliSequence({ spatula, solidMesh, beakerGroup, beakerRadius, waterSurfaceY });
//   animaatioloopissa: spatula.update(dt)

// Pieni apu satunnaisuuteen (deterministinen siemen kahdesta kokonaisluvusta)
function hash2(i, j) {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
}

// Nopea kulman “kohina” ilman tekstuureja (summa muutamasta siniaallosta)
function angularNoise(theta, seed = 0.0) {
    return 0.5 * Math.sin(3.0 * theta + seed) + 0.3 * Math.sin(7.0 * theta + seed * 1.7) + 0.2 * Math.sin(11.0 * theta + seed * 2.3);
}

// Parabolinen kummun korkeus + pieni satunnaisuus
function moundHeight(r, R, h, jitter) {
    const t = r / R;
    const base = h * Math.max(0, 1 - t * t);
    return base + jitter;
}

// Luo matala, rakeinen kumpu polaarisena ruutuna; epäsäännöllinen reuna ja pinnan pientä vaihtelua
function createPowderMoundGeometry({ radius = 0.36, height = 0.12, radialSegs = 40, ringSegs = 10 } = {}) {
    const R = radius;
    const rings = Math.max(2, ringSegs);
    const segs = Math.max(8, radialSegs);
    const positions = [];
    const normals = [];
    const indices = [];
    const colors = [];

    // Esilasketaan kulmakohina reunan muotoiluun
    const noiseSeed = Math.random() * 1000.0;
    const edgeNoise = new Array(segs + 1).fill(0).map((_, j) => angularNoise((j / segs) * Math.PI * 2.0, noiseSeed));

    // Generoi renkaat keskustasta kohti reunaa
    for (let i = 0; i <= rings; i++) {
        const fr = i / rings; // 0..1
        for (let j = 0; j <= segs; j++) {
            const ft = j / segs;
            const theta = ft * Math.PI * 2.0;
            // Reunan epäsäännöllisyys voimistuu ulkokehällä
            const irregular = 1.0 + (edgeNoise[j] || 0) * 0.06 * Math.pow(fr, 2.0);
            const r = R * fr * irregular;
            // Pinnan pieni granulaarinen vaihtelu
            const cellJitter = (hash2(i, j) - 0.5) * 0.02;
            const y = moundHeight(r, R, height, cellJitter);
            const x = Math.cos(theta) * r;
            const z = Math.sin(theta) * r;
            positions.push(x, y, z);
            // Lähes valkoinen harmaasävy, pieni vaihtelu – ei tummaa pisteisyyttä
            const g = 0.98 + (hash2(j, i) - 0.5) * 0.04; // 0.96..1.00
            colors.push(g, g, g);
        }
    }

    // Indeksit kolmio-nauhoina renkaiden välillä
    const stride = segs + 1;
    for (let i = 0; i < rings; i++) {
        for (let j = 0; j < segs; j++) {
            const a = i * stride + j;
            const b = a + 1;
            const c = (i + 1) * stride + j;
            const d = c + 1;
            indices.push(a, c, b);
            indices.push(b, c, d);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

export function createSpaatteli(scene) {
    const spatulaGroup = new THREE.Group();
    spatulaGroup.name = 'spatulaGroup';
    // Scale spatula to 50%
    spatulaGroup.scale.setScalar(0.5);
    const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.2, side: THREE.DoubleSide });

    // Lusikan "kuppi"
    const scoopGeometry = new THREE.SphereGeometry(0.6, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
    scoopGeometry.computeBoundingBox();
    const blade = new THREE.Mesh(scoopGeometry, bladeMaterial);
    blade.name = 'spatulaBlade';
    blade.scale.x = 0.7;
    blade.rotation.x = Math.PI;
    blade.position.z = -0.6;
    blade.castShadow = true;
    spatulaGroup.add(blade);

    // Jauhe lusikan päällä (näkymätön kunnes kauhitaan) – korvattu granulaarisella kummulla ja pikkupaakuilla
    const powderOnBlade = new THREE.Group();
    powderOnBlade.position.set(0, -0.15, -0.6);
    powderOnBlade.rotation.x = Math.PI;
    powderOnBlade.scale.x = 0.7;
    powderOnBlade.visible = false;
    powderOnBlade.name = 'powderOnBlade';
    // Matalan kummun geometria
    const moundGeom = createPowderMoundGeometry({ radius: 0.36, height: 0.12, radialSegs: 40, ringSegs: 10 });
    const powderMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0, vertexColors: true, side: THREE.DoubleSide });
    const clumpMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0 });
    const moundMesh = new THREE.Mesh(moundGeom, powderMat);
    moundMesh.castShadow = true;
    powderOnBlade.add(moundMesh);
    // Lisätään muutama pieni paakku reunalle/huipulle
    const clumpGeom = new THREE.SphereGeometry(0.05, 12, 8);
    const CLUMPS = 10;
    for (let k = 0; k < CLUMPS; k++) {
        const t = Math.random();
        // Sijoita hieman painotettuna reunalle (sqrt jakauma) ja satunnainen kulma
        const r = 0.36 * Math.sqrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = moundHeight(r, 0.36, 0.12, (Math.random() - 0.5) * 0.015) + 0.01;
        const clump = new THREE.Mesh(clumpGeom, clumpMat);
        clump.position.set(x, y, z);
        const s = 0.7 + Math.random() * 0.8;
        clump.scale.setScalar(s);
        // Vältä pienistä paakuista syntyviä pistevarjoja
        clump.castShadow = false;
        powderOnBlade.add(clump);
    }
    spatulaGroup.add(powderOnBlade);

    // Kahva
    const handleGeometry = new THREE.BoxGeometry(0.2, 0.05, 3);
    handleGeometry.computeBoundingBox();
    const handle = new THREE.Mesh(handleGeometry, bladeMaterial);
    handle.name = 'spatulaHandle';
    handle.position.z = 1.5;
    handle.castShadow = true;
    spatulaGroup.add(handle);

    // Initially visible; will be positioned on the table by placeOnTable()
    spatulaGroup.visible = true;
    scene.add(spatulaGroup);
    // Enable shadows for all spatula meshes
    try { spatulaGroup.traverse(o => { if (o.isMesh) { o.castShadow = true; } }); } catch {}

    const state = {
        isAnimating: false,
        isSelected: false,
        pendingReturn: false,
        restPosition: new THREE.Vector3(),
        restQuaternion: new THREE.Quaternion(),
        bottomYWorld: 0,
        beakerCenterWorld: new THREE.Vector3(),
        beakerRadius: 0.95,
        hasFlipped: false,
        hasPowder: false
    };
    function update(dt) { /* powder removed; no-op for now */ }

    function placeOnTable(position, optionsOrYaw = 0) {
        // Lay on the table at given position with configurable yaw and subtle tilts for realism
        const opts = (typeof optionsOrYaw === 'number') ? { yaw: optionsOrYaw } : (optionsOrYaw || {});
        const yaw = opts.yaw || 0;
        const tiltX = opts.tiltX || 0; // pitch adjustment
        const tiltZ = opts.tiltZ || 0; // roll left/right
        // Start with yaw only; we'll solve pitch so that two contact points share same height
        spatulaGroup.position.copy(position);
        spatulaGroup.rotation.set(0, yaw, 0);
        // Ensure world matrices are current before sampling
        spatulaGroup.updateMatrixWorld(true);
        // Identify two representative local points in spatulaGroup space
        const bladeMesh = spatulaGroup.getObjectByName('spatulaBlade');
        const handleMesh = spatulaGroup.getObjectByName('spatulaHandle');
        let yb = 0, zb = 0, yh = 0, zh = 0;
        if (bladeMesh && bladeMesh.geometry && bladeMesh.geometry.boundingBox) {
            // Use the lowest point on blade's geometry in local y as cup underside sample
            yb = bladeMesh.geometry.boundingBox.min.y;
            zb = bladeMesh.position.z; // approximate center along z
        }
        if (handleMesh && handleMesh.geometry && handleMesh.geometry.boundingBox) {
            // Use bottom at y min and far tip at z max
            yh = handleMesh.geometry.boundingBox.min.y;
            zh = handleMesh.geometry.boundingBox.max.z + handleMesh.position.z;
        }
        // Solve for pitch so y' of both sample points are equal after rotation around X
        // y' = y*cos(a) - z*sin(a) ⇒ (yb - yh)*cos(a) = (zb - zh)*sin(a) ⇒ a = atan2(yb - yh, zb - zh)
        const denom = (zb - zh);
        let pitch = 0;
        if (Math.abs(denom) > 1e-4) {
            pitch = Math.atan2((yb - yh), denom);
        } else {
            pitch = -0.12; // fallback reasonable tilt
        }
        pitch += tiltX; // allow manual tweak
        spatulaGroup.rotation.x = pitch;
        spatulaGroup.rotation.z = tiltZ;
        // Now set vertical so both contact points lie on tableY (position.y provided)
        const tableY = position.y;
        // Compute current world Y of either sample after rotations
        const tmpV = new THREE.Vector3(0, yb, zb).applyMatrix4(bladeMesh.matrixWorld);
        const offsetY = tableY - tmpV.y;
        // Add a tiny lift epsilon to avoid z-fighting/sinking into table
        const LIFT_EPS = 0.012;
        spatulaGroup.position.y += (offsetY + LIFT_EPS);
        spatulaGroup.visible = true;
        state.isSelected = false;
        // Save as rest pose
        state.restPosition.copy(spatulaGroup.position);
        spatulaGroup.getWorldQuaternion(state.restQuaternion);
    }

    function select() {
        if (state.isAnimating) return false;
        if (state.isSelected) return true;
        state.isSelected = true;
        state.isAnimating = true;
        const targetPos = { y: spatulaGroup.position.y + 0.35 };
        const T = (typeof window !== 'undefined' && window.TWEEN) ? window.TWEEN : null;
        const easeOut = T ? T.Easing.Quadratic.Out : ((k)=>k);
        const easeInOut = T ? T.Easing.Quadratic.InOut : ((k)=>k);
        // Nostetaan ja käännetään 180° vain valinnan yhteydessä
        tweenTo(spatulaGroup.position, targetPos, 220, easeOut)
            .then(() => tweenTo(spatulaGroup.rotation, { z: spatulaGroup.rotation.z + Math.PI }, 220, easeInOut))
            .then(() => {
                // Merkitään että valintaflip tehty (nyt erotaan rest-asennosta);
                // Huom: emme päivitä restQuaternionia – palautuksessa aina käännytään takaisin lepokvaternioniin.
                state.hasFlipped = true;
            })
            .finally(() => {
                state.isAnimating = false;
                if (state.pendingReturn) {
                    state.pendingReturn = false;
                    returnToRest();
                }
            });
        return true;
    }

    function returnToRest() {
        if (state.isAnimating) { state.pendingReturn = true; return Promise.resolve(false); }
        state.isAnimating = true;
        state.isSelected = false;
        const T = (typeof window !== 'undefined' && window.TWEEN) ? window.TWEEN : null;
        const easeOut = T ? T.Easing.Quadratic.Out : ((k)=>k);
        const easeInOut = T ? T.Easing.Quadratic.InOut : ((k)=>k);
        return tweenQuatTo(spatulaGroup, state.restQuaternion, 240, easeInOut)
            .then(() => tweenTo(spatulaGroup.position, { x: state.restPosition.x, y: state.restPosition.y, z: state.restPosition.z }, 260, easeOut))
            .then(() => { state.isAnimating = false; state.pendingReturn = false; return true; });
    }

    return { spatulaGroup, powderOnBlade, update, state, placeOnTable, select, returnToRest };
}

// Suorita koko kauhaisun ja kaadon animaatio
function runSpaatteliSequenceWithOptions({ spatula, solidMesh, beakerGroup, beakerRadius, waterSurfaceY }, opts = {}) {
    const cfg = {
        pitchAngleDeg: 75,         
        descentOffset: 0.12,        // distance above powder
        durations: {
            moveAboveJar: 900,
            pitchAtJar: 280,
            entry: 900,
            lift: 900,
            level: 500,
            moveToBeaker: 1100,
            pourTilt: 500,
            returnToRest: 450,
        },
        ...opts
    };

    return new Promise((resolve) => {
        if (!spatula || spatula.state.isAnimating) return resolve();
        const { spatulaGroup, powderOnBlade, spawnPowderAt, state } = spatula;
        state.isAnimating = true;
        spatulaGroup.visible = true;

        // Paikat
        const solidTop = new THREE.Vector3();
        solidMesh.getWorldPosition(solidTop);
        const beakerPos = new THREE.Vector3();
        beakerGroup.getWorldPosition(beakerPos);
    const beakerDropPos = new THREE.Vector3(beakerPos.x, waterSurfaceY + 0.2, beakerPos.z);

    const beakerTopY = waterSurfaceY * 2.0;
        const startY = Math.max(spatulaGroup.position.y, beakerTopY + 0.5, solidTop.y + 2.5);
        const safeY = Math.max(startY, beakerTopY + 0.5, solidTop.y + 2.5);

    const ENTRY_MS = cfg.durations.entry;
    const LIFT_MS = cfg.durations.lift;
    const LEVEL_MS = cfg.durations.level;
    const MOVE_TO_BEAKER_MS = cfg.durations.moveToBeaker;
    const ROTATE_MS = cfg.durations.pourTilt;
    const RETURN_MS = cfg.durations.returnToRest;

        // Helpers
        const easeInOut = TWEEN.Easing.Quadratic.InOut;
        const easeOut = TWEEN.Easing.Quadratic.Out;
        const easeCubicOut = TWEEN.Easing.Cubic.Out;
        const tweenPos = (to, dur, ease) => tweenTo(spatulaGroup.position, to, dur, ease);
        const tweenRotZ = (to, dur, ease) => tweenTo(spatulaGroup.rotation, { z: to }, dur, ease);

        // Sequence
        let appliedPitchQuat = null;
        tweenPos({ x: solidTop.x, z: solidTop.z, y: safeY }, cfg.durations.moveAboveJar, easeInOut)
            .then(() => {
                // Compute local lateral axis and choose pitch that lowers the bowl
                const q0 = spatulaGroup.quaternion.clone();
                const handleWorld = new THREE.Vector3();
                const bowlWorld = new THREE.Vector3();
                spatulaGroup.getObjectByName('spatulaHandle').getWorldPosition(handleWorld);
                powderOnBlade.getWorldPosition(bowlWorld);
                const invMat = new THREE.Matrix4().copy(spatulaGroup.matrixWorld).invert();
                const handleLocal = handleWorld.clone().applyMatrix4(invMat);
                const bowlLocal = bowlWorld.clone().applyMatrix4(invMat);
                const longitudinal = bowlLocal.clone().sub(handleLocal).normalize();
                let up = new THREE.Vector3(0, 1, 0);
                if (Math.abs(longitudinal.dot(up)) > 0.95) up = new THREE.Vector3(0, 0, 1);
                const lateral = up.clone().cross(longitudinal).normalize();
                const anglePitch = THREE.MathUtils.degToRad(cfg.pitchAngleDeg);
                const qPitchPos = new THREE.Quaternion().setFromAxisAngle(lateral, anglePitch);
                const qPitchNeg = new THREE.Quaternion().setFromAxisAngle(lateral, -anglePitch);
                const cand = [q0.clone().multiply(qPitchPos), q0.clone().multiply(qPitchNeg)];
                let bestIdx = 0, bestY = Infinity;
                const orig = spatulaGroup.quaternion.clone();
                for (let i = 0; i < 2; i++) {
                    spatulaGroup.quaternion.copy(cand[i]);
                    spatulaGroup.updateMatrixWorld(true);
                    const w = new THREE.Vector3();
                    powderOnBlade.getWorldPosition(w);
                    if (w.y < bestY) { bestY = w.y; bestIdx = i; }
                }
                spatulaGroup.quaternion.copy(orig);
                spatulaGroup.updateMatrixWorld(true);
                appliedPitchQuat = bestIdx === 0 ? qPitchPos : qPitchNeg;
                const chosen = cand[bestIdx];
                return tweenQuatTo(spatulaGroup, chosen, cfg.durations.pitchAtJar, easeOut);
            })
            .then(() => tweenPos({ y: solidTop.y + cfg.descentOffset }, ENTRY_MS, easeCubicOut))
            .then(() => {
                // Begin lift and simultaneously level the spatula back to horizontal during the lift
                powderOnBlade.visible = true;
                state.hasPowder = true; // merkitään että lusikka on ladattu jauheella
                // Inherit current jar powder color if available
                try {
                    const src = solidMesh && solidMesh.material ? solidMesh.material.color : null;
                    if (src) {
                        // Kopioi väri sekä kummun vertexColor-materiaaliin että paakkujen materiaaliin
                        powderOnBlade.traverse(o => { if (o.isMesh && o.material && o.material.color) o.material.color.copy(src); });
                    }
                } catch {}
                const qLevel = spatulaGroup.quaternion.clone().multiply(appliedPitchQuat.clone().invert());
                const posP = tweenPos({ y: safeY }, LIFT_MS, easeCubicOut);
                const rotP = tweenQuatTo(spatulaGroup, qLevel, LIFT_MS, easeInOut);
                return Promise.all([posP, rotP]);
            })
            .then(() => {
                // At this point selection remains true; waiting for beaker click to pour.
                state.isAnimating = false;
                resolve();
            });
    });
}

export function runSpaatteliSequence(args) {
    return runSpaatteliSequenceWithOptions(args);
}

// Pour sequence to be called after selection and jar-scoop are done
export function runSpaatteliPour({ spatula, beakerGroup, beakerRadius, waterSurfaceY, onPour }, opts = {}) {
    return new Promise((resolve) => {
    if (!spatula || spatula.state.isAnimating) return resolve();
    if (!spatula.state.hasPowder) { return resolve(); } // estä kaato ilman jauhetta
        const { spatulaGroup, powderOnBlade, state } = spatula;
        state.isAnimating = true;

        const beakerPos = new THREE.Vector3();
        beakerGroup.getWorldPosition(beakerPos);
        const beakerDropPos = new THREE.Vector3(beakerPos.x, waterSurfaceY + 0.2, beakerPos.z);
        const T = (typeof window !== 'undefined' && window.TWEEN) ? window.TWEEN : null;
        const easeInOut = T ? T.Easing.Quadratic.InOut : ((k)=>k);
        const ROTATE_MS = (opts.durations?.pourTilt) || 500;
        const RETURN_MS = (opts.durations?.returnToRest) || 450;

        // Kaadon aikana tehdään suhteellinen 180° flip kaatoefektiä varten.
        // Tämän jälkeen palautetaan AINA lepokvaternioniin ennen pöydälle laskua.
        let pourDidFlip = true; // seuraa tehtiinkö kaatoflip
        tweenTo(spatulaGroup.position, { x: beakerDropPos.x, z: beakerDropPos.z }, (opts.durations?.moveToBeaker) || 900, easeInOut)
            .then(() => {
                return tweenTo(spatulaGroup.rotation, { z: spatulaGroup.rotation.z + Math.PI }, ROTATE_MS, T ? T.Easing.Quadratic.In : ((k)=>k));
            })
            .then(() => {
                let minY = Infinity;
                const under = new THREE.Vector3();
                powderOnBlade.updateMatrixWorld(true);
                powderOnBlade.traverse(o => {
                    if (!o.isMesh || !o.geometry) return;
                    o.geometry.computeBoundingBox();
                    const bb = o.geometry.boundingBox;
                    const candidates = [
                        new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
                        new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
                        new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
                        new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z)
                    ];
                    for (const c of candidates) {
                        const w = c.clone().applyMatrix4(o.matrixWorld);
                        if (w.y < minY) { minY = w.y; under.copy(w); }
                    }
                });
                const worldUnder = under.clone();
                powderOnBlade.visible = false;
                state.hasPowder = false; // kaadon jälkeen tyhjä
                const hit = new THREE.Vector3(worldUnder.x, worldUnder.y - 0.02, worldUnder.z);
                if (typeof onPour === 'function') { try { onPour(hit.clone()); } catch {} }
                const restPos = spatula.state.restPosition.clone();
                // Kaatoflip palauttaa orientaation mahdollisesti alkuperäiseen tai invertteriin riippuen aiemmasta tilasta.
                // Joka tapauksessa varmistetaan että ennen pöydälle laskua mennään lepokvaternioniin.
                const qRest = spatula.state.restQuaternion.clone();
                return tweenQuatTo(spatulaGroup, qRest, 320, easeInOut)
                    .then(() => { spatula.state.hasFlipped = false; })
                    .then(() => tweenTo(spatulaGroup.position, { x: restPos.x, y: restPos.y, z: restPos.z }, RETURN_MS, easeInOut));
            })
            .then(() => {
                state.isAnimating = false;
                state.isSelected = false;
                resolve();
            });
    });
}

// Animator factory for encapsulation and easy overrides
export function createSpaatteliAnimator(spatula, defaultOptions = {}) {
    return {
        run: (args, overrides = {}) => runSpaatteliSequenceWithOptions({ spatula, ...args }, { ...defaultOptions, ...overrides }),
        setOptions: (opts) => Object.assign(defaultOptions, opts),
        getOptions: () => ({ ...defaultOptions }),
    };
}
