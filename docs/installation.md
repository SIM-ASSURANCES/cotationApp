# Installation du poste de développement

Installation pas à pas, depuis zéro, sur un poste **Windows** avec **PowerShell** (Windows PowerShell 5.1 ou PowerShell 7). Sauf indication contraire, les commandes se tapent depuis la racine du dépôt `sim-documents`.

## 1. Prérequis

| Outil | Version utilisée | Vérification |
| --- | --- | --- |
| Git | 2.54.0 | `git --version` |
| Node.js (LTS) et npm | Node 24.20.0, npm 12.0.2 | `node --version` puis `npm --version` |
| Python et son lanceur `py` | 3.14.7 | `py --version` |
| PostgreSQL, service démarré | 18.6 | `psql --version` |
| LibreOffice | 26.8.0.3 | `Test-Path "C:\Program Files\LibreOffice\program\soffice.com"` doit afficher `True` |
| Redis (ou Memurai, compatible Redis sous Windows), avec un mot de passe | 7 ou plus | `redis-cli -a MOT_DE_PASSE ping` doit afficher `PONG` |

Il faut aussi un accès Internet pendant l'installation : paquets npm et Python, et moteur de migration de Prisma, téléchargé au premier usage depuis `binaries.prisma.sh`.

Les versions des bibliothèques sont figées dans `app/package-lock.json` et `generateur/requirements.txt`. Les principales :
- **`app/`** : Next.js 16.3.8, React 19.2.8, TypeScript 5.9.3, Prisma 7.10.0, zod 4.6.5, Vitest 5.0.3, ESLint 9.39.5, Tailwind CSS 4.3.3.
- **`generateur/`** : FastAPI 0.142.2, Uvicorn 0.54.0, Pydantic 2.13.5, pydantic-settings 2.15.0, docxtpl 0.20.2, pypdf 6.19.0, qrcode 8.2, num2words 0.5.14, pytest 9.1.1, httpx 0.28.1.

> **Si PowerShell affiche « l'exécution de scripts est désactivée sur ce système »** en lançant `npm` ou `Activate.ps1` : la stratégie d'exécution de PowerShell bloque les scripts. Pour la consulter : `Get-ExecutionPolicy -List`. Pour autoriser les scripts locaux pour ton seul compte : `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, à décider en connaissance de cause. Sans rien changer, on peut aussi utiliser `npm.cmd` à la place de `npm`, et `.\.venv\Scripts\python.exe` à la place de `python` sans activer l'environnement virtuel.

## 2. Récupérer le code

```powershell
git clone <adresse-du-dépôt> sim-documents
cd sim-documents
```

Le dépôt distant de l'entreprise n'existe pas encore : en attendant, cloner le dépôt local, par exemple `git clone C:\chemin\vers\sim-documents`.

## 3. Créer le secret partagé

L'application et le générateur partagent un secret d'au moins 32 caractères. Il se génère **une seule fois** et se colle ensuite dans les deux fichiers `.env` (sections 4 et 5) :

```powershell
py -c "import secrets; print(secrets.token_urlsafe(48))"
```

Il ne se commite jamais et ne se transmet jamais par messagerie : chaque poste et chaque serveur a le sien.

## 4. Application (`app/`)

```powershell
cd app
npm install
```

`npm install` lance aussi `prisma generate`, qui crée le client Prisma dans `src/generated/` (dossier ignoré par Git).

Configuration :

```powershell
Copy-Item .env.example .env
notepad .env
```

Dans `.env` :
- **`DATABASE_URL`** : mettre l'utilisateur PostgreSQL du poste, `postgres` ou un rôle personnel, à condition qu'il ait le droit `CREATEDB`. Remplacer ensuite `MOT_DE_PASSE` par son mot de passe. Les caractères spéciaux du mot de passe doivent être encodés : `@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`, `%` → `%25`, `$` → `%24`. Changer aussi l'hôte ou le port s'ils diffèrent.
- **`GENERATEUR_SECRET`** : coller le secret de la section 3, entre les guillemets.
- **`AUTH_SECRET`** : une **seconde** clé, différente, qui signe les sessions de connexion. Même commande que la section 3 pour la générer.
- **`TEST_DATABASE_URL`** (facultative) : base des tests d'intégration. Copier `DATABASE_URL` en remplaçant le nom de la base par `sim_documents_test` (le nom **doit** finir par `_test`).

Base de données :

```powershell
npm run migrate:deploy
```

Cette commande applique les migrations du dépôt. Elle **crée la base `sim_documents`** si elle n'existe pas, à condition que l'utilisateur PostgreSQL ait le droit `CREATEDB`, ce qui est le cas de `postgres`. Le message attendu se termine par « All migrations have been successfully applied. »

Profils, droits et premier administrateur :

```powershell
npm run initialiser
npm run creer-admin
```

`initialiser` crée les 6 profils du CDC §4 et leurs droits par défaut, les motifs de refus, les branches fiscales et les taux de taxe de démarrage (`app/prisma/donnees/`) ; on peut le relancer sans risque, il n'écrase jamais un droit, une branche ou un taux déjà en base. `creer-admin` te demande l'identifiant, le nom, puis le mot de passe **dans le terminal**, sans l'afficher (12 caractères minimum). Ce mot de passe ne passe par aucun fichier.

Vérifications :

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
```

