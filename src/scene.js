import * as THREE from 'three';

// 场景搭建：按楼层铺地板 + 按 mock 数据生成店铺点位。
// 后续用 Blender 导出的 GLB 替换这里的程序化占位几何体（D006）。
// 占位几何体不代表最终模型，仅用于把「数据→场景」联动链路先跑通。

export function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(10, 20, 10);
  scene.add(dir);

  return scene;
}

// 返回 { storeMeshes: Map<storeId, { mesh, mat }> }，供 dataLink 改颜色
export function buildFloorsAndStores(scene, floors, stores) {
  const storeMeshes = new Map();
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b });

  for (const f of floors) {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(28, 0.3, 20),
      floorMat
    );
    slab.position.set(0, f.y, 0);
    scene.add(slab);

    // 楼层标签用 sprite 太复杂，这里用一个小标记平面（占位）
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(28, 0.05, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
    );
    marker.position.set(0, f.y + 0.2, 9.5);
    scene.add(marker);
  }

  for (const s of stores) {
    const floor = floors.find((f) => f.id === s.floor);
    if (!floor) continue;

    const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), mat);
    mesh.position.set(s.x, floor.y + 0.3 + 0.8, s.z);
    mesh.userData = { storeId: s.id, name: s.name };
    scene.add(mesh);
    storeMeshes.set(s.id, { mesh, mat });
  }

  return storeMeshes;
}
