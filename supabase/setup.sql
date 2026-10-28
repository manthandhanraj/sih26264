-- Run once in your own Supabase SQL Editor. Contains no passwords or keys.
-- All app access goes through the server's service_role key, never the browser.
begin;
create table if not exists public.samanvay_state (
 id integer primary key check (id=1), revision bigint not null default 1,
 payload jsonb not null, users jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.samanvay_sessions (
 token_hash text primary key, user_id text not null, expires_at bigint not null
);
create index if not exists samanvay_sessions_expiry on public.samanvay_sessions(expires_at);
create table if not exists public.samanvay_login_attempts (
 email_hash text primary key, attempts integer not null, until_ms bigint not null
);
create table if not exists public.samanvay_import_drafts (
 id text primary key, user_id text not null, payload jsonb not null, expires_at bigint not null
);
create table if not exists public.samanvay_backups (
 id text primary key, manifest jsonb not null, created_at timestamptz not null default now()
);
alter table public.samanvay_state enable row level security;
alter table public.samanvay_sessions enable row level security;
alter table public.samanvay_login_attempts enable row level security;
alter table public.samanvay_import_drafts enable row level security;
alter table public.samanvay_backups enable row level security;
revoke all on public.samanvay_state,public.samanvay_sessions,public.samanvay_login_attempts,public.samanvay_import_drafts,public.samanvay_backups from anon,authenticated;
grant all on public.samanvay_state,public.samanvay_sessions,public.samanvay_login_attempts,public.samanvay_import_drafts,public.samanvay_backups to service_role;

create or replace function public.samanvay_open(p_seed jsonb default null,p_users jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_seed is not null then
  if jsonb_typeof(p_seed->'cases') <> 'array' or jsonb_typeof(p_users) <> 'array' then raise exception 'Invalid initial snapshot'; end if;
  insert into public.samanvay_state(id,payload,users) values(1,p_seed,p_users) on conflict(id) do nothing;
 end if;
 select jsonb_build_object('revision',s.revision,'state',s.payload,'users',s.users) into result from public.samanvay_state s where s.id=1;
 return result;
end $$;

create or replace function public.samanvay_save(p_revision bigint,p_state jsonb,p_draft_id text default null,p_draft_revision integer default null,p_draft_user text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer; draft public.samanvay_import_drafts;
begin
 if p_draft_id is not null then
  select * into draft from public.samanvay_import_drafts where id=p_draft_id for update;
  if not found or draft.user_id<>p_draft_user or (draft.payload->>'revision')::integer<>p_draft_revision or draft.expires_at<(extract(epoch from clock_timestamp())*1000)::bigint then return false; end if;
 end if;
 update public.samanvay_state set payload=p_state,revision=revision+1,updated_at=now() where id=1 and revision=p_revision;
 get diagnostics changed=row_count;
 if changed=1 and p_draft_id is not null then delete from public.samanvay_import_drafts where id=p_draft_id; end if;
 return changed=1;
end $$;

create or replace function public.samanvay_get_session(p_hash text)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('user_id',user_id,'expires_at',expires_at) from public.samanvay_sessions where token_hash=p_hash and expires_at>(extract(epoch from clock_timestamp())*1000)::bigint
$$;
create or replace function public.samanvay_start_session(p_hash text,p_user text,p_expires bigint,p_previous text default null)
returns void language plpgsql security invoker set search_path='' as $$
begin
 delete from public.samanvay_sessions where token_hash=p_previous or expires_at<(extract(epoch from clock_timestamp())*1000)::bigint;
 insert into public.samanvay_sessions values(p_hash,p_user,p_expires);
end $$;
create or replace function public.samanvay_end_session(p_hash text)
returns void language sql security invoker set search_path='' as $$ delete from public.samanvay_sessions where token_hash=p_hash $$;

create or replace function public.samanvay_login_attempt(p_email_hash text,p_reset boolean default false)
returns boolean language plpgsql security invoker set search_path='' as $$
declare ms bigint:=(extract(epoch from clock_timestamp())*1000)::bigint; n integer;
begin
 if p_reset then delete from public.samanvay_login_attempts where email_hash=p_email_hash; return true; end if;
 insert into public.samanvay_login_attempts as a values(p_email_hash,1,ms+900000)
 on conflict(email_hash) do update set attempts=case when a.until_ms<ms then 1 else least(a.attempts+1,1000) end,until_ms=case when a.until_ms<ms then ms+900000 else a.until_ms end returning attempts into n;
 return n<=8;
end $$;

create or replace function public.samanvay_get_draft(p_id text,p_user text)
returns jsonb language sql security invoker set search_path='' as $$
 select payload from public.samanvay_import_drafts where id=p_id and user_id=p_user and expires_at>(extract(epoch from clock_timestamp())*1000)::bigint
$$;
create or replace function public.samanvay_put_draft(p_id text,p_user text,p_payload jsonb,p_expected integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 if p_expected=0 then
  insert into public.samanvay_import_drafts values(p_id,p_user,p_payload,(p_payload->>'expiresAt')::bigint) on conflict(id) do nothing;
 else
  update public.samanvay_import_drafts set payload=p_payload where id=p_id and user_id=p_user and (payload->>'revision')::integer=p_expected and expires_at>(extract(epoch from clock_timestamp())*1000)::bigint;
 end if;
 get diagnostics changed=row_count; return changed=1;
end $$;
create or replace function public.samanvay_delete_draft(p_id text,p_user text)
returns void language sql security invoker set search_path='' as $$ delete from public.samanvay_import_drafts where id=p_id and user_id=p_user $$;
create or replace function public.samanvay_backup(p_id text default null,p_manifest jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_manifest is not null then insert into public.samanvay_backups(id,manifest) values(p_id,p_manifest); end if;
 if p_id is not null then select manifest into result from public.samanvay_backups where id=p_id;
 else select coalesce(jsonb_agg(manifest order by created_at desc),'[]'::jsonb) into result from (select manifest,created_at from public.samanvay_backups order by created_at desc limit 100) b; end if;
 return result;
end $$;
create or replace function public.samanvay_cleanup()
returns void language plpgsql security invoker set search_path='' as $$
declare ms bigint:=(extract(epoch from clock_timestamp())*1000)::bigint;
begin
 delete from public.samanvay_sessions where expires_at<ms;
 delete from public.samanvay_import_drafts where expires_at<ms;
 delete from public.samanvay_login_attempts where until_ms<ms;
end $$;

-- PostgreSQL grants EXECUTE to PUBLIC by default. Remove it for every app RPC.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname like 'samanvay\_%' escape '\' loop
  execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- Private bucket: no anonymous/authenticated object policies are created.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('samanvay-private','samanvay-private',false,5242880,array['application/pdf','image/png','image/jpeg','text/plain','application/json','application/gzip'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
commit;

-- Run the entire file, including COMMIT. Refresh the API after all grants exist.
notify pgrst, 'reload schema';
select
 (select count(*)::integer from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname like 'samanvay\_%' escape '\') as app_functions,
 (select not public from storage.buckets where id='samanvay-private') as private_bucket;
-- Expected result: app_functions = 11, private_bucket = true.