`npm test` ne touche pas à la base. `npm run test:e2e` exige en plus le **générateur lancé** (section 5) : il dépose et génère de vrais modèles de test. `npm run test:integration` utilise une **vraie base PostgreSQL de test** (`TEST_DATABASE_URL`) : elle est **supprimée et recréée** à chaque exécution, et la commande refuse de s'exécuter si son nom ne finit pas par `_test`. L'utilisateur PostgreSQL doit avoir le droit `CREATEDB`.

Lancement en développement :

```powershell
npm run dev
```

L'application est sur http://localhost:3000 : elle redirige vers la page de connexion. Se connecter avec le compte créé par `npm run creer-admin`. On arrête avec `Ctrl+C`.

## 5. Générateur (`generateur/`)

Dans un **second terminal**, depuis la racine du dépôt :

```powershell
cd generateur
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Une fois l'environnement activé, l'invite commence par `(.venv)`. Il faut le réactiver dans chaque nouveau terminal.

Configuration :

```powershell
Copy-Item .env.example .env
notepad .env
```

Dans `.env` :
- **`GENERATEUR_SECRET`** : le **même** secret que dans `app/.env`.
- **`DOSSIER_SORTIE`** et **`PROFIL_LIBREOFFICE`** : deux chemins absolus, hors du dépôt, entre apostrophes simples. Par exemple `'C:\Users\<toi>\AppData\Local\sim-documents\sortie'` et `'C:\Users\<toi>\AppData\Local\sim-documents\profil-libreoffice'`.
- **`LIBREOFFICE_CHEMIN`** : à corriger seulement si LibreOffice est installé ailleurs.

Tests :

```powershell
pytest
```

Lancement en développement (rechargement automatique quand le code change) :

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Autre façon de lancer, avec l'adresse et le port lus dans `.env` (`GENERATEUR_HOTE`, `GENERATEUR_PORT`) : `python -m app`.

La documentation OpenAPI est sur http://127.0.0.1:8001/docs. Le générateur n'écoute que la machine locale (`127.0.0.1`).

## 6. Vérifier l'ensemble

Les deux services étant lancés, dans un troisième terminal :

```powershell
curl.exe -s http://localhost:3000/api/sante
```

Réponse attendue : `{"statut":"ok","base":"ok","generateur":"ok"}`. Si le générateur est arrêté, on obtient `"generateur":"ko"` et le code HTTP 503.

On écrit `curl.exe` et non `curl` : dans Windows PowerShell 5.1, `curl` est un alias d'`Invoke-WebRequest`.

### 6.1 File de tâches (session 5a, D24)

L'import en masse et la reprise des écritures différées passent par une file de tâches BullMQ, sur Redis. Dans `app/.env`, renseigner `REDIS_URL="redis://:MOT_DE_PASSE@127.0.0.1:6379"` (et, facultatif, `CONVERSIONS_SIMULTANEES=2`, la même valeur que dans `generateur/.env`). Puis, dans un **troisième** terminal, depuis `app/` :

```powershell
npm run travailleur
```

Il affiche `[travailleur] démarré : 0 lot(s) d'import, 0 lot(s) d'avis et de relances et 0 écriture(s) différée(s) repris.` et reste au premier plan ; Ctrl+C l'arrête proprement. Sans lui, un import se contrôle et se confirme, mais ses certificats ne sont produits qu'à son démarrage. `npm run test:integration` et `npm run test:e2e` exigent aussi `REDIS_URL` (ils démarrent leur propre travailleur, le service n'a pas besoin d'être lancé).

## 7. Messages normaux (ce ne sont pas des erreurs)

- **`npm warn deprecated eslint@9.39.5`** : ESLint 9 n'est plus maintenu. C'est la version installée par `create-next-app` 16 ; le passage à ESLint 10 reste à évaluer.
- **`npm warn install-scripts … blocked`** : npm 12 bloque par défaut les scripts d'installation des paquets (ici `prisma`, `@prisma/engines` et `unrs-resolver`). C'est sans conséquence : Prisma télécharge son moteur de migration au premier usage.
- **`npm audit` : 9 vulnérabilités « high »** : 5 dans la chaîne d'ESLint (outil de développement), 4 dans la CLI Prisma (`prisma`, par `deepmerge-ts` et `mysql2`). npm range la CLI Prisma parmi les dépendances de production, car `@prisma/client` la déclare en dépendance « peer ». Elle ne sert pourtant qu'aux migrations : aucun de ces modules n'est chargé par l'application en fonctionnement, et ils sont absents de la sortie de production `.next/standalone` (vérifié le 05/10/2026). **Ne pas lancer `npm audit fix --force`** : il rétrograderait `eslint-config-next` en version 14 et Prisma en version 6, incompatibles avec le projet.
- **Prisma : « Update available 7.10.0 -> 8.0.0-rc… »** : c'est une pré-version. Le projet reste sur Prisma 7.10.0, épinglé dans `package.json`.
- **pytest : `StarletteDeprecationWarning` (httpx → httpx2)** : avertissement connu, les tests ne sont pas touchés. Passer à `httpx2` reste à décider.
- **`Configuration invalide : l'application ne peut pas démarrer`**, ou **`Configuration du générateur invalide`** : ce n'est pas un plantage. Le service s'arrête volontairement et liste les variables à corriger dans `.env`.

