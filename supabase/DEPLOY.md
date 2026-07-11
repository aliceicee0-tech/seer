# Déploiement Nexus v2 — Supabase (gratuit, sans VPS)

Nexus v2 tourne **100% sur Supabase** (Free tier). Plus de VPS, plus de
Docker, plus de `install.sh`. Tout est géré par Supabase : base PostgreSQL,
Edge Functions (API), Auth, cron, HTTPS.

**Coût : 0 $/mois** (Free : 500 Mo DB, 500k appels Edge Functions, 50k users).

---

## 1. Créer le projet Supabase

1. Va sur 👉 **https://supabase.com** → **Start your project** (gratuit, signup GitHub).
2. **New project** :
   - **Name** : `nexus`
   - **Database password** : génère un mot de passe fort, **note-le**.
   - **Region** : **Frankfurt** (Allemagne) — bonne latence depuis Madagascar.
3. Attends ~2 min que la base soit provisionnée.

> ⚠️ **Pas de carte requise** sur le Free tier. Pas de KYC.

---

## 2. Récupérer les clés

Dans **Project Settings → API** :
- `Project URL` (ex: `https://abcd.supabase.co`)
- `anon` public key
- `service_role` secret key (⚠️ confidentiel — pouvoir total)

---

## 3. Activer les extensions requises

Dans **Database → Extensions**, active :
- ✅ `pg_cron` (tâches planifiées)
- ✅ `pg_net` (dépendance de pg_cron)

---

## 4. Activer l'auth par téléphone

Dans **Authentication → Providers** :
- ✅ **Phone** : Enable
- ⚠️ Désactive "Confirm phone" (on veut login par mot de passe, pas OTP SMS)
  → **Authentication → Settings → SMS → Disable phone confirmations**

Dans **Authentication → URL Configuration** :
- **Site URL** : `https://TON-DOMAINE` (ex: `https://nexus.mg`)

---

## 5. Pousser le schéma SQL

Installe la CLI Supabase :
```bash
npm install -g supabase
supabase login
```

Depuis la racine du repo :
```bash
supabase link --project-ref <TON-PROJECT-REF>
supabase db push
```

Cela applique les 8 migrations (`0001` → `0008a`) : tables, contraintes CHECK
(gardes B1/B2/B3), triggers (wallet auto, immuabilité ledger), RLS, et toutes
les fonctions PL/pgSQL critiques (ledger, markets, payments, cron).

---

## 6. Configurer les secrets (variables d'env)

Dans **Project Settings → Edge Functions → Secrets**, ajoute :
```
SHARE_VALUE=5000
MIN_ORDER_PRICE=1
MAX_ORDER_PRICE=4999
PLATFORM_COMMISSION_RATE=10.0
MVOLA_NUMBER=0340000000
ORANGE_MONEY_NUMBER=0320000000
AIRTEL_MONEY_NUMBER=0330000000
MOBILE_MONEY_HOLDER=Nexus Madagascar
```

Ou via la CLI :
```bash
supabase secrets set SHARE_VALUE=5000 MIN_ORDER_PRICE=1 MAX_ORDER_PRICE=4999
supabase secrets set MVOLA_NUMBER=0340000000 ORANGE_MONEY_NUMBER=0320000000 AIRTEL_MONEY_NUMBER=0330000000
```

---

## 7. Déployer les Edge Functions

```bash
supabase functions deploy auth-register
supabase functions deploy auth-login
supabase functions deploy auth-refresh
supabase functions deploy me
supabase functions deploy my-ledger
supabase functions deploy markets
supabase functions deploy markets-write
supabase functions deploy my-trading
supabase functions deploy payments
supabase functions deploy admin
```

Ou tous d'un coup (si ta CLI le supporte) :
```bash
supabase functions deploy --no-verify-jwt
```

---

## 8. Configurer le frontend

```bash
cd frontend
cp .env.example .env
```

Édite `.env` :
```
VITE_API_URL=https://VOTRE-PROJET.supabase.co/functions/v1
```

Build + héberge le frontend statique (Vercel / Netlify / Cloudflare Pages —
gratuit) :
```bash
npm install
npm run build
```

Le dossier `dist/` est déployable sur n'importe quel hébergeur statique gratuit.

---

## 9. Créer le compte admin

Dans **Authentication → Users → Add user** :
- Phone : `0340000001` (le tien)
- Password : un mot de passe fort
- ✅ Auto Confirm User

Puis, dans **SQL Editor**, passe-le admin :
```sql
update profiles set is_staff = true where phone = '0340000001';
```

---

## 10. Tester

- Ouvre `https://TON-DOMAINE` → la SPA se charge.
- Connecte-toi avec ton téléphone + mot de passe.
- Vérifie `GET /me` renvoie ton profil + wallet.
- Teste l'invariant financier (admin) :
  ```bash
  curl https://VOTRE-PROJET.supabase.co/functions/v1/admin/invariants \
    -H "Authorization: Bearer <TON-JWT>"
  ```
  → doit renvoyer `{"frozen_markets":[],"global_invariant_ok":true,...}`

---

## Sécurité — checklist

- [x] PostgreSQL imposé (garde anti-SQLite disparue — Supabase EST Postgres).
- [x] HTTPS automatique (Supabase gère les certificats).
- [x] RLS activée sur toutes les tables (chaque user ne voit que ses données).
- [x] Ledger immuable (trigger `BEFORE UPDATE/DELETE`).
- [x] Contraintes CHECK reproduites (non-négativité, invariants).
- [x] `verify_invariants` tourne chaque minute via pg_cron.
- [x] JWT : access 1h + refresh natif Supabase.
- [x] Backups DB : Supabase gère les backups quotidiens automatiquement.

---

## Coûts

| Élément | Coût |
|---|---|
| Base PostgreSQL (500 Mo) | **0 $** |
| Edge Functions (500k appels/mo) | **0 $** |
| Auth (50k users) | **0 $** |
| Frontend statique (Vercel/Netlify) | **0 $** |
| Nom de domaine | **~12 $/an** |

**Total : ~1 $/mo.** Sans carte bancaire, sans VPS, sans dette technique.
