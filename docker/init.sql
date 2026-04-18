-- ═══════════════════════════════════════════════════════════════════
-- SIDE.SOL — Consolidated Local Dev Schema
-- Runs in order: base schema → all migrations → RPCs → session columns
-- Mounted as /docker-entrypoint-initdb.d/99-sidesol.sql in the db container
-- ═══════════════════════════════════════════════════════════════════

-- ── SUPABASE-COMPATIBLE ROLES ─────────────────────────────────────
-- The supabase/postgres image does NOT pre-create these roles.
-- In the official self-hosted setup they come from volumes/db/roles.sql.
-- PostgREST switches to anon/authenticated per-request via SET ROLE,
-- so supabase_admin (our connecting role) must be granted them too.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin noinherit;
  end if;
end$$;

-- supabase_admin needs to be able to SET ROLE to these for PostgREST
grant anon, authenticated, service_role to supabase_admin;
grant anon, authenticated, service_role to authenticator;

-- ── AUTH SCHEMA STUB ──────────────────────────────────────────────
-- GoTrue populates this schema at runtime via its own migrations.
-- We create the schema + auth.uid() early so RLS policies compile.
-- GoTrue uses CREATE OR REPLACE for its functions, so this stub is
-- safely overwritten when the auth container first starts.
create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

-- ── PROFILES ──────────────────────────────────────────────────────
-- Note: no FK to auth.users — GoTrue owns that table and creates it
-- via its own migrations after the DB is up. Cascade deletes are not
-- needed for local dev; the FK exists in production (real Supabase).
create table if not exists profiles (
  id uuid primary key,
  name text not null default 'Anon',
  handle text unique,
  pfp text default '',
  method text default 'email',
  role text default '',
  bio text default '',
  notable boolean default false,
  tags text[] default '{}',
  privacy_public boolean default false,
  created_at timestamptz default now()
);

create index if not exists profiles_handle_idx on profiles (handle);

alter table profiles enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='Public profiles are viewable by everyone') then
    create policy "Public profiles are viewable by everyone"
      on profiles for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='Users can update own profile') then
    create policy "Users can update own profile"
      on profiles for update using ((select auth.uid()) = id);
  end if;
  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='Users can insert own profile') then
    create policy "Users can insert own profile"
      on profiles for insert with check ((select auth.uid()) = id);
  end if;
end $$;

-- ── EVENTS ────────────────────────────────────────────────────────
create table if not exists events (
  id bigint generated always as identity primary key,
  title text not null,
  cat text not null default 'Other',
  date date not null,
  time text default '',
  loc text not null,
  host text not null,
  "desc" text default '',
  rsvp boolean default false,
  hide_loc boolean default false,
  luma text default '',
  conf text not null default 'acc26',
  att integer default 0,
  capacity integer default 0,
  banner text default '',
  announcement text default '',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists events_conf_idx on events (conf);
create index if not exists events_date_idx on events (date);
create index if not exists events_created_by_idx on events (created_by);

alter table events enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='events' and policyname='Events are viewable by everyone') then
    create policy "Events are viewable by everyone"
      on events for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='events' and policyname='Authenticated users can create events') then
    create policy "Authenticated users can create events"
      on events for insert to authenticated
      with check ((select auth.uid()) = created_by);
  end if;
  if not exists (select 1 from pg_policies where tablename='events' and policyname='Users can update own events') then
    create policy "Users can update own events"
      on events for update to authenticated
      using ((select auth.uid()) = created_by);
  end if;
  if not exists (select 1 from pg_policies where tablename='events' and policyname='Users can delete own events') then
    create policy "Users can delete own events"
      on events for delete to authenticated
      using ((select auth.uid()) = created_by);
  end if;
end $$;

-- ── RSVPS ─────────────────────────────────────────────────────────
create table if not exists rsvps (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  event_id bigint not null references events(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, event_id)
);

create index if not exists rsvps_user_id_idx on rsvps (user_id);
create index if not exists rsvps_event_id_idx on rsvps (event_id);

alter table rsvps enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='rsvps' and policyname='RSVPs are viewable by everyone') then
    create policy "RSVPs are viewable by everyone"
      on rsvps for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='rsvps' and policyname='Users can manage own RSVPs') then
    create policy "Users can manage own RSVPs"
      on rsvps for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='rsvps' and policyname='Users can delete own RSVPs') then
    create policy "Users can delete own RSVPs"
      on rsvps for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end $$;

