# このリポジトリで作業する前に

トレード収支管理アプリ（個人利用・スタンドアロンHTML/JS）。過去に「動くはず」で報告してユーザーの実機で何度も再現した不具合があり、その教訓をここに残す。**画面・操作に関わる変更をする際は、このファイルを踏まえた上で作業すること。**

## 絶対に守ること

**UI/JSに変更を加えたら、pushする前に必ず `test/smoke-test.js` を実行し、実際にヘッドレスブラウザで操作して確認してから報告する。** コードを目で読んで「合っているはず」で報告するのは禁止。過去に何度もそれで見た目には気づけないCSS/ブラウザ固有の不具合を見逃し、ユーザーに何度も同じ実機テストをさせてしまった。

```bash
npm install playwright   # 初回のみ
python3 -m http.server 8123 &
node test/smoke-test.js
```

新しい画面(グラフ・分析など)を追加したら、`test/smoke-test.js` にもその画面の操作確認を追加すること。

## 過去に実際に起きた不具合と原因(同じミスを繰り返さないための記録)

### 1. `hidden`属性がCSSの`display`指定に上書きされる
`.modal-overlay { display: flex; }` や `#signed-in-area { display: flex; }` のように、要素にクラスで`display`を直接指定すると、HTML側の`hidden`属性(`display:none`)がCSSカスケードの優先順位で負けて効かなくなる。**author stylesheetの`display`指定は、`[hidden]`というUAスタイルより常に優先される。** 結果、非表示のはずのモーダルが常に画面全体を覆ってクリックを妨害したり、ログイン済み表示とログインボタンが同時に見えたりした。

**対策**：`display`を条件付きで切り替えたい要素には、必ず `セレクタ[hidden] { display: none; }` を明示的に追加すること。JSで`el.hidden = true/false`を使うすべての要素で、CSS側に`display`指定があるかどうかを毎回確認する。

### 2. Google Identity Services (GIS) の`async defer`読み込みとポップアップ認証がモバイルSafariと相性最悪
最初の実装は`google.accounts.oauth2.initTokenClient` + ポップアップでログインする方式だった。これは:
- GISスクリプトを`async defer`で読み込んでいたため、読み込み完了前にログインボタンを押すと`google`が未定義で例外が起き、エラー表示もなく「何も起きない」ように見えた。
- ポップアップ自体がiOS Safariでブロックされやすく、ブロックされてもエラーコールバックが呼ばれず無反応になることがある。

**対策として、認証はポップアップを一切使わない「リダイレクト方式」に変更済み**(`js/auth.js`の`Auth.login()`/`Auth.consumeRedirectResult()`)。ページ全体をGoogleのOAuth画面に遷移させ、`redirect_uri`付きで戻ってきたURLのフラグメントからトークンを受け取る。この方式を維持すること。ポップアップ方式に戻さない。

Google Cloud側では「承認済みのリダイレクトURI」に、末尾スラッシュまで含めて本番URL・ローカルURLを完全一致で登録する必要がある(`docs/GOOGLE_OAUTH_SETUP.md`参照)。

### 3. iOS Safariでボタンがダブルタップ＝ズーム扱いになりタップが効かない
`touch-action`を指定していないと、iOS Safariがボタン等の要素を「ズーム対象の普通のコンテンツ」として扱うことがあり、シングルタップが無反応・ダブルタップで拡大されるだけ、という分かりにくい壊れ方をする。**この症状(ダブルタップでズームする)が出たら、まずtouch-actionの指定漏れを疑うこと。**

**対策**：`button, summary, .cal-cell` に `touch-action: manipulation;` を指定済み(`css/style.css`)。新しくタップ操作を伴う要素を追加したら、同様に指定すること。

### 4. エラーメッセージが折りたたみ(`<details>`)の中のログにしか出ていなかった
接続設定パネルは`<details>`で折りたたまれており、その中の`#log-area`にしかエラーを出していなかったため、実際にはエラーが起きていても画面には何も変わったように見えなかった。

**対策**：ログイン関連など重要なエラーは、常に見える`#global-status`(画面上部)にも表示するようにした(`showGlobalError()`)。今後、新しいエラーメッセージを追加する際も、それが折りたたみの中だけに埋もれないか確認すること。

### 5. 設定(localStorage)は端末・ブラウザごとに別
OAuthクライアントID・スプレッドシートIDはlocalStorage保存のため、パソコンで設定してもiPhoneには反映されない(逆も同様)。「設定したのに動かない」と言われたら、まずその端末で接続設定が空になっていないかを疑うこと。

## デバッグ時に使えるツール

- ヘッドレスChromiumがこの環境に用意されている(`/opt/pw-browsers/chromium-*/chrome-linux/chrome`)。`npm install playwright`すれば`require("playwright")`でこの環境に用意された内容が使える。
- ただしこの開発環境からは `accounts.google.com` 等Google本体のドメインへの実通信はネットワークポリシーでブロックされている。本物のGoogleログイン画面をまたぐ部分(リダイレクト後にURLフラグメントへトークンが付いて戻ってくる、という前提)は、実際のURLを直接開いてトークン付きで戻ってきた状態を`page.goto("http://localhost:8123/#access_token=...")`のように再現してテストする(`test/smoke-test.js`参照)。実際にGoogle側と疎通する部分そのものは、この環境では自動テストできない、という限界を認識しておくこと。
- 同様に `cdnjs.cloudflare.com`(グラフ画面のChart.js読み込み元)もこの環境からはブロックされている。npmレジストリ(`registry.npmjs.org`)は使えるので、`npm pack chart.js@4.4.4` して展開した`package/dist/chart.umd.js`をローカルに置き、`SMOKE_TEST_CHARTJS_LOCAL_PATH`環境変数にそのパスを指定して`test/smoke-test.js`を実行すれば、cdnjsへのリクエストをそのファイルで代用してグラフ画面もテストできる。本番のGitHub Pages上では通常のインターネット接続からcdnjsに到達できるので、index.html側の読み込み先はcdnjsのままでよい(このワークアラウンドはこの開発環境でのテスト時のみ必要)。
