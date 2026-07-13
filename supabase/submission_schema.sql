-- 公開フォーム受付の追加設定
-- 管理画面側の supabase/expansion_schema.sql 適用後に、SQL Editorで一度実行します。

alter table public.information_submissions
  add column if not exists submission_type text not null default 'information',
  add column if not exists category text,
  add column if not exists request_fingerprint text,
  add column if not exists consented_at timestamptz;

do $$
begin
  alter table public.information_submissions
    drop constraint if exists information_submissions_type_check;
  alter table public.information_submissions
    add constraint information_submissions_type_check
    check (submission_type in ('information', 'correction', 'feedback'));
end $$;

create index if not exists information_submissions_rate_limit_idx
  on public.information_submissions (request_fingerprint, received_at desc)
  where deleted_at is null and request_fingerprint is not null;

-- 公開ブラウザからテーブルへ直接書き込ませません。
-- Edge Functionだけがservice_roleで保存し、管理者は既存RLSで確認します。
revoke all on public.information_submissions from anon;
grant select, insert, update, delete on public.information_submissions to authenticated;
