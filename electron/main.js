// STV-HugoWriter - Electron メインプロセス
// サイト(Hugoプロジェクト)の読み書き・Hugoプレビューサーバの管理・設定管理を担当する。
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const matter = require('gray-matter');
const TOML = require('@iarna/toml');

// Hugo の TOML front matter (+++) 用の gray-matter オプション
const TOML_MATTER_OPTIONS = {
  language: 'toml',
  delimiters: '+++',
  engines: { toml: { parse: TOML.parse.bind(TOML), stringify: TOML.stringify.bind(TOML) } },
};

function isTomlFrontMatter(raw) {
  return /^﻿?\+\+\+/.test(raw);
}

function parseFrontMatter(raw) {
  const clean = raw.replace(/^﻿/, '');
  if (isTomlFrontMatter(clean)) {
    return { parsed: matter(clean, TOML_MATTER_OPTIONS), format: 'toml' };
  }
  return { parsed: matter(clean), format: 'yaml' };
}

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
    } else if (/\.(md|markdown)$/i.test(ent.name)) {
      out.push(full);
    }
  }
}

/** ディレクトリ配下に Markdown ファイルがあるか (_index.md も数える) */
function dirHasMarkdown(dir, maxDepth = 6) {
  const stack = [{ dir, depth: 0 }];
  while (stack.length > 0) {
    const { dir: d, depth } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.isFile() && /\.(md|markdown)$/i.test(ent.name)) return true;
      if (ent.isDirectory() && depth < maxDepth) stack.push({ dir: path.join(d, ent.name), depth: depth + 1 });
    }
  }
  return false;
}

/** 一覧に表示するセクション。設定 (wpgen.site.json) のものに加え、
 *  content/ 直下で記事が見つかったフォルダも自動で含める。 */
