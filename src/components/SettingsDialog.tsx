import { useState } from 'react';
import { GitInfo, SiteConfig, UserSettings } from '../types';

interface Props {
  settings: UserSettings;
  siteConfig: SiteConfig | null;
  siteRoot: string;
  appVersion: string;
  gitInfo: GitInfo | null;
  onChangeSite: () => void;
  onClose: (updated: Partial<UserSettings> | null) => void;
}

export default function SettingsDialog({ settings, siteConfig, siteRoot, appVersion, gitInfo, onChangeSite, onClose }: Props) {
  const [tab, setTab] = useState<'user' | 'site'>('user');
  const [draft, setDraft] = useState<UserSettings>({ ...settings });

  return (
    <div className="modal-backdrop" onClick={() => onClose(null)}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>設定</h2>
        <div className="tabs">
          <button className={'tab ' + (tab === 'user' ? 'active' : '')} onClick={() => setTab('user')}>
            執筆環境 (自分用)
          </button>
          <button className={'tab ' + (tab === 'site' ? 'active' : '')} onClick={() => setTab('site')}>
            サイト設定 (管理者用)
          </button>
        </div>

        {tab === 'user' && (
          <div className="settings-body">
            <label className="fm-field full">
              <span className="fm-label">署名 (author に記録される名前)</span>
              <input
                type="text"
                value={draft.authorName}
                onChange={(e) => setDraft({ ...draft, authorName: e.target.value })}
                placeholder="例: 山田太郎"
              />
            </label>
            <label className="fm-field full">
              <span className="fm-label">メールアドレス (Git の更新履歴に記録されます)</span>
              <input
                type="text"
                value={draft.authorEmail}
                onChange={(e) => setDraft({ ...draft, authorEmail: e.target.value })}
                placeholder="例: yamada@example.com (空欄でも可)"
              />
            </label>
            <label className="fm-field">
              <span className="fm-label">エディタの文字サイズ</span>
              <select
                value={draft.editorFontSize}
                onChange={(e) => setDraft({ ...draft, editorFontSize: Number(e.target.value) })}
              >
                {[13, 14, 15, 16, 18, 20, 22].map((n) => (
                  <option key={n} value={n}>{n}px</option>
                ))}
              </select>
            </label>
            <label className="fm-field">
              <span className="fm-label">エディタの初期モード</span>
              <select
                value={draft.editorInitialMode}
                onChange={(e) =>
                  setDraft({ ...draft, editorInitialMode: e.target.value as UserSettings['editorInitialMode'] })
                }
              >
                <option value="wysiwyg">見たまま編集 (おすすめ)</option>
                <option value="markdown">Markdown</option>
              </select>
            </label>
            <label className="fm-field checkbox">
              <input
                type="checkbox"
                checked={draft.autosave}
                onChange={(e) => setDraft({ ...draft, autosave: e.target.checked })}
              />
              <span>自動保存を有効にする</span>
            </label>
            <div className="settings-note">
              <div className="fm-label">編集中のサイト</div>
              <code className="path">{siteRoot}</code>
              <button className="btn small" onClick={onChangeSite}>別のサイトを開く…</button>
            </div>
          </div>
        )}

        {tab === 'site' && (
          <div className="settings-body">
            <p className="admin-note">
              サイト設定は管理者が管理しています。変更が必要な場合は管理者に連絡してください。
              <br />
              (サイトフォルダ直下の <code>wpgen.site.json</code> で定義されています)
            </p>
            <pre className="config-view">{JSON.stringify(siteConfig, null, 2)}</pre>
          </div>
        )}

        <div className="modal-footer">
          <span className="version-label">
            STV-HugoWriter v{appVersion}
            {gitInfo && !gitInfo.gitInstalled && ' | Git 未インストール (同期機能は使えません)'}
          </span>
          <div className="modal-actions">
            <button className="btn" onClick={() => onClose(null)}>キャンセル</button>
            <button className="btn primary" onClick={() => onClose(draft)}>保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}
