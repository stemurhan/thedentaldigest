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
