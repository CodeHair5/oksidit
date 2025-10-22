import * as THREE from 'three';

// Tippapullo oikealla mallilla (pipetti.html logiikan ja geometrian mukaan)
export function createTippapullo(scene, dropperOriginPosition) {
	const dropperBottleGroup = new THREE.Group();
	dropperBottleGroup.name = 'dropperBottle';

	// Skaalauskerroin: puolitettu aiemmasta -> ~50% pienempi malli
	const scaleFactor = 0.25;

	// Mitat (skaalatut)
	const bodyRadius = 2 * scaleFactor;
	const bodyHeight = 4 * scaleFactor;
	const shoulderHeight = 2.5 * scaleFactor;
	const neckHeight = 0.8 * scaleFactor;
	const neckRadius = 0.8 * scaleFactor;
	const wallThickness = 0.1 * scaleFactor;

	// Pullon yläreuna (assemblyn perus Y)
	const bottleTopY = bodyHeight + shoulderHeight + neckHeight;

	// Materiaalit (läpinäkyvä lasi, kumi, neste)
	const bottleGlassMaterial = new THREE.MeshPhysicalMaterial({
		color: 0x5c4025, // amber tint
		metalness: 0.0,
		roughness: 0.18,
		transparent: false,
		opacity: 1.0,
		transmission: 0.0, // opaque; no see-through
		ior: 1.5,
		clearcoat: 0.8,
		clearcoatRoughness: 0.12,
		specularIntensity: 0.6,
		specularColor: new THREE.Color(0xffffff),
		depthWrite: true
	});

	const pipetteGlassMaterial = new THREE.MeshPhysicalMaterial({
		color: 0xe0ffff,
		metalness: 0.0,
		roughness: 0.02,
		transparent: true,
		opacity: 1.0,
		transmission: 0.98,
		ior: 1.52,
		thickness: 0.2,
		attenuationColor: new THREE.Color(0xdffcff),
		attenuationDistance: 3.0,
		depthWrite: false
	});

	const capMaterial = new THREE.MeshPhysicalMaterial({
		color: 0x2b2b2b,
		metalness: 0.0,
		roughness: 0.92,
		specularIntensity: 0.2,
		specularColor: new THREE.Color(0x444444),
		sheen: 0.25,
		sheenRoughness: 0.85,
	});
	const rubberMaterial = new THREE.MeshPhysicalMaterial({
		color: 0x141414,
		metalness: 0.0,
		roughness: 0.96,
		specularIntensity: 0.15,
		specularColor: new THREE.Color(0x333333),
		sheen: 0.2,
		sheenRoughness: 0.9,
	});
	const liquidMaterial = new THREE.MeshPhysicalMaterial({
		color: 0x004d00, // vihreä neste
		metalness: 0,
		roughness: 0.4,
		transparent: true,
		opacity: 0.9,
		ior: 1.33,
		depthWrite: false
	});

	// Pullon muoto (Lathe)
	const bottleProfile = new THREE.Shape();
	// ulkoseinä
	bottleProfile.moveTo(0, 0);
	bottleProfile.lineTo(bodyRadius, 0);
	bottleProfile.lineTo(bodyRadius, bodyHeight);
	bottleProfile.splineThru([
		new THREE.Vector2(bodyRadius * 0.95, bodyHeight + shoulderHeight * 0.5),
		new THREE.Vector2(neckRadius, bodyHeight + shoulderHeight)
	]);
	bottleProfile.lineTo(neckRadius, bottleTopY);
	// aukko ja sisäseinä
	bottleProfile.lineTo(neckRadius - wallThickness, bottleTopY);
	bottleProfile.lineTo(neckRadius - wallThickness, bodyHeight + shoulderHeight);
	bottleProfile.splineThru([
		new THREE.Vector2((bodyRadius - wallThickness) * 0.95, bodyHeight + shoulderHeight * 0.5),
		new THREE.Vector2(bodyRadius - wallThickness, bodyHeight)
	]);
	bottleProfile.lineTo(bodyRadius - wallThickness, wallThickness);
	bottleProfile.lineTo(0, wallThickness);

	const bottleGeometry = new THREE.LatheGeometry(bottleProfile.getPoints(30), 64);
	const bottleMesh = new THREE.Mesh(bottleGeometry, bottleGlassMaterial);
	bottleMesh.name = 'bottleMesh';
	dropperBottleGroup.add(bottleMesh);

	// Tarra "BTS"
	const labelCanvas = document.createElement('canvas');
	const ctx = labelCanvas.getContext('2d');
	labelCanvas.width = 256; labelCanvas.height = 128;
	ctx.fillStyle = 'white'; ctx.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
	ctx.font = 'bold 60px Arial'; ctx.fillStyle = 'black'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
	ctx.fillText('BTS', labelCanvas.width / 2, labelCanvas.height / 2);
	const labelTexture = new THREE.CanvasTexture(labelCanvas);
	const labelMaterial = new THREE.MeshBasicMaterial({ map: labelTexture, side: THREE.FrontSide });
	const labelRadius = bodyRadius + 0.01 * scaleFactor;
	const labelHeight = 1.5 * scaleFactor;
	const labelAngle = Math.PI / 2.5;
	// Siirrä etiketti pullon vastakkaiselle puolelle (180° käännös)
	const labelGeometry = new THREE.CylinderGeometry(labelRadius, labelRadius, labelHeight, 32, 1, true, Math.PI/2 - labelAngle / 2, labelAngle);
	const labelMesh = new THREE.Mesh(labelGeometry, labelMaterial);
	labelMesh.position.y = bodyHeight / 2;
	dropperBottleGroup.add(labelMesh);

	// Pipetti-assembly (liikkuva) – sijoitetaan assemblyn paikallinen nolla pullon yläreunaan
	const pipetteAssembly = new THREE.Group();
	pipetteAssembly.name = 'pipetteAssembly';
	pipetteAssembly.position.y = bottleTopY; // kuten aiemminkin index.html odottaa

	// Korkki
	const capHeight = 0.6 * scaleFactor;
	const capRadius = neckRadius + 0.05 * scaleFactor;
	const capLocalY = -capHeight / 2; // assemblyn nollaan nähden (pullon yläreuna)
	const capMesh = new THREE.Mesh(new THREE.CylinderGeometry(capRadius, capRadius, capHeight, 32), capMaterial);
	capMesh.position.y = capLocalY;

	// Kumipää (pallon tapainen)
	const rubberRadius = capRadius * 0.9;
	const rubberLocalY = capLocalY + capHeight / 2 + rubberRadius * 0.8;
	const rubberMesh = new THREE.Mesh(new THREE.SphereGeometry(rubberRadius, 32, 16), rubberMaterial);
	rubberMesh.position.y = rubberLocalY;

	// Lasinen pipetti
	const pipetteLength = (bodyHeight + shoulderHeight) * 0.95;
	const pipetteRadius = neckRadius * 0.6;
	const pipetteLocalY = capLocalY - capHeight / 2 - pipetteLength / 2;
	const pipetteMesh = new THREE.Mesh(new THREE.CylinderGeometry(pipetteRadius, pipetteRadius, pipetteLength, 16), pipetteGlassMaterial);
	pipetteMesh.position.y = pipetteLocalY;

	// Kärkikartio (oikea mesh, nimellä 'pipetteTip')
	const tipHeight = 0.5 * scaleFactor;
	const tipBaseLocalY = pipetteLocalY - pipetteLength / 2; // kartion pohjan pitäisi olla tässä
	const tipMesh = new THREE.Mesh(new THREE.ConeGeometry(pipetteRadius, tipHeight, 16), pipetteGlassMaterial);
	tipMesh.name = 'pipetteTip';
	tipMesh.position.y = tipBaseLocalY - tipHeight / 2; // siirrä kartio alas puoli korkeutta
	tipMesh.rotation.x = Math.PI;

	// Neste kartiokärjessä (pysyvä visuaalinen)
	const liquidTipMesh = new THREE.Mesh(new THREE.ConeGeometry(pipetteRadius * 0.9, tipHeight, 16), liquidMaterial);
	liquidTipMesh.position.y = tipMesh.position.y;
	liquidTipMesh.rotation.x = Math.PI;

	// Tipan aloituspiste
	const tipEnd = new THREE.Object3D();
	tipEnd.name = 'tipEnd';
	tipEnd.position.y = tipBaseLocalY - tipHeight; // aivan kärkeen

	// Pipetin sisäinen neste (sylinteri)
	const pipetteLiquidHeight = pipetteLength * 0.9;
	const pipetteLiquidGeometry = new THREE.CylinderGeometry(pipetteRadius * 0.9, pipetteRadius * 0.9, pipetteLiquidHeight, 16);
	const pipetteLiquid = new THREE.Mesh(pipetteLiquidGeometry, liquidMaterial);
	pipetteLiquid.name = 'pipetteLiquid';
	// Aseta niin, että yläpinta laskee skaalatessa alas; alimmainen pinta pysyy paikallaan
	const pipetteLiquidLocalY = capLocalY - capHeight / 2 - pipetteLiquidHeight / 2 - (pipetteLength - pipetteLiquidHeight);
	pipetteLiquid.position.y = pipetteLiquidLocalY;
	pipetteLiquid.userData.baseY = pipetteLiquid.position.y; // talleta alkuperäinen

	// Koonti
	pipetteAssembly.add(capMesh, rubberMesh, pipetteMesh, tipMesh, liquidTipMesh, tipEnd, pipetteLiquid);

	// Shadow proxy: ohut, näkymätön sylinteri joka jatkaa varjon piirtämistä vaikka läpinäkyvyys / renderOrder sotkisi oikean pipetin
	try {
		const shadowProxyGeo = new THREE.CylinderGeometry(pipetteRadius*0.55, pipetteRadius*0.55, pipetteLength*0.95, 8);
		const shadowProxyMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.0, depthWrite: false });
		const shadowProxy = new THREE.Mesh(shadowProxyGeo, shadowProxyMat);
		shadowProxy.name = 'pipetteShadowProxy';
		shadowProxy.position.y = pipetteLocalY; // sama keskitaso kuin varsinaisessa pipetissä
		shadowProxy.castShadow = true;
		shadowProxy.receiveShadow = false;
		pipetteAssembly.add(shadowProxy);
	} catch {}
	dropperBottleGroup.add(pipetteAssembly);

	// Sijoita maailmaan
	dropperBottleGroup.position.copy(dropperOriginPosition);
	// Slight lift to avoid z-fighting/sinking into the table
	dropperBottleGroup.position.y += 0.01;
	scene.add(dropperBottleGroup);
	// Shadows for all parts of the bottle
	try { dropperBottleGroup.traverse(o => { if (o.isMesh) { o.castShadow = true; } }); } catch {}

	// Palauta pullon yläpinnan korkeus index.html:lle
	return { dropperBottleGroup, pipetteAssembly, bottleHeight: bottleTopY, pipetteLiquid, modelScale: scaleFactor };
}

