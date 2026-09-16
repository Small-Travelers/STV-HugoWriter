import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ArticleSummary, GitInfo, SectionDef, SiteConfig, UserSettings } from '../types';
import Sidebar from './Sidebar';
import EditorPane from './EditorPane';
import SettingsDialog from './SettingsDialog';
import NewArticleDialog from './NewArticleDialog';
import PublishDialog from './PublishDialog';

interface Props {
  root: string;
  hugoRoot: string;
  config: SiteConfig;
  settings: UserSettings;
  active: boolean;
  isFirst: boolean;
  appVersion: string;
  showToast: (msg: string) => void;
  onSettingsSaved: (settings: UserSettings) => void;
}

/** 1つのサイト (タブ) 分の編集画面 */
export default function SiteWorkspace({
  root,
  hugoRoot,
  config,
  settings,
  active,
  isFirst,
  appVersion,
  showToast,
  onSettingsSaved,
}: Props) {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [listSections, setListSections] = useState<SectionDef[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // 記事の切り替え時にのみエディタを作り直すためのキー
  // (画像添付によるパス変更ではエディタを維持する)
  const [sessionId, setSessionId] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);

  const selectArticle = (p: string | null) => {
    setSelectedPath(p);
    setSessionId((n) => n + 1);
  };
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [gitBusy, setGitBusy] = useState<'pull' | 'sync' | null>(null);
  const [gitDialogMsg, setGitDialogMsg] = useState('');
  const [deployConfigured, setDeployConfigured] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const gitBusyRef = useRef<typeof gitBusy>(null);

  const refreshArticles = useCallback(async () => {
    const r = await api.articles.list(root);
    if (r.ok) {
      setArticles(r.articles);
      setListSections(r.sections ?? []);
    }
  }, [root]);

  const refreshGit = useCallback(async () => {
    if (gitBusyRef.current) return;
    const r = await api.git.info(root);
    if (r.ok) setGitInfo(r.info);
  }, [root]);

  // 初期読み込み
  useEffect(() => {
    (async () => {
      await refreshArticles();
      refreshGit();
      const d = await api.deploy.state(root);
      setDeployConfigured(!!(d.ok && d.configured));

      // 開発用フック (最初のタブのみ)
      if (isFirst) {
        const params = new URLSearchParams(window.location.search);
        if (params.has('autoselect')) {
          const list = await api.articles.list(root);
          if (list.ok && list.articles.length > 0) selectArticle(list.articles[0].path);
        }
        if (params.has('autopreview')) {
          const p = await api.preview.start(root);
          if (p.ok && p.url) setPreviewUrl(p.url);
        }
        if (params.has('autodeploy')) {
          const dep = await api.deploy.run(root, params.get('autodeploy') || '', false);
          showToast(dep.ok ? `deploy OK: ${dep.files} files / ${dep.seconds}s` : `deploy NG: ${dep.error}`);
        }
        if (params.has('autoimage')) {
          const list = await api.articles.list(root);
          const target = list.ok ? list.articles.find((a) => !a.isIndex) : null;
          if (target) {
            const svg =
              '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="160">' +
              '<rect width="360" height="160" fill="#2563eb"/>' +
              '<text x="180" y="90" font-size="28" fill="#fff" text-anchor="middle">テスト画像</text></svg>';
            const b64 = btoa(unescape(encodeURIComponent(svg)));
            const img = await api.articles.addImage(root, target.path, 'テスト画像.svg', b64);
            if (img.ok) {
              const art = await api.articles.read(root, img.path);
              if (art.ok) {
                await api.articles.save(root, img.path, art.frontMatter, `${art.body}\n\n![テスト画像](${img.name})\n`);
              }
              await refreshArticles();
              selectArticle(img.path);
              showToast(`image OK: ${img.path} / ${img.name}`);
            } else {
              showToast('image NG: ' + img.error);
            }
          }
        }
        if (params.has('autogit')) {
          const g = params.get('autogit') === 'pull' ? await api.git.pull(root) : await api.git.sync(root);
          showToast(g.ok ? `git: ${g.message || 'OK'}${g.conflict ? ' [conflict]' : ''}` : `git NG: ${g.error}`);
          await refreshArticles();
          refreshGit();
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // プレビューサーバが (異常) 終了したら表示を戻す
  useEffect(() => {
    const off = api.preview.onStopped((info) => {
      if (info.siteId === root) setPreviewUrl('');
    });
    return off;
  }, [root]);

  // アクティブなタブにフォーカスが戻ったら Git 状態を確認し直す
  useEffect(() => {
    if (!active) return;
    const onFocus = () => refreshGit();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [active, refreshGit]);

  // タブがアクティブになったときにも一覧と Git 状態を更新する
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      refreshArticles();
      refreshGit();
    }
    wasActive.current = active;
  }, [active, refreshArticles, refreshGit]);

  const handleTogglePreview = async () => {
    if (previewUrl) {
      await api.preview.stop(root);
      setPreviewUrl('');
      return;
    }
    setPreviewLoading(true);
    const r = await api.preview.start(root);
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
      const r = kind === 'pull' ? await api.git.pull(root) : await api.git.sync(root);
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
    const r = await api.articles.create(root, section, title);
    setShowNewDialog(false);
    if (r.ok) {
      await refreshArticles();
      selectArticle(r.path);
      refreshGit();
    } else {
      showToast(r.error || '記事を作成できませんでした');
    }
  };

  const handleDelete = async (path: string) => {
    const a = articles.find((x) => x.path === path);
    if (!window.confirm(`「${a?.title ?? path}」をごみ箱に移動しますか?`)) return;
    const r = await api.articles.delete(root, path);
    if (r.ok) {
      if (selectedPath === path) selectArticle(null);
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

  // 設定のセクションに加え、実際に記事が見つかったフォルダ (自動検出分) も表示する
  const sectionList = useMemo<SectionDef[]>(() => {
    const base = listSections.length > 0 ? listSections : config.sections ?? [];
    const list: SectionDef[] = base.map((s) => ({ ...s }));
    const have = new Set(list.map((s) => s.dir));
    for (const a of articles) {
      if (!have.has(a.section)) {
        have.add(a.section);
        list.push({ dir: a.section, label: a.sectionLabel || a.section || 'その他のページ' });
      }
    }
    return list;
  }, [listSections, config, articles]);

  const gitReady = !!gitInfo?.gitInstalled && !!gitInfo?.isRepo;

  return (
    <div className={'workspace' + (active ? '' : ' hidden')}>
      <header className="topbar">
        <div className="topbar-title">
          <span className="site-name">{config.siteName}</span>
          <span className="site-root" title={hugoRoot !== root ? `リポジトリ: ${root}\nサイト本体: ${hugoRoot}` : root}>
            {root}
            {hugoRoot !== root && (
              <span className="hugo-sub"> (サイト: {hugoRoot.slice(root.length).replace(/^[\\/]/, '')})</span>
            )}
          </span>
        </div>
        <div className="topbar-actions">
          {gitReady && (
            <div className="git-box">
              <span
                className="git-chip"
                title={[gitInfo?.remoteUrl, gitInfo?.gitRoot && `リポジトリ: ${gitInfo.gitRoot}`].filter(Boolean).join('\n')}
              >
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
          {deployConfigured && (
            <button className="btn publish" onClick={() => setShowPublish(true)}>サイトを公開</button>
          )}
          <button className="btn" onClick={() => setShowSettings(true)}>設定</button>
        </div>
      </header>

      <div className="main-area">
        <Sidebar
          articles={articles}
          sections={sectionList}
          selectedPath={selectedPath}
          onSelect={selectArticle}
          onNew={() => setShowNewDialog(true)}
          onDelete={handleDelete}
        />

        <div className="editor-col">
          {selectedPath ? (
            <EditorPane
              key={`s${sessionId}-r${reloadNonce}`}
              siteRoot={root}
              articlePath={selectedPath}
              siteConfig={config}
              settings={settings}
              onSaved={handleSaved}
              onError={showToast}
              onPathRenamed={setSelectedPath}
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
                  const frames = document.querySelectorAll<HTMLIFrameElement>('iframe.preview-frame');
                  frames.forEach((f) => {
                    if (f.dataset.site === root) f.src = f.src;
                  });
                }}
              >
                再読み込み
              </button>
            </div>
            <iframe className="preview-frame" data-site={root} src={previewUrl} title="プレビュー" />
          </div>
        )}
      </div>

      {showSettings && (
        <SettingsDialog
          settings={settings}
          siteConfig={config}
          siteRoot={root}
          appVersion={appVersion}
          gitInfo={gitInfo}
          onChangeSite={() => showToast('タブ左の「+」から別のサイトを開けます')}
          onClose={async (updated) => {
            if (updated) {
              const r = await api.settings.set(updated);
              if (r.ok) onSettingsSaved(r.settings);
            }
            setShowSettings(false);
          }}
        />
      )}

      {showNewDialog && (
        <NewArticleDialog
          sections={sectionList}
          onCreate={handleCreate}
          onCancel={() => setShowNewDialog(false)}
        />
      )}

      {showPublish && <PublishDialog root={root} onClose={() => setShowPublish(false)} />}

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
    </div>
  );
}
