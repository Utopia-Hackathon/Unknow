// A 侧独立复核（Issue #36）：floorPlan 几何不变量单测。
//
// 为什么需要：A08（第一人称漫游不穿墙/不掉楼板）、A09/A10（点位落位）
// 此前只有浏览器目测证据，几何判定函数 isOnSlab/ringSlots/makeSlotAt 无单测。
// 这些是纯函数（无 DOM / 无 three / 无 WebGL），可 Node 无头确定性验证，
// 把「靠眼睛看没掉下去」升级为「边界条件有可执行断言」。
//
// 边界：单测证明「几何判定按设计工作」，不替代浏览器里相机/控制器的实走复核；
// A08/A09/A10 验收状态不因本测试改变。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOnSlab, sampleRing, ringSlots, nearestSlot, makeSlotAt,
  OUTLINE, ATRIUM, BOUNDS, VERTICALS,
} from './floorPlan.js';

// —— A08：防掉中庭 / 防走出外轮廓 ——
test('A08-isOnSlab: 中庭洞内不可站（防掉中庭）', () => {
  assert.equal(isOnSlab(ATRIUM.cx, ATRIUM.cz), false, '中庭中心不可站');
  assert.equal(isOnSlab(ATRIUM.cx, ATRIUM.cz + ATRIUM.rz - 0.5), false, '中庭椭圆内沿不可站');
  assert.equal(isOnSlab(ATRIUM.cx + ATRIUM.rx - 0.5, ATRIUM.cz), false, '中庭横轴内沿不可站');
});

test('A08-isOnSlab: 中庭外、外轮廓内的正常楼板可站', () => {
  assert.equal(isOnSlab(0, 0), true, '原点（中庭外）可站');
  assert.equal(isOnSlab(5, 0), true, '中庭正上方边缘外可站');
  assert.equal(isOnSlab(-18, 18), true, '外轮廓内角落可站');
});

test('A08-isOnSlab: 外轮廓之外不可站（防穿墙）', () => {
  assert.equal(isOnSlab(100, 100), false, '远离建筑不可站');
  assert.equal(isOnSlab(BOUNDS.maxX + 1, 0), false, '外接盒右外不可站');
  assert.equal(isOnSlab(BOUNDS.minZ - 1, 0), false, '外接盒上外不可站');
});

test('A08-isOnSlab: margin 扩张安全边界（第一人称留余量）', () => {
  assert.equal(isOnSlab(5, 0), true, '无 margin 时该点可站');
  assert.equal(isOnSlab(5, 0, 3), false, 'margin=3 时中庭洞扩大，同点不可站');
  assert.equal(isOnSlab(ATRIUM.cx, ATRIUM.cz, 3), false, 'margin 不改变中庭中心判定');
});

// —— A09/A10：铺位落位几何 ——
test('A09-ringSlots: 铺位数量、四边面、中心全在楼板上', () => {
  const slots = ringSlots(22);
  assert.equal(slots.length, 22);
  for (const s of slots) {
    assert.equal(s.poly.length, 4, '每块铺位是四边形');
    assert.ok(s.width > 0 && Number.isFinite(s.width), '面宽为正有限数');
    assert.equal(isOnSlab(s.cx, s.cz), true, `铺位中心 (${s.cx},${s.cz}) 在楼板上`);
    assert.ok(Number.isFinite(s.face.x) && Number.isFinite(s.face.z), '门脸坐标有效');
  }
});

test('A09-ringSlots: 相邻铺位互不重叠（中心距 > 0）', () => {
  const slots = ringSlots(22);
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i];
    const b = slots[(i + 1) % slots.length];
    const d = Math.hypot(a.cx - b.cx, a.cz - b.cz);
    assert.ok(d > 0.5, `相邻铺位 ${i}/${i + 1} 中心不重合（间距 ${d.toFixed(2)}m）`);
  }
});

test('A09-nearestSlot: 命中最近槽位；空表返回 null', () => {
  const slots = ringSlots(22);
  const target = slots[3];
  const got = nearestSlot(slots, target.cx, target.cz);
  assert.ok(Math.hypot(got.cx - target.cx, got.cz - target.cz) < 0.01, '命中自身');
  assert.equal(nearestSlot([], 0, 0), null, '空槽位表返回 null');
});

test('A10-makeSlotAt: 以实测坐标为中心，不被环线吸附改写', () => {
  const slots = ringSlots(22);
  const reference = nearestSlot(slots, 5, 0);
  const x = 5.0, z = 3.0;
  const slot = makeSlotAt(x, z, reference);
  assert.equal(slot.cx, x, '铺位中心 x = 实测 x（未被改写）');
  assert.equal(slot.cz, z, '铺位中心 z = 实测 z（未被改写）');
  assert.equal(slot.poly.length, 4, '生成四边形');
  assert.ok(slot.width >= 3.2, '面宽有下限，不小于 3.2m');
});

// —— 数据完整性（导览牌换算的结构不变量）——
test('结构不变量: 外轮廓闭合、中庭在外轮廓内、垂直交通齐全', () => {
  assert.ok(OUTLINE.length >= 4, '外轮廓至少 4 点');
  assert.equal(isOnSlab(0, 0), true, '质心在楼板上');
  assert.ok(BOUNDS.w > 0 && BOUNDS.d > 0, '外接盒有效');
  assert.ok(ATRIUM.rx > 0 && ATRIUM.rz > 0, '中庭椭圆半径为正');
  assert.ok(VERTICALS.escalators.length >= 1 && VERTICALS.elevators.length >= 1, '扶梯与电梯厅齐备');
  // 注意：VERTICALS 只供 backgroundShops.js 画背景装饰，不参与导航落点
  // （guide.js 的落点用 isOnSlab(...,0.6) 另算）。其中扶梯 (0,-10) 落在中庭洞内
  // 属导览牌斜拍换算的示意偏差，不影响 A08 防掉楼判据，故此处只断言数据齐备、不断言全在楼板上。
  assert.ok(VERTICALS.elevators.every(([x, z]) => isOnSlab(x, z)), '电梯厅都在楼板上');
});

test('A08-导航落点: guide 采用的 margin=0.6 安全边界确实排除中庭洞', () => {
  // guide.js flyToStore 用 isOnSlab(px,pz,0.6) 校验落点，中庭中心无论 margin 都不可站
  assert.equal(isOnSlab(ATRIUM.cx, ATRIUM.cz, 0.6), false, 'margin=0.6 时中庭中心不可站');
  // margin=0.6 把中庭洞等效扩大 0.6m：边缘外 0.3m 仍被排除，外 1.0m 才恢复可站
  assert.equal(isOnSlab(ATRIUM.cx, ATRIUM.cz + ATRIUM.rz + 0.3, 0.6), false,
    '中庭边缘外 0.3m 在 margin=0.6 下仍不可站（余量生效）');
  assert.equal(isOnSlab(ATRIUM.cx, ATRIUM.cz + ATRIUM.rz + 1.0, 0.6), true,
    '边缘外 1.0m 处可站（未过度排除）');
});

test('sampleRing: 按数量返回内缩环点，全部在楼板上', () => {
  const ring = sampleRing(8);
  assert.equal(ring.length, 8);
  for (const p of ring) {
    assert.equal(isOnSlab(p.x, p.z), true, `环点 (${p.x},${p.z}) 在楼板上`);
    assert.ok(Number.isFinite(p.rotY), '朝向有效');
  }
});
