create extension if not exists pgcrypto;

create table if not exists public.customer_accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  favorite_platform text not null default 'Betano',
  access_status text not null default 'trialing'
    check (access_status in ('trialing', 'pending_payment', 'active', 'expired', 'blocked')),
  trial_started_at timestamptz not null default timezone('utc', now()),
  trial_ends_at timestamptz not null default timezone('utc', now()) + interval '5 hours',
  access_until timestamptz,
  pix_amount_cents integer not null default 1990,
  pix_key text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pix_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.customer_accounts(id) on delete cascade,
  provider text not null default 'manual_pix',
  amount_cents integer not null default 1990,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'expired', 'cancelled', 'under_review')),
  pix_key text not null,
  qr_payload text not null,
  txid text not null unique,
  paid_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists touch_customer_accounts_updated_at on public.customer_accounts;
create trigger touch_customer_accounts_updated_at
before update on public.customer_accounts
for each row
execute function public.touch_updated_at();

drop trigger if exists touch_pix_charges_updated_at on public.pix_charges;
create trigger touch_pix_charges_updated_at
before update on public.pix_charges
for each row
execute function public.touch_updated_at();

create or replace function public.handle_new_customer_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_name text;
  meta_platform text;
begin
  meta_name := coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), 'Cliente');
  meta_platform := coalesce(new.raw_user_meta_data ->> 'favorite_platform', 'Betano');

  insert into public.customer_accounts (
    id,
    email,
    display_name,
    favorite_platform
  )
  values (
    new.id,
    new.email,
    meta_name,
    meta_platform
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name,
    favorite_platform = excluded.favorite_platform;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_customer_account on auth.users;
create trigger on_auth_user_created_customer_account
after insert on auth.users
for each row
execute function public.handle_new_customer_account();

alter table public.customer_accounts enable row level security;
alter table public.pix_charges enable row level security;

drop policy if exists "customer can view own account" on public.customer_accounts;
create policy "customer can view own account"
on public.customer_accounts
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "customer can update own profile" on public.customer_accounts;
create policy "customer can update own profile"
on public.customer_accounts
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "customer can view own pix charges" on public.pix_charges;
create policy "customer can view own pix charges"
on public.pix_charges
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "service role manages pix charges" on public.pix_charges;
create policy "service role manages pix charges"
on public.pix_charges
for all
to service_role
using (true)
with check (true);

drop policy if exists "service role manages customer accounts" on public.customer_accounts;
create policy "service role manages customer accounts"
on public.customer_accounts
for all
to service_role
using (true)
with check (true);
