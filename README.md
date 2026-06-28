# Nexus 🇲🇬

**Plateforme de marchés prédictifs locale pour Madagascar** — Sport, Météo & Réseaux Sociaux.
Système de **pari mutuel** (cotes dynamiques), flux financiers **manuels** (MVola / Orange Money / Airtel Money) validés par l'administrateur. PWA mobile-first.

> _1 Point = 1 MGA._

## Stack

| Couche       | Techno                                       |
|--------------|----------------------------------------------|
| Frontend     | React + TypeScript + Vite + Tailwind CSS     |
| Backend      | Django + Django REST Framework               |
| Base de données | PostgreSQL                                |
| Mobile       | PWA (manifest + service worker)              |

## Structure du dépôt

```
nexus/
├── backend/      # API Django (DRF)
├── frontend/     # PWA React
├── docker-compose.yml   # PostgreSQL + (option) backend
├── .env.example         # variables d'environnement
└── README.md
```

## Démarrage rapide

### 1. Prérequis

- Python ≥ 3.11
- Node ≥ 20
- PostgreSQL ≥ 14 (ou `docker compose up -d db`)

### 2. Base de données

```bash
docker compose up -d db           # lance un PostgreSQL local
# ou créez une base PostgreSQL « nexus » manuellement
```

### 3. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example ../.env                            # puis éditez ../.env
python manage.py migrate
python manage.py createsuperuser
python manage.py seed_demo                           # données de démonstration
python manage.py runserver
```

API : http://localhost:8000/api/ · Admin : http://localhost:8000/admin/

### 4. Frontend

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
```

Pour le build PWA : `npm run build` puis `npm run preview`.

## Variables d'environnement

Voir [`.env.example`](./.env.example). Points clés :

- `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`
- `DATABASE_URL`
- `MVOLA_NUMBER`, `ORANGE_MONEY_NUMBER`, `AIRTEL_MONEY_NUMBER` (numéros de réception affichés aux joueurs)
- `PLATFORM_COMMISSION_RATE` — commission plateforme en % (ex. `10.0`)
- `THROTTLE_LOGIN`, `THROTTLE_ANON`, `THROTTLE_USER` — protection anti brute-force

## Catégories de marchés

- ⚽ **Sport** (Coupe du Monde, rugby, foot local…)
- 📱 **Réseaux sociaux** (seuils de followers / vues d'influenceurs)
- 🌦️ **Météo** (vigilance, cyclones, précipitations)
- 📈 **Tendances** (groupes, pages de buzz)

## Clôture automatique des marchés (cron)

Sans tâche planifiée, un marché reste pariable indéfiniment après sa date de clôture.
À lancer périodiquement (cron, Render Cron Job) :

```bash
python manage.py lock_expired_markets
```

## Tests

Les flux financiers (ledger, paris, résolution, dépôts/retraits) sont couverts par tests automatisés :

```bash
cd backend
python manage.py test ledger --verbosity=2
```

## Principes de sécurité

- **Transactions atomiques** : tout mouvement de solde est encapsulé dans une transaction SQL avec verrou (`select_for_update`) pour empêcher les doubles débits.
- **Double-entry ledger** : aucun solde ne change sans une écriture comptable dans `ledger.LedgerEntry` (type + montant signé).
- **Traçabilité** : dépôts, retraits, mises et gains sont tous journalisés.

## Modèle de pari mutuel

La cote (gain potentiel) d'une mise est calculée ainsi :

```
gain = (mise_individuelle / somme_des_mises_sur_le_camp_gagnant)
       × (pool_global × (1 − commission%))
```

Les cotes affichées en direct sont **indicatives** et évoluent jusqu'à la clôture.

---

_Projet en Phase 1 — pas d'agrégateur de paiement : les flux sont validés à la main par l'admin._
