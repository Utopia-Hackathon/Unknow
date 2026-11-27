// 楼层平面（C-01 重建）。
//
// 数据依据：本队 2026-11-23 实拍的 6F/7F/8F 楼层导览牌
// （public/assets/zhenghongcheng/floor-guides/floor-guide-{6,7,8}f.jpg）。
//
// 为什么现在不用矩形楼板：那三块 28×20 的板子是脚手架占位，跟正弘城没有关系。
// 导览牌上的真实结构是——**一圈不规则的环形动线，中间偏右一个椭圆中庭**，
// 店铺沿环外圈排、4 处扶梯 + 3 个电梯厅分布其间。这层结构不建，场景就只是
// 「三层楼板上摆了几个方块」，评委一眼看出不是商场。
//
// 坐标系：米，原点在楼层中心；x 向东（图右），z 向南（图下）。
// 精度说明：导览牌是斜拍照片，纵向透视压缩，**不能按像素等比测绘**。
// 这里只保证「相对方位 + 楼层 + 环形关系」正确，不保证米级精度（D008 只要求这个）。
// 唯一编号与坐标的正式数据仍由 B 的 data/stores.json 提供，本文件只负责几何。

// 建筑外轮廓（逆时针）。三层共用——导览牌上三层的外形基本一致，
// 差异在店铺与业态，不在结构。
export const OUTLINE = [
  [-21.0, -19.0],
  [-9.0, -21.2],
  [3.0, -20.4],
  [8.5, -15.6],
  [20.0, -17.0],
  [24.2, -9.0],
  [23.0, 1.0],
  [25.0, 10.4],
  [19.0, 20.2],
  [7.0, 22.0],
  [-5.0, 21.0],
  [-16.0, 17.2],
  [-22.0, 8.0],
  [-22.0, -6.0],
];

// 中庭：导览牌上三层都是「中心偏右」一个大洞（8F/7F 椭圆，6F 接近圆角矩形）。
// 统一成椭圆，位置与相对大小按图取。
export const ATRIUM = { cx: 6.0, cz: -4.0, rx: 8.6, rz: 6.2 };

// 店铺带：从外轮廓向内退 CORRIDOR 米，这条环线就是动线；
// 店铺体块坐在环线上、面朝中庭（也就是面朝走廊）。
export const CORRIDOR_INSET = 6.2;

// 垂直交通（导览牌位置换算，示意）。跨层导航要用到，先建出来占位。
// escalator: 扶梯；elevator: 电梯厅
export const VERTICALS = {
  escalators: [
    [-11.5, -8.0],
    [-4.0, -9.5],
    [4.5, -11.0],
    [14.0, -2.0],
    [15.5, 6.0],
    [8.0, 13.5],
    [-6.0, 12.0],
  ],
  elevators: [
    [-8.5, -2.5],
    [7.5, 9.0],
    [17.5, 2.0],
  ],
};

// 背景铺位：**店名全部来自本队 11-23 实拍的楼层索引牌**，不是编的。
// 顺序 = 沿环线顺时针排列，渲染时按顺序铺满店铺带。
// 10 个核心点位（mockData / stores.json）不在这里，它们单独按方位摆放。
// 注意：牌上店名反映的是拍牌子当时的在营商户，最终以 11-29 现场为准。
export const BACKDROP = {
  f8: [
    '千秋', '江河里', '小黑土', '曼玉', '鲜阿太海南糟粕醋', '太二酸菜鱼',
    '果雨吧', '南京大牌档', '八楼·春茶臻选', '费大厨', '贝塔太空局',
    '食蟹记', '随食铭九色云', '兰湘子', '虎丫炒鸡', '好彩猪肚鸡',
    '真茶屋', '退罗街', '爷谷不泡茶', '那时新疆', '巴奴', 'kaolala',
  ],
  f7: [
    '铁板诱惑', 'YEE3', '野果', 'O\'EAT', '布嬿妤', '野山桐',
    '豆捞坊', '麻布食堂', '无刺泡泡', '甬江烟火', '陈麻婆',
    '春米', '孔德', '犇小喜', '神盾局', '直饮水站',
  ],
  f6: [
    '点都德', 'LILANZ', 'HLA', 'GXG', 'DQ', '沙驰', 'CALLISTC',
    'ZIOZIA', 'MEILLEUR MOMENT', 'kb:space', 'BOY LONDON', '速写',
    'RED VICUTU', 'JAKET', '白玉串城', '柳真真', '梅果', '苏坦',
    'PODOPODO', '沪小胖', '云山季', '同仁四季', '嬷冉', '森舍',
  ],
};

export const PLAN_SOURCE = 'floor-guides/floor-guide-*.jpg（本队实拍 2026-11-23）';

// —— 几何工具 ——

