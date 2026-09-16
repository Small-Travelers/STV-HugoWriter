// preload で公開される API の型定義

export interface UserSettings {
  sitePath: string;
  authorName: string;
  editorFontSize: number;
  editorInitialMode: 'wysiwyg' | 'markdown';
  autosave: boolean;
  autosaveIntervalSec: number;
}

export interface SectionDef {
  dir: string;
  label: string;
}

export interface FrontMatterFieldDef {
  key: string;
  label: string;
  type: 'string' | 'text' | 'date' | 'boolean' | 'list';
  required?: boolean;
}

export interface SiteConfig {
  siteName: string;
  sections: SectionDef[];
  frontMatterFields: FrontMatterFieldDef[];
  newArticle: {
    filenamePattern: string;
    defaultFrontMatter: Record<string, unknown>;
  };
  deploy: Record<string, unknown>;
}

export interface ArticleSummary {
  path: string;
  section: string;
  sectionLabel: string;
  title: string;
  date: string;
  draft: boolean;
}

export type FrontMatter = Record<string, unknown>;

interface Res {
  ok: boolean;
  error?: string;
}

export interface WpgenApi {
  settings: {
    get(): Promise<Res & { settings: UserSettings }>;
    set(partial: Partial<UserSettings>): Promise<Res & { settings: UserSettings }>;
  };
  site: {
    selectFolder(): Promise<Res & { path: string | null }>;
    open(root: string): Promise<Res & { root?: string; config?: SiteConfig }>;
    getConfig(): Promise<Res & { root: string; config: SiteConfig }>;
  };
  articles: {
    list(): Promise<Res & { articles: ArticleSummary[] }>;
    read(path: string): Promise<Res & { frontMatter: FrontMatter; body: string }>;
    save(path: string, fm: FrontMatter, body: string): Promise<Res>;
    create(section: string, title: string): Promise<Res & { path: string }>;
    delete(path: string): Promise<Res>;
  };
  preview: {
    start(): Promise<Res & { url?: string }>;
    stop(): Promise<Res>;
    status(): Promise<Res & { running: boolean; url: string }>;
    onStopped(cb: (info: { code: number | null; stderr: string }) => void): () => void;
  };
}

declare global {
  interface Window {
    wpgen: WpgenApi;
  }
}

export const api = window.wpgen;
