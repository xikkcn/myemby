import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 手机端播放手势层
 *
 * 覆盖在视频画面上，拦截触摸事件实现：
 *   - 双击左/右半边：后退 / 前进 10 秒
 *   - 单击：切换播放/暂停
 *   - 左右滑动：拖动进度（按屏幕宽度换算比例）
 *   - 上下滑动：左侧调亮度、右侧调音量
 *
 * 只在触摸设备上挂载（由调用方判断），桌面端不引入任何额外行为。
 */

interface Props {
  /** 目标容器选择器，触摸事件挂到它上面 */
  selector: string;
  /** 取视频总时长（秒），未知返回 0 */
  getDuration: () => number;
  getTime: () => number;
  /** 拖动进度到指定秒 */
  onSeek: (seconds: number) => void;
  onTogglePlay: () => void;
  /** 设置音量（0~1 绝对值） */
  onVolume: (value: number) => void;
}

const STEP = 10; // 双击快进/快退秒数
const SWIPE_RANGE = 240; // 上下滑动多少像素对应满量程

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const PlayerGestures: React.FC<Props> = ({
  selector,
  getDuration,
  getTime,
  onSeek,
  onTogglePlay,
  onVolume,
}) => {
  const [toast, setToast] = useState<string | null>(null);
  const [maskOpacity, setMaskOpacity] = useState(0);
  // 遮罩与提示必须挂在视频容器内部，否则 absolute 定位会跑到视口上，把整页压黑
  const [host, setHost] = useState<HTMLElement | null>(null);

  const toastTimer = useRef<number>();
  const lastTap = useRef(0);
  const tapTimer = useRef<number>();
  const brightness = useRef(1);
  const volume = useRef(0.5);

  // 最新的 props 存到 ref，避免手势监听因依赖变化被反复重建
  const propsRef = useRef({ getDuration, getTime, onSeek, onTogglePlay, onVolume });
  propsRef.current = { getDuration, getTime, onSeek, onTogglePlay, onVolume };

  const flash = (text: string) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 700);
  };

  useEffect(() => {
    setHost(document.querySelector(selector) as HTMLElement | null);
  }, [selector]);

  useEffect(() => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let startVolume = 0.5;
    let startBrightness = 1;
    let moved = false;
    let ignore = false;
    let mode: 'none' | 'seek' | 'volume' | 'brightness' = 'none';

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      // 落在播放器控件 / 按钮 / 弹幕开关上的触摸交给控件自己处理，不当作手势
      const target = e.target as HTMLElement | null;
      ignore = !!target?.closest(
        '.vjs-control-bar, .ant-btn, .ant-slider, .ant-switch, button, a, input, [data-no-gesture]'
      );
      if (ignore) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTime = propsRef.current.getTime();
      startVolume = volume.current;
      startBrightness = brightness.current;
      moved = false;
      mode = 'none';
    };

    const onMove = (e: TouchEvent) => {
      if (ignore || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!moved && Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      moved = true;

      // 手势方向在第一次有效移动时确定，之后不再改变
      if (mode === 'none') {
        mode =
          Math.abs(dx) > Math.abs(dy)
            ? 'seek'
            : startX < window.innerWidth / 2
            ? 'brightness'
            : 'volume';
      }

      const dur = propsRef.current.getDuration();

      if (mode === 'seek') {
        if (dur <= 0) return;
        const target = Math.max(0, Math.min(dur, startTime + (dx / window.innerWidth) * dur));
        propsRef.current.onSeek(target);
        flash(`${formatTime(target)} / ${formatTime(dur)}`);
      } else if (mode === 'volume') {
        const next = Math.min(1, Math.max(0, startVolume - dy / SWIPE_RANGE));
        volume.current = next;
        propsRef.current.onVolume(next);
        flash(`音量 ${Math.round(next * 100)}%`);
      } else {
        const next = Math.min(1, Math.max(0.15, startBrightness - dy / SWIPE_RANGE));
        brightness.current = next;
        setMaskOpacity(1 - next);
        flash(`亮度 ${Math.round(next * 100)}%`);
      }
    };

    const onEnd = () => {
      if (ignore) {
        ignore = false;
        return;
      }
      if (!moved) {
        const now = Date.now();
        if (now - lastTap.current < 300) {
          // 双击：左退右进
          if (tapTimer.current) window.clearTimeout(tapTimer.current);
          lastTap.current = 0;
          const dur = propsRef.current.getDuration();
          const cur = propsRef.current.getTime();
          const target = startX < window.innerWidth / 2 ? cur - STEP : cur + STEP;
          propsRef.current.onSeek(Math.max(0, dur > 0 ? Math.min(dur, target) : target));
          flash(startX < window.innerWidth / 2 ? `« ${STEP} 秒` : `${STEP} 秒 »`);
        } else {
          lastTap.current = now;
          // 延迟确认单击，给双击留出判定窗口
          tapTimer.current = window.setTimeout(() => {
            propsRef.current.onTogglePlay();
          }, 300);
        }
      }
      mode = 'none';
      moved = false;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
    };
  }, [selector]);

  // 跟随真实音量，让手势从当前值继续
  useEffect(() => {
    const host = document.querySelector(selector) as HTMLElement | null;
    const video = host?.querySelector('video') as HTMLVideoElement | null;
    if (!video) return;
    const sync = () => {
      volume.current = video.volume;
    };
    sync();
    const timer = window.setInterval(sync, 400);
    return () => window.clearInterval(timer);
  }, [selector]);

  if (!host) return null;

  return createPortal(
    <>
      {/* 亮度遮罩：叠在画面上，不拦截交互 */}
      <div className="player-brightness-mask" style={{ opacity: maskOpacity }} />
      {toast && <div className="player-gesture-toast">{toast}</div>}
    </>,
    host
  );
};

export default PlayerGestures;
