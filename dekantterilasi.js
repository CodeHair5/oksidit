import * as THREE from 'three';
// Legacy ripple & water imports removed (unified water replaces them)
import { createDiffusionManager } from './lib/diffusion.js';
import { createUnifiedWater } from './lib/unifiedWater.js';
// Dekantterilasin luonti ja logiikka
export function createDekantterilasi(scene) {
	const beakerGroup = new THREE.Group();
	beakerGroup.name = 'beakerGroup';
	const beakerHeight = 2.5;
	const beakerRadius = 1.0;
	const beakerGeo = new THREE.CylinderGeometry(beakerRadius, beakerRadius, beakerHeight, 32, 1, true);
	// Alkuperäinen kirkas hotspot ("kirkas soikio") syntyi erittäin alhaisesta roughness-arvosta (0.06)
	// yhdistettynä directional + environment -heijastuksiin. Nostetaan roughness ja tiputetaan reflectance
	// hienovaraisesti (ior -> 1.45) sekä lisätään clearcoat pieneen kiiltoon ilman polttopistettä.
	// Palautettu "kirkkaampi" profiili: matala roughness ja korkeampi transmission
	const beakerMat = new THREE.MeshPhysicalMaterial({ 
		color: 0xffffff,
		metalness: 0.0,
		roughness: 0.06,
		transparent: true,
		opacity: 1.0,
		transmission: 0.97,
		ior: 1.46,
		thickness: 0.12,
		attenuationColor: new THREE.Color(0xffffff),
		attenuationDistance: 2.2,
		clearcoat: 0.25,
		clearcoatRoughness: 0.55,
		specularIntensity: 0.55,
		specularColor: new THREE.Color(0xffffff),
		side: THREE.DoubleSide,
		depthWrite: false
	});
	beakerMat.envMapIntensity = 0.65;

	// Sisäinen diffusoiva "anti-hotspot" kalvo: ohut inverted scale -kopio ilman transmissionia
	const innerGeo = beakerGeo.clone();
	const innerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.0, roughness: 0.85, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.BackSide });
	const innerShell = new THREE.Mesh(innerGeo, innerMat);
	innerShell.name = 'beakerInnerDulling';
	innerShell.scale.setScalar(0.985); // vähän pienempi niin ettei Z-fight
	innerShell.renderOrder = 4; // ennen varsinaista lasia (lasilla renderOrder=5)
	const beaker = new THREE.Mesh(beakerGeo, beakerMat);
	// Nostetaan hieman jotta ei leikkaa lattiaa pienten numeeristen virheiden vuoksi
	beaker.position.y = beakerHeight / 2 + 0.01;
	beaker.castShadow = true;
	const waterHeight = beakerHeight / 2;
	// Diffuusio- ja partikkelihallinta kapseloituna
	const diffusion = createDiffusionManager({ beakerGroup, beakerRadius, waterSurfaceY: waterHeight, waterHeight });
	// Chemistry: use a single pH score and indicator flag
	// pHScore < 0 => basic (blue), 0 => neutral (green), > 0 => acidic (yellow)
	// We keep a separate visual display value that drives shader uniforms (displayPH),
	// so we can animate color changes or defer them until stirring.
	let pHScore = 0;          // logical state
	let displayPH = 0;        // visual state shown in shaders
	let hasIndicator = false;
	let baseRevealPending = false; // holds back base-induced color change until stirring
	let _phTween = null;      // active tween for smooth transitions

	// Will hold unified water (new single mesh surface + sides)
	let unifiedWaterObj = null; // { mesh, uniforms, ... }

	function syncUnifiedChem() {
		if (!unifiedWaterObj) return;
		const uu = unifiedWaterObj.uniforms;
		uu.uPHScore.value = displayPH;
		uu.uGlobalConc.value = waterUniforms.uGlobalConc.value;
		uu.uIndicatorEnabled.value = waterUniforms.uIndicatorEnabled.value;
	}

	function setDisplayPH(v) {
		displayPH = v;
		// push to legacy uniforms
		waterUniforms.uPHScore.value = displayPH;
		meniscusUniforms.uPHScore.value = displayPH;
		if (meniscusUnderUniforms && meniscusUnderUniforms.uPHScore) meniscusUnderUniforms.uPHScore.value = displayPH;
		syncUnifiedChem();
	}
	// Legacy water/meniscus removed: unified water handles both volume & surface
	const waterUniforms = { uGlobalConc: { value: 0.0 }, uIndicatorEnabled: { value: 0.0 }, uPHScore: { value: 0.0 } };
	const meniscusUniforms = { uPHScore: { value: 0.0 }, uGlobalConc: { value: 0.0 }, uIndicatorEnabled: { value: 0.0 } };
	const meniscusUnderUniforms = null; // no longer used
	const meniscus = null; // kept for API compatibility with external modules (will be phased out)

	// --- Unified water creation (replaces separate meniscus + waterTop visually) ---
	unifiedWaterObj = createUnifiedWater({
		radius: beakerRadius - 0.015,
		height: waterHeight,
		indicatorTex: diffusion.indicatorTex
	});
	// Rollback: ei pakoteta render mode 2, jätetään default (mode 0) harnessiin
	const unifiedWater = unifiedWaterObj.mesh;
	// Expose ripple trigger to external modules via userData
	unifiedWater.userData.triggerRipple = (worldPos) => {
		try { unifiedWaterObj.triggerRipple(worldPos, beakerGroup); } catch {}
	};
	// Legacy compatibility alias so external modules referencing `water` don't crash
	const water = unifiedWater;
	// Nosta yhtenäinen vesigeometria samaan tapaan kuin alkuperäinen water (keskikohta puoliväliin korkeutta)
	unifiedWater.position.y = waterHeight / 2; // aiemmin 0 -> oli liian alhaalla
	unifiedWater.renderOrder = 2; // between particles & glass
	// Legacy geometry placeholders removed
	const meniscusUnder = null;
	const meniscusPositions = null;
	const originalMeniscusPositions = null;
	const waterSurfaceY = waterHeight;
	const beakerTapGroup = new THREE.Group();
	const nozzleMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.8, roughness: 0.4 });
	const beakerNozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 16), nozzleMat);
	beakerNozzle.name = 'beakerNozzle';
	beakerNozzle.rotation.z = Math.PI / 2;
	beakerNozzle.position.x = beakerRadius + 0.3;
	const beakerTapHandle = new THREE.Group();
	beakerTapHandle.name = 'beakerTapHandle';
	// Venttiilin kahva (harmaa sylinteri)
	const handleCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 16), nozzleMat);
	beakerTapHandle.add(handleCylinder);
	// Valkoinen viiva keskelle kahvaa, siirretään hieman z-akselilla z-fightingin välttämiseksi
	const lineGeo = new THREE.BoxGeometry(0.15, 0.1, 0.02);
	const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
	const lineMesh = new THREE.Mesh(lineGeo, lineMat);
	lineMesh.position.set(0, 0, 0.016); // suurempi siirto z-akselilla
	lineMesh.rotation.y = Math.PI / 2; // käännetään viiva 90 astetta
	beakerTapHandle.add(lineMesh);
	// Lasketaan venttiilin kahvaa hieman, jotta rako katoaa
	beakerTapHandle.position.set(beakerRadius + 0.3, 0.09, 0);
	beakerTapGroup.add(beakerNozzle, beakerTapHandle);
	beakerTapGroup.position.y = 0.4;
	// Asetetaan piirtämisjärjestys: ensin sisäosat, viimeiseksi lasi
	beaker.renderOrder = 5;
	innerShell.visible = false; // palautetaan kirkas oletus
	beakerGroup.add(beaker, innerShell, unifiedWater, beakerTapGroup);
	beakerGroup.position.x = 4;
	beakerGroup.rotation.y = Math.PI;
	scene.add(beakerGroup);
	// Kytke uniformit diffuusio-manageriin, jotta uIndicatorMap ja uGlobalConc pysyvät synkassa
	// Bind unified water uniforms directly
	diffusion.bindUniforms({ water: unifiedWaterObj.uniforms });


	// Acidic gas pushes pHScore positive (towards yellow). If indicator present,
	// animate the visual change slowly for realism.
	function addAcidicGas() {
		// Update logical pH
		if (!hasIndicator) {
			pHScore = Math.max(pHScore + 1, 1);
			// No indicator: keep display as-is (gated in shaders)
			return;
		}
		if (pHScore < 0) {
			pHScore = 0; // blue -> green
		} else {
			pHScore = Math.max(1, pHScore + 1); // green -> yellow (or stay yellow)
		}
		// Smoothly tween the displayed pH towards the new logical pH
		try {
			const T = (typeof window !== 'undefined' && window.TWEEN) ? window.TWEEN : null;
			if (T) {
				if (_phTween && _phTween.stop) _phTween.stop();
				const obj = { v: displayPH };
				_phTween = new T.Tween(obj)
					.to({ v: pHScore }, 1500)
					.easing(T.Easing.Quadratic.Out)
					.onUpdate(() => setDisplayPH(obj.v))
					.onComplete(() => { setDisplayPH(pHScore); _phTween = null; })
					.start();
			} else {
				setDisplayPH(pHScore);
			}
		} catch { setDisplayPH(pHScore); }
	}

	// Function to reset water to initial state
	function resetWater() {
		// Clear indicator map and particles via diffusion manager
		diffusion.reset();
		
		// Reset concentrations
		waterUniforms.uGlobalConc.value = 0.0;
		meniscusUniforms.uGlobalConc && (meniscusUniforms.uGlobalConc.value = 0.0);
		
		// Reset chemistry
		pHScore = 0;
		displayPH = 0;
		hasIndicator = false;
		baseRevealPending = false;
		if (_phTween && _phTween.stop) { try { _phTween.stop(); } catch {} _phTween = null; }
		waterUniforms.uIndicatorEnabled.value = 0.0;
		// Ensure meniscus layers also drop indicator influence
		meniscusUniforms.uIndicatorEnabled && (meniscusUniforms.uIndicatorEnabled.value = 0.0);
		setDisplayPH(0.0);
		syncUnifiedChem();
		
			// Diffusion manager handled particle clearing
	}

	// Modified addIndicatorAt to handle acidity
	function addIndicatorAtModified(u, v) {
		hasIndicator = true;
		waterUniforms.uIndicatorEnabled.value = 1.0;
		meniscusUniforms.uIndicatorEnabled && (meniscusUniforms.uIndicatorEnabled.value = 1.0);
		
		// Lisää roiske diffuusio-managerin kautta
		diffusion.addIndicatorAt(u, v);
		// Anna kevyt välitön lisäys globaaliin konsentraatioon visuaalista palautetta varten
		waterUniforms.uGlobalConc.value = Math.min(1.0, waterUniforms.uGlobalConc.value + 0.015);
		if (meniscusUniforms.uGlobalConc) meniscusUniforms.uGlobalConc.value = waterUniforms.uGlobalConc.value;
		// Heijasta nykyinen pH-tila välittömästi nyt kun indikaattori on päällä
		if (_phTween && _phTween.stop) { try { _phTween.stop(); } catch {} _phTween = null; }
		setDisplayPH(pHScore);
		syncUnifiedChem();
		return true;
	}

	// Emäksinen jauhe työntää pHScore negatiiviseen suuntaan (sininen). Jos hapan, ensin neutraloi (keltainen->vihreä), sitten peräkkäiset lisäykset siniseksi.
	function addBasicPowderEffect() {
		// Päivitä pHScore aina, vaikka indikaattoria ei olisi vielä lisätty.
		// Indikaattorin väri ei kuitenkaan muutu heti; vaatii sekoituksen.
		if (pHScore > 0) {
			// Neutraloi hapan ensin vihreäksi (pHScore=0)
			pHScore = 0;
		} else {
			// Muuten siirry emäksiseen (siniseen) vähintään tasolle -1
			pHScore = Math.min(pHScore - 1, -1);
		}
		baseRevealPending = true; // pidä visuaalinen muutos odottamassa sekoitusta
		// Älä muuta displayPH:tä vielä; pidä nykyinen väri
		syncChemUniforms();
	}


	function syncChemUniforms() {
		// Pidä shaderit synkassa visual display -arvon kanssa
		setDisplayPH(displayPH);
		syncUnifiedChem();
	}

	// Reveal pending pH visually (e.g., when stirring begins)
	function revealPendingPH() {
		if (!hasIndicator) return; // ei näkyvää vaikutusta ilman indikaattoria
		if (!baseRevealPending && Math.abs(displayPH - pHScore) < 1e-3) return;
		baseRevealPending = false;
		try {
			const T = (typeof window !== 'undefined' && window.TWEEN) ? window.TWEEN : null;
			if (T) {
				if (_phTween && _phTween.stop) _phTween.stop();
				const obj = { v: displayPH };
				_phTween = new T.Tween(obj)
					.to({ v: pHScore }, 1200)
					.easing(T.Easing.Quadratic.InOut)
					.onUpdate(() => setDisplayPH(obj.v))
					.onComplete(() => { setDisplayPH(pHScore); _phTween = null; })
					.start();
			} else {
				setDisplayPH(pHScore);
			}
		} catch { setDisplayPH(pHScore); }
	}

	// Post-mix color helper for plumes (match final BTS color after stirring)
	function getPostMixColorHex() {
		// Map current logical pHScore to final color:
		// <= -0.5 => basic blue; 0 => neutral green; (>0 not used for base, but default to yellow)
		if (pHScore < 0) return 0x0b3c88; // blue
		if (pHScore === 0) return 0x12d65c; // green
		return 0xe6d619; // yellow (fallback, not expected here)
	}

	// Diffuusiopartikkelit diffuusio-managerin kautta
	function addDiffusionSource(localX, localZ) {
		diffusion.addSource(localX, localZ, 60);
	}

		// Expose minimal state for other modules (e.g., powder trails)
		function getChemState() {
			return {
				hasIndicator,
				pHScore
			};
		}

	// Per-frame update helper: call from main loop
	function updateWater(dt, elapsedSeconds) {
		// Advance diffusion (spreads indicator & updates global conc)
		diffusion.step(dt);
		// Advance ripple time in unified water
		if (unifiedWaterObj) unifiedWaterObj.updateTime(elapsedSeconds);
		// Päivitä unified kemia jos globalConc muuttui diffusionissa
		syncUnifiedChem();
	}
	// Store reference for external loop discovery
	beakerGroup.userData.updateWater = updateWater;

	  // Expose unified water control object for debugging / console (render mode cycling etc.)
	  if (typeof window !== 'undefined') {
		window.unifiedWaterObj = unifiedWaterObj;
	  }
	return { 
		beakerGroup, beakerNozzle, water, unifiedWater: unifiedWaterObj ? unifiedWaterObj.mesh : null, unifiedWaterObj, waterHeight, meniscus, meniscusUnder, 
		meniscusPositions, originalMeniscusPositions, waterSurfaceY, beakerRadius, beakerHeight, 
	    	addIndicatorAt: addIndicatorAtModified, stepIndicator: diffusion.step, addAcidicGas, resetWater, addDiffusionSource, particlesUpdate: diffusion.update, addBasicPowderEffect, revealPendingPH, addEventPlume: diffusion.addEventPlume, clearEvents: diffusion.clearEvents, getPostMixColorHex, getChemState, updateWater, diffusionManager: diffusion 
	};
}

// Global keyboard controls for chemistry functions
if (typeof window !== 'undefined') {
	window.addEventListener('keydown', (event) => {
		// Get beaker reference from global scope if available
		if (window.currentBeaker) {
			switch(event.key.toLowerCase()) {
				case 'r':
					window.currentBeaker.resetWater();
					break;
				case 'g':
					window.currentBeaker.addAcidicGas();
					// Debug-logi poistettu
					break;
			}
		}
	});
}
// Dekantterilasin luonti ja logiikka
// ...täydennetään myöhemmin...
