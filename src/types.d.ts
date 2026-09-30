/// <reference types="vite/client" />

// 由 vite.config.ts 的 define 注入
declare const __APP_NAME__: string;
declare const __APP_VERSION__: string;
declare const __APP_DESC__: string;

interface Window {
  electronAPI?: {
    isElectron: boolean;
    platform: string;
  };
  /** Capacitor 注入的原生桥（安卓端存在） */
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: Record<string, any>;
  };
}

/** qrcode 库没有随包提供类型定义，这里做最小声明 */
declare module 'qrcode' {
  export interface QRCodeRenderOptions {
    width?: number;
    margin?: number;
    scale?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    color?: { dark?: string; light?: string };
    type?: string;
  }
  export function toDataURL(text: string, options?: QRCodeRenderOptions): Promise<string>;
  export function toString(text: string, options?: QRCodeRenderOptions): Promise<string>;
  export function toCanvas(canvas: unknown, text: string, options?: QRCodeRenderOptions): Promise<void>;
  const _default: {
    toDataURL: typeof toDataURL;
    toString: typeof toString;
    toCanvas: typeof toCanvas;
  };
  export default _default;
}
