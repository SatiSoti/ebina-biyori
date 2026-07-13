# 公開フォームの設定

1. 管理画面側の `supabase/expansion_schema.sql` が適用済みであることを確認します。
2. Supabase SQL Editorで `submission_schema.sql` を実行します。
3. Cloudflare Turnstileで公開サイトのドメインを登録し、サイトキーとシークレットキーを取得します。
4. `config.js` の `turnstileSiteKey` にサイトキーを設定します。
5. Edge FunctionのSecretsへ次を設定します。
   - `TURNSTILE_SECRET_KEY`
   - `RATE_LIMIT_SALT`（十分に長いランダム文字列）
   - `ALLOWED_ORIGINS`（例: `https://example.jp,https://www.example.jp`）
6. `submit-information` Edge Functionをデプロイします。`supabase/config.toml`でこの関数だけ従来のJWT検証を無効化し、関数内で新しい公開キー形式を検証します。

`submission_schema.sql` は再実行できます。改善要望を追加した場合や匿名送信へ更新した場合も、再実行後にEdge Functionを再デプロイしてください。

Supabaseが自動で用意する `SUPABASE_URL` と秘密鍵は、ブラウザや `config.js` へ記載しません。
