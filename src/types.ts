// preload で公開される API の型定義

export interface UserSettings {
  sitePath: string;
  authorName: string;
  authorEmail: string;
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
  /** 選択フォルダから Hugo サイト本体への相対パス (管理者が任意で指定) */
  hugoDir?: string;
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
  /** セクション内でのサブフォルダ (例: "2026/09")。直下なら空文字 */
  subDir: string;
  /** _index.md (セクションやトップの見出しページ) かどうか */
  isIndex: boolean;
  title: string;
  date: string;
  draft: boolean;
}

export type FrontMatter = Record<string, unknown>;

export interface DeployState {
  configured: boolean;
  protocol?: 'ftp' | 'ftps';
  host?: string;
  port?: number;
  user?: string;
  remoteDir?: string;
  passwordSaved?: boolean;
  canSavePassword?: boolean;
}

export interface DeployProgress {
  phase: 'build' | 'connect' | 'upload';
  file?: string;
  bytes?: number;
  total?: number;
}

export interface GitInfo {
  gitInstalled: boolean;
  isRepo: boolean;
  /** Git リポジトリのルート (サイトがサブディレクトリの場合は親側になる) */
  gitRoot?: string;
  branch?: string;
  remoteUrl?: string;
  changedCount?: number;
  ahead?: number;
  behind?: number;
  hasUpstream?: boolean;
}

export interface GitResult {
  ok: boolean;
  error?: string;
  message?: string;
  conflict?: boolean;
}

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
    open(root: string): Promise<Res & { root?: string; hugoRoot?: string; config?: SiteConfig }>;
    getConfig(): Promise<Res & { root: string; hugoRoot: string; config: SiteConfig }>;
  };
  articles: {
    list(): Promise<Res & { articles: ArticleSummary[]; sections: SectionDef[] }>;
    read(path: string): Promise<Res & { frontMatter: FrontMatter; body: string }>;
    save(path: string, fm: FrontMatter, body: string): Promise<Res>;
    create(section: string, title: string): Promise<Res & { path: string }>;
    delete(path: string): Promise<Res>;
  };
  git: {
    info(): Promise<Res & { info: GitInfo }>;
    pull(): Promise<GitResult>;
    sync(): Promise<GitResult>;
    clone(url: string): Promise<Res & { canceled?: boolean; root?: string }>;
  };
  app: {
    info(): Promise<Res & { version: string }>;
  };
  deploy: {
    state(): Promise<Res & DeployState>;
    run(password: string, save: boolean): Promise<Res & { files?: number; seconds?: number }>;
    clearPassword(): Promise<Res>;
    onProgress(cb: (info: DeployProgress) => void): () => void;
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