// Vähennä pipetin nesteen määrää: skaalaa korkeutta ja kompensoi y-sijaintia niin, että alapinta pysyy paikallaan
export function decreasePipetteLiquid(pipetteLiquid, dropCount = 3) {
	if (!pipetteLiquid || !pipetteLiquid.geometry || !pipetteLiquid.userData) return;
	const geomHeight = pipetteLiquid.geometry.parameters.height || 1.0;
	const prevScale = pipetteLiquid.scale.y || 1.0;
	const perDrop = 0.15;
	const targetScale = Math.max(0.05, prevScale - perDrop * dropCount);
	if (targetScale === prevScale) return;
	const deltaScale = prevScale - targetScale;
	const deltaY = (deltaScale * geomHeight) / 2;
	pipetteLiquid.scale.y = targetScale;
	pipetteLiquid.position.y -= deltaY;
}

// Palauta pipetin neste alkuperäiseen korkeuteen (täyttö pulloon vietäessä)
export function refillPipetteLiquid(pipetteLiquid) {
	if (!pipetteLiquid || !pipetteLiquid.geometry || !pipetteLiquid.userData) return;
	pipetteLiquid.scale.y = 1.0;
	if (typeof pipetteLiquid.userData.baseY === 'number') {
		pipetteLiquid.position.y = pipetteLiquid.userData.baseY;
	}
}
