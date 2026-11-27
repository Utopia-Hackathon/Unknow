import * as THREE from 'three';
import { OUTLINE, ATRIUM, BOUNDS } from './floorPlan.js';

// 楼层可见性 + 楼板几何。D007 / 契约 §四 setFloor：只切可见性，不重建场景。
//
// 楼板不再是矩形 Box：按导览牌的外轮廓 + 中间的中庭洞做成环形板
// （Shape + hole + Extrude）。矩形板是脚手架占位，跟正弘城没有关系。
//
// 两个已知坑（Issue #12）：
//   1. 楼板顶面在 floor.y + 0.15（板厚 0.3），叠加层画在 +0.04 会被吞掉；
//   2. 运行时改 material.transparent 必须 needsUpdate = true，否则着色器不重编译。

export const FLOOR_TOPS = {}; // floorId -> y（楼板顶面高度），供 guide.js 画光圈用

const SLAB_THICKNESS = 0.3;

// 环形楼板：外轮廓多边形挖掉中庭椭圆。
// Extrude 在 XY 平面挤出 +Z，rotateX(π/2) 之后 (u, v, w) → (u, -w, v)，
// 所以 shape 直接传 (x, z)，挤出方向自然朝下（Y ∈ [-0.3, 0]）。
function buildSlabGeometry() {
  const shape = new THREE.Shape();
  OUTLINE.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
  shape.closePath();

  const hole = new THREE.Path();
  hole.absellipse(ATRIUM.cx, ATRIUM.cz, ATRIUM.rx, ATRIUM.rz, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: SLAB_THICKNESS,
    bevelEnabled: false,
    curveSegments: 48,
  });
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

