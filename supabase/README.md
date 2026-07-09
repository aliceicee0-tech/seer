# Nexus v2 — Backend Supabase (TypeScript + PL/pgSQL)

Migration du backend Django vers **Supabase** (gratuit à vie, sans VPS).

## Architecture

```
Frontend (SPA React, inchangé)
  → Edge Functions TypeScript  (API REST : lecture + routing)
  → SQL RPC PL/pgSQL            (écritures critiques : argent)
  → PostgreSQL Supabase         (tables + contraintes + RLS + pg_cron)
  → Supabase Auth               (users + JWT)
```

**Principe clé** : toute la logique financière (ledger, carnet d'ordres, résolution)
vit dans des **fonctions PL/pgSQL** exécutées côté base, avec transactions
atomiques + `SELECT ... FOR UPDATE`. C'est **plus sûr** que le Django original
car les verrous ne dépendent plus d'un processus applicatif externe.

## Structure

```
supabase/
  config.toml                  — config projet Supabase
  migrations/
    0001_init_schema.sql        — 11 tables + contraintes CHECK (gardes B1/B2/B3)
    0002_triggers.sql           — wallet auto + immuabilité ledger + updated_at
    0003_rls.sql                — Row Level Security (chaque user voit ses données)
    0004_ledger_rpc.sql         — post_entry, lock/unlock, settle (cœur comptable)
    0005_markets_rpc.sql        — mint/merge, place_order+match, resolve, verify_invariants
    0006_payments_rpc.sql       — approve/reject deposit, withdraw 2-phases
    0007_cron.sql               — pg_cron jobs (verify_invariants, expire_orders…)
    0008_seed_demo.sql          — données de démo (équivalent manage.py seed_demo)
  functions/
    _shared/                    — types + client Supabase partagés
    auth-register/              — POST /auth/register
    auth-login/                 — POST /auth/login
    me/                         — GET /api/me
    markets/                    — GET catalogue + détail + orderbook + trades
    markets-write/              — POST mint/merge/orders, DELETE orders
    payments/                   — GET/POST deposits + withdrawals
    admin/                      — endpoints admin (résolution, validation paiements)
```

## Déploiement

```bash
# 1. Installer la CLI Supabase
npm install -g supabase

# 2. Créer le projet (free tier) sur https://supabase.com
supabase login
supabase init   # déjà fait

# 3. Lier le projet + pousser le schéma
supabase link --project-ref <TON-PROJECT-REF>
supabase db push

# 4. Déployer les Edge Functions
supabase functions deploy --all

# 5. Configurer les secrets (env)
supabase secrets set SHARE_VALUE=5000 MIN_ORDER_PRICE=1 MAX_ORDER_PRICE=4999
```

## Coût

- **0 $/mois** sur le Free tier Supabase (500 Mo DB, 500k invocations, 50k users).
- Scale-up à $25/mo (Pro) quand le trafic grimpe.
