import * as THREE from 'three';
import { createSignTexture, createPendingBadgeTexture } from './texturePipeline.js';

// 铺位体块（C-01 / D008）。
//
// 关键改变：**不再是方盒子**。真实商场的铺位是沿走廊切出来的——
// 面宽随楼层轮廓变化、临街面常常是斜的、进深各不相同。
// 这里的地面轮廓由 floorPlan.ringSlots() 沿外轮廓切出来，
// 每个铺位是一块独立的多边形，用 ExtrudeGeometry 拉成 3 米高的体块。
//
// 仍然不做店内陈设、家具、玻璃反射（D008 明确排除）。

/**
 * @param {object} opts
 * @param {string} opts.name 店名
 * @param {string} [opts.category] 业态（画在招牌副行）
 * @param {string} [opts.floorLabel] 楼层名
 * @param {number[][]} opts.poly 地面轮廓 [[x,z],...]（楼层局部坐标，米）
 * @param {{x:number,z:number,w:number}} opts.face 正面（朝走廊）的中点与面宽
 * @param {number} opts.rotY 正面朝向
 * @param {number} [opts.height] 体块高度
 * @param {number} [opts.color] 墙体颜色
 * @param {boolean} [opts.interactive] 是否参与高亮/待补样式
 */
export function createShopUnit(opts) {
  const {
    name, category = '', floorLabel = '', poly, face, rotY,
    height = 3, color = 0x424b5d, interactive = true, withSign = true,
  } = opts;

  const group = new THREE.Group();
  group.userData = { storeId: opts.storeId, name, floorId: opts.floorId, kind: 'shop' };

  // —— 体块：把铺位轮廓拉成棱柱 ——
  const shape = new THREE.Shape();
  poly.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  // 同楼板：Extrude 在 XY 面挤出 +Z，rotateX(π/2) 后 (u,v,w) → (u,-w,v)，
  // 所以直接传 (x,z)，挤出方向朝下，y ∈ [-height, 0]。
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.04 });
  const body = new THREE.Mesh(geo, bodyMat);
  body.position.y = height; // 抬到地面之上
  group.add(body);

  // 体块地面轮廓的质心：吊牌和角标都挂在这儿，跟 withSign 无关
  const centerX = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const centerZ = poly.reduce((a, p) => a + p[1], 0) / poly.length;

  // 招牌/门脸材质在 withSign 块里创建，但 setVisual / setHighlight 在块外要用，
  // 所以先声明在函数作用域，块内只赋值。
  let signMat = null;
  let frontMat = null;

  if (withSign) {
  // —— 正面：招牌带 + 门脸暗面 ——
  // 招牌贴在内沿中点，朝中庭。宽度取实际面宽，所以窄铺位的招牌也窄——
  // 这比统一尺寸的招牌更像真实商场。
  const signW = Math.max(1.2, face.w * 0.88);
  const signH = Math.min(0.85, height * 0.3);

  const signTex = createSignTexture({ name, category, _floorLabel: floorLabel });
  signMat = new THREE.MeshStandardMaterial({
    map: signTex,
    emissiveMap: signTex,
    emissive: 0xffffff,
    emissiveIntensity: 0.9,
    roughness: 0.6,
    metalness: 0.05,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), signMat);
  sign.position.set(face.x, height - signH / 2 - 0.08, face.z);
  sign.rotation.y = rotY;
  // 沿朝向法线往外挪一点，避免和墙面 z-fighting
  sign.position.x += Math.sin(rotY) * 0.06;
  sign.position.z += Math.cos(rotY) * 0.06;
  group.add(sign);

  // 门脸暗面：招牌以下的墙，压暗一档，让人看出「门在这儿」
  const frontH = height - signH - 0.16;
  frontMat = new THREE.MeshStandardMaterial({
    color: 0x1b222c, roughness: 0.95, emissive: 0x141a24, emissiveIntensity: 0.3,
  });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(signW * 0.96, frontH), frontMat);
  front.position.set(face.x, frontH / 2 + 0.05, face.z);
  front.rotation.y = rotY;
  front.position.x += Math.sin(rotY) * 0.05;
  front.position.z += Math.cos(rotY) * 0.05;
  group.add(front);

  // —— 顶部吊牌：俯视时唯一能读的招牌 ——
  // 用 Box 的 +y 面贴图而不是旋转过的 Plane——Plane 转 90° 后 UV 是反的，字会倒着。
  const topTex = createSignTexture({ name, category: '', _floorLabel: '' });
  const topSideMat = new THREE.MeshStandardMaterial({ color: 0x1a202b, roughness: 0.8 });
  const topFaceMat = new THREE.MeshStandardMaterial({
    map: topTex, emissiveMap: topTex, emissive: 0xffffff,
    emissiveIntensity: 1.0, roughness: 0.7,
  });
  const topSign = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(2.2, Math.min(3.6, face.w * 0.85)), 0.06, 1.0),
    [topSideMat, topSideMat, topFaceMat, topSideMat, topSideMat, topSideMat]
  );
  topSign.position.set(centerX, height + 0.05, centerZ);
  topSign.rotation.y = Math.PI; // 顶面 UV 的 v 朝下，转半圈字才正
  group.add(topSign);
  } // end withSign

  // 每个子 mesh 都带身份：Raycaster 命中的是子 mesh，不是 group
  group.traverse((o) => {
    if (o.isMesh) o.userData = { ...group.userData };
  });

  if (!interactive) return { group, setVisual() {}, setHighlight() {} };


  // 「数据待补」角标（D008 / A03）
  const badge = new THREE.Sprite(new THREE.SpriteMaterial({
    map: createPendingBadgeTexture(), transparent: true, depthTest: false,
  }));
  badge.scale.set(1.6, 0.4, 1);
  badge.position.set(centerX, height + 0.75, centerZ);
  badge.visible = false;
  group.add(badge);

  const baseColor = color;
  let highlighted = false;

  // 契约 §四：setStoreVisual(storeId, { color, texture, pending })
  function setVisual({ color: newColor, texture, pending } = {}) {
    if (typeof pending === 'boolean') {
      badge.visible = pending;
      bodyMat.color.setHex(pending ? 0x4b5563 : baseColor);
      if (signMat) signMat.emissiveIntensity = pending ? 0.15 : 0.9;
      if (frontMat) frontMat.color.setHex(pending ? 0x333a44 : 0x1b222c);
    }
    if (typeof newColor === 'number') bodyMat.color.setHex(newColor);
    if (texture && frontMat) {
      // 有实拍贴图时贴到正面那块暗面上（招牌留在它上面，形成门头 + 店名的层次）
      frontMat.map = texture;
      frontMat.color.setHex(0xffffff);
      frontMat.needsUpdate = true;
    }
  }

  // 高亮：招牌灯箱提亮 + 门脸暖光，不做整块涂色（体块大了会像块黄油）
  function setHighlight(on) {
    if (highlighted === on || !signMat) return;
    highlighted = on;
    signMat.emissiveIntensity = on ? 1.5 : 0.9;
    signMat.emissive.setHex(on ? 0xfbbf24 : 0xffffff);
    frontMat.emissive.setHex(on ? 0x7a4a10 : 0x141a24);
    frontMat.emissiveIntensity = on ? 0.9 : 0.3;
  }

  return { group, setVisual, setHighlight, signMat, frontMat, bodyMat, badge };
}