function effectiveSections() {
  const contentDir = path.join(site.hugoRoot, 'content');
  const sections = site.config.sections.map((s) => ({
    dir: String(s.dir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
    label: s.label || s.dir,
  }));
  const known = new Set(sections.map((s) => s.dir));
  if (fs.existsSync(contentDir)) {
    const names = [];
    for (const ent of fs.readdirSync(contentDir, { withFileTypes: true })) {
      if (
        ent.isDirectory() &&
        !ent.name.startsWith('.') &&
        !known.has(ent.name) &&
        dirHasMarkdown(path.join(contentDir, ent.name))
      ) {
        names.push(ent.name);
      }
    }
    names.sort((a, b) => a.localeCompare(b, 'ja'));
    for (const name of names) {
      sections.push({ dir: name, label: name, auto: true });
    }
  }
  return sections;
}

function listArticles() {
  assertSiteOpen();
  const contentDir = path.join(site.hugoRoot, 'content');
  const result = [];
  const seen = new Set();

  const pushArticle = (file, section) => {
    if (seen.has(file)) return;
    seen.add(file);
    let fm = {};
    try {
      fm = parseFrontMatter(fs.readFileSync(file, 'utf8')).parsed.data || {};
    } catch {
      // front matter が壊れていても一覧には出す
    }
    const rel = path.relative(contentDir, file).split(path.sep).join('/');
    // 記事のセクション内での位置 (サブフォルダ) を表示用に付与する
    const inSection = section.dir && rel.startsWith(section.dir + '/') ? rel.slice(section.dir.length + 1) : rel;
    const subDir = inSection.includes('/') ? inSection.slice(0, inSection.lastIndexOf('/')) : '';
    // _index.md はセクション (やサイトトップ) の見出しページとして扱う
    const isIndex = path.basename(file).toLowerCase() === '_index.md';
    const fallbackTitle = isIndex
      ? subDir || (section.dir ? section.label : 'トップページ')
      : path.basename(file, path.extname(file));
    result.push({
      path: rel,
      section: section.dir,
      sectionLabel: section.label,
      subDir,
      isIndex,
      title: fm.title || fallbackTitle,
      date: fm.date ? String(fm.date instanceof Date ? fm.date.toISOString() : fm.date) : '',
      draft: !!fm.draft,
    });
  };

  for (const section of effectiveSections()) {
    const files = [];
    walkMarkdown(path.join(contentDir, ...section.dir.split('/')), files);
    for (const file of files) pushArticle(file, section);
  }

  // content 直下に置かれた単独ページ (about.md やトップページの _index.md) も表示する
  if (fs.existsSync(contentDir)) {
    for (const ent of fs.readdirSync(contentDir, { withFileTypes: true })) {
      if (ent.isFile() && /\.(md|markdown)$/i.test(ent.name)) {
        pushArticle(path.join(contentDir, ent.name), { dir: '', label: 'その他のページ' });
      }
    }
  }

  result.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return result;
}

function readArticle(relPath) {
  const abs = articleAbsPath(relPath);
  const raw = fs.readFileSync(abs, 'utf8');
  const { parsed } = parseFrontMatter(raw);
  const fm = {};
  for (const [k, v] of Object.entries(parsed.data || {})) {
    fm[k] = v instanceof Date ? v.toISOString() : v;
  }
  return { frontMatter: fm, body: parsed.content.replace(/^\r?\n/, '') };
}

function saveArticle(relPath, frontMatter, body) {
  const abs = articleAbsPath(relPath);
  // 既存ファイルが TOML front matter (+++) なら形式を維持して保存する
  let useToml = false;
  try {
    useToml = fs.existsSync(abs) && isTomlFrontMatter(fs.readFileSync(abs, 'utf8'));
  } catch {
    // 判定できなければ YAML で保存
  }
  const content = '\n' + body.replace(/^\n+/, '');
  const raw = useToml
    ? matter.stringify(content, frontMatter, TOML_MATTER_OPTIONS)
    : matter.stringify(content, frontMatter);
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
  const normalized = String(sectionDir || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const section = effectiveSections().find((s) => s.dir === normalized);
  if (!section) throw new Error('不明なセクションです: ' + sectionDir);

  const now = new Date();
  const date = now.toISOString();
  const ymd = date.slice(0, 10);
  const pattern = site.config.newArticle.filenamePattern || '{date}-{slug}.md';
  let base = pattern.replace('{date}', ymd).replace('{slug}', slugify(title));

  const dir = path.join(site.hugoRoot, 'content', ...(section.dir ? section.dir.split('/') : []));
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
  const name = s.authorName || 'STV-HugoWriter';
  const email = s.authorEmail || 'hugowriter@users.noreply.local';
  return ['-c', `user.name=${name}`, '-c', `user.email=${email}`];
}

function isAuthError(text) {
  return /Authentication failed|could not read Username|Permission denied|403|Repository not found/i.test(text);
}

const AUTH_HELP =
  'リポジトリへの接続に失敗しました。GitHub へのサインインが済んでいるか、リポジトリへのアクセス権があるか確認してください。';

/** サイトフォルダが属する Git リポジトリのルートを返す (なければ null)。
 *  サイト本体がリポジトリのサブディレクトリでも正しく検出できるよう、
 *  git rev-parse --show-toplevel に問い合わせる。 */
async function getGitRoot() {
  if (!site.root) return null;
  const r = await runGit(['rev-parse', '--show-toplevel'], site.root);
  if (r.code !== 0) return null;
  const p = r.out.trim();
  return p ? path.normalize(p) : null;
}

async function gitInfo() {
  const ver = await runGit(['--version']);
  if (ver.code !== 0) return { gitInstalled: false, isRepo: false };
  if (!site.root) return { gitInstalled: true, isRepo: false };

  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    return { gitInstalled: true, isRepo: false };
  }
  const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot)).out.trim();
  const remote = (await runGit(['remote', 'get-url', 'origin'], gitRoot)).out.trim();
  const status = await runGit(['status', '--porcelain'], gitRoot);
  const changedCount = status.out.split('\n').filter((l) => l.trim()).length;

  let ahead = 0;
  let behind = 0;
  let hasUpstream = false;
  const lr = await runGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], gitRoot);
  if (lr.code === 0) {
    hasUpstream = true;
    const m = lr.out.trim().split(/\s+/);
    ahead = Number(m[0] || 0);
    behind = Number(m[1] || 0);
  }
  return { gitInstalled: true, isRepo: true, gitRoot, branch, remoteUrl: remote, changedCount, ahead, behind, hasUpstream };
}

/** 作業ツリーに変更があれば自動コミットする */
async function gitCommitAll(gitRoot) {
  const status = await runGit(['status', '--porcelain'], gitRoot);
  if (!status.out.trim()) return { committed: false };
  const add = await runGit(['add', '-A'], gitRoot);
  if (add.code !== 0) throw new Error('変更の取り込みに失敗しました:\n' + add.err.slice(-500));
  const s = loadUserSettings();
  const stamp = new Date().toLocaleString('ja-JP');
  const msg = `記事更新 (${s.authorName || '名前未設定'}, ${stamp})`;
  const commit = await runGit([...gitIdentityArgs(), 'commit', '-m', msg], gitRoot);
  if (commit.code !== 0) throw new Error('保存 (コミット) に失敗しました:\n' + (commit.err || commit.out).slice(-500));
  return { committed: true };
}

