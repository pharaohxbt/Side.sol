-- Run this in the Supabase SQL Editor
alter table events add column if not exists "lumaEventId" text default '';
