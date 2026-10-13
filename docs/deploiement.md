# Guide de déploiement (VPS Linux, Docker Compose)

Décision D5 (05/10/2026) : l'application est déployée sur un **VPS Linux** avec **Docker Compose**.

> **Statut : non testé.** Docker n'étant pas installé sur le poste de développement, le fichier `docker-compose.yml` et les deux `Dockerfile` n'ont **jamais été exécutés** : seule la syntaxe du fichier compose a été validée. Le premier déploiement servira de première vérification ; corriger ce guide au fur et à mesure et consigner le résultat dans [recette.md](recette.md).

## 1. Architecture

| Service | Rôle | Joignable depuis |
| --- | --- | --- |
| `app` | Application Next.js | `127.0.0.1:${APP_PORT}` de l'hôte (3000 par défaut ; le proxy inverse y envoie le trafic HTTPS) |
| `generateur` | FastAPI + LibreOffice + polices | réseau Docker uniquement (`http://generateur:8001`) |
| `postgres` | Base de données | réseau Docker uniquement |
| `redis` | File de tâches BullMQ (D24) : imports en masse, lots d'avis et de relances, reprise des écritures différées ; mot de passe `REDIS_PASSWORD`, données persistantes (`appendonly`) | réseau Docker uniquement |
| `travailleur` | Exécute les tâches de la file (même image que `outils`, `npm run travailleur`) : certificats des imports en masse, écriture des documents quand le stockage revient (T14), lots d'avis et de relances et liste du jour chaque matin à 6 h (session 5b) | — (aucun port) |
| `outils` | Applique les migrations puis s'arrête ; sert aux scripts d'installation | — |

Volumes persistants : `donnees_postgres`, `donnees_redis`, `documents` (documents émis et profil LibreOffice).

## 2. Prérequis

- VPS Linux avec **Docker Engine** et le plugin **Docker Compose v2** (`docker compose version`).
- Accès Internet sortant pendant la construction : images Docker, paquets Debian, paquets npm et Python (Montserrat est hébergée dans le dépôt depuis la session 4.0).
- Un **port libre** sur l'hôte pour l'application : `APP_PORT` dans `.env` (3000 par défaut). Le VPS est **partagé avec le portail RH**, qui peut déjà occuper 3000 : vérifier avec `ss -ltn` et choisir un autre port (ex. 3010) si besoin.
- Un **proxy inverse HTTPS** devant `127.0.0.1:${APP_PORT}` (Dokploy/Traefik, Caddy ou nginx : voir la question Q1) avec un certificat valide. Il doit transmettre `Host`, `X-Forwarded-For` et `X-Forwarded-Proto`. Le pare-feu n'ouvre que les ports 80 et 443 : **jamais** `APP_PORT`, 5432, 6379 ni 8001.
- **`PROXIES_DE_CONFIANCE`** (audit M1, défaut 1) : nombre de proxys inverses entre Internet et l'application. L'adresse du client est le N-ième élément de `X-Forwarded-For` en partant de la **droite** (ce que les proxys ajoutent), jamais celui de gauche, que le visiteur écrit lui-même. **À faire vérifier le jour du déploiement sur le proxy réellement installé** (Dokploy/Traefik, Caddy, nginx, avec ou sans CDN devant) : `curl -s -H 'X-Forwarded-For: 6.6.6.6' https://<domaine>/verif/x` plusieurs fois, puis lire dans le journal d'audit l'adresse d'une connexion de test : ce doit être la vôtre, pas `6.6.6.6`. Trop bas, l'adresse est celle d'un proxy ; trop haut, un visiteur choisit la sienne ; `0` : l'en-tête n'est pas lu.
- Les polices des modèles dans `generateur/polices/` (voir son README et la question Q2).

### Prérequis à fournir par l'administrateur

