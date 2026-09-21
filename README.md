# 棋譜作成WEBフォーム v2.0.0 — GitHub Pages版

SGFを検査し、印刷用のPDF・PNG・JPGをブラウザ内で作る静的Webアプリ。
v1.3.0から棋譜機能を引き継ぎ、GASへの依存を取り除いた版です。
**GitHubにアップロードできるファイル一式であり、公開済みのWebサイトではありません。**

## 公開するには

GitHubリポジトリの直下に `index.html`、`js/`、`css/`、`assets/`、`.nojekyll` を置き、
**Settings → Pages → Deploy from a branch → main / (root) → Save** を選びます。
ZIPそのものではなく、展開した中身をアップロードしてください。
GitHub Freeで公開する基本手順はPublicリポジトリを前提にしています。

通常の公開にNode.js、npm install、ビルド、Googleアカウント認証、APIキーは不要です。
`Code.gs`・`appsscript.json` は使いません。公開後のURLはGitHubのPages設定画面で確認します。

詳しい操作は [公開手順](docs/DEPLOY.md)、GASからの移行は [移行メモ](docs/MIGRATION.md) を参照してください。

## 引き継いだ主な機能

- SGF選択・ドロップ・文字コード・全分岐の構文／着手検査。
- 常時プレビュー、左右の収納パネル、必須情報の検査、設定の折りたたみ。
- 総譜・分割・座標・数字／縦書き漢数字・注記・アゲハマ・木目・石の質感。
- 横書き5種／縦書き5種の対局情報、共通の微調整、6種類の持ち時間、所感の掲載ページ・ページ別本文。
- A3/A4/A5/B5、縦横、PDF/PNG/JPG、複数画像ZIP、表示設定の保存・JSON入出力。

## フォルダ

```text
index.html              公開する入口（小文字）
js/                     ブラウザ側JavaScript
  config.js             行書体などのサイト設定
  platform.js           相対URL・設定保存のサイト識別
  core.js               SGF解析・着手検査・設定
  assets.js             板目素材のパス
  render.js             レイアウト・描画
  preferences.js        表示設定保存・JSON入出力
  font-loader.js        GASを使わない行書体の読込
  export.js             PDF/PNG/JPG/ZIP
  ui.js                 画面操作
css/styles.css          画面のスタイル
assets/                 板目画像・アイコン
fonts/                  同梱フォント（TTF）
.nojekyll               静的配信用
scripts/                任意のビルド・確認サーバー・見本生成
samples/                架空の検証用SGF
standalone/index.html   単体プレビュー用・ビルドで再生成
examples/               v2.0.0で新たに出力した検証用PDF
/docs                   導入・移行・制約・実行テストの記録
```

`dist/` は `npm run build` で生成する「公開に必要なファイルだけ」のコピーです。
公開用軽量ZIPはその中身を収録しています。通常はリポジトリ直下から公開できるのでビルド不要です。

## 行書体

漢数字のデフォルトには `fonts/` 内の Yuji Syuku を使用します。ほかの同梱フォントや端末内のフォントも選べます。
詳細は [行書体の設定](assets/fonts/README.md) を参照してください。

## ローカル確認・開発（任意）

Node.js 22以上で、追加npmパッケージをインストールせずに実行できます。

```sh
npm test
npm run check
npm run build
npm run dev
# プロジェクトサイトのパスも再現できる
node scripts/serve.mjs --port 8080 --base /KifuPrintWeb/
```

表示されたlocalhost URLをブラウザで開きます（例：`http://127.0.0.1:8080/`）。HTTP確認サーバーは自分のPCからだけ接続できる設定です。
`index.html`を `file://` で直接開いた場合は、自動的に `standalone/index.html` へ移動します。単体版には板目画像と漢数字用のYuji Syukuを埋め込んでいます。
設定保存を含む本番相当の確認や、同梱された別フォントの確認にはローカルHTTPサーバーを使ってください。

## データと制限

SGF・対局情報・所感・生成物を送信するAPIや、広告・アクセス解析のコードはありません。
サイト本体と画像を取得する通常のHTTP通信は行います。運営者が行書体を設定した場合は、その取得も行います。
ホスティング事業者によるアクセスログまで無いという意味ではありません。

設定は手動保存方式。対局者名・所感本文・SGFは保存しません。GAS版とは配信元が違うため設定は自動移行されません。
GAS版で「設定を書き出す」→ v2で「設定を読み込む」→「表示設定を保存」で引き継げます。

合法性検査は死活・地合い・勝敗の再判定をしません。PDFは画像ベースです。
本番のGitHub Pages、実機スマートフォン、実プリンターでの検証範囲は [テスト報告書](docs/TEST_REPORT.md) に明記しています。

公開前に [素材・公開時の注意](docs/NOTICE.md) も確認してください。
