-- Run this in the Supabase SQL Editor
-- Resolves pending friends in friends_data JSON when a new user signs up

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
  i int;
begin
  -- Find all profiles that have this handle as a pending friend
  for profile_row in
    select id, friends_data
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
      end if;
      updated_friends = updated_friends || jsonb_build_array(friend_entry);
    end loop;
    update public.profiles set friends_data = updated_friends where id = profile_row.id;
  end loop;
end;
$$;
