import { useEffect, useState } from 'react';
import { api, DeployProgress, DeployState } from '../types';

interface Props {
  root: string;
  onClose: () => void;
}

type Phase = 'form' | 'running' | 'done' | 'error';

export default function PublishDialog({ root, onClose }: Props) {
  const [state, setState] = useState<DeployState | null>(null);
  const [password, setPassword] = useState('');
  const [savePw, setSavePw] = useState(true);
  const [phase, setPhase] = useState<Phase>('form');
  const [progress, setProgress] = useState<DeployProgress | null>(null);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.deploy.state(root).then((r) => {
      if (r.ok) setState(r);
    });
  }, [root]);

  useEffect(() => {
    const off = api.deploy.onProgress((info) => {
      if (!info.siteId || info.siteId === root) setProgress(info);
    });
    return off;
  }, [root]);

  const run = async () => {
    setPhase('running');
    setError('');
    setProgress(null);
    const r = await api.deploy.run(root, password, savePw && !!password);
    if (r.ok) {
      setResult(`公開が完了しました (${r.files ?? '?'} ファイル / ${r.seconds ?? '?'} 秒)`);
      setPhase('done');
    } else {
      setError(r.error || '公開に失敗しました');
      setPhase('error');
    }
  };

  const forgetPassword = async () => {
    await api.deploy.clearPassword(root);
    const r = await api.deploy.state(root);
    if (r.ok) setState(r);
  };

  const progressLabel = () => {
    if (!progress) return '準備中…';
    if (progress.phase === 'build') return 'サイトをビルドしています…';
    if (progress.phase === 'connect') return 'サーバに接続しています…';
    const mb = progress.bytes ? ` (${(progress.bytes / 1024 / 1024).toFixed(1)} MB 送信済み)` : '';
    return `アップロード中… ${progress.file ?? ''}${mb}`;
  };

  const needPassword = !state?.passwordSaved;
  const running = phase === 'running';

  return (
    <div className="modal-backdrop" onClick={running ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>サイトを公開</h2>

        {!state && <p className="muted">読み込み中…</p>}

        {state && !state.configured && (
          <p className="admin-note">
            公開先が設定されていません。管理者がサイト設定ファイル (wpgen.site.json) の
            <code> deploy </code>に接続先を定義すると使えるようになります。
          </p>
        )}

        {state && state.configured && (phase === 'form' || phase === 'error') && (
          <div className="settings-body">
            <div className="deploy-summary">
              <div><span className="fm-label">接続先</span> {state.protocol?.toUpperCase()} / {state.host}:{state.port}</div>
              <div><span className="fm-label">ユーザー</span> {state.user}</div>
              <div><span className="fm-label">アップロード先</span> <code>{state.remoteDir}</code></div>
            </div>
            <p className="muted small">
              下書きの記事は公開されません。既にサーバにあるファイルは上書きされます。
            </p>
            {needPassword ? (
              <>
                <label className="fm-field full">
                  <span className="fm-label">FTP パスワード</span>
                  <input
                    type="password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && password) run();
                    }}
                  />
                </label>
                {state.canSavePassword && (
                  <label className="fm-field checkbox">
                    <input type="checkbox" checked={savePw} onChange={(e) => setSavePw(e.target.checked)} />
                    <span>この PC にパスワードを保存する (暗号化されます)</span>
                  </label>
                )}
              </>
            ) : (
              <p className="muted small">
                パスワードは保存済みです。
                <button className="btn small" style={{ marginLeft: 8 }} onClick={forgetPassword}>
                  保存したパスワードを削除
                </button>
              </p>
            )}
            {error && <p className="error prewrap">{error}</p>}
          </div>
        )}

        {running && (
          <div className="settings-body">
            <p>{progressLabel()}</p>
            <div className="progress-bar"><div className="progress-fill" /></div>
            <p className="muted small">完了するまでウィンドウを閉じないでください。</p>
          </div>
        )}

        {phase === 'done' && <p className="deploy-done">{result}</p>}

        <div className="modal-actions">
          {phase === 'done' ? (
            <button className="btn primary" onClick={onClose}>閉じる</button>
          ) : (
            <>
              <button className="btn" onClick={onClose} disabled={running}>キャンセル</button>
              {state?.configured && (
                <button
                  className="btn primary"
                  onClick={run}
                  disabled={running || (needPassword && !password)}
                >
                  {running ? '公開中…' : phase === 'error' ? '再試行' : '公開する'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
