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
- **Dossier cible des sauvegardes** (`DOSSIER_SAUVEGARDE`, disque ou serveur distinct du VPS) : à fixer par le superviseur, puis lignes `cron` du §7 ; test de restauration trimestriel.

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

Avant une mise à jour qui contient une migration (`app/prisma/migrations/`) : **sauvegarder la base et le volume `documents`** (§7 : `scripts/sauvegarde.sh`).

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

## 7. Sauvegarde et restauration (CDC §14.3, étape 8, D43)

Trois scripts bash à la racine du dépôt, dans `scripts/` (Docker seulement : aucun outil à installer sur l'hôte). Ils reçoivent le **nom du projet Docker Compose** avec `-p` (`sim-documents` sur le serveur) et retrouvent conteneurs et volumes par les étiquettes de Compose : on peut donc les essayer sur une pile jetable sans toucher la base en service.

| Script | Rôle |
| --- | --- |
| `scripts/sauvegarde.sh -p PROJET -t quotidienne\|hebdomadaire` | `pg_dump -Fc` de la base et archive du volume `documents`, écrits **dans** les conteneurs puis récupérés par `docker cp` (jamais de redirection de flux binaire) ; empreintes SHA-256 ; manifeste (nombre de lignes des tables clés) ; puis rotation. |
| `scripts/restauration.sh -p PROJET -s DOSSIER_DE_LA_SAUVEGARDE` | Restaure dans une pile **neuve** et vérifie. Refuse toute base de destination non vide et tout volume `documents` non vide. |
| `scripts/rotation-sauvegardes.sh -d DOSSIER [-n AAAA-MM-JJ] [-s] [-v]` | Applique la conservation. Appelée par `sauvegarde.sh` ; lançable seule avec une date simulée (`-n`) et en simulation (`-s`). |

### Où écrire : `DOSSIER_SAUVEGARDE` (à fixer par le superviseur)

Variable d'environnement **obligatoire**, un chemin absolu vers un dossier **existant** : le script refuse de tourner si elle est vide, si le dossier n'existe pas (un disque non monté ne doit pas être remplacé en silence par un dossier du disque local : le script ne crée jamais le dossier), ou s'il se trouve **à l'intérieur d'un volume du projet** (une sauvegarde qui vit avec les données ne les protège pas). Pour qu'une panne du VPS ne l'emporte pas, il doit être sur un **disque ou un serveur distinct** (disque monté, partage réseau…), en accès restreint : les sauvegardes contiennent des données de santé (fichiers en `600`).

Chaque appel écrit dans le dossier qu'on lui donne : on peut envoyer les quotidiennes sur un disque et les hebdomadaires sur un autre serveur (la rotation s'applique dossier par dossier).

### Ce que contient une sauvegarde, et ce qu'elle ne contient pas

Un dossier `AAAAMMJJ-HHMMSS_quotidienne` (ou `_hebdomadaire`, heure du serveur) avec `base.dump`, `documents.tgz`, `MANIFESTE.txt` et `SHA256SUMS`. Il est écrit dans un dossier provisoire puis renommé : une sauvegarde incomplète n'apparaît jamais. La base est sauvegardée **avant** les documents : chaque fichier cité par la base est dans l'archive.

