-- ===========================================================================
--  SÉCURITÉ — Retrait de credit_demo (porte dérobée de crédit illimité)
--
--  CONTEXTE (audit 2026-07-10) :
--  credit_demo() (0008a) est une fonction SECURITY DEFINER qui crée un faux
--  dépôt APPROVED pour créditer n'importe quel wallet. Bien qu'elle fût
--  REVOKE-e dans 0011, la fonction elle-même reste un risque si un jour les
--  permissions sont ré-ouvertes par erreur, ou si elle est appelée depuis
--  un trigger/RPC compromis. On la supprime définitivement en production.
--
--  Le seed démo (0008_seed_demo.sql) ne doit de toute façon JAMAIS être
--  exécuté en production (il créait des comptes à mots de passe connus).
-- ===========================================================================

drop function if exists public.credit_demo(uuid, numeric);
