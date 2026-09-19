# 実行テスト記録 — v2.0.0 / GitHub Pages版

実行日：2026-09-19。Linux、Node.js 22.16.0、Chromium 144.0.7559.96。
**GitHubへの公開・GitHub Actionsの実行は行っていない。** この記録は配布コードをこの作業環境で実行した結果。

## 結果一覧

| 検証 | 実行結果 |
|---|---|
| Node.js単体テスト | **211件成功、失敗0件**。旧機能162件＋静的サイト移行49件 |
| 既存ブラウザ基本検査 | **41項目成功**。74種類の描画設定を含む |
| v1.1由来の回帰試験 | **25項目成功**。128通りの注記位置、数字の中央・85%計算など |
| v1.2由来の回帰試験 | **42項目成功**。192通りの注記とアゲハマ位置、素材・所感・文字方向など |
| v1.3由来の回帰試験 | **60項目成功**。所感の掲載先・6方式・8レイアウト・JSON入出力など |
| 新しい静的サイト結合試験 | **25項目成功**。実HTTPで分割CSS/JS/画像を読み込み、操作・出力・パス分離・フォント入力を確認 |
| レイアウト組合せ | **384通り成功**。8レイアウト×4用紙×2方向×6時間方式。各3棋譜図に異なる所感 |
| v1.3.0との直接比較 | **48ケース・144ページ**で、ページ計画と60 dpiのCanvas PNGが完全一致 |
| 出力の照合 | 横3・縦3の**6ページ**でPDF内JPEG＝独立JPG、PNG＝300 dpiの基準描画 |
| CSPを有効にした独立試験 | ハッシュ付き単体HTMLでPDF・PNG ZIP・JPG ZIPを保存。CSP違反0、未処理JS例外0 |
| 開発用HTTPサーバー | 実HTTPのGET・MIME・公開外パスの404・POSTの405を確認 |
| 8レイアウトの見本 | 必須のみ／標準／全項目の24通りを確認し、8ページPDFを新規生成 |
| 配布PDF | 横3・縦3・素材1・時間6・レイアウト8＝**21ページ**をPyMuPDFで読込・画像化して確認 |

各検査には重なる組合せがある。すべての設定の総当たりを意味しない。
旧版のテスト記録を流用したのではなく、新しいコードで再実行した結果を `test-results/` へ収録した。
ファイル名にv110・v120・v130を含むスクリプトは、各版で追加された機能の回帰試験であり、今回の実行対象はv2.0.0。

## v1.3.0から表示を維持できているか

実際のv1.3.0 ZIP内の単体HTMLとv2の単体HTMLへ、同じ架空の235手SGFを入力。
8レイアウト×6時間方式の各ケースを100手ずつ3ページへ分割し、板目・那智黒・蛤・所感を含めて描画した。

ページ計画のJSONと各CanvasのPNG（60 dpi）を照合し、144ページすべて一致した。
これは比較した設定・同じ試験ブラウザでの結果であり、異なるOSやフォントでも画素が一致する保証ではない。
PDFのProducerを変更しているため、v1.3.0とv2.0.0のPDFファイル全体が同じバイト列になるという意味でもない。
`test-results/v130_parity.json` に設定とページのSHA-256を収録。

さらに、core.jsと板目PNGは旧版原本と同一であることを確認した。
基準ZIPのSHA-256等は `test-results/provenance.json` に記録。

## 分割ファイルの試験方法と制限

**この環境では管理ポリシーによってブラウザからlocalhostを含むURLへのナビゲーションが禁止されていた。管理設定は変更していない。**
そのため、新しい結合試験は `--no-navigation` で行った。

HTMLをabout:blankへセットし、ローカルHTTPサーバーを指す合成baseを試験だけに挿入している。
CSS・9個のJavaScript・板目PNGは、インラインへ置き換えず、実HTTPで別々に読み込んだ。
この試験モードでは合成オリジンの制約を避けるためCSPをバイパスし、localStorageはメモリ内の模擬Storageを使用した。
試験用サーバーのCORSヘッダーや合成base、模擬Storageは本体へ入れていない。

ルート `/`、`/KifuPrintWeb/`、`/nested/site/`、`/index.html`形の解決とHTTP 200を検査。
別リポジトリ相当のパスでは設定キーが分かれること、同じパスでは再初期化で戻ること、
SGF・所感・名前が保存文字列に含まれないこと、GAS版schema:1のJSONをUIから読み込めることを確認。

