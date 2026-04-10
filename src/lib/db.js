import { supabase, hasSupabase } from "./supabase.js";

// ════════════════════════════════════════
// FALLBACK: localStorage (when Supabase is not configured)
// ════════════════════════════════════════
function loadLocal(key, fallback) {
  try { const v = localStorage.getItem("ss_" + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveLocal(key, value) {
  try { localStorage.setItem("ss_" + key, JSON.stringify(value)); } catch {}
}

// ════════════════════════════════════════
// USER DATA (synced via profile JSON columns)
// ════════════════════════════════════════
// Save all user-specific data to the profile row
export async function saveUserData(userId, data) {
  if (!hasSupabase() || !userId) return;
  const { error } = await supabase
    .from("profiles")
    .update(data)
    .eq("id", userId);
  if (error) console.error("saveUserData:", error);
}

// Load all user-specific data from the profile row
export async function loadUserData(userId) {
  if (!hasSupabase() || !userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("friends_data, vips_data, bmarks_data, rsvps_data, checkins_data, incog_data")
    .eq("id", userId)
    .single();
  if (error) { console.error("loadUserData:", error); return null; }
  return data;
}

// ════════════════════════════════════════
// EVENTS
// ════════════════════════════════════════
export async function fetchEvents(conf) {
  if (!hasSupabase()) return null; // fallback to local
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("conf", conf)
    .order("date", { ascending: true });
  if (error) { console.error("fetchEvents:", error); return null; }
  return data.map(e => ({ ...e, desc: e.desc || "" }));
}

export async function createEvent(ev, userId) {
  if (!hasSupabase()) return null;
  // Only send columns that exist in the events table
  const row = {
    title: ev.title, cat: ev.cat, date: ev.date, time: ev.time || "",
    loc: ev.loc, host: ev.host, desc: ev.desc || "", rsvp: ev.rsvp || false,
    luma: ev.luma || "", conf: ev.conf, banner: ev.banner || "",
    capacity: ev.capacity || 0, announcement: ev.announcement || "", hide_loc: ev.hide_loc || false,
    created_by: userId,
  };
  if (ev.lumaEventId) row.lumaEventId = ev.lumaEventId;
  if (ev.bannerPos != null) row.bannerPos = ev.bannerPos;
  if (ev.registration_questions) row.registration_questions = ev.registration_questions;
  const { data, error } = await supabase
    .from("events")
    .insert(row)
    .select()
    .single();
  if (error) { console.error("createEvent:", error); return null; }
  return data;
}

export async function updateEvent(id, updates) {
  if (!hasSupabase()) return null;
  const row = {};
  const allowed = ["title","cat","date","time","loc","host","desc","rsvp","hide_loc","luma","conf","banner","capacity","announcement","lumaEventId","bannerPos","registration_questions"];
  for (const k of allowed) { if (updates[k] !== undefined) row[k] = updates[k]; }
  const { data, error } = await supabase
    .from("events")
    .update(row)
    .eq("id", id)
    .select()
    .single();
  if (error) { console.error("updateEvent:", error); return null; }
  return data;
}

export async function deleteEvent(id) {
  if (!hasSupabase()) return false;
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) { console.error("deleteEvent:", error); return false; }
  return true;
}

// ════════════════════════════════════════
// RSVPS
// ════════════════════════════════════════
export async function fetchRsvps(userId) {
  if (!hasSupabase()) return null;
  const { data, error } = await supabase
    .from("rsvps")
    .select("event_id")
    .eq("user_id", userId);
  if (error) { console.error("fetchRsvps:", error); return null; }
  return data.map(r => r.event_id);
}

export async function addRsvp(userId, eventId) {
  if (!hasSupabase()) return false;
  const { error } = await supabase
    .from("rsvps")
    .insert({ user_id: userId, event_id: eventId });
  if (error) { console.error("addRsvp:", error); return false; }
  // Log activity
  await supabase.from("activity").insert({ user_id: userId, action: "RSVP'd to", event_id: eventId });
  return true;
}

export async function removeRsvp(userId, eventId) {
  if (!hasSupabase()) return false;
  const { error } = await supabase
    .from("rsvps")
    .delete()
    .eq("user_id", userId)
    .eq("event_id", eventId);
  if (error) { console.error("removeRsvp:", error); return false; }
  return true;
}

// All RSVPs for an event (for host attendee list)
export async function fetchEventRsvps(eventId) {
  if (!hasSupabase()) return null;
  const { data, error } = await supabase
    .from("rsvps")
    .select("user_id, profiles(name, handle, pfp, role)")
    .eq("event_id", eventId);
  if (error) { console.error("fetchEventRsvps:", error); return null; }
  return data.map(r => ({ ...r.profiles, user_id: r.user_id }));
}

// ════════════════════════════════════════
// CHECK-INS
// ════════════════════════════════════════
export async function fetchCheckins(userId) {
  if (!hasSupabase()) return null;
  const { data, error } = await supabase
    .from("checkins")
    .select("event_id")
    .eq("user_id", userId);
  if (error) { console.error("fetchCheckins:", error); return null; }
  return data.map(r => r.event_id);
}

export async function addCheckin(userId, eventId) {
  if (!hasSupabase()) return false;
  const { error } = await supabase
    .from("checkins")
    .insert({ user_id: userId, event_id: eventId });
  if (error) { console.error("addCheckin:", error); return false; }
  await supabase.from("activity").insert({ user_id: userId, action: "checked in at", event_id: eventId });
  return true;
}

// ════════════════════════════════════════
// BOOKMARKS
// ════════════════════════════════════════
export async function fetchBookmarks(userId) {
  if (!hasSupabase()) return null;
  const { data, error } = await supabase
    .from("bookmarks")
    .select("event_id")
    .eq("user_id", userId);
  if (error) { console.error("fetchBookmarks:", error); return null; }
  return data.map(r => r.event_id);
}

export async function toggleBookmark(userId, eventId, isBookmarked) {
  if (!hasSupabase()) return false;
  if (isBookmarked) {
    await supabase.from("bookmarks").delete().eq("user_id", userId).eq("event_id", eventId);
  } else {
    await supabase.from("bookmarks").insert({ user_id: userId, event_id: eventId });
  }
  return true;
}

// ════════════════════════════════════════
// FRIENDS
// ════════════════════════════════════════
export async function fetchFriends(userId) {
  if (!hasSupabase()) return null;
  // Fetch real friends
  const { data: realFriends, error } = await supabase
    .from("friends")
    .select("friend_id, is_vip, profiles!friends_friend_id_fkey(name, handle, pfp, role, bio, notable, tags)")
    .eq("user_id", userId);
  if (error) { console.error("fetchFriends:", error); return null; }
  const friends = (realFriends || []).map(f => ({
    ...f.profiles,
    handle: f.profiles.handle,
    is_vip: f.is_vip,
    friend_id: f.friend_id,
    pending: false,
  }));
  // Also fetch pending friends (not yet signed up)
  const { data: pending } = await supabase
    .from("pending_friends")
    .select("*")
    .eq("user_id", userId);
  if (pending) {
    pending.forEach(p => {
      friends.push({
        name: p.friend_handle.replace(/^@/, ""),
        handle: p.friend_handle,
        pfp: "", role: "", bio: "", notable: false, tags: [],
        is_vip: p.is_vip,
        friend_id: null,
        pending: true,
      });
    });
  }
  return friends;
}

// Add friend by UUID (real profile exists)
export async function addFriend(userId, friendId) {
  if (!hasSupabase()) return false;
  const { error } = await supabase
    .from("friends")
    .insert({ user_id: userId, friend_id: friendId });
  if (error) { console.error("addFriend:", error); return false; }
  return true;
}

// Add friend by handle — checks if profile exists, otherwise stores as pending
export async function addFriendByHandle(userId, handle) {
  if (!hasSupabase()) return { found: false };
  // Look up the handle in profiles
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, handle, pfp, role, bio, notable, tags")
    .ilike("handle", handle)
    .limit(1);
  if (profiles && profiles.length > 0) {
    // Real profile exists — add as real friend
    const profile = profiles[0];
    const { error } = await supabase
      .from("friends")
      .insert({ user_id: userId, friend_id: profile.id });
    if (error && error.code !== "23505") { console.error("addFriendByHandle:", error); return { found: false }; }
    return { found: true, profile };
  }
  // No profile yet — store as pending
  const { error } = await supabase
    .from("pending_friends")
    .insert({ user_id: userId, friend_handle: handle });
  if (error && error.code !== "23505") { console.error("addPendingFriend:", error); return { found: false }; }
  return { found: false, pending: true };
}

// Remove pending friend by handle
export async function removePendingFriend(userId, handle) {
  if (!hasSupabase()) return false;
  await supabase.from("pending_friends").delete().eq("user_id", userId).ilike("friend_handle", handle);
  return true;
}

export async function removeFriend(userId, friendId) {
  if (!hasSupabase()) return false;
  const { error } = await supabase
    .from("friends")
    .delete()
    .eq("user_id", userId)
    .eq("friend_id", friendId);
  if (error) { console.error("removeFriend:", error); return false; }
  return true;
}

export async function toggleVip(userId, friendId, isVip) {
  if (!hasSupabase()) return false;
  const { error } = await supabase
    .from("friends")
    .update({ is_vip: !isVip })
    .eq("user_id", userId)
    .eq("friend_id", friendId);
  if (error) { console.error("toggleVip:", error); return false; }
  return true;
}

// ════════════════════════════════════════
// PROFILES (search / discovery)
// ════════════════════════════════════════
export async function searchProfiles(query) {
  if (!hasSupabase()) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, handle, pfp, role, bio, notable, tags")
    .or(`handle.ilike.%${query}%,name.ilike.%${query}%`)
    .limit(20);
  if (error) { console.error("searchProfiles:", error); return null; }
  return data;
}

export async function upsertProfile(profile) {
  if (!hasSupabase()) return null;
  const { data, error } = await supabase
    .from("profiles")
    .upsert(profile, { onConflict: "id" })
    .select()
    .single();
  if (error) { console.error("upsertProfile:", error); return null; }
  return data;
}

// ════════════════════════════════════════
// INCOGNITO
// ════════════════════════════════════════
export async function fetchIncognito(userId) {
  if (!hasSupabase()) return null;
  const { data, error } = await supabase
    .from("incognito")
    .select("event_id")
    .eq("user_id", userId);
  if (error) { console.error("fetchIncognito:", error); return null; }
  return data.map(r => r.event_id);
}

export async function toggleIncognito(userId, eventId, isHidden) {
  if (!hasSupabase()) return false;
  if (isHidden) {
    await supabase.from("incognito").delete().eq("user_id", userId).eq("event_id", eventId);
  } else {
    await supabase.from("incognito").insert({ user_id: userId, event_id: eventId });
  }
  return true;
}

// ════════════════════════════════════════
// ACTIVITY FEED
// ════════════════════════════════════════
export async function fetchActivity(limit = 20) {
  if (!hasSupabase()) return null;
  const { data, error } = await supabase
    .from("activity")
    .select("*, profiles(name, handle, pfp)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { console.error("fetchActivity:", error); return null; }
  return data;
}

export async function logActivity(userId, action, eventId = null, quest = "") {
  if (!hasSupabase()) return;
  await supabase.from("activity").insert({
    user_id: userId,
    action,
    event_id: eventId,
    quest,
  });
}

// ════════════════════════════════════════
// AUTH HELPERS
// ════════════════════════════════════════
export async function getSession() {
  if (!hasSupabase()) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function signInWithTwitter() {
  if (!hasSupabase()) return null;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "x",
    options: { redirectTo: window.location.origin },
  });
  if (error) { console.error("signInWithTwitter:", error); return null; }
  return data;
}

export async function signInWithEmail(email, name) {
  if (!hasSupabase()) return null;
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      data: { name },
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) { console.error("signInWithEmail:", error); return null; }
  return data;
}

export async function signOut() {
  if (!hasSupabase()) return;
  await supabase.auth.signOut();
}

// Re-export for direct access
export { supabase, hasSupabase, loadLocal, saveLocal };
