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
//
// 坐标依据（2026-11-27 修订）：按本队实拍的楼层导览牌
// （public/assets/zhenghongcheng/floor-guides/floor-guide-{6,7,8}f.jpg）
// 上的**相对方位**摆放——楼板换成环形、中间挖出中庭洞之后，原来的示意坐标
// 会有一半落在中庭里，必须重排。这里只保证「相对方位与楼层正确」，
// 米级精度仍以 B 的现场测量为准。
// entrance 一律取「点位向中庭方向 1.5m」，即站在门口的位置。
// 全部 verified=public（楼层有公开来源、方位为示意）。
// 注意：编号按 D012 §五做了重排（凑凑已关闭剔除、上井剔除、新增滨寿司），不是原编号顺延。
export const STORES = [
  { id: 's01', name: '巴奴毛肚火锅', floor: 'f8', category: '火锅', x: 2, z: 24, entrance: { x: -1.5, z: 15.1 }, verified: 'public', source: 'E28', note: '导览牌位于 8F 南侧' },
  { id: 's02', name: '太二酸菜鱼', floor: 'f8', category: '酸菜鱼', x: 12, z: -2, entrance: { x: 13.6, z: -0.6 }, verified: 'public', source: 'E28+E29', note: '导览牌位于中庭东南侧' },
  { id: 's03', name: '曼玉融合餐厅', floor: 'f8', category: '融合菜', x: 5, z: -22, entrance: { x: 3.4, z: -15 }, verified: 'public', source: 'E28', note: '导览牌位于中庭北侧' },
  { id: 's04', name: '炉小哥烤肉', floor: 'f8', category: '烤肉', x: -12, z: -22, entrance: { x: -11.2, z: -13.3 }, verified: 'public', source: 'E28', note: '导览牌位于 8F 西北角' },
  { id: 's05', name: '胖哥俩肉蟹煲', floor: 'f8', category: '肉蟹煲', x: 16, z: 12, entrance: { x: 16.1, z: 10.3 }, verified: 'public', source: 'E29', note: '工商登记 L8-S7A，2026-10-29 仍开业' },
  { id: 's06', name: '滨寿司 HAMA-SUSHI', floor: 'f8', category: '回转寿司', x: 18, z: 6, entrance: { x: 17.7, z: 3.7 }, verified: 'public', source: 'E29', note: '2026-06-30 开业 480㎡，高峰等位 3–4h、只现场取号' },
  { id: 's07', name: '麻布食堂 Azabu', floor: 'f7', category: '日料', x: 2, z: 8, entrance: { x: 3.8, z: 6 }, verified: 'public', source: 'E26', note: '导览牌 L708，中庭南侧' },
  { id: 's08', name: '豆捞坊', floor: 'f7', category: '潮汕牛肉火锅', x: -12, z: 6, entrance: { x: -5.1, z: 0.9 }, verified: 'public', source: 'E28+E29', note: '导览牌 L709，中庭西侧' },
  { id: 's09', name: '犇小喜鲜活火锅自助', floor: 'f7', category: '火锅自助', x: 10, z: 18, entrance: { x: 11.1, z: 13.6 }, verified: 'public', source: 'E26', note: '11-16 开业为宣传口径，存续待核' },
  { id: 's10', name: 'CGV影城', floor: 'f6', category: '影院', x: -18, z: 0, entrance: { x: -11.5, z: -0.3 }, verified: 'public', source: 'E29', note: '6F 西侧整片，非餐饮；无门头照走文字招牌降级' },
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
// __HAS_STORES_DATA__ 由 vite.config.js 在启动/构建时注入（见 define）：
// 文件不在时直接跳过请求，避免线上留一条无法 catch 的 404。
// 注意：dev 期间新增该文件需重启 dev server 才会生效。
// 返回 { floors, stores, source: 'file' | 'mock' }。
export async function loadStores() {
  if (!__HAS_STORES_DATA__) {
    return { floors: FLOORS, stores: STORES, source: 'mock' };
  }
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/stores.json`);
    if (res.ok) {
      const data = await res.json();
      const floorIds = new Set((data.floors || []).map((f) => f.id));
      const valid = Array.isArray(data.stores) && Array.isArray(data.floors)
        && data.stores.every((s) => s.id && s.name && s.floor && s.entrance
          && Number.isFinite(s.x) && Number.isFinite(s.z)
          && floorIds.has(s.floor));
      if (valid) {
        // 契约示例里 floors 只有 level、没有 y；场景代码（floorView / guide）按 y 放楼板。
        // 这里兜底推算：y = (level - 6) * 4，与占位数据 6F=0 / 7F=4 / 8F=8 一致。
        // 文件里显式给了 y 就以文件为准——现场测过的值更可信。
        const floors = data.floors.map((f) => {
          const hasY = Number.isFinite(f.y);
          const y = hasY ? f.y : (Number.isFinite(f.level) ? (f.level - 6) * 4 : NaN);
          if (!Number.isFinite(y)) console.warn(`[stores] 楼层 ${f.id} 缺 y 且 level 非法，已回退占位数据`);
          return { ...f, y };
        });
        if (!floors.every((f) => Number.isFinite(f.y))) {
          return { floors: FLOORS, stores: STORES, source: 'mock' };
        }
        return { floors, stores: data.stores, source: 'file' };
      }
      console.warn('[stores] data/stores.json 字段校验未通过，已回退占位数据');
    }
  } catch {
    // 文件不存在或解析失败，静默回退占位数据。
  }
  return { floors: FLOORS, stores: STORES, source: 'mock' };
}
