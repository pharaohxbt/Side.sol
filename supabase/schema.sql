-- ═══════════════════════════════════════════════
-- SIDE.SOL — Supabase Schema
-- Run this in the Supabase SQL Editor
-- ═══════════════════════════════════════════════

-- ── PROFILES ──
-- Stores user profile data (synced from auth on sign-in)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
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

create index profiles_handle_idx on profiles (handle);

alter table profiles enable row level security;

create policy "Public profiles are viewable by everyone"
  on profiles for select using (true);

create policy "Users can update own profile"
  on profiles for update using ((select auth.uid()) = id);

create policy "Users can insert own profile"
  on profiles for insert with check ((select auth.uid()) = id);

-- ── EVENTS ──
create table events (
  id bigint generated always as identity primary key,
  title text not null,
  cat text not null default 'Other',
  date date not null,
  time text default '',
  loc text not null,
  host text not null,
  "desc" text default '',
  rsvp boolean default false,
  luma text default '',
  conf text not null default 'acc26',
  att integer default 0,
  capacity integer default 0,
  banner text default '',
  announcement text default '',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

create index events_conf_idx on events (conf);
create index events_date_idx on events (date);
create index events_created_by_idx on events (created_by);

alter table events enable row level security;

create policy "Events are viewable by everyone"
  on events for select using (true);

create policy "Authenticated users can create events"
  on events for insert to authenticated
  with check ((select auth.uid()) = created_by);

create policy "Users can update own events"
  on events for update to authenticated
  using ((select auth.uid()) = created_by);

create policy "Users can delete own events"
  on events for delete to authenticated
  using ((select auth.uid()) = created_by);

-- ── RSVPS ──
create table rsvps (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  event_id bigint not null references events(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, event_id)
);

create index rsvps_user_id_idx on rsvps (user_id);
create index rsvps_event_id_idx on rsvps (event_id);

alter table rsvps enable row level security;

create policy "RSVPs are viewable by everyone"
  on rsvps for select using (true);

create policy "Users can manage own RSVPs"
  on rsvps for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own RSVPs"
  on rsvps for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ── CHECK-INS ──
create table checkins (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  event_id bigint not null references events(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, event_id)
);

create index checkins_user_id_idx on checkins (user_id);
create index checkins_event_id_idx on checkins (event_id);

alter table checkins enable row level security;

create policy "Check-ins are viewable by everyone"
  on checkins for select using (true);

create policy "Users can create own check-ins"
  on checkins for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- ── BOOKMARKS ──
create table bookmarks (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  event_id bigint not null references events(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, event_id)
);

create index bookmarks_user_id_idx on bookmarks (user_id);
create index bookmarks_event_id_idx on bookmarks (event_id);

alter table bookmarks enable row level security;

create policy "Users can view own bookmarks"
  on bookmarks for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can manage own bookmarks"
  on bookmarks for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own bookmarks"
  on bookmarks for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ── FRIENDS ──
create table friends (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  friend_id uuid not null references profiles(id) on delete cascade,
  is_vip boolean default false,
  created_at timestamptz default now(),
  unique(user_id, friend_id)
);

create index friends_user_id_idx on friends (user_id);
create index friends_friend_id_idx on friends (friend_id);

alter table friends enable row level security;

create policy "Users can view own friends"
  on friends for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can manage own friends"
  on friends for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own friends"
  on friends for update to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can delete own friends"
  on friends for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ── INCOGNITO (hidden events per user) ──
create table incognito (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  event_id bigint not null references events(id) on delete cascade,
  unique(user_id, event_id)
);

create index incognito_user_id_idx on incognito (user_id);

alter table incognito enable row level security;

create policy "Users can view own incognito"
  on incognito for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can manage own incognito"
  on incognito for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own incognito"
  on incognito for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ── PENDING FRIENDS ──
-- Stores friend requests by handle for users who haven't signed up yet
create table pending_friends (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  friend_handle text not null,
  is_vip boolean default false,
  created_at timestamptz default now(),
  unique(user_id, friend_handle)
);

create index pending_friends_handle_idx on pending_friends (friend_handle);
create index pending_friends_user_id_idx on pending_friends (user_id);

alter table pending_friends enable row level security;

create policy "Users can view own pending friends"
  on pending_friends for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can manage own pending friends"
  on pending_friends for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own pending friends"
  on pending_friends for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ── AUTO-RESOLVE: When a new profile is created, convert pending friends ──
create or replace function resolve_pending_friends()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Find all pending_friends entries that match this new profile's handle
  -- and convert them to real friend connections
  insert into public.friends (user_id, friend_id, is_vip)
  select pf.user_id, new.id, pf.is_vip
  from public.pending_friends pf
  where lower(pf.friend_handle) = lower(new.handle)
  on conflict (user_id, friend_id) do nothing;

  -- Clean up resolved pending entries
  delete from public.pending_friends
  where lower(friend_handle) = lower(new.handle);

  return new;
end;
$$;

create trigger on_profile_created_resolve_friends
  after insert on profiles
  for each row execute function resolve_pending_friends();

-- Also resolve on profile update (in case handle is set after initial creation)
create trigger on_profile_updated_resolve_friends
  after update of handle on profiles
  for each row
  when (old.handle is distinct from new.handle and new.handle is not null)
  execute function resolve_pending_friends();

-- ── ACTIVITY FEED ──
-- Stores real user activity for the Pulse view
create table activity (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete cascade,
  action text not null,
  event_id bigint references events(id) on delete cascade,
  quest text default '',
  created_at timestamptz default now()
);

create index activity_created_at_idx on activity (created_at desc);
create index activity_event_id_idx on activity (event_id);

alter table activity enable row level security;

create policy "Activity is viewable by everyone"
  on activity for select using (true);

create policy "Users can create own activity"
  on activity for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- ── HELPER: Update event attendance count ──
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

create trigger rsvp_att_inc after insert on rsvps
  for each row execute function update_event_att();

create trigger rsvp_att_dec after delete on rsvps
  for each row execute function update_event_att();

-- ── SEED DATA ──
-- Insert seed events (no created_by = system events)
insert into events (title, cat, date, time, loc, host, "desc", rsvp, luma, conf, att, banner) values
  ('SagaDAO House Miami', 'Party', '2026-05-04', '6 PM – Late', 'Private Villa, Miami Beach', 'SagaDAO × CloudKing', 'Creator house activation. Live demos, open bar, rooftop views.', true, 'https://lu.ma/sagadao-miami', 'acc26', 84, ''),
  ('DeFi Deep Dive', 'Workshop', '2026-05-05', '10 AM – 1 PM', 'Wynwood Walls Conf Room', 'Jupiter Exchange', 'Hands-on DeFi strategies. Bring your laptop.', true, 'https://lu.ma/defi-ws', 'acc26', 42, ''),
  ('NFT Builders Meetup', 'Meetup', '2026-05-05', '3 – 5 PM', 'Gramps Bar, Wynwood', 'Metaplex Foundation', 'Share builds, meet collaborators, grab a drink.', false, '', 'acc26', 120, ''),
  ('Seeker Demo Day', 'Demo Day', '2026-05-06', '2 – 6 PM', 'The Lab Miami', 'Solana Mobile', 'Latest Seeker apps live. Prizes for best dApp.', true, 'https://lu.ma/demo', 'acc26', 65, ''),
  ('Validator Dinner', 'Dinner', '2026-05-06', '7:30 – 10 PM', 'Komodo Restaurant', 'jPool & Marinade', 'Intimate dinner for validators. 30 guests max.', true, 'https://lu.ma/val', 'acc26', 28, ''),
  ('Gaming Panel', 'Panel', '2026-05-07', '11 AM – 12:30 PM', 'Convention Center 204', 'Star Atlas & Aurory', 'Future of blockchain gaming.', false, '', 'acc26', 200, ''),
  ('MonkeDAO Banana Stand', 'Party', '2026-05-07', '4 – 8 PM', 'Ocean Drive Pop-up', 'MonkeDAO', 'Bananas, merch drops, beach vibes.', false, '', 'acc26', 300, ''),
  ('Hack Miami Pre-Party', 'Party', '2026-05-03', '8 PM – 2 AM', 'E11even Miami', 'Superteam', 'Kick off week. DJs, open bar, networking.', true, 'https://lu.ma/pre', 'acc26', 500, ''),
  ('Guardians Brunch', 'Meetup', '2026-05-04', '10 AM – Noon', 'Mandolin, Design District', 'Solflare', 'Brunch for Guardians & Ambassadors.', true, 'https://lu.ma/guard', 'acc26', 35, ''),
  ('cNFT Hackathon', 'Hackathon', '2026-05-05', '9 AM – 9 PM', 'WeWork Brickell', 'Helius × Metaplex', '12-hour cNFT hackathon. SOL prizes.', true, 'https://lu.ma/cnft', 'acc26', 60, ''),
  ('RWA Fireside', 'Panel', '2026-05-08', '5 – 6:30 PM', 'Faena Hotel', 'Circle & Maple Finance', 'Stablecoins, RWA, on-chain payments.', true, 'https://lu.ma/rwa', 'acc26', 90, ''),
  ('Closing Beach Party', 'Party', '2026-05-09', '7 PM – 3 AM', 'Nikki Beach Miami', 'Solana Foundation', 'Official closing. Live DJ, open bar, fire dancers.', false, '', 'acc26', 750, '');