/** 最新を取得 (必要ならローカル変更を先に自動コミット) */
async function gitPull() {
  assertSiteOpen();
  const gitRoot = await getGitRoot();
  if (!gitRoot) throw new Error('このサイトは Git 管理されていません。');
  await gitCommitAll(gitRoot);
  const pull = await runGit([...gitIdentityArgs(), 'pull', '--rebase'], gitRoot);
  if (pull.code !== 0) {
    const text = pull.err + pull.out;
    if (/CONFLICT|could not apply|Resolve all conflicts/i.test(text)) {
      await runGit(['rebase', '--abort'], gitRoot);
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
  const gitRoot = await getGitRoot();
  if (!gitRoot) throw new Error('このサイトは Git 管理されていません。');
  const pulled = await gitPull();
  if (pulled.conflict) return pulled;
  const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot)).out.trim() || 'main';
  const push = await runGit(['push', '-u', 'origin', branch], gitRoot);
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
// サイトの公開 (FTP / FTPS アップロード)
// ---------------------------------------------------------------------------
// 接続先は管理者が wpgen.site.json の deploy に定義する。
// パスワードだけは各ユーザーの PC に暗号化して保存する (設定ファイルには書かない)。

function deployConfig() {
  const d = (site.config && site.config.deploy) || {};
  if (!d.host || !d.user) return null;
  return {
    protocol: d.protocol === 'ftps' ? 'ftps' : 'ftp',
    host: String(d.host),
    port: Number(d.port) || 21,
    user: String(d.user),
    remoteDir: String(d.remoteDir || '/'),
    baseURL: d.baseURL ? String(d.baseURL) : '',
  };
}

function secretsPath() {
  return path.join(app.getPath('userData'), 'deploy-secrets.json');
}

function secretKey(cfg) {
  return `${cfg.user}@${cfg.host}:${cfg.port}`;
}

function loadSecrets() {
  try {
    return JSON.parse(fs.readFileSync(secretsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function getSavedPassword(cfg) {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const enc = loadSecrets()[secretKey(cfg)];
  if (!enc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return null;
  }
}

function savePassword(cfg, password) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('この PC ではパスワードの暗号化保存が利用できません');
  }
  const secrets = loadSecrets();
  secrets[secretKey(cfg)] = safeStorage.encryptString(password).toString('base64');
  fs.mkdirSync(path.dirname(secretsPath()), { recursive: true });
  fs.writeFileSync(secretsPath(), JSON.stringify(secrets, null, 2), 'utf8');
}

function clearPassword(cfg) {
  const secrets = loadSecrets();
  delete secrets[secretKey(cfg)];
  fs.writeFileSync(secretsPath(), JSON.stringify(secrets, null, 2), 'utf8');
}

function deployState() {
  assertSiteOpen();
  const cfg = deployConfig();
  if (!cfg) return { configured: false };
  return {
    configured: true,
    protocol: cfg.protocol,
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    remoteDir: cfg.remoteDir,
    passwordSaved: !!getSavedPassword(cfg),
    canSavePassword: safeStorage.isEncryptionAvailable(),
  };
}

/** 公開用に Hugo をビルドする (下書きは含めない)。出力先のパスを返す */
function buildForPublish(cfg) {
  const hugo = findHugoBinary();
  if (!hugo) throw new Error('Hugo が見つかりません');
  const outDir = path.join(app.getPath('temp'), 'wpgen-publish');
  const args = [
    '--source', site.hugoRoot,
    '--destination', outDir,
    '--cleanDestinationDir',
    '--minify',
  ];
  if (cfg.baseURL) args.push('-b', cfg.baseURL);
  const r = spawnSync(hugo, args, { shell: hugo === 'hugo', windowsHide: true, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error('サイトのビルドに失敗しました:\n' + String(r.stderr || r.stdout || '').slice(-800));
  }
  if (!fs.existsSync(path.join(outDir, 'index.html'))) {
    throw new Error('ビルド結果に index.html がありません。サイト設定を確認してください');
  }
  return outDir;
}

let deployRunning = false;

async function deployRun(passwordInput, saveFlag) {
  assertSiteOpen();
  if (deployRunning) throw new Error('公開処理が既に実行中です');
  const cfg = deployConfig();
  if (!cfg) throw new Error('公開先が設定されていません (wpgen.site.json の deploy)。管理者に確認してください');

  const password = passwordInput || getSavedPassword(cfg);
  if (!password) throw new Error('パスワードを入力してください');

  deployRunning = true;
  const started = Date.now();
  const sendProgress = (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('deploy-progress', info);
    }
  };
  try {
    sendProgress({ phase: 'build' });
    const outDir = buildForPublish(cfg);

    sendProgress({ phase: 'connect' });
    const ftp = require('basic-ftp');
    const client = new ftp.Client(30000);
    try {
      await client.access({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password,
        secure: cfg.protocol === 'ftps',
      });
      let files = 0;
      client.trackProgress((info) => {
        if (info.type === 'upload') {
          sendProgress({ phase: 'upload', file: info.name, bytes: info.bytesOverall });
        }
      });
      // 総ファイル数 (進捗表示用)
      const countFiles = (dir) => {
        let n = 0;
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          n += ent.isDirectory() ? countFiles(path.join(dir, ent.name)) : 1;
        }
        return n;
      };
      files = countFiles(outDir);
      sendProgress({ phase: 'upload', total: files });
      await client.ensureDir(cfg.remoteDir);
      await client.uploadFromDir(outDir);
      client.trackProgress();

      // 接続に成功したときだけパスワードを保存する
      if (saveFlag && passwordInput) savePassword(cfg, passwordInput);

      const sec = Math.round((Date.now() - started) / 1000);
      return { files, seconds: sec };
    } finally {
      client.close();
    }
  } catch (e) {
    const msg = String(e.message || e);
    if (/530|Login incorrect|Authentication/i.test(msg)) {
      throw new Error('ログインに失敗しました。ユーザー名とパスワードを確認してください');
    }
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|Timeout/i.test(msg)) {
      throw new Error(`サーバに接続できません (${cfg.host}:${cfg.port})。ネットワークと接続先設定を確認してください`);
    }
    throw e;
  } finally {
    deployRunning = false;
  }
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

ipcMain.handle('articles:list', wrap(() => ({
  articles: listArticles(),
  sections: effectiveSections().map((s) => ({ dir: s.dir, label: s.label })),
})));
ipcMain.handle('articles:read', wrap((relPath) => readArticle(relPath)));
ipcMain.handle('articles:save', wrap((relPath, fm, body) => saveArticle(relPath, fm, body)));
ipcMain.handle('articles:create', wrap((section, title) => createArticle(section, title)));
ipcMain.handle('articles:delete', wrap((relPath) => deleteArticle(relPath)));

ipcMain.handle('git:info', wrap(async () => ({ info: await gitInfo() })));
ipcMain.handle('git:pull', wrap(() => gitPull()));
ipcMain.handle('git:sync', wrap(() => gitSync()));
ipcMain.handle('git:clone', wrap((url) => gitClone(url)));

ipcMain.handle('app:info', wrap(() => ({ version: app.getVersion() })));

ipcMain.handle('deploy:state', wrap(() => deployState()));
ipcMain.handle('deploy:run', wrap((password, save) => deployRun(password, save)));
ipcMain.handle('deploy:clearPassword', wrap(() => {
  const cfg = deployConfig();
  if (cfg) clearPassword(cfg);
  return { ok: true };
}));

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
    title: 'STV-HugoWriter',
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

/** 旧名 (HugoWriter) 時代のユーザー設定を新しい保存先へ引き継ぐ */
function migrateLegacyUserData() {
  try {
    const newDir = app.getPath('userData');
    const oldDir = path.join(app.getPath('appData'), 'HugoWriter');
    if (path.resolve(oldDir) === path.resolve(newDir) || !fs.existsSync(oldDir)) return;
    for (const name of ['settings.json', 'deploy-secrets.json']) {
      const src = path.join(oldDir, name);
      const dst = path.join(newDir, name);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.mkdirSync(newDir, { recursive: true });
        fs.copyFileSync(src, dst);
      }
    }
  } catch {
    // 引き継ぎに失敗しても初期状態で起動できればよい
  }
}

app.whenReady().then(() => {
  migrateLegacyUserData();
  createWindow();
});

app.on('window-all-closed', () => {
  stopPreview();
  app.quit();
});

app.on('before-quit', () => stopPreview());