-- ── CHECK-INS ─────────────────────────────────────────────────────
create table if not exists checkins (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  event_id bigint not null references events(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, event_id)
);

create index if not exists checkins_user_id_idx on checkins (user_id);
create index if not exists checkins_event_id_idx on checkins (event_id);

alter table checkins enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='checkins' and policyname='Check-ins are viewable by everyone') then
    create policy "Check-ins are viewable by everyone"
      on checkins for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='checkins' and policyname='Users can create own check-ins') then
    create policy "Users can create own check-ins"
      on checkins for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
end $$;

-- ── BOOKMARKS ─────────────────────────────────────────────────────
create table if not exists bookmarks (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  event_id bigint not null references events(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, event_id)
);

create index if not exists bookmarks_user_id_idx on bookmarks (user_id);
create index if not exists bookmarks_event_id_idx on bookmarks (event_id);

alter table bookmarks enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='bookmarks' and policyname='Users can view own bookmarks') then
    create policy "Users can view own bookmarks"
      on bookmarks for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='bookmarks' and policyname='Users can manage own bookmarks') then
    create policy "Users can manage own bookmarks"
      on bookmarks for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='bookmarks' and policyname='Users can delete own bookmarks') then
    create policy "Users can delete own bookmarks"
      on bookmarks for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end $$;

-- ── FRIENDS ───────────────────────────────────────────────────────
create table if not exists friends (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  friend_id uuid not null references profiles(id) on delete cascade,
  is_vip boolean default false,
  created_at timestamptz default now(),
  unique(user_id, friend_id)
);

create index if not exists friends_user_id_idx on friends (user_id);
create index if not exists friends_friend_id_idx on friends (friend_id);

alter table friends enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='friends' and policyname='Users can view own friends') then
    create policy "Users can view own friends"
      on friends for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='friends' and policyname='Users can manage own friends') then
    create policy "Users can manage own friends"
      on friends for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='friends' and policyname='Users can update own friends') then
    create policy "Users can update own friends"
      on friends for update to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='friends' and policyname='Users can delete own friends') then
    create policy "Users can delete own friends"
      on friends for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end $$;

-- ── INCOGNITO ─────────────────────────────────────────────────────
create table if not exists incognito (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  event_id bigint not null references events(id) on delete cascade,
  unique(user_id, event_id)
);

create index if not exists incognito_user_id_idx on incognito (user_id);

alter table incognito enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='incognito' and policyname='Users can view own incognito') then
    create policy "Users can view own incognito"
      on incognito for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='incognito' and policyname='Users can manage own incognito') then
    create policy "Users can manage own incognito"
      on incognito for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='incognito' and policyname='Users can delete own incognito') then
    create policy "Users can delete own incognito"
      on incognito for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end $$;

-- ── PENDING FRIENDS ───────────────────────────────────────────────
create table if not exists pending_friends (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  friend_handle text not null,
  is_vip boolean default false,
  created_at timestamptz default now(),
  unique(user_id, friend_handle)
);

create index if not exists pending_friends_handle_idx on pending_friends (friend_handle);
create index if not exists pending_friends_user_id_idx on pending_friends (user_id);

alter table pending_friends enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='pending_friends' and policyname='Users can view own pending friends') then
    create policy "Users can view own pending friends"
      on pending_friends for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='pending_friends' and policyname='Users can manage own pending friends') then
    create policy "Users can manage own pending friends"
      on pending_friends for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='pending_friends' and policyname='Users can delete own pending friends') then
    create policy "Users can delete own pending friends"
      on pending_friends for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end $$;

-- ── ACTIVITY FEED ─────────────────────────────────────────────────
create table if not exists activity (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete cascade,
  action text not null,
  event_id bigint references events(id) on delete cascade,
  quest text default '',
  created_at timestamptz default now()
);

create index if not exists activity_created_at_idx on activity (created_at desc);
create index if not exists activity_event_id_idx on activity (event_id);

alter table activity enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='activity' and policyname='Activity is viewable by everyone') then
    create policy "Activity is viewable by everyone"
      on activity for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='activity' and policyname='Users can create own activity') then
    create policy "Users can create own activity"
      on activity for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════
