-- Run this in the Supabase SQL Editor
-- Resolves pending friends AND sends friend request notifications when a new user signs up

create or replace function resolve_pending_friends_json(new_handle text, new_name text, new_pfp text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row record;
  updated_friends jsonb;
  friend_entry jsonb;
  new_user_requests jsonb;
  i int;
begin
  -- Get the new user's current friend requests
  select coalesce(friend_requests_data, '[]'::jsonb) into new_user_requests
  from public.profiles where handle = new_handle;

  if new_user_requests is null then new_user_requests = '[]'::jsonb; end if;

  -- Find all profiles that have this handle as a pending friend
  for profile_row in
    select id, name, handle, pfp, friends_data
    from public.profiles
    where friends_data::text ilike '%' || new_handle || '%'
  loop
    updated_friends = '[]'::jsonb;
    for i in 0..jsonb_array_length(profile_row.friends_data) - 1 loop
      friend_entry = profile_row.friends_data->i;
      -- If this entry matches the new user's handle, update it
      if lower(friend_entry->>'handle') = lower(new_handle) then
        friend_entry = jsonb_build_object(
          'handle', new_handle,
          'name', new_name,
          'pfp', new_pfp,
          'method', 'x',
          'role', '',
          'bio', '',
          'notable', false,
          'tags', '[]'::jsonb,
          'pending', false
        );
        -- Also send a friend request notification to the new user from this person
        if not exists (select 1 from jsonb_array_elements(new_user_requests) v where v->>'handle' = profile_row.handle) then
          new_user_requests = new_user_requests || jsonb_build_object(
            'handle', profile_row.handle,
            'name', profile_row.name,
            'pfp', coalesce(profile_row.pfp, ''),
            'ts', now()
          );
        end if;
      end if;
      updated_friends = updated_friends || jsonb_build_array(friend_entry);
    end loop;
    update public.profiles set friends_data = updated_friends where id = profile_row.id;
  end loop;

  -- Update the new user's friend requests
  update public.profiles set friend_requests_data = new_user_requests where handle = new_handle;
end;
$$;
