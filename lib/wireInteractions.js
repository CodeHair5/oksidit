// Centralized interaction wiring
// Expects an interaction manager (im) and necessary objects/managers
/**
 * Wire all InteractionManager handlers for the scene.
 * @param {Object} params
 * @param {import('./interactionManager').InteractionManager} params.im - Interaction manager instance
 * @param {import('three').Scene} params.scene - Three.js scene
 * @param {{ info:Function, success:Function, clear:Function }} params.notify - Notifier API
 * @param {Object} params.objects - Scene objects used in interactions
 * @param {import('three').Group} params.objects.gasCylinderGroup
 * @param {import('three').Group} params.objects.beakerGroup
 * @param {import('three').Object3D} params.objects.beakerNozzle
 * @param {import('three').Mesh} params.objects.meniscus
 * @param {import('three').Mesh} params.objects.meniscusUnder
 * @param {import('three').Group} params.objects.dropperBottleGroup
 * @param {Object} params.objects.solidJar
 * @param {import('three').Mesh} params.objects.solidSample
 * @param {Object} params.objects.spatula
 * @param {Object} params.objects.sauva
 * @param {import('three').Vector3} params.objects.hoseRestingPoint
 * @param {Object} params.managers - Helper managers and utilities
 * @param {Object} params.managers.animationManager
 * @param {Object} params.managers.hoseAnimator
 * @param {Object} params.managers.pipetteAnimator
 * @param {Object} params.managers.powder
 * @param {Function} params.managers.tweenTo
 * @param {Object} params.callbacks - Callback hooks and shared state
 * @param {Object} params.callbacks.state - Shared mutable state (hose/taps/valve and selections)
 * @param {Function} params.callbacks.runSpaatteliSequence - Starts the scoop animation sequence
 * @param {Function} params.callbacks.onBeakerClick - Beaker click handler (stir/pour/hose attach/pipette)
 * @param {Function} params.callbacks.onDropperClick - Dropper bottle click handler
 */