// 地砖纹理：纯色楼板看起来像一块塑料板，加了分格才像商场地面。
// 一格 1.2m，浅缝深砖，靠 UV 重复铺满，不用贴大图。
function createFloorTiles() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#333a45';
  ctx.fillRect(0, 0, 128, 128);
  // 砖面轻微色差，避免整片死平
  ctx.fillStyle = '#363d49';
  ctx.fillRect(2, 2, 60, 60);
  ctx.fillRect(66, 66, 60, 60);
  ctx.fillStyle = '#2e3540';
  ctx.fillRect(66, 2, 60, 60);
  ctx.fillRect(2, 66, 60, 60);
  // 缝
  ctx.strokeStyle = 'rgba(15,20,28,.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 64, 64);
  ctx.strokeRect(64, 0, 64, 64);
  ctx.strokeRect(0, 64, 64, 64);
  ctx.strokeRect(64, 64, 64, 64);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export function createFloorView(floors, scene) {
  const slabs = new Map();   // floorId -> Mesh
  const markers = new Map(); // floorId -> Mesh（中庭边缘光带）
  const groups = new Map();  // floorId -> Group（该层的店铺体块）
  const rails = new Map();   // floorId -> 中庭栏杆
  const slabGeo = buildSlabGeometry();
  const tiles = createFloorTiles();
  // ExtrudeGeometry 的 UV 直接用米做单位（WorldUVGenerator），
  // 所以 repeat = 1/砖格边长，一格正好 1.2m。
  tiles.repeat.set(1 / 1.2, 1 / 1.2);

  for (const f of floors) {
    FLOOR_TOPS[f.id] = f.y + SLAB_THICKNESS / 2;

    const slab = new THREE.Mesh(
      slabGeo,
      new THREE.MeshStandardMaterial({
        map: tiles,
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
        roughness: 0.88,
        metalness: 0.04,
      })
    );
    slab.position.set(0, f.y + SLAB_THICKNESS / 2, 0);
    slab.userData.floorId = f.id;
    scene.add(slab);
    slabs.set(f.id, slab);

    // 中庭边缘光带：替代原来楼板南侧那根长条。
    // 现在楼板中间真有洞，光带贴着洞口走一圈，读作中庭栏杆的灯。
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1.0, 72),
      new THREE.MeshStandardMaterial({
        color: 0x3a3325,
        emissive: 0xd9b46a,
        emissiveIntensity: 0.5,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.scale.set(ATRIUM.rx, ATRIUM.rz, 1);
    ring.position.set(ATRIUM.cx, f.y + SLAB_THICKNESS / 2 + 0.02, ATRIUM.cz);
    ring.userData.floorId = f.id;
    scene.add(ring);
    markers.set(f.id, ring);

    // 中庭栏杆：沿椭圆立一圈矮柱。只有一条光带时，洞看起来像楼板断层；
    // 有栏杆才读得出「这是中庭」。柱高 1.05m，跟商场护栏同高。
    const railGroup = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x5b6474, roughness: 0.5, metalness: 0.4,
      emissive: 0x1a2230, emissiveIntensity: 0.4,
    });
    const POSTS = 28;
    for (let i = 0; i < POSTS; i++) {
      const a = (i / POSTS) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 0.08), postMat);
      post.position.set(
        ATRIUM.cx + Math.cos(a) * ATRIUM.rx,
        f.y + SLAB_THICKNESS / 2 + 0.52,
        ATRIUM.cz + Math.sin(a) * ATRIUM.rz
      );
      railGroup.add(post);
    }
    // 顶部扶手：用扁平的环逼近椭圆
    const hand = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1.015, 96),
      new THREE.MeshStandardMaterial({ color: 0x7a8494, roughness: 0.4, metalness: 0.5 })
    );
    hand.rotation.x = -Math.PI / 2;
    hand.scale.set(ATRIUM.rx, ATRIUM.rz, 1);
    hand.position.set(ATRIUM.cx, f.y + SLAB_THICKNESS / 2 + 1.02, ATRIUM.cz);
    railGroup.add(hand);
    railGroup.userData.floorId = f.id;
    railGroup.userData.kind = 'rails';
    scene.add(railGroup);
    rails.set(f.id, railGroup);

    const group = new THREE.Group();
    group.userData.floorId = f.id;
    scene.add(group);
    groups.set(f.id, group);
  }

  let current = 'all';
  let detailLevel = 0;

  function setFloor(floorId) {
    if (floorId !== 'all' && !slabs.has(floorId)) return false;
    current = floorId;

    for (const [id, slab] of slabs) {
      const visible = floorId === 'all' || id === floorId;
      slab.visible = visible;
      markers.get(id).visible = visible;
      rails.get(id).visible = visible;
      groups.get(id).visible = visible;

      // 「全部」视图：楼板要能透过去看下层。
      // 只调 opacity 不够——地砖贴图本身把颜色压得很深，三层叠起来还是一片黑。
      // 所以全部视图时把贴图摘掉、换成浅色线框感，单层再挂回去。
      const mat = slab.material;
      const wantTransparent = floorId === 'all';
      if (mat.transparent !== wantTransparent) {
        mat.transparent = wantTransparent;
        mat.needsUpdate = true; // 坑 2：必须重编译着色器
      }
      if (wantTransparent) {
        mat.map = null;
        mat.color.setHex(0x9fb0c6);
        mat.opacity = 0.16;
      } else {
        mat.map = tiles;
        mat.color.setHex(0xffffff);
        mat.opacity = 1;
      }
      mat.needsUpdate = true;
      mat.depthWrite = !wantTransparent; // 半透明叠三层会互相遮挡
    }
    return true;
  }

  // L2 降档钩子：中庭光带是纯装饰，掉帧时先关它
  function setDetailLevel(level) {
    detailLevel = level;
    for (const m of markers.values()) m.visible = level < 2 && (current === 'all' || m.userData.floorId === current);
  }

  return {
    setFloor,
    setDetailLevel,
    getDetailLevel: () => detailLevel,
    getFloor: () => current,
    getGroup: (floorId) => groups.get(floorId),
    getSlab: (floorId) => slabs.get(floorId),
    getFloorTop: (floorId) => FLOOR_TOPS[floorId],
    floors: () => [...slabs.keys()],
    bounds: BOUNDS,
  };
}
