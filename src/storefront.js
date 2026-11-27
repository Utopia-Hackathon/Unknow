import * as THREE from 'three';
import { createSignTexture, createPendingBadgeTexture } from './texturePipeline.js';

// 门脸体块（C-01 / D008）。
//
// 替换原来的 1.6³ 纯色方块。做法是「统一尺寸的门脸盒子」：
//   正面开口 + 招牌带 + 门斗内景，不做店内陈设、家具、玻璃反射（D008 明确排除）。
//
// 局部坐标系：原点在体块底面中心，**+z 是正面（朝走廊/中庭）**。
// 调用方负责把 group 放到楼层上并转向（见 main.js）。

export const STORE_BOX = { w: 4, h: 3, d: 3 };
const SIDE_WALL = 0.6;          // 两侧墙厚，剩 2.8 是门脸开口
const OPEN_W = STORE_BOX.w - SIDE_WALL * 2;
const SIGN_H = 0.9;             // 招牌带高度
const OPEN_H = STORE_BOX.h - SIGN_H - 0.12;

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

export function createStorefront(store, opts = {}) {
  const { texture = null, floorLabel = '' } = opts;
  const { w, h, d } = STORE_BOX;

  const group = new THREE.Group();
  group.userData = { storeId: store.id, name: store.name, floorId: store.floor, kind: 'storefront' };

  // 墙体：比纯色方块深，避免整片蓝；顶面稍亮一点接灯
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x39445a, roughness: 0.88, metalness: 0.04 });
  const topMat = new THREE.MeshStandardMaterial({ color: 0x4a566e, roughness: 0.8, metalness: 0.06 });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x232b39, roughness: 0.95 });

  // 后墙
  const back = box(w, h, 0.24, wallMat);
  back.position.set(0, h / 2, -d / 2 + 0.12);
  group.add(back);

  // 左右墙
  for (const sx of [-1, 1]) {
    const side = box(SIDE_WALL, h, d, wallMat);
    side.position.set(sx * (w / 2 - SIDE_WALL / 2), h / 2, 0);
    group.add(side);
  }

  // 顶板（兼作上层楼板下的吊顶）
  const top = box(w, 0.18, d, topMat);
  top.position.set(0, h - 0.09, 0);
  group.add(top);

  // 台基：抬高一点，看起来像有门口台阶，也避免体块和楼板 z-fighting
  const base = box(w, 0.12, d, baseMat);
  base.position.set(0, 0.06, 0);
  group.add(base);

  // 门斗内景：暗色平面放在门内 0.3m，制造进深；有贴图时换成门头照
  const innerMat = texture
    ? new THREE.MeshStandardMaterial({ map: texture, roughness: 0.72, metalness: 0.02 })
    : new THREE.MeshStandardMaterial({ color: 0x0d1219, roughness: 1, emissive: 0x2a2118, emissiveIntensity: 0.45 });
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(OPEN_W, OPEN_H), innerMat);
  inner.position.set(0, OPEN_H / 2 + 0.12, -d / 2 + 0.3);
  group.add(inner);

  // 招牌带：正面顶部。六个面只给 +z 贴图，其余用纯色，
  // 否则 BoxGeometry 会把招牌文字拉伸到侧面上（材质数组顺序 +x,-x,+y,-y,+z,-z）。
  const signTex = createSignTexture({ ...store, _floorLabel: floorLabel });
  const signSideMat = new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 0.9 });
  const signFaceMat = new THREE.MeshStandardMaterial({
    map: signTex,
    roughness: 0.55,
    metalness: 0.05,
    emissive: 0xffffff,
    emissiveMap: signTex,
    emissiveIntensity: 0.55, // 灯箱感：不靠环境光也看得清店名
  });
  const sign = box(w, SIGN_H, 0.16, [signSideMat, signSideMat, signSideMat, signSideMat, signFaceMat, signSideMat]);
  sign.position.set(0, h - SIGN_H / 2 - 0.06, d / 2 + 0.08);
  group.add(sign);

  // 门口光带：一块发光地面，和 guide.js 的地面光圈呼应，也标出入口方向
  const glowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(store._accent || 0xffc97a),
    transparent: true,
    opacity: 0.55,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(OPEN_W * 0.9, 0.36), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, 0.14, d / 2 - 0.1);
  group.add(glow);

  // 每个子 mesh 都带 storeId：Raycaster 命中的是子 mesh，不是 group
  group.traverse((o) => {
    if (o.isMesh) o.userData = { ...group.userData };
  });

  // 「数据待补」角标（D008 / A03）：仅 pending 时显示
  const badgeMat = new THREE.SpriteMaterial({
    map: createPendingBadgeTexture(),
    transparent: true,
    depthTest: false,
  });
  const badge = new THREE.Sprite(badgeMat);
  badge.scale.set(1.6, 0.4, 1);
  badge.position.set(0, h + 0.5, 0);
  badge.visible = false;
  group.add(badge);

  const defaultColors = { wall: wallMat.color.getHex(), top: topMat.color.getHex(), base: baseMat.color.getHex() };

  // 契约 §四：setStoreVisual(storeId, { color, texture, pending })
  function setVisual({ color, texture: newTex, pending } = {}) {
    if (typeof pending === 'boolean') {
      badge.visible = pending;
      const c = pending ? 0x4b5563 : defaultColors.wall; // 灰化表示「这儿的数据待补」
      wallMat.color.setHex(c);
      topMat.color.setHex(pending ? 0x5a636f : defaultColors.top);
      baseMat.color.setHex(pending ? 0x333a44 : defaultColors.base);
      signFaceMat.emissiveIntensity = pending ? 0.15 : 0.55;
      innerMat.color?.setHex(pending ? 0x2b3038 : 0x0d1219);
    }
    if (typeof color === 'number') {
      wallMat.color.setHex(color);
    }
    if (newTex) {
      innerMat.map = newTex;
      innerMat.color?.setHex(0xffffff);
      innerMat.needsUpdate = true;
    }
  }

  // 高亮：不再给整块涂琥珀色（1.6³ 时代那样做还看得清，体块大了会像块黄油），
  // 改成招牌灯箱提亮 + 门口光带变琥珀，和 guide.js 的地面光圈同色系。
  let highlighted = false;
  function setHighlight(on) {
    if (highlighted === on) return;
    highlighted = on;
    signFaceMat.emissiveIntensity = on ? 1.15 : 0.55;
    signFaceMat.emissive.setHex(on ? 0xfbbf24 : 0xffffff);
    glowMat.color.setHex(on ? 0xf59e0b : (store._accent || 0xffc97a));
    glowMat.opacity = on ? 0.9 : 0.55;
  }

  return { group, setVisual, setHighlight, signMat: signFaceMat, innerMat, glowMat, badge };
}

// 体块朝向：正面（+z）朝中庭。返回 { dirX, dirZ, rotY }，调用方据此摆位。
// 店在中庭正中时（如 CGV）没有「朝中庭」这回事，给固定朝向，避免 atan2(0,0)。
export function facingToAtrium(store) {
  const len = Math.hypot(store.x, store.z);
  if (len < 0.001) return { dirX: 0, dirZ: 1, rotY: 0 };
  const dirX = -store.x / len;
  const dirZ = -store.z / len;
  return { dirX, dirZ, rotY: Math.atan2(dirX, dirZ) };
}
