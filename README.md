# トレード収支管理アプリ

日経225マイクロ先物のトレード収支を記録・分析するための、個人利用のスタンドアロンWebアプリです。フレームワークは使わず、素のHTML/CSS/JSのみで構成されています。データの実体はGoogleスプレッドシートで、このアプリはそこに対して直接読み書きするフロントエンドです。

## 現状(段階的リリース中)

「①データ疎通確認」「②カレンダー画面(ホーム)」まで実装済みです。グラフ・分析の各画面はこれから追加していきます。

## セットアップ

### 1. Google Cloud側の準備

[docs/GOOGLE_OAUTH_SETUP.md](docs/GOOGLE_OAUTH_SETUP.md) の手順に従って、OAuthクライアントIDを発行してください。

### 2. データ保存先のスプレッドシートを用意

新規にGoogleスプレッドシートを作成し、URLからスプレッドシートID(`/d/`と`/edit`の間の文字列)を控えておきます。

### 3. アプリ側で接続設定

このアプリをブラウザで開き、「接続設定」欄に以下を入力して保存します(コードの編集やデプロイは不要、ブラウザのlocalStorageに保存されます)。

- OAuthクライアントID
- スプレッドシートID
- シート名(デフォルト: `Sheet1`)

### 4. ローカルで動作確認する場合

```bash
python3 -m http.server 8000
```

`http://localhost:8000` を開きます。OAuthクライアントIDの「承認済みのJavaScript生成元」に `http://localhost:8000` を追加しておく必要があります([docs/GOOGLE_OAUTH_SETUP.md](docs/GOOGLE_OAUTH_SETUP.md)参照)。

### 5. GitHub Pagesで公開する場合

リポジトリの Settings → Pages で、Source を「Deploy from a branch」、Branch を `main` / `root` に設定します。公開後のURL(`https://masu1234567masu.github.io/trade-report-calendar/`)を、OAuthクライアントIDの「承認済みのJavaScript生成元」に追加してください。

## 動作確認スクリプト(開発用)

画面のロジックを変更したときに、実際にブラウザを操作して壊れていないか確認するためのスクリプトです。見た目上は問題なさそうでも、CSSの指定次第でクリックが効かなくなるといった不具合はコードを読むだけでは見つけにくいため、変更のたびにこれを実行してから公開しています。

```bash
npm install playwright        # 初回のみ
python3 -m http.server 8123   # 別ターミナルでリポジトリ直下で起動したままにする
node test/smoke-test.js
```

ログインはヘッドレスブラウザでは自動化できないため、ログイン成功後の状態を偽装し、Google Sheets APIへの通信はスタブしています。カレンダーの表示・日付タップでのモーダル表示・保存・キャンセルが一通り動くこと、コンソールにエラーが出ていないことを確認します。

## ディレクトリ構成

```
index.html       メイン画面(タブ構成: ホーム/グラフ/分析)
css/style.css    ダークベースのスタイル
js/config.js     設定値の読み書き(localStorage)
js/auth.js       Google Identity Servicesによる認証
js/sheets.js     Google Sheets API v4 の読み書きラッパー
js/data.js       スプレッドシートの行データ・日次損益の計算
js/calendar.js   ホーム(カレンダー)画面の描画
js/modal.js      日付タップで開く記帳モーダル
js/graph.js      グラフ画面(期間切り替え・累積損益/総資産)
js/analysis.js   分析画面(年別・月別ドリルダウン・概要/期間指標)
js/app.js        画面全体の初期化・タブ切り替え・ログイン制御
docs/            セットアップ手順書
test/            動作確認スクリプト(開発用、公開サイトには含まれない)
```

## セキュリティについて

このリポジトリはPublicですが、コード中に秘密情報は含まれていません。OAuthクライアントID・スプレッドシートIDはブラウザのlocalStorageにのみ保存され、コードにはコミットされません。実際のデータへのアクセスには、その都度Googleアカウントでのログイン許可が必要です。
