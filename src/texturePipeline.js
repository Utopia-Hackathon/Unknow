import * as THREE from 'three';
import { TEXTURES, isDryRun } from './textureManifest.js';

// 门脸贴图管线（C-01 / D008 / C-05）。
//
// 两条硬约束，写在这里免得后面忘：
//   1. **来源分级**：11-29 本队实拍 > promo 商家效果图 > Canvas 文字招牌。
//      媒体图（storefronts/、baidu/、netease/ 那批）只能作建模参考，不进交付贴图
//      —— 见 D013 §2 / PR #25 的真实性声明口径。
//   2. **贴图对象只有 10 个点位**，不做全馆；无图一律降级文字招牌，
//      验收不歧视无贴图店（D008 §3）。
//
// 映射表在 textureManifest.js（单一真源），本文件只读不写。
// 11-29 素材拷进仓库后，只改 manifest 的 file 字段即可生效。

const SIGN_W = 512;
const SIGN_H = 128;
const TEX_ASPECT = 4 / 3; // 门脸立面 4×3

const loader = new THREE.TextureLoader();
const cache = new Map();

// 魔数校验抽到 imageFormat.js，便于 Node 单测直接验「假 PNG」拦截。
import { verifyImage } from './imageFormat.js';

async function fetchChecked(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const check = verifyImage(new Uint8Array(buf), url);
  if (!check.ok) throw new Error(check.reason);
  return URL.createObjectURL(new Blob([buf], { type: check.mime }));
}

function loadTexture(blobUrl) {
  return new Promise((resolve, reject) => {
    loader.load(blobUrl, resolve, undefined, () => reject(new Error('解码失败')));
  });
}

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

  const grad = ctx.createLinearGradient(0, 0, SIGN_W, SIGN_H);
  grad.addColorStop(0, '#10161f');
  grad.addColorStop(1, tone);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIGN_W, SIGN_H);

  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, SIGN_W - 12, SIGN_H - 12);

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
    const visible = targetAspect / srcAspect;
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

export function storefrontUrl(storeId, { dryRun = false } = {}) {
  const entry = TEXTURES[storeId];
  if (!entry) return null;
  const rel = dryRun ? entry.dryRunFile : entry.file;
  if (!rel) return null;
  const base = import.meta.env.BASE_URL || '/';
  return `${base}assets/zhenghongcheng/${rel}`;
}

/**
 * 加载一家店的门脸贴图，返回结构化结果而不是裸 Texture。
 *
 * 调用方据此决定：
 *   loaded  → setVisual({ texture })
 *   failed  → setVisual({ pending: true }) 降级文字招牌
 *   skipped → 保持默认文字招牌（没有图，不是错误）
 *   dryrun  → 参考素材，界面必须带醒目角标
 *
 * 单张失败不影响其余 9 家，且 console.error 打可读原因，不静默吞。
 */
export function loadStorefront(storeId) {
  const dry = isDryRun();
  const url = storefrontUrl(storeId, { dryRun: dry });
  if (!url) {
    const entry = TEXTURES[storeId];
    return Promise.resolve({
      texture: null,
      status: 'skipped',
      reason: entry ? '该店无交付贴图，走文字招牌' : `id ${storeId} 不在贴图映射表`,
      dry,
    });
  }
  if (cache.has(url)) return cache.get(url);

  const p = (async () => {
    try {
      const blobUrl = await fetchChecked(url);
      const tex = await loadTexture(blobUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      cropToAspect(tex);
      return { texture: tex, status: dry ? 'dryrun' : 'loaded', url, dry, storeId };
    } catch (err) {
      console.error(`[textures] ${storeId} 门头贴图失败，降级文字招牌：${err.message}（${url}）`);
      return { texture: null, status: 'failed', reason: err.message, url, dry, storeId };
    }
  })();
  cache.set(url, p);
  return p;
}

// 「数据待补 / 参考素材」角标：贴在体块上方。
export function createPendingBadgeTexture(text = '数据待补') {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = text.includes('参考') ? 'rgba(30,64,175,.95)' : 'rgba(120,53,15,.92)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 312, 56, 10);
  ctx.fill();
  ctx.strokeStyle = text.includes('参考') ? 'rgba(147,197,253,.9)' : 'rgba(251,191,36,.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#fde68a';
  ctx.font = '600 24px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 160, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
