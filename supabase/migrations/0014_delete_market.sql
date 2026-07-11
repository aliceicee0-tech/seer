-- ===========================================================================
--  Nexus v2 — Suppression définitive d'un marché (admin)
--
--  Contrairement à cancel_market (qui rembourse et garde le marché visible en
--  statut CANCELLED), delete_market EFFACE complètement le marché et tout ce
--  qui y est lié. Utile pour les marchés de test ou créés par erreur.
--
--  ⚠️ SÉCURITÉ : on ne peut supprimer qu'un marché SANS aucune activité
--  financière (pas de trades, pas de positions ouvertes, pas d'ordres, pas
--  d'escrow). Sinon on lève une erreur pour protéger la comptabilité.
--
--  Un marché déjà résolu ou annulé (avec escrow à 0) peut aussi être supprimé
--  pour nettoyer l'historique.
-- ===========================================================================

create or replace function public.delete_market(
  p_market_id bigint,
  p_admin_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market     record;
  v_pool       record;
  v_trades_cnt integer;
  v_orders_cnt integer;
  v_positions_cnt integer;
begin
  -- Vérifie admin.
  if not public.caller_is_service_role() and not public.is_platform_admin() then
    perform public.market_error('Suppression réservée aux administrateurs.');
  end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if not found then
    perform public.market_error('Marché introuvable.');
  end if;

  -- Récupère le pool (s'il existe).
  select * into v_pool from public.market_pools where market_id = p_market_id;

  -- Compte les activités liées.
  select count(*) into v_trades_cnt from public.trades where market_id = p_market_id;
  select count(*) into v_orders_cnt from public.orders where market_id = p_market_id;
  select count(*) into v_positions_cnt from public.positions where market_id = p_market_id;

  -- Garde de sécurité : on ne supprime JAMAIS un marché avec de l'argent en
  -- jeu (escrow non nul) ou des positions ouvertes.
  if v_pool is not null and v_pool.escrow_balance > 0 then
    perform public.market_error(
      'Suppression impossible : ce marché détient encore ' || v_pool.escrow_balance
      || ' Ar en escrow. Annulez-le d''abord pour rembourser les joueurs.'
    );
  end if;

  if v_positions_cnt > 0 then
    perform public.market_error(
      'Suppression impossible : ' || v_positions_cnt
      || ' position(s) encore ouverte(s). Annulez le marché d''abord.'
    );
  end if;

  -- À ce stade : pas d'escrow, pas de positions → suppression sûre.
  -- On cascade proprement dans l'ordre des dépendances.
  delete from public.orders where market_id = p_market_id;
  delete from public.trades where market_id = p_market_id;
  delete from public.positions where market_id = p_market_id;
  delete from public.market_pools where market_id = p_market_id;
  delete from public.markets where id = p_market_id;
end;
$$;
