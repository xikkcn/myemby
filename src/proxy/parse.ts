/**
 * 分享链接与订阅解析
 *
 * 支持 vmess / vless / trojan / shadowsocks / socks / http / hysteria2 / tuic
 * 覆盖了 v2rayN、v2rayNG 及主流机场导出的链接格式。
 */
import { ProxyNode, Protocol, NetworkType, makeNodeId } from './types';

/** URL-safe Base64 解码为 UTF-8 字符串；失败返回 null */
export function b64decode(input: string): string | null {
  if (!input) return null;
  let s = input.trim().replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad === 2) s += '==';
  else if (pad === 3) s += '=';
  else if (pad === 1) return null;
  try {
    let bin: string;
    if (typeof atob === 'function') {
      bin = atob(s);
    } else {
      // Node 环境
      bin = Buffer.from(s, 'base64').toString('binary');
    }
    // 转成 UTF-8
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return null;
  }
}

function safeDecodeURIComponent(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** 解析 query 串为对象 */
function parseQuery(q: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!q) return out;
  for (const pair of q.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    if (idx === -1) out[safeDecodeURIComponent(pair)] = '';
    else out[safeDecodeURIComponent(pair.slice(0, idx))] = safeDecodeURIComponent(pair.slice(idx + 1));
  }
  return out;
}

/** 把 network 字符串归一化 */
function normNetwork(v?: string): NetworkType | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase();
  if (s === 'tcp' || s === 'raw') return 'tcp';
  if (s === 'ws' || s === 'websocket') return 'ws';
  if (s === 'grpc') return 'grpc';
  if (s === 'h2' || s === 'http') return s === 'h2' ? 'h2' : 'http';
  if (s === 'quic') return 'quic';
  return 'tcp';
}

function truthy(v?: string): boolean {
  if (v === undefined || v === null) return false;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'tls' || s === 'yes';
}

/** 组装节点（自动补 id） */
function finish(n: Omit<ProxyNode, 'id'>, fallbackName: string): ProxyNode {
  const node = { ...n } as ProxyNode;
  node.name = (node.name || '').trim() || fallbackName;
  node.id = makeNodeId(node);
  return node;
}

// ---------------------------------------------------------------- vmess

function parseVmess(link: string): ProxyNode | null {
  const body = link.slice('vmess://'.length).trim();
  const text = body.startsWith('{') ? body : b64decode(body);
  if (!text) return null;
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  const server = String(j.add || '').trim();
  const port = parseInt(String(j.port), 10);
  if (!server || !port) return null;
  const net = normNetwork(j.net);
  return finish(
    {
      name: String(j.ps || j.remarks || ''),
      protocol: 'vmess',
      server,
      port,
      uuid: String(j.id || '').trim(),
      alterId: parseInt(String(j.aid ?? 0), 10) || 0,
      security: String(j.scy || j.security || 'auto'),
      tls: truthy(j.tls) || String(j.tls || '').toLowerCase() === 'tls' || j.tls === true,
      sni: String(j.sni || '').trim() || undefined,
      fingerprint: String(j.fp || '').trim() || undefined,
      alpn: String(j.alpn || '').trim() || undefined,
      network: net,
      path: net === 'grpc' ? undefined : String(j.path || '').trim() || undefined,
      host: String(j.host || '').trim() || undefined,
      serviceName: net === 'grpc' ? String(j.path || '').trim() || undefined : undefined,
    },
    `${server}:${port}`
  );
}

// --------------------------------------------------- 通用 URI 型（vless / trojan / ss ...）

/** 从 vless://... 这类标准 URI 中拆出 用户信息 / 主机 / 端口 / 参数 / 名称 */
interface UriParts {
  user: string;
  host: string;
  port: number;
  query: Record<string, string>;
  name: string;
}

