#!/usr/bin/env node
/**
 * E-04 CI · assets job
 * 扫描 public/assets/：扩展名与魔数一致 / 单文件 ≤200MB / 总体积 ≤500MB / 文件名全 ASCII。
 * 判据来自 Issue #18 与竞赛规程，纯 Node 标准库，零依赖。
 *
 * 用法： node scripts/check-assets.mjs [root]   默认 root = public/assets
 * 退出码：0 = 全通过；1 = 有违规。
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_SINGLE = 200 * 1024 * 1024;
const MAX_TOTAL = 500 * 1024 * 1024;
const EXPECT = {
  '.png': ['PNG'],
  '.jpg': ['JPEG'],
  '.jpeg': ['JPEG'],
  '.webp': ['WEBP'],
  '.gif': ['GIF'],
  '.svg': ['SVG'],
  '.ico': ['ICO'],
};
const SKIP = new Set(['node_modules', '.git', 'dist', 'build']);

function sniff(fd) {
  const head = Buffer.alloc(16);
  const n = fs.readSync(fd, head, 0, 16, 0);
  const b = head.subarray(0, n);
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'PNG';
  if (b[0] === 0xff && b[1] === 0xd8) return 'JPEG';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'WEBP';
  if (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a') return 'GIF';
  if (b.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))) return 'ICO';
  const s = b.toString('utf8', 0, Math.min(n, 5));
  if (s.startsWith('<?xml') || s.startsWith('<svg ')) return 'SVG';
  if (b.toString('ascii', 0, 2) === 'BM') return 'BMP';
  return 'UNKNOWN';
}

const root = process.argv[2] || path.join('public', 'assets');
if (!fs.existsSync(root)) {
  console.error(`[FAIL] 目录不存在: ${root}`);
  process.exit(1);
}

const problems = [];
let checked = 0;
let totalBytes = 0;

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(p); continue; }
    if (!ent.isFile()) continue;
    const size = fs.statSync(p).size;
    totalBytes += size;
    if (!/^[\x20-\x7E]+$/.test(ent.name)) {
      problems.push(`文件名非 ASCII/含控制字符: ${p}`);
    }
    const ext = path.extname(ent.name).toLowerCase();
    if (!EXPECT[ext]) continue; // 非图片不管格式，但上面的体积/文件名规则仍适用
    checked++;
    if (size === 0) { problems.push(`空文件: ${p}`); continue; }
    if (size > MAX_SINGLE) { problems.push(`单文件 >200MB: ${p} (${(size / 1048576).toFixed(1)}MB)`); }
    let fd;
    try {
      fd = fs.openSync(p, 'r');
      const real = sniff(fd);
      if (!EXPECT[ext].includes(real)) {
        problems.push(`后缀与格式不符: ${p} 后缀 ${ext} 实际 ${real}`);
      }
    } catch (e) {
      problems.push(`读取失败: ${p} (${e.message})`);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
}
walk(root);

console.log(`扫描: ${root}`);
console.log(`图片文件: ${checked} 个 | 全部文件体积: ${(totalBytes / 1048576).toFixed(1)} MB`);
if (totalBytes > MAX_TOTAL) {
  problems.push(`总体积 >500MB: ${(totalBytes / 1048576).toFixed(1)}MB`);
}

if (problems.length) {
  console.error(`\n[FAIL] ${problems.length} 项违规：`);
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  if (problems.length > 40) console.error(`  ... 另有 ${problems.length - 40} 项`);
  console.error('\n修法：改后缀用 git mv 不重编码；或转码为后缀声明的格式。文件名改 ASCII。');
  process.exit(1);
}
console.log('[OK] 资产格式/体积/文件名全部合规');
