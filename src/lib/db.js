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
  const { data, error } = await supabase
    .from("events")
    .insert({ ...ev, created_by: userId })
    .select()
    .single();
  if (error) { console.error("createEvent:", error); return null; }
  return data;
}

export async function updateEvent(id, updates) {
  if (!hasSupabase()) return null;
  const { data, error } = await supabase
    .from("events")
    .update(updates)
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
  const { data, error } = await supabase
    .from("friends")
    .select("friend_id, is_vip, profiles!friends_friend_id_fkey(name, handle, pfp, role, bio, notable, tags)")
    .eq("user_id", userId);
  if (error) { console.error("fetchFriends:", error); return null; }
  return data.map(f => ({
    ...f.profiles,
    handle: f.profiles.handle,
    is_vip: f.is_vip,
    friend_id: f.friend_id,
  }));
}

export async function addFriend(userId, friendId) {
  if (!hasSupabase()) return false;
  const { error } = await supabase
    .from("friends")
    .insert({ user_id: userId, friend_id: friendId });
  if (error) { console.error("addFriend:", error); return false; }
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
    provider: "twitter",
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
