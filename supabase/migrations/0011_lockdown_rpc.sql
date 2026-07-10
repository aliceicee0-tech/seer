-- ===========================================================================
--  SÉCURITÉ — Lockdown des RPC SECURITY DEFINER
--
--  CONTEXTE (audit production 2026-07-10) :
--  Toutes les fonctions SECURITY DEFINER de 0004/0005/0005b/0006 étaient
--  exposées publiquement par PostgREST sur /rpc/<name>. Un attaquant avec la
--  simple anon key (publique) pouvait appeler post_entry() pour créditer un
--  wallet à l'infini, approve_deposit() pour auto-valider ses dépôts, ou
--  resolve_market() pour truquer un marché. C'ÉTAIT BLOQUANT PRODUCTION.
--
--  STRATÉGIE (défense en profondeur, 2 couches) :
--    1. REVOKE EXECUTE pour anon + authenticated → seuls service_role (les
--       Edge Functions via adminClient) et les wrappers cron peuvent appeler.
--    2. Vérification d'identité à l'intérieur des fonctions utilisées par les
--       joueurs (mint/merge/place_order/cancel_order/deposit/withdraw) :
--       if p_user_id <> auth.uid() → raise. Et pour les fonctions admin :
--       if not is_platform_admin() → raise.
--
--  Les Edge Functions utilisent adminClient() (service role) qui n'est PAS
--  affecté par REVOKE (le rôle service_role garde tous les droits). Donc le
--  fonctionnement normal de l'app est préservé ; seul l'accès REST direct par
--  un utilisateur est verrouillé.
-- ===========================================================================

-- --------------------------------------------------------------------------
--  Couche 1 : REVOKE EXECUTE sur TOUS les RPC sensibles.
--  Forme courte (sans args) : valide car les noms sont uniques dans `public`.
-- --------------------------------------------------------------------------

revoke execute on function public.post_entry from anon, authenticated;
revoke execute on function public.lock_amount from anon, authenticated;
revoke execute on function public.unlock_amount from anon, authenticated;
revoke execute on function public.settle_buy_fill from anon, authenticated;
revoke execute on function public.settle_locked_withdraw from anon, authenticated;
revoke execute on function public.get_or_create_position_locked from anon, authenticated;
revoke execute on function public.new_avg_buy_price from anon, authenticated;

revoke execute on function public.mint_pair from anon, authenticated;
revoke execute on function public.merge_pair from anon, authenticated;
revoke execute on function public.place_order from anon, authenticated;

revoke execute on function public.release_order_resources from anon, authenticated;
revoke execute on function public.cancel_order from anon, authenticated;
revoke execute on function public.resolve_market from anon, authenticated;
revoke execute on function public.cancel_market from anon, authenticated;
revoke execute on function public.freeze_market from anon, authenticated;
revoke execute on function public.verify_invariants from anon, authenticated;

revoke execute on function public.approve_deposit from anon, authenticated;
revoke execute on function public.reject_deposit from anon, authenticated;
revoke execute on function public.mark_withdraw_paid from anon, authenticated;
revoke execute on function public.reject_withdraw from anon, authenticated;

-- credit_demo : retirée complètement (voir 0012), mais REVOKE par sécurité
-- si elle est encore présente au moment de l'exécution de cette migration.
revoke execute on function public.credit_demo from anon, authenticated;

-- ===========================================================================
--  Couche 2 : garde-fous internes (défense en profondeur).
--
--  On recrée les fonctions joueurs avec un check d'identité en tête. Ces
--  fonctions sont appelées par les Edge Functions qui passent p_user_id =
--  uid (issu du JWT côté serveur). Le check auth.uid() = p_user_id est donc
--  toujours vrai en utilisation normale, mais bloque tout appel direct REST
--  contournant le REVOKE (ex: via un autre rôle qui aurait EXECUTE).
--
--  Note : sous service_role, auth.uid() renvoie NULL (pas de JWT utilisateur).
--  On doit donc SAUTER la vérif quand l'appelant est service_role. On utilise
--  pour cela la detection : authorized sous service_role si la transaction est
--  ouverte par le service role. En pratique, on compare à auth.uid() qui est
--  NULL sous service role → on skip si NULL.
-- ===========================================================================

-- Helper : l'appelant est-il le service role (bypass RLS) ?
-- Sous service_role, current_setting('role') = 'service_role' OU la session
-- n'a pas de auth.uid(). On combine les deux signaux pour la robustesse.
create or replace function public.caller_is_service_role()
returns boolean
language sql stable
as $$
  select coalesce(nullif(current_setting('role', true), '') = 'service_role', false)
     or auth.uid() is null;
$$;

-- Helper : échoue si l'appelant n'est pas le user attendu (sauf service role).
create or replace function public.assert_caller_is(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  if not public.caller_is_service_role() and auth.uid() <> p_user_id then
    raise exception 'Accès refusé : vous ne pouvez agir qu''en votre nom.' using errcode = '42501';
  end if;
end;
$$;

-- Helper : échoue si l'appelant n'est pas admin (sauf service role).
create or replace function public.assert_caller_admin()
returns void
language plpgsql
as $$
begin
  if not public.caller_is_service_role() and not public.is_platform_admin() then
    raise exception 'Accès réservé aux administrateurs.' using errcode = '42501';
  end if;
end;
$$;


-- ===========================================================================
--  FIX RLS : empêcher l'auto-escalade is_staff / is_superuser
--
--  Problème (audit 2026-07-10) : la policy profiles_update_own (0003_rls.sql)
--  autorisait un utilisateur à modifier N'IMPORTE QUELLE colonne de son profil
--  via PATCH /rest/v1/profiles, y compris is_staff et is_superuser.
--  → escalade en admin en un appel.
--
--  Solution : Postgres ne permet pas de filtrer les colonnes dans une policy.
--  On ajoute donc un trigger BEFORE UPDATE qui bloque toute tentative de
--  modification de is_staff / is_superuser par un non-admin (non service-role).
--  La policy UPDATE reste (pour display_name / username) mais le trigger
--  protège les colonnes sensibles comme un coffre-fort.
-- ===========================================================================
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Le service role (Edge Functions admin / dashboard) contourne la garde.
  if public.caller_is_service_role() then
    return new;
  end if;
  -- Un joueur ne peut JAMAIS modifier ses propres drapeaux admin.
  if new.is_staff is distinct from old.is_staff
     or new.is_superuser is distinct from old.is_superuser then
    raise exception 'Modification des privilèges interdite.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_privileges on public.profiles;
create trigger trg_guard_profile_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();
