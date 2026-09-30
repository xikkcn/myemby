/**
 * 运行环境识别：Electron 桌面端 / 安卓（手机、TV）/ 网页端
 * 以及「电视模式」的判定。
 *
 * 电视模式会做三件事：开启方向键空间导航、放大字号与焦点环、隐藏鼠标相关交互。
 * 判定优先顺序：URL 参数 > 本地设置 > 自动识别
 */

export type Platform = 'electron' | 'android' | 'web';

const TV_STORAGE_KEY = 'myemby_tv_mode';

export function getPlatform(): Platform {
  if (typeof window === 'undefined') return 'web';
  if (window.electronAPI?.isElectron) return 'electron';
  if (window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform?.() === 'android') {
    return 'android';
  }
  return 'web';
}

export const isElectron = () => getPlatform() === 'electron';
export const isAndroid = () => getPlatform() === 'android';
export const isWeb = () => getPlatform() === 'web';

/** 从 URL 上读取强制开关，例如 index.html?tv=1 */
function urlTvOverride(): boolean | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const v = q.get('tv');
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
    // hash 路由下也可能带参数： #/settings?tv=1
    const hv = window.location.hash.split('?')[1];
    if (hv) {
      const hq = new URLSearchParams(hv);
      const h = hq.get('tv');
      if (h === '1' || h === 'true') return true;
      if (h === '0' || h === 'false') return false;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function storedTvChoice(): boolean | null {
  try {
    const v = localStorage.getItem(TV_STORAGE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 自动识别电视：安卓设备 + 没有触摸屏 + 屏幕较大。
 * 电视盒子/电视大多没有触摸屏，而手机和平板一定有。
 */
function autoDetectTv(): boolean {
  if (!isAndroid()) return false;
  const noTouch = (navigator.maxTouchPoints ?? 0) === 0;
  const minSide = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0);
  const bigScreen = minSide >= 540;
  return noTouch && bigScreen;
}

let cached: boolean | null = null;

export function isTVMode(): boolean {
  if (cached !== null) return cached;
  const forced = urlTvOverride();
  if (forced !== null) {
    cached = forced;
    return cached;
  }
  const stored = storedTvChoice();
  if (stored !== null) {
    cached = stored;
    return cached;
  }
  cached = autoDetectTv();
  return cached;
}

/** 在设置页手动切换电视模式（需要重启界面生效，这里直接刷新） */
export function setTVMode(on: boolean) {
  try {
    localStorage.setItem(TV_STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  cached = on;
  window.location.reload();
}

/** 当前是否处于「自动识别为电视」的状态（用于设置页展示提示） */
export function isTVAutoDetected() {
  return urlTvOverride() === null && storedTvChoice() === null && autoDetectTv();
}

/** 当前是否是手机/平板等触摸设备 */
export function isTouchDevice() {
  return (navigator.maxTouchPoints ?? 0) > 0;
}
