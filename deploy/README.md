# Déploiement Nexus — VPS Host4Fun (crypto, sans carte bancaire)

Guide pas-à-pas pour mettre Nexus en ligne sur un VPS payant en crypto
(USDT/BTC/ETH), **sans carte bancaire**. L'objectif : une app de paris en
Ariary accessible 24/7 (jamais en veille), avec HTTPS automatique et sauvegardes.

> **Pourquoi un VPS payant plutôt que le "gratuit" ?** Les offres gratuites sans
> carte (Render, Fly.io) s'endorment après ~15 min d'inactivité → temps de
> réveil de 30s et erreurs aléatoires. Pour une app qui gère de l'argent réel,
> un joueur doit pouvoir trader/retirer à TOUTE heure. Un petit VPS à ~6 €/mois
> en crypto est le seul chemin fiable sans carte bancaire.

> **Architecture** : une VM Linux fait tourner 4 conteneurs Docker — PostgreSQL,
> Django (gunicorn), Caddy (HTTPS + frontend) et un scheduler (cron sécurité +
> backups). Caddy gère le certificat Let's Encrypt seul.

---

## Prérequis

- Un **nom de domaine** (~12 $/an). Ex : `nexus.mg` chez Cloudflare Registrar
  (au prix coûtant) ou Namecheap. Payable en crypto via des revendeurs si besoin.
