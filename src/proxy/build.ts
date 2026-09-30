/**
 * 把统一节点模型转换成 Xray-core / sing-box 的配置对象
 *
 * 两种核心的差异：
 *  - Xray：需要分别开 socks 与 http 两个入站（不支持同端口混合）
 *  - sing-box：一个 mixed 入站即可同时提供 socks5 + http
 *
 * 统一约定：对外始终以 `localPort` 作为 SOCKS5 端口暴露。
 */
import { ProxyNode, DEFAULT_LOCAL_PORT } from './types';

const PRIVATE_CIDR = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
];

function splitList(v?: string): string[] | undefined {
  if (!v) return undefined;
  const arr = v
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return arr.length ? arr : undefined;
}

/** 判断节点是否需要 TLS 层 */
function usesTls(n: ProxyNode): boolean {
  return !!n.tls || n.protocol === 'trojan' || n.protocol === 'hysteria2' || n.protocol === 'tuic';
}

function usesReality(n: ProxyNode): boolean {
  return !!n.realityPublicKey;
}

// ============================================================ Xray

function xrayStreamSettings(n: ProxyNode): Record<string, any> {
  const s: Record<string, any> = {};
  const net = n.network || 'tcp';
  s.network = net === 'h2' ? 'h2' : net === 'http' ? 'tcp' : net;
  if (net === 'tcp' && n.host && !n.path) s.network = 'tcp';

  // 传输层细节
  if (net === 'ws') {
    s.wsSettings = { path: n.path || '/', headers: n.host ? { Host: n.host } : {} };
  } else if (net === 'grpc') {
    s.grpcSettings = { serviceName: n.serviceName || n.path || '', multiMode: false };
  } else if (net === 'h2') {
    s.httpSettings = { path: n.path || '/', host: n.host ? [n.host] : undefined };
  } else if (net === 'quic') {
    s.quicSettings = { security: 'none', key: '', header: { type: 'none' } };
  } else if (net === 'http') {
    s.network = 'tcp';
    s.tcpSettings = { header: { type: 'http', request: { path: [n.path || '/'], headers: n.host ? { Host: [n.host] } : {} } } };
  }

  // 安全层
  if (usesReality(n)) {
    s.security = 'reality';
    s.realitySettings = {
      serverName: n.sni || n.host || n.server,
      fingerprint: n.fingerprint || 'chrome',
      publicKey: n.realityPublicKey,
      shortId: n.realityShortId || '',
      spiderX: '',
    };
  } else if (usesTls(n)) {
    s.security = 'tls';
    const tlsSettings: Record<string, any> = {
      serverName: n.sni || n.host || n.server,
      allowInsecure: !!n.allowInsecure,
    };
    if (n.fingerprint) tlsSettings.fingerprint = n.fingerprint;
    const alpn = splitList(n.alpn);
    if (alpn) tlsSettings.alpn = alpn;
    s.tlsSettings = tlsSettings;
  } else {
    s.security = 'none';
  }
  return s;
}

/** 生成 Xray 的单个出站对象 */
export function buildXrayOutbound(n: ProxyNode): Record<string, any> {
  const out: Record<string, any> = { tag: 'proxy', protocol: '', settings: {} };

  switch (n.protocol) {
    case 'vmess':
      out.protocol = 'vmess';
      out.settings = {
        vnext: [
          {
            address: n.server,
            port: n.port,
            users: [{ id: n.uuid, alterId: n.alterId ?? 0, security: n.security || 'auto' }],
          },
        ],
      };
      break;

    case 'vless':
      out.protocol = 'vless';
      out.settings = {
        vnext: [
          {
            address: n.server,
            port: n.port,
            users: [{ id: n.uuid, encryption: 'none', flow: n.flow || '' }],
          },
        ],
      };
      break;

    case 'trojan':
      out.protocol = 'trojan';
      out.settings = {
        servers: [{ address: n.server, port: n.port, password: n.password }],
      };
      break;

    case 'shadowsocks':
      out.protocol = 'shadowsocks';
      out.settings = {
        servers: [{ address: n.server, port: n.port, method: n.method, password: n.password }],
      };
      break;

    case 'socks':
      out.protocol = 'socks';
      out.settings = {
        servers: [
          {
            address: n.server,
            port: n.port,
            ...(n.uuid ? { users: [{ user: n.uuid, pass: n.password || '' }] } : {}),
          },
        ],
      };
      break;

    case 'http':
      out.protocol = 'http';
      out.settings = {
        servers: [
          {
            address: n.server,
            port: n.port,
            ...(n.uuid ? { users: [{ user: n.uuid, pass: n.password || '' }] } : {}),
          },
        ],
      };
      break;

    default:
      // hysteria2 / tuic 不被 Xray 支持，调用方应先过滤
      throw new Error(`Xray 不支持协议: ${n.protocol}`);
  }

  // socks / http 出站无传输层与安全层
  if (n.protocol !== 'socks' && n.protocol !== 'http') {
    out.streamSettings = xrayStreamSettings(n);
  }
  return out;
}

