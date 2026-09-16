# サードパーティ ライセンス表記 (Third-Party Notices)

STV-HugoWriter は以下のオープンソースソフトウェア・フォントを利用・同梱しています。
各ソフトウェアの著作権は、それぞれの著作権者に帰属します。

## アプリケーションに同梱されるもの

| ソフトウェア | バージョン | ライセンス | 著作権 / 配布元 |
| --- | --- | --- | --- |
| [Hugo](https://gohugo.io/) (extended, `hugo.exe` として同梱) | 0.146.2 | Apache License 2.0 | The Hugo Authors — <https://github.com/gohugoio/hugo> |
| [Electron](https://www.electronjs.org/) | 38.x | MIT | OpenJS Foundation and contributors (Chromium / Node.js を含む) |
| [React](https://react.dev/) / react-dom | 19.x | MIT | Meta Platforms, Inc. and affiliates |
| [TOAST UI Editor](https://ui.toast.com/tui-editor) (@toast-ui/editor) | 3.2.x | MIT | NHN Cloud Corp. |
| [gray-matter](https://github.com/jonschlinkert/gray-matter) | 4.0.x | MIT | Jon Schlinkert |
| [@iarna/toml](https://github.com/iarna/iarna-toml) | 2.2.x | ISC | Rebecca Turner |
| [basic-ftp](https://github.com/patrickjuchli/basic-ftp) | 6.x | MIT | Patrick Juchli |
| [Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP) (@fontsource/noto-sans-jp 経由で同梱) | — | SIL Open Font License 1.1 | Google Inc. (Noto Project) |

- Hugo は Apache License 2.0 に基づき無改変のバイナリを同梱しています。
  ライセンス全文: [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt)
- Noto Sans JP フォントは SIL Open Font License 1.1 に基づき同梱しています。
  ライセンス全文: [licenses/NotoSansJP-OFL-1.1.txt](licenses/NotoSansJP-OFL-1.1.txt)
- MIT / ISC ライセンスの各ソフトウェアのライセンス全文は、リポジトリの
  `node_modules/<パッケージ名>/LICENSE` に含まれています。

## 開発時のみ使用しているもの (アプリには同梱されません)

Vite, TypeScript, electron-builder, @vitejs/plugin-react, cross-env, concurrently,
wait-on, ftp-srv (テスト用) — いずれも MIT / Apache-2.0 系のライセンスです。

## サンプルサイト

`sample-site/` のテーマ `wpgen-basic` は本プロジェクトの一部であり、MIT ライセンスです。
