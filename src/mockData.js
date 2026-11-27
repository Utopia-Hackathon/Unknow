// 店铺点位数据（占位）。
// 契约见 docs/CONTRACTS.md §二；候选来源见 docs/STORES_CANDIDATES.md（E26/E27/E28）。
// 重要：这批坐标与 entrance 全部是「示意值」，verified 只能到 public/unverified；
// 现场核实后由 B 的 data/stores.json 覆盖。绝不可把这里的坐标写成 observed。

export const FLOORS = [
  { id: 'f6', name: '6F 品味', level: 6, y: 0 },
  { id: 'f7', name: '7F 珍馐', level: 7, y: 4 },
  { id: 'f8', name: '8F 欢聚', level: 8, y: 8 },
];

// 10 个候选点位（示意坐标）。太二、曼玉已按 E28 修正为 f8（旧 mockData 误写 f7）。
// s02/s06/s08 只有 2018 年第三方楼层表作来源，标 unverified，现场确认前不得升级。
export const STORES = [
  { id: 's01', name: '巴奴毛肚火锅', floor: 'f8', category: '火锅', x: -8, z: -6, entrance: { x: -8, z: -4.5 }, verified: 'public', source: 'E28' },
  { id: 's02', name: '凑凑火锅·茶憩', floor: 'f8', category: '火锅', x: 6, z: -6, entrance: { x: 6, z: -4.5 }, verified: 'unverified', source: 'E27', note: '无点位级铺位号，待现场核实' },
  { id: 's03', name: '太二酸菜鱼', floor: 'f8', category: '酸菜鱼', x: 6, z: -9, entrance: { x: 6, z: -7.5 }, verified: 'public', source: 'E28' },
  { id: 's04', name: '曼玉融合餐厅', floor: 'f8', category: '融合菜', x: 2, z: 5, entrance: { x: 2, z: 6.5 }, verified: 'public', source: 'E28' },
  { id: 's05', name: '炉小哥烤肉', floor: 'f8', category: '烤肉', x: -3, z: -9, entrance: { x: -3, z: -7.5 }, verified: 'public', source: 'E28' },
  { id: 's06', name: '胖哥俩肉蟹煲', floor: 'f8', category: '肉蟹煲', x: 9, z: 3, entrance: { x: 9, z: 4.5 }, verified: 'unverified', source: 'E27', note: '无点位级铺位号，待现场核实' },
  { id: 's07', name: '豆捞坊', floor: 'f7', category: '火锅', x: -10, z: 4, entrance: { x: -10, z: 5.5 }, verified: 'public', source: 'E28' },
  { id: 's08', name: '上井精致日本料理', floor: 'f7', category: '日料', x: 8, z: 4, entrance: { x: 8, z: 5.5 }, verified: 'unverified', source: 'E27', note: '无点位级铺位号，待现场核实' },
  { id: 's09', name: '犇小喜鲜活火锅自助', floor: 'f7', category: '火锅自助', x: -5, z: 8, entrance: { x: -5, z: 9.5 }, verified: 'public', source: 'E26', note: '11-16 开业为宣传口径，存续待核' },
  { id: 's10', name: '麻布食堂 Azabu', floor: 'f7', category: '日料', x: 4, z: 8, entrance: { x: 4, z: 9.5 }, verified: 'public', source: 'E26' },
];

// 公开资料里出现、但本期不建点位的品牌（D011 §4：未列入的不虚构坐标）。
// 搜索命中时按 A03 返回「不在本期导览范围，数据待补」，不得补假坐标。
export const CATALOG_NO_COORDS = [
  { name: '肯迪文 KENT&CURWEN', note: '1F 河南首店，超出本期 6–8F 范围', source: 'E26' },
  { name: '喜茶', note: '公开信息在 1F，不在本期范围', source: 'E27' },
  { name: '海底捞', note: '存在性无可信来源，待核', source: '—' },
  { name: '羲和雅苑', note: '7F 候选，未取得点位级来源', source: 'E27' },
  { name: '鹿港小镇', note: '7F 候选，未取得点位级来源', source: 'E27' },
  { name: '外婆私房菜', note: '7F 候选，未取得点位级来源', source: 'E27' },
  { name: '玩心小镇', note: '8 周年营销场景，非常驻店铺', source: 'E26' },
];

// 优先读 B 产出的 data/stores.json；不存在或格式不对时回退到占位数据。
// 返回 { floors, stores, source: 'file' | 'mock' }。
export async function loadStores() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/stores.json`);
    if (res.ok) {
      const data = await res.json();
      const valid = Array.isArray(data.stores) && Array.isArray(data.floors)
        && data.stores.every((s) => s.id && s.name && s.floor && s.entrance);
      if (valid) return { floors: data.floors, stores: data.stores, source: 'file' };
    }
  } catch {
    // 文件不存在或解析失败，静默回退占位数据。
  }
  return { floors: FLOORS, stores: STORES, source: 'mock' };
}