**実ブラウザのネイティブlocalStorageへの書込み、タブ／ブラウザ終了後の永続化、公開GitHub Pagesへの再訪は未確認。**
テスト内のrestore・reloadの成功は、上記の模擬保存領域に対する確認。
通常環境で `--no-navigation` を付けずに再実行すると、HTTPナビゲーションとネイティブStorageを使用する。

CSPそのものは別の `csp_smoke.py` で、バイパスを無効にして単体HTMLを実行した。
ハッシュ許可したアプリコードでSGF→板目描画→3形式の実保存ができ、違反イベントも発生しなかった。
ただし、これは公開Pagesのオリジンにおける分割ファイルのCSPを実測したものではない。

## PDF・PNG・JPGと所感

各ページに異なる所感を設定して、UIのダウンロードボタンで横書き・縦書きをそれぞれPDF、PNG ZIP、JPG ZIPとして保存。
6ページすべてについてPDF内JPEGと独立JPGはバイト単位で一致、PNGと同じページ計画を300 dpiで描いた画像は全画素一致した。
画像はA4縦2480×3508。JPEGは300 dpi、PNGは整数画素/メートル格納による丸め差を含む。
ZIPのCRC、用紙寸法、ページ数、所感領域が白紙でないことも検査。

プレビューは低解像度であるため、300 dpi出力と画素数が一致するという意味ではない。
プレビューと出力は同じページ計画・描画処理を使用する。配布するPDF21ページを100 dpiでレンダリングし、
タイトル、盤面、注記、所感、余白、文字欠落・はみ出しを確認した。

## 行書体・文字

旧版の漢数字1〜100の95%幾何検査は、日本語セリフの代替書体で再実行した。
手動フォント読込APIは環境内にある代替TTFで実行し、読込完了・不正データ拒否を確認。
**実物の行書体の字形・対応文字・最終的な見た目は未確認。** テスト用フォントのバイナリは一切同梱していない。

サイト内フォント取得のURL制限・25 MiB上限・HTTPエラー・タイムアウト・中止・不正形式等はNodeテストで検証。
ブラウザから公開サイトの実フォントへ接続した試験ではなく、HTTP応答とFontFaceの一部を模擬した単体試験である。

## 通信とプライバシー

分割版の結合試験では、初期のアプリ資産読込完了後、SGF入力・対局情報編集・PDF/PNG/JPG出力によるネットワーク要求の増加は0。
Google・GAS・外部CDN・外部サービスへの要求は0。
初期HTML/JS/CSS/画像の配信、将来運営者が設定する同一サイトフォントの取得、ホスティング側のアクセスログは別の話である。

## その他の未確認範囲

GitHub Pagesの実公開、GitHub Actionsテンプレートの実行、独自ドメイン、実際の行書体、
Android/iPhone実機、Safari/Firefox、プリンター実機、利用者の実ネットワーク・拡張機能との組合せは未確認。
スマホ確認は390×844のChromium表示領域によるもの。

## 再実行

通常の公開・利用にテスト環境は不要。開発時はNode.js 22以上、任意でPythonとtests/requirements.txtの依存、Chromiumを用意する。
Chromiumのパスは実機環境に合わせる。各試験は実行した版のソースから成果物を作る。

```sh
npm test
npm run check
npm run build
python tests/browser_smoke.py --chromium /usr/bin/chromium --output qa-smoke
python tests/revision_v110.py --chromium /usr/bin/chromium --output qa-v110
python tests/revision_v120.py --chromium /usr/bin/chromium --output qa-v120
python tests/revision_v130.py --chromium /usr/bin/chromium --output qa-v130
python tests/migration_v200.py --chromium /usr/bin/chromium --output qa-v200
python tests/csp_smoke.py --chromium /usr/bin/chromium --output qa-csp
python tests/verify_v130_outputs.py qa-v130
python tests/compare_v130.py --baseline /path/to/KifuPrintWeb_v1.3.0.zip --chromium /usr/bin/chromium --output qa-parity
python scripts/build_examples_v130.py --chromium /usr/bin/chromium
python scripts/build_proposals.py --chromium /usr/bin/chromium
```

今回の制限環境に限りrevision_v130.pyに `--offline-store`、migration_v200.pyに `--no-navigation` を付けた。
手動フォントAPIの試験はmigration_v200.pyに `--test-font /path/to/font.ttf` を追加する（配布物には取り込まない）。
通常環境では制限回避用フラグを外し、公開後にはDEPLOY.mdの実サイト確認手順も実施する。
