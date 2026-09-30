/**
 * 代理后端抽象层
 *
 * 三种运行形态走不同通道，但对外暴露同一套接口：
 *  - 桌面（Electron）：通过 ipcRenderer 调用主进程
 *  - 安卓 / TV（Capacitor）：调用原生 VpnService 插件
 *  - 网页：不支持内置核心，只能提示用户
 */
import type { ProxyStatus, LatencyResult, CoreType } from '../proxy/types';

export interface CoreAvailability {
  available: boolean;
  path?: string;
  error?: string;
}

export interface StartResult {
  ok: boolean;
  error?: string;
  core?: string;
  port?: number;
}

export interface PingTarget {
  nodeId: string;
  server: string;
  port: number;
}

export interface ProxyBackend {
  /** 后端名称，用于界面提示 */
  readonly kind: 'electron' | 'android' | 'web';
  /** 该后端是否支持内置核心 */
  readonly supported: boolean;
  start(core: CoreType, config: object, localPort: number): Promise<StartResult>;
  stop(): Promise<void>;
  status(): Promise<ProxyStatus | null>;
  logs(): Promise<string[]>;
  clearLogs(): Promise<void>;
  ping(targets: PingTarget[]): Promise<LatencyResult[]>;
  checkCores(): Promise<Record<string, CoreAvailability>>;
  /** 订阅运行日志，返回取消订阅函数 */
  onLog(cb: (line: string) => void): () => void;
  /** 订阅「核心意外退出」事件 */
  onStatusChanged(cb: () => void): () => void;
}

// ------------------------------------------------------------ Electron

class ElectronBackend implements ProxyBackend {
  readonly kind = 'electron' as const;
  readonly supported = true;

  private get ipc(): any {
    // contextIsolation=false + nodeIntegration=true，可直接拿到 ipcRenderer
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (window as any).require ? (window as any).require('electron').ipcRenderer : null;
  }

  async start(core: CoreType, config: object, localPort: number): Promise<StartResult> {
    return this.ipc.invoke('proxy:start', { core, config, localPort });
  }
  async stop() {
    await this.ipc.invoke('proxy:stop');
  }
  async status(): Promise<ProxyStatus | null> {
    const s = await this.ipc.invoke('proxy:status');
    if (!s || !s.running) return null;
    return { ...s, nodeId: null } as ProxyStatus;
  }
  async logs(): Promise<string[]> {
    return this.ipc.invoke('proxy:logs');
  }
  async clearLogs() {
    await this.ipc.invoke('proxy:clear-logs');
  }
  async ping(targets: PingTarget[]): Promise<LatencyResult[]> {
    return this.ipc.invoke('proxy:ping', targets);
  }
  async checkCores(): Promise<Record<string, CoreAvailability>> {
    return this.ipc.invoke('proxy:check-cores');
  }
  onLog(cb: (line: string) => void) {
    const h = (_e: any, line: string) => cb(line);
    this.ipc.on('proxy:log', h);
    return () => this.ipc.removeListener('proxy:log', h);
  }
  onStatusChanged(cb: () => void) {
    const h = () => cb();
    this.ipc.on('proxy:status-changed', h);
    return () => this.ipc.removeListener('proxy:status-changed', h);
  }
}

// ------------------------------------------------------------ Android / TV

class AndroidBackend implements ProxyBackend {
  readonly kind = 'android' as const;
  readonly supported = true;

  private get plugin(): any {
    return (window as any).Capacitor?.Plugins?.MyembyProxy || null;
  }

  async start(core: CoreType, config: object, localPort: number): Promise<StartResult> {
    if (!this.plugin) return { ok: false, error: '代理插件未加载' };
    try {
      const r = await this.plugin.start({ core, config: JSON.stringify(config), localPort });
      return { ok: !!r?.ok, error: r?.error, core, port: localPort };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }
  async stop() {
    if (this.plugin) await this.plugin.stop();
  }
  async status(): Promise<ProxyStatus | null> {
    if (!this.plugin) return null;
    const s = await this.plugin.status();
    if (!s || !s.running) return null;
    return { ...s, nodeId: null } as ProxyStatus;
  }
  async logs(): Promise<string[]> {
    if (!this.plugin) return [];
    const r = await this.plugin.logs();
    return r?.lines || [];
  }
  async clearLogs() {
    if (this.plugin) await this.plugin.clearLogs();
  }
  async ping(targets: PingTarget[]): Promise<LatencyResult[]> {
    if (!this.plugin) return targets.map((t) => ({ nodeId: t.nodeId, delay: -1, error: '插件未加载' }));
    const r = await this.plugin.ping({ targets: JSON.stringify(targets) });
    return r?.results || [];
  }
  async checkCores(): Promise<Record<string, CoreAvailability>> {
    if (!this.plugin) {
      return { xray: { available: false, error: '插件未加载' }, singbox: { available: false, error: '插件未加载' } };
    }
    const r = await this.plugin.checkCores();
    return r?.cores || {};
  }
  onLog(cb: (line: string) => void) {
    const p = this.plugin;
    if (!p) return () => undefined;
    const h = p.addListener('proxyLog', (d: any) => cb(d?.line ?? ''));
    return () => {
      try {
        h.remove();
      } catch {
        /* 忽略 */
      }
    };
  }
  onStatusChanged(cb: () => void) {
    const p = this.plugin;
    if (!p) return () => undefined;
    const h = p.addListener('proxyStatusChanged', () => cb());
    return () => {
      try {
        h.remove();
      } catch {
        /* 忽略 */
      }
    };
  }
}

// ------------------------------------------------------------ Web

class WebBackend implements ProxyBackend {
  readonly kind = 'web' as const;
  readonly supported = false;
  private err = '网页版无法启动本地代理核心，请使用桌面端或电视端';
  async start(): Promise<StartResult> {
    return { ok: false, error: this.err };
  }
  async stop() {}
  async status() {
    return null;
  }
  async logs() {
    return [];
  }
  async clearLogs() {}
  async ping(targets: PingTarget[]): Promise<LatencyResult[]> {
    return targets.map((t) => ({ nodeId: t.nodeId, delay: -1, error: this.err }));
  }
  async checkCores(): Promise<Record<string, CoreAvailability>> {
    return { xray: { available: false, error: this.err }, singbox: { available: false, error: this.err } };
  }
  onLog() {
    return () => undefined;
  }
  onStatusChanged() {
    return () => undefined;
  }
}

function detect(): ProxyBackend {
  if (typeof window === 'undefined') return new WebBackend();
  const w = window as any;
  if (w.require && w.process && w.process.versions && w.process.versions.electron) {
    return new ElectronBackend();
  }
  if (w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform()) {
    return new AndroidBackend();
  }
  return new WebBackend();
}

let cached: ProxyBackend | null = null;

export function proxyBackend(): ProxyBackend {
  if (!cached) cached = detect();
  return cached;
}
