/**
 * 网络加速（代理）状态管理
 *
 * 节点、订阅、选中项、测速结果都持久化在本机（加密存放），
 * 核心进程的启停交给 platform/proxy 抽象层。
 */
import create from 'zustand';
import CryptoJS from 'crypto-js';
import { ProxyNode, Subscription, ProxyStatus, LatencyResult, CoreType, DEFAULT_LOCAL_PORT } from '../proxy/types';
import { parseLink, parseSubscription, requiresSingbox } from '../proxy/parse';
import { buildXrayConfig, buildSingboxConfig } from '../proxy/build';
import { proxyBackend, CoreAvailability } from '../platform/proxy';

const STORE_KEY = 'myemby_proxy_v1';
const SECRET_KEY = 'myemby-proxy-store-key';

function encrypt(data: string): string {
  return CryptoJS.AES.encrypt(data, SECRET_KEY).toString();
}
function decrypt(cipher: string): string {
  try {
    return CryptoJS.AES.decrypt(cipher, SECRET_KEY).toString(CryptoJS.enc.Utf8);
  } catch {
    return '';
  }
}

function loadPersisted(): Partial<ProxyState> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const text = decrypt(raw);
    if (!text) return {};
    const j = JSON.parse(text);
    return {
      nodes: Array.isArray(j.nodes) ? j.nodes : [],
      subscriptions: Array.isArray(j.subscriptions) ? j.subscriptions : [],
      selectedNodeId: j.selectedNodeId ?? null,
      preferredCore: j.preferredCore || 'auto',
      localPort: typeof j.localPort === 'number' ? j.localPort : DEFAULT_LOCAL_PORT,
      lastNodeId: j.lastNodeId ?? null,
    };
  } catch {
    return {};
  }
}

export interface ProxyState {
  // ---- 数据 ----
  nodes: ProxyNode[];
  subscriptions: Subscription[];
  selectedNodeId: string | null;
  /** 上次成功启动过的节点，用于「一键恢复」 */
  lastNodeId: string | null;

  // ---- 设置 ----
  enabled: boolean;
  preferredCore: 'auto' | CoreType;
  localPort: number;

  // ---- 运行时 ----
  status: ProxyStatus | null;
  latency: Record<string, LatencyResult>;
  logs: string[];
  busy: boolean;
  error: string | null;
  cores: Record<string, CoreAvailability>;

  // ---- 动作 ----
  addSubscription: (url: string, name?: string) => Promise<{ ok: boolean; count: number; error?: string }>;
  refreshSubscription: (id: string) => Promise<{ ok: boolean; count: number; error?: string }>;
  removeSubscription: (id: string) => void;
  addNodesFromText: (text: string) => { count: number };
  removeNode: (id: string) => void;
  clearNodes: () => void;
  selectNode: (id: string | null) => void;
  setPreferredCore: (c: 'auto' | CoreType) => void;
  setLocalPort: (p: number) => void;
  start: () => Promise<{ ok: boolean; error?: string }>;
  stop: () => Promise<void>;
  toggle: () => Promise<{ ok: boolean; error?: string }>;
  refreshStatus: () => Promise<void>;
  testLatency: (nodeIds?: string[]) => Promise<void>;
  checkCores: () => Promise<void>;
  appendLog: (line: string) => void;
  clearLogs: () => void;
  clearError: () => void;
  /** 应用启动时调用：恢复状态并挂上事件监听 */
  init: () => Promise<void>;
}

/** 选择实际使用的核心 */
function pickCore(node: ProxyNode, preferred: 'auto' | CoreType, cores: Record<string, CoreAvailability>): CoreType {
  if (requiresSingbox(node)) return 'singbox';
  if (preferred !== 'auto') return preferred;
  if (cores.xray?.available) return 'xray';
  if (cores.singbox?.available) return 'singbox';
  return 'xray';
}

let initialized = false;

