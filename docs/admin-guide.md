# HugoWriter 管理者ガイド

このドキュメントは、サイトを管理する担当者向けです。
執筆メンバーには README の「使い方 (執筆者向け)」を案内してください。

## 全体の仕組み

- 各メンバーの PC に HugoWriter をインストールします。
- サイトの原稿一式 (Hugo プロジェクト) は Git の中央リポジトリで共有します。
  各メンバーはローカルにクローンされたフォルダを HugoWriter で開いて執筆します。
- **サイトに関する設定は、Hugo プロジェクト直下の `wpgen.site.json` に記述します。**
  このファイルはリポジトリと一緒に全員へ配布され、アプリからは閲覧のみ可能です。
  変更するのは管理者だけ、というルールで運用してください。
- 個人の執筆環境 (文字サイズ・自動保存・署名) は各ユーザーの PC 内
  (`%APPDATA%\HugoWriter\settings.json`) に保存され、サイトには影響しません。

## wpgen.site.json リファレンス

```json
{
  "siteName": "サイト名 (アプリ上部に表示)",
  "sections": [
    { "dir": "posts", "label": "投稿" },
    { "dir": "news", "label": "お知らせ" }
  ],
  "frontMatterFields": [
    { "key": "title", "label": "タイトル", "type": "string", "required": true },
    { "key": "date", "label": "日付", "type": "date" },
    { "key": "draft", "label": "下書き", "type": "boolean" },
    { "key": "tags", "label": "タグ", "type": "list" },
    { "key": "description", "label": "説明", "type": "text" }
  ],
  "newArticle": {
    "filenamePattern": "{date}-{slug}.md",
    "defaultFrontMatter": { "draft": true }
  },
  "deploy": {}
}
```

| 項目 | 説明 |
| --- | --- |
| `siteName` | アプリに表示するサイト名。未指定ならフォルダ名。 |
| `sections` | 執筆者が記事を作成できるセクション。`dir` は `content/` 配下のフォルダ名、`label` は画面表示名。 |
| `frontMatterFields` | 記事編集画面の入力欄。`type` は `string` (1行) / `text` (複数行) / `date` (日時) / `boolean` (チェック) / `list` (カンマ区切り)。 |
| `newArticle.filenamePattern` | 新規記事のファイル名。`{date}` = 作成日 (YYYY-MM-DD)、`{slug}` = タイトルから生成。 |
| `newArticle.defaultFrontMatter` | 新規記事に最初から入る front matter。`{ "draft": true }` を推奨。 |
| `deploy` | 将来の FTP アップロード機能用 (現時点では未使用)。 |

ファイルは UTF-8 で保存してください (BOM 付きでも可)。
JSON の書式が壊れているとサイトを開けなくなるので、変更後は自分の PC で一度開いて確認してから配布 (コミット) してください。

## Hugo について

- アプリには Hugo (extended) を同梱しているため、各メンバーの PC に Hugo を別途インストールする必要はありません。
- プレビューは `hugo server -D` (下書きを含む) をローカルで起動して表示しています。外部には公開されません。

## 運用のヒント

- 新しいサイトを立ち上げるときは、`sample-site` をひな形にすると簡単です
  (テーマ `wpgen-basic` と `wpgen.site.json` が入っています)。
- 記事の公開可否は front matter の `draft` で管理されます。公開ビルドには下書きは含まれません。
- 現時点の公開手順: 管理者の PC で `hugo` を実行して `public/` を生成し、サーバへアップロードします。
  (FTP アップロードと Git 連携のボタン化は今後のバージョンで追加予定)
