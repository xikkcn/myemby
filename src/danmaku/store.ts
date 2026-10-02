/**
 * 弹幕设置与数据状态
 */
import create from 'zustand';
import CryptoJS from 'crypto-js';
import {
  DanmakuConfig,
  DanmakuItem,
  DEFAULT_DANMAKU_CONFIG,
  autoMatch,
} from './provider';

const STORE_KEY = 'myemby_danmaku_v1';
const SECRET_KEY = 'myemby-danmaku-key';

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

interface DanmakuState {
  config: DanmakuConfig;
  /** 当前已加载的弹幕 */
  items: DanmakuItem[];
  /** 匹配到的剧集说明 */
  matched: string | null;
  loading: boolean;
  error: string | null;

  setConfig: (patch: Partial<DanmakuConfig>) => void;
  /** 按标题自动匹配并拉取弹幕 */
  loadFor: (title: string, episodeHint?: number) => Promise<{ ok: boolean; count: number; matched?: string; error?: string }>;
  clear: () => void;
}

function loadPersisted(): DanmakuConfig {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_DANMAKU_CONFIG };
    const j = JSON.parse(decrypt(raw));
    return { ...DEFAULT_DANMAKU_CONFIG, ...j };
  } catch {
    return { ...DEFAULT_DANMAKU_CONFIG };
  }
}

export const useDanmakuStore = create<DanmakuState>((set, get) => {
  const persist = (cfg: DanmakuConfig) => {
    try {
      localStorage.setItem(STORE_KEY, encrypt(JSON.stringify(cfg)));
    } catch {
      /* 忽略 */
    }
  };

  return {
    config: loadPersisted(),
    items: [],
    matched: null,
    loading: false,
    error: null,

    setConfig: (patch) => {
      const cfg = { ...get().config, ...patch };
      set({ config: cfg });
      persist(cfg);
    },

    loadFor: async (title, episodeHint) => {
      const cfg = get().config;
      if (!cfg.enabled) return { ok: false, count: 0, error: '弹幕已关闭' };
      set({ loading: true, error: null });
      try {
        const r = await autoMatch(cfg, title, episodeHint);
        if (!r) {
          set({ loading: false, items: [], matched: null, error: '没有匹配到弹幕' });
          return { ok: false, count: 0, error: '没有匹配到弹幕' };
        }
        const label = `${r.animeTitle} · ${r.episodeTitle}`;
        set({ items: r.comments, matched: label, loading: false });
        return { ok: true, count: r.comments.length, matched: label };
      } catch (e: any) {
        const error = String(e?.message || e);
        set({ loading: false, error, items: [] });
        return { ok: false, count: 0, error };
      }
    },

    clear: () => set({ items: [], matched: null, error: null }),
  };
});
