# Déploiement Nexus — Oracle Cloud Always Free

Guide pas-à-pas pour mettre Nexus en ligne **gratuitement** sur Oracle Cloud.
L'objectif : une app de paris en Ariary accessible 24/7, sans coût d'hébergement,
avec HTTPS automatique et sauvegardes.

> **Architecture** : une VM Oracle ARM (gratuite à vie) fait tourner 4 conteneurs
> Docker — PostgreSQL, Django (gunicorn), Caddy (HTTPS + frontend) et un scheduler
> (cron de sécurité + backups). Caddy gère le certificat Let's Encrypt seul.

---

## Prérequis

- Un **nom de domaine** (~12 $/an — le seul vrai coût). Ex : `nexus.mg` chez Cloudflare.
- Un **compte Oracle Cloud** (carte bancaire demandée à l'inscription pour vérification, mais **0 € facturé** sur Always Free).

---

## 1. Créer la VM Oracle Cloud (gratuite, à vie)

1. Inscrivez-vous sur https://www.oracle.com/cloud/free/ (Always Free).
   - Carte bancaire demandée à l'inscription (vérification), **0 € facturé** en Always Free.
   - **Choisissez bien la "home region"** (région d'accueil) : c'est définitif et
     ça influence la disponibilité. Préférez une région moins saturée si possible
     (ex : Milan, Marseille, Johannesburg plutôt que les US).
2. Console → **Compute → Instances → Create instance**.
3. **Image** : `Canonical Ubuntu 22.04` (ou 24.04).
4. **Shape** : `VM.Standard.A1.Flex` (ARM Ampere) — réglez à **2 OCPU / 12 Go RAM**.
   - ⚠️ Depuis mi-2025, le quota Always Free est **2 OCPU / 12 Go RAM** (anciennement 4/24).
   - C'est largement suffisant pour Nexus au lancement (PostgreSQL + gunicorn + Caddy).
5. **SSH keys** : générez une paire de clés (ou utilisez la vôtre) — **gardez la clé privée**.
6. **Create**. Notez l'**adresse IP publique** attribuée.

> ⚠️ **"Out of host capacity"** : la shape ARM A1 est souvent en rupture temporaire.
> C'est courant, pas grave. Plusieurs solutions :
> - Réessayez à des heures creuses (tôt le matin, week-end).
> - Utilisez un [script de "retry" automatique](https://www.community.amperecomputing.com/t/how-to-get-around-the-out-of-capacity-error-on-the-always-free-tier-of-oci/3432).
> - Changez de région d'accueil (si vous pouvez encore en changer).

### Ouvrir les ports (80 et 443)

Console → **Networking → Virtual Cloud Networks → (votre VCN) → Security Lists → Default Security List → Add Ingress Rules** :
- Source `0.0.0.0/0`, Protocol TCP, Destination Port `80` (HTTP).
- Source `0.0.0.0/0`, Protocol TCP, Destination Port `443` (HTTPS).

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
- [ ] **Pare-feu VM** : en complément, configurez `ufw` (n'ouvrez que 22/80/443) :
  ```bash
  sudo ufw default deny incoming
  sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
  sudo ufw enable
  ```
- [ ] **Transferts des backups hors-site** (recommandé) : copiez `/backups` vers
      un stockage externe (ex : Oracle Object Storage gratuit, ou rclone).

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
| VM Oracle ARM (4 CPU / 24 Go) | **0 €** (Always Free, à vie) |
| PostgreSQL / Caddy / scheduler | **0 €** (sur la même VM) |
| Certificat TLS Let's Encrypt | **0 €** (automatique) |
| Nom de domaine | **~12 $/an** (seul vrai coût) |

**Total : ~1 $/mois.** Aucune surprise de facturation tant que vous restez dans
les quotas Always Free (vérifiables dans la console Oracle).