function splitUri(link: string, schemeLen: number): UriParts | null {
  let rest = link.slice(schemeLen);
  let name = '';
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) {
    name = safeDecodeURIComponent(rest.slice(hashIdx + 1));
    rest = rest.slice(0, hashIdx);
  }
  let query: Record<string, string> = {};
  const qIdx = rest.indexOf('?');
  if (qIdx !== -1) {
    query = parseQuery(rest.slice(qIdx + 1));
    rest = rest.slice(0, qIdx);
  }
  const atIdx = rest.lastIndexOf('@');
  if (atIdx === -1) return null;
  const user = rest.slice(0, atIdx);
  const hostPort = rest.slice(atIdx + 1);
  // host 可能是 IPv6 [::1]:443
  let host = hostPort;
  let portStr = '';
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    host = hostPort.slice(0, close + 1);
    portStr = hostPort.slice(close + 2);
  } else {
    const cIdx = hostPort.lastIndexOf(':');
    if (cIdx !== -1) {
      host = hostPort.slice(0, cIdx);
      portStr = hostPort.slice(cIdx + 1);
    }
  }
  const port = parseInt(portStr, 10);
  if (!host || !port) return null;
  return { user: safeDecodeURIComponent(user), host, port, query, name };
}

function buildTransport(q: Record<string, string>) {
  const net = normNetwork(q.type || q.headerType);
  return {
    network: net,
    path: q.path || undefined,
    host: q.host || undefined,
    serviceName: net === 'grpc' ? q.serviceName || q.path || undefined : undefined,
  };
}

function parseVless(link: string): ProxyNode | null {
  const p = splitUri(link, 'vless://'.length);
  if (!p) return null;
  const t = buildTransport(p.query);
  const security = (p.query.security || '').toLowerCase();
  const isTls = security === 'tls' || security === 'reality' || security === 'xtls';
  return finish(
    {
      name: p.name,
      protocol: 'vless',
      server: p.host,
      port: p.port,
      uuid: p.user,
      flow: p.query.flow || undefined,
      tls: isTls,
      sni: p.query.sni || p.query.host || undefined,
      fingerprint: p.query.fp || undefined,
      alpn: p.query.alpn || undefined,
      allowInsecure: truthy(p.query.allowInsecure) || truthy(p.query.insecure),
      realityPublicKey: p.query.pbk || undefined,
      realityShortId: p.query.sid || undefined,
      ...t,
    },
    `${p.host}:${p.port}`
  );
}

function parseTrojan(link: string): ProxyNode | null {
  const p = splitUri(link, 'trojan://'.length);
  if (!p) return null;
  const t = buildTransport(p.query);
  return finish(
    {
      name: p.name,
      protocol: 'trojan',
      server: p.host,
      port: p.port,
      password: p.user,
      tls: true, // trojan 默认走 TLS
      sni: p.query.sni || p.query.peer || p.query.host || undefined,
      fingerprint: p.query.fp || undefined,
      alpn: p.query.alpn || undefined,
      allowInsecure: truthy(p.query.allowInsecure) || truthy(p.query.insecure),
      ...t,
    },
    `${p.host}:${p.port}`
  );
}

function parseShadowsocks(link: string): ProxyNode | null {
  let rest = link.replace(/^ss:\/\//i, '');
  let name = '';
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) {
    name = safeDecodeURIComponent(rest.slice(hashIdx + 1));
    rest = rest.slice(0, hashIdx);
  }

  let method = '';
  let password = '';
  let hostPort = '';

  const atIdx = rest.lastIndexOf('@');
  if (atIdx !== -1) {
    const userPart = rest.slice(0, atIdx);
    hostPort = rest.slice(atIdx + 1);
    // userPart 可能是 base64(method:password)，也可能是明文 method:password
    let decoded = b64decode(userPart);
    if (!decoded || !decoded.includes(':')) decoded = safeDecodeURIComponent(userPart);
    const cIdx = decoded.indexOf(':');
    if (cIdx === -1) return null;
    method = decoded.slice(0, cIdx).trim();
    password = decoded.slice(cIdx + 1);
  } else {
    // 整串 base64：ss://base64(method:password@host:port)
    const decoded = b64decode(rest);
    if (!decoded) return null;
    const at = decoded.lastIndexOf('@');
    if (at === -1) return null;
    const cred = decoded.slice(0, at);
    hostPort = decoded.slice(at + 1);
    const cIdx = cred.indexOf(':');
    if (cIdx === -1) return null;
    method = cred.slice(0, cIdx).trim();
    password = cred.slice(cIdx + 1);
  }

  // 去掉 query（ss 一般没有，但可能带 plugin）
  const qIdx = hostPort.indexOf('?');
  let query: Record<string, string> = {};
  if (qIdx !== -1) {
    query = parseQuery(hostPort.slice(qIdx + 1));
    hostPort = hostPort.slice(0, qIdx);
  }

  let host = hostPort;
  let portStr = '';
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    host = hostPort.slice(0, close + 1);
    portStr = hostPort.slice(close + 2);
  } else {
    const cIdx = hostPort.lastIndexOf(':');
    if (cIdx !== -1) {
      host = hostPort.slice(0, cIdx);
      portStr = hostPort.slice(cIdx + 1);
    }
  }
  const port = parseInt(portStr, 10);
  if (!host || !port || !method) return null;

  return finish(
    {
      name,
      protocol: 'shadowsocks',
      server: host,
      port,
      method: method.toLowerCase(),
      password,
      tls: truthy(query.tls),
    },
    `${host}:${port}`
  );
}

