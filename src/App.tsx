import { useCallback, useEffect, useState } from 'react';
import { api, ArticleSummary, SiteConfig, UserSettings } from './types';
import Sidebar from './components/Sidebar';
import EditorPane from './components/EditorPane';
import SettingsDialog from './components/SettingsDialog';
import NewArticleDialog from './components/NewArticleDialog';

type Screen = 'loading' | 'setup' | 'main';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [siteRoot, setSiteRoot] = useState('');
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 4000);
  }, []);

  const refreshArticles = useCallback(async () => {
    const r = await api.articles.list();
    if (r.ok) setArticles(r.articles);
  }, []);

  const openSite = useCallback(async (root: string) => {
    const r = await api.site.open(root);
    if (!r.ok) {
      setSetupError(r.error || 'サイトを開けませんでした');
      setScreen('setup');
      return false;
    }
    setSiteRoot(r.root!);
    setSiteConfig(r.config!);
    setSetupError('');
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
    }
    return true;
  }, []);

  useEffect(() => {
    (async () => {
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

  const handleSelectFolder = async () => {
    const r = await api.site.selectFolder();
    if (r.ok && r.path) await openSite(r.path);
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

  const handleCreate = async (section: string, title: string) => {
    const r = await api.articles.create(section, title);
    setShowNewDialog(false);
    if (r.ok) {
      await refreshArticles();
      setSelectedPath(r.path);
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
      showToast('ごみ箱に移動しました');
    } else {
      showToast(r.error || '削除できませんでした');
    }
  };

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
        {setupError && <p className="error">{setupError}</p>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <span className="site-name">{siteConfig?.siteName}</span>
          <span className="site-root" title={siteRoot}>{siteRoot}</span>
        </div>
        <div className="topbar-actions">
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
              key={selectedPath}
              articlePath={selectedPath}
              siteConfig={siteConfig}
              settings={settings}
              onSaved={refreshArticles}
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
