package com.myemby.app;

import android.content.Context;
import android.os.Build;
import android.util.Log;
import android.webkit.WebView;

import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * myemby 安卓 / 电视端代理插件
 *
 * 设计取舍（重要）：
 * 安卓要拦截流量通常得用 VpnService + tun 设备，但那要求把代理核心以「库」的形式链进来
 * —— sing-box 官方库是 GPL-3.0，会让整个项目被迫改成 GPL。为了保住 MIT，
 * 这里改用另一条路：核心仍然作为**独立程序**运行（只提供本地 HTTP/SOCKS 入站），
 * 再用 AndroidX WebKit 的 ProxyController 把 myemby 自己 WebView 的流量指向本地端口。
 *
 * 好处：
 *  - 核心是独立进程，不构成衍生作品，许可证不受影响
 *  - 只影响 myemby 自己，不接管整机流量，不影响系统里其他 App
 *  - 无需 VpnService 权限、无需 root、无需 NDK 编译
 * 代价：
 *  - 只代理 myemby 的流量（这正是产品需求）
 */
@CapacitorPlugin(name = "MyembyProxy")
public class MyembyProxyPlugin extends Plugin {

    private static final String TAG = "MyembyProxy";
    private static final int DEFAULT_PORT = 20808;
    private static final int MAX_LOG = 400;

    private Process coreProc;
    private String coreType;
    private int localPort = DEFAULT_PORT;
    private long startedAt = 0L;
    private String lastError = "";

    private final List<String> logs = Collections.synchronizedList(new ArrayList<String>());
    private final ExecutorService io = Executors.newCachedThreadPool();

    private ServerSocket configServer;
    private Thread configThread;
    private String configToken = "";

    // ------------------------------------------------------------ 工具

    private void log(String line) {
        String stamped = line;
        synchronized (logs) {
            logs.add(stamped);
            while (logs.size() > MAX_LOG) logs.remove(0);
        }
        JSObject d = new JSObject();
        d.put("line", stamped);
        notifyListeners("proxyLog", d);
    }

    /** 核心可执行文件：以 lib<name>.so 形式放在 jniLibs，安装后落在 nativeLibraryDir，天然有执行权限 */
    private File coreFile(String core) {
        String so = core.equals("singbox") ? "libsingbox.so" : "libxray.so";
        File f = new File(getContext().getApplicationInfo().nativeLibraryDir, so);
        return f;
    }

    private boolean isRunning() {
        if (coreProc == null) return false;
        try {
            // exitValue 不抛异常说明已退出
            coreProc.exitValue();
            return false;
        } catch (IllegalThreadStateException e) {
            return true;
        }
    }

    private int findFreePort(int base) {
        for (int p = base; p < base + 50; p++) {
            ServerSocket s = null;
            try {
                s = new ServerSocket();
                s.bind(new InetSocketAddress("127.0.0.1", p));
                return p;
            } catch (IOException ignored) {
                // 端口被占，继续试下一个
            } finally {
                if (s != null) try { s.close(); } catch (IOException ignored) {}
            }
        }
        return base;
    }