function parseSocksLike(link: string, proto: 'socks' | 'http'): ProxyNode | null {
  const schemeLen = link.indexOf('://') + 3;
  const p = splitUri(link, schemeLen);
  if (!p) return null;
  const [username, ...restPw] = p.user.split(':');
  return finish(
    {
      name: p.name,
      protocol: proto,
      server: p.host,
      port: p.port,
      uuid: username || undefined,
      password: restPw.join(':') || undefined,
      tls: proto === 'http' && /^https:/i.test(link),
    },
    `${p.host}:${p.port}`
  );
}

function parseHysteria2(link: string): ProxyNode | null {
  const schemeLen = link.indexOf('://') + 3;
  const p = splitUri(link, schemeLen);
  if (!p) return null;
  const q = p.query;
  return finish(
    {
      name: p.name,
      protocol: 'hysteria2',
      server: p.host,
      port: p.port,
      password: p.user, // hysteria2 用 userinfo 作为密码，也可能带 : 分隔
      tls: true,
      sni: q.sni || q.peer || undefined,
      alpn: q.alpn || undefined,
      allowInsecure: truthy(q.insecure) || truthy(q.allowInsecure),
      obfs: q.obfs || undefined,
      obfsPassword: q['obfs-password'] || q.obfsPassword || undefined,
    },
    `${p.host}:${p.port}`
  );
}

function parseTuic(link: string): ProxyNode | null {
  const p = splitUri(link, 'tuic://'.length);
  if (!p) return null;
  const q = p.query;
  const cIdx = p.user.indexOf(':');
  const uuid = cIdx === -1 ? p.user : p.user.slice(0, cIdx);
  const password = cIdx === -1 ? '' : p.user.slice(cIdx + 1);
  return finish(
    {
      name: p.name,
      protocol: 'tuic',
      server: p.host,
      port: p.port,
      uuid,
      password,
      tls: true,
      sni: q.sni || undefined,
      alpn: q.alpn || undefined,
      allowInsecure: truthy(q.allow_insecure) || truthy(q.insecure),
      congestionControl: q.congestion_control || q.congestionControl || undefined,
    },
    `${p.host}:${p.port}`
  );
}

// ---------------------------------------------------------------- 入口

