import * as THREE from 'three';

// 门脸贴图管线（C-01 / D008）。
//
// 两条硬约束，写在这里免得后面忘：
//   1. **来源分级**：11-29 本队实拍 > Canvas 文字招牌 > 网络参考图。
//      网络图（storefronts/、baidu/、netease/ 那批）只能作建模参考，不进交付贴图
//      —— 见 PR #25 的《真实性声明》第三条口径。
//   2. **贴图对象只有 10 个点位**，不做全馆；无图一律降级文字招牌，
//      验收不歧视无贴图店（D008 §3）。
//
// 目前 TEXTURES 是空的：11-29 采集前没有任何一张可作交付贴图的实拍图。
// 补拍回来后只填这张表，其余代码不用动。

// storeId -> { file, source, credit }
// file 相对于 public/assets/zhenghongcheng/；source 写「现场 2026-11-29」或 E 编号。
// 空表 = 全部走文字招牌降级，这是当前唯一合规状态。
export const TEXTURES = {
  // 示例（11-29 补拍后按此格式填）：
  // s01: { file: 'storefronts/self/banu-20261129.webp', source: '现场 2026-11-29' },
};

const SIGN_W = 512;
const SIGN_H = 128;
const TEX_ASPECT = 4 / 3; // 门脸立面 4×3

const loader = new THREE.TextureLoader();
const cache = new Map();

// 业态配色。招牌不能十个一个色，但也不能彩虹——按业态归三档冷暖即可。
const CATEGORY_TONE = {
  火锅: '#c2410c',
  火锅自助: '#c2410c',
  潮汕牛肉火锅: '#b45309',
  酸菜鱼: '#0369a1',
  日料: '#0f766e',
  回转寿司: '#0e7490',
  烤肉: '#a16207',
  融合菜: '#7c3aed',
  肉蟹煲: '#b91c1c',
  影院: '#1d4ed8',
};

function toneFor(category) {
  return CATEGORY_TONE[category] || '#334155';
}

// Canvas 文字招牌：真名 + 业态 + 楼层。没有贴图时这就是门头。
export function createSignTexture(store) {
  const canvas = document.createElement('canvas');
  canvas.width = SIGN_W;
  canvas.height = SIGN_H;
  const ctx = canvas.getContext('2d');
  const tone = toneFor(store.category);

  // 底：深色 + 品牌色暗渐变，像灯箱而不是纯色块
  const grad = ctx.createLinearGradient(0, 0, SIGN_W, SIGN_H);
  grad.addColorStop(0, '#10161f');
  grad.addColorStop(1, tone);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIGN_W, SIGN_H);

  // 细描边：模拟灯箱边框
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, SIGN_W - 12, SIGN_H - 12);

  // 店名：字多就缩字号，不换行、不截断
  const name = store.name || '未命名';
  let size = 54;
  ctx.font = `700 ${size}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
  while (ctx.measureText(name).width > SIGN_W - 60 && size > 22) {
    size -= 3;
    ctx.font = `700 ${size}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 8;
  ctx.fillText(name, SIGN_W / 2, SIGN_H / 2 - 6);
  ctx.shadowBlur = 0;

  // 副行：业态 · 楼层（楼层由调用方传，缺省不写）
  if (store.category || store._floorLabel) {
    const sub = [store.category, store._floorLabel].filter(Boolean).join(' · ');
    ctx.font = '400 22px "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.fillText(sub, SIGN_W / 2, SIGN_H - 26);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 保高裁两侧：源图多为 3:2 / 16:9，门脸立面是 4:3。
// 直接贴会把人拉胖，所以按高度对齐、裁掉左右，而不是缩放到目标尺寸。
export function cropToAspect(tex, targetAspect = TEX_ASPECT) {
  const img = tex.image;
  if (!img || !img.width || !img.height) return tex;
  const srcAspect = img.width / img.height;
  if (srcAspect > targetAspect + 0.001) {
    const visible = targetAspect / srcAspect; // 保留中间这么宽
    tex.repeat.set(visible, 1);
    tex.offset.set((1 - visible) / 2, 0);
  } else if (srcAspect < targetAspect - 0.001) {
    const visible = srcAspect / targetAspect;
    tex.repeat.set(1, visible);
    tex.offset.set(0, (1 - visible) / 2);
  }
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function storefrontUrl(storeId) {
  const entry = TEXTURES[storeId];
  if (!entry || !entry.file) return null;
  const base = import.meta.env.BASE_URL || '/';
  return `${base}assets/zhenghongcheng/${entry.file}`;
}

// 加载失败一律返回 null，由调用方降级——不允许因为一张图 404 让整个场景黑掉。
export function loadStorefront(storeId) {
  const url = storefrontUrl(storeId);
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return cache.get(url);

  const p = new Promise((resolve) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        cropToAspect(tex);
        resolve(tex);
      },
      undefined,
      () => {
        console.warn(`[texturePipeline] 贴图加载失败，降级文字招牌：${url}`);
        resolve(null);
      }
    );
  });
  cache.set(url, p);
  return p;
}

// 「数据待补」角标：贴在体块上方，告诉评委这个点位位置是示意值。
export function createPendingBadgeTexture(text = '数据待补') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(120,53,15,.92)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 56, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(251,191,36,.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#fde68a';
  ctx.font = '600 26px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
