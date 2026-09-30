/**
 * 电视端方向键（D-pad）空间导航。
 *
 * 浏览器/WebView 里方向键默认不会移动焦点，这里按几何位置自己算：
 * 从当前焦点元素出发，在指定方向上找「最近且在视觉上最正对」的可聚焦元素。
 *
 * 同时接管返回键：安卓 TV 遥控器的返回键会派发成 Escape 或浏览器后退。
 */

/** 参与导航的元素 */
const FOCUS_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '.ant-card',
  '.ant-menu-item',
  '.ant-dropdown-menu-item',
  '.ant-select-selector',
  '.ant-switch',
].join(',');

const NATIVELY_FOCUSABLE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/;

function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
  return true;
}

function ensureFocusable(el: HTMLElement) {
  if (!NATIVELY_FOCUSABLE.test(el.tagName) && el.tabIndex < 0) {
    // 让卡片这类元素可以程序化获得焦点
    el.tabIndex = -1;
    el.setAttribute('data-nav-focusable', '1');
  }
}

function focusables(): HTMLElement[] {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(FOCUS_SELECTOR));
  return nodes.filter((el) => {
    // 弹层打开时，只在其内部导航，避免焦点跑到被遮住的页面上
    if (el.closest('[aria-hidden="true"]')) return false;
    return isVisible(el);
  });
}

function center(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

type Dir = 'up' | 'down' | 'left' | 'right';

function findNext(current: HTMLElement, dir: Dir, all: HTMLElement[]): HTMLElement | null {
  const cr = current.getBoundingClientRect();
  const c = center(cr);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of all) {
    if (el === current) continue;
    // 忽略当前元素的祖先/后代，避免在同一条链上跳
    if (el.contains(current) || current.contains(el)) continue;

    const r = el.getBoundingClientRect();
    const p = center(r);
    const dx = p.x - c.x;
    const dy = p.y - c.y;

    // 主方向必须确实在该方向上
    const primary = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    if (primary <= 1) continue;

    // 垂直方向上的偏移（越对齐越好）
    const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);

    // 目标在主轴上明显重叠时，认为是「同一行/列」，给很大加权
    const overlapMain =
      dir === 'left' || dir === 'right'
        ? Math.min(cr.bottom, r.bottom) - Math.max(cr.top, r.top)
        : Math.min(cr.right, r.right) - Math.max(cr.left, r.left);
    const aligned = overlapMain > 0;

    const score = primary + secondary * (aligned ? 0.35 : 2.2);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function scrollIntoViewIfNeeded(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const margin = 80;
  const outOfView =
    r.top < margin ||
    r.bottom > window.innerHeight - margin ||
    r.left < margin ||
    r.right > window.innerWidth - margin;
  if (outOfView) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
}

export function focusElement(el: HTMLElement) {
  ensureFocusable(el);
  el.focus({ preventScroll: true });
  el.classList.add('tv-focused');
  scrollIntoViewIfNeeded(el);
}

/** 把焦点放到页面里第一个可聚焦元素上 */
export function focusFirst() {
  const all = focusables();
  if (all.length) focusElement(all[0]);
}

const onKeyDown = (e: KeyboardEvent) => {
  const key = e.key;
  const map: Record<string, Dir> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
  };

  // 输入框里方向键要留给光标移动
  const target = e.target as HTMLElement | null;
  const typingInField =
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') &&
    (target as HTMLInputElement).type !== 'button';

  if (map[key]) {
    if (typingInField) return;
    const current = (document.activeElement as HTMLElement) || null;
    const all = focusables();
    if (!all.length) return;

    if (!current || current === document.body) {
      e.preventDefault();
      focusFirst();
      return;
    }
    const next = findNext(current, map[key], all);
    if (next) {
      e.preventDefault();
      document.querySelectorAll('.tv-focused').forEach((n) => n.classList.remove('tv-focused'));
      focusElement(next);
    }
    return;
  }

  if (key === 'Enter') {
    const current = document.activeElement as HTMLElement | null;
    if (current && current !== document.body) {
      const clickable = current.closest<HTMLElement>(
        'button, a[href], .ant-card, .ant-menu-item, .ant-dropdown-menu-item, [role="button"]'
      );
      if (clickable) {
        e.preventDefault();
        clickable.click();
      }
    }
    return;
  }

  // 遥控器返回键：WebView 常派发为 Escape；部分设备是 Backspace
  if (key === 'Escape' || key === 'GoBack' || (key === 'Backspace' && !typingInField)) {
    const anyModal = document.querySelector('.ant-modal-wrap:not([style*="display: none"])');
    if (anyModal) return; // 交给 antd 自己关弹窗
    if (window.history.length > 1) {
      e.preventDefault();
      window.history.back();
    }
  }
};

let started = false;

export function startSpatialNavigation() {
  if (started) return () => {};
  started = true;

  document.body.classList.add('tv-mode');
  window.addEventListener('keydown', onKeyDown, true);

  // 鼠标/触摸点击时同步焦点高亮，避免出现两个高亮
  const onClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement)?.closest<HTMLElement>(FOCUS_SELECTOR);
    if (el) {
      document.querySelectorAll('.tv-focused').forEach((n) => n.classList.remove('tv-focused'));
      ensureFocusable(el);
    }
  };
  document.addEventListener('click', onClick, true);

  return () => {
    started = false;
    document.body.classList.remove('tv-mode');
    window.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('click', onClick, true);
  };
}
