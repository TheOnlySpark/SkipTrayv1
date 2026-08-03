-- Create custom types
create type public.user_role as enum ('STUDENT', 'TEACHER', 'STAFF', 'ADMIN');
create type public.food_type as enum ('VEG', 'NON_VEG');
create type public.order_status as enum ('PLACED', 'ACCEPTED', 'REJECTED', 'PREPARING', 'READY', 'COLLECTED');

-- Create profiles table
create table public.profiles (
  id uuid references auth.users not null primary key,
  name text,
  id_number text,
  role public.user_role default 'STUDENT'::public.user_role not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create menu_items table
create table public.menu_items (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  veg_non_veg public.food_type not null,
  is_sold_out boolean default false not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create orders table
create table public.orders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  status public.order_status default 'PLACED'::public.order_status not null,
  pickup_time text not null,
  otp_code text unique not null,
  otp_attempts int default 0 not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  accepted_at timestamp with time zone,
  ready_at timestamp with time zone,
  collected_at timestamp with time zone
);

-- Enforce 1 active order per user
create unique index one_active_order_per_user_idx on public.orders (user_id) 
where status in ('PLACED', 'ACCEPTED', 'PREPARING', 'READY');

-- Create order_items table
create table public.order_items (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references public.orders(id) on delete cascade not null,
  menu_item_id uuid references public.menu_items(id) not null,
  quantity int not null check (quantity > 0)
);

-- Enable Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- PROFILES POLICIES
-- Users can view their own profile
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
-- Users can update their own profile
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
-- Staff and Admin can view all profiles
create policy "Staff/Admin can view all profiles" on public.profiles for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('STAFF', 'ADMIN'))
);

-- MENU ITEMS POLICIES
-- Anyone can view menu items
create policy "Anyone can view menu items" on public.menu_items for select using (true);
-- Admin can insert menu items
create policy "Admin can insert menu items" on public.menu_items for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'ADMIN')
);
-- Admin can update menu items
create policy "Admin can update menu items" on public.menu_items for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'ADMIN')
);
-- Admin can delete menu items
create policy "Admin can delete menu items" on public.menu_items for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'ADMIN')
);

-- ORDERS POLICIES
-- Users can view their own orders
create policy "Users can view own orders" on public.orders for select using (auth.uid() = user_id);
-- Users can insert their own orders
create policy "Users can insert own orders" on public.orders for insert with check (auth.uid() = user_id);
-- Staff/Admin can view all orders
create policy "Staff/Admin can view all orders" on public.orders for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('STAFF', 'ADMIN'))
);
-- Staff/Admin can update all orders
create policy "Staff/Admin can update all orders" on public.orders for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('STAFF', 'ADMIN'))
);

-- ORDER ITEMS POLICIES
-- Users can view their own order items
create policy "Users can view own order items" on public.order_items for select using (
  exists (select 1 from public.orders where id = order_items.order_id and user_id = auth.uid())
);
-- Users can insert their own order items
create policy "Users can insert own order items" on public.order_items for insert with check (
  exists (select 1 from public.orders where id = order_items.order_id and user_id = auth.uid())
);
-- Staff/Admin can view all order items
create policy "Staff/Admin can view all order items" on public.order_items for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('STAFF', 'ADMIN'))
);

-- Function to handle profile creation on auth.users insert
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'STUDENT');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- RPC for toggling sold_out status by Staff/Admin
create or replace function public.toggle_sold_out(item_id uuid, new_status boolean)
returns void as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('STAFF', 'ADMIN')) then
    raise exception 'Unauthorized';
  end if;

  update public.menu_items
  set is_sold_out = new_status, updated_at = now()
  where id = item_id;
end;
$$ language plpgsql security definer;
