import * as THREE from 'three';
// Kaasupullon luonti ja logiikka
// Yleisapu: smoothstep (CPU-puolella käytettävä)
function smoothstep(edge0, edge1, x) {
	const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
	return t * t * (3 - 2 * t);
}
// Pieni apufunktio: luo laatoittuva (tileable) kulunut pintatekstuuri normal- ja roughness-mappeina
function createWornMetalTextures({ size = 128, normalStrength = 2.0, repeat = new THREE.Vector2(8, 12), seed = 1337 } = {}) {
	// Luo tileable korkeusmap pohjaksi (satunnaiskenttä + wrap-aaltoileva blur -> pehmeä grunge)
	const w = size, h = size;
	const rand = (n) => {
		let t = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
		return t - Math.floor(t);
	};
	const idx = (x, y) => ((y + h) % h) * w + ((x + w) % w);
	const height = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			height[idx(x, y)] = rand(x * 17.0 + y * 131.0 + seed);
		}
	}
	// Kaksi box-blur -kierrosta eri säteillä, wrapaten reunat -> kahta skaalaa oleva noise
	function boxBlur(src, radius) {
		const out = new Float32Array(w * h);
		const area = (2 * radius + 1) * (2 * radius + 1);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				let acc = 0;
				for (let j = -radius; j <= radius; j++) {
					for (let i = -radius; i <= radius; i++) {
						acc += src[idx(x + i, y + j)];
					}
				}
				out[idx(x, y)] = acc / area;
			}
		}
		return out;
	}
	const large = boxBlur(height, 4);
	const small = boxBlur(height, 2);
	const mixed = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const a = large[idx(x, y)];
			const b = small[idx(x, y)];
			mixed[idx(x, y)] = 0.7 * a + 0.3 * b;
		}
	}
	// Normal-map johdetaan korkeuskartasta (keskitetty derivaatta), varoen V-akselin suuntaa
	const normalData = new Uint8Array(w * h * 3);
	const roughData = new Uint8Array(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const hL = mixed[idx(x - 1, y)];
			const hR = mixed[idx(x + 1, y)];
			const hU = mixed[idx(x, y - 1)];
			const hD = mixed[idx(x, y + 1)];
			let dx = (hR - hL);
			let dy = (hD - hU); // huom: kuvan V kasvaa alas -> tämä tuottaa oikein suunnatun vihreän kanavan Three.js:lle
			dx *= normalStrength;
			dy *= normalStrength;
			const nx = -dx;
			const ny = -dy;
			const nz = 1.0;
			const invLen = 1.0 / Math.hypot(nx, ny, nz);
			const Nx = nx * invLen, Ny = ny * invLen, Nz = nz * invLen;
			const o = (y * w + x) * 3;
			normalData[o + 0] = Math.min(255, Math.max(0, Math.round((Nx * 0.5 + 0.5) * 255)));
			normalData[o + 1] = Math.min(255, Math.max(0, Math.round((Ny * 0.5 + 0.5) * 255)));
			normalData[o + 2] = Math.min(255, Math.max(0, Math.round((Nz * 0.5 + 0.5) * 255)));
			// Roughness: hieman kiillottomampi (suurempi roughness) koholla, ja satunnaista kulumaa
			const hVal = mixed[idx(x, y)];
			const rough = 0.45 + 0.45 * hVal; // 0.45..0.9
			const r8 = Math.min(255, Math.max(0, Math.round(rough * 255)));
			roughData[o + 0] = r8;
			roughData[o + 1] = r8;
			roughData[o + 2] = r8;
		}
	}
	const normalMap = new THREE.DataTexture(normalData, w, h, THREE.RGB);
	normalMap.wrapS = THREE.RepeatWrapping;
	normalMap.wrapT = THREE.RepeatWrapping;
	normalMap.repeat.copy(repeat);
	normalMap.needsUpdate = true;
	const roughnessMap = new THREE.DataTexture(roughData, w, h, THREE.RGB);
	roughnessMap.wrapS = THREE.RepeatWrapping;
	roughnessMap.wrapT = THREE.RepeatWrapping;
	roughnessMap.repeat.copy(repeat);
	roughnessMap.needsUpdate = true;
	return { normalMap, roughnessMap };
}

