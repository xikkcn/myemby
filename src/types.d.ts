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
