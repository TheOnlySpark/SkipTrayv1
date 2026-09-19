-- Create payment_status enum if not exists
create type public.payment_status as enum ('PENDING', 'SUCCESS', 'FAILED');

-- Create payments table
create table public.payments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  razorpay_order_id text not null,
  razorpay_payment_id text,
  razorpay_signature text,
  amount integer not null,
  status public.payment_status default 'PENDING'::public.payment_status not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS policies for payments
alter table public.payments enable row level security;

-- Users can view their own payments
create policy "Users can view own payments" on public.payments for select using (auth.uid() = user_id);

-- Users can update their own payments (useful if edge function runs with user context)
create policy "Users can update own payments" on public.payments for update using (auth.uid() = user_id);

-- Users can insert their own payments
create policy "Users can insert own payments" on public.payments for insert with check (auth.uid() = user_id);

-- Staff/Admin can view all payments
create policy "Staff/Admin can view all payments" on public.payments for select using (
  public.get_user_role() in ('STAFF', 'ADMIN')
);

-- Add payment_id to orders
alter table public.orders add column payment_id uuid references public.payments(id);
