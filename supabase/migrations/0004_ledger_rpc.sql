-- ===========================================================================
--  Nexus v2 — Ledger RPC (cœur comptable)
--
--  Traduction fidèle de ledger/services.py en PL/pgSQL.
--  Point d'entrée UNIQUE pour tout mouvement de solde. Garantit :
--    - transaction atomique (rollback complet en cas d'erreur) ;
--    - verrou pessimiste SELECT ... FOR UPDATE sur le wallet → pas de double débit ;
--    - immuabilité des écritures (trigger 0002) ;
--    - non-négativité du solde disponible pour les opérations débitaires.
--
--  Les fonctions sont SECURITY DEFINER : elles s'exécutent avec les privilèges
--  du propriétaire (postgres) et court-circuitent la RLS, ce qui permet
--  d'écrire dans wallets/ledger_entries malgré les policies restrictives.
-- ===========================================================================

-- Exception personnalisée reproduisant InsufficientFunds.
-- errcode 'check_violation' pour cohérence avec les CHECK constraints.
create or replace function public.insufficient_funds(msg text)
returns void
language plpgsql
as $$
begin
  raise exception '%', msg using errcode = 'check_violation';
end;
$$;


-- ===========================================================================
--  post_entry — crée une écriture + met à jour le solde, atomiquement.
--  Reproduit ledger/services.py post_entry (L24-101).
--
--  montant POSITIF = crédit, NÉGATIF = débit.
--  lock=true → débit différé (retrait) : le montant passe dans locked_balance.
-- ===========================================================================
create or replace function public.post_entry(
  p_wallet_id    bigint,
  p_entry_type   varchar,
  p_amount       numeric,
  p_related_type varchar default '',
  p_related_id   bigint default null,
  p_reference    varchar default '',
  p_note         varchar default '',
  p_created_by   uuid default null,
  p_lock         boolean default false
)
returns table (wallet_id bigint, entry_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet  record;
  v_amount  numeric := p_amount;
  v_is_debit boolean;
  v_entry_id bigint;
begin
  -- Verrou pessimiste : aucun autre appel concurrent ne peut modifier ce wallet
  -- tant que la transaction n'est pas terminée (équivalent select_for_update).
  select * into v_wallet
  from public.wallets
  where id = p_wallet_id
  for update;

  if not found then
    raise exception 'Wallet % introuvable.', p_wallet_id;
  end if;

  v_is_debit := v_amount < 0;

  -- Garde de non-négativité (faille B1).
  if v_is_debit then
    if p_lock then
      if (v_wallet.balance - v_wallet.locked_balance) + v_amount < 0 then
        perform public.insufficient_funds(
          'Solde disponible insuffisant (' || (v_wallet.balance - v_wallet.locked_balance) || ').'
        );
      end if;
    else
      if v_wallet.balance + v_amount < 0 then
        perform public.insufficient_funds(
          'Solde insuffisant (' || v_wallet.balance || ').'
        );
      end if;
    end if;
  end if;

  -- Application des soldes.
  if p_lock then
    -- Débit différé (retrait) : on incrémente locked_balance, balance inchangé.
    if v_is_debit then
      v_wallet.locked_balance := greatest(0, v_wallet.locked_balance - v_amount);
    else
      -- Annulation d'un retrait : on libère le blocage.
      v_wallet.locked_balance := greatest(0, v_wallet.locked_balance + v_amount);
    end if;
  else
    v_wallet.balance := v_wallet.balance + v_amount;
  end if;

  -- MAJ du wallet. La CHECK constraint wallet_balance_nonneg est la barrière
  -- de dernier recours : si un bug applicatif calculait un solde négatif,
  -- l'UPDATE échouerait et toute la transaction serait annulée (garde B3).
  update public.wallets
    set balance = v_wallet.balance,
        locked_balance = v_wallet.locked_balance
  where id = p_wallet_id;

  -- Création de l'écriture immuable (le trigger 0002 empêche toute modification
  -- ultérieure de cette ligne).
  insert into public.ledger_entries
    (wallet_id, type, amount, balance_after, related_type, related_id,
     reference, note, created_by)
  values
    (p_wallet_id, p_entry_type, v_amount, v_wallet.balance, p_related_type,
     p_related_id, p_reference, p_note, p_created_by)
  returning id into v_entry_id;

  return query select p_wallet_id, v_entry_id;
end;
$$;


-- ===========================================================================
--  lock_amount — réserve `amount` dans locked_balance (fonds d'un ordre d'achat).
--  Reproduit ledger/services.py lock_amount (L104-121).
--  Aucune écriture comptable : séquestre intra-wallet.
-- ===========================================================================
create or replace function public.lock_amount(
  p_wallet_id bigint,
  p_amount    numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance        numeric;
  v_locked_balance numeric;
begin
  select balance, locked_balance into v_balance, v_locked_balance
  from public.wallets where id = p_wallet_id for update;

  if not found then
    raise exception 'Wallet % introuvable.', p_wallet_id;
  end if;

  if (v_balance - v_locked_balance) < p_amount then
    perform public.insufficient_funds(
      'Solde disponible insuffisant (' || (v_balance - v_locked_balance) || ').'
    );
  end if;

  update public.wallets
    set locked_balance = v_locked_balance + p_amount
  where id = p_wallet_id;
end;
$$;


-- ===========================================================================
--  unlock_amount — libère un montant précédemment bloqué.
--  Reproduit ledger/services.py unlock_amount (L124-137).
-- ===========================================================================
create or replace function public.unlock_amount(
  p_wallet_id bigint,
  p_amount    numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked numeric;
begin
  select locked_balance into v_locked
  from public.wallets where id = p_wallet_id for update;

  update public.wallets
    set locked_balance = greatest(0, v_locked - p_amount)
  where id = p_wallet_id;
end;
$$;


-- ===========================================================================
--  settle_buy_fill — règlement atomique d'une exécution d'ordre d'achat LIMIT.
--  Reproduit ledger/services.py settle_buy_fill (L141-183).
--
--  Combine en UNE transaction verrouillée :
--    - débit réel de `cost` sur balance ;
--    - libération de `reserve_release` (part du séquestre price limite).
-- ===========================================================================
create or replace function public.settle_buy_fill(
  p_wallet_id      bigint,
  p_cost           numeric,
  p_reserve_release numeric,
  p_entry_type     varchar,
  p_reference      varchar default '',
  p_note           varchar default '',
  p_related_id     bigint default null,
  p_created_by     uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance        numeric;
  v_locked_balance numeric;
  v_entry_id       bigint;
begin
  select balance, locked_balance into v_balance, v_locked_balance
  from public.wallets where id = p_wallet_id for update;

  -- Garde de non-négativité (faille B1) : jamais débiter plus que le solde.
  if v_balance < p_cost then
    perform public.insufficient_funds(
      'Solde insuffisant pour le règlement d''achat (' || v_balance || ' < ' || p_cost || ').'
    );
  end if;

  v_balance := v_balance - p_cost;
  v_locked_balance := greatest(0, v_locked_balance - p_reserve_release);

  update public.wallets
    set balance = v_balance, locked_balance = v_locked_balance
  where id = p_wallet_id;

  insert into public.ledger_entries
    (wallet_id, type, amount, balance_after, related_type, related_id,
     reference, note, created_by)
  values
    (p_wallet_id, p_entry_type, -p_cost, v_balance, 'order', p_related_id,
     p_reference, p_note, p_created_by)
  returning id into v_entry_id;

  return v_entry_id;
end;
$$;


-- ===========================================================================
--  settle_locked_withdraw — transforme un retrait bloqué en débit réel.
--  Reproduit ledger/services.py settle_locked_withdraw (L186-218).
-- ===========================================================================
create or replace function public.settle_locked_withdraw(
  p_wallet_id bigint,
  p_amount    numeric,
  p_created_by uuid default null,
  p_reference varchar default ''
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance        numeric;
  v_locked_balance numeric;
  v_entry_id       bigint;
begin
  select balance, locked_balance into v_balance, v_locked_balance
  from public.wallets where id = p_wallet_id for update;

  -- Gardes de non-négativité (faille B1) : le retrait a été bloqué au préalable,
  -- donc le montant doit se trouver à la fois dans balance et locked_balance.
  if v_balance < p_amount then
    perform public.insufficient_funds(
      'Solde insuffisant pour finaliser le retrait (' || v_balance || ' < ' || p_amount || ').'
    );
  end if;
  if v_locked_balance < p_amount then
    perform public.insufficient_funds(
      'Séquestre de retrait insuffisant (' || v_locked_balance || ' < ' || p_amount
      || ') — incohérence d''état.'
    );
  end if;

  v_locked_balance := greatest(0, v_locked_balance - p_amount);
  v_balance := v_balance - p_amount;

  update public.wallets
    set balance = v_balance, locked_balance = v_locked_balance
  where id = p_wallet_id;

  insert into public.ledger_entries
    (wallet_id, type, amount, balance_after, related_type, reference, created_by)
  values
    (p_wallet_id, 'WITHDRAW', -p_amount, v_balance, 'withdraw', p_reference, p_created_by)
  returning id into v_entry_id;

  return v_entry_id;
end;
$$;


-- ===========================================================================
--  get_or_create_position_locked — helper (reproduit _get_position_locked).
--  Récupère (ou crée vide) une position avec verrou pessimiste.
-- ===========================================================================
create or replace function public.get_or_create_position_locked(
  p_user_id   uuid,
  p_market_id bigint,
  p_outcome   public.market_outcome
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint;
begin
  insert into public.positions (user_id, market_id, outcome)
  values (p_user_id, p_market_id, p_outcome)
  on conflict (user_id, market_id, outcome) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.positions
    where user_id = p_user_id and market_id = p_market_id and outcome = p_outcome
    for update;
  else
    -- On vient de créer : on la verrouille quand même (cohérence).
    select id into v_id from public.positions
    where user_id = p_user_id and market_id = p_market_id and outcome = p_outcome
    for update;
  end if;

  return v_id;
end;
$$;


-- ===========================================================================
--  new_avg_buy_price — prix moyen pondéré après un achat.
--  Reproduit _new_avg_buy_price (L70-77).
-- ===========================================================================
create or replace function public.new_avg_buy_price(
  p_old_qty   bigint,
  p_old_avg   numeric,
  p_added_qty bigint,
  p_price     numeric
)
returns numeric
language sql immutable
as $$
  select case
    when (p_old_qty + p_added_qty) <= 0 then 0
    else round(
      (p_old_qty * p_old_avg + p_added_qty * p_price)::numeric
        / (p_old_qty + p_added_qty),
      2
    )
  end;
$$;
