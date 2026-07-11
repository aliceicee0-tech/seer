-- ===========================================================================
--  FIX : gen_payment_code() cassait avec "function gen_random_bytes(integer)
--  does not exist" car l'extension pgcrypto n'était pas activée sur le projet.
--
--  Solution : activer pgcrypto (met gen_random_bytes à disposition globalement)
--  ET rendre gen_payment_code autonome en replaçant gen_random_bytes par
--  gen_random_uuid() — natif à PostgreSQL 13+ (aucune extension requise).
-- ===========================================================================

-- Ceinture + bretelles : on active pgcrypto si elle manque (d'autres fonctions
-- du projet pourraient en dépendre à l'avenir).
create extension if not exists pgcrypto;

-- gen_payment_code v2 : autonome, ne dépend plus de pgcrypto.
-- gen_random_uuid() est natif (PostgreSQL 13+), donc robuste sur tous les
-- projets Supabase, même sans pgcrypto d'activé.
drop function if exists public.gen_payment_code(text);
create or replace function public.gen_payment_code(prefix text)
returns varchar
language sql
security definer
as $$
  select '#' || upper(prefix) || '-' ||
         upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 7));
$$;
