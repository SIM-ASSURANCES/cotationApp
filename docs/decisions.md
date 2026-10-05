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

## Décisions en attente

| Sujet | Qui décide | Échéance |
| --- | --- | --- |
| Nouveau dépôt dédié, ou module du dépôt portailrh | Superviseur | à fixer |
| Système du serveur (Windows ou Linux) et sa version | Administrateur | avant le 07/10/2026 |
| Sens de « HT » sur les CP : prime nette seule, ou prime nette + accessoires (base taxable) | Direction Technique | à fixer |
