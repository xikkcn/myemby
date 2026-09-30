#!/bin/bash
# 断点续传下载 Xray-core，直到文件大小达标
declare -A EXPECT=( ["Xray-windows-64.zip"]=20913304 ["Xray-linux-64.zip"]=21136402 )
BASE="https://ghproxy.net/https://github.com/XTLS/Xray-core/releases/download/v26.3.27"
cd /c/myemby/vendor/xray

for fn in Xray-windows-64.zip Xray-linux-64.zip; do
  want=${EXPECT[$fn]}
  echo "===== $fn  目标 $want 字节 ====="
  for attempt in $(seq 1 25); do
    have=$(stat -c%s "$fn" 2>/dev/null || echo 0)
    if [ "$have" -ge "$want" ]; then echo "  完成：$have 字节"; break; fi
    printf "  第 %2d 次  已有 %10d / %10d  " "$attempt" "$have" "$want"
    curl -sSL -m 300 -C - -o "$fn" "$BASE/$fn" >/dev/null 2>&1
    new=$(stat -c%s "$fn" 2>/dev/null || echo 0)
    echo "-> $new"
    if [ "$new" -le "$have" ]; then sleep 3; fi
  done
done
