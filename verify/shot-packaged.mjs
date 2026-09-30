#!/usr/bin/env node
/**
 * 端到端验证打包好的 myemby：启动真实 exe，用 CDP 截图，
 * 并检查代理页能否读到内置核心（resources/bin）。
 *
 * 用 Node 22 内置的 WebSocket，不依赖第三方库。
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXE = path.join(__dirname, '..', 'dist_electron', 'win-unpacked', 'myemby.exe');
const OUT = path.join(__dirname, 'shots');
const PORT = 9333;
fs.mkdirSync(OUT, { recursive: true });

const LOG = path.join(__dirname, 'packaged.log');
fs.writeFileSync(LOG, '');
const log = (...a) => fs.appendFileSync(LOG, a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sock = null;
let seq = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    sock.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('CDP 超时: ' + method));
      }
    }, 30000);
  });
}

async function main() {
  log('启动:', EXE);
  if (!fs.existsSync(EXE)) {
    log('FAILED: 找不到 exe');
    process.exit(1);
  }

  // 这台机器的环境里带着 ELECTRON_RUN_AS_NODE=1，会让 exe 退化成纯 Node。
  // 必须整个删掉，设成空串不管用。
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(EXE, ['--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`], {
    env,
    stdio: 'ignore',
  });
  child.on('error', (e) => log('spawn 错误:', e.message));

  let ver = null;
  for (let i = 0; i < 45; i++) {
    await sleep(1200);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { ver = await r.json(); break; }
    } catch { /* 等待中 */ }
  }
  if (!ver) { log('FAILED: 调试端口未就绪'); child.kill(); process.exit(1); }
  log('浏览器:', ver.Browser);

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) { log('FAILED: 没有页面目标'); child.kill(); process.exit(1); }

  sock = new WebSocket(page.webSocketDebuggerUrl);
  sock.addEventListener('message', (ev) => {
    try {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    } catch { /* 忽略 */ }
  });
  await new Promise((res, rej) => {
    sock.addEventListener('open', res, { once: true });
    sock.addEventListener('error', rej, { once: true });
    setTimeout(() => rej(new Error('WebSocket 连接超时')), 20000);
  });
  log('CDP 已连接');

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(6000);

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(r.data, 'base64');
    fs.writeFileSync(path.join(OUT, name + '.png'), buf);
    log('shot', name, buf.length + 'B');
  };

  await shot('packaged-home');

  // 切到网络加速页
  await send('Runtime.evaluate', { expression: `location.hash = '#/proxy'` });
  await sleep(5000);

  const info = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      title: document.title,
      hasProxy: (document.body.innerText||'').includes('网络加速'),
      coreXrayReady: (document.body.innerText||'').includes('Xray 就绪'),
      coreSbReady: (document.body.innerText||'').includes('sing-box 就绪'),
      bodyStart: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0, 300)
    })`,
    returnByValue: true,
  });
  log('页面信息:', info.result && info.result.value);

  await shot('packaged-proxy');

  try { sock.close(); } catch { /* 忽略 */ }
  child.kill();
  await sleep(1500);
  log('完成');
  process.exit(0);
}

main().catch((e) => {
  log('异常:', e.message);
  try { sock && sock.close(); } catch { /* 忽略 */ }
  process.exit(1);
});
