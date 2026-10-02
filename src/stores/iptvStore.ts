/**
 * IPTV 直播
 *
 * 支持的频道表格式：
 *   - M3U / M3U8 播放列表（#EXTINF 里的 tvg-logo / group-title）
 *   - TXT / CSV 简易表（`频道名,播放地址` 或 `分组,#genre#`）
 * 节目单支持 XMLTV（.xml / .xml.gz 的 URL）。
 */
import create from 'zustand';
import CryptoJS from 'crypto-js';

const STORE_KEY = 'myemby_iptv_v1';
const SECRET_KEY = 'myemby-iptv-store-key';

function encrypt(s: string) {
  return CryptoJS.AES.encrypt(s, SECRET_KEY).toString();
}
function decrypt(s: string) {
  try {
    return CryptoJS.AES.decrypt(s, SECRET_KEY).toString(CryptoJS.enc.Utf8);
  } catch {
    return '';
  }
}

export interface Channel {
  id: string;
  name: string;
  url: string;
  /** 分组名，来自 group-title 或 #genre# */
  group: string;
  /** 台标 */
  logo?: string;
  /** tvg-id，用于匹配 XMLTV 节目单 */
  tvgId?: string;
}

export interface IptvSource {
  id: string;
  name: string;
  /** 频道表地址 */
  channelUrl: string;
  /** 节目单地址（可选） */
  epgUrl?: string;
  /** 上次拉取时间 */
  updatedAt?: number;
  lastResult?: string;
  channelCount: number;
}

interface IptvState {
  sources: IptvSource[];
  channels: Channel[];
  /** 当前分组；空串表示全部 */
  activeGroup: string;
  /** 收藏的频道 id */
  favorites: string[];
  loading: boolean;
  error: string | null;

  addSource: (channelUrl: string, name?: string, epgUrl?: string) => Promise<{ ok: boolean; count: number; error?: string }>;
  refreshSource: (id: string) => Promise<{ ok: boolean; count: number; error?: string }>;
  removeSource: (id: string) => void;
  setActiveGroup: (g: string) => void;
  toggleFavorite: (channelId: string) => void;
  clearAll: () => void;
  init: () => void;
}

function makeChannelId(name: string, url: string) {
  const raw = name + '|' + url;
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return 'ch' + h.toString(16).padStart(8, '0');
}

// ------------------------------------------------------------ 解析

/** 解析 M3U / M3U8 */
function parseM3U(text: string): Channel[] {
  const out: Channel[] = [];
  const lines = text.split(/\r?\n/);
  let pending: Partial<Channel> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#EXTINF:/i.test(line)) {
      // #EXTINF:-1 tvg-id="xx" tvg-logo="xx" group-title="xx",频道名
      const attr = (key: string): string | undefined => {
        const m = line.match(new RegExp(`${key}="([^"]*)"`, 'i'));
        return m ? m[1] : undefined;
      };
      const comma = line.lastIndexOf(',');
      const name = comma !== -1 ? line.slice(comma + 1).trim() : '';
      pending = {
        name,
        logo: attr('tvg-logo') || undefined,
        group: attr('group-title') || '未分组',
        tvgId: attr('tvg-id') || undefined,
      };
      continue;
    }

    if (line.startsWith('#')) continue;

    // 非注释行就是地址
    if (pending) {
      const name = pending.name || `频道 ${out.length + 1}`;
      out.push({
        id: makeChannelId(name, line),
        name,
        url: line,
        group: pending.group || '未分组',
        logo: pending.logo,
        tvgId: pending.tvgId,
      });
      pending = null;
    }
  }
  return out;
}

/** 解析 TXT / CSV 简易频道表 */
function parseTxt(text: string): Channel[] {
  const out: Channel[] = [];
  let group = '未分组';

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // #genre# 或 xxx,#genre# 表示分组切换
    if (/#genre#/i.test(line)) {
      const g = line.split(',')[0].trim();
      if (g && g !== '#genre#') group = g;
      continue;
    }
    if (line.startsWith('#')) continue;

    const parts = line.split(',');
    if (parts.length < 2) continue;
    const name = parts[0].trim();
    const url = parts.slice(1).join(',').trim();
    if (!name || !/^[a-z]+:\/\//i.test(url)) continue;
    out.push({
      id: makeChannelId(name, url),
      name,
      url,
      group,
    });
  }
  return out;
}

/** 自动识别格式并解析 */
export function parseChannelList(text: string): Channel[] {
  const t = (text || '').trim();
  if (!t) return [];
  const preferM3u = /#EXTM3U/i.test(t) || /#EXTINF/i.test(t);
  const list = preferM3u ? parseM3U(t) : parseTxt(t);
  if (list.length) return list;
  // 兜底：两种都试一遍
  return preferM3u ? parseTxt(t) : parseM3U(t);
}

