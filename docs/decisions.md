# Décisions

Journal des décisions du projet, avec leur date. Une décision n'est jamais effacée : si elle change, on ajoute une nouvelle entrée qui la remplace et on l'indique dans l'ancienne.

## D1 — Deux services : application TypeScript et générateur Python

- **Date** : 01/10/2026, avec le superviseur.
- **Décision** : le projet comprend deux services distincts :
  - `app/` : application TypeScript, qui porte le back-office, le moteur de calcul et l'API interne ;
  - `generateur/` : service Python, qui porte la fusion des modèles Word (docxtpl), la conversion en PDF (LibreOffice sans interface), l'assemblage (pypdf), le QR code et l'empreinte SHA-256.
- **Raisons** : les outils retenus pour la fusion Word et l'assemblage PDF sont des bibliothèques Python ; le reste (écrans, données, calculs) relève d'une application web de gestion.
- **Conséquence** : l'application appelle le générateur par HTTP, sur la machine locale uniquement, avec un secret partagé (en-tête `X-Generateur-Secret`).

## D2 — Pile technique

- **Date** : 05/10/2026.
- **Décision** :
  - `app/` : Next.js (TypeScript), Prisma, PostgreSQL ;
  - `generateur/` : FastAPI (Python).
- **Raisons** : Prisma est utilisé avec le même pilote que le portail RH de l'entreprise (`@prisma/adapter-pg`) ; FastAPI publie automatiquement la documentation OpenAPI demandée au §15.2 du cahier des charges.
- Les versions exactes figurent dans [installation.md](installation.md).

## D3 — Montants en décimal, jamais en flottant

- **Date** : 05/10/2026.
- **Décision** : tout montant (prime, accessoire, taxe, total) est calculé et stocké en décimal exact :
  - TypeScript : type `Decimal` de Prisma (colonne PostgreSQL `numeric`), jamais le type `number` ;
  - Python : `decimal.Decimal`, jamais `float`.
- **Raisons** : un nombre à virgule flottante ne représente pas exactement la plupart des montants (0,1 + 0,2 ≠ 0,3 en flottant). Un écart d'arrondi est inacceptable sur une prime, une taxe ou une facture.
- **Conséquence** : chaque arrondi est explicite, suivant une règle paramétrée, jamais laissé au langage.
- **Point à confirmer au début du moteur de calcul** : `src/domaine/` n'a pas le droit d'importer Prisma (D4). Le `Decimal` de Prisma 7 étant celui de la bibliothèque Decimal.js, le domaine pourra utiliser `decimal.js` directement.

## D4 — Une seule application Next.js découpée en couches

- **Date** : 05/10/2026.
- **Décision** : `app/` est une seule application Next.js, découpée en couches dans `app/src/` :
  - `domaine/` : règles métier pures, sans import de Next.js, de React, de Prisma ni du système de fichiers ;
  - `serveur/` : accès à la base (Prisma), appels au générateur, services ;
  - `app/` : pages, routes API et Server Actions, minces, qui appellent `serveur/` ;
  - `composants/` : interface (React).

  Il n'y a pas deux paquets `frontend/` et `backend/`.
- **Raisons** : on garde la même séparation des responsabilités, sans la complexité d'un monorepo (deux paquets, deux constructions, un contrat d'API à maintenir entre eux). Le portail RH a dû être restructuré après coup en `frontend/` et `backend/` ; ici, la séparation existe dès le départ.
- **Règle** : les dépendances vont dans un seul sens, `app/` → `serveur/` → `domaine/`, jamais l'inverse. `composants/` n'importe jamais `serveur/` : les pages de `app/` lui passent les données. ESLint fait respecter ces règles (`no-restricted-imports`, dans `app/eslint.config.mjs`).
- **Évolution possible** : extraire `domaine/` et `serveur/` dans un paquet séparé si un second consommateur apparaît.

## D5 — Déploiement sur un VPS Linux avec Docker Compose

- **Date** : 05/10/2026, décision du superviseur (définitive). Remplace l'hypothèse du serveur interne SIM (CDC §15.1) et la mention « sans Docker » du plan du socle.
- **Décision** : 4 services (`app`, `generateur`, `postgres`, `redis`) lancés par `docker-compose.yml`, plus une étape `outils` (migrations, scripts). Seul le port 3000 de l'application est publié, sur 127.0.0.1 ; un proxy inverse fournit le HTTPS. Les polices des modèles sont installées dans l'image du générateur.
- **Conséquences** : rendu PDF à valider sous Linux (voir recette.md) ; le dossier partagé réseau SIM (CDC §14.2) n'est pas joignable depuis un VPS (question Q3) ; la sortie autonome de Next.js reste utilisée dans l'image.

## D6 — Authentification : Auth.js, sessions JWT, droits relus en base

