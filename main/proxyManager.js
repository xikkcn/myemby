/**
 * 代理核心进程管理（Electron 主进程侧）
 *
 * 职责很窄：写配置 → 起进程 → 等端口就绪 → 关进程。
 * 不参与节点解析与配置生成（那部分在渲染层的 src/proxy/ 里做），
 * 这样主进程不需要引入任何构建产物。
 */
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

/** 核心二进制在各平台的文件名 */
const BIN_NAME = {
  xray: process.platform === 'win32' ? 'xray.exe' : 'xray',
  singbox: process.platform === 'win32' ? 'sing-box.exe' : 'sing-box',
};

class ProxyManager {
  constructor(options = {}) {
    this.proc = null;
    this.core = null;
    this.localPort = options.localPort || 20808;
    this.startedAt = 0;
    this.lastError = '';
    this.logBuffer = [];
    this.maxLogLines = 400;
    this.workDir = path.join(os.tmpdir(), 'myemby-proxy');
    this.configPath = path.join(this.workDir, 'config.json');
    this.onLog = options.onLog || null;
    this.onExit = options.onExit || null;
    fs.mkdirSync(this.workDir, { recursive: true });
  }

  /** 解析核心可执行文件路径：打包后在 resources/bin，开发时在 vendor/bin */
  resolveBinary(core) {
    const name = BIN_NAME[core];
    if (!name) throw new Error('未知核心: ' + core);

    const candidates = [];
    try {
      const { app } = require('electron');
      if (app && app.isPackaged) {
        candidates.push(path.join(process.resourcesPath, 'bin', name));
      }
    } catch {
      /* 非 Electron 环境（测试脚本） */
    }
    candidates.push(path.join(__dirname, '..', 'vendor', 'bin', name));
    candidates.push(path.join(__dirname, '..', '..', 'vendor', 'bin', name));

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        // 在 Windows 上打包 Linux 产物时，可执行位会丢失，运行时补回来
        try {
          fs.chmodSync(p, 0o755);
        } catch {
          /* Windows 上无此概念，忽略 */
        }
        return p;
      }
    }
    throw new Error(
      `找不到 ${core} 核心文件，已尝试:\n  ${candidates.join('\n  ')}\n` +
        '（打包分发版应自带；开发环境请把核心放到 vendor/bin/）'
    );
  }

  /** 核心是否在运行 */
  isRunning() {
    return !!(this.proc && this.proc.exitCode === null && !this.proc.killed);
  }

  pushLog(line) {
    const text = String(line).replace(/\s+$/, '');
    if (!text) return;
    const stamped = `[${new Date().toLocaleTimeString()}] ${text}`;
    this.logBuffer.push(stamped);
    if (this.logBuffer.length > this.maxLogLines) {
      this.logBuffer.splice(0, this.logBuffer.length - this.maxLogLines);
    }
    if (this.onLog) {
      try {
        this.onLog(stamped);
      } catch {
        /* 忽略回调异常 */
      }
    }
  }

  getLogs() {
    return this.logBuffer.slice();
  }

  clearLogs() {
    this.logBuffer = [];
  }

  /** 等待本地端口可连接 */
  waitForPort(port, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const tryOnce = () => {
        if (!this.isRunning()) return reject(new Error('核心进程已退出'));
        const sock = net.connect({ host: '127.0.0.1', port });
        sock.setTimeout(1200);
        sock.once('connect', () => {
          sock.destroy();
          resolve(true);
        });
        const retry = () => {
          sock.destroy();
          if (Date.now() > deadline) reject(new Error(`等待端口 ${port} 超时`));
          else setTimeout(tryOnce, 250);
        };
        sock.once('error', retry);
        sock.once('timeout', retry);
      };
      tryOnce();
    });
  }

  /**
   * 启动核心
   * @param {'xray'|'singbox'} core
   * @param {object} config 完整配置对象
   * @param {number} localPort 本地 SOCKS 端口
   */
  async start(core, config, localPort) {
    await this.stop();
    this.lastError = '';
    this.localPort = localPort || this.localPort;

    const bin = this.resolveBinary(core);
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
    this.pushLog(`启动 ${core}：${bin}`);
    this.pushLog(`配置：${this.configPath}`);

    // 两个核心都支持 `run -c <配置文件>` 形式
    const args = ['run', '-c', this.configPath];

    this.proc = spawn(bin, args, {
      cwd: path.dirname(bin),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.core = core;
    this.startedAt = Date.now();

    const pipe = (stream, tag) => {
      if (!stream) return;
      let buf = '';
      stream.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          this.pushLog(`${tag} ${buf.slice(0, idx)}`);
          buf = buf.slice(idx + 1);
        }
        if (buf.length > 8192) {
          this.pushLog(`${tag} ${buf.slice(0, 8192)}`);
          buf = '';
        }
      });
    };
    pipe(this.proc.stdout, '›');
    pipe(this.proc.stderr, '!');

    this.proc.on('exit', (code, signal) => {
      this.pushLog(`核心进程退出 code=${code} signal=${signal}`);
      if (code !== 0 && this.isRunning()) {
        this.lastError = `核心异常退出（code=${code}）`;
      }
      this.proc = null;
      this.core = null;
      if (this.onExit) {
        try {
          this.onExit(code, signal);
        } catch {
          /* 忽略 */
        }
      }
    });

    try {
      await this.waitForPort(this.localPort, 12000);
      this.pushLog(`本地代理已就绪：socks5://127.0.0.1:${this.localPort}`);
    } catch (e) {
      const detail = this.lastError || e.message;
      await this.stop();
      this.lastError = detail;
      throw new Error(detail);
    }

    return { core, port: this.localPort, pid: this.proc ? this.proc.pid : null };
  }

  /** 停止核心 */
  async stop() {
    const proc = this.proc;
    if (!proc) {
      this.core = null;
      this.startedAt = 0;
      return;
    }
    this.proc = null;
    this.core = null;
    this.startedAt = 0;

    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      proc.once('exit', done);
      try {
        if (process.platform === 'win32' && proc.pid) {
          // Windows 下 sing-box/xray 可能派生子进程，连树一起结束
          spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true });
        } else {
          proc.kill('SIGTERM');
          setTimeout(() => {
            try {
              proc.kill('SIGKILL');
            } catch {
              /* 已退出 */
            }
          }, 2000);
        }
      } catch {
        done();
      }
      setTimeout(done, 4000);
    });
  }

  /** 当前状态 */
  status() {
    return {
      running: this.isRunning(),
      core: this.core,
      localPort: this.localPort,
      uptime: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      lastError: this.lastError || undefined,
    };
  }
}

module.exports = { ProxyManager, BIN_NAME };
