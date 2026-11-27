import * as THREE from 'three';

// 导览：高亮 + 地面光圈 + L 形路径 + 相机插值移动（D007 / 契约 §四）。
// 三种推进方式并存：连续自动走（默认）、逐点确认（讲解开关）、点击门店跳转（常驻，不依赖寻路）。
// 注意：楼板顶面在 floor.y + 0.15，光圈与路径必须画在其上方，否则被楼板吞掉。

const PATH_LIFT = 0.08;      // 相对楼板顶面的抬高
const RING_LIFT = 0.10;
const NODE_LIFT = 0.12;

export function createGuide({ scene, camera, controls, stores, floors, floorView, storeMeshes, onStep, onFloorChange }) {
  const storeById = new Map(stores.map((s) => [s.id, s]));

  const group = new THREE.Group();
  group.name = 'guide-overlay';
  scene.add(group);

  const ringGeo = new THREE.RingGeometry(0.9, 1.15, 32);
  const nodeGeo = new THREE.SphereGeometry(0.16, 12, 8);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const pathMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.75 });
  const nodeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });

  let highlighted = null;
  let animation = null;   // { waypoints, index, t, stepMode, onDone }
  let visibleFloor = 'all';

  function clearOverlay() {
    while (group.children.length) {
      const c = group.children.pop();
      if (c.geometry && c.geometry !== ringGeo && c.geometry !== nodeGeo) c.geometry.dispose();
    }
  }

  function unhighlight() {
    if (!highlighted) return;
    const entry = storeMeshes.get(highlighted);
    if (entry?.setHighlight) {
      entry.setHighlight(false);
    } else if (entry?.mat) {
      entry.mat.emissive?.setHex(0x000000);
      entry.mat.emissiveIntensity = 1;
    }
    highlighted = null;
  }

  function highlightStore(storeId) {
    unhighlight();
    const s = storeById.get(storeId);
    const entry = storeMeshes.get(storeId);
    if (!s || !entry) return false;
    if (entry.setHighlight) {
      entry.setHighlight(true);
    } else if (entry.mat?.emissive) {
      entry.mat.emissive.setHex(0xf59e0b);
      entry.mat.emissiveIntensity = 0.65;
    }
    highlighted = storeId;

    const top = floorView.getFloorTop(s.floor);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, top + RING_LIFT, s.z);
    group.add(ring);
    return true;
  }

  function addPathSegment(a, b, y) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.16), pathMat);
    seg.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
    seg.rotation.y = -Math.atan2(dz, dx);
    group.add(seg);
  }

  // 同层 L 形路径；跨层时插入垂直交通节点（扶梯/电梯），并切到目标层。
  function buildWaypoints(from, to) {
    if (from.floor === to.floor) {
      const y = floorView.getFloorTop(from.floor) + PATH_LIFT;
      const corner = { x: to.x, z: from.z, y };
      const end = { x: to.x, z: to.z, y };
      return [
        { x: from.x, z: from.z, y },
        corner,
        end,
      ];
    }
    const yFrom = floorView.getFloorTop(from.floor) + PATH_LIFT;
    const yTo = floorView.getFloorTop(to.floor) + PATH_LIFT;
    const midFrom = { x: from.x, z: from.z, y: yFrom };
    const vert = { x: from.x, z: from.z, y: yTo, floor: to.floor };
    const midTo = { x: to.x, z: from.z, y: yTo };
    const end = { x: to.x, z: to.z, y: yTo };
    return [midFrom, vert, midTo, end];
  }

  function drawPath(points) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (Math.abs(b.y - a.y) > 0.5) continue; // 垂直段不画地面线
      addPathSegment(a, b, a.y);
    }
    for (const p of points) {
      const node = new THREE.Mesh(nodeGeo, nodeMat);
      node.position.set(p.x, p.y + NODE_LIFT, p.z);
      group.add(node);
    }
  }

  // 连续自动走 / 逐点确认。onStep(node, index, total) 供 UI 显示进度。
  function guideTo(fromId, toId, { stepMode = false } = {}) {
    const from = storeById.get(fromId);
    const to = storeById.get(toId);
    if (!from || !to) return false;
    if (!from.entrance || !to.entrance) return false;

    clearOverlay();
    const points = buildWaypoints(
      { ...from, x: from.entrance.x, z: from.entrance.z },
      { ...to, x: to.entrance.x, z: to.entrance.z }
    );
    drawPath(points);
    highlightStore(toId);

    animation = { waypoints: points, index: 0, t: 0, stepMode, paused: stepMode, onDone: null };
    if (visibleFloor !== 'all' && visibleFloor !== to.floor) {
      floorView.setFloor('all');
      onFloorChange?.('all');
    }
    onStep?.(points[0], 0, points.length);
    return true;
  }

  // 点击门店跳转：不依赖寻路，落点参考 entrance，但相机要退后几步并对准店铺，
  // 否则镜头贴脸、画面被放大的店铺和光圈占满（答辩观感差）。
  function flyToStore(storeId) {
    const s = storeById.get(storeId);
    if (!s || !s.entrance) return false;

    clearOverlay();
    highlightStore(storeId);
    const top = floorView.getFloorTop(s.floor);

    // 从店铺指向门口的方向，再往外退几步作为相机站位；视线对准门头招牌。
    // 门脸体块 4×3×3（C-01）比原来的 1.6³ 方块大得多，退到 5.5m 才框得下，
    // 视线抬到 1.5m 让招牌进画面——只看门板不看店名，等于白飞。
    const dx = s.entrance.x - s.x;
    const dz = s.entrance.z - s.z;
    const len = Math.hypot(dx, dz) || 1;
    const stand = 5.5;
    const target = {
      x: s.entrance.x + (dx / len) * stand,
      y: top + 1.7,
      z: s.entrance.z + (dz / len) * stand,
      lookAt: { x: s.x, y: top + 1.5, z: s.z },
    };
    animation = {
      waypoints: [target], index: 0, t: 0, stepMode: false, paused: false, onDone: null,
    };
    if (visibleFloor !== 'all' && visibleFloor !== s.floor) {
      floorView.setFloor(s.floor);
      onFloorChange?.(s.floor);
    }
    return true;
  }

  function nextStep() {
    if (!animation?.paused) return false;
    animation.paused = false;
    animation.t = 0;
    return true;
  }

  function setVisibleFloor(id) {
    visibleFloor = id;
  }

  function stop() {
    animation = null;
    clearOverlay();
    unhighlight();
  }

  // 每帧推进；返回是否仍处于动画中。
  function update(dt) {
    if (!animation) return false;
    const wp = animation.waypoints;
    if (animation.index >= wp.length - 1 && animation.t >= 1) {
      animation = null;
      return false;
    }
    if (animation.paused) return true;

    const a = wp[animation.index];
    const b = wp[Math.min(animation.index + 1, wp.length - 1)];
    animation.t = Math.min(1, animation.t + dt * 1.1);
    const k = animation.t * animation.t * (3 - 2 * animation.t); // smoothstep

    const camY = a.y + 1.6 + (b.y - a.y);
    camera.position.x = a.x + (b.x - a.x) * k;
    camera.position.y = camY;
    camera.position.z = a.z + (b.z - a.z) * k;
    if (a.lookAt) {
      // 飞近店铺：视线对准门头，而不是正下方。
      controls?.target?.set(a.lookAt.x, a.lookAt.y, a.lookAt.z);
    } else {
      controls?.target?.set(
        a.x + (b.x - a.x) * k,
        a.y + 0.8,
        a.z + (b.z - a.z) * k
      );
    }
    controls?.update?.();

    if (animation.t >= 1) {
      if (a.floor && floorView.getFloor() !== a.floor) {
        floorView.setFloor(a.floor);
        onFloorChange?.(a.floor);
      }
      animation.index += 1;
      animation.t = 0;
      if (animation.stepMode && animation.index < wp.length - 1) {
        animation.paused = true;
        onStep?.(wp[animation.index], animation.index, wp.length);
      }
      if (animation.index >= wp.length - 1) {
        animation = null;
        return false;
      }
    }
    return true;
  }

  return {
    highlightStore,
    flyToStore,
    guideTo,
    nextStep,
    setVisibleFloor,
    stop,
    update,
    clearOverlay,
    isAnimating: () => !!animation,
    isPaused: () => !!animation?.paused,
  };
}
