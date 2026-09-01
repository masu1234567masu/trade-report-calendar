// Google OAuth2 の「リダイレクト方式」による認証。
// ポップアップは開かない(iOS Safariでポップアップがブロックされ、
// エラーも出ずに無反応になる問題を避けるため、ページ全体を遷移させて
// Googleのログイン画面に行き、戻ってきたURLのフラグメントから
// アクセストークンを受け取る)。
//
// アクセストークンはlocalStorageに有効期限付きで保存し、切れる前は
// 再ログイン不要にする(app.jsのsaveAccessToken/loadCachedAccessToken)。
// 期限が切れていても、ブラウザにGoogleのログインセッションが残っていれば
// loginSilent()(prompt=none)でタップ不要のまま再取得できる。

const Auth = {
  STATE_KEY: "trc_oauth_state",
  SILENT_KEY: "trc_oauth_silent",

  redirectUri() {
    return window.location.origin + window.location.pathname;
  },

  login(clientId, { silent = false } = {}) {
    const state = String(Date.now()) + Math.random().toString(36).slice(2);
    sessionStorage.setItem(this.STATE_KEY, state);
    if (silent) sessionStorage.setItem(this.SILENT_KEY, "1");
    else sessionStorage.removeItem(this.SILENT_KEY);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri(),
      response_type: "token",
      scope: APP_CONFIG.scopes,
      include_granted_scopes: "true",
      state,
    });
    if (silent) params.set("prompt", "none");
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  },

  // 同意画面を出さず、既存のGoogleログインセッションがあればトークンだけを
  // 静かに取り直す。ユーザーがGoogle自体からログアウトしている等で失敗しても、
  // 通常の「Googleでログイン」ボタンを表示する状態に戻るだけで、エラー表示はしない
  // (呼び出し側であるapp.jsがconsumeRedirectResult()のsilentフラグを見て判断する)。
  loginSilent(clientId) {
    this.login(clientId, { silent: true });
  },

  // ページ読み込み時にURLフラグメントを確認し、ログイン直後の戻りであれば
  // アクセストークンを取り出す。戻り値: { token, expiresIn } | { error, silent } | null
  consumeRedirectResult() {
    if (!window.location.hash) return null;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const hasToken = params.has("access_token");
    const hasError = params.has("error");
    if (!hasToken && !hasError) return null;

    // トークンをURLに残さないよう、確認したら消す。
    history.replaceState(null, "", window.location.pathname + window.location.search);

    const expectedState = sessionStorage.getItem(this.STATE_KEY);
    const wasSilent = sessionStorage.getItem(this.SILENT_KEY) === "1";
    sessionStorage.removeItem(this.STATE_KEY);
    sessionStorage.removeItem(this.SILENT_KEY);

    if (hasError) {
      return { error: params.get("error"), silent: wasSilent };
    }
    if (expectedState && params.get("state") !== expectedState) {
      return { error: "state_mismatch", silent: wasSilent };
    }
    const expiresIn = Number(params.get("expires_in")) || 3600;
    return { token: params.get("access_token"), expiresIn };
  },

  revoke(token, done) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
    }).finally(done);
  },
};
