棋譜作成WEBフォーム v2.0.0 — GitHub Pages公開用

これはGASへ貼るファイルではなく、GitHub Pages用の静的Webアプリです。
まだGitHubへの公開は行っていません。

【公開】
1. ZIPを展開する（ZIPのままアップロードしない）。
2. GitHubでPublicリポジトリを作成する。
3. index.html、js/、css/、assets/、.nojekyllをリポジトリの直下へ置く。
   外側のフォルダごと入れない。index.htmlは小文字。
4. Settings > Pages > Deploy from a branch > main / (root) > Save。
5. Pagesの設定画面に表示されたURLを開く。

ビルド、APIキー、Code.gs、appsscript.json、Googleの権限設定は不要です。
.nojekyllが隠れている場合は、GitHub上のCreate new fileで同名の空ファイルを作成できます。

【行書体】
数字表記は追加設定不要です。フォント本体は含まれていません。
漢数字では端末の行書体を使用するか、画面で手元のTTF/OTF/WOFF/WOFF2を選択します。
公開可能なフォントを運営者が配置する場合は assets/fonts/README.md を確認してください。

【GAS版からの表示設定の移行】
GAS版で「設定を書き出す」→ v2で「設定を読み込む」→「表示設定を保存」。
別サイトになるため、自動で旧設定は引き継がれません。
所感・対局者名・SGFは表示設定の保存対象外です。

【公開前の注意】
SGFはブラウザ内で解析し、送信しません。通常のサイト資産取得は行います。
板目は利用者提供写真から作られたv1.3.0の素材を引き継いでいます。
写真や運営者が追加するフォントは、一般公開する権利があることを確認してください。
本番のGitHub Pages、ブラウザ終了後の設定永続化、実際の行書体、スマホ実機は未検証です。
詳細な説明・ソース・テスト結果は完全版ZIPにあります。

公式公開手順:
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
