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

Base de données :

```powershell
npm run migrate:deploy
```

Cette commande applique les migrations du dépôt. Elle **crée la base `sim_documents`** si elle n'existe pas, à condition que l'utilisateur PostgreSQL ait le droit `CREATEDB`, ce qui est le cas de `postgres`. Le message attendu se termine par « All migrations have been successfully applied. »

Vérifications :

```powershell
npm run typecheck
npm run lint
npm test
```

Lancement en développement :

```powershell
npm run dev
```

La page d'accueil est sur http://localhost:3000. On arrête avec `Ctrl+C`.

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

## 7. Messages normaux (ce ne sont pas des erreurs)

- **`npm warn deprecated eslint@9.39.5`** : ESLint 9 n'est plus maintenu. C'est la version installée par `create-next-app` 16 ; le passage à ESLint 10 reste à évaluer.
- **`npm warn install-scripts … blocked`** : npm 12 bloque par défaut les scripts d'installation des paquets (ici `prisma`, `@prisma/engines` et `unrs-resolver`). C'est sans conséquence : Prisma télécharge son moteur de migration au premier usage.
- **`npm audit` : 9 vulnérabilités « high »** : 5 dans la chaîne d'ESLint (outil de développement), 4 dans la CLI Prisma (`prisma`, par `deepmerge-ts` et `mysql2`). npm range la CLI Prisma parmi les dépendances de production, car `@prisma/client` la déclare en dépendance « peer ». Elle ne sert pourtant qu'aux migrations : aucun de ces modules n'est chargé par l'application en fonctionnement, et ils sont absents de la sortie de production `.next/standalone` (vérifié le 05/10/2026). **Ne pas lancer `npm audit fix --force`** : il rétrograderait `eslint-config-next` en version 14 et Prisma en version 6, incompatibles avec le projet.
- **Prisma : « Update available 7.10.0 -> 8.0.0-rc… »** : c'est une pré-version. Le projet reste sur Prisma 7.10.0, épinglé dans `package.json`.
- **pytest : `StarletteDeprecationWarning` (httpx → httpx2)** : avertissement connu, les tests ne sont pas touchés. Passer à `httpx2` reste à décider.
- **`Configuration invalide : l'application ne peut pas démarrer`**, ou **`Configuration du générateur invalide`** : ce n'est pas un plantage. Le service s'arrête volontairement et liste les variables à corriger dans `.env`.

**Dépannage** : `Error: P1000: Authentication failed … credentials for (not available)` au moment de `npm run migrate:deploy` signifie que l'utilisateur **ou** le mot de passe de `DATABASE_URL` est refusé par PostgreSQL. Malgré le « (not available) », il faut vérifier les deux, ainsi que l'encodage des caractères spéciaux du mot de passe.

## 8. Travail courant

- **Modifier le schéma de la base** (poste de développement uniquement) : `npx prisma migrate dev --name <nom-de-la-migration>`, puis `npx prisma generate`, car Prisma 7 ne le lance plus automatiquement. Sur un serveur : uniquement `npm run migrate:deploy`.
- **Version de production en local** : `npm run build`, puis `npm start`, qui lance `node .next/standalone/server.js`, la commande utilisée sur un serveur.
- **Ajouter une dépendance Python** : l'ajouter dans `generateur/requirements.in`, puis, l'environnement étant activé :

  ```powershell
  python -m pip install -r requirements.in
  python -m pip freeze | Out-File -Encoding ascii requirements.txt
  ```

  Avec Windows PowerShell 5.1, `pip freeze > requirements.txt` écrirait le fichier en UTF-16, illisible pour Git : d'où `Out-File -Encoding ascii`.
