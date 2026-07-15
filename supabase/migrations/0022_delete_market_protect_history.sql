-- ===========================================================================
--  Nexus v2 — Protection de l'historique : delete_market ne supprime plus
--  les marchés qui ont des paris.
--
--  PROBLÈME : un admin qui supprimait un marché résolu effaçait aussi tous
--  les paris (table bets) liés → les joueurs perdaient leur historique de
--  paris gagnés/perdus dans « Mes paris ». Or l'admin voulait juste cacher
--  le marché de la liste, pas détruire l'historique.
--
--  FIX : on refuse la suppression si le marché a le moindre pari. La
--  suppression reste autorisée uniquement pour les marchés vides (brouillons
--  créés par erreur, sans activité). Un marché résolu n'a pas besoin d'être
--  supprimé : il disparaît déjà automatiquement de la page d'accueil des
--  joueurs (le catalogue ne montre que OPEN/LOCKED/RESOLVING).
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
  v_total_bets integer;
begin
  if not public.caller_is_service_role() and not public.is_platform_admin() then
    perform public.market_error('Suppression réservée aux administrateurs.');
  end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if not found then
    perform public.market_error('Marché introuvable.');
  end if;

  -- Compte TOUS les paris (quel que soit leur statut).
  -- Si le marché a déjà été parié, on refuse : l'historique des joueurs
  -- ne doit jamais être détruit.
  select count(*) into v_total_bets
    from public.bets where market_id = p_market_id;

  if v_total_bets > 0 then
    perform public.market_error(
      'Suppression impossible : ce marché a ' || v_total_bets
      || ' pari(s). Résolvez-le — il disparaîtra de l''accueil des joueurs'
      || ' et restera dans leur historique. La suppression n''est permise'
      || ' que pour les marchés sans aucune activité.'
    );
  end if;

  -- À ce stade : le marché n'a aucun pari. Nettoyage sûr en cascade.
  delete from public.orders       where market_id = p_market_id;
  delete from public.trades       where market_id = p_market_id;
  delete from public.positions    where market_id = p_market_id;
  delete from public.market_pools where market_id = p_market_id;
  delete from public.markets      where id = p_market_id;
end;
$$;
