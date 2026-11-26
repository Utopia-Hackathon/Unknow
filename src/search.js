// 店铺搜索：纯函数，无副作用，方便单测。对齐 A02 / A03。
// 三种结果状态：
//   found     - 命中且有坐标 → 高亮 + 路径
//   noCoords  - 公开资料收录但本期无点位 → A03「数据待补」，不虚构坐标
//   notFound  - 完全未收录 → 明确提示，不返回空白

export function searchStores(query, stores, catalogNoCoords = [], floors = []) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { status: 'empty', matches: [], message: '请输入店名、业态或楼层' };

  const floorName = (id) => floors.find((f) => f.id === id)?.name || id;

  const matches = stores.filter((s) => {
    const hay = [s.name, s.category || s.type || '', floorName(s.floor), s.floor]
      .join(' ').toLowerCase();
    return hay.includes(q);
  });

  if (matches.length > 0) {
    return {
      status: 'found',
      matches,
      message: `找到 ${matches.length} 家：${matches.map((s) => s.name).join('、')}`,
    };
  }

  const catalog = catalogNoCoords.filter((c) => c.name.toLowerCase().includes(q));
  if (catalog.length > 0) {
    return {
      status: 'noCoords',
      matches: catalog,
      message: `${catalog[0].name}：${catalog[0].note}（数据待补）`,
    };
  }

  return {
    status: 'notFound',
    matches: [],
    message: '未收录该店铺，本期导览不含此品牌',
  };
}