// 外轮廓按周长均匀采样，返回 { x, z, angle } 数组。
// angle 是该点处「向内的法线」方向，店铺靠它转向中庭。
export function sampleRing(count, inset = CORRIDOR_INSET) {
  const pts = OUTLINE.map(([x, z]) => ({ x, z }));
  const segments = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    segments.push({ a, b, len, start: total });
    total += len;
  }

  const out = [];
  for (let i = 0; i < count; i++) {
    const d = (i / count) * total;
    const seg = segments.find((s) => d >= s.start && d < s.start + s.len) || segments[0];
    const t = (d - seg.start) / seg.len;
    const px = seg.a.x + (seg.b.x - seg.a.x) * t;
    const pz = seg.a.z + (seg.b.z - seg.a.z) * t;
    // 向内收缩：朝质心方向挪 inset 米
    const cl = Math.hypot(px, pz) || 1;
    const nx = px - (px / cl) * inset;
    const nz = pz - (pz / cl) * inset;
    out.push({ x: nx, z: nz, rotY: Math.atan2(-nx, -nz) });
  }
  return out;
}

// 点是否在楼板内（多边形内 + 不在中庭洞里）。
// 第一人称靠它防掉楼、防走进中庭——A08 判据。
export function isOnSlab(x, z, margin = 0) {
  if (!pointInPolygon(x, z, OUTLINE)) return false;
  const dx = (x - ATRIUM.cx) / (ATRIUM.rx + margin);
  const dz = (z - ATRIUM.cz) / (ATRIUM.rz + margin);
  return dx * dx + dz * dz > 1;
}

// 沿外轮廓按周长等距采样（不内缩）。返回 { x, z, nx, nz }，
// n 是该点的单位内法线（朝楼板质心），铺位进深靠它往里推。
function sampleOutline(count) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < OUTLINE.length; i++) {
    const a = OUTLINE[i];
    const b = OUTLINE[(i + 1) % OUTLINE.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, len, start: total });
    total += len;
  }

  const out = [];
  for (let i = 0; i < count; i++) {
    const d = (i / count) * total;
    const seg = segs.find((s) => d >= s.start && d < s.start + s.len) || segs[0];
    const t = (d - seg.start) / seg.len;
    const x = seg.a[0] + (seg.b[0] - seg.a[0]) * t;
    const z = seg.a[1] + (seg.b[1] - seg.a[1]) * t;
    const cl = Math.hypot(x, z) || 1;
    out.push({ x, z, nx: -x / cl, nz: -z / cl });
  }
  return out;
}

/**
 * 把楼层沿动线切成一层铺位（真实商场的做法：铺位是沿走廊切出来的，
 * 不是一个个独立的方盒子——面宽随轮廓变化，还有斜边）。
 *
 * 每个槽位返回：外沿两点 + 内沿两点构成的四边形（= 一块铺位的地面轮廓），
 * 以及中心、朝向、面宽，够画体块和贴招牌。
 *
 * @param {number} count 切多少块
 * @param {number} depth 进深（米），从外轮廓往中庭方向推
 * @param {number} gap   相邻铺位之间留的墙厚（米）
 */
export function ringSlots(count, depth = 5.5, gap = 0.35) {
  const pts = sampleOutline(count);
  const slots = [];

  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % count];

    // 两端各收半个墙厚，铺位之间才有缝，不然连成一片看不出是分开的店
    const shrink = (gap / 2) / Math.max(0.001, Math.hypot(b.x - a.x, b.z - a.z));
    const ax = a.x + (b.x - a.x) * shrink;
    const az = a.z + (b.z - a.z) * shrink;
    const bx = b.x - (b.x - a.x) * shrink;
    const bz = b.z - (b.z - a.z) * shrink;

    // 内沿：沿各自法线往里推 depth
    const a2x = ax + a.nx * depth;
    const a2z = az + a.nz * depth;
    const b2x = bx + b.nx * depth;
    const b2z = bz + b.nz * depth;

    const poly = [
      [ax, az], [bx, bz], [b2x, b2z], [a2x, a2z],
    ];
    const cx = (ax + bx + b2x + a2x) / 4;
    const cz = (az + bz + b2z + a2z) / 4;

    // 内沿中点 = 铺位正面（朝走廊），招牌贴这儿
    const mx = (a2x + b2x) / 2;
    const mz = (a2z + b2z) / 2;
    const faceW = Math.hypot(b2x - a2x, b2z - a2z);

    // 正面朝向必须用**内沿这条线的法线**，不能用「中点指向中庭」——
    // 内沿常常是斜的，两者相差十几度，招牌就会斜插进墙里（截图里能看到）。
    const ex = b2x - a2x;
    const ez = b2z - a2z;
    const el = Math.hypot(ex, ez) || 1;
    let nx = ez / el;
    let nz = -ex / el;
    if ((ATRIUM.cx - mx) * nx + (ATRIUM.cz - mz) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }

    slots.push({
      poly,
      cx, cz,
      face: { x: mx, z: mz, w: faceW },
      normal: { x: nx, z: nz },
      rotY: Math.atan2(nx, nz),
      width: faceW,
    });
  }
  return slots;
}

// 找一个最靠近给定坐标的槽位（核心点位用它落到环上）
export function nearestSlot(slots, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const s of slots) {
    const d = Math.hypot(s.cx - x, s.cz - z);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// 楼板轮廓的外接盒，给相机和外壳用
export const BOUNDS = (() => {
  const xs = OUTLINE.map((p) => p[0]);
  const zs = OUTLINE.map((p) => p[1]);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
    w: Math.max(...xs) - Math.min(...xs),
    d: Math.max(...zs) - Math.min(...zs),
  };
})();
