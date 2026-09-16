import { FrontMatter, FrontMatterFieldDef } from '../types';

interface Props {
  fields: FrontMatterFieldDef[];
  values: FrontMatter;
  onChange: (key: string, value: unknown) => void;
}

// ISO 文字列 → datetime-local 入力用 (ローカル時刻)
function isoToLocal(iso: unknown): string {
  if (!iso) return '';
  const d = new Date(String(iso));
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function listToText(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'string') return v;
  return '';
}

function textToList(s: string): string[] {
  return s
    .split(/[,、]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function FrontMatterForm({ fields, values, onChange }: Props) {
  return (
    <div className="fm-form">
      {fields.map((f) => {
        const v = values[f.key];
        switch (f.type) {
          case 'boolean':
            return (
              <label key={f.key} className="fm-field checkbox">
                <input
                  type="checkbox"
                  checked={!!v}
                  onChange={(e) => onChange(f.key, e.target.checked)}
                />
                <span>{f.label}</span>
              </label>
            );
          case 'date':
            return (
              <label key={f.key} className="fm-field">
                <span className="fm-label">{f.label}</span>
                <input
                  type="datetime-local"
                  value={isoToLocal(v)}
                  onChange={(e) => onChange(f.key, localToIso(e.target.value))}
                />
              </label>
            );
          case 'list':
            return (
              <label key={f.key} className="fm-field">
                <span className="fm-label">{f.label}</span>
                <input
                  type="text"
                  placeholder="カンマ区切りで入力"
                  value={listToText(v)}
                  onChange={(e) => onChange(f.key, textToList(e.target.value))}
                />
              </label>
            );
          case 'text':
            return (
              <label key={f.key} className="fm-field full">
                <span className="fm-label">{f.label}</span>
                <textarea
                  rows={2}
                  value={typeof v === 'string' ? v : ''}
                  onChange={(e) => onChange(f.key, e.target.value)}
                />
              </label>
            );
          default:
            return (
              <label key={f.key} className={'fm-field' + (f.key === 'title' ? ' title-field full' : '')}>
                <span className="fm-label">
                  {f.label}
                  {f.required && <span className="req">*</span>}
                </span>
                <input
                  type="text"
                  value={v == null ? '' : String(v)}
                  onChange={(e) => onChange(f.key, e.target.value)}
                />
              </label>
            );
        }
      })}
    </div>
  );
}