// Maalattu metalli (punainen maali) ilman erillisiä assetteja: luodaan väri-, normal-, roughness- ja metalness-mapit
function createPaintedMetalTextures({
		size = 128,
		baseColor = new THREE.Color(0xd32f2f),
		repeat = new THREE.Vector2(4, 2),
		normalStrength = 0.6,
		edgeWidth = 0.12, // 0..0.5 suhteessa UV:hen
		edgeWearIntensity = 0.18, // kuinka paljon metallia paljastuu reunoissa
		seed = 9001
	} = {}) {
	const w = size, h = size;
	const rand = (n) => {
		let t = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
		return t - Math.floor(t);
	};
	const idx = (x, y) => y * w + x;
	// Perus kohinakenttä oranssinkuori (orange-peel) pintaan
	const height = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const n = rand(x * 19.27 + y * 113.7 + seed);
			const n2 = rand(x * 3.71 + y * 5.11 + seed * 1.7);
			height[idx(x, y)] = 0.65 * n + 0.35 * n2;
		}
	}
	function boxBlur(src, radius) {
		const out = new Float32Array(w * h);
		const area = (2 * radius + 1) * (2 * radius + 1);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				let acc = 0;
				for (let j = -radius; j <= radius; j++) {
					for (let i = -radius; i <= radius; i++) {
						const xi = (x + i + w) % w, yj = (y + j + h) % h;
						acc += src[idx(xi, yj)];
					}
				}
				out[idx(x, y)] = acc / area;
			}
		}
		return out;
	}
	const smooth = boxBlur(height, 1);
	// Reunakuluman maski UV-reunojen mukaan
	const edgeMask = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const u = x / (w - 1);
			const v = y / (h - 1);
			const d = Math.min(u, 1 - u, v, 1 - v);
			const e = 1 - smoothstep(edgeWidth, edgeWidth * 2.0, d);
			edgeMask[idx(x, y)] = e;
		}
	}
	// Pienet sirut vain osassa reunoja -> binäärinen, pehmennetty maski
	const chipMask = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const n = rand(x * 7.123 + y * 9.431 + seed * 2.3);
			const c = n > 0.7 ? 1.0 : 0.0; // harvakseltaan
			chipMask[idx(x, y)] = c * edgeMask[idx(x, y)];
		}
	}
	// Normal-map korkeuserosta
	const normalData = new Uint8Array(w * h * 3);
	// Väri-, roughness- ja metalness-mapit
	const colorData = new Uint8Array(w * h * 3);
	const roughData = new Uint8Array(w * h * 3);
	const metalData = new Uint8Array(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const o = (y * w + x) * 3;
			const hL = smooth[idx((x - 1 + w) % w, y)];
			const hR = smooth[idx((x + 1) % w, y)];
			const hU = smooth[idx(x, (y - 1 + h) % h)];
			const hD = smooth[idx(x, (y + 1) % h)];
			let dx = (hR - hL) * normalStrength;
			let dy = (hD - hU) * normalStrength;
			const nx = -dx, ny = -dy, nz = 1.0;
			const invLen = 1.0 / Math.hypot(nx, ny, nz);
			normalData[o + 0] = Math.round((nx * invLen * 0.5 + 0.5) * 255);
			normalData[o + 1] = Math.round((ny * invLen * 0.5 + 0.5) * 255);
			normalData[o + 2] = Math.round((nz * invLen * 0.5 + 0.5) * 255);

			const e = edgeMask[idx(x, y)];
			const chip = chipMask[idx(x, y)];
			// Väri: pääosin punainen, reunoissa hieman haalistu ja paikoin harmaata "paljastunutta metallia"
			const metalColor = new THREE.Color(0xaaaaaa);
			const base = baseColor.clone();
			// lievä sävyn vaihtelu pinnassa
			const tint = 0.96 + 0.08 * (smooth[idx(x, y)] - 0.5);
			base.multiplyScalar(tint);
			const wearMix = Math.min(1.0, edgeWearIntensity * (0.6 * e + 0.4 * chip));
			const finalColor = base.lerp(metalColor, wearMix);
			colorData[o + 0] = Math.round(finalColor.r * 255);
			colorData[o + 1] = Math.round(finalColor.g * 255);
			colorData[o + 2] = Math.round(finalColor.b * 255);

			// Roughness: hieman vaihteleva, reunoissa karheampi
			let rough = 0.4 + 0.25 * (smooth[idx(x, y)] - 0.5) + 0.25 * e;
			rough = Math.min(1.0, Math.max(0.05, rough));
			const r8 = Math.round(rough * 255);
			roughData[o + 0] = r8; roughData[o + 1] = r8; roughData[o + 2] = r8;

			// Metalness: pääosin 0, mutta siruissa hieman metallista kiiltoa
			let met = 0.0 + 0.15 * chip + 0.05 * e;
			met = Math.min(1.0, Math.max(0.0, met));
			const m8 = Math.round(met * 255);
			metalData[o + 0] = m8; metalData[o + 1] = m8; metalData[o + 2] = m8;
		}
	}
	const colorMap = new THREE.DataTexture(colorData, w, h, THREE.RGB);
	colorMap.colorSpace = THREE.SRGBColorSpace;
	colorMap.wrapS = THREE.RepeatWrapping; colorMap.wrapT = THREE.RepeatWrapping; colorMap.repeat.copy(repeat); colorMap.needsUpdate = true;
	const normalMap = new THREE.DataTexture(normalData, w, h, THREE.RGB);
	normalMap.wrapS = THREE.RepeatWrapping; normalMap.wrapT = THREE.RepeatWrapping; normalMap.repeat.copy(repeat); normalMap.needsUpdate = true;
	const roughnessMap = new THREE.DataTexture(roughData, w, h, THREE.RGB);
	roughnessMap.wrapS = THREE.RepeatWrapping; roughnessMap.wrapT = THREE.RepeatWrapping; roughnessMap.repeat.copy(repeat); roughnessMap.needsUpdate = true;
	const metalnessMap = new THREE.DataTexture(metalData, w, h, THREE.RGB);
	metalnessMap.wrapS = THREE.RepeatWrapping; metalnessMap.wrapT = THREE.RepeatWrapping; metalnessMap.repeat.copy(repeat); metalnessMap.needsUpdate = true;
	return { colorMap, normalMap, roughnessMap, metalnessMap };
}

