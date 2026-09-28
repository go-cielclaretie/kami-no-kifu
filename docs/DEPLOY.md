# GitHub Pages公開手順 — v2.0.0

この説明は2026-09-19に確認したGitHub公式資料に基づきます。
この配布物自体は未デプロイです。利用統計を使う場合は、先に「管理者向け統計設定」を完了してね。

## 方法A：ブラウザから公開する（ビルド不要）

1. GitHubにログインし、新しいリポジトリを作成します。例：`KifuPrintWeb`。
   GitHub Freeでの基本手順は **Public** を選びます。名前は任意です。
2. 公開用ZIPを展開します。GitHubの **Add file → Upload files** から、
   `index.html`、`privacy.html`、`js`、`css`、`assets`、`.nojekyll` をアップロードし、mainへコミットします。
   ZIPを1ファイルとして置いたり、外側の `KifuPrintWeb_v2.0.0` フォルダごと入れたりしないでください。
3. **Settings → Pages** を開きます。
4. **Build and deployment → Source → Deploy from a branch** を選びます。
5. **Branch: main / Folder: /(root)** を選び、Saveします。
6. Pages設定画面に表示される公開URLを開きます。公開処理の成否はActionsでも確認できます。
7. HTTPSの設定が変更可能な場合は **Enforce HTTPS** を有効にします。

公開URLの形式（例）：

```text
https://YOUR-USERNAME.github.io/KifuPrintWeb/
```

利用者は公開URLを開くだけで、GoogleログインもGitHubログインもアプリからは要求されません。
リポジトリのファイル閲覧URLやRaw表示のURLではなく、Pages設定に表示されたサイトURLを共有します。
GitHubのプラン・組織ポリシーによって使えるリポジトリの公開範囲は異なります。

### ファイル階層を確認

```text
（リポジトリの直下）
  index.html
  privacy.html
  .nojekyll
  js/
  css/
  assets/
```

`Index.html`ではなく **`index.html`** です。サイト画面全体をGASへ貼る方式ではなく、利用統計を有効にするときだけ受信側の `Code.gs` を別に設定します。
ブラウザのアップロード操作で隠しファイルが落ちた場合は、Add file → Create new fileで
`.nojekyll` を追加します。内容は空、または改行だけで構いません。

## 方法B：ソース管理と自動テストを組み合わせる（任意）

完全版をGitリポジトリとして管理する場合、`npm run build`で公開用 `dist/` ができます。
テスト用SGF・検証ログ・見本PDFをサイトに配信せず、アプリだけ公開するための構成です。

`docs/workflows/pages.yml.example` を `.github/workflows/pages.yml` にコピーし、
Settings → Pages → Sourceを **GitHub Actions** に変更してください。
このテンプレートはmainへのpush時にNodeテスト→ビルド→distの公開を行います。
Pythonのブラウザ試験は含みません。Actionsワークフロー自体はGitHub上で未実行です。

方法Aと方法Bは選択式です。テンプレートを置いただけで方法Aのまま使う構成にはしません。
外部公開を行うワークフローなので、使用前に内容と対象ブランチを確認してください。

## 公開後の確認

- Google・GitHubにログインしていないウィンドウでもページが表示される。
- サンプルSGFを選び、盤面・タイトル・所感が表示される。
- 板目を選んでPDF/PNG/JPGを保存できる（素材の404やCanvasエラーがない）。
- 表示設定を変更→保存→タブを閉じる→同じURLへ再訪して復元される。
- 旧GASの設定JSONを読み込み、表示を確認してから保存する。
- 漢数字を使う場合は行書体を設定し、プレビューと出力を確認する。
- 通常利用するスマホ・PC・プリンターでも確認する。

## 更新

変更したファイルを同じ公開元へコミットすると公開が更新されます。
URLを変えない限り、v2の設定保存キーは更新後も同じです。
ユーザー名・リポジトリ名をコードへ埋め込んでいないので、通常のプロジェクトパスで利用できます。

ファイル名末尾の `?v=2.0.0` はキャッシュ更新のための印です。次版へ変更する場合は
`index.html`のCSS/JS参照、`js/assets.js`の素材参照も更新してください。
Service Workerは導入していません。旧画面のままなら、公開処理の完了を確認したうえでページを再読み込みします。

## 利用統計を有効にする

利用統計は初期状態では無効。管理者が専用の受信先URLを設定して再公開した場合だけ送信する。
受信先に統計の読み出し機能はなく、集計結果は非公開スプレッドシートで確認する。
シートとApps Scriptの準備は [管理者向け統計設定](ANALYTICS_SETUP.md) を参照してね。

1. [管理者向け統計設定](ANALYTICS_SETUP.md) に従って `go.ciel.claretie@gmail.com` で非公開シートとApps Scriptを作り、ウェブアプリURLを発行する。
2. `js/config.js` の `analyticsEndpoint` に `/exec` で終わるURLを設定する。URLは公開ページから見えるので、秘密情報を含めない。
3. 方法Aなら `index.html`、`privacy.html`、`js`、`css`、`assets`、`.nojekyll` を更新する。方法Bなら `npm run build` 後の `dist/` を公開する。
4. 公開ページを開いて利用統計の案内を確認する。スプレッドシートは管理者だけに共有し、公開リンクを作らない。

Google Workspaceの組織ポリシーで匿名のウェブアプリ公開が許可されない場合は、受信先を空欄のままにすると計測は無効のままになる。

## よくある問題

| 症状 | 確認 |
|---|---|
| 404 | 公開元ブランチ、フォルダ、直下のindex.html、公開完了、共有URL |
| 読み込み中の表示が消えない | js・cssのアップロード漏れ、Console/Networkの404、CSP違反 |
| 板目だけ表示されない | assets/itame-grain.pngの有無・大文字小文字、同じサイトから配信されているか |
| 漢数字で保存ボタンが無効 | 行書体が未読込。フォント選択かassets/fonts/README.mdの運営者設定 |
| 設定が前と違う | GAS→Pagesの自動移行は不可。ブラウザ変更、別URL、サイトデータ削除も確認 |

## 公式資料

- 公開元の設定：https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- GitHub Pagesの仕組み・URL：https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- HTTPS：https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- Actions：https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
