#!/usr/bin/env node
/**
 * 核心链路验证：
 *   本机 SOCKS 入站 → xray → 上游代理 → 外网
 *
 * 目的是证明「配置生成 → 核心进程启动 → 本地端口就绪 → 流量真的被代理」这条链路是通的。
 * 这里借用本机已有的 HTTP 代理（127.0.0.1:12055）当上游，避免依赖真实机场节点。
 */
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import net from 'net';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, 'bin', 'xray.exe');
const WORK = path.join(os.tmpdir(), 'myemby-core-test');
fs.mkdirSync(WORK, { recursive: true });

const SOCKS_PORT = 21808;
const UPSTREAM = { host: '127.0.0.1', port: 12055 };

const config = {
  log: { loglevel: 'info' },
  inbounds: [
    {
      tag: 'socks-in',
      listen: '127.0.0.1',
      port: SOCKS_PORT,
      protocol: 'socks',
      settings: { auth: 'noauth', udp: true },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] },
    },
  ],
  outbounds: [
    {
      tag: 'proxy',
      protocol: 'http',
      settings: { servers: [{ address: UPSTREAM.host, port: UPSTREAM.port }] },
    },
    { tag: 'direct', protocol: 'freedom' },
    { tag: 'block', protocol: 'blackhole' },
  ],
  routing: {
    domainStrategy: 'AsIs',
    rules: [
      { type: 'field', ip: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'], outboundTag: 'direct' },
    ],
  },
};

const cfgPath = path.join(WORK, 'xray.json');
fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

function waitPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const s = net.connect({ host: '127.0.0.1', port });
      s.setTimeout(800);
      s.once('connect', () => {
        s.destroy();
        resolve(true);
      });
      const retry = () => {
        s.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(tick, 200);
      };
      s.once('error', retry);
      s.once('timeout', retry);
    };
    tick();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('xray 路径:', BIN);
  if (!fs.existsSync(BIN)) {
    console.log('✗ 找不到 xray.exe');
    process.exit(1);
  }

  console.log('\n[1] 启动核心...');
  const proc = spawn(BIN, ['run', '-c', cfgPath], { cwd: path.dirname(BIN), windowsHide: true });
  proc.stdout.on('data', (d) => process.stdout.write('  xray› ' + d));
  proc.stderr.on('data', (d) => process.stdout.write('  xray! ' + d));

  console.log('[2] 等待 SOCKS 端口', SOCKS_PORT, '就绪...');
  const ok = await waitPort(SOCKS_PORT, 12000);
  console.log(ok ? '  ✓ 端口已就绪' : '  ✗ 端口未就绪');
  if (!ok) {
    proc.kill();
    process.exit(1);
  }

  console.log('[3] 通过该 SOCKS 代理发起真实请求...');
  let passed = 0;
  // 注意：这台机器上 curl -o /dev/null 会报 “client returned ERROR on write”，
  // 换成真实临时文件即可。
  const outFile = path.join(WORK, 'out.bin');
  for (const url of ['http://www.gstatic.com/generate_204', 'https://www.baidu.com']) {
    try {
      const out = execFileSync('curl', [
        '--noproxy', '*',
        '--socks5-hostname', `127.0.0.1:${SOCKS_PORT}`,
        '-sS', '-m', '25', '-o', outFile, '-w', '%{http_code}',
        url,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      console.log(`  ✓ ${url} → HTTP ${out}`);
      if (/^[23]/.test(out)) passed++;
    } catch (e) {
      const detail = (e.stderr ? String(e.stderr) : '') || e.message;
      console.log(`  ✗ ${url} → ${detail.trim().slice(0, 110)}`);
    }
  }

  console.log('[4] 关闭核心...');
  proc.kill();
  await sleep(600);

  console.log(`\n结论：${passed > 0 ? '链路验证通过 ✓' : '链路验证失败 ✗'}（${passed}/2 个请求成功）`);
  process.exit(passed > 0 ? 0 : 1);
})();
