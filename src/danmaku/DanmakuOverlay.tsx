import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DanmakuLayer from './DanmakuLayer';
import { useDanmakuStore } from './store';
import './danmaku.scss';

interface Props {
  /** 取当前播放时间（秒） */
  getTime: () => number;
  /** 是否正在播放 */
  playing: boolean;
  /** 弹幕挂载到的容器选择器，默认挂到 video.js 的容器里 */
  selector?: string;
  /** 影片/剧集标题：给了就自动去匹配弹幕 */
  title?: string;
  /** 第几集，用于在同名剧集里挑选 */
  episodeHint?: number;
}

/**
 * 把弹幕画布挂进播放器容器。
 *
 * video.js 的 DOM 是命令式生成并会重绘的，所以这里用 MutationObserver 盯着，
 * 一旦容器出现/重建就把 canvas 重新挂上去。
 */
const DanmakuOverlay: React.FC<Props> = ({ getTime, playing, selector = '.video-js', title, episodeHint }) => {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const config = useDanmakuStore((s) => s.config);
  const items = useDanmakuStore((s) => s.items);
  const loadFor = useDanmakuStore((s) => s.loadFor);
  const clear = useDanmakuStore((s) => s.clear);

  // 标题就绪后自动匹配弹幕（同一个标题只拉一次）
  const loadedRef = useRef<string>('');
  useEffect(() => {
    if (!config.enabled || !title) return;
    const key = `${title}#${episodeHint ?? ''}`;
    if (loadedRef.current === key) return;
    loadedRef.current = key;
    clear();
    loadFor(title, episodeHint);
  }, [title, episodeHint, config.enabled, loadFor, clear]);

  useEffect(() => {
    let mo: MutationObserver | null = null;

    const attach = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) {
        // 让 canvas 能相对它定位
        if (getComputedStyle(el).position === 'static') {
          el.style.position = 'relative';
        }
        setContainer(el);
        return true;
      }
      return false;
    };

    if (!attach()) {
      // 容器还没出来，等 DOM 变化
      mo = new MutationObserver(() => {
        if (attach() && mo) {
          mo.disconnect();
          mo = null;
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      if (mo) mo.disconnect();
    };
  }, [selector]);

  if (!container || !config.enabled) return null;

  return createPortal(
    <DanmakuLayer items={items} getTime={getTime} playing={playing} config={config} />,
    container
  );
};

export default DanmakuOverlay;
