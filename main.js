const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { ProxyManager } = require('./main/proxyManager');

/**
 * myemby（我的EMBY）Electron 主进程
 * - 生产环境从 dist/renderer/index.html 加载
 * - 允许连接自建 Emby 服务器（忽略自签证书、放开跨域）
 * - 内置网络加速：用 Xray / sing-box 作为独立进程，只接管本应用的流量
 */

const APP_NAME = 'myemby';
const PROD_UI = path.join(__dirname, 'dist', 'renderer', 'index.html');

/** 内网与本地地址直连，避免把用户的 Emby 服务器也绕进代理 */
const BYPASS_RULES = [
    '<local>',
    'localhost',
    '127.0.0.1',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '169.254.0.0/16',
].join(';');

let proxyManager = null;

/** 让 myemby 自身的请求走（或不再走）本地代理 */
function applyProxyToSession(enabled, port) {
    const ses = session.defaultSession;
    if (!ses) return;
    try {
        if (enabled) {
            ses.setProxy({
                proxyRules: `socks5://127.0.0.1:${port}`,
                proxyBypassRules: BYPASS_RULES,
            });
            console.log('[myemby] 已启用应用内代理，端口', port);
        } else {
            ses.setProxy({ mode: 'direct' });
            console.log('[myemby] 已关闭应用内代理');
        }
    } catch (e) {
        console.error('[myemby] 设置代理失败:', e);
    }
}

function broadcast(channel, payload) {
    for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(channel, payload);
    }
}

/** TCP 连接测速：到节点服务器的往返时间 */
function tcpPing(host, port, timeout = 5000) {
    return new Promise((resolve) => {
        const started = Date.now();
        const sock = net.connect({ host, port });
        let settled = false;
        const finish = (delay, error) => {
            if (settled) return;
            settled = true;
            sock.destroy();
            resolve({ delay, error });
        };
        sock.setTimeout(timeout);
        sock.once('connect', () => finish(Date.now() - started));
        sock.once('timeout', () => finish(-1, '超时'));
        sock.once('error', (e) => finish(-1, e.code || e.message));
    });
}

/** 注册代理相关的 IPC 接口 */
function setupProxyIpc() {
    proxyManager = new ProxyManager({
        onLog: (line) => broadcast('proxy:log', line),
        onExit: () => {
            applyProxyToSession(false);
            broadcast('proxy:status-changed', null);
        },
    });

    ipcMain.handle('proxy:start', async (_e, payload) => {
        const { core, config, localPort } = payload || {};
        try {
            const res = await proxyManager.start(core, config, localPort);
            applyProxyToSession(true, res.port);
            return { ok: true, ...res };
        } catch (e) {
            applyProxyToSession(false);
            return { ok: false, error: String((e && e.message) || e) };
        }
    });

    ipcMain.handle('proxy:stop', async () => {
        await proxyManager.stop();
        applyProxyToSession(false);
        return { ok: true };
    });

    ipcMain.handle('proxy:status', () => proxyManager.status());

    ipcMain.handle('proxy:logs', () => proxyManager.getLogs());

    ipcMain.handle('proxy:clear-logs', () => {
        proxyManager.clearLogs();
        return { ok: true };
    });

    /** 批量测速：并发有限，避免把网络打满 */
    ipcMain.handle('proxy:ping', async (_e, targets) => {
        const list = Array.isArray(targets) ? targets : [];
        const results = [];
        const CONCURRENCY = 6;
        let cursor = 0;
        const worker = async () => {
            while (cursor < list.length) {
                const item = list[cursor++];
                const r = await tcpPing(item.server, item.port, 5000);
                results.push({ nodeId: item.nodeId, delay: r.delay, error: r.error });
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
        return results;
    });

    /** 环境自检：核心文件是否就位 */
    ipcMain.handle('proxy:check-cores', () => {
        const out = {};
        for (const core of ['xray', 'singbox']) {
            try {
                out[core] = { available: true, path: proxyManager.resolveBinary(core) };
            } catch (e) {
                out[core] = { available: false, error: String((e && e.message) || e) };
            }
        }
        return out;
    });
}

function createWindow() {
    // 自建 Emby 常用自签名证书，这里放开校验
    app.commandLine.appendSwitch('ignore-certificate-errors');

    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 840,
        minWidth: 960,
        minHeight: 600,
        title: APP_NAME,
        backgroundColor: '#ffffff',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false, // 允许跨域请求 Emby 服务器
            preload: path.join(__dirname, 'preload.js')
        }
    });
    mainWindow.setMenuBarVisibility(false);

    // 宽松的 CSP，避免加载 Emby 图片/视频时被拦
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': ["default-src * 'self' 'unsafe-inline' 'unsafe-eval' data: blob:"]
            }
        });
    });

    if (process.env.NODE_ENV === 'development') {
        const port = process.env.VITE_PORT || 5173;
        mainWindow.loadURL(`http://localhost:${port}`);
        mainWindow.webContents.openDevTools();
        return;
    }

    // 依次尝试候选入口文件（打包 / 未打包都适用）
    const candidates = [
        PROD_UI,
        path.join(__dirname, 'dist', 'index.html'),
        path.join(process.resourcesPath || '', 'app.asar', 'dist', 'renderer', 'index.html'),
        path.join(process.resourcesPath || '', 'app', 'dist', 'renderer', 'index.html')
    ];
    const indexPath = candidates.find((p) => p && fs.existsSync(p)) || PROD_UI;
    console.log('[myemby] 入口文件:', indexPath);
    mainWindow.loadFile(indexPath).catch((err) => {
        console.error('[myemby] 加载失败:', err);
        showErrorPage(mainWindow, -1, String((err && err.message) || err));
    });

    mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
        if (code === -3) return; // 用户主动取消
        console.error('[myemby] 页面加载失败:', code, desc);
        showErrorPage(mainWindow, code, desc);
    });
}

function showErrorPage(win, code, desc) {
    const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>myemby 加载失败</title>
<style>
  body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; background: #f5f7fa;
         color: rgba(0,0,0,0.85); text-align: center; padding-top: 90px; margin: 0; }
  .box { max-width: 520px; margin: 0 auto; padding: 24px; background: #fff;
         border: 1px solid #ebeef5; border-radius: 10px; }
  h3 { color: #f5222d; margin-top: 0; }
  button { background: #1890ff; border: none; color: #fff; padding: 10px 22px;
           border-radius: 6px; margin-top: 18px; cursor: pointer; font-size: 14px; }
  .dbg { margin-top: 18px; font-size: 12px; color: rgba(0,0,0,0.45); text-align: left;
         background: #f5f7fa; border: 1px solid #ebeef5; padding: 10px; border-radius: 6px;
         word-break: break-all; }
</style></head><body>
  <div class="box">
    <h3>界面加载失败</h3>
    <p>程序文件没有找到，可能是安装不完整。</p>
    <button onclick="location.reload()">重试</button>
    <div class="dbg">
      <div>错误代码：${code}</div>
      <div>描述：${desc}</div>
      <div>入口：${PROD_UI}</div>
      <div>已打包：${app.isPackaged}</div>
    </div>
  </div>
</body></html>`;
    win.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

app.whenReady().then(() => {
    setupProxyIpc();
    createWindow();
});

// 退出前确保代理核心被回收，不留后台进程
app.on('before-quit', async (e) => {
    if (proxyManager && proxyManager.isRunning()) {
        e.preventDefault();
        try {
            await proxyManager.stop();
        } catch {
            /* 忽略 */
        }
        applyProxyToSession(false);
        app.exit(0);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