-- MIGRATIONS (all ALTER TABLE additions, idempotent)
-- ═══════════════════════════════════════════════════════════════════

-- add-user-data-columns.sql
alter table profiles add column if not exists friends_data      jsonb default '[]'::jsonb;
alter table profiles add column if not exists vips_data         jsonb default '[]'::jsonb;
alter table profiles add column if not exists bmarks_data       jsonb default '[]'::jsonb;
alter table profiles add column if not exists rsvps_data        jsonb default '[]'::jsonb;
alter table profiles add column if not exists checkins_data     jsonb default '[]'::jsonb;
alter table profiles add column if not exists incog_data        jsonb default '[]'::jsonb;

-- add-approval-columns.sql
alter table profiles add column if not exists pending_requests_data jsonb default '[]'::jsonb;
alter table profiles add column if not exists approved_users_data   jsonb default '{}'::jsonb;

-- add-friend-requests.sql
alter table profiles add column if not exists friend_requests_data  jsonb default '[]'::jsonb;

-- add-luma-event-id.sql
alter table events add column if not exists "lumaEventId" text default '';

-- add-banner-pos.sql
alter table events add column if not exists "bannerPos" integer default 50;

-- current session: registration questions
alter table events   add column if not exists registration_questions jsonb default '[]'::jsonb;
alter table profiles add column if not exists reg_answers_data       jsonb default '{}'::jsonb;

-- ═══════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════

-- Auto-resolve pending friends when a new profile is created
create or replace function resolve_pending_friends()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.friends (user_id, friend_id, is_vip)
  select pf.user_id, new.id, pf.is_vip
  from public.pending_friends pf
  where lower(pf.friend_handle) = lower(new.handle)
  on conflict (user_id, friend_id) do nothing;

  delete from public.pending_friends
  where lower(friend_handle) = lower(new.handle);

  return new;
end;
$$;

drop trigger if exists on_profile_created_resolve_friends on profiles;
create trigger on_profile_created_resolve_friends
  after insert on profiles
  for each row execute function resolve_pending_friends();

drop trigger if exists on_profile_updated_resolve_friends on profiles;
create trigger on_profile_updated_resolve_friends
  after update of handle on profiles
  for each row
  when (old.handle is distinct from new.handle and new.handle is not null)
  execute function resolve_pending_friends();

-- Update event attendance count on RSVP insert/delete
create or replace function update_event_att()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.events set att = att + 1 where id = new.event_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.events set att = greatest(0, att - 1) where id = old.event_id;
    return old;
  end if;
end;
$$;

drop trigger if exists rsvp_att_inc on rsvps;
create trigger rsvp_att_inc after insert on rsvps
  for each row execute function update_event_att();

drop trigger if exists rsvp_att_dec on rsvps;
create trigger rsvp_att_dec after delete on rsvps
  for each row execute function update_event_att();

-- ═══════════════════════════════════════════════════════════════════
-- RPC FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════