export function createKaasupullo(scene) {
	const gasCylinderGroup = new THREE.Group();
	gasCylinderGroup.name = 'gasCylinderGroup';
	const cylinderRadius = 1.0;
	const cylinderHeight = 3.0;
	const cylinderBodyGeo = new THREE.CylinderGeometry(cylinderRadius, cylinderRadius, cylinderHeight, 32);
	const cylinderBodyMat = new THREE.MeshStandardMaterial({ color: 0x0077be, metalness: 0.5, roughness: 0.6 });
	const cylinderBody = new THREE.Mesh(cylinderBodyGeo, cylinderBodyMat);
	cylinderBody.position.y = cylinderHeight / 2;
	cylinderBody.castShadow = true;
	const cylinderTopGeo = new THREE.SphereGeometry(cylinderRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
	const cylinderTop = new THREE.Mesh(cylinderTopGeo, cylinderBodyMat);
	cylinderTop.position.y = cylinderHeight;
	cylinderTop.castShadow = true;
	const valveBlockGroup = new THREE.Group();
	valveBlockGroup.position.y = cylinderHeight + cylinderRadius + 0.1;
	const valveBlockGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.5, 24);
	// Luo kuluneen metallin tekstuurit harmaalle osalle (venttiililohko ja suutin)
	const worn = createWornMetalTextures({ size: 128, normalStrength: 1.75, repeat: new THREE.Vector2(10, 6), seed: 4242 });
	const valveBlockMat = new THREE.MeshStandardMaterial({
		color: 0xaaaaaa,
		metalness: 0.7,
		roughness: 0.55,
		normalMap: worn.normalMap,
		normalScale: new THREE.Vector2(0.35, 0.35),
		roughnessMap: worn.roughnessMap
	});
	const valveBlock = new THREE.Mesh(valveBlockGeo, valveBlockMat);
	valveBlock.castShadow = true;
	const nozzleGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.4, 16);
	const nozzleMat = new THREE.MeshStandardMaterial({
		color: 0xdddddd,
		metalness: 0.8,
		roughness: 0.5,
		normalMap: worn.normalMap,
		normalScale: new THREE.Vector2(0.3, 0.3),
		roughnessMap: worn.roughnessMap
	});
	const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
	nozzle.name = 'gasNozzle';
	nozzle.rotation.z = Math.PI / 2;
	nozzle.position.x = 0.4;
	const gasHoseAttachmentPoint = new THREE.Object3D();
	gasHoseAttachmentPoint.position.x = 0.0;
	nozzle.add(gasHoseAttachmentPoint);
	const valveHandle = new THREE.Group();
	valveHandle.name = 'gasValveHandle';
	const valveBaseGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16);
	// Use spoon-like bright metal (same style as spatula) for the valve parts
	const spoonLikeMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.2 });
	const valveBase = new THREE.Mesh(valveBaseGeo, spoonLikeMat);
	valveBase.rotation.x = Math.PI/2;
	const valveTapGeo = new THREE.BoxGeometry(0.8, 0.15, 0.15);
	// Punainen maalattu metalli: clearcoat + hienovarainen oranssinkuori + reuna-kulumaa
	const paint = createPaintedMetalTextures({
		size: 128,
		baseColor: new THREE.Color(0xd32f2f), // hieman tummempi, realistinen punainen
		repeat: new THREE.Vector2(4, 2),
		normalStrength: 0.55,
		edgeWidth: 0.12,
		edgeWearIntensity: 0.22,
		seed: 10071
	});
	// Replace handle material with spoon-like metal (env-map independent)
	const valveTap = new THREE.Mesh(valveTapGeo, spoonLikeMat);
	valveTap.rotation.y = Math.PI/2;
	valveTap.position.z = 0.0;
	valveHandle.add(valveBase, valveTap);
	valveHandle.position.y = 0.44;
	valveBlockGroup.add(valveBlock, nozzle, valveHandle);
	gasCylinderGroup.add(cylinderBody, cylinderTop, valveBlockGroup);
	gasCylinderGroup.position.x = -4;
	// Slight lift to avoid z-fighting/sinking into the table
	gasCylinderGroup.position.y += 0.01;
	scene.add(gasCylinderGroup);
	return { gasCylinderGroup, gasHoseAttachmentPoint, cylinderBody };
}
// Kaasupullon luonti ja logiikka
// ...täydennetään myöhemmin...
