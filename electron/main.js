// HugoWriter - Electron メインプロセス
// サイト(Hugoプロジェクト)の読み書き・Hugoプレビューサーバの管理・設定管理を担当する。
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const matter = require('gray-matter');

const SITE_CONFIG_FILENAME = 'wpgen.site.json';

/** @type {BrowserWindow | null} */
let mainWindow = null;

// ---------------------------------------------------------------------------
// ユーザー設定 (PCごと・個人の執筆環境設定)
// ---------------------------------------------------------------------------
const DEFAULT_USER_SETTINGS = {
  sitePath: '',
  authorName: '',
  authorEmail: '',
  editorFontSize: 16,
  editorInitialMode: 'wysiwyg', // 'wysiwyg' | 'markdown'
  autosave: true,
  autosaveIntervalSec: 5,
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadUserSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8').replace(/^﻿/, '');
    return { ...DEFAULT_USER_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_USER_SETTINGS };
  }
}

function saveUserSettings(partial) {
  const merged = { ...loadUserSettings(), ...partial };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

// ---------------------------------------------------------------------------
// サイト設定 (管理者が配布する設定ファイル: Hugoプロジェクト直下の wpgen.site.json)
// アプリからは読み取り専用。
// ---------------------------------------------------------------------------
const DEFAULT_SITE_CONFIG = {
  siteName: '',
  sections: [{ dir: 'posts', label: '投稿' }],
  frontMatterFields: [
    { key: 'title', label: 'タイトル', type: 'string', required: true },
    { key: 'date', label: '日付', type: 'date' },
    { key: 'draft', label: '下書き', type: 'boolean' },
    { key: 'tags', label: 'タグ', type: 'list' },
    { key: 'description', label: '説明', type: 'text' },
  ],
  newArticle: {
    // ファイル名パターン: {date} = YYYY-MM-DD, {slug} = タイトルから生成
    filenamePattern: '{date}-{slug}.md',
    defaultFrontMatter: { draft: true },
  },
  deploy: {},
};

/** 現在開いているサイトの状態
 *  root     … ユーザーが選択したフォルダ (Git リポジトリのルートを想定)
 *  hugoRoot … hugo.toml 等がある Hugo サイト本体のフォルダ (root と同じか、その下位)
 */
const site = {
  root: '',
  hugoRoot: '',
  config: null,
};

function findHugoConfig(root) {
  const names = ['hugo.toml', 'hugo.yaml', 'hugo.yml', 'hugo.json', 'config.toml', 'config.yaml', 'config.yml', 'config.json'];
  for (const n of names) {
    if (fs.existsSync(path.join(root, n))) return n;
  }
  if (fs.existsSync(path.join(root, 'config'))) return 'config';
  return null;
}

// Hugo サイト探索時に降りないディレクトリ (Hugo サイト内部の構造や生成物)
const HUGO_SEARCH_SKIP = new Set([
  '.git', 'node_modules', 'public', 'resources', 'themes', 'content',
  'layouts', 'static', 'assets', 'archetypes', 'data', 'i18n', 'release', 'dist',
]);

/** 選択フォルダの直下に Hugo 設定がなければ、下位ディレクトリ (深さ3まで) から探す */
function findHugoRoot(root, maxDepth = 3) {
  if (findHugoConfig(root)) return root;
  const found = [];
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (depth >= maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (HUGO_SEARCH_SKIP.has(ent.name) || ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (findHugoConfig(full)) {
        found.push(full);
      } else {
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  if (found.length === 0) return null;
  // 複数見つかった場合は浅い方 → 名前順で決定的に選ぶ
  found.sort((a, b) => {
    const da = a.split(path.sep).length - b.split(path.sep).length;
    return da !== 0 ? da : a.localeCompare(b);
  });
  return found[0];
}

function readSiteConfigFile(dir) {
  const p = path.join(dir, SITE_CONFIG_FILENAME);
  if (!fs.existsSync(p)) return null;
  // メモ帳等で保存されたときの UTF-8 BOM も許容する
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
}

/** wpgen.site.json は選択フォルダ直下を優先し、なければ Hugo フォルダ直下も見る */
function loadSiteConfig(root, hugoRoot) {
  const cfg = readSiteConfigFile(root) || (hugoRoot && hugoRoot !== root ? readSiteConfigFile(hugoRoot) : null) || {};
  const merged = {
    ...DEFAULT_SITE_CONFIG,
    ...cfg,
    newArticle: { ...DEFAULT_SITE_CONFIG.newArticle, ...(cfg.newArticle || {}) },
  };
  if (!merged.siteName) {
    merged.siteName = path.basename(root);
  }
  return merged;
}

function assertSiteOpen() {
  if (!site.root) throw new Error('サイトが開かれていません');
}

/** content/ 配下の相対パスであることを検証して絶対パスを返す(パストラバーサル防止) */
function articleAbsPath(relPath) {
  assertSiteOpen();
  const contentDir = path.join(site.hugoRoot, 'content');
  const abs = path.resolve(contentDir, relPath);
  if (!abs.startsWith(contentDir + path.sep)) {
    throw new Error('不正なパスです: ' + relPath);
  }
  return abs;
}

// ---------------------------------------------------------------------------
// 記事の一覧・読み書き
// ---------------------------------------------------------------------------
function walkMarkdown(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkMarkdown(full, out);
    } else if (/\.(md|markdown)$/i.test(ent.name) && ent.name !== '_index.md') {
      out.push(full);
    }
  }
}

function listArticles() {
  assertSiteOpen();
  const contentDir = path.join(site.hugoRoot, 'content');
  const result = [];
  for (const section of site.config.sections) {
    const dir = path.join(contentDir, section.dir);
    const files = [];
    walkMarkdown(dir, files);
    for (const file of files) {
      let fm = {};
      try {
        fm = matter(fs.readFileSync(file, 'utf8')).data || {};
      } catch {
        // front matter が壊れていても一覧には出す
      }
      result.push({
        path: path.relative(contentDir, file).split(path.sep).join('/'),
        section: section.dir,
        sectionLabel: section.label,
        title: fm.title || path.basename(file, path.extname(file)),
        date: fm.date ? String(fm.date instanceof Date ? fm.date.toISOString() : fm.date) : '',
        draft: !!fm.draft,
      });
    }
  }
  result.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return result;
}

function readArticle(relPath) {
  const abs = articleAbsPath(relPath);
  const raw = fs.readFileSync(abs, 'utf8');
  const parsed = matter(raw);
  const fm = {};
  for (const [k, v] of Object.entries(parsed.data || {})) {
    fm[k] = v instanceof Date ? v.toISOString() : v;
  }
  return { frontMatter: fm, body: parsed.content.replace(/^\r?\n/, '') };
}

function saveArticle(relPath, frontMatter, body) {
  const abs = articleAbsPath(relPath);
  const raw = matter.stringify('\n' + body.replace(/^\n+/, ''), frontMatter);
  fs.writeFileSync(abs, raw, 'utf8');
  return { ok: true };
}

function slugify(title) {
  const s = String(title)
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '-')
    // Windows のファイル名に使えない文字と URL 上問題になりやすい文字を除去
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=~^;,]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'article';
}

