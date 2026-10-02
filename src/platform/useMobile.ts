/**
 * 移动端布局判定
 *
 * 手机上要彻底换一套骨架：隐藏侧边栏、顶栏精简、底部加导航。
 * 电视端走自己的那套（大字号 + 焦点环），不算移动端。
 */
import { useEffect, useState } from 'react';
import { isTVMode } from './index';

/** 窄屏阈值：小于它按手机布局渲染 */
export const MOBILE_BREAKPOINT = 768;

export function checkIsMobile(): boolean {
  if (typeof window === 'undefined') return false;
  if (isTVMode()) return false; // 电视端单独处理
  const w = window.innerWidth || document.documentElement.clientWidth || 0;
  return w > 0 && w < MOBILE_BREAKPOINT;
}

/** React Hook：跟随窗口尺寸变化实时切换 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(() => checkIsMobile());

  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      // 手机上旋转屏幕会高频触发，做个节流
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setMobile(checkIsMobile()), 120);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    // 首次挂载后再校一次，避免 SSR/初次渲染取不到宽度
    onResize();
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return mobile;
}
