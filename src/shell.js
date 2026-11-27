import * as THREE from 'three';

// 建筑外壳（C-01 / D011 §1）。
//
// 问题：内部只建 6–8F，外部看就是「三层楼板悬空」——A11 明确判不通过。
// 做法：套一个整栋楼的外壳，**朝相机的那两面剖开**，观众从切口看进内部。
//
// 为什么是「两面」不是「一面」：相机初始位在 (+x, +z) 一带，45° 斜看。
// 只切一面的话，另一面墙会横在画面前景挡住整个内部（实测过），
// 切两面等于剖开一个娃娃屋，这是 D011「单面剖切」要达到的效果。
//
// 外墙不直接贴 official/building-1~6 的实拍照片：那六张是 780×520 的透视实景照，
// 贴到 34×40 米的立面上会糊成一片，而且把第三方摄影作品当交付贴图也不合规
// （《真实性声明》第三条口径）。这里只取它们的立面配色与分带规律，程序化画出幕墙，
// 六张照片继续作为外观依据留在素材包里。

const FLOOR_H = 4;          // 与 mockData.FLOORS 的间距一致（y = 0 / 4 / 8）
const BOTTOM_LEVEL = 1;     // 1F 地面
const TOP_LEVEL = 9;        // 9F 顶
// 外壳高度只到 8F 楼板上方 4m（y=12）：再高会让中庭洞里看到外墙内侧的幕墙横条纹，
// 读起来像「洞里有百叶」，而不是「透过中庭看到下层」。
const BASE_Y = -5 * FLOOR_H; // f6 的 y=0 对应 6F 地面，往下推 5 层到 1F 地面
// 外扩到能包住 floorPlan 的楼板（约 47×43）+ 两侧走廊。
const OUTER_W = 56;
const OUTER_D = 52;

// 立面纹理：一层楼一个循环（窗带 + 石材带）。repeat 按实际层数铺。
// 刻意画得「粗」：远处看时密集竖线会糊成格栅噪点，反而比不画难看得多。
// 一层 4m 对 64px，一个纹理单元就是一层，竖向上不会被压扁。
function createFacadeTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d');

  // 石材底色：暖灰，比场景的背景亮一档但别抢店铺招牌的视线
  ctx.fillStyle = '#8f8a80';
  ctx.fillRect(0, 0, 128, 64);

  // 玻璃窗带（占一层高度的 40%）
  ctx.fillStyle = '#2f3b4a';
  ctx.fillRect(0, 24, 128, 24);

  // 窗带里只留两条竖梃（每 64px 一条），不画密集窗格
  ctx.fillStyle = 'rgba(143,138,128,.6)';
  for (let x = 0; x < 128; x += 64) ctx.fillRect(x, 24, 3, 24);

  // 层间阴影线：拉出楼层关系
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.fillRect(0, 22, 128, 3);
  ctx.fillRect(0, 47, 128, 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// 每面墙单独 clone 纹理：两面墙尺寸不同，共用一个 repeat 会有一面被拉扁。
function facadeFor(width, levels) {
  const tex = createFacadeTexture();
  tex.repeat.set(Math.max(1, Math.round(width / 6)), levels);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0.05 });
}

export function createShell(scene) {
  const group = new THREE.Group();
  group.userData = { kind: 'shell' };

  const totalH = 12 - BASE_Y; // 只到 8F 楼板上方 4m（y=12），不建满 9 层
  const centerY = BASE_Y + totalH / 2;
  const levels = totalH / FLOOR_H;

  const plainMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.92 });

  // 保留的两面外墙（-x 与 -z）：观众从 +x/+z 的切口看进去
  const west = new THREE.Mesh(new THREE.PlaneGeometry(OUTER_D, totalH), facadeFor(OUTER_D, levels));
  west.position.set(-OUTER_W / 2, centerY, 0);
  west.rotation.y = Math.PI / 2;
  group.add(west);

  const north = new THREE.Mesh(new THREE.PlaneGeometry(OUTER_W, totalH), facadeFor(OUTER_W, levels));
  north.position.set(0, centerY, -OUTER_D / 2);
  group.add(north);

  // 屋顶：只盖后半（-z 侧）。
  // 铺满的话，相机从上方斜看时整片屋顶把内部挡死——试过，画面就是一块板。
  // 留一半敞开，等于把娃娃屋从斜上方剖开，同时仍有「有顶」的建筑感。
  const roof = new THREE.Mesh(new THREE.BoxGeometry(OUTER_W, 0.6, OUTER_D / 2), plainMat);
  roof.position.set(0, BASE_Y + totalH, -OUTER_D / 4);
  group.add(roof);

  // 屋顶女儿墙：一圈薄板，从斜上方看给建筑一个收边（缺了会像纸片）
  const parapetMat = new THREE.MeshStandardMaterial({ color: 0xe4ded2, roughness: 0.9, side: THREE.DoubleSide });
  const parapetH = 1.2;
  for (const [w, d, x, z] of [
    [OUTER_W, 0.3, 0, -OUTER_D / 2],
    [0.3, OUTER_D, -OUTER_W / 2, 0],
    [OUTER_W, 0.3, 0, OUTER_D / 2],
    [0.3, OUTER_D, OUTER_W / 2, 0],
  ]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, parapetH, d), parapetMat);
    p.position.set(x, BASE_Y + totalH + parapetH / 2, z);
    p.userData.kind = 'parapet';
    group.add(p);
  }

  // 走廊封边：外壳内壁和楼板外侧之间有 3m 走廊，补两条与外墙齐平的封边，
  // 否则从切口看进去，楼层边缘是空的，楼板像浮在壳里。
  // 剖切的 +x/+z 两面**不加**——楼板本身是 Box，端面就在那儿；
  // 再加一条 34m 长的横条会从切口伸出来，看起来像笼子（试过，很丑）。
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xb8b0a2, roughness: 0.95 });
  for (let i = BOTTOM_LEVEL; i <= TOP_LEVEL + 1; i++) {
    const y = BASE_Y + (i - BOTTOM_LEVEL) * FLOOR_H - 0.175;
    for (const [bw, bd, bx, bz] of [
      [OUTER_W - 0.2, 0.28, 0, -OUTER_D / 2 + 0.14],
      [0.28, OUTER_D - 0.2, -OUTER_W / 2 + 0.14, 0],
    ]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.35, bd), edgeMat);
      strip.position.set(bx, y, bz);
      group.add(strip);
    }
  }

  scene.add(group);

  return {
    group,
    setVisible(v) { group.visible = v; },
    // 切单层时把屋顶收起来：相机在中庭上方俯视，屋顶正好横在视线上，
    // 不收的话整层都被那块板挡住。
    setRoofVisible(v) { roof.visible = v; },
    // 降级用：只留墙，去掉女儿墙与封边（远景细节）
    setDetailLevel(level) {
      group.traverse((o) => {
        if (o.userData.kind === 'parapet') o.visible = level < 2;
      });
    },
  };
}