function createArticle(sectionDir, title) {
  assertSiteOpen();
  const section = site.config.sections.find((s) => s.dir === sectionDir);
  if (!section) throw new Error('不明なセクションです: ' + sectionDir);

  const now = new Date();
  const date = now.toISOString();
  const ymd = date.slice(0, 10);
  const pattern = site.config.newArticle.filenamePattern || '{date}-{slug}.md';
  let base = pattern.replace('{date}', ymd).replace('{slug}', slugify(title));

  const dir = path.join(site.hugoRoot, 'content', section.dir);
  fs.mkdirSync(dir, { recursive: true });

  let file = path.join(dir, base);
  let i = 2;
  while (fs.existsSync(file)) {
    file = path.join(dir, base.replace(/\.md$/i, `-${i}.md`));
    i++;
  }

  const userSettings = loadUserSettings();
  const fm = {
    title: String(title || '無題'),
    date,
    ...((site.config.newArticle && site.config.newArticle.defaultFrontMatter) || { draft: true }),
  };
  if (userSettings.authorName) fm.author = userSettings.authorName;

  fs.writeFileSync(file, matter.stringify('\n', fm), 'utf8');
  const contentDir = path.join(site.hugoRoot, 'content');
  return { path: path.relative(contentDir, file).split(path.sep).join('/') };
}

function deleteArticle(relPath) {
  const abs = articleAbsPath(relPath);
  return shell.trashItem(abs).then(() => ({ ok: true }));
}

// ---------------------------------------------------------------------------
// Hugo プレビューサーバ
// ---------------------------------------------------------------------------
const preview = {
  proc: null,
  url: '',
};