    private boolean waitForPort(int port, long timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (!isRunning()) return false;
            Socket s = new Socket();
            try {
                s.connect(new InetSocketAddress("127.0.0.1", port), 600);
                return true;
            } catch (IOException ignored) {
                try { Thread.sleep(200); } catch (InterruptedException e) { return false; }
            } finally {
                try { s.close(); } catch (IOException ignored) {}
            }
        }
        return false;
    }

    private String localIp() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) {
                        String ip = a.getHostAddress();
                        if (ip != null && !ip.startsWith("169.254.")) return ip;
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    // ------------------------------------------------------------ 进程控制

    private void killCore() {
        Process p = coreProc;
        coreProc = null;
        if (p == null) return;
        try { p.destroy(); } catch (Exception ignored) {}
        try {
            if (!p.waitFor(1500, TimeUnit.MILLISECONDS)) p.destroyForcibly();
        } catch (Exception ignored) {}
        startedAt = 0L;
    }

    /**
     * 把 myemby 自己 WebView 的流量指向本地代理端口。
     * 注意 AndroidX WebKit 的签名顺序是 (ProxyConfig, Executor, Runnable)。
     */
    private void applyWebViewProxy(final int port) {
        try {
            getActivity().runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        ProxyConfig cfg = new ProxyConfig.Builder()
                                .addProxyRule("127.0.0.1:" + port)
                                .addDirect()
                                .build();
                        ProxyController.getInstance().setProxyOverride(cfg, io, new Runnable() {
                            @Override public void run() {
                                log("WebView 代理已生效 → 127.0.0.1:" + port);
                            }
                        });
                    } catch (Throwable t) {
                        log("! 设置 WebView 代理失败: " + t.getMessage());
                    }
                }
            });
        } catch (Throwable t) {
            log("! 设置 WebView 代理异常: " + t.getMessage());
        }
    }

    private void clearWebViewProxy() {
        try {
            getActivity().runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        ProxyController.getInstance().clearProxyOverride(io, new Runnable() {
                            @Override public void run() { log("WebView 代理已关闭"); }
                        });
                    } catch (Throwable t) {
                        log("! 清除 WebView 代理失败: " + t.getMessage());
                    }
                }
            });
        } catch (Throwable ignored) {}
    }

    // ------------------------------------------------------------ 插件方法

    @PluginMethod
    public void checkCores(PluginCall call) {
        JSObject cores = new JSObject();
        for (String core : new String[]{"xray", "singbox"}) {
            File f = coreFile(core);
            JSObject o = new JSObject();
            boolean ok = f.exists() && f.length() > 0;
            o.put("available", ok);
            o.put("path", f.getAbsolutePath());
            if (!ok) o.put("error", "未在安装包里找到该核心（" + f.getName() + "）");
            cores.put(core, o);
        }
        JSObject ret = new JSObject();
        ret.put("cores", cores);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        final String core = call.getString("core", "singbox");
        final String config = call.getString("config", "{}");
        final Integer portArg = call.getInt("localPort", DEFAULT_PORT);

        if (isRunning()) {
            stopCore();
        }

        File bin = coreFile(core);
        if (!bin.exists()) {
            call.reject("没有找到 " + core + " 核心文件：" + bin.getAbsolutePath());
            return;
        }

        try {
            localPort = (portArg == null || portArg <= 0) ? findFreePort(DEFAULT_PORT) : portArg;

            File dir = new File(getContext().getFilesDir(), "proxy");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("无法创建配置目录");
                return;
            }
            File cfg = new File(dir, "config.json");
            FileOutputStream fos = new FileOutputStream(cfg);
            fos.write(config.getBytes(StandardCharsets.UTF_8));
            fos.close();

            if (!bin.canExecute()) {
                // 从 nativeLibraryDir 出来的文件通常已可执行；保险起见再试一次
                //noinspection ResultOfMethodCallIgnored
                bin.setExecutable(true, false);
            }

            ProcessBuilder pb = new ProcessBuilder(bin.getAbsolutePath(), "run", "-c", cfg.getAbsolutePath());
            pb.directory(dir);
            pb.redirectErrorStream(true);
            coreProc = pb.start();
            coreType = core;
            startedAt = System.currentTimeMillis();
            lastError = "";

            log("启动核心 " + core + " → " + bin.getAbsolutePath());
            pump(coreProc.getInputStream());

            io.execute(new Runnable() {
                @Override public void run() {
                    final boolean ok = waitForPort(localPort, 15000);
                    JSObject st = new JSObject();
                    st.put("running", ok);
                    st.put("core", core);
                    st.put("port", localPort);
                    if (!ok) {
                        lastError = "核心启动后端口未就绪";
                        st.put("error", lastError);
                        log("! " + lastError);
                        notifyListeners("proxyStatusChanged", st);
                    } else {
                        log("本地代理就绪 127.0.0.1:" + localPort);
                        applyWebViewProxy(localPort);
                        notifyListeners("proxyStatusChanged", st);
                    }
                }
            });

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("core", core);
            ret.put("port", localPort);
            call.resolve(ret);
        } catch (Exception e) {
            lastError = String.valueOf(e.getMessage());
            log("! 启动失败: " + lastError);
            killCore();
            call.reject(lastError);
        }
    }

    private void stopCore() {
        killCore();
        coreType = null;
    }

    /** 把核心输出实时转成日志事件 */
    private void pump(final InputStream in) {
        io.execute(new Runnable() {
            @Override public void run() {
                BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                try {
                    String line;
                    while ((line = br.readLine()) != null) {
                        log(line);
                    }
                } catch (IOException ignored) {
                } finally {
                    try { br.close(); } catch (IOException ignored) {}
                    // 核心意外退出
                    if (coreProc == null || !isRunning()) {
                        JSObject st = new JSObject();
                        st.put("running", false);
                        notifyListeners("proxyStatusChanged", st);
                    }
                }
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        log("停止核心");
        stopCore();
        clearWebViewProxy();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        boolean running = isRunning();
        ret.put("running", running);
        ret.put("core", coreType);
        ret.put("port", localPort);
        ret.put("uptime", startedAt > 0 ? (System.currentTimeMillis() - startedAt) / 1000 : 0);
        if (!lastError.isEmpty()) ret.put("lastError", lastError);
        call.resolve(ret);
    }

    @PluginMethod
    public void logs(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (logs) {
            for (String l : logs) arr.put(l);
        }
        JSObject ret = new JSObject();
        ret.put("lines", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void clearLogs(PluginCall call) {
        synchronized (logs) { logs.clear(); }
        call.resolve(new JSObject());
    }

    /** 批量测延迟：直接对节点做 TCP 握手计时 */
    @PluginMethod
    public void ping(final PluginCall call) {
        final String targetsJson = call.getString("targets", "[]");
        io.execute(new Runnable() {
            @Override public void run() {
                JSArray results = new JSArray();
                try {
                    org.json.JSONArray arr = new org.json.JSONArray(targetsJson);
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject t = arr.getJSONObject(i);
                        String host = t.getString("server");
                        int port = t.getInt("port");
                        JSObject r = new JSObject();
                        r.put("nodeId", t.getString("nodeId"));
                        Socket s = new Socket();
                        try {
                            long t0 = System.currentTimeMillis();
                            s.connect(new InetSocketAddress(host, port), 5000);
                            r.put("delay", (int) (System.currentTimeMillis() - t0));
                        } catch (Exception e) {
                            r.put("delay", -1);
                            r.put("error", e.getMessage() == null ? "连接失败" : e.getMessage());
                        } finally {
                            try { s.close(); } catch (IOException ignored) {}
                        }
                        results.put(r);
                    }
                } catch (Exception e) {
                    Log.w(TAG, "ping 失败", e);
                }
                JSObject ret = new JSObject();
                ret.put("results", results);
                call.resolve(ret);
            }
        });
    }

    // ------------------------------------------------------------ 局域网扫码配置

    /**
     * 电视端专用：起一个只监听局域网的配置页，
     * 手机扫码打开后粘贴节点/订阅，提交即回传到 TV。
     */
    @PluginMethod
    public void startConfigServer(PluginCall call) {
        stopConfigServer();
        String ip = localIp();
        if (ip == null) {
            call.reject("没有找到局域网地址，请确认电视已连上 WiFi 或网线");
            return;
        }
        try {
            configServer = new ServerSocket();
            configServer.setReuseAddress(true);
            configServer.bind(new InetSocketAddress(0));
            final int port = configServer.getLocalPort();
            configToken = Long.toHexString(System.nanoTime());

            configThread = new Thread(new Runnable() {
                @Override public void run() {
                    serveConfig(configServer);
                }
            });
            configThread.setDaemon(true);
            configThread.start();

            String url = "http://" + ip + ":" + port + "/?t=" + configToken;
            log("局域网配置页已启动: " + url);

            JSObject ret = new JSObject();
            ret.put("url", url);
            ret.put("port", port);
            ret.put("token", configToken);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("启动配置页失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopConfigServer(PluginCall call) {
        stopConfigServer();
        call.resolve(new JSObject());
    }

    private void stopConfigServer() {
        try {
            if (configServer != null) configServer.close();
        } catch (IOException ignored) {}
        configServer = null;
        if (configThread != null) {
            configThread.interrupt();
            configThread = null;
        }
    }

    private void serveConfig(ServerSocket server) {
        while (server != null && !server.isClosed()) {
            Socket sock = null;
            try {
                sock = server.accept();
                handleConfigRequest(sock);
            } catch (IOException e) {
                break;
            } finally {
                if (sock != null) try { sock.close(); } catch (IOException ignored) {}
            }
        }
    }

    private void handleConfigRequest(Socket sock) {
        try {
            sock.setSoTimeout(8000);
            InputStream in = sock.getInputStream();
            OutputStream out = sock.getOutputStream();

            // 读请求行与头
            BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String requestLine = br.readLine();
            if (requestLine == null) return;
            int contentLength = 0;
            String line;
            while ((line = br.readLine()) != null && !line.isEmpty()) {
                int idx = line.indexOf(':');
                if (idx > 0 && line.substring(0, idx).trim().equalsIgnoreCase("Content-Length")) {
                    try { contentLength = Integer.parseInt(line.substring(idx + 1).trim()); } catch (Exception ignored) {}
                }
            }

            if (requestLine.startsWith("POST")) {
                StringBuilder body = new StringBuilder();
                for (int i = 0; i < contentLength; i++) {
                    int c = br.read();
                    if (c == -1) break;
                    body.append((char) c);
                }
                String content = "";
                String raw = body.toString();
                int ci = raw.indexOf("content=");
                if (ci >= 0) {
                    String enc = raw.substring(ci + 8);
                    int amp = enc.indexOf('&');
                    if (amp >= 0) enc = enc.substring(0, amp);
                    content = java.net.URLDecoder.decode(enc, "UTF-8");
                }
                JSObject d = new JSObject();
                d.put("content", content);
                notifyListeners("proxyConfigImported", d);
                log("收到手机配置，长度 " + content.length());
                respond(out, 200, page("提交成功", "已发送到电视，可以关掉这个页面了。"));
            } else {
                respond(out, 200, page("myemby 加速配置", form()));
            }
        } catch (Exception e) {
            Log.w(TAG, "配置页请求失败", e);
        }
    }

    private void respond(OutputStream out, int code, String html) throws IOException {
        byte[] body = html.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + code + " OK\r\n"
                + "Content-Type: text/html; charset=utf-8\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private String page(String title, String inner) {
        return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>" + title + "</title>"
                + "<style>body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;"
                + "background:#f5f7fa;color:rgba(0,0,0,.85);margin:0;padding:22px}"
                + ".box{max-width:560px;margin:0 auto;background:#fff;border:1px solid #ebeef5;"
                + "border-radius:12px;padding:20px}h2{margin:0 0 6px;font-size:19px}"
                + "p{color:rgba(0,0,0,.55);font-size:14px;line-height:1.7}"
                + "textarea{width:100%;box-sizing:border-box;min-height:180px;padding:12px;font-size:14px;"
                + "border:1px solid #d9d9d9;border-radius:8px;font-family:ui-monospace,Consolas,monospace}"
                + "button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:8px;"
                + "background:#1890ff;color:#fff;font-size:16px;font-weight:600}</style></head><body>"
                + "<div class=\"box\">" + inner + "</div></body></html>";
    }

    private String form() {
        return "<h2>myemby 网络加速</h2>"
                + "<p>在下面粘贴节点分享链接（可多行）或订阅地址，提交后电视上的 myemby 会自动导入。</p>"
                + "<form method=\"POST\"><textarea name=\"content\" placeholder=\"vmess://...\\n或 https://.../subscribe?token=xxx\"></textarea>"
                + "<button type=\"submit\">提交到电视</button></form>";
    }

    // ------------------------------------------------------------ 生命周期

    @Override
    protected void handleOnDestroy() {
        stopConfigServer();
        stopCore();
        clearWebViewProxy();
        super.handleOnDestroy();
    }
}