/** 生成完整的 Xray 配置 */
export function buildXrayConfig(n: ProxyNode, localPort: number = DEFAULT_LOCAL_PORT): Record<string, any> {
  return {
    log: { loglevel: 'warning', access: '', error: '' },
    inbounds: [
      {
        tag: 'socks-in',
        listen: '127.0.0.1',
        port: localPort,
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true, userLevel: 0 },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: false },
      },
      {
        tag: 'http-in',
        listen: '127.0.0.1',
        port: localPort + 1,
        protocol: 'http',
        settings: { allowTransparent: false, userLevel: 0 },
        sniffing: { enabled: true, destOverride: ['http', 'tls'], routeOnly: false },
      },
    ],
    outbounds: [
      buildXrayOutbound(n),
      { tag: 'direct', protocol: 'freedom', settings: { domainStrategy: 'UseIP' } },
      { tag: 'block', protocol: 'blackhole', settings: {} },
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        // 内网与本地地址直连，避免把 Emby 服务器本身也代理走
        { type: 'field', ip: PRIVATE_CIDR, outboundTag: 'direct' },
        { type: 'field', domain: ['localhost'], outboundTag: 'direct' },
      ],
    },
  };
}

// ============================================================ sing-box

function singboxTls(n: ProxyNode): Record<string, any> | undefined {
  if (!usesTls(n)) return undefined;
  const tls: Record<string, any> = {
    enabled: true,
    server_name: n.sni || n.host || n.server,
    insecure: !!n.allowInsecure,
  };
  const alpn = splitList(n.alpn);
  if (alpn) tls.alpn = alpn;
  if (n.fingerprint) tls.utls = { enabled: true, fingerprint: n.fingerprint };
  if (usesReality(n)) {
    tls.reality = {
      enabled: true,
      public_key: n.realityPublicKey,
      short_id: n.realityShortId || '',
    };
    // REALITY 必须配 uTLS 指纹
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: n.fingerprint || 'chrome' };
  }
  return tls;
}

function singboxTransport(n: ProxyNode): Record<string, any> | undefined {
  const net = n.network || 'tcp';
  if (net === 'ws') {
    return { type: 'ws', path: n.path || '/', headers: n.host ? { Host: n.host } : undefined };
  }
  if (net === 'grpc') {
    return { type: 'grpc', service_name: n.serviceName || n.path || '' };
  }
  if (net === 'h2' || net === 'http') {
    return { type: 'http', path: n.path || '/', host: n.host ? [n.host] : undefined };
  }
  return undefined;
}

/** 生成 sing-box 的单个出站对象 */
export function buildSingboxOutbound(n: ProxyNode): Record<string, any> {
  const out: Record<string, any> = { type: '', tag: 'proxy' };
  const tls = singboxTls(n);
  const transport = singboxTransport(n);

  switch (n.protocol) {
    case 'vmess':
      out.type = 'vmess';
      Object.assign(out, {
        server: n.server,
        server_port: n.port,
        uuid: n.uuid,
        security: n.security || 'auto',
        alter_id: n.alterId ?? 0,
      });
      break;

    case 'vless':
      out.type = 'vless';
      Object.assign(out, {
        server: n.server,
        server_port: n.port,
        uuid: n.uuid,
        flow: n.flow || undefined,
      });
      break;

    case 'trojan':
      out.type = 'trojan';
      Object.assign(out, { server: n.server, server_port: n.port, password: n.password });
      break;

    case 'shadowsocks':
      out.type = 'shadowsocks';
      Object.assign(out, { server: n.server, server_port: n.port, method: n.method, password: n.password });
      break;

    case 'hysteria2':
      out.type = 'hysteria2';
      Object.assign(out, { server: n.server, server_port: n.port, password: n.password });
      if (n.obfs) {
        out.obfs = { type: n.obfs, password: n.obfsPassword || '' };
      }
      break;

    case 'tuic':
      out.type = 'tuic';
      Object.assign(out, {
        server: n.server,
        server_port: n.port,
        uuid: n.uuid,
        password: n.password,
        congestion_control: n.congestionControl || 'bbr',
      });
      break;

    case 'socks':
      out.type = 'socks';
      Object.assign(out, {
        server: n.server,
        server_port: n.port,
        version: '5',
        username: n.uuid || undefined,
        password: n.password || undefined,
      });
      break;

    case 'http':
      out.type = 'http';
      Object.assign(out, {
        server: n.server,
        server_port: n.port,
        username: n.uuid || undefined,
        password: n.password || undefined,
      });
      break;

    default:
      throw new Error(`sing-box 不支持协议: ${n.protocol}`);
  }

  if (tls) out.tls = tls;
  if (transport) out.transport = transport;
  return out;
}

/** 生成完整的 sing-box 配置 */
export function buildSingboxConfig(n: ProxyNode, localPort: number = DEFAULT_LOCAL_PORT): Record<string, any> {
  return {
    log: { level: 'warn', timestamp: true },
    inbounds: [
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: '127.0.0.1',
        listen_port: localPort,
        sniff: true,
        sniff_override_destination: false,
      },
    ],
    outbounds: [
      buildSingboxOutbound(n),
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
    ],
    route: {
      rules: [
        { ip_cidr: PRIVATE_CIDR, outbound: 'direct' },
        { domain_suffix: ['localhost'], outbound: 'direct' },
      ],
      final: 'proxy',
    },
  };
}
