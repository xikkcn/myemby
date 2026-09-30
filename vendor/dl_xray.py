#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""断点续传下载 Xray-core（ghproxy 通道对大文件会截断，需要反复续传）"""
import os, sys, time, urllib.request, ssl

BASE = "https://ghproxy.net/https://github.com/XTLS/Xray-core/releases/download/v26.3.27"
TARGETS = {
    "Xray-windows-64.zip": 20913304,
    "Xray-linux-64.zip":   21136402,
}
DEST = r"C:\myemby\vendor\xray"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def download(fn, want):
    path = os.path.join(DEST, fn)
    url = f"{BASE}/{fn}"
    for attempt in range(1, 41):
        have = os.path.getsize(path) if os.path.exists(path) else 0
        if have >= want:
            print(f"  [OK] {fn} 完成 {have} 字节")
            return True
        headers = {"User-Agent": "Mozilla/5.0"}
        if have:
            headers["Range"] = f"bytes={have}-"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
                mode = "ab" if have and r.status == 206 else "wb"
                if mode == "wb":
                    have = 0
                got = 0
                with open(path, mode) as f:
                    while True:
                        chunk = r.read(262144)
                        if not chunk:
                            break
                        f.write(chunk)
                        got += len(chunk)
        except Exception as e:
            print(f"  第 {attempt} 次异常: {str(e)[:60]}")
            time.sleep(2)
            continue
        new = os.path.getsize(path)
        print(f"  第 {attempt} 次: {have} -> {new} / {want}")
        if new <= have:
            time.sleep(2)
    return os.path.getsize(path) >= want


print("下载 Xray-core（v26.3.27）")
ok = True
for fn, want in TARGETS.items():
    print(f"===== {fn}  目标 {want} 字节 =====")
    if not download(fn, want):
        ok = False
        print(f"  [FAIL] {fn} 未完成")

print()
for fn in TARGETS:
    p = os.path.join(DEST, fn)
    print(f"{fn}: {os.path.getsize(p) if os.path.exists(p) else 0} 字节")
sys.exit(0 if ok else 1)
