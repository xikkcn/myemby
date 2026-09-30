/**
 * 把 myemby 发布到 GitHub：
 *   1. 确保仓库存在（不存在则创建）
 *   2. 推送源码到 main（优先 git push，失败回退 REST API）
 *   3. 把网页端产物推到 gh-pages 分支并开启 GitHub Pages
 *   4. 创建 Release，上传桌面端与安卓端全部产物
 *
 * Token 从环境变量 GH_TOKEN 读取。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOKEN = (process.env.GH_TOKEN || '').trim();
const OWNER = process.env.GH_OWNER || 'xikkcn';
const REPO = process.env.GH_REPO || 'myemby';
const SRC_DIR = 'C:\\myemby';
const DESKTOP_DIR = path.join(SRC_DIR, 'dist_electron');
const WEB_DIR = path.join(SRC_DIR, 'dist', 'renderer');
const LOG = 'C:\\myemby\\_publish.log';
const VERSION = '1.0.0';
const TAG = 'v' + VERSION;

fs.writeFileSync(LOG, '');
const redact = (s) => String(s).split(TOKEN || '\u0000').join('***').replace(/ghp_[A-Za-z0-9]+/g, '***');
const log = (...a) =>
  fs.appendFileSync(LOG, redact(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const H = () => ({
  'User-Agent': 'myemby-publish',
  Authorization: 'Bearer ' + TOKEN,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

async function api(method, url, body) {
  for (let i = 1; i <= 7; i++) {
    try {
      const r = await fetch('https://api.github.com' + url, {
        method,
        headers: { ...H(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const t = await r.text();
      let j = null;
      try { j = t ? JSON.parse(t) : null; } catch (e) {}
      if (r.ok) return { ok: true, status: r.status, data: j };
      if ([502, 503, 504].includes(r.status) && i < 7) { await sleep(4000 * i); continue; }
      return { ok: false, status: r.status, text: t.slice(0, 400) };
    } catch (e) {
      if (i < 7) { await sleep(4000 * i); continue; }
      return { ok: false, status: 0, text: e.message };
    }
  }
}

function git(args, cwd) {
  const env = { ...process.env };
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'ELECTRON_RUN_AS_NODE']) {
    delete env[k];
  }
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
}

/** 收集要提交到源码仓库的文件（排除构建产物与依赖） */
function collectSourceFiles() {
  const EXCLUDE_DIRS = new Set([
    'node_modules', 'dist', 'dist_electron', '.git', 'build', '.gradle',
    '__pycache__', 'assets',   // android 里 assets/public 是构建产物
  ]);
  const EXCLUDE_FILE_RE = /(^|[\\/])(_publish\.log|_capture\.log|local\.properties|.*\.log)$/;
  const out = [];
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const r = rel ? rel + '/' + name : name;
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        if (EXCLUDE_DIRS.has(name)) continue;
        // android/app/build 之类
        if (r.endsWith('app/build')) continue;
        walk(full, r);
      } else {
        if (EXCLUDE_FILE_RE.test(r)) continue;
        out.push({ path: r, full, size: st.size });
      }
    }
  };
  walk(SRC_DIR, '');
  return out;
}

