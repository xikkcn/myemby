const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * myemby（我的EMBY）Electron 主进程
 * - 生产环境从 dist/renderer/index.html 加载
 * - 允许连接自建 Emby 服务器（忽略自签证书、放开跨域）
 */

const APP_NAME = 'myemby';
const PROD_UI = path.join(__dirname, 'dist', 'renderer', 'index.html');

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
