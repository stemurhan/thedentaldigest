-- Analiz365 - uyelik veritabani (Supabase / PostgreSQL)
-- Supabase panelinde: SQL Editor > New query > bu dosyanin tamamini yapistir > Run.
-- Tekrar calistirilabilir (mevcut tablolar korunur).

-- ---------- tablolar ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null,
  phone        text,
  balance      numeric(12, 2) not null default 1000 check (balance >= 0),
  favs         jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

create table if not exists public.coupons (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  stake      numeric(12, 2) not null,
  odds       numeric(12, 2) not null,
  win        numeric(12, 2) not null,
  status     text not null default 'pending' check (status in ('pending', 'won', 'lost')),
  sels       jsonb not null
);
create index if not exists coupons_user_idx on public.coupons (user_id, created_at desc);
create index if not exists coupons_pending_idx on public.coupons (status) where status = 'pending';

-- ---------- erisim kurallari (RLS) ----------
alter table public.profiles enable row level security;
alter table public.coupons  enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists coupons_select_own on public.coupons;
create policy coupons_select_own on public.coupons for select using (auth.uid() = user_id);

-- uye yalnizca favorilerini ve telefonunu degistirebilir; bakiye yalnizca sunucu fonksiyonlariyla degisir
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (favs, phone) on public.profiles to authenticated;
revoke insert, update, delete on public.coupons from anon, authenticated;

-- ---------- yeni uye -> profil ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name, phone)
  values (new.id,
          lower(new.raw_user_meta_data ->> 'username'),
          coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), new.raw_user_meta_data ->> 'username'),
          nullif(new.raw_user_meta_data ->> 'phone', ''));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- kupon oyna (bakiye kontrolu sunucuda) ----------
