import { useCallback, useEffect, useState } from 'react';
import { api, SiteConfig, UserSettings } from './types';
import SiteWorkspace from './components/SiteWorkspace';

interface TabInfo {
  root: string;
  hugoRoot: string;
  config: SiteConfig;
}

type Screen = 'loading' | 'welcome' | 'main';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeRoot, setActiveRoot] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);
  const [welcomeError, setWelcomeError] = useState('');
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 5000);
  }, []);

  const persistTabs = useCallback((nextTabs: TabInfo[], nextActive: string) => {
    api.settings.set({ openTabs: nextTabs.map((t) => t.root), activeTab: nextActive });
  }, []);

  /** サイトを開いてタブに追加する (既に開いていればアクティブ化) */
  const openTab = useCallback(
    async (root: string): Promise<boolean> => {
      const existing = tabs.find((t) => t.root.toLowerCase() === root.toLowerCase());
      if (existing) {
        setActiveRoot(existing.root);
        persistTabs(tabs, existing.root);
        setScreen('main');
        return true;
      }
      const r = await api.site.open(root);
      if (!r.ok) {
        setWelcomeError(r.error || 'サイトを開けませんでした');
        if (screen === 'main') showToast(r.error || 'サイトを開けませんでした');
        return false;
      }
      const tab: TabInfo = { root: r.root!, hugoRoot: r.hugoRoot || r.root!, config: r.config! };
      const nextTabs = [...tabs, tab];
      setTabs(nextTabs);
      setActiveRoot(tab.root);
      setWelcomeError('');
      setScreen('main');
      persistTabs(nextTabs, tab.root);
      return true;
    },
    [tabs, screen, persistTabs, showToast]
  );

  const closeTab = useCallback(
    async (root: string) => {
      await api.site.close(root);
      const nextTabs = tabs.filter((t) => t.root !== root);
      let nextActive = activeRoot;
      if (activeRoot === root) {
        nextActive = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].root : '';
      }
      setTabs(nextTabs);
      setActiveRoot(nextActive);
      persistTabs(nextTabs, nextActive);
      if (nextTabs.length === 0) setScreen('welcome');
    },
    [tabs, activeRoot, persistTabs]
  );

  const selectTab = useCallback(
    (root: string) => {
      setActiveRoot(root);
      persistTabs(tabs, root);
    },
    [tabs, persistTabs]
  );

  // 起動時: 前回開いていたタブを復元する
  useEffect(() => {
    (async () => {
      const info = await api.app.info();
      if (info.ok) setAppVersion(info.version);
      const r = await api.settings.get();
      if (!r.ok) {
        setScreen('welcome');
        return;
      }
      setSettings(r.settings);
      const roots = [...new Set(r.settings.openTabs || [])];
      const opened: TabInfo[] = [];
      for (const root of roots) {
        const o = await api.site.open(root);
        if (o.ok) {
          opened.push({ root: o.root!, hugoRoot: o.hugoRoot || o.root!, config: o.config! });
        }
      }
      if (opened.length === 0) {
        setScreen('welcome');
        return;
      }
      setTabs(opened);
      const active = opened.find((t) => t.root === r.settings.activeTab)?.root ?? opened[0].root;
      setActiveRoot(active);
      setScreen('main');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectFolder = async () => {
    const r = await api.site.selectFolder();
    if (r.ok && r.path) {
      const ok = await openTab(r.path);
      if (ok) setShowAddDialog(false);
    }
  };

  const handleClone = async () => {
    if (!cloneUrl.trim()) return;
    setCloneBusy(true);
    setWelcomeError('');
    const r = await api.git.clone(cloneUrl.trim());
    setCloneBusy(false);
    if (!r.ok) {
      setWelcomeError(r.error || 'リポジトリの取得に失敗しました');
      if (screen === 'main') showToast(r.error || 'リポジトリの取得に失敗しました');
      return;
    }
    if (r.canceled || !r.root) return;
    setCloneUrl('');
    const ok = await openTab(r.root);
    if (ok) setShowAddDialog(false);
  };

  if (screen === 'loading') {
    return <div className="center-screen">読み込み中…</div>;
  }

  if (screen === 'welcome') {
    return (
      <div className="center-screen setup">
        <h1>STV-HugoWriter へようこそ</h1>
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
        {welcomeError && <p className="error">{welcomeError}</p>}
        <div className="version-footer">STV-HugoWriter v{appVersion}</div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="tabbar">
        {tabs.map((t) => (
          <div
            key={t.root}
            className={'tab-item ' + (t.root === activeRoot ? 'active' : '')}
            title={t.root}
            onClick={() => selectTab(t.root)}
          >
            <span className="tab-name">{t.config.siteName}</span>
            <button
              className="tab-close"
              title="タブを閉じる"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.root);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button className="tab-add" title="別のサイトを開く" onClick={() => setShowAddDialog(true)}>
          +
        </button>
      </div>

      {tabs.map((t, i) => (
        <SiteWorkspace
          key={t.root}
          root={t.root}
          hugoRoot={t.hugoRoot}
          config={t.config}
          settings={settings!}
          active={t.root === activeRoot}
          isFirst={i === 0}
          appVersion={appVersion}
          showToast={showToast}
          onSettingsSaved={setSettings}
        />
      ))}

      {showAddDialog && (
        <div className="modal-backdrop" onClick={() => setShowAddDialog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>別のサイトを開く</h2>
            <div className="settings-body">
              <button className="btn primary wide" onClick={handleSelectFolder}>
                サイトのフォルダを選択…
              </button>
              <div className="setup-divider wide-divider">または Git リポジトリから取得</div>
              <div className="clone-row full-width">
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
                  {cloneBusy ? '取得中…' : '取得'}
                </button>
              </div>
              {welcomeError && <p className="error">{welcomeError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowAddDialog(false)}>キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
