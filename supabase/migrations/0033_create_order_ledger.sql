create table public.order_ledger (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references public.orders(id) on delete cascade not null,
  student_id uuid references auth.users(id) not null,
  canteen_id uuid references public.canteens(id) not null,
  payment_status text not null default 'PENDING',
  
  food_subtotal numeric(10, 2) not null,
  commission_fee numeric(10, 2) not null,
  target_net numeric(10, 2) not null,
  gross_payable numeric(10, 2) not null,
  gateway_fee numeric(10, 2) not null,
  gw_deduction numeric(10, 2) not null,
  net_settled numeric(10, 2) not null,
  canteen_payable numeric(10, 2) not null,
  platform_net numeric(10, 2) not null,

  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.order_ledger enable row level security;

create policy "Staff/Admin can view all order ledgers" on public.order_ledger for select using (
  public.get_user_role() in ('SUPER_ADMIN', 'ADMIN', 'STAFF')
);

create policy "Users can view own order ledgers" on public.order_ledger for select using (auth.uid() = student_id);