export function wireInteractions({
  im,
  scene,
  notify,
  objects,
  managers,
  callbacks
}) {
  const {
    gasCylinderGroup,
    beakerGroup,
    beakerNozzle,
    meniscus,
    meniscusUnder,
    dropperBottleGroup,
    solidJar,
    solidSample,
    spatula,
    sauva,
    hoseRestingPoint
  } = objects;

  const {
    animationManager,
    hoseAnimator,
    pipetteAnimator,
  powder,
  tweenTo
  } = managers;

  const {
    state
  } = callbacks;

  // Gas cylinder group: open menu
  im.onName('gasCylinderGroup', (ctx) => {
    if (ctx.hasName('gasValveHandle')) return false;
    document.getElementById('gasMenu').style.display = 'block';
    return true;
  }, { priority: 10 });

  // Hose click (toggle select / attach / return)
  im.onPredicate(ctx => ctx.object?.name === 'hoseMesh', () => {
    // 1. If currently attached to beaker -> detach and return to rest
    if (state.isHoseAttached) {
      state.isHoseAttached = false;
      state.isHoseSelected = false; // straight to rest
      animationManager.run('hoseReturn', async () => { await hoseAnimator.detachToRest(); }).then(() => {
        state.hoseEndPoint.copy(state.hoseRestingPoint);
        state.hoseMesh = state.updateHose(state.hoseEndPoint, state.isHoseAttached);
        if (state.hoseMesh?.material) state.hoseMesh.material.color.set(0x222222);
        notify.info('Letku irrotettu ja palautettu.', { duration: 1300 });
      });
      return true;
    }
    // 2. If selected already (second click) -> return to rest
    if (state.isHoseSelected) {
      state.isHoseSelected = false;
      animationManager.run('hoseReturn', async () => { await hoseAnimator.detachToRest(); }).then(() => {
        state.hoseEndPoint.copy(state.hoseRestingPoint);
        state.hoseMesh = state.updateHose(state.hoseEndPoint, state.isHoseAttached);
        if (state.hoseMesh?.material) state.hoseMesh.material.color.set(0x222222);
        notify.info('Letku palautettu pöydälle.', { duration: 1200 });
      });
      return true;
    }
    // 3. Otherwise select (highlight and lift)
    state.isHoseSelected = true;
    if (state.hoseMesh?.material) state.hoseMesh.material.color.set(0x00ff00);
    animationManager.run('hose', () => hoseAnimator.liftTip(1.0, 200));
    notify.info('Letku valittu. Klikkaa dekantterilasia kiinnittääksesi tai letkua uudelleen palauttaaksesi.', { duration: 3000 });
    return true;
  }, { priority: 60 });

  // Spatula select / toggle return
  im.onPredicate(ctx => ctx.hasName('spatulaGroup'), () => {
    if (!spatula) return true;
    const st = spatula.state;
    if (st.isAnimating) {
      if (st.isSelected) {
        st.pendingReturn = true;
        notify.info('Palautetaan pöydälle heti kun animaatio päättyy.', { duration: 1500 });
      }
      return true;
    }
    if (st.isSelected) {
      if (spatula.returnToRest) {
        animationManager.run('spatulaReturn', () => spatula.returnToRest()).then(() => {
          notify.info('Lusikka palautettu pöydälle.', { duration: 1200 });
        });
      }
    } else {
      if (spatula.select && spatula.select()) {
        notify.info('Lusikka valittu. Klikkaa lusikkaa uudelleen palauttaaksesi tai jauhetta kauhaistaksesi.', { duration: 2600 });
      }
    }
    return true;
  }, { priority: 40 });

  // Sauva select / toggle return
  im.onPredicate(ctx => ctx.hasName('sauvaGroup'), () => {
    if (!sauva) return true;
    const st = sauva.state;
    if (st.isAnimating) {
      if (st.isSelected) {
        st.pendingReturn = true;
        notify.info('Palautetaan pöydälle heti kun animaatio päättyy.', { duration: 1500 });
      }
      return true;
    }
    if (st.isSelected) {
      if (sauva.returnToRest) {
        animationManager.run('sauvaReturn', () => sauva.returnToRest()).then(() => {
          notify.info('Sauva palautettu pöydälle.', { duration: 1200 });
        });
      }
    } else {
      const sel = sauva?.select && sauva.select();
      if (sel) notify.info('Sauva valittu. Klikkaa keitinlasia sekoittaaksesi tai sauvaa uudelleen palauttaaksesi.', { duration: 2600 });
    }
    return true;
  }, { priority: 40 });

  // Solid sample interactions
  im.onPredicate(ctx => ctx.hasName('solidSample'), () => {
    if (spatula.state.isSelected && !spatula.state.isAnimating) {
      animationManager.run('spatula', () => callbacks.runSpaatteliSequence()).then(() => {
        notify.success('Kauhaistu. Klikkaa keitinlasia kaataaksesi.', { duration: 2800 });
      });
    } else {
      document.getElementById('solidMenu').style.display = 'block';
      notify.info('Valitse kiinteä aine valikosta.');
    }
    return true;
  }, { priority: 35 });

  // Gas valve toggle
  im.onName('gasValveHandle', () => {
    state.isGasValveOpen = !state.isGasValveOpen;
    const valveHandle = scene.getObjectByName('gasValveHandle');
    const targetRotationY = state.isGasValveOpen ? Math.PI / 2 : 0;
    animationManager.run('gasValve', () => tweenTo(valveHandle.rotation, { y: targetRotationY }, 300, TWEEN.Easing.Quadratic.Out));
    return true;
  }, { priority: 60 });

  // Beaker tap toggle
  im.onName('beakerTapHandle', () => {
    state.isBeakerTapOpen = !state.isBeakerTapOpen;
    const tapHandle = scene.getObjectByName('beakerTapHandle');
    const targetY = state.isBeakerTapOpen ? Math.PI / 2 : 0;
    animationManager.run('beakerTap', () => tweenTo(tapHandle.rotation, { y: targetY }, 200, TWEEN.Easing.Quadratic.Out));
    return true;
  }, { priority: 30 });

  // Beaker group interactions (hose attach, stir, pour, pipette transfer handled externally)
  im.onName('beakerGroup', () => callbacks.onBeakerClick(), { priority: 20 });

  // Dropper bottle
  im.onName('dropperBottle', () => { callbacks.onDropperClick(); return true; }, { priority: 20 });

  im.attach();
}
