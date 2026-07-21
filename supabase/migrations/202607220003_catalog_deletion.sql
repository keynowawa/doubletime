drop policy if exists "owners delete products" on public.products;
create policy "owners delete products" on public.products
for delete to authenticated
using (business_id = public.current_business_id() and public.is_owner());

drop policy if exists "owners delete modifiers" on public.modifiers;
create policy "owners delete modifiers" on public.modifiers
for delete to authenticated
using (business_id = public.current_business_id() and public.is_owner());

drop policy if exists "owners delete price lists" on public.price_lists;
create policy "owners delete price lists" on public.price_lists
for delete to authenticated
using (business_id = public.current_business_id() and public.is_owner());

grant delete on public.products, public.modifiers, public.price_lists to authenticated;
