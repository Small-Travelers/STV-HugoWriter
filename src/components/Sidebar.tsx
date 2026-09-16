import { useMemo, useState } from 'react';
import { ArticleSummary, SectionDef } from '../types';

interface Props {
  articles: ArticleSummary[];
  sections: SectionDef[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onNew: () => void;
  onDelete: (path: string) => void;
}

const COLLAPSE_KEY = 'wpgen.collapsedSections';

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function Sidebar({ articles, sections, selectedPath, onSelect, onNew, onDelete }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);

  const toggleSection = (dir: string) => {
    const next = { ...collapsed, [dir]: !collapsed[dir] };
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
    } catch {
      // 保存できなくても動作には影響しない
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return articles;
    return articles.filter((a) => a.title.toLowerCase().includes(q) || a.path.toLowerCase().includes(q));
  }, [articles, query]);

  const bySection = useMemo(() => {
    const m = new Map<string, ArticleSummary[]>();
    for (const s of sections) m.set(s.dir, []);
    for (const a of filtered) {
      if (!m.has(a.section)) m.set(a.section, []);
      m.get(a.section)!.push(a);
    }
    return m;
  }, [filtered, sections]);

  const fmtDate = (iso: string) => (iso ? iso.slice(0, 10) : '');

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="btn primary wide" onClick={onNew}>+ 新しい記事</button>
        <input
          className="search"
          type="search"
          placeholder="記事を検索…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="article-list">
        {sections.map((s) => {
          const raw = bySection.get(s.dir) ?? [];
          // セクションの見出しページ (_index.md) は先頭に表示する
          const list = [...raw.filter((a) => a.isIndex), ...raw.filter((a) => !a.isIndex)];
          // 検索中は折りたたみを無視してヒットした記事を必ず見せる
          const isCollapsed = !query.trim() && !!collapsed[s.dir || '(root)'];
          return (
            <div key={s.dir} className="section-group">
              <button className="section-label" onClick={() => toggleSection(s.dir || '(root)')}>
                <span className={'caret ' + (isCollapsed ? 'closed' : '')}>▾</span>
                {s.label} <span className="count">{list.length}</span>
              </button>
              {isCollapsed ? null : (
                <>
                  {list.length === 0 && <div className="empty">記事がありません</div>}
                  {list.map((a) => (
                <div
                  key={a.path}
                  className={'article-item ' + (a.path === selectedPath ? 'selected' : '')}
                  onClick={() => onSelect(a.path)}
                >
                  <div className="article-item-main">
                    <span className="article-title">{a.title}</span>
                    <span className="article-meta">
                      {fmtDate(a.date)}
                      {a.isIndex && <span className="badge index">見出しページ</span>}
                      {a.subDir && <span className="badge subdir" title={a.subDir}>{a.subDir}</span>}
                      {a.draft && <span className="badge draft">下書き</span>}
                    </span>
                  </div>
                  <button
                    className="icon-btn delete"
                    title="削除"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(a.path);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
                </>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