-- resolve_pending_friends_json: called on new user sign-up to hydrate
-- pending friends from handle-based entries and send request notifications
create or replace function resolve_pending_friends_json(
  new_handle text,
  new_name   text,
  new_pfp    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row      record;
  updated_friends  jsonb;
  friend_entry     jsonb;
  new_user_requests jsonb;
  i int;
begin
  select coalesce(friend_requests_data, '[]'::jsonb) into new_user_requests
  from public.profiles where handle = new_handle;

  if new_user_requests is null then new_user_requests := '[]'::jsonb; end if;

  for profile_row in
    select id, name, handle, pfp, friends_data
    from public.profiles
    where friends_data::text ilike '%' || new_handle || '%'
  loop
    updated_friends := '[]'::jsonb;
    for i in 0..jsonb_array_length(profile_row.friends_data) - 1 loop
      friend_entry := profile_row.friends_data->i;
      if lower(friend_entry->>'handle') = lower(new_handle) then
        friend_entry := jsonb_build_object(
          'handle',  new_handle,
          'name',    new_name,
          'pfp',     new_pfp,
          'method',  'x',
          'role',    '',
          'bio',     '',
          'notable', false,
          'tags',    '[]'::jsonb,
          'pending', false
        );
        if not exists (
          select 1 from jsonb_array_elements(new_user_requests) v
          where v->>'handle' = profile_row.handle
        ) then
          new_user_requests := new_user_requests || jsonb_build_object(
            'handle', profile_row.handle,
            'name',   profile_row.name,
            'pfp',    coalesce(profile_row.pfp, ''),
            'ts',     now()
          );
        end if;
      end if;
      updated_friends := updated_friends || jsonb_build_array(friend_entry);
    end loop;
    update public.profiles set friends_data = updated_friends where id = profile_row.id;
  end loop;

  update public.profiles set friend_requests_data = new_user_requests where handle = new_handle;
end;
$$;

-- send_friend_request: writes an incoming request notification to the target's profile
create or replace function send_friend_request(
  sender_handle text,
  sender_name   text,
  sender_pfp    text,
  target_handle text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  curr jsonb;
begin
  select friend_requests_data into curr
  from public.profiles where handle = target_handle;

  if curr is null then curr := '[]'::jsonb; end if;

  if not exists (
    select 1 from jsonb_array_elements(curr) v
    where v->>'handle' = sender_handle
  ) then
    curr := curr || jsonb_build_object(
      'handle', sender_handle,
      'name',   sender_name,
      'pfp',    sender_pfp,
      'ts',     now()
    );
    update public.profiles set friend_requests_data = curr where handle = target_handle;
  end if;
end;
$$;

-- clear_friend_request: removes a request after accept/dismiss
create or replace function clear_friend_request(
  requester_handle text,
  my_handle        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  curr jsonb;
begin
  select friend_requests_data into curr
  from public.profiles where handle = my_handle;

  if curr is not null then
    curr := (
      select coalesce(jsonb_agg(v), '[]'::jsonb)
      from jsonb_array_elements(curr) v
      where v->>'handle' != requester_handle
    );
    update public.profiles set friend_requests_data = curr where handle = my_handle;
  end if;
end;
$$;

-- approve_event_request: moves a requester from pending → rsvp'd on their profile
-- Called by the event host from the pending requests list
create or replace function approve_event_request(
  requester_handle text,
  event_id         bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  curr_pending jsonb;
  curr_rsvps   jsonb;
begin
  select
    coalesce(pending_requests_data, '[]'::jsonb),
    coalesce(rsvps_data, '[]'::jsonb)
  into curr_pending, curr_rsvps
  from public.profiles
  where handle = requester_handle;

  if curr_pending is null then curr_pending := '[]'::jsonb; end if;
  if curr_rsvps   is null then curr_rsvps   := '[]'::jsonb; end if;

  -- Remove event_id from pending_requests_data
  curr_pending := (
    select coalesce(jsonb_agg(v), '[]'::jsonb)
    from jsonb_array_elements(curr_pending) v
    where v::text::bigint != event_id
  );

  -- Add event_id to rsvps_data (deduplicated)
  if not exists (
    select 1 from jsonb_array_elements(curr_rsvps) v
    where v::text::bigint = event_id
  ) then
    curr_rsvps := curr_rsvps || jsonb_build_array(event_id);
  end if;

  update public.profiles
  set
    pending_requests_data = curr_pending,
    rsvps_data            = curr_rsvps
  where handle = requester_handle;
end;
$$;

-- deny_event_request: removes a requester from pending without approving
create or replace function deny_event_request(
  requester_handle text,
  event_id         bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  curr_pending jsonb;
begin
  select coalesce(pending_requests_data, '[]'::jsonb)
  into curr_pending
  from public.profiles
  where handle = requester_handle;

  if curr_pending is null then curr_pending := '[]'::jsonb; end if;

  curr_pending := (
    select coalesce(jsonb_agg(v), '[]'::jsonb)
    from jsonb_array_elements(curr_pending) v
    where v::text::bigint != event_id
  );

  update public.profiles
  set pending_requests_data = curr_pending
  where handle = requester_handle;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- GRANTS  (PostgREST needs anon + authenticated to access public schema)
-- ═══════════════════════════════════════════════════════════════════
grant usage on schema public to anon, authenticated;
grant all on all tables    in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on function resolve_pending_friends_json(text,text,text) to authenticated;
grant execute on function send_friend_request(text,text,text,text)     to authenticated;
grant execute on function clear_friend_request(text,text)              to authenticated;
grant execute on function approve_event_request(text,bigint)           to authenticated;
grant execute on function deny_event_request(text,bigint)              to authenticated;