function findHugoBinary() {
  // 1. 同梱バイナリ (パッケージ版)
  const bundled = path.join(process.resourcesPath || '', 'bin', 'hugo.exe');
  if (process.resourcesPath && fs.existsSync(bundled)) return bundled;
  // 2. 開発時: プロジェクト内 resources/bin
  const devBundled = path.join(__dirname, '..', 'resources', 'bin', 'hugo.exe');
  if (fs.existsSync(devBundled)) return devBundled;
  // 3. PATH 上の hugo
  const r = spawnSync('hugo', ['version'], { shell: true });
  if (r.status === 0) return 'hugo';
  return null;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function startPreview() {
  assertSiteOpen();
  if (preview.proc) return { url: preview.url };

  const hugo = findHugoBinary();
  if (!hugo) {
    throw new Error('Hugo が見つかりません。Hugo をインストールするか、管理者に確認してください。');
  }
  const port = await findFreePort();
  const args = [
    'server',
    '-D',
    '--port', String(port),
    '--bind', '127.0.0.1',
    '--source', site.hugoRoot,
    '--disableBrowserError',
  ];
  const proc = spawn(hugo, args, { shell: hugo === 'hugo', windowsHide: true });
  preview.proc = proc;
  preview.url = `http://127.0.0.1:${port}/`;

  let stderrBuf = '';
  proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });
  proc.on('exit', (code) => {
    preview.proc = null;
    preview.url = '';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('preview-stopped', { code, stderr: stderrBuf.slice(-2000) });
    }
  });

  // サーバが応答するまで待つ (最大 15 秒)
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!preview.proc) {
      throw new Error('Hugo サーバの起動に失敗しました:\n' + stderrBuf.slice(-2000));
    }
    const ok = await new Promise((resolve) => {
      const sock = net.connect(port, '127.0.0.1');
      sock.on('connect', () => { sock.destroy(); resolve(true); });
      sock.on('error', () => resolve(false));
    });
    if (ok) return { url: preview.url };
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Hugo サーバの起動がタイムアウトしました');
}

function stopPreview() {
  if (preview.proc) {
    try { preview.proc.kill(); } catch { /* 無視 */ }
    if (process.platform === 'win32' && preview.proc.pid) {
      // shell 経由で起動した場合は子プロセスごと終了させる
      spawnSync('taskkill', ['/pid', String(preview.proc.pid), '/T', '/F'], { windowsHide: true });
    }
    preview.proc = null;
    preview.url = '';
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Git 連携
// ---------------------------------------------------------------------------
function runGit(args, cwd) {
  return new Promise((resolve) => {
    const p = spawn('git', args, {
      cwd: cwd || undefined,
      windowsHide: true,
      // 端末での認証プロンプトは無効化 (Git Credential Manager の GUI は使われる)
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => resolve({ code: -1, out, err: String(e.message || e) }));
    p.on('exit', (code) => resolve({ code, out, err }));
  });
}

function gitIdentityArgs() {
  const s = loadUserSettings();
  const name = s.authorName || 'HugoWriter';
  const email = s.authorEmail || 'hugowriter@users.noreply.local';
  return ['-c', `user.name=${name}`, '-c', `user.email=${email}`];
}

function isAuthError(text) {
  return /Authentication failed|could not read Username|Permission denied|403|Repository not found/i.test(text);
}

const AUTH_HELP =
  'リポジトリへの接続に失敗しました。GitHub へのサインインが済んでいるか、リポジトリへのアクセス権があるか確認してください。';

async function gitInfo() {
  const ver = await runGit(['--version']);
  if (ver.code !== 0) return { gitInstalled: false, isRepo: false };
  if (!site.root) return { gitInstalled: true, isRepo: false };

  // サイトフォルダ自体がリポジトリのルートである場合のみ Git 機能を有効にする
  // (親フォルダのリポジトリを誤って操作しないため)
  if (!fs.existsSync(path.join(site.root, '.git'))) {
    return { gitInstalled: true, isRepo: false };
  }
  const inTree = await runGit(['rev-parse', '--is-inside-work-tree'], site.root);
  if (inTree.code !== 0 || !inTree.out.includes('true')) {
    return { gitInstalled: true, isRepo: false };
  }
  const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], site.root)).out.trim();
  const remote = (await runGit(['remote', 'get-url', 'origin'], site.root)).out.trim();
  const status = await runGit(['status', '--porcelain'], site.root);
  const changedCount = status.out.split('\n').filter((l) => l.trim()).length;

  let ahead = 0;
  let behind = 0;
  let hasUpstream = false;
  const lr = await runGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], site.root);
  if (lr.code === 0) {
    hasUpstream = true;
    const m = lr.out.trim().split(/\s+/);
    ahead = Number(m[0] || 0);
    behind = Number(m[1] || 0);
  }
  return { gitInstalled: true, isRepo: true, branch, remoteUrl: remote, changedCount, ahead, behind, hasUpstream };
}

