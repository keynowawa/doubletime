create table if not exists public.order_action_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id text not null,
  action text not null check (action in ('voided', 'refunded')),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_by uuid not null references public.profiles(id),
  requested_by_name text not null,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text,
  foreign key (business_id, order_id) references public.orders(business_id, id) on delete cascade
);

create unique index if not exists one_pending_order_action_request
on public.order_action_requests (business_id, order_id)
where status = 'pending';

create index if not exists order_action_requests_business_time
on public.order_action_requests (business_id, requested_at desc);

alter table public.order_action_requests enable row level security;

drop policy if exists "members read order action requests" on public.order_action_requests;
create policy "members read order action requests" on public.order_action_requests
for select to authenticated
using (business_id = public.current_business_id());

grant select on public.order_action_requests to authenticated;

create or replace function public.request_pos_order_action(p_order_id text, p_action text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_order public.orders%rowtype;
  v_request public.order_action_requests%rowtype;
begin
  if p_action not in ('voided', 'refunded') then raise exception 'invalid request type'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'add a short reason for the owner'; end if;

  select * into v_profile from public.profiles where id = auth.uid() and active = true;
  if v_profile.id is null then raise exception 'not authorized'; end if;
  if v_profile.role = 'owner' then raise exception 'owners can update orders directly'; end if;

  select * into v_order
  from public.orders
  where business_id = v_profile.business_id and id = p_order_id;
  if v_order.id is null then raise exception 'order not found'; end if;
  if v_order.status <> 'completed' then raise exception 'only completed orders can be changed'; end if;

  select * into v_request
  from public.order_action_requests
  where business_id = v_profile.business_id and order_id = p_order_id and status = 'pending'
  limit 1;
  if v_request.id is not null then return to_jsonb(v_request); end if;

  insert into public.order_action_requests (
    business_id, order_id, action, reason, requested_by, requested_by_name
  ) values (
    v_profile.business_id,
    p_order_id,
    p_action,
    left(btrim(p_reason), 300),
    v_profile.id,
    v_profile.display_name
  )
  returning * into v_request;

  return to_jsonb(v_request);
end;
$$;

create or replace function public.review_pos_order_action(p_request_id uuid, p_decision text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_request public.order_action_requests%rowtype;
  v_order_payload jsonb;
begin
  if p_decision not in ('approved', 'declined') then raise exception 'invalid decision'; end if;
  select * into v_profile from public.profiles where id = auth.uid() and active = true;
  if v_profile.id is null or v_profile.role <> 'owner' then raise exception 'owner access required'; end if;

  select * into v_request
  from public.order_action_requests
  where id = p_request_id and business_id = v_profile.business_id
  for update;
  if v_request.id is null then raise exception 'request not found'; end if;
  if v_request.status <> 'pending' then raise exception 'request already reviewed'; end if;

  if p_decision = 'approved' then
    update public.orders
    set status = v_request.action,
        payload = jsonb_set(
          jsonb_set(payload, '{status}', to_jsonb(v_request.action), true),
          '{statusAudit}',
          jsonb_build_object(
            'requestId', v_request.id,
            'changedBy', v_profile.id,
            'changedByName', v_profile.display_name,
            'changedAt', now()
          ),
          true
        ),
        updated_at = now()
    where business_id = v_profile.business_id
      and id = v_request.order_id
      and status = 'completed'
    returning payload into v_order_payload;
    if v_order_payload is null then raise exception 'order is no longer completed'; end if;
  end if;

  update public.order_action_requests
  set status = p_decision,
      reviewed_by = v_profile.id,
      reviewed_by_name = v_profile.display_name,
      reviewed_at = now(),
      review_note = nullif(left(btrim(coalesce(p_note, '')), 300), '')
  where id = v_request.id
  returning * into v_request;

  return to_jsonb(v_request);
end;
$$;

create or replace function public.change_pos_order_status(p_order_id text, p_status text, p_pin text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_profile public.profiles%rowtype;
  v_payload jsonb;
  v_pin_hash text;
begin
  if p_status not in ('voided', 'refunded') then raise exception 'invalid status'; end if;
  select * into v_profile from public.profiles where id = auth.uid() and active = true;
  if v_profile.id is null then raise exception 'not authorized'; end if;

  if v_profile.role <> 'owner' then
    select manager_pin_hash into v_pin_hash from public.business_settings where business_id = v_profile.business_id;
    if v_pin_hash is null or extensions.crypt(p_pin, v_pin_hash) <> v_pin_hash then
      raise exception 'manager pin is incorrect';
    end if;
  end if;

  update public.orders
  set status = p_status,
      payload = jsonb_set(
        jsonb_set(payload, '{status}', to_jsonb(p_status), true),
        '{statusAudit}',
        jsonb_build_object(
          'changedBy', v_profile.id,
          'changedByName', v_profile.display_name,
          'changedAt', now(),
          'offlinePinFallback', v_profile.role <> 'owner'
        ),
        true
      ),
      updated_at = now()
  where business_id = v_profile.business_id and id = p_order_id and status = 'completed'
  returning payload into v_payload;
  if v_payload is null then raise exception 'order not found or already updated'; end if;

  update public.order_action_requests
  set status = 'declined',
      reviewed_by = v_profile.id,
      reviewed_by_name = v_profile.display_name,
      reviewed_at = now(),
      review_note = 'order updated directly'
  where business_id = v_profile.business_id and order_id = p_order_id and status = 'pending';

  return v_payload;
end;
$$;

create or replace function public.set_manager_pin(p_pin text, p_offline_verifier jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_owner() then raise exception 'owner access required'; end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'pin must be 4 to 8 digits'; end if;
  if p_offline_verifier is null or jsonb_typeof(p_offline_verifier) <> 'object' then
    raise exception 'offline pin verifier is required';
  end if;

  update public.business_settings
  set manager_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
      payload = jsonb_set(payload - 'managerPin', '{offlinePinVerifier}', p_offline_verifier, true),
      updated_at = now()
  where business_id = public.current_business_id();
  return found;
end;
$$;

revoke all on function public.request_pos_order_action(text, text, text) from public, anon;
revoke all on function public.review_pos_order_action(uuid, text, text) from public, anon;
revoke all on function public.set_manager_pin(text, jsonb) from public, anon;
grant execute on function public.request_pos_order_action(text, text, text) to authenticated;
grant execute on function public.review_pos_order_action(uuid, text, text) to authenticated;
grant execute on function public.set_manager_pin(text, jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_action_requests'
  ) then
    alter publication supabase_realtime add table public.order_action_requests;
  end if;
end;
$$;