(Même liste que dans le [README](../README.md#déployer-administrateur).)

- **Domaine** et certificat HTTPS de l'application : `URL_PUBLIQUE` (les QR codes y renvoient ; vide, aucun document ne peut être émis).
- **Port libre** sur l'hôte : `APP_PORT` (3000 par défaut ; le VPS est partagé avec le portail RH).
- **Ressources du VPS** (processeurs, mémoire) : elles fixent `CONVERSIONS_SIMULTANEES` (autour du nombre de processeurs moins un).
- **Limites par service** (audit M5, `docker-compose.yml`) : `generateur` 2 Go / 2 processeurs, `app`, `travailleur`, `postgres` et `outils` 1 Go / 1 processeur, `redis` 256 Mo / 0,5. Valeurs de départ pour un VPS partagé avec le portail RH : les contrôler avec `docker stats` pendant la recette (import de 500 adhérents compris) et les ajuster dans le fichier.
- **Polices des modèles** (Tahoma notamment) dans `generateur/polices/`, sous licence, jamais dans le dépôt (question Q2).
- **Sauvegarde quotidienne** de la base **et** du volume `documents`, copiée hors du VPS, avec un test de restauration.

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
curl -s http://127.0.0.1:${APP_PORT:-3000}/api/sante # {"statut":"ok","base":"ok","generateur":"ok"}
curl -s -o /dev/null -w "%{http_code}\n" https://<domaine>/api/documents    # 401 : les routes sont protégées
docker compose exec generateur python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8001/sante').read().decode())"
                                                    # "libreoffice_trouve": true, "polices_manquantes": []
docker compose logs travailleur | tail -3           # « [travailleur] démarré : 0 lot(s) d'import, 0 lot(s) d'avis et de relances et 0 écriture(s) différée(s) repris. »
```

**Travailleur et file de tâches (session 5a, D24)** : sans le service `travailleur`, un import en masse se contrôle et se confirme, mais ses certificats ne sont pas produits ; il les produit dès qu'il redémarre (les tâches sont conservées dans Redis, et le travailleur reprend aussi au démarrage tout lot confirmé non terminé). `CONVERSIONS_SIMULTANEES` (2 par défaut) règle le nombre de conversions LibreOffice en parallèle, pour le générateur et le travailleur : autour du nombre de processeurs moins un. Durée mesurée de T8 : docs/recette.md.

**Avis d'échéance et relances (session 5b, D25)** : le travailleur planifie lui-même, une seule fois quel que soit le nombre de redémarrages, la liste du jour (file `quotidien`, chaque matin à 6 h, heure d'Abidjan). Elle n'émet aucun document : elle trace la liste au journal. Les avis et relances sélectionnés sur l'écran « Échéances » passent par la file `echeances` ; sans travailleur, le lot attend et reprend à son démarrage. La génération d'une seule ligne n'a pas besoin du travailleur.

**Stockage indisponible (T14)** : un document émis pendant une panne du stockage reste émis ; son PDF est gardé en base (« en attente d'écriture »), l'Admin système voit un bandeau et l'écran « Stockage », et le travailleur retente l'écriture avec des délais croissants (30 s, puis doublés, 12 essais, environ 17 h). Après les 12 essais, ou si le travailleur était arrêté : bouton « Relancer maintenant » de l'écran « Stockage ».

Puis, dans un navigateur : connexion, page « Journal d'audit » (la connexion y apparaît), déconnexion. Lancer enfin le **test de fidélité sous Linux** (recette.md, §1.2).

`generateur: "ko"` dans `/api/sante` signifie que le générateur est arrêté, que LibreOffice est introuvable dans l'image, **ou** que Tahoma ou Calibri manque (polices non copiées dans `generateur/polices/` avant la construction) : le `/sante` du générateur en donne le détail (`"polices_manquantes"`).

## Après l'installation : produits à paramétrer par la Technique (D31, D32)

> **À faire sur le serveur, par la Technique, avant la première cotation de ces produits.** Le dépôt, les données de démarrage et les migrations ne créent **aucun produit réel** : cette étape est une étape de mise en production, pas de développement.

**SECURPRO, SECURHOME, SECURHOME + et RELAXACCIDENTS se tarifient par garanties.** Chacun doit être créé (écran « Paramétrage > Produits ») avec une **première version en mode « Par garanties »**, jamais en mode « Par formule » : une version « Par formule » plus ancienne continuerait de calculer, avec une prime fausse, tout document daté avant la date d'effet de la version suivante. En mode « Par garanties », le calcul automatique est refusé ; la prime est **composée par la Technique** (droit « Composer une prime ») sur la cotation, garantie par garantie (D32).

Ordre à suivre, après `docker compose run --rm outils npm run initialiser` (qui crée les branches et les taux de démarrage, dont **INCENDIE à 12,5 %** et **IARD à 7,25 %**) :

1. **Branches et taxes** (installation faite **avant** la session 6.2b) : `initialiser` n'écrase jamais ce qui existe déjà.
   - Dans l'écran « Taxes », la branche IARD a gardé sa ligne « taux mixte » : ajouter une nouvelle ligne IARD à 7,25 %, avec sa date d'effet (l'ancienne ligne est clôturée la veille).
   - Dans l'écran « Branches », IARD a gardé son ancien libellé « Incendie, accidents et risques divers (IARD) » alors que INCENDIE existe maintenant à côté : le renommer (« Autres dommages aux biens (IARD) ») pour qu'on ne les confonde pas.
   - Vérifier, pour finir, les taux de chaque branche utilisée par les lignes de prime (INCENDIE, IARD, IA, DECES…).
2. **Produit** : créer le produit (code, libellé, gamme, branche principale), puis sa première version avec le mode « Par garanties », la liste des garanties du produit (facultative) et ses références contractuelles (CG).
3. **Modèles Word**, **déposés par la Technique** puis **publiés par la Direction Générale** (la Technique ne publie pas) : pour chaque produit, le modèle de **cotation**, celui des **conditions particulières**, celui de la **facture** et, pour un contrat de groupe, le **certificat d'adhésion** (sans prime). Cotation, CP et facture citent la boucle `garanties_souscrites` (guide de balisage) ; sans elle, leur émission est refusée. Sans modèle de facture propre au produit, c'est le modèle commun qui serait retenu : il ne détaille pas les garanties, et la facture est refusée avant tout numéro.
4. **Droits** : le droit « Composer une prime » est « Oui » pour le profil Technique et sans accès pour les autres ; il se règle dans l'écran des droits de l'Admin système.
5. **Essai** : le faire de préférence dans un environnement de recette ([recette.md](recette.md)). Une cotation de test émise en production consomme de **vrais numéros** (cotation, police, facture) et laisse des documents émis **intangibles** : n'en faire que sur décision de Thierry, avec un souscripteur de test sans équivoque.

Le **renouvellement** et la **facturation de l'incorporation d'adhérents** d'une police à garanties ne sont pas encore gérés (D32, H90) : la facture de renouvellement et la facture d'avenant sont refusées avec un message explicite, et l'écran de la police ne les propose pas. **L'incorporation elle-même reste possible** (les adhérents sont ajoutés à la liste, sans formule) mais elle n'est **ni facturée ni accompagnée d'une prime** : la tâche « Facture d'avenant à émettre » qu'elle crée ne peut pas être exécutée tant que Thierry n'a pas tranché H90. Ne pas incorporer d'adhérents dans une police à garanties avant cette décision.

## 5. Mise à jour

Avant une mise à jour qui contient une migration (`app/prisma/migrations/`) : **sauvegarder la base et le volume `documents`** (§7).

```bash
git pull
docker compose up -d --build                         # reconstruit, applique les nouvelles migrations (service « outils »), redémarre
docker compose run --rm outils npm run initialiser   # nouvelles données de démarrage (branches, taux, droits) ; sans risque à relancer
docker compose run --rm outils npx prisma migrate status   # « Database schema is up to date »
```

**Jamais** `prisma db push` (il contourne les migrations et les déclencheurs de la base) ; **jamais** `docker compose down -v` (il supprime la base, Redis et les documents émis).

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
- **Seed de développement interdit sur le VPS** : ne jamais définir `AUTORISER_SEED_DEV` (ni `SEED_MOT_DE_PASSE`) sur un serveur, et ne jamais y lancer `npm run seed:dev`. Il crée des comptes de test au mot de passe connu (installation.md §10). L'image `outils` étant en `NODE_ENV=production`, le seed y refuse de s'exécuter, sauf si on force les deux variables à la main : ne pas le faire.
- **Journal d'audit** (D8) : le rôle PostgreSQL de l'application est ici le propriétaire de la base, donc capable de supprimer les déclencheurs qui protègent le journal. Avant la mise en production, créer pour l'application un rôle **non propriétaire** (droits SELECT, INSERT, UPDATE, DELETE sur les tables, sauf UPDATE/DELETE sur `journal_audit`), et réserver le propriétaire aux migrations.
- Limitation des tentatives par adresse IP : à configurer dans le proxy inverse ou avec fail2ban (l'application verrouille seulement le compte visé).
- En-têtes HTTP de sécurité posés par l'application ; **Content-Security-Policy** à ajouter avant la mise en production.
- Mettre à jour régulièrement les images (`docker compose pull` pour postgres et redis, `docker compose build --pull` pour les autres).