create or replace function public.place_coupon(p_id text, p_stake numeric, p_sels jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  bal  numeric;
  odds numeric := 1;
  s    jsonb;
  n    int;
begin
  if uid is null then raise exception 'auth'; end if;
  if p_id !~ '^A[0-9]{8,14}$' then raise exception 'id'; end if;
  n := jsonb_array_length(p_sels);
  if n < 1 or n > 20 then raise exception 'sel_count'; end if;
  if p_stake < 20 or p_stake > 5000 then raise exception 'stake'; end if;
  if (select count(distinct e ->> 'm') from jsonb_array_elements(p_sels) e) <> n then raise exception 'dup'; end if;
  for s in select * from jsonb_array_elements(p_sels) loop
    if (s ->> 'd')::timestamptz <= now() then raise exception 'started'; end if;
    if (s ->> 'o')::numeric < 1.01 or (s ->> 'o')::numeric > 100 then raise exception 'odds'; end if;
    odds := odds * (s ->> 'o')::numeric;
  end loop;
  odds := round(odds, 2);
  select balance into bal from profiles where id = uid for update;
  if bal is null then raise exception 'profile'; end if;
  if bal < p_stake then raise exception 'balance'; end if;
  insert into coupons (id, user_id, stake, odds, win, sels)
  values (p_id, uid, p_stake, odds, least(round(p_stake * odds, 2), 500000), p_sels);
  update profiles set balance = balance - p_stake where id = uid returning balance into bal;
  return bal;
end $$;

-- ---------- demo bakiyeyi sifirla ----------
create or replace function public.reset_balance() returns numeric
language plpgsql security definer set search_path = public as $$
declare bal numeric;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  update profiles set balance = 1000 where id = auth.uid() returning balance into bal;
  return bal;
end $$;

-- ---------- sonuclandirma (yalnizca sunucu anahtariyla, GitHub Actions'tan) ----------
create or replace function public.ahal_wins(k text, hs int, aw int, line numeric) returns boolean
language sql immutable as $$
  select case k
    when '1'   then hs > aw
    when 'X'   then hs = aw
    when '2'   then hs < aw
    when '1X'  then hs >= aw
    when '12'  then hs <> aw
    when 'X2'  then hs <= aw
    when 'KGV' then hs > 0 and aw > 0
    when 'KGY' then not (hs > 0 and aw > 0)
    when 'BO'  then hs + aw > line
    when 'BU'  then hs + aw < line
    else case
      when left(k, 1) = 'O' then hs + aw > substr(k, 2)::numeric
      when left(k, 1) = 'U' then hs + aw < substr(k, 2)::numeric
      else false end
  end $$;

create or replace function public.settle_coupons(p_results jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  c        record;
  s        jsonb;
  r        jsonb;
  new_sels jsonb;
  all_in   boolean;
  lost     boolean;
  any_res  boolean;
  ok       boolean;
  n        int := 0;
begin
  for c in select * from coupons where status = 'pending' for update loop
    all_in := true; lost := false; any_res := false; new_sels := '[]'::jsonb;
    for s in select * from jsonb_array_elements(c.sels) loop
      r := p_results -> (s ->> 'm');
      if r is null then
        if (s ->> 'ok') is null then all_in := false; end if;
        if (s ->> 'ok') = 'false' then lost := true; end if;
      else
        any_res := true;
        ok := ahal_wins(s ->> 'k', (r ->> 0)::int, (r ->> 1)::int, coalesce((s ->> 'ln')::numeric, 0));
        s := s || jsonb_build_object('res', (r ->> 0) || '-' || (r ->> 1), 'ok', ok);
        if not ok then lost := true; end if;
      end if;
      new_sels := new_sels || jsonb_build_array(s);
    end loop;
    if any_res then update coupons set sels = new_sels where id = c.id; end if;
    if lost then
      update coupons set status = 'lost' where id = c.id; n := n + 1;
    elsif all_in then
      update coupons set status = 'won' where id = c.id;
      update profiles set balance = balance + c.win where id = c.user_id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke all on function public.place_coupon(text, numeric, jsonb) from public, anon;
grant execute on function public.place_coupon(text, numeric, jsonb) to authenticated;
revoke all on function public.reset_balance() from public, anon;
grant execute on function public.reset_balance() to authenticated;
revoke all on function public.settle_coupons(jsonb) from public, anon, authenticated;
grant execute on function public.settle_coupons(jsonb) to service_role;


-- Analiz365 - 002: kayitli kuponlar + guvenlik sikilastirmalari
-- Supabase > SQL Editor'de calistirilir. Tekrar calistirilabilir.

-- ---------- kayitli kuponlar (oynamadan saklama / takip) ----------
create table if not exists public.saved_coupons (
  id         text primary key check (id ~ '^S[0-9]{8,14}$'),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  name       text check (name is null or char_length(name) <= 40),
  sels       jsonb not null check (jsonb_typeof(sels) = 'array'
                                   and jsonb_array_length(sels) between 1 and 20
                                   and pg_column_size(sels) < 24000)
);
create index if not exists saved_user_idx on public.saved_coupons (user_id, created_at desc);
alter table public.saved_coupons enable row level security;

drop policy if exists saved_select_own on public.saved_coupons;
create policy saved_select_own on public.saved_coupons for select using (auth.uid() = user_id);
drop policy if exists saved_insert_own on public.saved_coupons;
create policy saved_insert_own on public.saved_coupons for insert with check (auth.uid() = user_id);
drop policy if exists saved_update_own on public.saved_coupons;
create policy saved_update_own on public.saved_coupons for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists saved_delete_own on public.saved_coupons;
create policy saved_delete_own on public.saved_coupons for delete using (auth.uid() = user_id);

revoke all on public.saved_coupons from anon;
grant select, insert, delete on public.saved_coupons to authenticated;
grant update (name, sels) on public.saved_coupons to authenticated;

-- uye basina en fazla 100 kayitli kupon
create or replace function public.saved_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from saved_coupons where user_id = new.user_id) >= 100 then
    raise exception 'saved_limit';
  end if;
  return new;
end $$;
drop trigger if exists saved_limit on public.saved_coupons;
create trigger saved_limit before insert on public.saved_coupons
  for each row execute function public.saved_limit();

-- ---------- profiller: alan boyutu sinirlari ----------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_favs_len') then
    alter table public.profiles add constraint profiles_favs_len
      check (jsonb_typeof(favs) = 'array' and jsonb_array_length(favs) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_phone_len') then
    alter table public.profiles add constraint profiles_phone_len check (phone is null or char_length(phone) <= 32);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_dname_len') then
    alter table public.profiles add constraint profiles_dname_len check (char_length(display_name) between 1 and 30);
  end if;
end $$;

-- yeni uye: gorunen ad / telefon uzunlugu kirpilir
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name, phone)
  values (new.id,
          lower(new.raw_user_meta_data ->> 'username'),
          left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), new.raw_user_meta_data ->> 'username'), 30),
          left(nullif(new.raw_user_meta_data ->> 'phone', ''), 32));
  return new;
end $$;

-- ---------- oran oynanmis (kurcalanmis) kuponlari gecersiz say ----------
create or replace function public.void_coupons(p_ids text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update coupons set status = 'lost' where id = any(p_ids) and status = 'pending';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.void_coupons(text[]) from public, anon, authenticated;
grant execute on function public.void_coupons(text[]) to service_role;

-- fonksiyonlarin search_path'i sabit (guvenlik onerisi)
alter function public.ahal_wins(text, int, int, numeric) set search_path = public;

-- tetikleyici fonksiyonlari API'den cagrilamaz (yalnizca veritabani icinde calisir)
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.saved_limit() from public, anon, authenticated;
