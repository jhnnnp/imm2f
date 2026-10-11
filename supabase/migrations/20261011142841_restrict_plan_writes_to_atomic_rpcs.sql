-- Complete itinerary writes must pass through revision-checked atomic RPCs.
-- Coordinate hydration is the only direct application write to plan items.
set local lock_timeout = '5s';

revoke all on public.plans, public.plan_items from public, anon, authenticated;
grant select on public.plans, public.plan_items to authenticated;
grant update (lng, lat) on public.plan_items to authenticated;
grant all on public.plans, public.plan_items to service_role;