/** 作業ツリーに変更があれば自動コミットする */
async function gitCommitAll() {
  const status = await runGit(['status', '--porcelain'], site.root);
  if (!status.out.trim()) return { committed: false };
  const add = await runGit(['add', '-A'], site.root);
  if (add.code !== 0) throw new Error('変更の取り込みに失敗しました:\n' + add.err.slice(-500));
  const s = loadUserSettings();
  const stamp = new Date().toLocaleString('ja-JP');
  const msg = `記事更新 (${s.authorName || '名前未設定'}, ${stamp})`;
  const commit = await runGit([...gitIdentityArgs(), 'commit', '-m', msg], site.root);
  if (commit.code !== 0) throw new Error('保存 (コミット) に失敗しました:\n' + (commit.err || commit.out).slice(-500));
  return { committed: true };
}

/** 最新を取得 (必要ならローカル変更を先に自動コミット) */
async function gitPull() {
  assertSiteOpen();
  await gitCommitAll();
  const pull = await runGit([...gitIdentityArgs(), 'pull', '--rebase'], site.root);
  if (pull.code !== 0) {
    const text = pull.err + pull.out;
    if (/CONFLICT|could not apply|Resolve all conflicts/i.test(text)) {
      await runGit(['rebase', '--abort'], site.root);
      return {
        conflict: true,
        message:
          '他のメンバーの変更と競合したため、取得を中止しました。\nあなたの変更はローカルに保存されています。管理者に相談してください。',
      };
    }
    if (isAuthError(text)) throw new Error(AUTH_HELP);
    if (/no tracking information|There is no tracking/i.test(text)) {
      return { message: 'リモートとの関連付けがないため、取得をスキップしました。' };
    }
    throw new Error('最新の取得に失敗しました:\n' + text.slice(-600));
  }
  return { message: '最新の状態を取得しました。' };
}

/** 変更を送信 (自動コミット → 取得 → プッシュ) */
async function gitSync() {
  assertSiteOpen();
  const pulled = await gitPull();
  if (pulled.conflict) return pulled;
  const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], site.root)).out.trim() || 'main';
  const push = await runGit(['push', '-u', 'origin', branch], site.root);
  if (push.code !== 0) {
    const text = push.err + push.out;
    if (isAuthError(text)) throw new Error(AUTH_HELP);
    throw new Error('送信に失敗しました:\n' + text.slice(-600));
  }
  return { message: '変更を送信しました。' };
}

/** リポジトリ URL からクローンして開く */
async function gitClone(url) {
  if (!/^(https?:\/\/|git@)/.test(url)) {
    throw new Error('リポジトリの URL が正しくありません (https:// で始まる URL を入力してください)');
  }
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'サイトを保存する場所 (親フォルダ) を選択',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled) return { canceled: true };
  const parent = r.filePaths[0];
  const name = (url.split('/').pop() || 'site').replace(/\.git$/i, '') || 'site';
  const dest = path.join(parent, name);
  if (fs.existsSync(dest)) {
    throw new Error(`フォルダ ${dest} は既に存在します。既にある場合は「サイトのフォルダを選択」から開いてください。`);
  }
  const clone = await runGit(['clone', url, dest]);
  if (clone.code !== 0) {
    const text = clone.err + clone.out;
    if (isAuthError(text)) throw new Error(AUTH_HELP);
    throw new Error('リポジトリの取得に失敗しました:\n' + text.slice(-600));
  }
  return { root: dest };
}

