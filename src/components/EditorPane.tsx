import { useCallback, useEffect, useRef, useState } from 'react';
import Editor from '@toast-ui/editor';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/i18n/ja-jp';
import { api, FrontMatter, SiteConfig, UserSettings } from '../types';
import FrontMatterForm from './FrontMatterForm';

interface Props {
  siteRoot: string;
  articlePath: string;
  siteConfig: SiteConfig;
  settings: UserSettings;
  onSaved: () => void;
  onError: (msg: string) => void;
}

type SaveState = 'clean' | 'dirty' | 'saving';

export default function EditorPane({ siteRoot, articlePath, siteConfig, settings, onSaved, onError }: Props) {
  const editorElRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const fmRef = useRef<FrontMatter>({});
  const saveStateRef = useRef<SaveState>('clean');
  const autosaveTimer = useRef<number | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [fm, setFm] = useState<FrontMatter>({});
  const [saveState, setSaveState] = useState<SaveState>('clean');
  const [savedAt, setSavedAt] = useState('');

  const updateSaveState = (s: SaveState) => {
    saveStateRef.current = s;
    setSaveState(s);
  };

  const doSave = useCallback(async () => {
    if (!editorRef.current || saveStateRef.current === 'saving') return;
    updateSaveState('saving');
    const body = editorRef.current.getMarkdown();
    const r = await api.articles.save(siteRoot, articlePath, fmRef.current, body);
    if (r.ok) {
      updateSaveState('clean');
      setSavedAt(new Date().toLocaleTimeString('ja-JP'));
      onSaved();
    } else {
      updateSaveState('dirty');
      onError(r.error || '保存に失敗しました');
    }
  }, [siteRoot, articlePath, onSaved, onError]);

  const markDirty = useCallback(() => {
    if (saveStateRef.current === 'clean') updateSaveState('dirty');
    if (settings.autosave) {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = window.setTimeout(() => {
        if (saveStateRef.current === 'dirty') doSave();
      }, Math.max(2, settings.autosaveIntervalSec) * 1000);
    }
  }, [settings.autosave, settings.autosaveIntervalSec, doSave]);

  // 記事の読み込みとエディタの生成
  useEffect(() => {
    let disposed = false;
    (async () => {
      const r = await api.articles.read(siteRoot, articlePath);
      if (!r.ok) {
        onError(r.error || '記事を読み込めませんでした');
        return;
      }
      if (disposed || !editorElRef.current) return;
      fmRef.current = { ...r.frontMatter };
      setFm(fmRef.current);
      const editor = new Editor({
        el: editorElRef.current,
        height: '100%',
        initialEditType: settings.editorInitialMode,
        previewStyle: 'vertical',
        initialValue: r.body,
        language: 'ja-JP',
        usageStatistics: false,
        autofocus: false,
      });
      editor.on('change', () => markDirty());
      editorRef.current = editor;
      setLoaded(true);
    })();
    return () => {
      disposed = true;
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      if (editorRef.current) {
        // 未保存の変更が残っていれば、閉じる前に保存しておく
        if (saveStateRef.current === 'dirty') {
          try {
            api.articles.save(siteRoot, articlePath, fmRef.current, editorRef.current.getMarkdown());
          } catch {
            // 保存できなくても閉じる処理は続行する
          }
        }
        editorRef.current.destroy();
        editorRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articlePath]);

  // Ctrl+S で保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        doSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doSave]);

  const handleFmChange = (key: string, value: unknown) => {
    fmRef.current = { ...fmRef.current, [key]: value };
    setFm(fmRef.current);
    markDirty();
  };

  const stateLabel =
    saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存の変更があります' : savedAt ? `保存済み (${savedAt})` : '保存済み';

  return (
    <div className="editor-pane" style={{ ['--editor-font-size' as string]: `${settings.editorFontSize}px` }}>
      <div className="editor-head">
        <FrontMatterForm fields={siteConfig.frontMatterFields} values={fm} onChange={handleFmChange} />
        <div className="save-row">
          <span className={'save-state ' + saveState}>{stateLabel}</span>
          <button className="btn primary" onClick={doSave} disabled={saveState === 'saving'}>
            保存 (Ctrl+S)
          </button>
        </div>
      </div>
      <div className="editor-body" ref={editorElRef} />
      {!loaded && <div className="center-screen muted">読み込み中…</div>}
    </div>
  );
}
