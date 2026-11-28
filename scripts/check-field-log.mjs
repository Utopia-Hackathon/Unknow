#!/usr/bin/env node
/**
 * E-05 CI · data job
 * 校验 data/field-collection-log.json —— 11-29 现场采集证据链（Issue #77 / B-05）。
 *
 * 三条真源联动校验（这是本脚本存在的主要理由，不是查格式）：
 *   1. id / floor / name 必须与 data/stores.json 同 id 记录一致；
 *   2. manifestFile 必须与 src/textureManifest.js 的 file 字段**逐字**一致；
 *   3. 有图必有拍摄时间（photoSha256 非空 ⇒ shotAt 非空）。
 * 格式校验：survival 枚举 / shotAt ISO 8601 带时区 / photoSha256 64 位小写 hex。
 *
 * 用法：
 *   node scripts/check-field-log.mjs                  # CI 用：结构 + 真源联动 + 已填字段格式
 *   node scripts/check-field-log.mjs --require-complete  # 回填完自检：8 条必须全填满
 *
 * 判据来源：docs/CONTRACTS.md、Issue #77 §2、src/textureManifest.js 注释。
 * 纯 Node 标准库，零依赖。文件不存在时 SKIP（骨架未建不算失败）。
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const FILE = 'data/field-collection-log.json';
const STORES = 'data/stores.json';
const MANIFEST = 'src/textureManifest.js';
const requireComplete = process.argv.includes('--require-complete');

if (!fs.existsSync(FILE)) {
  console.log(`[SKIP] ${FILE} 尚不存在（#77 骨架未建），data job 跳过`);
  process.exit(0);
}

let log;
try {
  log = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error(`[FAIL] ${FILE} 不是合法 JSON: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(log.records)) {
  console.error('[FAIL] records 不是数组');
  process.exit(1);
}

// ---- 真源 1：stores.json ----
if (!fs.existsSync(STORES)) {
  console.log(`[SKIP] ${STORES} 不存在，无法做真源联动校验`);
  process.exit(0);
}
const stores = JSON.parse(fs.readFileSync(STORES, 'utf8')).stores ?? [];
const storeById = new Map(stores.map((s) => [s.id, s]));

// ---- 真源 2：textureManifest.js（直接 import，真源改了自动跟随）----
let TEXTURES;
try {
  const mod = await import(pathToFileURL(MANIFEST).href);
  TEXTURES = mod.TEXTURES;
} catch (e) {
  console.error(`[FAIL] 无法加载真源 ${MANIFEST}: ${e.message}`);
  console.error('       门禁必须能读到真源才能校验 manifestFile，不能跳过。');
  process.exit(1);
}

const SURVIVAL = new Set(['confirmed', 'not-operating', 'unknown']);
const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SHA256 = /^[0-9a-f]{64}$/;

const problems = [];
const warns = [];
const seen = new Set();

// 需要现场自拍的 = **真源** textureManifest.js 里 file 以 field-1129/ 开头的（8 条，自动排除 s07 promo 图与 s10 null）。
// 不要从本文件的 manifestFile 反推分母：那是被测字段，改坏了分母会跟着缩水，
// 出现「分母变小所以进度看起来变好」的判据自证（2026-11-29 实例）。
const needShot = log.records.filter((r) => {
  const f = r.id ? TEXTURES?.[r.id]?.file : null;
  return typeof f === 'string' && f.startsWith('field-1129/');
});

log.records.forEach((r, i) => {
  const tag = `records[${i}]${r.id ? `(${r.id})` : ''}`;
  const s = storeById.get(r.id);

  if (!r.id) {
    problems.push(`${tag} 缺 id`);
  } else {
    if (seen.has(r.id)) problems.push(`${tag} 重复 id`);
    seen.add(r.id);
    if (!s) {
      problems.push(
        `${tag} id 不在 data/stores.json 中` +
          `——若现场替换点位，须同步改 stores.json 与 textureManifest.js，不能只改本文件`,
      );
    }
  }

  // 真源联动 1：floor / name 必须与 stores.json 一致
  if (s) {
    if (r.floor !== s.floor) problems.push(`${tag} floor=${r.floor}，stores.json 为 ${s.floor}`);
    if (r.name !== s.name) problems.push(`${tag} name="${r.name}"，stores.json 为 "${s.name}"`);
  }

  // 真源联动 2：manifestFile 必须与 textureManifest.js 逐字一致
  const tex = r.id ? TEXTURES[r.id] : undefined;
  if (r.id && !tex) {
    problems.push(`${tag} id 不在 textureManifest.js 中（贴图真源缺该 key）`);
  } else if (tex) {
    const expected = tex.file ?? null;
    if (r.manifestFile !== expected) {
      problems.push(
        `${tag} manifestFile=${JSON.stringify(r.manifestFile)}，` +
          `textureManifest.js 为 ${JSON.stringify(expected)}（必须逐字一致，含拼写差）`,
      );
    }
  }

  // 已填字段的格式校验（null = 未填，允许；填了就必须合规）
  if (r.shotAt !== null && r.shotAt !== undefined) {
    if (typeof r.shotAt !== 'string' || !ISO8601.test(r.shotAt)) {
      problems.push(`${tag} shotAt 格式非法: ${JSON.stringify(r.shotAt)}（要 ISO 8601 带时区，如 2026-11-29T14:32+08:00）`);
    }
  }
  if (r.photographer !== null && r.photographer !== undefined) {
    if (typeof r.photographer !== 'string' || !r.photographer.trim()) {
      problems.push(`${tag} photographer 填了但为空`);
    }
  }
  if (r.unitNo !== null && r.unitNo !== undefined) {
    if (typeof r.unitNo !== 'string' || !r.unitNo.trim()) problems.push(`${tag} unitNo 填了但为空（看不见应为 null）`);
  }
  if (r.survival !== null && r.survival !== undefined) {
    if (!SURVIVAL.has(r.survival)) {
      problems.push(`${tag} survival 非法: ${JSON.stringify(r.survival)}（仅 confirmed / not-operating / unknown）`);
    }
  }
  if (r.coordinateBasis !== null && r.coordinateBasis !== undefined) {
    if (typeof r.coordinateBasis !== 'string' || !r.coordinateBasis.trim()) {
      problems.push(`${tag} coordinateBasis 填了但为空（不编精确坐标就写 null）`);
    }
  }
  if (r.photoSha256 !== null && r.photoSha256 !== undefined) {
    if (typeof r.photoSha256 !== 'string' || !SHA256.test(r.photoSha256)) {
      problems.push(`${tag} photoSha256 格式非法（要 64 位小写 hex）: ${JSON.stringify(r.photoSha256)}`);
    }
  }

  // 真源联动 3：有图必有拍摄时间；不拍照的不得有 hash
  const hasHash = r.photoSha256 !== null && r.photoSha256 !== undefined;
  if (hasHash && (r.shotAt === null || r.shotAt === undefined)) {
    problems.push(`${tag} 填了 photoSha256 但 shotAt 为 null（有图必有拍摄时间，不许事后补）`);
  }
  if (r.manifestFile === null && hasHash) {
    problems.push(`${tag} manifestFile 为 null（不参与现场自拍）却有 photoSha256`);
  }
});

// id 顺序：只警告，不失败（现场重排不算错，漏/多已由上面的集合校验兜住）
const logIds = log.records.map((r) => r.id);
const storeIds = stores.map((s) => s.id);
if (logIds.length === storeIds.length && logIds.some((id, i) => id !== storeIds[i])) {
  warns.push('records 顺序与 stores.json 不同（若为现场调整则忽略；对账时按 id 查，不按行号）');
}

// ---- 进度统计 ----
const filled = (k) => log.records.filter((r) => r[k] !== null && r[k] !== undefined).length;
const shotFilled = needShot.filter((r) => r.photoSha256 !== null && r.photoSha256 !== undefined).length;
const total = log.records.length;
console.log(`校验 ${FILE}: ${total} 条记录，其中需现场自拍 ${needShot.length} 条`);
console.log(
  `  已填：shotAt ${filled('shotAt')}/${total}｜photographer ${filled('photographer')}/${total}｜` +
    `survival ${filled('survival')}/${total}｜photoSha256 ${shotFilled}/${needShot.length}`,
);

// ---- 完整性模式（回填完自检用，CI 不挂）----
if (requireComplete) {
  const REQUIRED_WHEN_SHOT = ['shotAt', 'photographer', 'survival', 'photoSha256'];
  for (const r of needShot) {
    for (const k of REQUIRED_WHEN_SHOT) {
      if (r[k] === null || r[k] === undefined) {
        problems.push(`(${r.id}) --require-complete：${k} 仍为 null`);
      }
    }
  }
  if (shotFilled !== needShot.length && shotFilled > 0) {
    problems.push(`--require-complete：photoSha256 只填了 ${shotFilled}/${needShot.length}`);
  }
}

if (problems.length) {
  console.error(`\n[FAIL] ${problems.length} 项违规：`);
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  if (problems.length > 40) console.error(`  …另有 ${problems.length - 40} 项`);
  process.exit(1);
}

for (const w of warns) console.warn('[WARN] ' + w);
console.log('[OK] field-collection-log.json 真源联动 / 枚举 / 时间格式 / hash 格式全部合规');
if (!requireComplete) {
  console.log('提醒：本 job 只查「已填的对不对」，不要求填满；回填完请跑 --require-complete 自检。');
}
