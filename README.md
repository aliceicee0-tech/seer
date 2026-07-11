# Nexus 🇲🇬

**Plateforme de marchés prédictifs pour Madagascar** — Sport, Météo & Réseaux Sociaux.
Moteur **collatéralisé** (type Polymarket / CLOB), flux financiers **manuels**
(MVola / Orange Money / Airtel Money) validés par l'administrateur. PWA mobile-first.

> _1 Point = 1 MGA._

## Stack

| Couche          | Techno                                         |
|-----------------|------------------------------------------------|
| Frontend        | React + TypeScript + Vite + Tailwind CSS (PWA) |
| API             | Supabase Edge Functions (Deno / TypeScript)    |
| Base de données | PostgreSQL managé Supabase                      |
| Logique métier  | PL/pgSQL (RPC `SECURITY DEFINER` + RLS)         |
| Auth            | Supabase Auth (téléphone → email déguisé)       |

## Structure du dépôt

```
nexus/
├── frontend/              # PWA React (Vite)
├── supabase/
│   ├── functions/         # Edge Functions (API Deno)
│   ├── migrations/        # Schéma SQL + RPC + RLS + cron
│   └── config.toml        # Config locale Supabase CLI
└── .github/workflows/     # CI : déploiement auto des Edge Functions
```

## Démarrage rapide

### 1. Frontend (dev local)

```bash
cd frontend
cp .env.example .env      # renseigner VITE_API_URL
npm install
npm run dev               # http://localhost:5173
```

### 2. Supabase

Le projet tourne 100 % sur Supabase (pas de VPS, pas de Docker).

- **Migrations SQL** : exécuter `supabase/migrations/*.sql` dans l'ordre via le
  SQL Editor du dashboard Supabase, ou `supabase db push` après `supabase link`.
- **Edge Functions** : déployées automatiquement par la GitHub Action
  `.github/workflows/deploy-functions.yml` à chaque push sur `main`.

Voir [`supabase/DEPLOY.md`](./supabase/DEPLOY.md) pour la checklist complète.

## Variables d'environnement

### Frontend (`frontend/.env`)

```
VITE_API_URL=https://VOTRE-PROJET.supabase.co/functions/v1
```

### Edge Functions (secrets Supabase → Dashboard → Edge Functions → Secrets)

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `MOBILE_MONEY_HOLDER`, `MVOLA_NUMBER`, `ORANGE_MONEY_NUMBER`, `AIRTEL_MONEY_NUMBER`
- `SHARE_VALUE` (défaut 5000), `PLATFORM_COMMISSION_RATE` (défaut 10)

## Sécurité

- **Transactions atomiques** : tout mouvement de solde utilise un verrou
  pessimiste (`SELECT ... FOR UPDATE`) via les RPC PL/pgSQL.
- **Ledger immuable** : aucun solde ne change sans une écriture comptable
  (`ledger_entries`), protégée contre modification/suppression par trigger.
- **RLS + RPC verrouillés** : les écritures sensibles passent uniquement par
  des fonctions `SECURITY DEFINER` dont l'exécution est `REVOKE`-ée pour les
  rôles `anon`/`authenticated` (voir migration `0011_lockdown_rpc.sql`).
- **Gardes CHECK** : aucun solde ni séquestre ne peut devenir négatif.

## Catégories de marchés

- ⚽ **Sport** (Coupe du Monde, rugby, foot local…)
- 📱 **Réseaux sociaux** (seuils de followers / vues)
- 🌦️ **Météo** (vigilance, cyclones, précipitations)
- 📈 **Tendances** (groupes, pages de buzz)
