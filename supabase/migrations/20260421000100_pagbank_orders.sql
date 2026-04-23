create table if not exists public.pagbank_orders (
  id uuid primary key default gen_random_uuid(),
  account_id text,
  provider text not null default 'pagbank',
  reference_id text not null unique,
  order_id text not null unique,
  charge_id text,
  status text not null default 'WAITING',
  amount_cents integer not null default 1990,
  customer_name text,
  customer_email text,
  customer_tax_id text,
  customer_phone text,
  qr_code_text text,
  qr_code_image_url text,
  notification_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  raw_response jsonb not null default '{}'::jsonb,
  raw_last_status jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pagbank_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  reference_id text,
  status text,
  authenticity_token text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists touch_pagbank_orders_updated_at on public.pagbank_orders;
create trigger touch_pagbank_orders_updated_at
before update on public.pagbank_orders
for each row
execute function public.touch_updated_at();

alter table public.pagbank_orders enable row level security;
alter table public.pagbank_notifications enable row level security;

drop policy if exists "service role manages pagbank orders" on public.pagbank_orders;
create policy "service role manages pagbank orders"
on public.pagbank_orders
for all
to service_role
using (true)
with check (true);

drop policy if exists "service role manages pagbank notifications" on public.pagbank_notifications;
create policy "service role manages pagbank notifications"
on public.pagbank_notifications
for all
to service_role
using (true)
with check (true);