// ---------------------------------------------------------------------------
// サイトを開く
// ---------------------------------------------------------------------------
function openSite(root) {
  if (!root || !fs.existsSync(root)) {
    return { ok: false, error: 'フォルダが見つかりません: ' + root };
  }

  // 管理者設定 (選択フォルダ直下) の hugoDir 指定を最優先で使う
  let hugoRoot = null;
  try {
    const rootCfg = readSiteConfigFile(root);
    if (rootCfg && rootCfg.hugoDir) {
      const candidate = path.resolve(root, rootCfg.hugoDir);
      if (!candidate.startsWith(path.resolve(root))) {
        return { ok: false, error: `サイト設定の hugoDir が選択フォルダの外を指しています: ${rootCfg.hugoDir}` };
      }
      if (!findHugoConfig(candidate)) {
        return { ok: false, error: `サイト設定の hugoDir (${rootCfg.hugoDir}) に hugo.toml / config.toml が見つかりません` };
      }
      hugoRoot = candidate;
    }
  } catch (e) {
    return { ok: false, error: `サイト設定ファイル (${SITE_CONFIG_FILENAME}) の読み込みに失敗しました: ${e.message}` };
  }

  // 指定がなければ直下 → 下位ディレクトリの順で自動検出
  if (!hugoRoot) {
    hugoRoot = findHugoRoot(root);
  }
  if (!hugoRoot) {
    return {
      ok: false,
      error: 'Hugo サイトが見つかりません (このフォルダにもその下位にも hugo.toml / config.toml がありません)',
    };
  }

  stopPreview();
  site.root = root;
  site.hugoRoot = hugoRoot;
  try {
    site.config = loadSiteConfig(root, hugoRoot);
  } catch (e) {
    site.root = '';
    site.hugoRoot = '';
    return { ok: false, error: `サイト設定ファイル (${SITE_CONFIG_FILENAME}) の読み込みに失敗しました: ${e.message}` };
  }
  saveUserSettings({ sitePath: root });
  return { ok: true, root, hugoRoot, config: site.config };
}

// ---------------------------------------------------------------------------
// IPC ハンドラ
// ---------------------------------------------------------------------------
function wrap(fn) {
  return async (_event, ...args) => {
    try {
      const result = await fn(...args);
      return { ok: true, ...(result && typeof result === 'object' ? result : { value: result }) };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  };
}

ipcMain.handle('settings:get', wrap(() => ({ settings: loadUserSettings() })));
ipcMain.handle('settings:set', wrap((partial) => ({ settings: saveUserSettings(partial) })));

ipcMain.handle('site:selectFolder', wrap(async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Hugo サイトのフォルダを選択',
    properties: ['openDirectory'],
  });
  return { path: r.canceled ? null : r.filePaths[0] };
}));

ipcMain.handle('site:open', async (_e, root) => openSite(root));
ipcMain.handle('site:getConfig', wrap(() => {
  assertSiteOpen();
  return { root: site.root, hugoRoot: site.hugoRoot, config: site.config };
}));

ipcMain.handle('articles:list', wrap(() => ({ articles: listArticles() })));
ipcMain.handle('articles:read', wrap((relPath) => readArticle(relPath)));
ipcMain.handle('articles:save', wrap((relPath, fm, body) => saveArticle(relPath, fm, body)));
ipcMain.handle('articles:create', wrap((section, title) => createArticle(section, title)));
ipcMain.handle('articles:delete', wrap((relPath) => deleteArticle(relPath)));

ipcMain.handle('git:info', wrap(async () => ({ info: await gitInfo() })));
ipcMain.handle('git:pull', wrap(() => gitPull()));
ipcMain.handle('git:sync', wrap(() => gitSync()));
ipcMain.handle('git:clone', wrap((url) => gitClone(url)));

ipcMain.handle('app:info', wrap(() => ({ version: app.getVersion() })));

ipcMain.handle('preview:start', wrap(() => startPreview()));
ipcMain.handle('preview:stop', wrap(() => stopPreview()));
ipcMain.handle('preview:status', wrap(() => ({ running: !!preview.proc, url: preview.url })));

// ---------------------------------------------------------------------------
// ウィンドウ
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'HugoWriter',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // 外部リンクは既定のブラウザで開く
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 開発用: スクリーンショットを撮って終了 (WPGEN_SHOT=出力パス)
  if (process.env.WPGEN_SHOT) {
    mainWindow.webContents.on('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, Number(process.env.WPGEN_SHOT_WAIT || 4000)));
      const img = await mainWindow.webContents.capturePage();
      fs.writeFileSync(process.env.WPGEN_SHOT, img.toPNG());
      app.quit();
    });
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopPreview();
  app.quit();
});

app.on('before-quit', () => stopPreview());
