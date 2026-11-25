import * as THREE from 'three';
import { queueOf } from './mockData.js';

// 数据联动核心：客流密度 → 店铺热力颜色。
// 颜色从「冷蓝(低)」渐变到「热红(高)」，直接驱动 3D 场景中的店铺材质。
// 这是赛道 A「数据联动」的最小闭环：一条数据通道驱动场景变化（E23）。

const COLD = new THREE.Color(0x38bdf8);
const HOT = new THREE.Color(0xef4444);

function heatColor(ratio) {
  return COLD.clone().lerp(HOT, ratio);
}

export function updateStoreHeat(storeMeshes, stores) {
  for (const s of stores) {
    const entry = storeMeshes.get(s.id);
    if (!entry) continue;
    const q = queueOf(s);
    // 排队 30 人视为满负荷，映射到 0~1
    const ratio = Math.min(q / 30, 1);
    entry.mat.color.copy(heatColor(ratio));
  }
}
