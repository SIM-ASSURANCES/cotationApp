# Guide de déploiement (VPS Linux, Docker Compose)

Décision D5 (05/10/2026) : l'application est déployée sur un **VPS Linux** avec **Docker Compose**.

> **Statut : non testé.** Docker n'étant pas installé sur le poste de développement, le fichier `docker-compose.yml` et les deux `Dockerfile` n'ont **jamais été exécutés** : seule la syntaxe du fichier compose a été validée. Le premier déploiement servira de première vérification ; corriger ce guide au fur et à mesure et consigner le résultat dans [recette.md](recette.md).

## 1. Architecture

| Service | Rôle | Joignable depuis |
| --- | --- | --- |
| `app` | Application Next.js | `127.0.0.1:3000` de l'hôte (le proxy inverse y envoie le trafic HTTPS) |
| `generateur` | FastAPI + LibreOffice + polices | réseau Docker uniquement (`http://generateur:8001`) |
| `postgres` | Base de données | réseau Docker uniquement |
| `redis` | File de tâches (phase 5, pas encore utilisée) | réseau Docker uniquement |
| `outils` | Applique les migrations puis s'arrête ; sert aux scripts d'installation | — |

Volumes persistants : `donnees_postgres`, `donnees_redis`, `documents` (documents émis et profil LibreOffice).

## 2. Prérequis

- VPS Linux avec **Docker Engine** et le plugin **Docker Compose v2** (`docker compose version`).
- Accès Internet sortant pendant la construction : images Docker, paquets Debian, paquets npm et Python, police Montserrat.
- Un **proxy inverse HTTPS** devant `127.0.0.1:3000` (Dokploy/Traefik, Caddy ou nginx : voir la question Q1) avec un certificat valide. Il doit transmettre `Host`, `X-Forwarded-For` et `X-Forwarded-Proto`. Le pare-feu n'ouvre que les ports 80 et 443 : **jamais** 3000, 5432, 6379 ni 8001.
- Les polices des modèles dans `generateur/polices/` (voir son README et la question Q2).

## 3. Installation initiale

```bash
git clone <adresse-du-dépôt> sim-documents && cd sim-documents

# 1. Secrets : un fichier .env à la racine, avec des valeurs propres à CE serveur
cp .env.example .env
nano .env     # générer chaque secret : python3 -c "import secrets; print(secrets.token_hex(32))"
chmod 600 .env

# 2. Polices : copier les fichiers dans generateur/polices/ (voir son README)

# 3. Construction et démarrage (les migrations s'appliquent avant le démarrage de l'application)
docker compose up -d --build

# 4. Profils, droits et premier Admin système (le mot de passe se saisit dans le terminal)
docker compose run --rm outils npm run initialiser
docker compose run --rm outils npm run creer-admin
```

`POSTGRES_PASSWORD` doit rester en hexadécimal : il est inséré tel quel dans l'adresse de connexion de la base.

## 4. Vérifications après déploiement

```bash
docker compose ps                                   # tous les services « running » ou « healthy »
curl -s http://127.0.0.1:3000/api/sante             # {"statut":"ok","base":"ok","generateur":"ok"}
curl -s -o /dev/null -w "%{http_code}\n" https://<domaine>/api/documents    # 401 : les routes sont protégées
docker compose exec generateur python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8001/sante').read().decode())"
                                                    # "libreoffice_trouve": true, "polices_manquantes": []
```

Puis, dans un navigateur : connexion, page « Journal d'audit » (la connexion y apparaît), déconnexion. Lancer enfin le **test de fidélité sous Linux** (recette.md, §1.2).

`generateur: "ko"` dans `/api/sante` signifie que le générateur est arrêté, que LibreOffice est introuvable dans l'image, **ou** que Tahoma ou Calibri manque (polices non copiées dans `generateur/polices/` avant la construction) : le `/sante` du générateur en donne le détail (`"polices_manquantes"`).

## 5. Mise à jour

```bash
git pull
docker compose up -d --build     # reconstruit, applique les nouvelles migrations (service « outils »), redémarre
```

Avant une mise à jour qui contient une migration : **sauvegarder la base** (§7).

## 6. Retour arrière

Les migrations sont **dans un seul sens** : revenir à une version précédente du code ne défait pas une migration.
1. `git checkout <version-précédente>` puis `docker compose up -d --build` : suffit si la version n'avait pas de migration.
2. Sinon, restaurer la sauvegarde faite avant la mise à jour (§7), **puis** revenir au code précédent.

## 7. Sauvegarde et restauration (CDC §14.3 : quotidienne)

À mettre en place par l'administrateur (tâche planifiée `cron`), avec un test de restauration trimestriel :

```bash
# Base de données
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > sauvegarde-$(date +%F).dump
# Documents émis (volume « documents »)
docker run --rm -v sim-documents_documents:/donnees -v "$PWD":/sauvegarde debian:bookworm-slim tar czf /sauvegarde/documents-$(date +%F).tgz -C /donnees .
# Restauration de la base
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < sauvegarde-AAAA-MM-JJ.dump
```

Copier les sauvegardes **hors du VPS** (elles contiennent des données de santé : stockage chiffré, accès restreint).

> Les documents émis sont dans `/donnees/sortie/documents/` du volume (arborescence `{Produit}/{AAAA}/{MM}/{Type}/`), en lecture seule ; la base enregistre leur chemin et leur empreinte SHA-256. Sauvegarder la base et le volume **ensemble** : une restauration doit retrouver chaque fichier que la base cite.
>
> **Le volume « documents » est le SEUL exemplaire des documents émis** (décision D11 : plus de dossier partagé réseau). Sa sauvegarde quotidienne, copiée hors du VPS, n'est pas optionnelle : sans elle, la perte du disque fait perdre les contrats émis. Prévoir aussi une surveillance de l'espace disque.

## 8. Sécurité : points d'attention

- `.env` : droits `600`, jamais commité, valeurs distinctes de celles des postes de développement.
- **Journal d'audit** (D8) : le rôle PostgreSQL de l'application est ici le propriétaire de la base, donc capable de supprimer les déclencheurs qui protègent le journal. Avant la mise en production, créer pour l'application un rôle **non propriétaire** (droits SELECT, INSERT, UPDATE, DELETE sur les tables, sauf UPDATE/DELETE sur `journal_audit`), et réserver le propriétaire aux migrations.
- Limitation des tentatives par adresse IP : à configurer dans le proxy inverse ou avec fail2ban (l'application verrouille seulement le compte visé).
- En-têtes HTTP de sécurité posés par l'application ; **Content-Security-Policy** à ajouter avant la mise en production.
- Mettre à jour régulièrement les images (`docker compose pull` pour postgres et redis, `docker compose build --pull` pour les autres).