- **Date** : 05/10/2026.
- **Décision** : Auth.js v5 (`next-auth@5.0.0-beta.32`, épinglée : c'est une pré-version), identifiant + mot de passe, sessions JWT de 8 heures. Le jeton ne contient que l'identifiant de l'utilisateur ; le compte (actif ?) et son profil sont relus en base à chaque requête (`src/serveur/session.ts`), et les droits sont lus dans la table `profils_droits`.
- **Raisons** : un compte désactivé ou un profil modifié prend effet immédiatement malgré les sessions JWT ; le `proxy.ts` n'est qu'un premier filtre (cookie seulement), les vraies vérifications se font au plus près des données (recommandation de la documentation de Next.js 16).
- **Protections** : mots de passe scrypt (64 Mo par hachage), 12 caractères minimum, verrouillage de 15 minutes au 5e échec, même réponse pour tous les refus, tout journalisé.
- **Limites connues** : pas de limitation de débit par adresse IP (à confier au proxy inverse ou à fail2ban) ; pas d'authentification à deux facteurs ; pas de CSP (en-têtes de sécurité HTTP posés ; la CSP est à ajouter avant la mise en production).

## D7 — « HT » = prime nette ; base taxable = nette + accessoires

- **Date** : 05/10/2026, d'après le CDC (glossaire et cas T1). Résout la question « sens de HT » restée en attente.

## D8 — Journal d'audit en ajout seul, écrit par une seule fonction

- **Date** : 05/10/2026 (CDC §15.4).
- **Décision** : la table `journal_audit` est protégée par des déclencheurs PostgreSQL qui refusent UPDATE, DELETE et TRUNCATE ; une seule fonction du code l'écrit (`journaliser`, dans `src/serveur/audit.ts`) et une règle ESLint interdit tout autre accès. L'écriture se fait dans la même transaction que l'action journalisée.
- **Limite** : un super-utilisateur PostgreSQL peut supprimer les déclencheurs. En production, l'application doit se connecter avec un rôle qui n'est pas propriétaire de la table (à prévoir au déploiement).

## D9 — Moteur de calcul : règles retenues et hypothèses à confirmer

- **Date** : 05/10/2026 (phase 1). Le moteur est `app/src/domaine/calcul/` : fonctions pures, `Decimal` partout (D3), seule source des montants (CDC §5).
- **Règles du CDC appliquées telles quelles** : prime nette = prime unitaire × effectif × coefficient de prorata ; prorata = (échéance − effet + 1) / 365 ; accessoires fixe / par tête / par famille / % de la nette ; taxe sur nette + accessoires ; TTC = nette + accessoires + taxe ; paramètres résolus **à la date du document** (version du produit) et **à la date d'effet de la police** (taxe).
- **Arrondi** (CDC §8.5) : les trois composantes et le TTC sont arrondis selon la précision et le sens du produit ; l'écart éventuel est absorbé par la composante choisie, si bien que le TTC arrondi égale **toujours** nette + accessoires + taxe (contrôle bloquant, §8.1). Niveau « ligne » : le total est la somme des lignes arrondies ; niveau « total » : seule la somme exacte est arrondie.
- **Échéancier** (§8.4) : tranches égales (TTC / n) ou selon une répartition en %, arrondies comme le produit ; la dernière tranche absorbe l'écart ; somme = TTC vérifiée. Les frais de fractionnement s'ajoutent aux accessoires et sont taxés.
- **Taxe de T3** : 120 633 × 1,5 % = **1 809,495** exactement. Le « 1 809,50 » du CDC est l'écriture à deux décimales ; au franc, c'est 1 809.

**Hypothèses à faire confirmer par la Direction Technique** (le CDC ne tranche pas) :

| # | Point | Hypothèse retenue |
| --- | --- | --- |
| H1 | Accessoires de T1 : « acc. 3 000 » et « acc. 210 000 » | mode « fixe » pour les deux (littéral). Le chiffre est le même en « par tête » (1 000 × 3) et « par famille » (3 500 × 60) |
| H2 | Prime minimale | appliquée **par formule** (par ligne), pas sur le total de la police |
| H3 | Contrat de 366 jours (année bissextile, du 01/01 au 31/12) | le coefficient vaut 366/365 (> 1), comme la formule du CDC. Faut-il le plafonner à 1 pour une année civile complète ? |
| H4 | Précision d'arrondi | s'applique à la prime nette, aux accessoires, à la taxe et au TTC (pas seulement au TTC) |
| H5 | « Proposition » de la Comptabilité sur les taxes (CDC §4) | non implémentée : il faut un circuit de validation. Le profil ne peut que consulter |
| H6 | Validité d'une cotation : « 90 jours » (§7) ou « date + 3 mois » (T1) | paramètre en jours ; à trancher en phase 2 |

## Décisions en attente

| Sujet | Qui décide | Échéance |
| --- | --- | --- |
| Nouveau dépôt dédié, ou module du dépôt portailrh | Superviseur | à fixer |
| Q1 : le VPS est-il celui du portail RH (Dokploy) ? Domaine de l'application | Superviseur | avant la phase 6 |
| Q2 : copie des polices Microsoft (Tahoma, Calibri, Arial…) dans l'image Docker | Superviseur | avant le test de fidélité sous Linux |
| Q3 : dossier partagé réseau SIM (CDC §14.2, T14) depuis un VPS | Superviseur | avant la phase 5 |
| Q4 : colonne « Sexe » des modèles : ajouter `assures[].sexe` au dictionnaire ou la retirer | Direction Technique | avant la phase 4 |
| Q5 : qui balise les ~20 modèles Word | Superviseur, Technique | avant la phase 3 |
| H1 à H6 : hypothèses du moteur de calcul (voir D9) | Direction Technique | avant la recette |
