#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资产后缀与真实格式一致性校验（E-01 防复发，E-04 CI 可直接调用）。

只读魔数（magic bytes），不依赖 PIL / ImageMagick，任何机器上零安装即可跑。

用法：
    python scripts/check_asset_formats.py                # 默认扫 public/assets
    python scripts/check_asset_formats.py public/        # 指定根目录
    python scripts/check_asset_formats.py --quiet        # 只输出结论

退出码：0 = 全部一致；1 = 存在后缀与格式不符或空文件。
"""

import os
import sys

# 后缀 -> 允许的真实格式集合
EXPECT = {
    ".png": {"PNG"},
    ".jpg": {"JPEG"},
    ".jpeg": {"JPEG"},
    ".webp": {"WEBP"},
    ".gif": {"GIF"},
    ".svg": {"SVG"},
}

SKIP_DIRS = {"node_modules", ".git", "dist", "build"}


def sniff(head: bytes) -> str:
    """按文件头判定真实格式。head 至少 16 字节。"""
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "PNG"
    if head[:2] == b"\xff\xd8":
        return "JPEG"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "WEBP"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "GIF"
    if head[:4] == b"\x00\x00\x01\x00":
        return "ICO"
    if head[:5] in (b"<?xml", b"<svg "):
        return "SVG"
    if head[:4] == b"BM":
        return "BMP"
    return "UNKNOWN"


def scan(root: str):
    mismatched, empty, checked = [], [], 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            ext = os.path.splitext(name)[1].lower()
            if ext not in EXPECT:
                continue
            path = os.path.join(dirpath, name)
            size = os.path.getsize(path)
            checked += 1
            if size == 0:
                empty.append(path)
                continue
            with open(path, "rb") as fh:
                head = fh.read(16)
            real = sniff(head)
            if real not in EXPECT[ext]:
                mismatched.append((path, ext, real, size))
    return checked, mismatched, empty


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("-")]
    quiet = "--quiet" in argv
    root = args[0] if args else os.path.join("public", "assets")

    if not os.path.isdir(root):
        print("[FAIL] 目录不存在: %s" % root)
        return 1

    checked, mismatched, empty = scan(root)
    print("扫描目录: %s" % root)
    print("已校验图片文件: %d 个" % checked)

    if not mismatched and not empty:
        print("[OK] 后缀与真实格式全部一致，无空文件")
        return 0

    if mismatched:
        print("\n[FAIL] 后缀与真实格式不符: %d 个" % len(mismatched))
        for path, ext, real, size in mismatched:
            print("  %-60s 后缀 %-5s 实际 %-7s %dKB" % (path, ext, real, size // 1024))
        if not quiet:
            print("\n  修法：改后缀为实际格式（git mv，不重新编码），或转码为后缀声明的格式。")
    if empty:
        print("\n[FAIL] 空文件: %d 个" % len(empty))
        for path in empty:
            print("  %s" % path)

    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
