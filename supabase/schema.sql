-- MỘC CAFÉ | Supabase PostgreSQL schema + access control
-- Run once in Supabase SQL Editor, preferably in a new project.
-- Each authenticated user owns a PRIVATE workspace. Shared multi-staff workspace is NOT implemented.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 140),
  category text not null default 'coffee' check (category in ('coffee','tea','juice','cake','other')),
  price numeric(14,2) not null check (price >= 0),
  description text not null default '',
  image_url text,
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_owner_idx on public.products(owner_id);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 140),
  phone text not null default '',
  email text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists customers_owner_idx on public.customers(owner_id);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  order_code text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'new' check (status in ('new','preparing','done','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid')),
  payment_method text not null default 'cash' check (payment_method in ('cash','transfer','card')),
  total numeric(14,2) not null default 0 check (total >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists orders_owner_created_idx on public.orders(owner_id, created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check(quantity between 1 and 999),
  unit_price numeric(14,2) not null check(unit_price >= 0),
  line_total numeric(14,2) not null check(line_total >= 0)
);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_owner_idx on public.order_items(owner_id);

-- Auto-fill profile name after a new Supabase Auth account is created.
create or replace function public.handle_new_cafe_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do update set full_name = excluded.full_name;
  return new;
end; $$;
drop trigger if exists on_cafe_auth_user_created on auth.users;
create trigger on_cafe_auth_user_created after insert on auth.users
for each row execute function public.handle_new_cafe_user();

create or replace function public.cafe_touch_product()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists cafe_product_updated on public.products;
create trigger cafe_product_updated before update on public.products
for each row execute function public.cafe_touch_product();

-- RLS on every app table: user's data stays private.
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists cafe_profile_select on public.profiles;
create policy cafe_profile_select on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists cafe_product_select on public.products;
create policy cafe_product_select on public.products for select to authenticated using (owner_id = auth.uid());
drop policy if exists cafe_product_insert on public.products;
create policy cafe_product_insert on public.products for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists cafe_product_update on public.products;
create policy cafe_product_update on public.products for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists cafe_product_delete on public.products;
create policy cafe_product_delete on public.products for delete to authenticated using (owner_id = auth.uid());

drop policy if exists cafe_customer_select on public.customers;
create policy cafe_customer_select on public.customers for select to authenticated using (owner_id = auth.uid());
drop policy if exists cafe_customer_insert on public.customers;
create policy cafe_customer_insert on public.customers for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists cafe_customer_update on public.customers;
create policy cafe_customer_update on public.customers for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists cafe_customer_delete on public.customers;
create policy cafe_customer_delete on public.customers for delete to authenticated using (owner_id = auth.uid());

drop policy if exists cafe_order_select on public.orders;
create policy cafe_order_select on public.orders for select to authenticated using (owner_id = auth.uid());
drop policy if exists cafe_item_select on public.order_items;
create policy cafe_item_select on public.order_items for select to authenticated using (owner_id = auth.uid());
-- No client INSERT/UPDATE/DELETE policy on orders/items: transactions go through verified RPCs.

-- Least-privilege PostgREST/Data API permissions.
revoke all on public.profiles, public.products, public.customers, public.orders, public.order_items from anon, authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update,delete on public.products, public.customers to authenticated;
grant select on public.orders, public.order_items to authenticated;

-- Create an order and its items atomically. Price is looked up on SERVER (not trusted from browser).
create or replace function public.cafe_create_order(
  p_customer_id uuid, p_items jsonb, p_note text default '', p_payment_method text default 'cash'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_order_id uuid;
  v_item record;
  v_product record;
  v_total numeric(14,2) := 0;
  v_code text;
begin
  if v_uid is null then raise exception 'Bạn chưa đăng nhập.'; end if;
  if p_payment_method not in ('cash','transfer','card') or p_payment_method is null then
    raise exception 'Phương thức thanh toán không hợp lệ.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 60 then
    raise exception 'Đơn hàng phải có từ 1 đến 60 dòng món.';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id and owner_id = v_uid
  ) then raise exception 'Khách hàng không thuộc cửa hàng của bạn.'; end if;
  v_code := 'MC-' || to_char(now(),'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.orders(owner_id, order_code, customer_id, note, payment_method)
  values (v_uid, v_code, p_customer_id, left(coalesce(p_note,''),1000), p_payment_method)
  returning id into v_order_id;
  for v_item in
    select (x.value->>'product_id')::uuid as product_id,
           (x.value->>'quantity')::integer as quantity
    from jsonb_array_elements(p_items) x(value)
  loop
    if v_item.quantity is null or v_item.quantity < 1 or v_item.quantity > 999 then
      raise exception 'Số lượng mỗi món phải từ 1 đến 999.';
    end if;
    select id, name, price into v_product from public.products
    where id = v_item.product_id and owner_id = v_uid and available = true;
    if not found then raise exception 'Có sản phẩm không tồn tại hoặc đã ngừng bán.'; end if;
    insert into public.order_items(owner_id,order_id,product_id,product_name,quantity,unit_price,line_total)
    values(v_uid,v_order_id,v_product.id,v_product.name,v_item.quantity,v_product.price,v_item.quantity*v_product.price);
    v_total := v_total + v_item.quantity*v_product.price;
  end loop;
  update public.orders set total = v_total where id = v_order_id;
  return v_order_id;
end; $$;

-- Order status can only be changed through this validated function.
create or replace function public.cafe_set_order_status(p_order_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order record;
begin
  if auth.uid() is null then raise exception 'Bạn chưa đăng nhập.'; end if;
  if p_status is null or p_status not in ('new','preparing','done','cancelled') then raise exception 'Trạng thái không hợp lệ.'; end if;
  select * into v_order from public.orders where id = p_order_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Không tìm thấy đơn hàng.'; end if;
  if p_status = 'cancelled' and v_order.payment_status = 'paid' then
    raise exception 'Đơn đã thu tiền. Hãy xử lý hoàn tiền theo quy trình riêng trước khi hủy.';
  end if;
  if v_order.status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'Không thể khôi phục đơn đã hủy.';
  end if;
  update public.orders set status = p_status where id = p_order_id;
end; $$;

-- Manual payment recording; not a payment gateway integration.
create or replace function public.cafe_set_order_payment(p_order_id uuid, p_payment_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order record;
begin
  if auth.uid() is null then raise exception 'Bạn chưa đăng nhập.'; end if;
  if p_payment_status is null or p_payment_status not in ('unpaid','paid') then raise exception 'Trạng thái thanh toán không hợp lệ.'; end if;
  select * into v_order from public.orders where id = p_order_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Không tìm thấy đơn hàng.'; end if;
  if v_order.status = 'cancelled' then raise exception 'Không thể ghi nhận thanh toán cho đơn đã hủy.'; end if;
  update public.orders set payment_status = p_payment_status,
    paid_at = case when p_payment_status = 'paid' then coalesce(paid_at,now()) else null end
  where id = p_order_id;
end; $$;

revoke all on function public.cafe_create_order(uuid,jsonb,text,text) from public, anon;
revoke all on function public.cafe_set_order_status(uuid,text) from public, anon;
revoke all on function public.cafe_set_order_payment(uuid,text) from public, anon;
grant execute on function public.cafe_create_order(uuid,jsonb,text,text) to authenticated;
grant execute on function public.cafe_set_order_status(uuid,text) to authenticated;
grant execute on function public.cafe_set_order_payment(uuid,text) to authenticated;

-- Optional product photos. Public read; each logged-in user may write only to their own folder.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('cafe-products','cafe-products',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists cafe_storage_insert on storage.objects;
create policy cafe_storage_insert on storage.objects for insert to authenticated
with check(bucket_id='cafe-products' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists cafe_storage_delete on storage.objects;
create policy cafe_storage_delete on storage.objects for delete to authenticated
using(bucket_id='cafe-products' and (storage.foldername(name))[1] = auth.uid()::text);

-- Enable live UI refresh with RLS-protected Postgres Changes.
do $$
declare v_table text;
begin
  foreach v_table in array array['products','customers','orders','order_items'] loop
    if not exists (select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;

-- Important: payments are MANUAL status updates; integrate a verified server webhook when adding real gateways.
-- Important: order items use snapshot price to preserve historic bills if the menu price changes.
