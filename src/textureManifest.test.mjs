import test from 'node:test';
import assert from 'node:assert/strict';
import { TEXTURES, TEXTURE_IDS } from './textureManifest.js';
import { verifyImage, detectFormat } from './imageFormat.js';

// Issue #43 验收：映射表与 v2.1 id 对齐 + 假 PNG 拦截。

test('TEXTURES 10 条与 v2.1 id 一一对应', () => {
  const keys = Object.keys(TEXTURES).sort();
  assert.deepEqual(keys, [...TEXTURE_IDS].sort());
  assert.equal(keys.length, 10);
});

test('每条 file 为 null 或安全相对路径', () => {
  for (const [id, entry] of Object.entries(TEXTURES)) {
    assert.ok(typeof entry.source === 'string' || entry.source === null, `${id} source 类型不对`);
    if (entry.file != null) {
      assert.ok(typeof entry.file === 'string' && entry.file.length > 0, `${id} file 为空串`);
      assert.ok(!entry.file.startsWith('/') && !entry.file.includes('..'), `${id} file 不是安全相对路径：${entry.file}`);
      // 交付贴图绝不指向 storefronts（第三方媒体图）
      assert.ok(!entry.file.startsWith('storefronts/'), `${id} 交付贴图指向媒体图，违反 D013`);
    }
  }
});

test('CGV 走文字招牌，麻布走 promo 效果图', () => {
  assert.equal(TEXTURES.s10.file, null, 'CGV 应走文字招牌降级');
  assert.equal(TEXTURES.s10.fallback, 'sign');
  assert.ok(TEXTURES.s07.file.startsWith('promo/'), '麻布应使用 promo 商家效果图');
});

test('dryRunFile 最多指向参考素材，不作为交付贴图', () => {
  for (const entry of Object.values(TEXTURES)) {
    if (entry.dryRunFile) {
      assert.ok(entry.dryRunFile.startsWith('storefronts/'), `参考素材应来自 storefronts/：${entry.dryRunFile}`);
      assert.notEqual(entry.dryRunFile, entry.file);
    }
  }
});

// —— 假 PNG 拦截 ——

function bytes(...values) { return new Uint8Array(values); }

test('魔数识别 PNG / JPEG / WEBP', () => {
  assert.equal(detectFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0))?.fmt, 'png');
  assert.equal(detectFormat(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0))?.fmt, 'jpeg');
  const webp = new Uint8Array(12);
  webp.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  webp.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  assert.equal(detectFormat(webp)?.fmt, 'webp');
});

test('假 PNG（实为 WEBP）被拦下并给出可读原因', () => {
  const fake = new Uint8Array(16);
  fake.set([0x52, 0x49, 0x46, 0x46], 0);
  fake.set([0x57, 0x45, 0x42, 0x50], 8);
  const result = verifyImage(fake, 's01-banu.png');
  assert.equal(result.ok, false);
  assert.match(result.reason, /魔数与后缀不符/);
});

test('HTML fallback 被拦下，不是静默黑块', () => {
  const html = new TextEncoder().encode('<!DOCTYPE html><html>...</html>');
  const result = verifyImage(html, 's01-banu.webp');
  assert.equal(result.ok, false);
  assert.match(result.reason, /无法识别/);
});

test('合法后缀通过校验', () => {
  const png = bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0);
  assert.equal(verifyImage(png, 's01.webp').ok, false, 'PNG 冒充 webp 应被拦');
  assert.equal(verifyImage(png, 's01.png').ok, true);
});
