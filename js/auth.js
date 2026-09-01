// Google OAuth2 の「リダイレクト方式」による認証。
// ポップアップは開かない(iOS Safariでポップアップがブロックされ、
// エラーも出ずに無反応になる問題を避けるため、ページ全体を遷移させて
// Googleのログイン画面に行き、戻ってきたURLのフラグメントから
// アクセストークンを受け取る)。
// サーバーを持たない静的サイトのため、アクセストークンは保存せず、
// 有効期限が切れたら再ログインしてもらう(初期実装の方針)。

const Auth = {
  STATE_KEY: "trc_oauth_state",

  redirectUri() {
    return window.location.origin + window.location.pathname;
  },

  login(clientId) {
    const state = String(Date.now()) + Math.random().toString(36).slice(2);
    sessionStorage.setItem(this.STATE_KEY, state);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri(),
      response_type: "token",
      scope: APP_CONFIG.scopes,
      include_granted_scopes: "true",
      state,
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  },

  // ページ読み込み時にURLフラグメントを確認し、ログイン直後の戻りであれば
  // アクセストークンを取り出す。戻り値: { token } | { error } | null
  consumeRedirectResult() {
    if (!window.location.hash) return null;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const hasToken = params.has("access_token");
    const hasError = params.has("error");
    if (!hasToken && !hasError) return null;

    // トークンをURLに残さないよう、確認したら消す。
    history.replaceState(null, "", window.location.pathname + window.location.search);

    const expectedState = sessionStorage.getItem(this.STATE_KEY);
    sessionStorage.removeItem(this.STATE_KEY);

    if (hasError) {
      return { error: params.get("error") };
    }
    if (expectedState && params.get("state") !== expectedState) {
      return { error: "state_mismatch" };
    }
    return { token: params.get("access_token") };
  },

  revoke(token, done) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
    }).finally(done);
  },
};
