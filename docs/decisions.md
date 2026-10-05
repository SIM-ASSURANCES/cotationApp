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
| H6 | Validité d'une cotation : « 90 jours » (§7) ou « date + 3 mois » (T1) | **réglé** : « date + 3 mois », paramétrable en mois (D10) |

## D10 — Validité d'une cotation : « date + 3 mois », paramétrable en mois par produit

- **Date** : 05/10/2026, décision de Thierry (phase 2). Remplace l'hypothèse H6 et le paramètre « validité en jours » de la phase 1.
- **Décision** : la fin de validité est la date d'établissement (jour de l'émission) + N mois, N étant un paramètre de la version du produit (3 par défaut), comme dans le cas T1. Si le mois d'arrivée est plus court, c'est son dernier jour (30/11 + 3 mois = 28/02). Le jour de la fin de validité est encore valable ; la cotation devient « Expirée » le lendemain.
- **Règle d'arbitrage** : quand le texte du CDC se contredit (§7 « 90 jours par défaut » contre T1 « date + 3 mois »), **les cas de test du CDC font foi**.
- **Question ajoutée pour la Technique** : confirmer « 3 mois » (et non 90 jours) comme durée par défaut, et la durée propre à chaque produit.

## D11 — Plus de dossier partagé : stockage sur volume persistant

- **Date** : 05/10/2026, décision du superviseur. Remplace CDC §14.2 (dossier partagé réseau SIM) : le VPS ne peut pas joindre ce partage.
- **Décision** : les documents émis sont conservés sur un **volume de stockage persistant** du VPS (volume Docker `documents`). L'accès se fait par un écran **« Documents émis »** (recherche par police, client, type et date ; téléchargement individuel ou en ZIP), à construire avec les phases 3 et 5. Une **sauvegarde automatique** de ce volume est obligatoire : c'est désormais **le seul exemplaire** des contrats émis (voir deploiement.md §7).
- **T14 devient** : « stockage indisponible à l'émission → document conservé en attente, alerte à l'administrateur, reprise automatique ». À réaliser en phase 5.

## D12 — VPS du portail, balisage des modèles, champ sexe

- **Date** : 05/10/2026, décisions du superviseur.
- **VPS** : celui du portail RH ; le nom de domaine reste à définir.
- **Dictionnaire** : `assures[].sexe` est **ajouté** au dictionnaire (valeurs « M », « F », ou vide si inconnu). La cotation le saisit et le conserve déjà.
- **Balisage des modèles Word** : Thierry balise d'abord, puis la Technique ajoute ses propres modèles. **Conséquence** : le guide « rédiger un modèle Word » et les **contrôles au dépôt** (CDC §6.7 : balises inconnues rejetées avec leur emplacement, blocs mal fermés, marqueurs hérités) deviennent **essentiels** en phase 3, parce que d'autres personnes que Thierry déposeront des modèles.

## D13 — Cotation : règles retenues et hypothèses à confirmer

- **Date** : 05/10/2026 (phase 2). Code : `app/src/domaine/cotation/` (règles pures) et `app/src/serveur/cotations.ts`.
- **Statuts** (CDC §9.3) : Brouillon → (soumission) → « À valider » si une prime est forcée **ou** si le TTC dépasse le seuil du produit, sinon directement « Émise ». « À valider » → « Émise » par un valideur, ou → Brouillon (renvoi). « Émise » → Acceptée, Refusée ou Expirée. Un **brouillon n'a pas de numéro** : COT-AAAA-MM-NNNN est attribué à l'émission, par un compteur annuel incrémenté dans la transaction d'émission (continu, sans trou).
- **Figement** : dès l'émission, un déclencheur PostgreSQL interdit toute modification des données (montants, formules, souscripteur, dates…) et toute suppression ; une cotation Acceptée, Refusée ou Expirée ne change plus du tout. Une cotation expirée ne peut donc **jamais** être acceptée, même en SQL direct (T11).
- **Forçage de prime** : on force la **prime unitaire** d'une formule ; le moteur recalcule avec cette prime (aucun montant n'est saisi). Motif obligatoire (5 caractères au moins) pour tout écart, même minime ; une prime identique au tarif n'est pas un forçage. Forcer exige le droit « Demande » ou « Valide » sur « Forcer une prime ».
- **Acceptation** : le client retient une ou plusieurs formules ; le module recalcule sur ces seules formules avec les paramètres **figés** de la cotation, puis crée la police (formules retenues, assurés, échéancier). La saisie du client est copiée dans la cotation : modifier le client ensuite ne change pas une cotation déjà établie.

| # | Point | Hypothèse retenue (à faire confirmer par la Direction Technique) |
| --- | --- | --- |
| H7 | Qui valide | tout profil ayant le droit « Valide » sur « Forcer une prime » (Technique, Direction Générale), pour un forçage **comme** pour un dépassement de seuil ; jamais l'auteur |
| H8 | Total d'une cotation à plusieurs formules | somme des formules, comme dans T1 (Solo + Famille = 15 888 000) ; le comparatif d'options alternatives se lit ligne par ligne |
| H9 | Qui modifie et soumet un brouillon | son auteur seul |
| H10 | Numéro de police | **format provisoire** POL-AAAA-NNNNNN, produit par une seule fonction ; le format réel est une question en attente |
| H11 | Aperçu et émission du PDF | phase 3 (fusion des modèles) ; la cotation est déjà numérotée, figée, et porte le drapeau de filigrane « EXPIRÉE » |
| H12 | Refus d'une cotation « À valider » par un valideur | renvoi en brouillon avec une raison obligatoire |

## Décisions en attente

| Sujet | Qui décide | Échéance |
| --- | --- | --- |
| Nouveau dépôt dédié, ou module du dépôt portailrh | Superviseur | à fixer |
| Nom de domaine de l'application (le VPS est celui du portail RH) | Superviseur | avant la phase 6 |
| Q2 : copie des polices Microsoft (Tahoma, Calibri, Arial…) dans l'image Docker | Superviseur | avant le test de fidélité sous Linux |
| Durée de validité d'une cotation : confirmer « 3 mois » (D10) | Direction Technique | avant la recette |
| Format du numéro de police (provisoire : POL-AAAA-NNNNNN) | Direction Technique | avant la recette |
| H1 à H5 (moteur de calcul, voir D9) et H7 à H12 (cotation, voir D13) | Direction Technique | avant la recette |

Questions **réglées le 05/10/2026** : Q1 (VPS du portail, domaine à définir), Q3 (plus de dossier partagé : D11), Q4 (`assures[].sexe` ajouté : D12), Q5 (Thierry balise d'abord, puis la Technique : D12), H6 (validité en mois : D10).
