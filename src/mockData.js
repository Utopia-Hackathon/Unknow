// 店铺点位数据：名称、楼层、平面坐标（米）、业态。
// 数据来源：公开地图/实地调研核查（docs/RESEARCH.md），未核实店铺须标「待核实」（F01 业务规则）。
// 一期范围仅 F01 导览（D004）；排队/客流等 F02/F03 数据不在此层。

export const FLOORS = [
  { id: 'f6', name: '6F 餐饮', y: 0 },
  { id: 'f7', name: '7F 正餐', y: 4 },
  { id: 'f8', name: '8F 火锅自助', y: 8 },
];

export const STORES = [
  { id: 's01', name: '巴奴毛肚火锅', floor: 'f8', x: -8, z: -6, type: '火锅' },
  { id: 's02', name: '凑凑火锅', floor: 'f8', x: 6, z: -6, type: '火锅' },
  { id: 's03', name: '兰湘子', floor: 'f7', x: -10, z: 4, type: '湘菜' },
  { id: 's04', name: '曼玉餐厅', floor: 'f7', x: 2, z: 5, type: '融合菜' },
  { id: 's05', name: 'Oeat', floor: 'f7', x: 11, z: 2, type: '轻食' },
  { id: 's06', name: '宴豫·饕客', floor: 'f8', x: 0, z: 8, type: '自助' },
  { id: 's07', name: '小吃茶饮区', floor: 'f6', x: -6, z: -8, type: '小吃' },
  { id: 's08', name: '咖啡甜点区', floor: 'f6', x: 8, z: -8, type: '饮品' },
];
