/**
 * 文件源：WebDAV / Alist / 飞牛 fnOS 的 WebDAV 入口
 *
 * 用标准的 WebDAV 协议（PROPFIND 列目录、GET 取文件），
 * 因此 Alist、Nextcloud、群晖、飞牛等只要开了 WebDAV 都能接。
 */
import create from 'zustand';
import CryptoJS from 'crypto-js';

const STORE_KEY = 'myemby_files_v1';
const SECRET_KEY = 'myemby-files-store-key';

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

export interface FileSource {
  id: string;
  name: string;
  /** WebDAV 根地址，例如 https://dav.example.com/dav */
  url: string;
  username?: string;
  password?: string;
  createdAt: number;
  lastResult?: string;
}

export interface DavEntry {
  /** 完整 URL */
  url: string;
  /** 文件名 */
  name: string;
  /** 相对根的路径 */
  path: string;
  isDir: boolean;
  size?: number;
  modified?: string;
  /** 是否是可播放的视频 */
  playable?: boolean;
}

const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m2ts|m4v|rmvb|mpg|mpeg|3gp)$/i;
const AUDIO_EXT = /\.(mp3|flac|wav|aac|m4a|ogg|wma|ape)$/i;

interface FileState {
  sources: FileSource[];
  activeSourceId: string | null;
  /** 当前所在路径（相对根） */
  currentPath: string;
  entries: DavEntry[];
  loading: boolean;
  error: string | null;

  addSource: (url: string, name?: string, username?: string, password?: string) => Promise<{ ok: boolean; error?: string }>;
  removeSource: (id: string) => void;
  setActiveSource: (id: string | null) => void;
  browse: (path?: string) => Promise<void>;
  setError: (e: string | null) => void;
}

// ------------------------------------------------------------ WebDAV

function authHeader(src: FileSource): Record<string, string> {
  if (!src.username) return {};
  // btoa 只支持 latin1，中文用户名先做 UTF-8 编码
  const raw = `${src.username}:${src.password || ''}`;
  const bytes = new TextEncoder().encode(raw);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return { Authorization: 'Basic ' + btoa(bin) };
}

function joinUrl(base: string, p: string): string {
  const b = base.replace(/\/+$/, '');
  const path = (p || '').replace(/^\/+/, '');
  return path ? `${b}/${path.split('/').map(encodeURIComponent).join('/')}` : b;
}

/** 把 WebDAV 返回的 href 转成相对根的路径 */
function hrefToPath(href: string, base: string): string {
  let h = decodeURIComponent(href);
  try {
    const u = new URL(href, base);
    h = decodeURIComponent(u.pathname);
    const basePath = decodeURIComponent(new URL(base).pathname).replace(/\/+$/, '');
    if (basePath && h.startsWith(basePath)) h = h.slice(basePath.length);
  } catch {
    /* 保持原样 */
  }
  return h.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** PROPFIND 列目录 */
async function propfind(src: FileSource, path: string): Promise<DavEntry[]> {
  const target = joinUrl(src.url, path);
  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

  const res = await fetch(target, {
    method: 'PROPFIND',
    headers: {
      ...authHeader(src),
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body,
  });

  if (res.status === 401) throw new Error('认证失败，请检查用户名或密码');
  if (res.status === 404) throw new Error('路径不存在');
  if (!res.ok) throw new Error(`服务器返回 ${res.status}`);

  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const responses = Array.from(doc.getElementsByTagNameNS('DAV:', 'response'));

  const out: DavEntry[] = [];
  const selfPath = path.replace(/^\/+|\/+$/g, '');

  for (const r of responses) {
    const hrefEl = r.getElementsByTagNameNS('DAV:', 'href')[0];
    if (!hrefEl?.textContent) continue;
    const rel = hrefToPath(hrefEl.textContent, src.url);
    if (rel === selfPath) continue; // 跳过目录自身

    const isDir = r.getElementsByTagNameNS('DAV:', 'collection').length > 0;
    const name = rel.split('/').filter(Boolean).pop() || rel;
    const sizeEl = r.getElementsByTagNameNS('DAV:', 'getcontentlength')[0];
    const modEl = r.getElementsByTagNameNS('DAV:', 'getlastmodified')[0];

    out.push({
      url: joinUrl(src.url, rel),
      name,
      path: rel,
      isDir,
      size: sizeEl?.textContent ? parseInt(sizeEl.textContent, 10) : undefined,
      modified: modEl?.textContent || undefined,
      playable: !isDir && (VIDEO_EXT.test(name) || AUDIO_EXT.test(name)),
    });
  }

  // 目录在前，同类按名称排序
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  return out;
}

// ------------------------------------------------------------ store

function loadPersisted(): Partial<FileState> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const j = JSON.parse(decrypt(raw));
    return {
      sources: Array.isArray(j.sources) ? j.sources : [],
      activeSourceId: j.activeSourceId ?? null,
    };
  } catch {
    return {};
  }
}

export const useFileStore = create<FileState>((set, get) => {
  const persisted = loadPersisted();

  const persist = () => {
    const s = get();
    try {
      localStorage.setItem(
        STORE_KEY,
        encrypt(JSON.stringify({ sources: s.sources, activeSourceId: s.activeSourceId }))
      );
    } catch {
      /* 忽略 */
    }
  };

  return {
    sources: persisted.sources || [],
    activeSourceId: persisted.activeSourceId ?? null,
    currentPath: '',
    entries: [],
    loading: false,
    error: null,

    addSource: async (url, name, username, password) => {
      const u = (url || '').trim();
      if (!u) return { ok: false, error: '地址不能为空' };
      if (!/^https?:\/\//i.test(u)) return { ok: false, error: '地址需要以 http:// 或 https:// 开头' };

      const src: FileSource = {
        id: 'fs' + Date.now().toString(36),
        name: name?.trim() || `文件源 ${get().sources.length + 1}`,
        url: u.replace(/\/+$/, ''),
        username: username?.trim() || undefined,
        password: password || undefined,
        createdAt: Date.now(),
      };

      // 先试连一次，连不上就不保存
      set({ loading: true, error: null });
      try {
        const list = await propfind(src, '');
        src.lastResult = `连接成功，${list.length} 项`;
        set({
          sources: [...get().sources, src],
          activeSourceId: src.id,
          entries: list,
          currentPath: '',
          loading: false,
        });
        persist();
        return { ok: true };
      } catch (e: any) {
        const error = String(e?.message || e);
        set({ loading: false, error });
        return { ok: false, error };
      }
    },

    removeSource: (id) => {
      const rest = get().sources.filter((s) => s.id !== id);
      set({
        sources: rest,
        activeSourceId: get().activeSourceId === id ? null : get().activeSourceId,
        entries: get().activeSourceId === id ? [] : get().entries,
      });
      persist();
    },

    setActiveSource: (id) => {
      set({ activeSourceId: id, currentPath: '', entries: [] });
      persist();
      if (id) get().browse('');
    },

    browse: async (path) => {
      const src = get().sources.find((s) => s.id === get().activeSourceId);
      if (!src) return;
      const target = path ?? '';
      set({ loading: true, error: null });
      try {
        const list = await propfind(src, target);
        set({ entries: list, currentPath: target, loading: false });
      } catch (e: any) {
        set({ loading: false, error: String(e?.message || e) });
      }
    },

    setError: (e) => set({ error: e }),
  };
});

export const isVideoFile = (name: string) => VIDEO_EXT.test(name);
export const isAudioFile = (name: string) => AUDIO_EXT.test(name);
export { propfind };
