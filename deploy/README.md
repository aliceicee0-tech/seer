# Déploiement Nexus — VPS Linux (Vultr recommandé, paiement crypto)

Guide pas-à-pas pour mettre Nexus en ligne sur un VPS Linux, payable en
**crypto** (sans carte bancaire), avec HTTPS automatique et sauvegardes.

> **Pourquoi un VPS payant plutôt que le "gratuit" ?** Les offres gratuites
> (Render, Fly.io, Oracle Cloud sans réservation) s'endorment après ~15 min
> d'inactivité → temps de réveil de 30s et erreurs aléatoires. Pour une app
> qui gère de l'argent réel, un joueur doit pouvoir trader/retirer à TOUTE
> heure. Un petit VPS à ~6 $/mois en crypto est le seul chemin fiable.

> **Architecture** : une VM Linux fait tourner 4 conteneurs Docker — PostgreSQL,
> Django (gunicorn), Caddy (HTTPS + frontend) et un scheduler (cron sécurité +
> backups). Caddy gère le certificat Let's Encrypt seul. Aucune dépendance à un
> hébergeur spécifique : la stack marche sur tout VPS Ubuntu.

---

## Prérequis

- Un **nom de domaine** (~12 $/an). Ex : `nexus.mg` chez Cloudflare Registrar
  (au prix coûtant) ou Namecheap. Payable en crypto via des revendeurs si besoin.
- Un **VPS Ubuntu** (minimum **2 Go RAM / 20 Go disque / Ubuntu 22.04+**),
  payable en crypto parmi :

  | Hébergeur | Crypto acceptées | Fiabilité | Prix mini | Remarque |
  |---|---|---|---|---|
  | **[Vultr](https://www.vultr.com/promo/bare-metal)** ⭐ | BTC, ETH, LTC, USDC | Excellente | ~$6/mo | **Recommandé** : 32 régions, snapshots auto, DDoS protection |
  | [BitLaunch](https://bitlaunch.io/linux-vps/) | 150+ cryptos | Excellente | ~$8/mo | Revend Vultr/DO/Linode, aucun KYC |
  | [Cloudzy](https://cloudzy.com/hetzner-vps-alternative/) | BTC, ETH, LTC | Bonne | ~$2.48/mo | Le moins cher, alternative Hetzner |
  | [Host4Fun](https://www.host4fun.com/crypto-vps) | BTC, ETH, USDT, USDC | Correcte | ~6 €/mois | Petit acteur, fonctionne |

  > **Recommandation** : **Vultr** pour la production (fiabilité + snapshots
  > automatiques + backups Postgres). Région : **Francfort** ou **Amsterdam**
  > pour une bonne latence depuis Madagascar (~180ms).

---

## 1. Louer le VPS (exemple Vultr)

1. Créez un compte sur https://www.vultr.com/ et créditez en **Bitcoin / ETH /
   USDC** (menu Billing → Cryptocurrency).
2. Déployez une instance (**Products → +**):
   - **Type** : Cloud Compute — Regular (le moins cher, suffit largement).
   - **OS** : **Ubuntu 22.04 LTS** (ou 24.04).
   - **Plan** : **2 Go RAM / 1 vCPU / 55 Go SSD** (~$12/mo) ou **4 Go RAM**
     (~$24/mo) si vous voulez être tranquille. Le build Docker initial consomme
     ~2-3 Go (le swap créé par `install.sh` évite l'OOM).
   - **Region** : Frankfurt (FRA) ou Amsterdam (AMS).
   - **Additional features** : cochez **Auto Backup** (~$1/mo, sauvegarde VPS
     hebdo) et **Enable IPv6**.
3. Notez **l'adresse IP publique** et le **mot de passe root** (ou clé SSH).

> ℹ️ Vultr dispose aussi d'un **Firewall Group** optionnel. Ce n'est pas
> obligatoire (le script `install.sh` active `ufw` sur la VM), mais vous pouvez
> en ajouter un côté console Vultr qui n'ouvre que les ports 22/80/443 pour
> plus de défense en profondeur.

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

Connectez-vous en SSH (utilisateur `root` ou `ubuntu`) :
```bash
ssh root@<IP-VM>
```

> 💡 **Méthode rapide — le script `install.sh`** gère TOUT automatiquement :
> il installe Docker, clone votre dépôt, génère les secrets (`SECRET_KEY`,
> mot de passe DB), crée `.env.prod` en vous posant 6 questions, active le
> pare-feu et lance la stack.
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/aliceicee0-tech/seer/main/deploy/scripts/install.sh -o install.sh
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
| VPS Vultr (2 Go RAM, Francfort) | **~$12/mo** (payable en BTC/ETH/USDC, sans carte) |
| Auto Backup Vultr (hebdo) | **~$1/mo** (optionnel mais recommandé) |
| PostgreSQL / Caddy / scheduler | **0 $** (sur le même VPS) |
| Certificat TLS Let's Encrypt | **0 $** (automatique) |
| Nom de domaine | **~12 $/an** |

**Total : ~$13/mo.** C'est minuscule pour une app qui encaisse des dépôts en
Ariary. Paiement 100% crypto (aucune carte bancaire requise). Si le budget est
très serré, Cloudzy descend à ~$2.48/mo (fiabilité moindre que Vultr).
