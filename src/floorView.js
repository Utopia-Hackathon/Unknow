import * as THREE from 'three';

// 楼层可见性控制。D007 / 契约 §四 setFloor：只切可见性，不重建场景。
// 两个已知坑（Issue #12）：
//   1. 楼板顶面在 floor.y + 0.15（板厚 0.3），叠加层画在 +0.04 会被吞掉；
//   2. 运行时改 material.transparent 必须 needsUpdate = true，否则着色器不重编译。

export const FLOOR_TOPS = {}; // floorId -> y（楼板顶面高度），供 guide.js 画光圈用

export function createFloorView(floors, scene) {
  const slabs = new Map();   // floorId -> Mesh
  const markers = new Map(); // floorId -> Mesh
  const groups = new Map();  // floorId -> Group（该层的店铺体块）

  for (const f of floors) {
    FLOOR_TOPS[f.id] = f.y + 0.15;

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(28, 0.3, 20),
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
      })
    );
    slab.position.set(0, f.y, 0);
    slab.userData.floorId = f.id;
    scene.add(slab);
    slabs.set(f.id, slab);

    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(28, 0.05, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
    );
    marker.position.set(0, f.y + 0.2, 9.5);
    scene.add(marker);
    markers.set(f.id, marker);

    const group = new THREE.Group();
    group.userData.floorId = f.id;
    scene.add(group);
    groups.set(f.id, group);
  }

  let current = 'all';

  function setFloor(floorId) {
    if (floorId !== 'all' && !slabs.has(floorId)) return false;
    current = floorId;

    for (const [id, slab] of slabs) {
      const visible = floorId === 'all' || id === floorId;
      slab.visible = visible;
      markers.get(id).visible = visible;
      groups.get(id).visible = visible;

      // 「全部」视图：楼板半透明，能看见下层点位；单层则恢复不透明。
      const mat = slab.material;
      const wantTransparent = floorId === 'all';
      if (mat.transparent !== wantTransparent) {
        mat.transparent = wantTransparent;
        mat.needsUpdate = true; // 坑 2：必须重编译着色器
      }
      mat.opacity = wantTransparent ? 0.28 : 1;
    }
    return true;
  }

  return {
    setFloor,
    getFloor: () => current,
    getGroup: (floorId) => groups.get(floorId),
    getSlab: (floorId) => slabs.get(floorId),
    getFloorTop: (floorId) => FLOOR_TOPS[floorId],
    floors: () => [...slabs.keys()],
  };
}
