#!/usr/bin/env node
/**
 * E-04 CI · data job
 * 校验 data/stores.json：必填字段 / floor 范围 / 重复 id / source 非空 / verified 三级 / entrance。
 * 判据来自 docs/CONTRACTS.md §二，纯 Node 标准库。
 *
 * 文件不存在时跳过（B-01 尚未交付，不算失败）。文件存在但格式错误 → exit 1。
 */
import fs from 'node:fs';

const file = 'data/stores.json';
if (!fs.existsSync(file)) {
  console.log(`[SKIP] ${file} 尚不存在（B-01 未交付），data job 跳过`);
  process.exit(0);
}

let d;
try {
  d = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`[FAIL] ${file} 不是合法 JSON: ${e.message}`);
  process.exit(1);
}

const problems = [];
if (!Array.isArray(d.stores)) {
  console.error('[FAIL] stores 不是数组');
  process.exit(1);
}

const REQUIRED = ['id', 'name', 'floor', 'category', 'x', 'z', 'entrance', 'verified', 'source'];
const FLOORS = new Set(['f6', 'f7', 'f8']);
const VERIFIED = new Set(['observed', 'public', 'unverified']);
const seen = new Set();

d.stores.forEach((s, i) => {
  const tag = `stores[${i}]${s.id ? `(${s.id})` : ''}`;
  for (const k of REQUIRED) {
    if (s[k] === undefined || s[k] === null || s[k] === '') problems.push(`${tag} 缺字段 ${k}`);
  }
  if (s.id !== undefined) {
    if (seen.has(s.id)) problems.push(`${tag} 重复 id`);
    seen.add(s.id);
  }
  if (s.floor !== undefined && !FLOORS.has(s.floor)) problems.push(`${tag} floor 非法: ${s.floor}（仅 f6/f7/f8）`);
  if (s.verified !== undefined && !VERIFIED.has(s.verified)) problems.push(`${tag} verified 非法: ${s.verified}`);
  if (s.source !== undefined && typeof s.source === 'string' && !s.source.trim()) problems.push(`${tag} source 为空`);
  if (s.entrance !== undefined) {
    if (typeof s.entrance.x !== 'number' || typeof s.entrance.z !== 'number') {
      problems.push(`${tag} entrance 缺 x/z 数值`);
    }
  }
});

console.log(`校验 ${file}: ${d.stores.length} 个点位`);
if (problems.length) {
  console.error(`\n[FAIL] ${problems.length} 项违规：`);
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  process.exit(1);
}
console.log('[OK] stores.json 字段/楼层/id/source 全部合规');
console.log('提醒：CI 只查结构，不查店名真实性；A03/A10 仍须人工验收。');
