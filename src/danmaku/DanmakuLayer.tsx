import React, { useEffect, useRef } from 'react';
import { DanmakuItem, DanmakuConfig } from './provider';

interface Props {
  /** 弹幕数据 */
  items: DanmakuItem[];
  /** 取当前播放时间（秒）的函数，每帧调用 */
  getTime: () => number;
  /** 播放器是否在播放；暂停时弹幕也停住 */
  playing: boolean;
  config: DanmakuConfig;
}

interface ActiveItem {
  item: DanmakuItem;
  /** 进入屏幕的时间（秒，按视频时间轴） */
  startAt: number;
  /** 分配到的轨道 */
  lane: number;
  /** 该弹幕在屏幕上停留的时长（秒） */
  duration: number;
  width: number;
}

/**
 * Canvas 弹幕层
 *
 * 直接盖在 video 上，用 requestAnimationFrame 跟随播放时间绘制。
 * 不依赖任何弹幕库，逻辑也保持简单：滚动弹幕按轨道排布，顶部/底部居中。
 */
const DanmakuLayer: React.FC<Props> = ({ items, getTime, playing, config }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    active: [] as ActiveItem[],
    cursor: 0, // items 里的下一个待出场索引
    lanes: [] as number[], // 每条轨道上「最后一条弹幕的离开时间」，用于避让
    lastTime: -1,
  });

  // 数据换了就重置
  useEffect(() => {
    stateRef.current.active = [];
    stateRef.current.cursor = 0;
    stateRef.current.lanes = [];
    stateRef.current.lastTime = -1;
  }, [items]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;

    // 适配高分屏
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const FONT_SIZE = 24;
    const LANE_HEIGHT = FONT_SIZE + 10;
    const SCROLL_DURATION = 9; // 秒，一条滚动弹幕横穿屏幕的时间
    const STATIC_DURATION = 4; // 秒，顶部/底部弹幕停留时间

    const render = () => {
      raf = requestAnimationFrame(render);
      if (!config.enabled) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;

      const now = getTime();
      const st = stateRef.current;

      // 视频往回跳（或首次）时重置
      if (now < st.lastTime - 0.5 || st.lastTime < 0) {
        st.active = [];
        st.cursor = 0;
        st.lanes = [];
        // 定位到当前时间之后第一条
        st.cursor = items.findIndex((it) => it.time >= now);
        if (st.cursor === -1) st.cursor = items.length;
      }
      st.lastTime = now;

      // 把到时间的弹幕取出来
      while (st.cursor < items.length && items[st.cursor].time <= now) {
        const it = items[st.cursor++];
        // 太旧的（比如快进过去的）直接丢
        if (now - it.time > 1.5) continue;

        ctx.font = `${FONT_SIZE * config.fontScale}px "PingFang SC","Microsoft YaHei",sans-serif`;
        const width = ctx.measureText(it.text).width;

        if (it.mode === 1 || it.mode === 2) {
          st.active.push({ item: it, startAt: it.time, lane: it.mode === 1 ? 0 : 99, duration: STATIC_DURATION, width });
        } else {
          // 找一条空着的轨道
          const laneCount = Math.max(1, Math.floor(H / LANE_HEIGHT));
          let lane = -1;
          for (let i = 0; i < laneCount; i++) {
            const freeAt = st.lanes[i] ?? -1e9;
            // 上一条已经完全进入屏幕，且当前时间够它走完
            if (freeAt <= it.time) {
              lane = i;
              break;
            }
          }
          if (lane === -1) lane = 0; // 轨道满了就叠在第一行
          st.lanes[lane] = it.time + SCROLL_DURATION * 0.35;
          st.active.push({ item: it, startAt: it.time, lane, duration: SCROLL_DURATION, width });
        }
      }

      ctx.clearRect(0, 0, W, H);

      const active: ActiveItem[] = [];
      for (const a of st.active) {
        const elapsed = now - a.startAt;
        if (elapsed < 0) {
          active.push(a);
          continue;
        }
        if (elapsed > a.duration + 0.1) continue; // 已离场
        active.push(a);

        const fs = FONT_SIZE * config.fontScale;
        ctx.font = `${fs}px "PingFang SC","Microsoft YaHei",sans-serif`;
        ctx.globalAlpha = Math.max(0, Math.min(1, config.opacity));

        // 描边让浅色背景上也能看清
        const drawText = (x: number, y: number) => {
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.72)';
          ctx.strokeText(a.item.text, x, y);
          ctx.fillStyle = `#${(a.item.color >>> 0).toString(16).padStart(6, '0')}`;
          ctx.fillText(a.item.text, x, y);
        };

        if (a.item.mode === 1) {
          // 顶部
          const x = (W - a.width) / 2;
          drawText(x, fs + 8);
        } else if (a.item.mode === 2) {
          // 底部
          const x = (W - a.width) / 2;
          drawText(x, H - 12);
        } else {
          // 滚动
          const progress = elapsed / a.duration;
          const x = W - progress * (W + a.width);
          const y = a.lane * LANE_HEIGHT + fs + 6;
          drawText(x, y);
        }
      }
      ctx.globalAlpha = 1;
      st.active = active;
    };

    // 暂停时仍然重绘（保证尺寸变化/开关能即时生效），但时间不前进，弹幕自然停住
    if (playing) {
      raf = requestAnimationFrame(render);
    } else {
      render();
      cancelAnimationFrame(raf);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [items, playing, config, getTime]);

  return <canvas ref={canvasRef} className="danmaku-canvas" />;
};

export default DanmakuLayer;