/** 解析单条分享链接；无法识别时返回 null */
export function parseLink(link: string): ProxyNode | null {
  const s = (link || '').trim();
  if (!s) return null;
  try {
    if (/^vmess:\/\//i.test(s)) return parseVmess(s);
    if (/^vless:\/\//i.test(s)) return parseVless(s);
    if (/^trojan:\/\//i.test(s)) return parseTrojan(s);
    if (/^ss:\/\//i.test(s)) return parseShadowsocks(s);
    if (/^socks5?:\/\//i.test(s)) return parseSocksLike(s, 'socks');
    if (/^https?:\/\//i.test(s)) return parseSocksLike(s, 'http');
    if (/^hysteria2:\/\//i.test(s) || /^hy2:\/\//i.test(s)) return parseHysteria2(s);
    if (/^tuic:\/\//i.test(s)) return parseTuic(s);
  } catch {
    return null;
  }
  return null;
}

/** 该协议是否仅 sing-box 支持（Xray 不支持） */
export function requiresSingbox(n: ProxyNode): boolean {
  return n.protocol === 'hysteria2' || n.protocol === 'tuic';
}

/**
 * 解析订阅内容：
 * 1) 整体 base64 → 逐行链接
 * 2) 直接就是多行链接
 * 3) 是 Clash / sing-box 的 JSON 配置（尝试提取 proxies/outbounds）
 */
export function parseSubscription(content: string): ProxyNode[] {
  const text = (content || '').trim();
  if (!text) return [];

  // 情况 3：JSON 配置
  if (text.startsWith('{') || text.startsWith('[')) {
    const fromJson = parseJsonConfig(text);
    if (fromJson.length) return fromJson;
  }

  // 情况 1：整体 base64
  let body = text;
  if (!/^[a-z]+:\/\//im.test(text)) {
    const decoded = b64decode(text);
    if (decoded && /[a-z]+:\/\//i.test(decoded)) body = decoded;
  }

  // 情况 2：逐行
  const nodes: ProxyNode[] = [];
  const seen = new Set<string>();
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const n = parseLink(line);
    if (n && !seen.has(n.id)) {
      seen.add(n.id);
      nodes.push(n);
    }
  }
  return nodes;
}

/** 尝试从 Clash / sing-box JSON 中提取节点（尽力而为） */
function parseJsonConfig(text: string): ProxyNode[] {
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    return [];
  }
  const arr: any[] = Array.isArray(j) ? j : Array.isArray(j.proxies) ? j.proxies : [];
  const out: ProxyNode[] = [];
  for (const p of arr) {
    if (!p || !p.type || !p.server || !p.port) continue;
    const type = String(p.type).toLowerCase();
    const base: any = {
      name: String(p.name || ''),
      server: String(p.server),
      port: parseInt(String(p.port), 10),
      network: normNetwork(p.network),
      path: p['ws-path'] || (p['ws-opts'] && p['ws-opts'].path) || undefined,
      host: p['ws-headers']?.Host || (p['ws-opts'] && p['ws-opts'].headers && p['ws-opts'].headers.Host) || undefined,
      sni: p.servername || p.sni || undefined,
      fingerprint: p['client-fingerprint'] || undefined,
      tls: !!p.tls,
      allowInsecure: !!p['skip-cert-verify'],
    };
    if (type === 'vmess') {
      out.push(finish({ ...base, protocol: 'vmess', uuid: p.uuid, alterId: p.alterId || 0, security: p.cipher || 'auto' }, base.server));
    } else if (type === 'vless') {
      out.push(finish({ ...base, protocol: 'vless', uuid: p.uuid, flow: p.flow, realityPublicKey: p['reality-opts']?.['public-key'], realityShortId: p['reality-opts']?.['short-id'] }, base.server));
    } else if (type === 'trojan') {
      out.push(finish({ ...base, protocol: 'trojan', password: p.password, tls: true }, base.server));
    } else if (type === 'ss') {
      out.push(finish({ ...base, protocol: 'shadowsocks', method: p.cipher, password: p.password }, base.server));
    } else if (type === 'hysteria2' || type === 'hysteria') {
      out.push(finish({ ...base, protocol: 'hysteria2', password: p.password || p.auth, tls: true, obfs: p.obfs, obfsPassword: p['obfs-password'] }, base.server));
    } else if (type === 'tuic') {
      out.push(finish({ ...base, protocol: 'tuic', uuid: p.uuid, password: p.password, tls: true }, base.server));
    } else if (type === 'socks5' || type === 'socks') {
      out.push(finish({ ...base, protocol: 'socks', uuid: p.username, password: p.password }, base.server));
    }
  }
  const seen = new Set<string>();
  return out.filter((n) => !seen.has(n.id) && seen.add(n.id));
}
