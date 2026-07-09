-- ===========================================================================
--  Nexus v2 — Payments RPC (Mobile Money, validation manuelle admin)
--
--  Traduction fidèle de payments/services.py en PL/pgSQL.
--
--  DÉPÔT :
--    1. joueur génère un code #DEP-XXXX et effectue le transfert réel hors app ;
--    2. joueur déclare (numéro expéditeur + référence SMS opérateur) ;
--    3. admin identifie la transaction et clique « Approuver » → crédit wallet.
--
--  RETRAIT (2 phases) :
--    1. joueur demande → montant bloqué immédiatement (locked_balance) ;
--    2. admin effectue le transfert réel ;
--    3. admin « Marquer comme Payé » → débit définitif, ou « Rejeter » → déblocage.
-- ===========================================================================

-- Génération de code de référence (ex: #DEP-7F3A9C2).
create or replace function public.gen_payment_code(prefix text)
returns varchar
language sql
security definer
as $$
  select '#' || upper(prefix) || '-' ||
         upper(substring(encode(gen_random_bytes(4), 'hex') from 1 for 7));
$$;


-- ===========================================================================
--  create_deposit_request — le joueur crée une demande de dépôt (PENDING).
-- ===========================================================================
create or replace function public.create_deposit_request(
  p_user_id      uuid,
  p_amount       numeric,
  p_operator     public.payment_operator,
  p_sender_phone varchar,
  p_operator_ref varchar default ''
)
returns public.deposit_requests
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.deposit_requests;
begin
  insert into public.deposit_requests
    (code, user_id, amount, operator, sender_phone, operator_ref, status)
  values
    (public.gen_payment_code('DEP'), p_user_id, p_amount, p_operator, p_sender_phone, p_operator_ref, 'PENDING')
  returning * into v_row;
  return v_row;
end;
$$;


-- approve_deposit — l'admin crédite le wallet du joueur.
-- Reproduit approve_deposit (L30-50).
create or replace function public.approve_deposit(
  p_deposit_id bigint,
  p_admin_id   uuid,
  p_note       text default ''
)
returns public.deposit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit public.deposit_requests;
  v_wallet_id bigint;
  v_entry_id bigint;
begin
  select * into v_deposit from public.deposit_requests where id = p_deposit_id for update;
  if v_deposit.status <> 'PENDING' then
    raise exception 'Cette demande a déjà été traitée.' using errcode = 'raise_exception';
  end if;

  select id into v_wallet_id from public.wallets where user_id = v_deposit.user_id;
  select public.post_entry(
    p_wallet_id := v_wallet_id,
    p_entry_type := 'DEPOSIT',
    p_amount := v_deposit.amount,
    p_related_type := 'deposit',
    p_related_id := p_deposit_id,
    p_reference := v_deposit.code,
    p_note := coalesce(nullif(p_note, ''), 'Dépôt ' || v_deposit.operator || ' ' || v_deposit.sender_phone),
    p_created_by := p_admin_id
  ).entry_id into v_entry_id;

  update public.deposit_requests
    set status = 'APPROVED', processed_by = p_admin_id, processed_at = now(),
        admin_note = p_note, ledger_entry_id = v_entry_id
  where id = p_deposit_id
  returning * into v_deposit;

  return v_deposit;
end;
$$;


-- reject_deposit — l'admin rejette (aucun mouvement de solde).
-- Reproduit reject_deposit (L53-62).
create or replace function public.reject_deposit(
  p_deposit_id bigint,
  p_admin_id   uuid,
  p_note       text default ''
)
returns public.deposit_requests
language plpgsql
security definer
set search_path = public
as $$
declare v_deposit public.deposit_requests;
begin
  select * into v_deposit from public.deposit_requests where id = p_deposit_id for update;
  if v_deposit.status <> 'PENDING' then
    raise exception 'Cette demande a déjà été traitée.' using errcode = 'raise_exception';
  end if;
  update public.deposit_requests
    set status = 'REJECTED', processed_by = p_admin_id, processed_at = now(), admin_note = p_note
  where id = p_deposit_id
  returning * into v_deposit;
  return v_deposit;
end;
$$;


-- ===========================================================================
--  RETRAITS (2 phases)
-- ===========================================================================

-- request_withdraw — crée une demande + bloque immédiatement le montant.
-- Reproduit request_withdraw (L69-96).
create or replace function public.request_withdraw(
  p_user_id        uuid,
  p_amount         numeric,
  p_operator       public.payment_operator,
  p_recipient_phone varchar
)
returns public.withdraw_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id bigint;
  v_row public.withdraw_requests;
begin
  select id into v_wallet_id from public.wallets where user_id = p_user_id;
  begin
    perform public.post_entry(
      p_wallet_id := v_wallet_id,
      p_entry_type := 'WITHDRAW',
      p_amount := -p_amount,
      p_lock := true,
      p_related_type := 'withdraw',
      p_reference := '#WDR-LOCK',
      p_note := 'Blocage retrait ' || p_operator || ' vers ' || p_recipient_phone,
      p_created_by := p_user_id
    );
  exception when check_violation then
    raise exception 'Solde disponible insuffisant.' using errcode = 'raise_exception';
  end;

  insert into public.withdraw_requests
    (code, user_id, amount, operator, recipient_phone, status)
  values
    (public.gen_payment_code('WDR'), p_user_id, p_amount, p_operator, p_recipient_phone, 'PENDING')
  returning * into v_row;
  return v_row;
end;
$$;


-- mark_withdraw_paid — l'admin a effectué le transfert réel → débit définitif.
-- Reproduit mark_withdraw_paid (L99-117).
create or replace function public.mark_withdraw_paid(
  p_withdraw_id bigint,
  p_admin_id    uuid,
  p_operator_ref varchar default '',
  p_note        text default ''
)
returns public.withdraw_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_withdraw public.withdraw_requests;
  v_wallet_id bigint;
  v_entry_id bigint;
begin
  select * into v_withdraw from public.withdraw_requests where id = p_withdraw_id for update;
  if v_withdraw.status <> 'PENDING' then
    raise exception 'Ce retrait a déjà été traité.' using errcode = 'raise_exception';
  end if;

  select id into v_wallet_id from public.wallets where user_id = v_withdraw.user_id;
  select public.settle_locked_withdraw(v_wallet_id, v_withdraw.amount, p_admin_id, v_withdraw.code)
    into v_entry_id;

  update public.withdraw_requests
    set status = 'PAID', processed_by = p_admin_id, processed_at = now(),
        operator_ref = p_operator_ref, admin_note = p_note, ledger_entry_id = v_entry_id
  where id = p_withdraw_id
  returning * into v_withdraw;
  return v_withdraw;
end;
$$;


-- reject_withdraw — l'admin rejette → déblocage du montant.
-- Reproduit reject_withdraw (L120-131).
create or replace function public.reject_withdraw(
  p_withdraw_id bigint,
  p_admin_id    uuid,
  p_note        text default ''
)
returns public.withdraw_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_withdraw public.withdraw_requests;
  v_wallet_id bigint;
begin
  select * into v_withdraw from public.withdraw_requests where id = p_withdraw_id for update;
  if v_withdraw.status <> 'PENDING' then
    raise exception 'Ce retrait a déjà été traité.' using errcode = 'raise_exception';
  end if;
  select id into v_wallet_id from public.wallets where user_id = v_withdraw.user_id;
  perform public.unlock_amount(v_wallet_id, v_withdraw.amount);
  update public.withdraw_requests
    set status = 'REJECTED', processed_by = p_admin_id, processed_at = now(), admin_note = p_note
  where id = p_withdraw_id
  returning * into v_withdraw;
  return v_withdraw;
end;
$$;
