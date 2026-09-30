import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 安卓端配置（手机 + Android TV 共用同一个工程）
 *
 * 关键点：
 * - webDir 指向 Vite 的产物目录
 * - allowMixedContent：Emby 服务器大多是 http://，而 WebView 跑在 https://localhost，
 *   不开这个会被当成混合内容拦掉
 * - backgroundColor 用浅色，避免启动瞬间黑屏
 */
const config: CapacitorConfig = {
  appId: 'com.myemby.app',
  appName: 'myemby',
  webDir: 'dist/renderer',
  android: {
    allowMixedContent: true,
    backgroundColor: '#ffffff',
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
};

export default config;
