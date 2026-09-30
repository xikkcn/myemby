## myemby v1.0.0

**一套代码，五个平台** —— 轻量、干净的 Emby 客户端，默认浅色主题。

> 🎬 **推荐 Emby 服务**：[UHD 4K 影音媒体库 EMBY](https://www.uhdnow.com/signup?invite=AN913K)
> —— 还没有自己的 Emby 服务器？可以看看这家。

---

### 支持平台

| 平台 | 说明 |
| --- | --- |
| Windows 10/11 | 安装版 + 免安装版 |
| Linux x64 | 绿色包，解压即用 |
| Android 手机 / 平板 | Android 5.1 (API 22) 及以上 |
| Android TV / 电视盒子 | 遥控器方向键操作，含 Android 5.0 老设备兼容版 |
| 网页端 | 浏览器打开即用，无需安装 |

### Windows

| 文件 | 说明 |
| --- | --- |
| `myemby-Setup-1.0.0.exe` | 安装版（推荐）：可自选路径，自动创建快捷方式，带卸载程序 |
| `myemby-Portable-1.0.0.exe` | 免安装版：双击即用，不写注册表 |

### Linux

| 文件 | 说明 |
| --- | --- |
| `myemby-1.0.0-linux-x64.tar.gz` | 解压后执行目录里的 `myemby` 即可 |

> AppImage 与 deb 需要 Linux 环境构建（Windows 上无法交叉编译）。
> 仓库自带 GitHub Actions 工作流，运行一次即可产出这两种格式。

### Android 手机 / 平板 / TV

同一个 APK **手机和电视都能装**（已同时注册桌面图标与电视 Leanback 启动器）。

| 文件 | 适用 |
| --- | --- |
| `myemby-v1.0.0-android-arm64-v8a.apk` | 64 位 ARM，近几年绝大多数手机与电视盒子 |
| `myemby-v1.0.0-android-armeabi-v7a.apk` | 32 位 ARM，较老的机型与盒子 |
| `myemby-v1.0.0-android-universal.apk` | 通用包，不确定机型时选它 |
| `myemby-v1.0.0-android-legacy21-*.apk` | **Android 5.0 / 5.1 老电视盒子专用**（minSdk 21） |

### 网页端（免安装）

**https://xikkcn.github.io/myemby/**

---

### 本版功能

- 默认浅色主题，五端界面与操作一致
- 直接播放 Emby 内容，支持 HLS、码流与字幕切换
- 电影库 / 剧集库 / 最近添加 / 播放历史
- 搜索、按年份 / 类型 / 国家筛选与排序
- 剧集连播，播放页可切换季与集
- 多服务器管理，凭据本地加密存储
- **电视模式**：遥控器方向键焦点导航、回车确认、返回键回退，界面元素自动放大

### 使用提示

1. 首次打开会停在 **设置 → 服务器管理**，点「添加服务器」
2. 地址栏只填主机名或 IP（**不要带 `http://`**），协议用下拉框选
3. Emby 默认端口 `8096`，HTTPS 默认 `8920`
4. 电视端如果没自动进入电视模式，到 **设置 → 应用设置 → 电视模式** 手动打开

> 程序未做商业代码签名，首次运行若出现 SmartScreen / 「未知来源」提示，
> 选择「更多信息 → 仍要运行」或允许安装即可。

详细说明见仓库 [README](https://github.com/xikkcn/myemby#readme)。

---

> 🎬 **UHD 4K 影音媒体库 EMBY** —— [https://www.uhdnow.com/signup?invite=AN913K](https://www.uhdnow.com/signup?invite=AN913K)
