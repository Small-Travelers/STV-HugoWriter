// @toast-ui/editor は package.json の exports 設定の都合で型が解決できないため、
// このアプリで使う範囲だけ最小限の型を宣言する。
declare module '@toast-ui/editor' {
  export interface EditorOptions {
    el: HTMLElement;
    height?: string;
    initialEditType?: 'wysiwyg' | 'markdown';
    previewStyle?: 'tab' | 'vertical';
    initialValue?: string;
    language?: string;
    usageStatistics?: boolean;
    autofocus?: boolean;
    hooks?: {
      addImageBlobHook?: (blob: Blob, callback: (url: string, altText?: string) => void) => void;
    };
  }

  export default class Editor {
    constructor(options: EditorOptions);
    getMarkdown(): string;
    setMarkdown(markdown: string): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
    destroy(): void;
  }
}

declare module '@toast-ui/editor/dist/i18n/ja-jp';