export const useProxyStore = create<ProxyState>((set, get) => {
  const persist = () => {
    const s = get();
    try {
      const payload = JSON.stringify({
        nodes: s.nodes,
        subscriptions: s.subscriptions,
        selectedNodeId: s.selectedNodeId,
        lastNodeId: s.lastNodeId,
        preferredCore: s.preferredCore,
        localPort: s.localPort,
      });
      localStorage.setItem(STORE_KEY, encrypt(payload));
    } catch {
      /* 存储失败不影响使用 */
    }
  };

  const persisted = loadPersisted();

  return {
    nodes: persisted.nodes || [],
    subscriptions: persisted.subscriptions || [],
    selectedNodeId: persisted.selectedNodeId ?? null,
    lastNodeId: persisted.lastNodeId ?? null,

    enabled: false,
    preferredCore: persisted.preferredCore || 'auto',
    localPort: persisted.localPort || DEFAULT_LOCAL_PORT,

    status: null,
    latency: {},
    logs: [],
    busy: false,
    error: null,
    cores: {},

    // ---------------------------------------------------------- 订阅

    addSubscription: async (url, name) => {
      const trimmed = (url || '').trim();
      if (!trimmed) return { ok: false, count: 0, error: '订阅地址不能为空' };
      set({ busy: true, error: null });
      try {
        const nodes = await fetchSubscription(trimmed);
        if (!nodes.length) throw new Error('订阅里没有解析出可用节点');
        const id = 'sub' + Date.now().toString(36);
        const sub: Subscription = {
          id,
          name: name?.trim() || `订阅 ${get().subscriptions.length + 1}`,
          url: trimmed,
          updatedAt: Date.now(),
          lastResult: `成功，共 ${nodes.length} 个节点`,
          autoUpdate: true,
        };
        const withSub = nodes.map((n) => ({ ...n, subscriptionId: id }));
        // 同订阅旧的节点先清掉，避免重复堆积
        const kept = get().nodes.filter((n) => n.subscriptionId !== id);
        set({ nodes: [...kept, ...withSub], subscriptions: [...get().subscriptions, sub], busy: false });
        persist();
        return { ok: true, count: nodes.length };
      } catch (e: any) {
        const error = String(e?.message || e);
        set({ busy: false, error });
        return { ok: false, count: 0, error };
      }
    },

    refreshSubscription: async (id) => {
      const sub = get().subscriptions.find((s) => s.id === id);
      if (!sub) return { ok: false, count: 0, error: '订阅不存在' };
      set({ busy: true, error: null });
      try {
        const nodes = await fetchSubscription(sub.url);
        if (!nodes.length) throw new Error('订阅里没有解析出可用节点');
        const withSub = nodes.map((n) => ({ ...n, subscriptionId: id }));
        const kept = get().nodes.filter((n) => n.subscriptionId !== id);
        const subscriptions = get().subscriptions.map((s) =>
          s.id === id ? { ...s, updatedAt: Date.now(), lastResult: `成功，共 ${nodes.length} 个节点` } : s
        );
        set({ nodes: [...kept, ...withSub], subscriptions, busy: false });
        persist();
        return { ok: true, count: nodes.length };
      } catch (e: any) {
        const error = String(e?.message || e);
        const subscriptions = get().subscriptions.map((s) =>
          s.id === id ? { ...s, lastResult: `更新失败：${error}` } : s
        );
        set({ subscriptions, busy: false, error });
        persist();
        return { ok: false, count: 0, error };
      }
    },

    removeSubscription: (id) => {
      set({
        subscriptions: get().subscriptions.filter((s) => s.id !== id),
        nodes: get().nodes.filter((n) => n.subscriptionId !== id),
      });
      persist();
    },

    // ---------------------------------------------------------- 节点

    addNodesFromText: (text) => {
      const raw = (text || '').trim();
      if (!raw) return { count: 0 };
      // 先按订阅整体解析（支持 base64），失败再逐行
      let parsed = parseSubscription(raw);
      if (!parsed.length) {
        parsed = raw
          .split(/\r?\n/)
          .map((l) => parseLink(l.trim()))
          .filter(Boolean) as ProxyNode[];
      }
      if (!parsed.length) return { count: 0 };
      const exist = new Set(get().nodes.map((n) => n.id));
      const fresh = parsed.filter((n) => !exist.has(n.id)).map((n) => ({ ...n, addedAt: Date.now() }));
      set({ nodes: [...get().nodes, ...fresh] });
      persist();
      return { count: fresh.length };
    },

    removeNode: (id) => {
      const nodes = get().nodes.filter((n) => n.id !== id);
      set({
        nodes,
        selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
      });
      persist();
    },

    clearNodes: () => {
      set({ nodes: [], selectedNodeId: null });
      persist();
    },

    selectNode: (id) => {
      set({ selectedNodeId: id });
      persist();
    },

    setPreferredCore: (c) => {
      set({ preferredCore: c });
      persist();
    },

    setLocalPort: (p) => {
      const port = Math.max(1024, Math.min(65535, Math.floor(p) || DEFAULT_LOCAL_PORT));
      set({ localPort: port });
      persist();
    },

    // ---------------------------------------------------------- 启停

    start: async () => {
      const s = get();
      const node = s.nodes.find((n) => n.id === s.selectedNodeId);
      if (!node) return { ok: false, error: '请先选择一个节点' };
      if (!proxyBackend().supported) {
        const error = '当前平台不支持内置代理核心';
        set({ error });
        return { ok: false, error };
      }

      set({ busy: true, error: null });
      const core = pickCore(node, s.preferredCore, s.cores);
      try {
        const config = core === 'xray' ? buildXrayConfig(node, s.localPort) : buildSingboxConfig(node, s.localPort);
        const r = await proxyBackend().start(core, config, s.localPort);
        if (!r.ok) {
          set({ busy: false, error: r.error || '启动失败' });
          return { ok: false, error: r.error };
        }
        set({
          busy: false,
          enabled: true,
          lastNodeId: node.id,
          status: { running: true, core, nodeId: node.id, localPort: s.localPort, uptime: 0 },
        });
        persist();
        return { ok: true };
      } catch (e: any) {
        const error = String(e?.message || e);
        set({ busy: false, error });
        return { ok: false, error };
      }
    },

    stop: async () => {
      set({ busy: true });
      try {
        await proxyBackend().stop();
      } catch {
        /* 忽略 */
      }
      set({ busy: false, enabled: false, status: null });
    },

    toggle: async () => {
      if (get().enabled) {
        await get().stop();
        return { ok: true };
      }
      return get().start();
    },

    refreshStatus: async () => {
      try {
        const st = await proxyBackend().status();
        set({ status: st, enabled: !!st?.running });
      } catch {
        /* 忽略 */
      }
    },

    // ---------------------------------------------------------- 测速

    testLatency: async (nodeIds) => {
      const all = get().nodes;
      const targets = (nodeIds && nodeIds.length ? all.filter((n) => nodeIds.includes(n.id)) : all).map((n) => ({
        nodeId: n.id,
        server: n.server,
        port: n.port,
      }));
      if (!targets.length) return;
      set({ busy: true });
      try {
        const results = await proxyBackend().ping(targets);
        const latency = { ...get().latency };
        for (const r of results) latency[r.nodeId] = r;
        set({ latency, busy: false });
      } catch {
        set({ busy: false });
      }
    },

    checkCores: async () => {
      try {
        const cores = await proxyBackend().checkCores();
        set({ cores });
      } catch {
        /* 忽略 */
      }
    },

    // ---------------------------------------------------------- 日志

    appendLog: (line) => {
      const logs = [...get().logs, line];
      if (logs.length > 500) logs.splice(0, logs.length - 500);
      set({ logs });
    },

    clearLogs: () => {
      set({ logs: [] });
      proxyBackend().clearLogs().catch(() => undefined);
    },

    clearError: () => set({ error: null }),

    // ---------------------------------------------------------- 初始化

    init: async () => {
      if (initialized) return;
      initialized = true;

      const backend = proxyBackend();
      backend.onLog((line) => get().appendLog(line));
      backend.onStatusChanged(() => {
        get().refreshStatus();
      });

      await get().checkCores();
      await get().refreshStatus();

      // 若之前拉取过日志，补齐一次
      try {
        const lines = await backend.logs();
        if (lines && lines.length) set({ logs: lines });
      } catch {
        /* 忽略 */
      }
    },
  };
});

/** 拉取订阅内容并解析为节点 */
async function fetchSubscription(url: string): Promise<ProxyNode[]> {
  // 订阅地址可能是 http，且服务端常不带 CORS 头；桌面端已放开 webSecurity
  const res = await fetch(url, {
    headers: {
      // 部分机场会根据 UA 返回不同格式，用通用 UA 兼容性最好
      'User-Agent': 'myemby/1.0.1',
    },
  });
  if (!res.ok) throw new Error(`订阅请求失败（HTTP ${res.status}）`);
  const text = await res.text();
  return parseSubscription(text);
}