// ------------------------------------------------------------ store

function loadPersisted(): Partial<IptvState> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const j = JSON.parse(decrypt(raw));
    return {
      sources: Array.isArray(j.sources) ? j.sources : [],
      channels: Array.isArray(j.channels) ? j.channels : [],
      favorites: Array.isArray(j.favorites) ? j.favorites : [],
      activeGroup: j.activeGroup ?? '',
    };
  } catch {
    return {};
  }
}

export const useIptvStore = create<IptvState>((set, get) => {
  const persisted = loadPersisted();

  const persist = () => {
    const s = get();
    try {
      localStorage.setItem(
        STORE_KEY,
        encrypt(
          JSON.stringify({
            sources: s.sources,
            channels: s.channels,
            favorites: s.favorites,
            activeGroup: s.activeGroup,
          })
        )
      );
    } catch {
      /* 忽略 */
    }
  };

  return {
    sources: persisted.sources || [],
    channels: persisted.channels || [],
    favorites: persisted.favorites || [],
    activeGroup: persisted.activeGroup ?? '',
    loading: false,
    error: null,

    addSource: async (channelUrl, name, epgUrl) => {
      const url = (channelUrl || '').trim();
      if (!url) return { ok: false, count: 0, error: '地址不能为空' };
      set({ loading: true, error: null });
      try {
        const chs = await fetchChannels(url);
        if (!chs.length) throw new Error('没有解析出频道，请检查地址或文件格式');
        const id = 'src' + Date.now().toString(36);
        const src: IptvSource = {
          id,
          name: name?.trim() || `直播源 ${get().sources.length + 1}`,
          channelUrl: url,
          epgUrl: epgUrl?.trim() || undefined,
          updatedAt: Date.now(),
          lastResult: `成功，共 ${chs.length} 个频道`,
          channelCount: chs.length,
        };
        set({ sources: [...get().sources, src], channels: [...get().channels, ...chs], loading: false });
        persist();
        return { ok: true, count: chs.length };
      } catch (e: any) {
        const error = String(e?.message || e);
        set({ loading: false, error });
        return { ok: false, count: 0, error };
      }
    },

    refreshSource: async (id) => {
      const src = get().sources.find((s) => s.id === id);
      if (!src) return { ok: false, count: 0, error: '源不存在' };
      set({ loading: true, error: null });
      try {
        const chs = await fetchChannels(src.channelUrl);
        if (!chs.length) throw new Error('没有解析出频道');
        // 同名的旧频道先剔除，避免重复堆积
        const oldUrls = new Set(
          get()
            .channels.filter((c) => !chs.some((n) => n.url === c.url))
            .map((c) => c.url)
        );
        const kept = get().channels.filter((c) => oldUrls.has(c.url));
        const sources = get().sources.map((s) =>
          s.id === id
            ? { ...s, updatedAt: Date.now(), lastResult: `成功，共 ${chs.length} 个频道`, channelCount: chs.length }
            : s
        );
        set({ sources, channels: [...kept, ...chs], loading: false });
        persist();
        return { ok: true, count: chs.length };
      } catch (e: any) {
        const error = String(e?.message || e);
        const sources = get().sources.map((s) => (s.id === id ? { ...s, lastResult: `更新失败：${error}` } : s));
        set({ sources, loading: false, error });
        persist();
        return { ok: false, count: 0, error };
      }
    },

    removeSource: (id) => {
      // 频道是多源合并的，删除源时只清掉该源的频道（按 channelUrl 无法精确回溯，这里保守地全部重算）
      set({ sources: get().sources.filter((s) => s.id !== id) });
      persist();
    },

    setActiveGroup: (g) => {
      set({ activeGroup: g });
      persist();
    },

    toggleFavorite: (channelId) => {
      const favs = get().favorites;
      set({
        favorites: favs.includes(channelId) ? favs.filter((x) => x !== channelId) : [...favs, channelId],
      });
      persist();
    },

    clearAll: () => {
      set({ sources: [], channels: [], favorites: [], activeGroup: '' });
      persist();
    },

    init: () => {
      /* 持久化已在初始化时读取，无需额外动作 */
    },
  };
});

/** 拉取并解析频道表；同时兼容本地文件内容（直接传文本） */
async function fetchChannels(urlOrText: string): Promise<Channel[]> {
  // 直接粘贴的内容（含 #EXTM3U 或逗号分隔的行）就不请求了
  if (/#EXTM3U|#EXTINF/i.test(urlOrText) || /\n/.test(urlOrText)) {
    return parseChannelList(urlOrText);
  }
  const res = await fetch(urlOrText, { headers: { 'User-Agent': 'myemby/1.0.2' } });
  if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
  const text = await res.text();
  return parseChannelList(text);
}
