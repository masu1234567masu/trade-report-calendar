# トレード収支管理アプリ

日経225マイクロ先物のトレード収支を記録・分析するための、個人利用のスタンドアロンWebアプリです。フレームワークは使わず、素のHTML/CSS/JSのみで構成されています。データの実体はGoogleスプレッドシートで、このアプリはそこに対して直接読み書きするフロントエンドです。

## 現状(段階的リリース中)

現在は「①データ疎通確認」の段階です。ログインしてスプレッドシートの読み書きができることを確認する画面のみが実装されています。カレンダー・グラフ・分析の各画面はこれから追加していきます。

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

## ディレクトリ構成

```
index.html       データ疎通確認画面(今後、タブ構成のメイン画面に拡張)
css/style.css    ダークベースのスタイル
js/config.js     設定値の読み書き(localStorage)
js/auth.js       Google Identity Servicesによる認証
js/sheets.js     Google Sheets API v4 の読み書きラッパー
js/app.js        画面のロジック
docs/            セットアップ手順書
```

## セキュリティについて

このリポジトリはPublicですが、コード中に秘密情報は含まれていません。OAuthクライアントID・スプレッドシートIDはブラウザのlocalStorageにのみ保存され、コードにはコミットされません。実際のデータへのアクセスには、その都度Googleアカウントでのログイン許可が必要です。
