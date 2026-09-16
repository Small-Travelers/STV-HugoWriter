import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ArticleSummary, GitInfo, SiteConfig, UserSettings } from './types';
import Sidebar from './components/Sidebar';
import EditorPane from './components/EditorPane';
import SettingsDialog from './components/SettingsDialog';
import NewArticleDialog from './components/NewArticleDialog';

type Screen = 'loading' | 'setup' | 'main';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [siteRoot, setSiteRoot] = useState('');
  const [hugoRoot, setHugoRoot] = useState('');
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [gitBusy, setGitBusy] = useState<'pull' | 'sync' | null>(null);
  const [gitDialogMsg, setGitDialogMsg] = useState('');
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [toast, setToast] = useState('');
  const gitBusyRef = useRef<typeof gitBusy>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 5000);
  }, []);

  const refreshArticles = useCallback(async () => {
    const r = await api.articles.list();
    if (r.ok) setArticles(r.articles);
  }, []);

  const refreshGit = useCallback(async () => {
    if (gitBusyRef.current) return;
    const r = await api.git.info();
    if (r.ok) setGitInfo(r.info);
  }, []);

  const openSite = useCallback(
    async (root: string) => {
      const r = await api.site.open(root);
      if (!r.ok) {
        setSetupError(r.error || 'サイトを開けませんでした');
        setScreen('setup');
        return false;
      }
      setSiteRoot(r.root!);
      setHugoRoot(r.hugoRoot || r.root!);
      setSiteConfig(r.config!);
      setSetupError('');
      setSelectedPath(null);
      setScreen('main');
      const list = await api.articles.list();
      if (list.ok) {
        setArticles(list.articles);
        // 開発用: ?autoselect=1 付きで起動したときは先頭の記事を開く
        const params = new URLSearchParams(window.location.search);
        if (params.has('autoselect') && list.articles.length > 0) {
          setSelectedPath(list.articles[0].path);
        }
        if (params.has('autopreview')) {
          const p = await api.preview.start();
          if (p.ok && p.url) setPreviewUrl(p.url);
        }
        if (params.has('autogit')) {
          const g = params.get('autogit') === 'pull' ? await api.git.pull() : await api.git.sync();
          showToast(g.ok ? `git: ${g.message || 'OK'}${g.conflict ? ' [conflict]' : ''}` : `git NG: ${g.error}`);
        }
      }
      refreshGit();
      return true;
    },
    [refreshGit, showToast]
  );

  useEffect(() => {
    (async () => {
      const info = await api.app.info();
      if (info.ok) setAppVersion(info.version);
      const r = await api.settings.get();
      if (r.ok) setSettings(r.settings);
      if (r.ok && r.settings.sitePath) {
        await openSite(r.settings.sitePath);
      } else {
        setScreen('setup');
      }
    })();
  }, [openSite]);

  useEffect(() => {
    const off = api.preview.onStopped(() => setPreviewUrl(''));
    return off;
  }, []);

  // ウィンドウにフォーカスが戻ったら Git 状態を確認し直す
  useEffect(() => {
    const onFocus = () => {
      if (screen === 'main') refreshGit();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [screen, refreshGit]);

  const handleSelectFolder = async () => {
    const r = await api.site.selectFolder();
    if (r.ok && r.path) await openSite(r.path);
  };

  const handleClone = async () => {
    if (!cloneUrl.trim()) return;
    setCloneBusy(true);
    setSetupError('');
    const r = await api.git.clone(cloneUrl.trim());
    setCloneBusy(false);
    if (!r.ok) {
      setSetupError(r.error || 'リポジトリの取得に失敗しました');
      return;
    }
    if (r.canceled || !r.root) return;
    await openSite(r.root);
  };

  const handleTogglePreview = async () => {
    if (previewUrl) {
      await api.preview.stop();
      setPreviewUrl('');
      return;
    }
    setPreviewLoading(true);
    const r = await api.preview.start();
    setPreviewLoading(false);
    if (r.ok && r.url) {
      setPreviewUrl(r.url);
    } else {
      showToast(r.error || 'プレビューを開始できませんでした');
    }
  };

  const runGitAction = async (kind: 'pull' | 'sync') => {
    if (gitBusy) return;
    setGitBusy(kind);
    gitBusyRef.current = kind;
    try {
      const r = kind === 'pull' ? await api.git.pull() : await api.git.sync();
      if (!r.ok) {
        setGitDialogMsg(r.error || '操作に失敗しました');
      } else if (r.conflict) {
        setGitDialogMsg(r.message || '競合が発生しました');
      } else {
        showToast(r.message || '完了しました');
      }
    } finally {
      setGitBusy(null);
      gitBusyRef.current = null;
    }
    await refreshArticles();
    await refreshGit();
    // 取得で記事ファイルが変わっている可能性があるため、開いている記事を読み直す
    setReloadNonce((n) => n + 1);
  };

  const handleCreate = async (section: string, title: string) => {
    const r = await api.articles.create(section, title);
    setShowNewDialog(false);
    if (r.ok) {
      await refreshArticles();
      setSelectedPath(r.path);
      refreshGit();
    } else {
      showToast(r.error || '記事を作成できませんでした');
    }
  };

  const handleDelete = async (path: string) => {
    const a = articles.find((x) => x.path === path);
    if (!window.confirm(`「${a?.title ?? path}」をごみ箱に移動しますか?`)) return;
    const r = await api.articles.delete(path);
    if (r.ok) {
      if (selectedPath === path) setSelectedPath(null);
      await refreshArticles();
      refreshGit();
      showToast('ごみ箱に移動しました');
    } else {
      showToast(r.error || '削除できませんでした');
    }
  };

  const handleSaved = useCallback(() => {
    refreshArticles();
    refreshGit();
  }, [refreshArticles, refreshGit]);

  if (screen === 'loading') {
    return <div className="center-screen">読み込み中…</div>;
  }

  if (screen === 'setup') {
    return (
      <div className="center-screen setup">
        <h1>HugoWriter へようこそ</h1>
        <p>
          記事を書く Hugo サイトのフォルダを選択してください。
          <br />
          (管理者から共有された、サイト一式が入ったフォルダです)
        </p>
        <button className="btn primary" onClick={handleSelectFolder}>
          サイトのフォルダを選択…
        </button>
        <div className="setup-divider">または</div>
        <p className="muted small">
          管理者から Git リポジトリの URL を受け取っている場合は、ここから取得できます。
        </p>
        <div className="clone-row">
          <input
            type="text"
            placeholder="https://github.com/団体名/サイト名.git"
            value={cloneUrl}
            onChange={(e) => setCloneUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleClone();
            }}
          />
          <button className="btn" onClick={handleClone} disabled={cloneBusy || !cloneUrl.trim()}>
            {cloneBusy ? '取得中…' : 'リポジトリから取得'}
          </button>
        </div>
        {setupError && <p className="error">{setupError}</p>}
        <div className="version-footer">HugoWriter v{appVersion}</div>
      </div>
    );
  }

  const gitReady = !!gitInfo?.gitInstalled && !!gitInfo?.isRepo;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <span className="site-name">{siteConfig?.siteName}</span>
          <span className="site-root" title={hugoRoot !== siteRoot ? `リポジトリ: ${siteRoot}\nサイト本体: ${hugoRoot}` : siteRoot}>
            {siteRoot}
            {hugoRoot !== siteRoot && (
              <span className="hugo-sub"> (サイト: {hugoRoot.slice(siteRoot.length).replace(/^[\\/]/, '')})</span>
            )}
          </span>
        </div>
        <div className="topbar-actions">
          {gitReady && (
            <div className="git-box">
              <span className="git-chip" title={gitInfo?.remoteUrl || ''}>
                <span className="git-branch">{gitInfo?.branch}</span>
                {gitInfo?.changedCount ? <span className="git-stat warn">変更 {gitInfo.changedCount}件</span> : <span className="git-stat">変更なし</span>}
                {gitInfo?.hasUpstream && (gitInfo.ahead || 0) > 0 && <span className="git-stat">↑{gitInfo.ahead}</span>}
                {gitInfo?.hasUpstream && (gitInfo.behind || 0) > 0 && <span className="git-stat">↓{gitInfo.behind}</span>}
              </span>
              <button className="btn" onClick={() => runGitAction('pull')} disabled={!!gitBusy}>
                {gitBusy === 'pull' ? '取得中…' : '最新を取得'}
              </button>
              <button className="btn" onClick={() => runGitAction('sync')} disabled={!!gitBusy}>
                {gitBusy === 'sync' ? '送信中…' : '変更を送信'}
              </button>
            </div>
          )}
          <button
            className={'btn ' + (previewUrl ? 'active' : '')}
            onClick={handleTogglePreview}
            disabled={previewLoading}
          >
            {previewLoading ? '起動中…' : previewUrl ? 'プレビューを閉じる' : 'サイトをプレビュー'}
          </button>
          <button className="btn" onClick={() => setShowSettings(true)}>設定</button>
        </div>
      </header>

      <div className="main-area">
        <Sidebar
          articles={articles}
          sections={siteConfig?.sections ?? []}
          selectedPath={selectedPath}
          onSelect={setSelectedPath}
          onNew={() => setShowNewDialog(true)}
          onDelete={handleDelete}
        />

        <div className="editor-col">
          {selectedPath && settings && siteConfig ? (
            <EditorPane
              key={`${selectedPath}#${reloadNonce}`}
              articlePath={selectedPath}
              siteConfig={siteConfig}
              settings={settings}
              onSaved={handleSaved}
              onError={showToast}
            />
          ) : (
            <div className="center-screen muted">
              左の一覧から記事を選ぶか、「新しい記事」を押してください
            </div>
          )}
        </div>

        {previewUrl && (
          <div className="preview-col">
            <div className="preview-bar">
              <span>プレビュー</span>
              <button
                className="btn small"
                onClick={() => {
                  const f = document.getElementById('preview-frame') as HTMLIFrameElement | null;
                  if (f) f.src = f.src;
                }}
              >
                再読み込み
              </button>
            </div>
            <iframe id="preview-frame" src={previewUrl} title="プレビュー" />
          </div>
        )}
      </div>

      {showSettings && settings && (
        <SettingsDialog
          settings={settings}
          siteConfig={siteConfig}
          siteRoot={siteRoot}
          appVersion={appVersion}
          gitInfo={gitInfo}
          onChangeSite={handleSelectFolder}
          onClose={async (updated) => {
            if (updated) {
              const r = await api.settings.set(updated);
              if (r.ok) setSettings(r.settings);
            }
            setShowSettings(false);
          }}
        />
      )}

      {showNewDialog && siteConfig && (
        <NewArticleDialog
          sections={siteConfig.sections}
          onCreate={handleCreate}
          onCancel={() => setShowNewDialog(false)}
        />
      )}

      {gitDialogMsg && (
        <div className="modal-backdrop" onClick={() => setGitDialogMsg('')}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>同期の結果</h2>
            <p className="prewrap">{gitDialogMsg}</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setGitDialogMsg('')}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
