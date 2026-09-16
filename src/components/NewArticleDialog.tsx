import { useState } from 'react';
import { SectionDef } from '../types';

interface Props {
  sections: SectionDef[];
  onCreate: (section: string, title: string) => void;
  onCancel: () => void;
}

export default function NewArticleDialog({ sections, onCreate, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [section, setSection] = useState(sections[0]?.dir ?? '');

  const submit = () => {
    if (!title.trim()) return;
    onCreate(section, title.trim());
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>新しい記事</h2>
        <label className="fm-field full">
          <span className="fm-label">タイトル</span>
          <input
            type="text"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="記事のタイトルを入力"
          />
        </label>
        {sections.length > 1 && (
          <label className="fm-field full">
            <span className="fm-label">投稿先</span>
            <select value={section} onChange={(e) => setSection(e.target.value)}>
              {sections.map((s) => (
                <option key={s.dir} value={s.dir}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>キャンセル</button>
          <button className="btn primary" onClick={submit} disabled={!title.trim()}>
            作成
          </button>
        </div>
      </div>
    </div>
  );
}
