/**
 * 弹幕：弹弹Play（dandanplay）兼容接口
 *
 * 说明：弹弹Play 的 v2 接口要求 AppId/AppSecret 签名，
 * 但市面上也有不少第三方兼容服务不校验签名。
 * 所以这里把「接口地址 + AppId/AppSecret」都做成可配置：
 *   - 留空 AppId 时按匿名方式请求（对兼容服务有效）
 *   - 填了就带上 X-AppId / X-Timestamp / X-Signature 三件套
 */

// ------------------------------------------------------------ 类型

export interface DanmakuItem {
  /** 出现时间（秒） */
  time: number;
  /** 内容 */
  text: string;
  /** 类型：0 滚动 1 顶部 2 底部 3 逆向 */
  mode: number;
  /** 颜色（十进制 RGB） */
  color: number;
  /** 字号 */
  size: number;
}

export interface DanmakuConfig {
  /** 接口基地址，默认官方 */
  endpoint: string;
  appId?: string;
  appSecret?: string;
  /** 透明度 0~1 */
  opacity: number;
  /** 字号缩放 */
  fontScale: number;
  /** 是否显示 */
  enabled: boolean;
}

export const DEFAULT_DANMAKU_CONFIG: DanmakuConfig = {
  endpoint: 'https://api.dandanplay.net',
  opacity: 0.9,
  fontScale: 1,
  enabled: true,
};

// ------------------------------------------------------------ 请求

/** base64(sha256(appId + timestamp + path + appSecret)) */
async function sign(appId: string, timestamp: number, path: string, appSecret: string): Promise<string> {
  const raw = `${appId}${timestamp}${path}${appSecret}`;
  const buf = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

async function apiGet(cfg: DanmakuConfig, path: string, query?: Record<string, string>): Promise<any> {
  const base = (cfg.endpoint || DEFAULT_DANMAKU_CONFIG.endpoint).replace(/\/+$/, '');
  const qs = query
    ? '?' +
      Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  const url = base + path + qs;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'myemby/1.0.2',
  };

  if (cfg.appId && cfg.appSecret) {
    const ts = Math.floor(Date.now() / 1000);
    headers['X-AppId'] = cfg.appId;
    headers['X-Timestamp'] = String(ts);
    headers['X-Signature'] = await sign(cfg.appId, ts, path, cfg.appSecret);
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`弹幕接口返回 ${res.status}`);
  return res.json();
}

/** 按关键词搜索剧集，返回 [{ animeTitle, episodeId, episodeTitle }] */
export async function searchEpisodes(cfg: DanmakuConfig, keyword: string) {
  const data = await apiGet(cfg, '/api/v2/search/episodes', { anime: keyword });
  const out: { animeTitle: string; episodeId: number; episodeTitle: string }[] = [];
  for (const anime of data?.animes || []) {
    for (const ep of anime?.episodes || []) {
      out.push({
        animeTitle: anime.animeTitle,
        episodeId: ep.episodeId,
        episodeTitle: ep.episodeTitle,
      });
    }
  }
  return out;
}

/** 拉取某一集的弹幕 */
export async function fetchComments(cfg: DanmakuConfig, episodeId: number): Promise<DanmakuItem[]> {
  const data = await apiGet(cfg, `/api/v2/comment/${episodeId}`, { withRelated: 'true', chConvert: '0' });
  const list: DanmakuItem[] = [];
  for (const c of data?.comments || []) {
    // 弹弹Play 的 p 字段格式：时间,模式,颜色,用户ID
    const p = String(c.p || '').split(',');
    const time = parseFloat(p[0]);
    if (!isFinite(time)) continue;
    list.push({
      time,
      text: String(c.m || ''),
      mode: parseInt(p[1] || '0', 10) || 0,
      color: parseInt(p[2] || '16777215', 10) || 0xffffff,
      size: 25,
    });
  }
  list.sort((a, b) => a.time - b.time);
  return list;
}

/**
 * 一键匹配：先用文件名/标题搜，再取第一条结果的全部弹幕。
 * 返回匹配到的剧集信息，方便界面上显示「已匹配到 xxx 第 x 集」。
 */
export async function autoMatch(cfg: DanmakuConfig, title: string, episodeHint?: number) {
  // 去掉常见的画质/番号后缀，提高匹配率
  const cleaned = title
    .replace(/\.(mp4|mkv|avi|mov|ts|m2ts|flv|webm)$/i, '')
    .replace(/[._]/g, ' ')
    .replace(/\b(1080p|720p|2160p|4k|bluray|web-?dl|hdtv|x264|x265|hevc|aac|hdr|remux)\b/gi, '')
    .trim();

  const eps = await searchEpisodes(cfg, cleaned || title);
  if (!eps.length) return null;

  // 若能识别集数，优先取对应集
  let picked = eps[0];
  if (episodeHint && eps.length >= episodeHint) {
    const byIndex = eps[episodeHint - 1];
    if (byIndex) picked = byIndex;
  }

  const comments = await fetchComments(cfg, picked.episodeId);
  return { ...picked, comments };
}
