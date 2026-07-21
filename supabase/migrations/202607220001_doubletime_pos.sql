create extension if not exists pgcrypto with schema extensions;

create table public.businesses (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null check (role in ('owner', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.products (
  business_id uuid not null references public.businesses(id) on delete cascade,
  id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (business_id, id)
);

create table public.modifiers (
  business_id uuid not null references public.businesses(id) on delete cascade,
  id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (business_id, id)
);

create table public.price_lists (
  business_id uuid not null references public.businesses(id) on delete cascade,
  id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (business_id, id)
);

create table public.business_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  payload jsonb not null,
  next_order_number integer not null default 1 check (next_order_number > 0),
  manager_pin_hash text not null,
  updated_at timestamptz not null default now()
);

create table public.orders (
  business_id uuid not null references public.businesses(id) on delete cascade,
  id text not null,
  number integer not null,
  created_at timestamptz not null,
  status text not null check (status in ('completed', 'voided', 'refunded')),
  payment_method text not null check (payment_method in ('cash', 'gcash', 'maya', 'qrph', 'card', 'bank')),
  total numeric(12,2) not null default 0,
  payload jsonb not null,
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (business_id, id),
  unique (business_id, number)
);

insert into public.businesses (id, name)
values ('00000000-0000-0000-0000-000000000001', 'doubletime')
on conflict (id) do nothing;

insert into public.business_settings (business_id, payload, next_order_number, manager_pin_hash)
values (
  '00000000-0000-0000-0000-000000000001',
  '{"id":"main","activePriceListId":"tasting","taxEnabled":false,"taxName":"tax","taxRate":0,"taxInclusive":true,"nextOrderNumber":1,"managerPin":""}'::jsonb,
  1,
  extensions.crypt('2026', extensions.gen_salt('bf'))
)
on conflict (business_id) do nothing;

insert into public.products (business_id, id, payload) values
  ('00000000-0000-0000-0000-000000000001', 'classic', '{"id":"classic","sku":"DT-MAT-CLS","name":"classic matcha","description":"smooth, sweet, and umami","category":"matcha","price":140,"standardPrice":190,"image":"/assets/cocoloco-front-view.webp","modifierIds":["oat","strawberry","mango","strawberry-mango","sweetener"],"soldOut":false,"archived":false,"createdAt":"2026-07-22T00:00:00.000Z"}'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'stay-salty', '{"id":"stay-salty","sku":"DT-MAT-SLT","name":"stay salty","description":"matcha with sea salt cream","category":"matcha","price":160,"standardPrice":210,"image":"/assets/DT-MAT-SLT-pos.webp","modifierIds":["oat","sweetener"],"soldOut":false,"archived":false,"createdAt":"2026-07-22T00:00:00.000Z"}'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'coco-loco', '{"id":"coco-loco","sku":"DT-MAT-COC","name":"coco loco","description":"matcha with coconut milk","category":"matcha","price":170,"standardPrice":220,"image":"/assets/cocoloco-front-view.webp","modifierIds":["oat","sweetener"],"soldOut":false,"archived":false,"createdAt":"2026-07-22T00:00:00.000Z"}'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'berry-cute', '{"id":"berry-cute","sku":"DT-MAT-BRY","name":"berry cute","description":"strawberry matcha","category":"matcha","price":170,"standardPrice":220,"image":"/assets/22.webp","modifierIds":["oat","mango","sweetener"],"soldOut":false,"archived":false,"createdAt":"2026-07-22T00:00:00.000Z"}'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'golden-hour', '{"id":"golden-hour","sku":"DT-MAT-GLD","name":"golden hour","description":"mango matcha","category":"matcha","price":170,"standardPrice":220,"image":"/assets/21.webp","modifierIds":["oat","strawberry","sweetener"],"soldOut":false,"archived":false,"createdAt":"2026-07-22T00:00:00.000Z"}'::jsonb)
on conflict (business_id, id) do nothing;

insert into public.modifiers (business_id, id, payload) values
  ('00000000-0000-0000-0000-000000000001', 'oat', '{"id":"oat","sku":"DT-ADD-OAT","name":"oat milk","price":25,"archived":false,"createdAt":"2026-07-22T00:00:00.000Z"}'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'strawberry', '{"id":"strawberry","sku":"DT-ADD-STR","name":"strawberry","price":25,"archived":false,"createdAt":"2026-07-22T00:00:00.000Z"}'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'mango', '{"id":"mango","sku":"DT-ADD-MGO","name":"mango","price":25,"archived":false,"createdAt":"2026-07-22T00:00:00.000Z"}'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'strawberry-mango', '{"id":"strawberry-mango","sku":"DT-ADD-STM","name":"strawberry mango","price":25,"archived":false,"createdAt":"2026-07-22T00:00:00.000Z"}'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'sweetener', '{"id":"sweetener","sku":"DT-ADD-SWT","name":"sweetener","price":15,"archived":false,"createdAt":"2026-07-22T00:00:00.000Z"}'::jsonb)
on conflict (business_id, id) do nothing;

insert into public.price_lists (business_id, id, payload) values
  ('00000000-0000-0000-0000-000000000001', 'tasting', '{"id":"tasting","name":"the tasting run","prices":{"classic":140,"stay-salty":160,"coco-loco":170,"berry-cute":170,"golden-hour":170},"archived":false,"createdAt":"2026-07-22T00:00:00.000Z"}'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'standard', '{"id":"standard","name":"standard pricing","prices":{"classic":190,"stay-salty":210,"coco-loco":220,"berry-cute":220,"golden-hour":220},"archived":false,"createdAt":"2026-07-22T00:00:00.000Z"}'::jsonb)
on conflict (business_id, id) do nothing;

create or replace function public.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select business_id from public.profiles where id = auth.uid() and active = true limit 1;
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner' and active = true
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_role text;
begin
  v_business_id := coalesce(
    nullif(new.raw_user_meta_data ->> 'business_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  );
  v_role := case
    when lower(new.email) = 'doubletime.ph@gmail.com' then 'owner'
    when new.raw_user_meta_data ->> 'role' = 'owner' then 'owner'
    else 'staff'
  end;

  insert into public.profiles (id, business_id, email, display_name, role)
  values (
    new.id,
    v_business_id,
    lower(new.email),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    v_role
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute procedure public.handle_new_user();

insert into public.profiles (id, business_id, email, display_name, role)
select id, '00000000-0000-0000-0000-000000000001', lower(email), split_part(email, '@', 1), 'owner'
from auth.users
where lower(email) = 'doubletime.ph@gmail.com'
on conflict (id) do update set role = 'owner', active = true;

alter table public.businesses enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.modifiers enable row level security;
alter table public.price_lists enable row level security;
alter table public.business_settings enable row level security;
alter table public.orders enable row level security;

create policy "members read their business" on public.businesses
for select to authenticated
using (id = public.current_business_id());

create policy "members read profiles" on public.profiles
for select to authenticated
using (business_id = public.current_business_id());

create policy "members read products" on public.products
for select to authenticated
using (business_id = public.current_business_id());
create policy "owners create products" on public.products
for insert to authenticated
with check (business_id = public.current_business_id() and public.is_owner());
create policy "owners update products" on public.products
for update to authenticated
using (business_id = public.current_business_id() and public.is_owner())
with check (business_id = public.current_business_id() and public.is_owner());

create policy "members read modifiers" on public.modifiers
for select to authenticated
using (business_id = public.current_business_id());
create policy "owners create modifiers" on public.modifiers
for insert to authenticated
with check (business_id = public.current_business_id() and public.is_owner());
create policy "owners update modifiers" on public.modifiers
for update to authenticated
using (business_id = public.current_business_id() and public.is_owner())
with check (business_id = public.current_business_id() and public.is_owner());

create policy "members read price lists" on public.price_lists
for select to authenticated
using (business_id = public.current_business_id());
create policy "owners create price lists" on public.price_lists
for insert to authenticated
with check (business_id = public.current_business_id() and public.is_owner());
create policy "owners update price lists" on public.price_lists
for update to authenticated
using (business_id = public.current_business_id() and public.is_owner())
with check (business_id = public.current_business_id() and public.is_owner());

create policy "members read settings" on public.business_settings
for select to authenticated
using (business_id = public.current_business_id());
create policy "owners update settings" on public.business_settings
for update to authenticated
using (business_id = public.current_business_id() and public.is_owner())
with check (business_id = public.current_business_id() and public.is_owner());

create policy "members read orders" on public.orders
for select to authenticated
using (business_id = public.current_business_id());
create policy "members create orders" on public.orders
for insert to authenticated
with check (business_id = public.current_business_id() and created_by = auth.uid());
create policy "owners update orders" on public.orders
for update to authenticated
using (business_id = public.current_business_id() and public.is_owner())
with check (business_id = public.current_business_id() and public.is_owner());

grant usage on schema public to authenticated;
grant select on public.businesses, public.profiles to authenticated;
grant select, insert, update on public.products, public.modifiers, public.price_lists, public.orders to authenticated;
grant select, update on public.business_settings to authenticated;
grant execute on function public.current_business_id(), public.is_owner() to authenticated;

create or replace function public.create_pos_order(p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_number integer;
  v_payload jsonb;
  v_created_at timestamptz;
begin
  select * into v_profile from public.profiles where id = auth.uid() and active = true;
  if v_profile.id is null then raise exception 'not authorized'; end if;

  select payload into v_payload
  from public.orders
  where business_id = v_profile.business_id and id = p_order ->> 'id';
  if v_payload is not null then return v_payload; end if;

  update public.business_settings
  set next_order_number = next_order_number + 1,
      payload = jsonb_set(payload, '{nextOrderNumber}', to_jsonb(next_order_number + 1), true),
      updated_at = now()
  where business_id = v_profile.business_id
  returning next_order_number - 1 into v_number;

  if v_number is null then raise exception 'business settings missing'; end if;
  v_created_at := coalesce(nullif(p_order ->> 'createdAt', '')::timestamptz, now());
  v_payload := p_order || jsonb_build_object(
    'number', v_number,
    'createdAt', v_created_at,
    'createdBy', auth.uid(),
    'createdByName', v_profile.display_name
  );

  insert into public.orders (business_id, id, number, created_at, status, payment_method, total, payload, created_by)
  values (
    v_profile.business_id,
    v_payload ->> 'id',
    v_number,
    v_created_at,
    coalesce(v_payload ->> 'status', 'completed'),
    v_payload ->> 'paymentMethod',
    coalesce((v_payload ->> 'total')::numeric, 0),
    v_payload,
    auth.uid()
  )
  on conflict (business_id, id) do update set
    status = excluded.status,
    payment_method = excluded.payment_method,
    total = excluded.total,
    payload = excluded.payload,
    updated_at = now();

  return v_payload;
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
      payload = jsonb_set(payload, '{status}', to_jsonb(p_status), true),
      updated_at = now()
  where business_id = v_profile.business_id and id = p_order_id
  returning payload into v_payload;
  if v_payload is null then raise exception 'order not found'; end if;
  return v_payload;
end;
$$;

create or replace function public.set_manager_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_owner() then raise exception 'owner access required'; end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'pin must be 4 to 8 digits'; end if;
  update public.business_settings
  set manager_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), updated_at = now()
  where business_id = public.current_business_id();
  return found;
end;
$$;

grant execute on function public.create_pos_order(jsonb) to authenticated;
grant execute on function public.change_pos_order_status(text, text, text) to authenticated;
grant execute on function public.set_manager_pin(text) to authenticated;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

create policy "public product images are readable" on storage.objects
for select using (bucket_id = 'product-images');
create policy "owners upload product images" on storage.objects
for insert to authenticated
with check (bucket_id = 'product-images' and public.is_owner());
create policy "owners update product images" on storage.objects
for update to authenticated
using (bucket_id = 'product-images' and public.is_owner())
with check (bucket_id = 'product-images' and public.is_owner());
create policy "owners remove product images" on storage.objects
for delete to authenticated
using (bucket_id = 'product-images' and public.is_owner());

alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.modifiers;
alter publication supabase_realtime add table public.price_lists;
alter publication supabase_realtime add table public.business_settings;
alter publication supabase_realtime add table public.orders;