/** 用 Git Data API 一次性提交一批文件（支持二进制） */
async function pushFilesApi(files, branch, message, ensureEmptyBranch) {
  // GitHub 对「完全空的仓库」直接调 Git Data API 会返回 409，
  // 先用 Contents API 造一个初始提交，之后就正常了。
  const probe = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${branch}`);
  if (!probe.ok) {
    const seedName = branch === 'main' ? 'README.md' : 'index.html';
    const seedBody = branch === 'main' ? '# myemby\n' : '<!doctype html><title>myemby</title>';
    const seed = await api('PUT', `/repos/${OWNER}/${REPO}/contents/${seedName}`, {
      message: 'chore: 初始化分支',
      content: Buffer.from(seedBody).toString('base64'),
      branch,
    });
    if (!seed.ok) throw new Error('初始化分支失败: ' + seed.status + ' ' + seed.text);
    log(`  已初始化分支 ${branch}`);
  }

  const blobs = [];
  for (const f of files) {
    const buf = fs.readFileSync(f.full);
    const b = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
      content: buf.toString('base64'),
      encoding: 'base64',
    });
    if (!b.ok) throw new Error('blob failed: ' + f.path + ' ' + b.status + ' ' + b.text);
    blobs.push({ path: f.path, mode: '100644', type: 'blob', sha: b.data.sha });
  }
  log(`  已上传 ${blobs.length} 个 blob`);

  const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: blobs });
  if (!tree.ok) throw new Error('tree failed: ' + tree.status + ' ' + tree.text);

  const parents = [];
  const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${branch}`);
  if (ref.ok) parents.push(ref.data.object.sha);

  const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message,
    tree: tree.data.sha,
    parents,
  });
  if (!commit.ok) throw new Error('commit failed: ' + commit.status + ' ' + commit.text);

  const refRes = await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: commit.data.sha,
  });
  if (refRes.ok) return commit.data.sha;

  const upd = await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${branch}`, {
    sha: commit.data.sha,
    force: true,
  });
  if (!upd.ok) throw new Error('ref update failed: ' + upd.status + ' ' + upd.text);
  return commit.data.sha;
}

async function main() {
  if (!TOKEN) { log('NO_TOKEN'); process.exit(2); }

  const me = await api('GET', '/user');
  if (!me.ok) { log('AUTH_FAILED', me.status, me.text); process.exit(3); }
  log('认证 OK，账号 =', me.data.login);

  // 1. 仓库
  let repo = await api('GET', `/repos/${OWNER}/${REPO}`);
  if (repo.status === 404) {
    const created = await api('POST', '/user/repos', {
      name: REPO,
      description:
        'myemby（我的EMBY）— 轻量、干净的 Emby 客户端，一套代码出 Windows / Linux / Android 手机 / Android TV / 网页端。默认浅色主题。',
      private: false,
      has_issues: true,
      has_wiki: false,
      has_projects: false,
      auto_init: false,
    });
    if (!created.ok) { log('CREATE_FAILED', created.status, created.text); process.exit(4); }
    log('仓库已创建:', created.data.full_name);
    repo = created;
  } else if (repo.ok) {
    log('仓库已存在:', repo.data.full_name);
  } else {
    log('查询仓库失败', repo.status, repo.text); process.exit(4);
  }

  // 2. 推送源码
  const files = collectSourceFiles();
  log(`源码文件数 = ${files.length}`);
  const refMain = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/main`);
  const mainEmpty = !refMain.ok;

  let pushed = false;
  if (mainEmpty) {
    const remote = `https://${encodeURIComponent(OWNER)}:${TOKEN}@github.com/${OWNER}/${REPO}.git`;
    try {
      try { git(['remote', 'remove', 'origin'], SRC_DIR); } catch (e) {}
      git(['remote', 'add', 'origin', remote], SRC_DIR);
      git(['add', '-A'], SRC_DIR);
      try {
        git(['-c', 'core.autocrlf=false', 'commit', '-m', 'feat: myemby 首个版本（五端同源）'], SRC_DIR);
      } catch (e) { log('没有新改动或提交失败（可忽略）'); }

      // github.com 走 git 协议时通时断，多试几次
      for (let i = 1; i <= 5 && !pushed; i++) {
        try {
          git(['push', '-u', 'origin', 'HEAD:main'], SRC_DIR);
          pushed = true;
          log('git push 成功（第 ' + i + ' 次尝试）');
        } catch (e) {
          log(`git push 第 ${i} 次失败: ` + redact((e && (e.stderr || e.message)) || String(e)).slice(0, 160));
          await sleep(5000 * i);
        }
      }
      git(['remote', 'set-url', 'origin', `https://github.com/${OWNER}/${REPO}.git`], SRC_DIR);
    } catch (e) {
      log('git 流程异常:', redact((e && (e.stderr || e.message)) || String(e)).slice(0, 300));
    }
  } else {
    log('main 分支已存在，跳过源码推送（避免覆盖）');
    pushed = true;
  }

  if (!pushed) {
    log('改用 REST API 提交源码…');
    await pushFilesApi(files, 'main', 'feat: myemby 首个版本（五端同源）', true);
    log('API 提交完成');
  }

  // 3. 网页端 -> gh-pages
  if (fs.existsSync(WEB_DIR)) {
    log('部署网页端到 gh-pages…');
    const webFiles = [];
    const walkWeb = (dir, rel) => {
      for (const n of fs.readdirSync(dir)) {
        const full = path.join(dir, n);
        const r = rel ? rel + '/' + n : n;
        if (fs.statSync(full).isDirectory()) walkWeb(full, r);
        else webFiles.push({ path: r, full });
      }
    };
    walkWeb(WEB_DIR, '');
    log('  网页端文件数 =', webFiles.length);
    await pushFilesApi(webFiles, 'gh-pages', 'chore: 部署网页端', true);

    const pages = await api('POST', `/repos/${OWNER}/${REPO}/pages`, {
      source: { branch: 'gh-pages', path: '/' },
    });
    if (pages.ok) log('GitHub Pages 已开启');
    else {
      const upd = await api('PUT', `/repos/${OWNER}/${REPO}/pages`, {
        source: { branch: 'gh-pages', path: '/' },
      });
      log('Pages:', upd.ok ? '已更新' : `${pages.status} ${pages.text}`);
    }
  } else {
    log('未找到网页端产物，跳过 gh-pages');
  }

  // 4. Release + 产物
  const assets = [];
  for (const dir of [DESKTOP_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const n of fs.readdirSync(dir)) {
      if (/\.(exe|tar\.gz|AppImage|deb)$/.test(n)) assets.push(path.join(dir, n));
    }
  }
  const apkRoot = path.join(SRC_DIR, 'android', 'app', 'build', 'outputs', 'apk');
  if (fs.existsSync(apkRoot)) {
    const walkApk = (d) => {
      for (const n of fs.readdirSync(d)) {
        const full = path.join(d, n);
        if (fs.statSync(full).isDirectory()) walkApk(full);
        else if (n.endsWith('.apk')) assets.push(full);
      }
    };
    walkApk(apkRoot);
  }
  log('待上传产物:', assets.map((a) => path.basename(a)).join(', '));

  let rel = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
  if (!rel.ok) {
    const body = fs.existsSync(path.join(SRC_DIR, 'docs', 'release-notes.md'))
      ? fs.readFileSync(path.join(SRC_DIR, 'docs', 'release-notes.md'), 'utf8')
      : `## myemby v${VERSION}\n\n五端同源的首个版本。详见 README。`;
    const created = await api('POST', `/repos/${OWNER}/${REPO}/releases`, {
      tag_name: TAG,
      target_commitish: 'main',
      name: `myemby v${VERSION}`,
      body,
      draft: false,
      prerelease: false,
    });
    if (!created.ok) { log('RELEASE_FAILED', created.status, created.text); process.exit(6); }
    rel = created;
    log('Release 已创建:', created.data.html_url);
  } else {
    log('Release 已存在:', rel.data.html_url);
  }

  for (const p of assets) {
    const name = path.basename(p);
    const buf = fs.readFileSync(p);
    log(`上传 ${name} (${(buf.length / 1048576).toFixed(1)} MB)…`);
    let done = false;
    for (let i = 1; i <= 4 && !done; i++) {
      try {
        const r = await fetch(
          `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${rel.data.id}/assets?name=${encodeURIComponent(name)}`,
          { method: 'POST', headers: { ...H(), 'Content-Type': 'application/octet-stream' }, body: buf }
        );
        const t = await r.text();
        if (r.ok) { log('  OK ->', JSON.parse(t).browser_download_url); done = true; }
        else if ([502, 503, 504].includes(r.status) && i < 4) { log(`  ${r.status} 重试 ${i}`); await sleep(5000 * i); }
        else { log('  失败:', r.status, t.slice(0, 200)); break; }
      } catch (e) {
        log('  网络错误，重试:', e.message);
        await sleep(5000 * i);
      }
    }
  }

  log('DONE  https://github.com/' + OWNER + '/' + REPO);
}

main().catch((e) => { log('FATAL:', e && e.stack ? e.stack : String(e)); process.exit(1); });