Non sauvegardés : **le fichier `.env`** (secrets : à conserver à part, dans le coffre de l'administrateur ; sans lui, un serveur de remplacement ne peut pas démarrer), **Redis** (file de tâches : les lots confirmés non terminés sont repris au démarrage du travailleur) et le profil LibreOffice du volume (cache).

### Conservation (CDC §14.3 : 10 ans)

| Rôle | Quoi | Durée |
| --- | --- | --- |
| Quotidiennes | les 7 dernières `_quotidienne` | 7 sauvegardes |
| Hebdomadaires | les 8 dernières `_hebdomadaire` | 8 sauvegardes |
| Mensuelle | la **première** sauvegarde (de tout type) de chaque mois | 12 mois civils, mois en cours compris |
| Annuelle | la **première** sauvegarde de chaque année | 10 années civiles, année en cours comprise |

La rotation ne supprime **jamais** une mensuelle ou une annuelle encore dans sa durée : elles se reconnaissent à leur date (aucun état à conserver). Une sauvegarde sans aucun rôle est supprimée ; seuls sont touchés les dossiers `AAAAMMJJ-HHMMSS_<type>` qui contiennent `MANIFESTE.txt`. Compter, en régime établi, une trentaine de copies complètes : **prévoir l'espace disque en conséquence**. Liste et verdict à tout moment : `scripts/rotation-sauvegardes.sh -d "$DOSSIER_SAUVEGARDE" -s -v`.

### Planification (`crontab -e` de l'utilisateur qui lance Docker)

```cron
# Sauvegarde quotidienne à 2 h, hebdomadaire le dimanche à 3 h (heure du serveur) ; un code de sortie non nul fait envoyer le courrier de cron
0 2 * * *  DOSSIER_SAUVEGARDE=/mnt/sauvegardes-sim  /opt/sim-documents/scripts/sauvegarde.sh -p sim-documents -t quotidienne   >> /var/log/sim-sauvegarde.log 2>&1
0 3 * * 0  DOSSIER_SAUVEGARDE=/mnt/sauvegardes-sim  /opt/sim-documents/scripts/sauvegarde.sh -p sim-documents -t hebdomadaire  >> /var/log/sim-sauvegarde.log 2>&1
```

(Adapter le chemin du dépôt et celui du dossier cible.) Un verrou empêche deux sauvegardes simultanées. Surveiller le journal et la **date de la dernière sauvegarde** : une sauvegarde qui ne tourne plus ne prévient pas.

### Restauration

Toujours dans une pile **neuve** (jamais dans la base en service : le script refuse). Après un sinistre, sur le serveur de remplacement :

```bash
git clone <adresse-du-dépôt> sim-documents && cd sim-documents    # puis remettre le .env conservé à part
docker compose up -d postgres generateur                           # base vide, volume « documents » vide
scripts/restauration.sh -p sim-documents -s /mnt/sauvegardes-sim/AAAAMMJJ-HHMMSS_quotidienne
docker compose up -d --build                                       # applique les migrations plus récentes que la sauvegarde, démarre le reste
```

`restauration.sh` contrôle d'abord les empreintes de la sauvegarde, refuse une destination non vide **avant** d'écrire quoi que ce soit, restaure la base en une seule transaction (en cas d'erreur elle reste vide), extrait les documents, puis vérifie : `prisma migrate status` (une sauvegarde plus ancienne que le code laisse des migrations à appliquer : avertissement, pas un échec), nombre de lignes de `clients`, `cotations`, `polices`, `factures`, `documents_emis` et `_prisma_migrations` comparé au manifeste, présence dans le volume de **chaque** fichier cité par `documents_emis`, ouverture du PDF le plus récent par le générateur (empreinte SHA-256 et lecture par pypdf). Code de sortie 0 : tout est conforme ; 4 : restauration faite mais une vérification a échoué.

### Test de restauration trimestriel (CDC §14.3)

Une fois par trimestre, sur le serveur, avec la dernière sauvegarde **telle qu'elle est copiée hors du VPS** (c'est elle qu'on teste) :

```bash
docker compose -p restauration-test up -d postgres generateur     # pile d'essai : mêmes images, volumes distincts, aucun port publié
scripts/restauration.sh -p restauration-test -s /mnt/sauvegardes-sim/<la plus récente>
docker compose -p restauration-test down -v                       # supprime la pile d'essai ET ses copies des données de santé (jamais « -v » sur sim-documents)
```

Consigner dans [recette.md](recette.md) la date, la sauvegarde utilisée, le résultat et le temps pris.

### Export d'archive et vérification (CDC §14.3 : empreinte vérifiable à tout moment)

Pour remettre, archiver ou auditer des documents émis, sans toucher à la pile (volume monté en lecture seule, base lue par `SELECT`) :

```bash
scripts/export-archive.sh -p sim-documents -d /mnt/archives/2026-contrats                          # tout
scripts/export-archive.sh -p sim-documents -d /mnt/archives/client-12 -s SANTE/RELAXSANTE/CLI-12  # un sous-dossier
```

`-d` doit être un chemin absolu, **vide ou inexistant** (jamais d'écrasement), hors des données du projet ; `-s` est relatif à la racine des documents (mêmes règles de segments que le stockage : D41). La destination reçoit :

| Élément | Contenu |
| --- | --- |
| `documents/` | l'arborescence copiée telle quelle ; avec `-s`, le sous-dossier garde son chemin complet, donc les chemins du manifeste restent ceux de la base |
| `MANIFESTE.csv` | `numero,type,date_emission,chemin,empreinte_sha256`, une ligne par fichier, lue dans la base : documents émis (rééditions comprises) et archives ZIP des imports en masse (type `ARCHIVE_IMPORT`, numéro `LOT-<id>`) |
| `verifier-archive.sh` | copie du script de vérification, **autonome** (bash et `sha256sum`, ni Docker ni base) : il se lance dans le dossier de l'archive, par exemple chez un auditeur |

L'export se termine en vérifiant l'archive qu'il vient de produire ; son code de sortie est celui de la vérification. Les documents en écriture différée (PDF encore en base) n'ont pas encore de fichier : ils sont signalés et non listés ; relancer l'export plus tard.

**Vérifier une archive**, à tout moment et n'importe où : `cd <archive> && ./verifier-archive.sh` (ou `scripts/verifier-archive.sh -a <archive>`). Le script recalcule le SHA-256 de chaque fichier et signale, un par ligne : `EMPREINTE DIFFÉRENTE` (fichier modifié ou abîmé), `FICHIER ABSENT`, `NON LISTÉ` (fichier présent, absent du manifeste), `LIGNE INVALIDE` (ligne illisible, chemin non conforme, empreinte qui n'a pas 64 caractères hexadécimaux), `DOUBLON`. Code de sortie : 0 conforme, 2 au moins un écart, 1 archive inutilisable (manifeste ou `documents/` absent).

Limite à connaître : le manifeste prouve que les fichiers n'ont pas changé **depuis l'export**, il n'est pas signé ; quelqu'un qui modifierait un fichier **et** sa ligne du manifeste passerait la vérification. Pour une remise qui doit résister à cela, noter à part (courrier, registre) le SHA-256 de `MANIFESTE.csv` (`sha256sum MANIFESTE.csv`), ou refaire un export depuis la base et comparer les deux manifestes (la base garde l'empreinte d'origine).

Essai automatique (poste de développement, Docker, pile jetable `export-test`) : `bash scripts/tests/export-archive.test.sh`.

Essais automatiques des scripts (poste de développement, avec Docker ; données inventées, pile jetable `sauvegarde-test` supprimée à la fin) : `bash scripts/tests/rotation.test.sh` (dates simulées, quelques minutes) et `bash scripts/tests/sauvegarde-restauration.test.sh`.

> Les documents émis sont dans `/donnees/sortie/documents/` du volume (arborescence par branche, produit, client… : D41), en lecture seule ; la base enregistre leur chemin et leur empreinte SHA-256. Sauvegarder la base et le volume **ensemble** : c'est ce que fait `sauvegarde.sh`.
>
> **Le volume « documents » est le SEUL exemplaire des documents émis** (décision D11 : plus de dossier partagé réseau). Sa sauvegarde, copiée hors du VPS, n'est pas optionnelle : sans elle, la perte du disque fait perdre les contrats émis. Prévoir aussi une surveillance de l'espace disque.

## 8. Sécurité : points d'attention

- `.env` : droits `600`, jamais commité, valeurs distinctes de celles des postes de développement.
- **Seed de développement interdit sur le VPS** : ne jamais définir `AUTORISER_SEED_DEV` (ni `SEED_MOT_DE_PASSE`) sur un serveur, et ne jamais y lancer `npm run seed:dev`. Il crée des comptes de test au mot de passe connu (installation.md §10). L'image `outils` étant en `NODE_ENV=production`, le seed y refuse de s'exécuter, sauf si on force les deux variables à la main : ne pas le faire.
- **Journal d'audit** (D8) : le rôle PostgreSQL de l'application est ici le propriétaire de la base, donc capable de supprimer les déclencheurs qui protègent le journal. Avant la mise en production, créer pour l'application un rôle **non propriétaire** (droits SELECT, INSERT, UPDATE, DELETE sur les tables, sauf UPDATE/DELETE sur `journal_audit`), et réserver le propriétaire aux migrations.
- Limitation des tentatives par adresse IP : à configurer dans le proxy inverse ou avec fail2ban (l'application verrouille seulement le compte visé).
- En-têtes HTTP de sécurité posés par l'application ; **Content-Security-Policy** à ajouter avant la mise en production.
- Mettre à jour régulièrement les images (`docker compose pull` pour postgres et redis, `docker compose build --pull` pour les autres).
