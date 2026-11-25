// 模拟数据：店铺点位 + 排队/客流。
// 数据必须「真驱动场景变化」——客流变化会联动店铺热力颜色（见 dataLink.js）。
// 赛道 A 要求系统数据必须模拟，不得宣称接入真实商业系统（E23）。

export const FLOORS = [
  { id: 'f6', name: '6F 餐饮', y: 0 },
  { id: 'f7', name: '7F 正餐', y: 4 },
  { id: 'f8', name: '8F 火锅自助', y: 8 },
];

// 每个店铺：id、名称、楼层、平面坐标（米）、业态、基础排队人数
export const STORES = [
  { id: 's01', name: '巴奴毛肚火锅', floor: 'f8', x: -8, z: -6, type: '火锅', baseQueue: 28 },
  { id: 's02', name: '凑凑火锅', floor: 'f8', x: 6, z: -6, type: '火锅', baseQueue: 18 },
  { id: 's03', name: '兰湘子', floor: 'f7', x: -10, z: 4, type: '湘菜', baseQueue: 15 },
  { id: 's04', name: '曼玉餐厅', floor: 'f7', x: 2, z: 5, type: '融合菜', baseQueue: 12 },
  { id: 's05', name: 'Oeat', floor: 'f7', x: 11, z: 2, type: '轻食', baseQueue: 6 },
  { id: 's06', name: '宴豫·饕客', floor: 'f8', x: 0, z: 8, type: '自助', baseQueue: 22 },
  { id: 's07', name: '小吃茶饮区', floor: 'f6', x: -6, z: -8, type: '小吃', baseQueue: 9 },
  { id: 's08', name: '咖啡甜点区', floor: 'f6', x: 8, z: -8, type: '饮品', baseQueue: 5 },
];

// 当前客流密度（0-100），由 HUD 滑杆驱动
export let flowLevel = 40;

export function setFlowLevel(v) {
  flowLevel = v;
}

// 根据客流密度折算某店铺的实时排队人数
export function queueOf(store) {
  const factor = 0.5 + (flowLevel / 100) * 1.2;
  return Math.round(store.baseQueue * factor);
}
