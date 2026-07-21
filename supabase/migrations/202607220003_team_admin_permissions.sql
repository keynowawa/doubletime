-- Automatic Data API grants are intentionally disabled for this project.
-- The invite-staff Edge Function only needs to inspect and update team profiles.
grant select, update on table public.profiles to service_role;