**Dépannage** : `Error: P1000: Authentication failed … credentials for (not available)` au moment de `npm run migrate:deploy` signifie que l'utilisateur **ou** le mot de passe de `DATABASE_URL` est refusé par PostgreSQL. Malgré le « (not available) », il faut vérifier les deux, ainsi que l'encodage des caractères spéciaux du mot de passe.

## 8. Travail courant

- **Après la récupération d'une branche** (depuis `app/`) : `npm install` si `package.json` a changé ; `npm run migrate:deploy` si la branche apporte une migration (sauvegarder d'abord la base si elle contient des données utiles) ; `npm run initialiser` si elle ajoute des données de démarrage (`app/prisma/donnees/`, ex. branches MOTO, VOYAGE, RECOLTE en session 6.0) ; puis relancer l'application, le générateur et le travailleur. **Jamais `npx prisma db push`** : il contourne les migrations et les déclencheurs de la base.
- **Modifier le schéma de la base** (poste de développement uniquement) : `npx prisma migrate dev --name <nom-de-la-migration>`, puis `npx prisma generate`, car Prisma 7 ne le lance plus automatiquement. Sur un serveur : uniquement `npm run migrate:deploy`.
- **Version de production en local** : `npm run build`, puis `npm start`, qui lance `node .next/standalone/server.js`, la commande utilisée sur un serveur.
- **Ajouter une dépendance Python** : l'ajouter dans `generateur/requirements.in`, puis, l'environnement étant activé :

  ```powershell
  python -m pip install -r requirements.in
  python -m pip freeze | Out-File -Encoding ascii requirements.txt
  ```

  Avec Windows PowerShell 5.1, `pip freeze > requirements.txt` écrirait le fichier en UTF-16, illisible pour Git : d'où `Out-File -Encoding ascii`.

## 9. Avec Docker (déploiement)

Le déploiement sur le VPS utilise Docker Compose : voir [deploiement.md](deploiement.md). Docker n'est pas nécessaire pour développer.

## 10. Seed de développement

> ⚠️ **Ne jamais définir `AUTORISER_SEED_DEV` sur le VPS**, ni `SEED_MOT_DE_PASSE`. Ce seed crée des comptes au mot de passe connu de l'équipe, sans changement imposé : c'est un outil de recette sur un poste de développement, pas une installation.

Il crée un compte de **test** par profil du CDC §4, pour se reconnecter vite après une remise à zéro de la base :

| Identifiant | Profil |
| --- | --- |
| `test.commercial` | Commercial |
| `test.production` | Gestionnaire production |
| `test.technique` | Technique (valideur) |
| `test.comptabilite` | Comptabilité |
| `test.direction` | Direction Générale |
| `test.admin` | Admin système |

- **Mot de passe** : celui de la variable `SEED_MOT_DE_PASSE`, dans ton `.env` local uniquement. Il n'est jamais écrit dans le code ni affiché. Il doit respecter la politique de l'application (12 caractères au moins, pas de mot de passe courant, pas l'identifiant, 5 caractères différents) : sinon le seed s'arrête, avec le motif.
- **Gardes** : le seed refuse de s'exécuter si `NODE_ENV=production`, et tant que `AUTORISER_SEED_DEV=oui` n'est pas défini. Les deux conditions sont exigées. Troisième garde (audit m7) : il refuse aussi, sans rien créer, si la base contient un compte qui ne vient pas du seed, même avec les deux variables forcées ; le message donne le nombre de comptes, jamais leurs identifiants. Sur une base de développement qui n'a que des comptes `test.*`, un second lancement reste possible.
- **Jamais automatique** : ni Compose, ni le service `outils`, ni `initialiser`, ni `postinstall` ne l'appellent.
- **Relançable** : un compte de test qui existe déjà est ignoré, jamais dupliqué ni écrasé (même s'il a été modifié depuis). Les autres comptes ne sont jamais touchés. Chaque création est écrite au journal d'audit (« compte créé par le seed de développement »).

Après `npm run initialiser` :

```powershell
# Poste de développement : SEED_MOT_DE_PASSE (et AUTORISER_SEED_DEV=oui) dans app/.env
npm run seed:dev

# Pile Docker locale : SEED_MOT_DE_PASSE dans le .env de la racine. L'image « outils » est en
# NODE_ENV=production : on le remplace, avec l'autorisation, pour ce seul lancement.
docker compose run --rm -e NODE_ENV=development -e AUTORISER_SEED_DEV=oui outils npm run seed:dev
```
