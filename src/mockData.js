// 店铺点位数据（占位）。
// 契约见 docs/CONTRACTS.md §二；点位居点清单见 docs/STORES_CANDIDATES.md v2；
// 依据 D012（2026-11-27 定稿）与来源 E26/E28/E29/E30。详见 docs/RESEARCH.md。
// 重要：这批坐标与 entrance 全部是「示意值」，verified 只能到 public；
// 现场核实后由 B 的 data/stores.json 覆盖。绝不可把这里的坐标写成 observed。

export const FLOORS = [
  { id: 'f6', name: '6F 品味', level: 6, y: 0 },
  { id: 'f7', name: '7F 珍馐', level: 7, y: 4 },
  { id: 'f8', name: '8F 欢聚', level: 8, y: 8 },
];

// 10 个点位，严格对齐 D012 与 docs/STORES_CANDIDATES.md v2（2026-11-27）。
// 分布：6F 1（CGV，非餐饮视觉锚点）/ 7F 3 / 8F 6。
// 全部 verified=public（楼层有公开来源、方位为示意）；现场核实后由 B 的 data/stores.json 覆盖。
// 注意：编号按 D012 §五做了重排（凑凑已关闭剔除、上井剔除、新增滨寿司），不是原编号顺延。
export const STORES = [
  { id: 's01', name: '巴奴毛肚火锅', floor: 'f8', category: '火锅', x: -8, z: -6, entrance: { x: -8, z: -4.5 }, verified: 'public', source: 'E28' },
  { id: 's02', name: '太二酸菜鱼', floor: 'f8', category: '酸菜鱼', x: 6, z: -9, entrance: { x: 6, z: -7.5 }, verified: 'public', source: 'E28+E29' },
  { id: 's03', name: '曼玉融合餐厅', floor: 'f8', category: '融合菜', x: 2, z: 5, entrance: { x: 2, z: 6.5 }, verified: 'public', source: 'E28' },
  { id: 's04', name: '炉小哥烤肉', floor: 'f8', category: '烤肉', x: -3, z: -9, entrance: { x: -3, z: -7.5 }, verified: 'public', source: 'E28' },
  { id: 's05', name: '胖哥俩肉蟹煲', floor: 'f8', category: '肉蟹煲', x: 9, z: 3, entrance: { x: 9, z: 4.5 }, verified: 'public', source: 'E29', note: '工商登记 L8-S7A，2026-10-29 仍开业' },
  { id: 's06', name: '滨寿司 HAMA-SUSHI', floor: 'f8', category: '回转寿司', x: -6, z: 3, entrance: { x: -6, z: 4.5 }, verified: 'public', source: 'E29', note: '2026-06-30 开业 480㎡，高峰等位 3–4h、只现场取号' },
  { id: 's07', name: '麻布食堂 Azabu', floor: 'f7', category: '日料', x: 4, z: 8, entrance: { x: 4, z: 9.5 }, verified: 'public', source: 'E26' },
  { id: 's08', name: '豆捞坊', floor: 'f7', category: '潮汕牛肉火锅', x: -10, z: 4, entrance: { x: -10, z: 5.5 }, verified: 'public', source: 'E28+E29' },
  { id: 's09', name: '犇小喜鲜活火锅自助', floor: 'f7', category: '火锅自助', x: -5, z: 8, entrance: { x: -5, z: 9.5 }, verified: 'public', source: 'E26', note: '11-16 开业为宣传口径，存续待核' },
  { id: 's10', name: 'CGV影城', floor: 'f6', category: '影院', x: 0, z: 0, entrance: { x: 0, z: 2 }, verified: 'public', source: 'E29', note: '6F 视觉锚点，非餐饮；无门头照走文字招牌降级' },
];

// 公开资料里出现、但本期不建点位的品牌（D011 §4 / D012：未列入的不虚构坐标）。
// 搜索命中时按 A03 返回「不在本期导览范围，数据待补」，不得补假坐标。
export const CATALOG_NO_COORDS = [
  { name: '凑凑火锅', note: '2026-01 已关闭（E30，多源一致），不导览', source: 'E30' },
  { name: '上井精致日本料理', note: '仅有 2018 年榜单支撑，无 2026 证据、无门头，已剔除', source: 'E27' },
  { name: '肯迪文 KENT&CURWEN', note: '1F 河南首店，超出本期 6–8F 范围', source: 'E26' },
  { name: '喜茶', note: '公开信息在 1F，不在本期范围', source: 'E27' },
  { name: '海底捞', note: '存在性无可信来源，待核', source: '—' },
  { name: '羲和雅苑', note: '7F 候选，未取得点位级来源，2026 存续待核', source: 'E27' },
  { name: '鹿港小镇', note: '7F 候选，未取得点位级来源，2026 存续待核', source: 'E27' },
  { name: '外婆私房菜', note: '7F 候选，未取得点位级来源，2026 存续待核', source: 'E27' },
  { name: '花界绽放', note: '7F 候选，仅 2018 年图，2026 存续待核', source: 'E27' },
  { name: '吉兆', note: '7F 候选，仅 2018 年图，2026 存续待核', source: 'E27' },
  { name: '嬷冉广西菜', note: '6F 候选，2026 年中攻略提及但无铺位号', source: 'E29' },
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
