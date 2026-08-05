-- Function to enforce rate limiting on order placement
create or replace function public.check_order_rate_limit()
returns trigger as $$
declare
  recent_orders_count integer;
begin
  -- Check how many orders this user placed in the last 60 seconds
  select count(*)
  into recent_orders_count
  from public.orders
  where user_id = new.user_id
    and created_at > (now() - interval '1 minute');

  if recent_orders_count > 0 then
    raise exception 'Rate limit exceeded: You can only place one order per minute.';
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- Trigger to run the rate limit check before inserting a new order
create trigger enforce_order_rate_limit
  before insert on public.orders
  for each row
  execute function public.check_order_rate_limit();
