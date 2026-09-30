#!/usr/bin/env node
/**
 * 把 vendor/bin 里下载好的代理核心，摆到各端构建真正需要的目录：
 *  - 安卓：jniLibs/<abi>/lib<name>.so（放这里安装后才带可执行权限，能直接 exec）
 *  - 桌面：electron-builder 直接从 vendor/bin 取（见 package.json 的 extraResources）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'bin');
const ROOT = path.join(__dirname, '..');
const JNI = path.join(ROOT, 'android', 'app', 'src', 'main', 'jniLibs');

/** 安卓端只用 sing-box：它一套就能覆盖 vmess/vless/ss/trojan/hysteria2/tuic，
 *  而 Xray 官方不提供 32 位安卓二进制，老电视盒子会装不上 */
const ANDROID_MAP = [
  { abi: 'arm64-v8a', src: 'sing-box-android-arm64', dst: 'libsingbox.so' },
  { abi: 'armeabi-v7a', src: 'sing-box-android-arm', dst: 'libsingbox.so' },
  { abi: 'x86_64', src: 'sing-box', dst: 'libsingbox.so' }, // 模拟器用桌面 Linux 版不可行，默认跳过
];

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  fs.chmodSync(to, 0o755);
  return true;
}

console.log('准备安卓核心 → jniLibs\n');
let placed = 0;
for (const m of ANDROID_MAP) {
  if (m.abi === 'x86_64') continue; // 模拟器不打包，减小体积
  const from = path.join(SRC, m.src);
  const to = path.join(JNI, m.abi, m.dst);
  if (copyIfExists(from, to)) {
    const kb = Math.round(fs.statSync(to).size / 1024);
    console.log(`  ✓ ${m.abi}/${m.dst}  (${kb} KB)  ← ${m.src}`);
    placed++;
  } else {
    console.log(`  ✗ ${m.abi}  缺少 ${m.src}`);
  }
}

console.log('\n桌面端核心（electron-builder 会自行打包）：');
for (const f of ['xray.exe', 'sing-box.exe', 'xray', 'sing-box']) {
  const p = path.join(SRC, f);
  if (fs.existsSync(p)) {
    console.log(`  ✓ ${f}  (${Math.round(fs.statSync(p).size / 1048576)} MB)`);
  } else {
    console.log(`  ✗ ${f}  未下载`);
  }
}

console.log(`\n安卓核心放入 ${placed} 个 ABI`);
if (placed === 0) {
  console.log('提示：安卓核心还没下载好，先跑 `node vendor/dl.mjs`。');
}
