/**
 * 代理节点统一数据模型
 *
 * 设计目标：用一套结构同时承载「分享链接」「订阅」「手动填写」三种来源，
 * 并能无损地转换成 Xray-core 与 sing-box 两种核心的配置。
 */

export type Protocol =
  | 'vmess'
  | 'vless'
  | 'trojan'
  | 'shadowsocks'
  | 'socks'
  | 'http'
  | 'hysteria2'
  | 'tuic';

export type NetworkType = 'tcp' | 'ws' | 'grpc' | 'h2' | 'http' | 'quic';

/** 一个代理节点 */
export interface ProxyNode {
  /** 稳定唯一 ID（由协议+地址+端口+名称派生） */
  id: string;
  /** 显示名称 */
  name: string;
  protocol: Protocol;
  server: string;
  port: number;

  // ---- 认证信息 ----
  /** vmess / vless / tuic 使用 */
  uuid?: string;
  /** trojan / shadowsocks / hysteria2 / tuic 使用 */
  password?: string;
  /** shadowsocks 加密方式 */
  method?: string;
  /** vmess 额外 ID（0 或 4，新服务端一般为 0） */
  alterId?: number;
  /** vmess 加密方式：auto / aes-128-gcm / chacha20-poly1305 / none */
  security?: string;
  /** vless flow：xtls-rprx-vision 等 */
  flow?: string;

  // ---- TLS ----
  tls?: boolean;
  /** 伪装域名 / SNI */
  sni?: string;
  /** uTLS 指纹：chrome / firefox / safari / randomized 等 */
  fingerprint?: string;
  allowInsecure?: boolean;
  /** REALITY 公钥 */
  realityPublicKey?: string;
  /** REALITY shortId */
  realityShortId?: string;
  /** ALPN，逗号分隔存储 */
  alpn?: string;

  // ---- 传输层 ----
  network?: NetworkType;
  /** ws / grpc / h2 的路径 */
  path?: string;
  /** 伪装 Host */
  host?: string;
  /** grpc 服务名 */
  serviceName?: string;

  // ---- hysteria2 / tuic 专属 ----
  /** salamander 等混淆类型 */
  obfs?: string;
  obfsPassword?: string;
  /** 拥塞控制：bbr / cubic / new_reno */
  congestionControl?: string;

  // ---- 来源与元信息 ----
  /** 来自哪个订阅（手动添加为空） */
  subscriptionId?: string;
  /** 手动添加时用于排序 */
  addedAt?: number;
}

/** 一条订阅 */
export interface Subscription {
  id: string;
  name: string;
  url: string;
  /** 上次更新成功时间戳 */
  updatedAt?: number;
  /** 上次更新结果说明 */
  lastResult?: string;
  /** 是否在代理已开启时自动更新 */
  autoUpdate?: boolean;
}

/** 核心类型 */
export type CoreType = 'xray' | 'singbox';

/** 代理运行状态 */
export interface ProxyStatus {
  /** 核心进程是否在跑 */
  running: boolean;
  /** 当前使用的核心 */
  core: CoreType | null;
  /** 当前选中节点 ID */
  nodeId: string | null;
  /** 本地混合入站端口 */
  localPort: number;
  /** 已启动秒数 */
  uptime: number;
  /** 最近一次错误 */
  lastError?: string;
}

/** 延迟测试结果 */
export interface LatencyResult {
  nodeId: string;
  /** 毫秒；-1 表示失败 */
  delay: number;
  /** 失败原因 */
  error?: string;
}

/** 默认本地混合入站端口（SOCKS5 + HTTP 同端口） */
export const DEFAULT_LOCAL_PORT = 20808;

/** 生成节点 ID：同协议同地址端口视为同一节点 */
export function makeNodeId(n: Pick<ProxyNode, 'protocol' | 'server' | 'port' | 'name'>): string {
  const raw = `${n.protocol}|${n.server}|${n.port}|${n.name}`;
  // 简单稳定哈希（FNV-1a 32 位），避免引入额外依赖
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return 'n' + h.toString(16).padStart(8, '0');
}
