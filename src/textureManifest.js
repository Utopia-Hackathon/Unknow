// 门头贴图映射的**单一真源**（Issue #43 / C-05）。
//
// 11-29 素材到货后，只改这个文件的 file 字段，场景自动从「文字招牌」切成真门头——
// 不改渲染代码、不重调坐标。key 用店铺 id，**不用店名**：店名改一次全表就废。
// id 与 data/stores.json、docs/STORES_CANDIDATES.md v2.1 一一对应。
//
// file 相对于 public/assets/zhenghongcheng/
// source 按真实性声明写清楚；媒体图/百度图一律不进交付贴图（D013 §2）。
// dryRunFile 只用于 ?textures=dryrun 管线自测，**默认模式绝不加载**。

export const TEXTURES = {
  s01: {
    file: 'field-1129/s01-banu.webp',
    source: '现场 2026-11-29',
    fallback: 'sign',
    dryRunFile: 'storefronts/dining/banu-hotpot-1.jpg',
  },
  s02: {
    file: 'field-1129/s02-taier.webp',
    source: '现场 2026-11-29',
    fallback: 'sign',
    dryRunFile: null, // 媒体图里也没有太二
  },
  s03: {
    file: 'field-1129/s03-manyu.webp',
    source: '现场 2026-11-29',
    fallback: 'sign',
    dryRunFile: 'storefronts/dining/manyu-1.jpg',
  },
  s04: {
    file: 'field-1129/s04-luxiaoge.webp',
    source: '现场 2026-11-29',
    fallback: 'sign',
    dryRunFile: 'storefronts/dining/luxiaoge-bbq-1.jpg',
  },
  s05: {
    file: 'field-1129/s05-panggeliang.webp',
    source: '现场 2026-11-29',
    fallback: 'sign',
    dryRunFile: null,
  },
  s06: {
    file: 'field-1129/s06-binsushi.webp',
    source: '现场 2026-11-29',
    fallback: 'sign',
    dryRunFile: null,
  },
  s07: {
    // 麻布已有商家效果图，D008 §2 允许；已在库，不需要等 11-29
    file: 'promo/azabu-izakaya-storefront.png',
    source: 'promo 商家效果图（D008 §2 允许）',
    fallback: 'sign',
    dryRunFile: null,
  },
  s08: {
    file: 'field-1129/s08-doulaofang.webp',
    source: '现场 2026-11-29',
    fallback: 'sign',
    dryRunFile: null,
  },
  s09: {
    file: 'field-1129/s09-benxiaoxi.webp',
    source: '现场 2026-11-29',
    fallback: 'sign',
    dryRunFile: null,
  },
  s10: {
    // CGV 无门头照，走文字招牌降级（D011 / D012）
    file: null,
    source: null,
    fallback: 'sign',
    dryRunFile: null,
  },
};

// v2.1 的 10 个 id，顺序固定。单测会断言这个表不多不少正好这些 key。
export const TEXTURE_IDS = ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10'];

export const DRYRUN_QUERY = 'textures=dryrun';

export function isDryRun() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('textures') === 'dryrun';
}
