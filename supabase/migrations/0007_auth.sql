-- ===========================================================================
--  Nexus v2 — Auth & cron
--
--  L'auth est gérée nativement par Supabase Auth (auth.users). Les Edge
--  Functions gèrent register/login via l'API Admin (pour créer l'utilisateur
--  avec le téléphone en métadonnée). Le trigger 0002 crée profil + wallet auto.
--
--  Ce fichier configure :
--    - l'extension pg_cron (tâches planifiées) ;
--    - les jobs cron (verify_invariants, expire_orders, auto_lock) ;
--    - le setting par défaut SHARE_VALUE.
-- ===========================================================================

-- --------------------------------------------------------------------------
--  Extension pg_cron (nécessite de l'activer dans le dashboard Supabase :
--  Database → Extensions → activer "pg_cron" + "pg_net").
-- --------------------------------------------------------------------------
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Setting de configuration global ( SHARE_VALUE par défaut = 5000 Ar ).
-- Surchargeable via Supabase → Database → Config.
alter database postgres set app.share_value = '5000';

-- ===========================================================================
--  Jobs pg_cron — reproduisent deploy/scripts/scheduler.sh
--
--  Note : pg_cron s'exécute dans le schéma de la base nominale. On wrappe
--  chaque appel dans un SECURITY DEFINER pour s'affranchir de la RLS.
-- ===========================================================================

-- Wrapper sécurisé : vérification d'invariants (chaque minute).
create or replace function public.cron_verify_invariants()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.verify_invariants();
  -- Log le résultat dans les logs Postgres (visible dans le dashboard Supabase).
end;
$$;

-- Wrapper : expiration des ordres (chaque minute).
create or replace function public.cron_expire_orders()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.expire_orders();
end;
$$;

-- Wrapper : gel automatique des marchés expirés (chaque minute).
create or replace function public.cron_auto_lock()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.auto_lock_expired_markets();
end;
$$;

-- Planification des jobs (une fois par minute = '* * * * *').
-- Idempotent : on supprime avant de recréer pour éviter les doublons.
do $$
begin
  perform cron.unschedule('nexus-verify-invariants');
  perform cron.schedule('nexus-verify-invariants', '* * * * *', $$select public.cron_verify_invariants();$$);

  perform cron.unschedule('nexus-expire-orders');
  perform cron.schedule('nexus-expire-orders', '* * * * *', $$select public.cron_expire_orders();$$);

  perform cron.unschedule('nexus-auto-lock');
  perform cron.schedule('nexus-auto-lock', '* * * * *', $$select public.cron_auto_lock();$$);
exception
  -- Sur le free tier, pg_cron peut nécessiter un redémarrage du projet.
  -- On logge sans planter la migration.
  when others then
    raise notice 'pg_cron non disponible : %', sqlerrm;
end $$;
