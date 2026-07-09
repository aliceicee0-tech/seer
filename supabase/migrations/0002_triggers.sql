-- ===========================================================================
--  Nexus v2 — Triggers (reproduit les signaux Django + immuabilité du ledger)
-- ===========================================================================

-- --------------------------------------------------------------------------
--  1. Profil + Wallet auto à la création d'un utilisateur Supabase Auth.
--     Reproduit core/signals.py : ensure_wallet (post_save → get_or_create).
-- --------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Profil : phone vient des métadonnées d'inscription (raw_user_meta_data).
  insert into public.profiles (id, phone, display_name, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'phone', new.phone, ''),
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    coalesce(new.raw_user_meta_data->>'username', '')
  )
  on conflict (id) do nothing;

  -- Wallet : 1 par utilisateur, vide à la création (équivalent get_or_create).
  insert into public.wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------------------
--  2. IMMUABILITÉ du ledger — reproduit PermissionError sur save()/delete()
--     d'une entrée existante (ledger/models.py L134-141).
--     Toute modification ou suppression d'une écriture existante lève une erreur.
-- --------------------------------------------------------------------------
create or replace function public.block_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Une écriture du ledger est immuable (création seule autorisée).'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists ledger_no_update on public.ledger_entries;
create trigger ledger_no_update
  before update on public.ledger_entries
  for each row execute function public.block_ledger_mutation();

drop trigger if exists ledger_no_delete on public.ledger_entries;
create trigger ledger_no_delete
  before delete on public.ledger_entries
  for each row execute function public.block_ledger_mutation();

-- --------------------------------------------------------------------------
--  3. updated_at automatique sur toutes les tables mutables
--     (équivalent auto_now=True de Django).
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'profiles', 'wallets', 'markets', 'market_pools', 'positions',
      'orders', 'deposit_requests', 'withdraw_requests'
    ])
  loop
    execute format('drop trigger if exists set_updated_at on public.%I;', t);
    execute format(
      'create trigger set_updated_at before update on public.%I '
      'for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- --------------------------------------------------------------------------
--  4. Normalisation du téléphone (reproduit core/models.py normalize_phone).
--     Les numéros malgaches sont stockés en forme locale 0XXXXXXXXX.
-- --------------------------------------------------------------------------
create or replace function public.normalize_phone(raw text)
returns text
language sql immutable
as $$
  select case
    when raw is null or raw = '' then ''
    else regexp_replace(
      case
        when regexp_replace(raw, '\D', '', 'g') like '00261%'
          then '0' || substring(regexp_replace(raw, '\D', '', 'g') from 6)
        when regexp_replace(raw, '\D', '', 'g') like '261%'
          then '0' || substring(regexp_replace(raw, '\D', '', 'g') from 4)
        else regexp_replace(raw, '\D', '', 'g')
      end,
      '\D', '', 'g'
    )
  end;
$$;

comment on function public.normalize_phone(text) is
  'Normalise un numéro malgache en forme locale 0XXXXXXXXX (+261/00261 → 0…).';
