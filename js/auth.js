// Google Identity Services (GIS) を使ったトークンフロー認証。
// サーバーを持たない静的サイトのため、アクセストークンはメモリ上にのみ保持し、
// 有効期限が切れたら再ログインしてもらう(初期実装の方針)。

const Auth = {
  tokenClient: null,

  init(clientId, onTokenReceived, onError) {
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: APP_CONFIG.scopes,
      callback: (resp) => {
        if (resp.error) {
          onError(resp.error);
          return;
        }
        onTokenReceived(resp.access_token);
      },
    });
  },

  requestToken() {
    this.tokenClient.requestAccessToken({ prompt: "" });
  },

  revoke(token, done) {
    google.accounts.oauth2.revoke(token, done);
  },
};
