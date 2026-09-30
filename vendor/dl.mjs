#!/usr/bin/env node
/**
 * 代理核心二进制下载器
 *
 * 这台机器到 GitHub 的直连极不稳定，官方 API 时通时断；
 * ghproxy 通道可用，但大文件会在中途截断。
 * 因此策略是：用 ghproxy 探测文件总长，然后断点续传反复补齐，直到字节数达标。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEST = path.join(__dirname, 'bin');
fs.mkdirSync(DEST, { recursive: true });

const XRAY_TAG = 'v26.3.27';
const SB_TAG = 'v1.14.2';

/** file 是最终落地名；asset 是 release 里的压缩包名 */
const TARGETS = [
  { file: 'xray.exe', repo: 'XTLS/Xray-core', tag: XRAY_TAG, asset: 'Xray-windows-64.zip', inner: 'xray.exe', size: 20913304 },
  { file: 'xray', repo: 'XTLS/Xray-core', tag: XRAY_TAG, asset: 'Xray-linux-64.zip', inner: 'xray', size: 21136402 },
  { file: 'xray-android-arm64', repo: 'XTLS/Xray-core', tag: XRAY_TAG, asset: 'Xray-android-arm64-v8a.zip', inner: 'xray', size: 0 },
  { file: 'sing-box.exe', repo: 'SagerNet/sing-box', tag: SB_TAG, asset: 'sing-box-1.14.2-windows-amd64.zip', inner: 'sing-box.exe', size: 0 },
  { file: 'sing-box', repo: 'SagerNet/sing-box', tag: SB_TAG, asset: 'sing-box-1.14.2-linux-amd64.tar.gz', inner: 'sing-box', size: 0 },
  { file: 'sing-box-android-arm64', repo: 'SagerNet/sing-box', tag: SB_TAG, asset: 'sing-box-1.14.2-android-arm64.tar.gz', inner: 'sing-box', size: 0 },
  { file: 'sing-box-android-arm', repo: 'SagerNet/sing-box', tag: SB_TAG, asset: 'sing-box-1.14.2-android-arm.tar.gz', inner: 'sing-box', size: 0 },
];

const UA = 'Mozilla/5.0 (myemby-build)';

/** CI（GitHub Actions）上直连最快；本地则要优先走加速通道 */
const PREFER_DIRECT = process.env.MYEMBY_DL_PREFER_DIRECT === '1';

function urlsFor(t) {
  const gh = `https://github.com/${t.repo}/releases/download/${t.tag}/${t.asset}`;
  // 实测这几个通道速度差距极大，gh-proxy.com 明显最快，放第一位
  const p1 = `https://gh-proxy.com/${gh}`;
  const p2 = `https://ghproxy.net/${gh}`;
  const p3 = `https://ghfast.top/${gh}`;
  return PREFER_DIRECT ? [gh, p1, p2, p3] : [p1, p2, p3, gh];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 用 Range 请求探测文件总长度 */
async function probeSize(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const cr = r.headers.get('content-range');
  if (cr && cr.includes('/')) {
    const total = parseInt(cr.split('/')[1], 10);
    if (total > 0) return total;
  }
  const cl = r.headers.get('content-length');
  return cl ? parseInt(cl, 10) : 0;
}

async function pullChunk(url, tmp, want) {
  const have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
  if (have >= want) return have;

  const headers = { 'User-Agent': UA };
  if (have > 0) headers.Range = `bytes=${have}-`;

  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);

  const append = have > 0 && res.status === 206;
  const fd = fs.openSync(tmp, append ? 'a' : 'w');
  let written = append ? have : 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      fs.writeSync(fd, Buffer.from(value));
      written += value.length;
    }
  } finally {
    fs.closeSync(fd);
  }
  return written;
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    } else if (e.name === name) return p;
  }
  return null;
}

function extract(tmp, t, finalPath) {
  const work = path.join(DEST, '_x_' + t.file);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  if (t.asset.endsWith('.zip')) {
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${tmp}' -DestinationPath '${work}' -Force`], { stdio: 'ignore' });
  } else {
    execSync(`tar -xzf "${tmp}" -C "${work}"`, { stdio: 'ignore' });
  }
  const found = findFile(work, t.inner);
  if (!found) throw new Error('压缩包内找不到 ' + t.inner);
  fs.copyFileSync(found, finalPath);
  fs.rmSync(work, { recursive: true, force: true });
}

async function handle(t) {
  const finalPath = path.join(DEST, t.file);
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 0) {
    console.log(`  [跳过] ${t.file}`);
    return true;
  }
  const tmp = path.join(DEST, t.asset);
  const urls = urlsFor(t);

  // 1) 探测大小
  let want = t.size;
  for (let i = 0; i < 8 && !want; i++) {
    try {
      want = await probeSize(urls[i % urls.length]);
    } catch {
      await sleep(2000);
    }
  }
  if (!want) {
    console.log(`  [失败] ${t.file}: 无法探测文件大小`);
    return false;
  }

  // 2) 断点续传补齐
  for (let round = 1; round <= 60; round++) {
    const have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
    if (have >= want) break;
    const url = urls[(round - 1) % urls.length];
    const tag = url.includes('ghproxy') ? 'ghproxy' : url.includes('gh-proxy') ? 'gh-proxy' : '直连';
    try {
      const n = await pullChunk(url, tmp, want);
      console.log(`  ${t.file} [${tag}] ${n}/${want}`);
    } catch (e) {
      console.log(`  ${t.file} [${tag}] 失败 ${e.message}`);
      await sleep(2500);
    }
  }

  const got = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
  if (got < want) {
    console.log(`  [未完成] ${t.file}: ${got}/${want}`);
    return false;
  }

  // 3) 解压
  try {
    extract(tmp, t, finalPath);
    fs.rmSync(tmp, { force: true });
    console.log(`  [完成] ${t.file} ← ${t.asset}`);
    return true;
  } catch (e) {
    console.log(`  [解压失败] ${t.file}: ${e.message}`);
    return false;
  }
}

(async () => {
  const only = process.argv[2];
  // 精确匹配：`sing-box` 只选 sing-box 本身和它的变体，不会误选 sing-box.exe
  const list = only ? TARGETS.filter((t) => t.file === only || t.file.startsWith(only + '-')) : TARGETS;
  console.log(`代理核心下载（${list.length} 个，并发）→ ${DEST}\n`);
  // 并发拉取：单个通道按连接限速，多开几个反而更快
  const out = await Promise.all(list.map(async (t) => [t.file, await handle(t)]));
  console.log('\n===== 结果 =====');
  for (const [f, ok] of out) console.log(`${ok ? '✓' : '✗'} ${f}`);
})();