- Un **VPS Ubuntu** chez [Host4Fun](https://www.host4fun.com/crypto-vps) (ou équivalent
  acceptant la crypto) : minimum **2 Go RAM / 20 Go disque / Ubuntu 22.04+**.
  - Paiement accepté : **BTC, ETH, USDT, USDC** (aucune carte requise).
  - Recommandé : 2-4 Go RAM (~6-8 €/mois). Évitez le 1 Go (trop juste pour Postgres).
  - Alternatives crypto : [BitLaunch](https://bitlaunch.io/linux-vps/) (BTC/LTC/ETH),
    [SpaceCore](https://spacecore.pro/en/contabo/) (Contabo en crypto, 8 Go RAM).

---

## 1. Louer le VPS Host4Fun

1. Allez sur https://www.host4fun.com/crypto-vps
2. Choisissez une offre **Linux KVM** avec **Ubuntu 22.04 (ou 24.04)** :
   - Minimum : **2 Go RAM / 1 vCPU / 20 Go NVMe**.
   - Localisation : n'importe quel datacenter (l'Europe — Frankfurt, Amsterdam —
     donne une bonne latence depuis Madagascar).
3. Au checkout, payez en **USDT** (ou BTC/ETH/USDC).
4. Vous recevez par email : **l'adresse IP du VPS + le mot de passe root**.

> ℹ️ Sur un VPS classique (Host4Fun, Contabo, Hetzner…), **aucun pare-feu réseau
> externe** ne bloque par défaut : les ports sont ouverts dès l'achat. Le script
> `install.sh` active le pare-feu `ufw` (ports 22/80/443 uniquement) automatiquement.


---

## 2. Pointer le domaine vers la VM

Chez votre registrar (ex : Cloudflare), créez un **enregistrement A** :
- `nexus.mg` → adresse IP publique de la VM.
- `www.nexus.mg` → même IP (ou CNAME vers `nexus.mg`).

> ⚠️ Si vous passez par le **proxy orange Cloudflare** (mode "Proxied"), Caddy ne
> pourra pas obtenir son certificat Let's Encrypt. Soit désactivez le proxy
> (mode "DNS only" / icône grise), soit utilisez plutôt le TLS de Cloudflare.
> Pour faire simple au début : **DNS only** (icône grise).

Attendez que le DNS se propage (~1-15 min) :
```bash
dig +short nexus.mg   # doit renvoyer l'IP de la VM
```

---

## 3. Préparer et installer la VM (en une commande)

Connectez-vous en SSH (utilisateur `ubuntu`) :
```bash
ssh -i <votre-clé-privée> ubuntu@<IP-VM>
```

> 💡 **Méthode rapide — le script `install.sh`** gère TOUT automatiquement :
> il installe Docker, clone votre dépôt, génère les secrets (`SECRET_KEY`,
> mot de passe DB), crée `.env.prod` en vous posant 6 questions, active le
> pare-feu et lance la stack.
>
> ```bash
> # Téléchargez d'abord le script (ou clonez le dépôt, voir méthode manuelle ci-dessous)
> curl -fsSL https://raw.githubusercontent.com/VOTRE-USER/Nexus2/<branche>/deploy/scripts/install.sh -o install.sh
> chmod +x install.sh
> bash install.sh
> ```
> Le script est idempotent : relancez-le si besoin (il reprend où il s'est arrêté).

---

<details>
<summary><b>🛠️ Méthode manuelle (si vous préférez tout faire à la main)</b></summary>

Installez Docker + Docker Compose :
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git

# Docker officiel
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Reconnectez-vous pour que le groupe docker soit actif :
exit
ssh -i <votre-clé-privée> ubuntu@<IP-VM>

docker --version && docker compose version
```

Clonez le dépôt :
```bash
git clone <url-de-votre-repo> ~/nexus
cd ~/nexus
git checkout <votre-branche>   # ex: feat/polymarket-engine
```

Configurez l'environnement :
```bash
cp .env.prod.example .env.prod
```
Éditez `.env.prod` et changez **au minimum** :
- `DJANGO_SECRET_KEY` — générez une clé forte : `python3 -c "import secrets; print(secrets.token_urlsafe(50))"`
- `DJANGO_ALLOWED_HOSTS` — votre domaine (`nexus.mg,www.nexus.mg`).
- `DJANGO_CORS_ALLOWED_ORIGINS` — `https://nexus.mg`.
- `DATABASE_URL` + `DB_PASSWORD` — **changez le mot de passe** (`nexus` est l'exemple).
- `DOMAIN` — votre domaine (`nexus.mg`).
- `ACME_EMAIL` — votre email (notifications Let's Encrypt).
- `MVOLA_NUMBER`, `ORANGE_MONEY_NUMBER`, `AIRTEL_MONEY_NUMBER` — vos **vrais** numéros.

Démarrez la stack :
```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod up -d --build
```

</details>

---

## 4. Vérifier le démarrage

Le 1er build prend ~5-10 min (compilation psycopg2, build frontend Vite).

Surveillez les logs :
```bash
docker compose -f deploy/docker-compose.prod.yml logs -f
```

- Le conteneur `web` affiche `✓ Gunicorn prêt`.
- Le conteneur `caddy` demande son certificat Let's Encrypt (`obtained certificate`).
- Le conteneur `scheduler` affiche `✓ verify_invariants OK` chaque minute.

**Vérification** :
```bash
curl -I https://nexus.mg/healthz
# → HTTP/2 200 , avec {"status":"ok","database":"up"}
```

Ouvrez `https://nexus.mg` dans votre navigateur : la SPA se charge.

---

## 6. Créer un compte admin

```bash
docker compose -f deploy/docker-compose.prod.yml exec web python manage.py createsuperuser
```

Connectez-vous sur `https://nexus.mg/admin/` et à l'espace admin (`/api/admin/`).

---

## Opérations courantes

### Voir les logs
```bash
docker compose -f deploy/docker-compose.prod.yml logs -f web       # API
docker compose -f deploy/docker-compose.prod.yml logs -f scheduler # cron + sécurité
docker compose -f deploy/docker-compose.prod.yml logs -f caddy     # accès + TLS
```

### Lancer manuellement la vérification d'invariants
```bash
docker compose -f deploy/docker-compose.prod.yml exec web python manage.py verify_invariants
```

### Lister les backups
```bash
docker compose -f deploy/docker-compose.prod.yml exec scheduler ls -lh /backups
```

### Restaurer un backup
```bash
# Copier le dump hors du conteneur, puis :
gunzip -c nexus-2026-07-01-0300.sql.gz | \
  docker compose -f deploy/docker-compose.prod.yml exec -T db \
    psql -U nexus -d nexus
```

### Mettre à jour le code (redeploy)
```bash
cd ~/nexus
git pull
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod up -d --build
```

### Arrêter / redémarrer
```bash
docker compose -f deploy/docker-compose.prod.yml down      # arrêt (données conservées)
docker compose -f deploy/docker-compose.prod.yml restart   # redémarrage simple
```

---

## Sécurité — checklist

- [x] `DJANGO_DEBUG=False` dans `.env.prod`.
- [x] `SECRET_KEY` générée aléatoirement (pas celle de dev).
- [x] HTTPS automatique via Caddy + Let's Encrypt.
- [x] PostgreSQL imposé (garde B4 — SQLite refusé en prod).
- [x] `seed_demo` refusé en prod (comptes dev non créés).
- [x] Backups DB quotidiens (rotation 7 jours).
- [x] Cron `verify_invariants` actif chaque minute.
- [x] JWT : access 15 min + rotation + blacklist.
- [x] **Pare-feu VM** : activé automatiquement par `install.sh` (`ufw`, ports 22/80/443).
- [ ] **Transferts des backups hors-site** (recommandé) : copiez `/backups` vers
      un stockage externe (ex : un 2e VPS, un bucket S3-compatible, ou rclone).

---

## En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| Caddy : `obtain certificate: error` | DNS pas propagé / domaine en proxy Cloudflare | Vérifiez `dig +short nexus.mg`, passez Cloudflare en "DNS only" |
| `web` redémarre en boucle | `DB_PASSWORD` différent entre `db` et `web` | Vérifiez `.env.prod` (`DB_PASSWORD` cohérent) |
| `502 Bad Gateway` | `web` pas encore prêt | Attendez le `✓ Gunicorn prêt` dans les logs |
| `verify_invariants` signale une anomalie | Carnet incohérent / bug | Ne **pas** résoudre manuellement ; restaurez le dernier backup sain |

---

## Coûts

| Élément | Coût |
|---|---|
| VPS Host4Fun (2 Go RAM) | **~6-8 €/mois** (payable en USDT/BTC/ETH, sans carte) |
| PostgreSQL / Caddy / scheduler | **0 €** (sur le même VPS) |
| Certificat TLS Let's Encrypt | **0 €** (automatique) |
| Nom de domaine | **~12 $/an** |

**Total : ~7-9 €/mois.** C'est le prix d'un forfait téléphonique — minuscule
pour une app qui encaisse des dépôts en Ariary. Paiement 100% crypto (aucune
carte bancaire requise).
