// 图片魔数校验（C-05 / Issue #43）。
// 独立成文件是为了能在 Node 单测里直接跑，不用加载 three / DOM。
//
// 为什么需要：TextureLoader 会把「后缀 .png 实为 WEBP」或「404 返回 HTML fallback」
// 静默解码成黑块。交付贴图必须先验真，再交给渲染层。

const MAGIC = [
  { fmt: 'png', mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { fmt: 'jpeg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    fmt: 'webp', mime: 'image/webp',
    test: (b) => String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF'
      && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP',
  },
];

export const EXT_FMT = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' };

/** 返回 { fmt, mime } 或 null */
export function detectFormat(bytes) {
  if (!bytes || bytes.length < 12) return null;
  return MAGIC.find((m) => m.test(bytes)) || null;
}

/**
 * 校验后缀与魔数是否一致。
 * @returns {{ok:true, mime:string} | {ok:false, reason:string}}
 */
export function verifyImage(bytes, urlOrExt) {
  const info = detectFormat(bytes);
  if (!info) return { ok: false, reason: '无法识别图片格式（可能拿到的是 HTML fallback）' };
  const ext = String(urlOrExt).split(/[?#]/)[0].split('.').pop().toLowerCase();
  const expected = EXT_FMT[ext];
  if (expected && expected !== info.fmt) {
    return { ok: false, reason: `魔数与后缀不符：后缀 .${ext}，实际是 ${info.fmt}` };
  }
  return { ok: true, mime: info.mime };
}
