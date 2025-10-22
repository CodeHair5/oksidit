import * as THREE from 'three';

// Manages creation and updates of bubbles in the beaker
export function createBubblesManager({ scene, beakerGroup, beakerRadius, waterSurfaceY }) {
  const bubbles = [];
  let lastBubbleTime = 0;

  function createBubble() {
    const bubbleGeo = new THREE.SphereGeometry(0.04, 16, 16);
    const bubbleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, roughness: 0.1 });
    const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);

    const beakerWorldPos = new THREE.Vector3();
    beakerGroup.getWorldPosition(beakerWorldPos);

    const randomRadius = Math.random() * (beakerRadius * 0.85);
    const randomAngle = Math.random() * Math.PI * 2;
    const startX = beakerWorldPos.x + Math.cos(randomAngle) * randomRadius;
    const startZ = beakerWorldPos.z + Math.sin(randomAngle) * randomRadius;
    const startY = beakerWorldPos.y + 0.05; // near bottom
    bubble.position.set(startX, startY, startZ);
    bubble.userData.centerX = startX;
    bubble.userData.centerZ = startZ;
    bubble.userData.velocityY = 2.0 + Math.random() * 1.0;
    bubble.userData.wobbleSpeed = 2 + Math.random() * 2;
    bubble.userData.wobbleAmount = 0.05 + Math.random() * 0.1;

    scene.add(bubble);
    bubbles.push(bubble);
  }

  // Conditionally spawn bubbles based on flow; also trigger acidity when appropriate
  function spawnIf({ flowOn, elapsedTime, selectedGas, onAcidic }) {
    if (!flowOn) return;
    if (elapsedTime - lastBubbleTime > 0.1) {
      createBubble();
      lastBubbleTime = elapsedTime;

      const acidicGases = ['SO2', 'NO2', 'CO2'];
      if (acidicGases.includes(selectedGas) && typeof onAcidic === 'function') {
        onAcidic();
      }
    }
  }

  // Update bubble positions and cleanup when they reach surface
  function update(elapsedTime) {
    const waterSurfaceWorldY = beakerGroup.position.y + waterSurfaceY;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const bubble = bubbles[i];
      bubble.position.y += bubble.userData.velocityY * 0.016;
      bubble.position.x = bubble.userData.centerX + Math.sin(elapsedTime * bubble.userData.wobbleSpeed) * bubble.userData.wobbleAmount;
      bubble.position.z = bubble.userData.centerZ + Math.cos(elapsedTime * (bubble.userData.wobbleSpeed * 0.9)) * bubble.userData.wobbleAmount;
      if (bubble.position.y > waterSurfaceWorldY) {
        scene.remove(bubble);
        bubble.geometry.dispose();
        bubble.material.dispose();
        bubbles.splice(i, 1);
      }
    }
  }

  function dispose() {
    for (const bubble of bubbles) {
      scene.remove(bubble);
      bubble.geometry.dispose();
      bubble.material.dispose();
    }
    bubbles.length = 0;
  }

  return { spawnIf, update, dispose };
}
