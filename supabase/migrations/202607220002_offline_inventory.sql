create table if not exists public.inventory_adjustments (
  business_id uuid not null references public.businesses(id) on delete cascade,
  id text not null,
  product_id text not null,
  delta integer not null,
  reason text not null check (reason in ('sale', 'manual')),
  reference_id text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (business_id, id)
);

alter table public.inventory_adjustments enable row level security;

drop policy if exists "members read inventory adjustments" on public.inventory_adjustments;
create policy "members read inventory adjustments" on public.inventory_adjustments
for select to authenticated
using (business_id = public.current_business_id());

grant select on public.inventory_adjustments to authenticated;

create or replace function public.adjust_pos_inventory(p_adjustment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_product public.products%rowtype;
  v_adjustment_id text;
  v_delta integer;
  v_reason text;
  v_quantity integer;
  v_inserted text;
begin
  select * into v_profile from public.profiles where id = auth.uid() and active = true;
  if v_profile.id is null then raise exception 'not authorized'; end if;

  v_adjustment_id := p_adjustment ->> 'id';
  v_delta := coalesce((p_adjustment ->> 'delta')::integer, 0);
  v_reason := coalesce(p_adjustment ->> 'reason', 'sale');
  if v_adjustment_id is null or v_delta = 0 then raise exception 'invalid inventory adjustment'; end if;
  if v_reason not in ('sale', 'manual') then raise exception 'invalid inventory reason'; end if;
  if v_reason = 'manual' and v_profile.role <> 'owner' then raise exception 'owner access required'; end if;

  select * into v_product
  from public.products
  where business_id = v_profile.business_id and id = p_adjustment ->> 'productId'
  for update;
  if v_product.id is null then raise exception 'product not found'; end if;

  insert into public.inventory_adjustments (business_id, id, product_id, delta, reason, reference_id, created_by, created_at)
  values (
    v_profile.business_id,
    v_adjustment_id,
    v_product.id,
    v_delta,
    v_reason,
    nullif(p_adjustment ->> 'referenceId', ''),
    v_profile.id,
    coalesce(nullif(p_adjustment ->> 'createdAt', '')::timestamptz, now())
  )
  on conflict (business_id, id) do nothing
  returning id into v_inserted;

  if v_inserted is null then return v_product.payload; end if;

  v_quantity := greatest(0, coalesce((v_product.payload ->> 'stockQuantity')::integer, 0) + v_delta);
  v_product.payload := jsonb_set(
    jsonb_set(v_product.payload, '{stockQuantity}', to_jsonb(v_quantity), true),
    '{soldOut}',
    to_jsonb(v_quantity <= 0),
    true
  );

  update public.products
  set payload = v_product.payload, updated_at = now()
  where business_id = v_profile.business_id and id = v_product.id;

  return v_product.payload;
end;
$$;

grant execute on function public.adjust_pos_inventory(jsonb) to authenticated;
