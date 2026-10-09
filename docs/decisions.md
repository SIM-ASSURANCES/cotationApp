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
| H5 | « Proposition » de la Comptabilité sur les taxes (CDC §4) | non implémentée : il faut un circuit de validation. Le profil ne peut que consulter. **Décision de Thierry du 08/10/2026 : la valeur « Proposition » est supprimée, la Comptabilité est en « Lecture » (D21)** |
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

## D14 — Décisions du 05/10/2026 : compléments

- **Date** : 05/10/2026, décisions du superviseur ; consignées le 06/10/2026 (reliquat de la phase 3). Complètent D11 et D12, qui en portent déjà l'essentiel :
  - **Déploiement** sur le VPS du portail RH (D12). Le **nom de domaine** reste à définir : il sera lu dans une variable d'environnement **`URL_PUBLIQUE`** (adresse de vérification des QR codes, CDC §14.1), ajoutée avec l'émission des documents. Aucune adresse n'est écrite en dur.
  - **Dictionnaire** : `assures[].sexe` ajouté (§6.3.2, D12) ; il figure dans `app/src/domaine/documents/dictionnaire.ts`.
  - **Plus de dossier partagé** : stockage persistant sur le VPS, écran « Documents émis », sauvegarde du volume ; T14 devient « stockage indisponible à l'émission » (phase 5) (D11).
  - **Balisage** : Thierry, puis la Technique, qui déposera ses propres modèles (D12).
  - **Polices Microsoft dans l'image Docker** : **en attente de l'accord du superviseur** (question Q2). Elles ne sont pas dans le dépôt ; une image qui les contient n'est **jamais publiée dans un registre public** (Docker Hub, GitHub…) : elle se construit sur le VPS, ou dans un registre privé. Sans elles, la pagination de Word n'est pas reproduite (recette.md §1.2) : le générateur se déclare alors « dégradé » (`/sante`), et l'application affiche `generateur: "ko"`.

## D15 — Modèles Word : bibliothèque, contrôles, fusion (phase 3a)

- **Date** : 06/10/2026 (phase 3a). Code : `app/src/domaine/documents/` (dictionnaire, contrôles, cycle), `app/src/serveur/modeles.ts`, `generateur/app/analyse.py`, `fusion.py`, `filtres.py`.
- **Dictionnaire, source unique** : il est écrit **une seule fois**, dans l'application (`dictionnaire.ts`). Il sert aux contrôles au dépôt, à la construction des données (`champsInconnus` refuse un nom inventé), à l'aide intégrée (page « Aide à la rédaction des modèles ») et aux données fictives de l'aperçu. Le générateur, lui, **ne connaît pas le dictionnaire** : il relève des faits (balises, emplacement, champs Word, polices) et c'est l'application qui décide (rejet, avertissement).
- **Stockage des modèles** : chaque version déposée (le .docx tel quel, son empreinte SHA-256) est conservée **dans PostgreSQL**, avec ses métadonnées : une seule sauvegarde (celle de la base) couvre les modèles. Une version n'est jamais modifiée ni supprimée, et une version publiée ne change plus du tout (déclencheurs). Le PDF des CG et CS, produit **une seule fois** à la publication, est conservé avec la version.
- **Cycle** : Brouillon (dépôt réussi) → Soumis (par son auteur) → Publié (par un autre utilisateur ayant le droit « Publier », jamais l'auteur, vérifié aussi par la base). Un dépôt **refusé n'est pas enregistré** (le refus est journalisé). « Archivé » n'est pas stocké : une version publiée est « remplacée » dès qu'une version publiée plus récente est en vigueur. Une publication n'est jamais rétroactive (date d'effet ≥ aujourd'hui).
- **Fusion** : `StrictUndefined` (une donnée absente arrête la génération, avec son chemin : « donnée absente : « souscripteur.prenoms » »), `autoescape`, **bac à sable Jinja** (un modèle déposé n'atteint aucun objet interne). Une donnée présente mais vide (null) s'écrit vide : c'est la construction des données qui décide qu'il n'y a pas de valeur. Sont refusés au dépôt : les calculs (`+ - * /`), le filtre `default` (il masquerait une donnée absente), `set`, `include`, les appels de fonction autres que `bloc()`.
- **Filtres** : séparateur de milliers = **espace insécable U+00A0** ; l'espace fine U+202F est absente d'Arial Narrow et de MS Gothic, utilisées par les modèles (vérifié avec `fc-list` dans l'image). Les décimales reçues s'écrivent telles quelles ; un flottant est refusé. `case` n'accepte qu'un booléen.
- **Piège de la syntaxe du CDC** : `{{ risque.statut == "PROPRIETAIRE" | case }}` (§6.2) est lu par Jinja comme `risque.statut == ("PROPRIETAIRE" | case)` et affiche « False ». La condition doit être **entre parenthèses** : `{{ (risque.statut == "PROPRIETAIRE") | case }}`. Le dépôt sans parenthèses est refusé, avec ce message.
- **Listes longues** (§6.5) : au-delà du seuil (paramètre historisé, 10 par défaut), chaque boucle `{%tr for %}` (ligne de tableau) ou `{%p for %}` (paragraphes) du corps sur la liste est remplacée par « Voir annexe – Liste des assurés (N personnes) », sur toute la largeur du tableau ; la liste complète est rendue par le modèle d'annexe de cette liste, à la fin du PDF. Une boucle écrite dans une ligne de texte ne peut pas passer en annexe : la génération s'arrête avec un message.
- **Sous-modèles** : `{{ bloc("garanties", f.code) }}`, seul dans son paragraphe, insère le sous-modèle de nom « garanties » et de clé le code de la formule (celui du produit, à défaut le commun). Le sous-modèle est fusionné avec les mêmes données ; il ne peut pas appeler `bloc()` à son tour.
- **Aperçu** (§6.6) : données fictives couvrant tout le dictionnaire, nombre d'assurés au choix (T7), emplacements d'images gris. Pour l'aperçu seulement, un sous-modèle ou une annexe pas encore publiés sont pris dans leur dernière version déposée.

| # | Point | Hypothèse retenue (à faire confirmer) |
| --- | --- | --- |
| H13 | Noms des éléments de `societe.rib[]`, `societe.mobile_money[]`, `societe.recours[]` (non nommés par le CDC) | `rib[].banque`, `rib[].numero` ; `mobile_money[].operateur`, `mobile_money[].numero_marchand` ; `recours[].libelle`, `recours[].url` |
| H14 | Marqueurs hérités (« XXX », « 00/00/00 », « ___ »…, CDC §6.7) | **avertissement**, pas rejet : une ligne « ________ » pour une signature manuscrite est légitime |
| H15 | Champs obligatoires par type (CDC §6.7) | ~~seule la facture~~ **corrigée le 06/10/2026 (D16)** : facture, CP, cotation et reçu ont des champs obligatoires |
| H16 | Un modèle par rôle | une seule annexe par liste, un seul sous-modèle par (nom, clé), une seule relance par niveau, pour un même produit (ou en commun) ; plusieurs CP par produit restent possibles |
| H17 | Balises permises dans des CG / CS | `produit.cg_libelle`, `produit.cg_visa`, `produit.cg_date` / `produit.cs_libelle`, `produit.cs_visa`, rendues à la publication avec le visa saisi au dépôt |

## D16 — Décisions du 06/10/2026 : champs obligatoires, polices

- **Date** : 06/10/2026, décisions de Thierry.
- **Champs obligatoires (correction de H15)** : en plus de la facture, les modèles de **CP**, de **cotation** et de **reçu** sont refusés au dépôt s'il leur manque : le numéro, le souscripteur (`souscripteur.nom` **ou** `souscripteur.raison_sociale` : personne physique ou morale), `police.date_effet`, `police.date_echeance` et `prime.ttc` ; pour le reçu, en plus, le montant payé et la facture réglée. Le numéro est `police.numero` (CP, reçu) ; pour la cotation, voir H18.
- **Polices** : Tahoma est **remplacée dans les modèles** (police cible en cours de test, Arial pressentie) ; Calibri reste rendue par **Carlito** dans l'image. **Le Dockerfile ne change pas encore** : il changera quand le test D (fidélité avec la police retenue) aura validé le choix. À faire à ce moment, en même temps : retirer Tahoma et Calibri des polices exigées par `/sante` (`generateur/app/polices.py`, `POLICES_REQUISES`), sans quoi le générateur se déclarera « dégradé » dans une image qui ne les contient plus.

## D17 — Émission des documents : assemblage, QR code, archivage (phase 3b)

- **Date** : 06/10/2026 (phase 3b). Code : `app/src/serveur/documents.ts`, `app/src/domaine/documents/emission.ts` et `donnees.ts`, `generateur/app/pdf.py` et `stockage.py`.
- **Assemblage** (§6.8) : un seul PDF, CP → annexes → CS → CG. Les CG et CS jointes sont les versions **publiées** en vigueur des modèles désignés par le paramétrage du produit (nouvelles « références contractuelles » d'une version de produit : code du modèle et visa). **Contrôle bloquant** : le visa cité par le produit doit être celui des CG (et des CS) jointes. Un produit sans CG ne peut pas émettre de CP.
- **QR code** (§14.1) : jeton de **256 bits** aléatoires (base64url), propre à chaque version du document, jamais l'identifiant ni le numéro. Le QR code contient `URL_PUBLIQUE/verif/{jeton}`. Page publique : type, numéro, version, date, statut en temps réel (valide, expiré, « Annulée – avoir AV-… »), produit, souscripteur masqué (« K****** A. »), empreinte. Jeton inconnu : page neutre. 30 consultations par minute et par adresse IP, puis refus (429).
- **Empreinte et archivage** (§14.3) : SHA-256 du PDF final, enregistrée avec le document, affichée sur la page de vérification, et **contrôlée à chaque téléchargement** (un fichier altéré est refusé). Stockage en **ajout seul** derrière **une seule interface** (`serveur/stockage.ts`) : aujourd'hui le volume `documents` du générateur (`/donnees/sortie/documents`), écriture atomique, jamais d'écrasement (le générateur refuse un chemin existant), fichier en lecture seule. En base, un document émis n'est jamais modifié ni supprimé (déclencheur) ; seule l'annulation par un avoir s'ajoute, une fois.
- **Régénération à l'identique** (T10) : chaque document enregistre la version exacte du modèle principal, des annexes, des sous-modèles, des CS et des CG, la date des paramètres du produit, et les données fusionnées. Une réédition reprend **tout cela**, même après la publication d'une nouvelle version ; elle crée une nouvelle version (fichier et jeton nouveaux), liée à la première.
- **Cotation** : aperçu PDF à tout moment (filigrane « APERÇU », rien n'est stocké) ; PDF définitif émis **aussitôt après l'émission** de la cotation ; réédition d'une cotation expirée avec le filigrane « EXPIRÉE » (T11). Les CP s'émettent depuis la fiche de la cotation acceptée.
- **Société** : les valeurs `societe.*`, le lieu d'émission, le signataire et les images (signature scannée, cachet) sont des paramètres historisés (écran « Société »), jamais écrits dans les modèles.

| # | Point | Hypothèse retenue (à faire confirmer) |
| --- | --- | --- |
| H18 | Champs obligatoires (D16) : numéro d'une cotation ; montant et facture d'un reçu | cotation : `doc.numero` (COT-…), car une cotation n'a pas encore de police ; reçu : `paiements[].montant` et `doc.facture_origine` (décrit désormais comme « facture annulée (avoir) ou réglée (reçu) ») |
| H19 | Champ du dictionnaire que l'application ne connaît pas (profession, intermédiaires, nantissement…) | présent dans les données avec la valeur null : il s'écrit vide. Seul un nom **absent** fait échouer la génération |
| H20 | `doc.empreinte` | un document ne peut pas contenir sa propre empreinte : null dans le PDF ; l'empreinte est sur la page de vérification et dans « Documents émis » |
| H21 | Droits sur les documents émis (lecture, émission, réédition) | selon le type : cotation ← « Créer une cotation » ; CP ← « Émettre un contrat » (le « sous seuil » du Gestionnaire est contrôlé depuis les corrections de la 4a, H44, et pour les factures depuis la 4b, H56 : **H21 fermée** le 08/10/2026 par Thierry) ; facture, avis, relance ← « Émettre une facture » ; avoir et annulation ← « Émettre un avoir » ; reçu ← « Enregistrer un paiement » |
| H22 | Où sont les fichiers | sur le volume du générateur ; l'application y accède par ses routes internes (écriture, lecture, ZIP) |
| H23 | Émission du PDF d'une cotation | automatique après l'émission ; si elle échoue (modèle non publié, générateur arrêté…), la cotation reste émise et le bouton « Émettre le PDF » permet de recommencer. Le PDF d'une cotation ne joint pas les CG (seulement les CP) |
| H24 | Réédition | images (signature, cachet) : celles en vigueur le jour de la réédition (elles ne sont pas conservées avec le document) ; filigrane « EXPIRÉE » si la cotation a expiré, « ANNULÉ » si le document a été annulé par un avoir |
| H25 | Statut « Expiré » de la page de vérification | selon la fin de validité enregistrée à l'émission |
| H26 | Plusieurs modèles de CP pour un même produit (H16 les permet) | l'émission prend le plus ancien qui a une version en vigueur : un critère de choix (individuel, famille, groupe…) reste à définir |
| H27 | Limite de la page de vérification | 30 requêtes par minute et par adresse IP, en mémoire du serveur (une seule instance) |
H28 – Accessoires et prorata
Retenu : quand un contrat dure moins d'un an, la prime nette est proratisée (par exemple × 163/365), mais les accessoires restent entiers. Exemple, formule Solo du 22/07 au 31/12/2026 : prime nette de 280 744 ramenée à 125 373, accessoires maintenus à 3 000.
Question : les accessoires (frais de gestion de police) sont-ils un montant fixe par contrat, ou doivent-ils eux aussi être proratisés à la durée ?
## D18 — Réponses de la Technique du 08/10/2026

- **Date** : réponses reçues le 08/10/2026 ; consignées et comparées au code le 08/10/2026 (session 4.0), **avant** toute correction.
- **Règle** : les hypothèses H1 à H12 de D9 et D13 restent dans leurs tableaux pour l'historique ; cette section les remplace là où elle les tranche. « Code avant 4.0 » décrit ce que faisait le dépôt avant la session 4.0.

| # | Réponse de la Technique | Code avant 4.0 | Statut |
| --- | --- | --- | --- |
| H1 | Les accessoires « peuvent varier » | accessoires fixés par la formule du produit, non modifiables dans la cotation | **à corriger** : valeur par défaut de la formule, modifiable dans la cotation, modification journalisée (avant/après) ; les seuils de validation s'appliquent au TTC obtenu (choix par défaut de Thierry, qu'il peut changer) |
| H2 | Question mal comprise : un même produit peut avoir des garanties à prime fixe et des garanties à prime calculée selon des critères | prime minimale appliquée par formule | **en attente** : question reformulée par Thierry. Prime minimale **inchangée** |
| H3 | Coefficient de prorata plafonné à 1 pour une année complète | coefficient 366/365 pour un contrat de 366 jours | **à corriger** : `coefficient = min(1, jours / 365)` |
| H4 | Arrondi appliqué à la prime nette, aux accessoires, à la taxe et au TTC, avec nette + accessoires + taxe = TTC | les trois composantes **et** le TTC arrondis séparément ; l'écart est absorbé par une composante paramétrée | **à corriger** : le TTC est **la somme** des trois montants arrondis, jamais un arrondi indépendant. La « composante absorbante » du paramétrage n'a plus d'effet |
| H5 | Les taux sont fixés par la loi (tableau ci-dessous) | un taux par branche et par date d'effet | **à corriger, changement de modèle** : clé `(branche, type_contrat, date_effet)` |
| H7 | La Technique valide ; possibilité d'afficher le nom de l'auteur de la cotation | validation par le droit « Valide » sur « Forcer une prime » (Technique **et** Direction Générale) | **à corriger** : validation réservée au profil Technique, par un droit paramétrable ; champ `doc.auteur_nom` ajouté au dictionnaire |
| H8 | Total = somme des formules (confirmé). Nouveau : des options au choix modifient la prime | total = somme des formules | **conforme** pour le total ; options : **en attente** de précisions, rien n'est codé |
| H9 | Un collègue ou un responsable peut aussi modifier un brouillon | seul l'auteur modifie et soumet son brouillon | **à corriger** : tout utilisateur qui a le droit de modifier une cotation ; chaque modification tracée ; qui a créé **ou** modifié ne valide pas |
| H10 | SIM attribue le numéro de police ; format `SCD-2026-000088-G00000` ; import d'une liste de numéros à discuter | numéro provisoire POL-AAAA-NNNNNN généré par le module | **à corriger** : numéro **saisi**, jamais généré ; unique ; format contrôlé par une expression régulière paramétrable. Import : **phase 5** |
| H11 | Pas de réponse | Aperçu et émission du PDF (H11 de la phase 2) | **réglée** le 08/10/2026 par Thierry : traitée par D17 / H23 (PDF émis automatiquement après l'émission, bouton « Émettre le PDF » en cas d'échec) |
| H12 | Refus : le valideur renvoie la cotation en brouillon, motif obligatoire | renvoi en brouillon par un valideur, raison obligatoire, journalisé ; statut « Refusée » réservé au refus du client | **conforme** ; le droit du valideur suit H7 ; test automatisé dédié ajouté |
| H28 | Pas de réponse | accessoires non proratisés | **inchangée, en attente** |

Taux de taxe communiqués (H5), chargés comme **données de démarrage** (jamais écrits dans le moteur) :

| Branche (code retenu) | Type de contrat | Taux |
| --- | --- | --- |
| Individuelle accident (`IA`) | tous | 7,25 % |
| Décès (`DECES`) | tous | 0 % |
| Santé (`SANTE`) | INDIVIDUEL | 4 % |
| Santé (`SANTE`) | GROUPE | 1,5 % |
| Incendie et dommages aux biens (`IARD`) | tous | 12,5 % pour l'incendie ; 7,25 % pour le reste : **taux mixte, non pris en charge** (voir plus bas) |

Conséquences retenues pour le code (session 4.0) :

- **Date du taux** : celui en vigueur à la **date d'effet de la police** (CDC §8.1, D9), décision de Thierry du 08/10/2026 ; la phrase « à la date du document » des instructions 4.0 ne change pas cette règle.
- **Taux le plus précis** : pour une branche et un type de contrat, le moteur prend d'abord la ligne de ce type, puis celle du type rattaché (H29), puis la ligne « tous types » (type vide).
- **Incendie / dommages aux biens** : deux taux dans un même contrat. La règle de ventilation n'est pas confirmée : le moteur **refuse** le calcul (« taux mixte non pris en charge : à paramétrer »).
- **Périodes** : pour une même clé (branche, type de contrat), deux périodes de validité ne se chevauchent jamais (contrainte d'exclusion PostgreSQL). Ajouter un taux après une ligne sans date de fin **clôt** cette ligne la veille de la nouvelle date d'effet : c'est la seule modification permise sur une ligne en vigueur, une seule fois, journalisée.
- **Documents déjà émis** : jamais recalculés (T10). Les cotations calculées avant la session 4.0 gardent leurs règles d'arrondi et de prorata d'origine (version du moteur enregistrée avec le calcul).

| # | Point | Hypothèse retenue (à faire confirmer) |
| --- | --- | --- |
| H29 | `police.type_contrat` a 4 valeurs (INDIVIDUEL, FAMILLE, GROUPE, GROUPE_OUVERT) ; la Technique n'en cite que 2 | FAMILLE prend le taux INDIVIDUEL ; GROUPE_OUVERT prend le taux GROUPE |
| H30 | T3 (facture **individuelle** YAO) attend 1,5 %, alors que la loi donne 4 % en santé individuelle | **conflit CDC / loi, non tranché** : le test T3 garde les données du CDC, avec `type_contrat = GROUPE` explicite. T3 : individuel à 4 % ou 1,5 % ? |
| H31 | Format du numéro de police `SCD-2026-000088-G00000` | contrôle par défaut `^[A-Z0-9]+-\d{4}-\d{6}-[GI]\d{5}$`, paramétrable ; signification des 5 chiffres après G ou I **inconnue**. **Question pour la Technique : les 5 chiffres sont-ils le numéro de l'adhérent ?** (si oui, le numéro d'un certificat d'adhésion pourra se dériver de celui de la police mère : voir H37) |

## D19 — Champs facultatifs du dictionnaire (option b de H19)

- **Date** : 08/10/2026, choix de Thierry (option b), remplace H19.
- **Décision** : un champ du dictionnaire que l'application ne fournit pas est **absent** des données, et la génération d'un modèle qui l'utilise **échoue** en nommant le champ, **sauf** s'il est déclaré facultatif dans le dictionnaire : il est alors présent, vide. Une valeur connue mais vide (e-mail non saisi, pas encore de paiement) reste une valeur : elle s'écrit vide.
- **Liste des champs facultatifs** (session 4.0, à faire valider par la Technique) : `doc.empreinte` (H20 : un document ne peut pas contenir sa propre empreinte), `intermediaires`, `police.police_mere`, `police.nantissement`. Ces quatre champs sont rendus vides. **Ajout du 08/10/2026 (décision de Thierry, corrections de la 4a)** : `police.reference` devient facultatif, rendu vide tant que la Technique n'a pas dit d'où vient cette référence (H46).
- **Décision de Thierry du 08/10/2026** : cette liste est retenue. `beneficiaires[]` et `contacts_urgence[]` **ne sont pas facultatifs** : la session 4a devra permettre leur saisie.
- **Champs non fournis, donc bloquants s'ils sont dans un modèle** : les champs du souscripteur que la saisie ne demande pas (profession, date et lieu de naissance, BP, localité…), `beneficiaires` et `contacts_urgence` d'une cotation antérieure à la 4a, et `police.type_contrat` d'une cotation antérieure à la session 4.0. `assures[].prime` est fourni par le moteur depuis les corrections de la 4a (H45). Pour en rendre un facultatif : le marquer dans `src/domaine/documents/dictionnaire.ts`.

## D20 — Champ `doc.auteur_nom` (extension du dictionnaire)

- **Date** : 08/10/2026 (réponse H7). Comme `assures[].sexe` (D12), c'est une **extension** du dictionnaire du CDC §6.3.4 : nom de l'utilisateur qui a créé la cotation, affichable sur le document.

## D21 — Choix de mise en œuvre de la session 4.0 (à valider par Thierry)

- **Date** : 08/10/2026. Choix techniques faits pendant la session 4.0, sans règle métier nouvelle ; chacun se change facilement.
- **Date d'effet des taux de démarrage** : 01/01/2026 (`prisma/donnees/taxes-loi.json`), **validée par Thierry le 08/10/2026 à titre provisoire**. La date réelle d'entrée en vigueur n'a pas été donnée : à confirmer par la Technique (ligne « en attente »).
- **Branches fiscales** : liste **paramétrable** (écran « Branches », table `branches`), et non plus figée. Chaque ajout ou modification (libellé, état actif) est journalisé. Le code ne change jamais et ne se supprime pas ; une branche désactivée garde ses taux et ses produits mais n'en reçoit plus. Taux et produits ne se rattachent qu'à une branche active de la liste. Branches de démarrage (`prisma/donnees/branches.json`) : `IA`, `DECES`, `SANTE`, `IARD`. Produits hors tableau : H32 ci-dessous.
- **Droit « modifier une cotation » (H9)** : c'est le droit existant « Créer une cotation » (pas de nouvelle ligne dans la matrice). Celui qui modifie le brouillon d'un autre peut aussi le soumettre ; soumettre ne compte pas comme une modification.
- **Validation (H7)** : nouveau droit paramétrable « Valider une cotation » (`VALIDER_COTATION`), « Valide » pour la Technique seule. La Direction Générale, qui validait jusqu'ici, ne valide plus par défaut ; l'administrateur peut lui redonner ce droit. **Validé par Thierry le 08/10/2026.** **Écart avec le CDC §4.1** (« Technique ou DG ») : **à présenter au superviseur**.
- **Droits : valeur « Proposition » supprimée, Comptabilité en « Lecture » sur le paramétrage (décision de Thierry du 08/10/2026, corrections de la 4a)** : le CDC §4 donne « Taxes (proposition) » à la Comptabilité pour « Paramétrer produits, taxes, arrondis ». Aucun circuit de proposition n'existe : la valeur « Proposition » est retirée de la liste des niveaux et la Comptabilité passe en **Lecture** (elle consulte, ne modifie rien). **Écart avec le CDC §4** (comme celui de la validation ci-dessus) : **à présenter au superviseur**. La migration `20261009100000_validation_contrat_et_droits` convertit en « Lecture » toute ligne `PROPOSITION` déjà en base et le journalise (action `DROIT_MODIFIE`, auteur `migration`). Un test compare ligne à ligne les droits par défaut (code et base) au tableau du CDC §4, hors cette cellule et le droit ajouté « Valider une cotation ».
- **Composante absorbante** : retirée de l'écran de version de produit (sans effet depuis le moteur v2, H4). La colonne reste en base avec la valeur fixe `TAXE`, pour les versions déjà enregistrées.
- **H32 (nouveau)** : branche fiscale et taux pour SECURMOTO, RELAXVOYAGE, SECURECOLTE et les autres produits hors tableau de la loi communiqué par la Technique. Tant qu'elle n'a pas répondu, ces produits n'ont pas de taux et leur calcul est refusé (« Aucune taxe en vigueur »).
- **Numérotation** : H32 est pris par la ligne ci-dessus ; le point « trop-perçu » prévu dans le fichier d'instructions de la phase 4 devient **H33** (à consigner par la session 4b).
- **Format du numéro de police (H10, H31)** : paramètre historisé de l'écran « Société », modifiable avec le droit « Paramétrer produits ». Le numéro saisi est mis en majuscules ; il est unique en base.
- **Accessoires (H1)** : une valeur saisie vide reprend la valeur de la formule ; en mode pourcentage, la valeur saisie est un pourcentage (0 à 100).

## D22 — Contrats complets et contrats de groupe (session 4a)

- **Date** : 08/10/2026. Choix de mise en œuvre de la session 4a, branche `phase-4a` (non fusionnée). Aucune règle métier de la Technique n'est inventée : chaque choix qui en tient lieu est une hypothèse numérotée ci-dessous, à confirmer. Les décisions de Thierry sur D19 sont appliquées telles quelles.
- **Option b de D19 (rappel)** : un champ saisi puis laissé vide s'écrit vide ; seul un champ **jamais fourni** bloque la génération d'un modèle qui l'utilise. `null` = jamais fourni, `[]` = saisi et laissé vide, de la saisie jusqu'aux données du document. Facultatifs : `intermediaires`, `police.police_mere`, `police.nantissement`, `doc.empreinte` (et `police.reference`, ajouté par les corrections du 08/10/2026). `beneficiaires[]` et `contacts_urgence[]` ne sont pas facultatifs : la 4a en permet la saisie.
- **Saisies ajoutées** : les 14 champs du souscripteur absents jusque-là (`num_identification`, `date_naissance`, `lieu_naissance`, `profession`, `activite`, `employeur`, `bp`, `localite`, `sous_prefecture`, `whatsapp`, `mobile_money`, `situation_matrimoniale`, `nb_enfants`, `groupe_sanguin`), les bénéficiaires et les contacts d'urgence. Une cotation ou un client d'avant la 4a garde ses champs « jamais fournis » : il reste valide, mais un modèle qui en utilise un ne se génère pas tant qu'ils ne sont pas complétés.
- **Contrat de groupe (CDC §10.2)** : la police mère (types `GROUPE` et `GROUPE_OUVERT`) porte la liste de ses adhérents, **toujours en annexe**, même sous le seuil (le générateur reçoit `listes_en_annexe`). Un adhérent a un numéro d'ordre qui ne change jamais et n'est jamais réutilisé. La liste évolue par **versions en ajout seul** (table `adherents_versions`, protégée par la base) : liste initiale, incorporation, retrait. Chaque changement produit une **nouvelle version des conditions particulières** (même numéro, version + 1) ; la réédition d'un ancien document reprend la liste de sa version (T10). La facture d'avenant reste en 4b.
- **Certificat d'adhésion unitaire** : un document par adhérent, avec `police.police_mere` et son propre QR code. La génération en masse reste en phase 5 (T8).
- **Branches fiscales** : T5 (SECURVIE) utilise la branche `DECES` (0 %, données de démarrage). T6 (VOL, IARD) ne teste que le document, avec des montants de fixture, car l'IARD reste refusé tant que H32 n'est pas tranchée.

### Hypothèses de la session 4a, à faire confirmer

| # | Point | Hypothèse retenue (à faire confirmer) |
| --- | --- | --- |
| H34 | Où saisir les compléments du souscripteur, les bénéficiaires et les contacts d'urgence | dans le **brouillon de cotation** (ils sont figés avec elle), puis **complétables à l'acceptation** de la cotation, au moment où la police est créée. Pas d'écran de modification d'une police. Un client enregistré porte ses compléments, repris dans ses cotations |
| H35 | Contenu obligatoire des CP (CDC §10.1) | appliqué **au dépôt** du modèle (refus avec le champ manquant) : durée, bloc des primes complet (nette, accessoires, taxe, TTC), clause citant `produit.cg_libelle` et `produit.cg_visa`, clause de réclamation (`societe.email_reclamation`), lieu et date d'émission, `signature_sim`. Assurés, bénéficiaires, contacts d'urgence, intermédiaires et garanties (`bloc()`) dépendent du produit : on ne les exige pas de tout modèle |
| H36 | Prime sur le certificat d'adhésion | **aucune** : l'accessoire fixe d'une formule est dû par contrat, le répartir par adhérent reviendrait à inventer une règle. Les champs de prime ne sont pas fournis au certificat, donc un modèle de certificat qui les utilise ne se génère pas |
| H37 | Numéro d'un certificat d'adhésion | **saisi** à l'émission, au format des polices (H31), unique parmi les polices et les documents. **Tranchée par Thierry le 08/10/2026 : on garde « Saisi »** (options écartées : dérivé du numéro de la police mère, numéro de la mère). Liée à la question de H31 : si les 5 chiffres sont le numéro de l'adhérent, ils pourront être dérivés |
| H38 | Date d'adhésion et dates de changement | la date d'adhésion d'un adhérent est la date d'effet de la police pour la liste initiale, sinon celle de la version d'incorporation ; une date de changement reste dans la période de la police et ne précède pas le changement précédent. Incorporation et retrait ne produisent ni prime ni facture (avenant : 4b) |
| H39 | `police.duree_libelle` | **Règle de Thierry du 08/10/2026** : « N an(s) » ou « N mois » quand la durée est exacte en années ou en mois civils, sinon « N jours ». Mise en œuvre : les deux dates sont incluses ; la durée est exacte en mois quand le lendemain de l'échéance tombe le même quantième que la date d'effet (22/07/2026 au 21/01/2027 : 6 mois) ; un nombre de mois multiple de 12 s'écrit en années (« 1 an », « 2 ans »), les autres en mois (« 18 mois »). Sinon le nombre de jours couverts (« 163 jours », « 1 jour »). Une année bissextile de 366 jours est « 1 an ». Un quantième qui n'existe pas dans le mois d'arrivée (31 janvier au 27 février) donne des jours |
| H40 | Retrait d'adhérents | refusé s'il vide la liste : la police garde au moins un adhérent ; les numéros d'ordre retirés ne sont jamais réattribués |
| H41 | Quotes-parts des bénéficiaires | chaque quote-part est un pourcentage supérieur à 0 et au plus 100, la somme vaut **exactement 100 %** (calcul décimal exact) ; une liste vide est admise (champ saisi vide, D19) |
| H42 | Quels contrats ont une police mère | `GROUPE` et `GROUPE_OUVERT` seulement ; `INDIVIDUEL` et `FAMILLE` n'ont ni annexe imposée ni certificat |
| H43 | T6 : montants | montants de fixture avec un taux de 10 % inventé, **sans valeur fiscale** ; à remplacer par un vrai calcul quand H32 (taux mixte de l'IARD) sera tranchée |

### Corrections du 08/10/2026 (demande de Thierry, avant la 4b)

- **« Oui (sous seuil) » à l'émission d'un contrat** : au-dessus du seuil de validation du produit, le contrat passe en validation (H44 ; ferme H21 pour les contrats). Table `validations_contrat`, actions d'audit `CONTRAT_A_VALIDER` et `CONTRAT_VALIDE`.
- **Droits** : valeur « Proposition » retirée et Comptabilité en « Lecture » (trace dans D21) ; test de conformité des droits par défaut au tableau du CDC §4, en code et en base ; validation d'une cotation indépendante du droit « Forcer une prime » (testée dans les deux sens).
- **Données** : `assures[].prime` fourni par le moteur (H45), `police.reference` facultatif (H46), `police.duree_libelle` en années, mois ou jours (H39).
- **Date** : la 4a est écrite le 08/10/2026 (elle portait le 09/10 par erreur). La migration `20261009090000_contrats_4a` **garde son nom** ; la migration des corrections, `20261009100000_validation_contrat_et_droits`, porte un horodatage postérieur pour passer après elle.

| # | Point | Hypothèse retenue (à faire confirmer) |
| --- | --- | --- |
| H44 | Émission d'un contrat au-dessus du seuil | le **TTC de la police** est comparé au seuil de la **version du produit** de la cotation, **strictement** (un TTC égal au seuil passe, comme pour la cotation, D18) ; sans seuil paramétré, personne n'est limité. Un profil « Oui (sous seuil) » (le Gestionnaire production par défaut) qui demande l'émission enregistre une demande « À valider » (une seule ouverte par police, journalisée). Un profil « Oui » (la Technique par défaut) **autre que le demandeur** émet alors les CP, ce qui vaut validation. **La Direction Générale (Lecture sur ce droit) ne valide pas** : écart avec le CDC §4.1 (« Technique ou DG »), le même que pour la cotation (D21), à présenter au superviseur. Le demandeur ne décide jamais sa propre validation, même si ses droits changent. Ne sont pas soumis au seuil : la mise à jour des CP après un changement d'adhérents, les certificats d'adhésion et les rééditions (aucun nouveau montant). L'émission d'une facture « sous seuil » suit la même règle depuis la 4b (H56) |
| H45 | `assures[].prime` | **Décision de Thierry du 08/10/2026 (session 4b)** : **TTC d'une unité de la formule de l'assuré**, comme le « TTC/personne » de T1 : TTC arrondi de la ligne ÷ effectif, au franc (`ttcParUnite` du moteur). T1 : 96 000 (Solo), 260 000 (Famille), vérifiés par test. Aucun calcul dans le générateur. Vide pour un assuré sans formule, pour une formule absente du calcul et pour un adhérent **incorporé après la liste initiale** (sa prime n'est pas dans le calcul de la police ; elle est sur la facture d'avenant). Pas de prime sur le certificat (H36). **Membres d'une famille** : choix actuel conservé, chaque membre rattaché à une formule « Famille » porte la prime **de la famille entière** (260 000 en T1), pas une part : **à confirmer par la Technique** |
| H46 | `police.reference` | facultatif (décision de Thierry), rendu vide tant que la source de cette valeur n'est pas connue. **Question pour la Technique** : à quoi correspond la « référence » de la police (référence interne, ancien numéro, référence du courtier…) et d'où vient-elle ? |

## D23 — Factures, avoirs, paiements, reçus (session 4b)

- **Date** : 08/10/2026. Branche `phase-4b`, créée depuis `phase-4a` (non fusionnée). Demandes de Thierry appliquées : migrations nommées après `20261009100000` (test de l'ordre des migrations), H45 en TTC par unité, « Oui (sous seuil) » à l'émission d'une facture (H21 fermée), trop-perçu = H33, nouvelles hypothèses à partir de H47.
- **Cycle d'une facture** : brouillon (sans numéro) → « À valider » (au-dessus du seuil, profil « Oui (sous seuil) ») → émise (numéro FAC attribué dans la transaction de l'émission, ligne du compteur verrouillée) → annulée (par un avoir, une fois). Une facture émise ne se modifie ni ne se supprime : la base le refuse (déclencheur `facture_intangible`). Correction = avoir puis nouvelle facture, qui garde le lien vers celle qu'elle remplace (T4).
- **Numérotation** (CDC §11.4) : COT, FAC, AV, REC ; compteur **annuel** par type, sans trou (incrément annulé avec la transaction) ; format **paramétrable** par type (écran Société, repères `{AAAA}`, `{MM}`, `{NNNN}`), historisé et journalisé avec l'avant et l'après ; un changement de format ne remet pas le compteur à zéro. Test : 20 émissions simultanées reçoivent 20 numéros consécutifs.
- **PDF après la validation** : la transaction de l'émission (ou du paiement) fige tout ce qu'il faut pour écrire le document (table `documents_a_produire` : données, jeton du QR code, versions des modèles) ; le PDF est produit après. S'il échoue, la facture reste émise et le document reste « PDF en attente » ; la relance le produit à l'identique (même jeton, mêmes données).
- **Paiements** : ajout seul (déclencheur), montant > 0 par l'analyseur unique, jamais sur une facture annulée ni sur un avoir, **trop-perçu refusé (H33)**, contrôlé par l'application et, en dernier recours, par la base. Chaque paiement produit un reçu REC et une nouvelle version de la facture (même numéro, version + 1, échéances et restant dû à jour, mêmes modèles que la version 1).
- **Dictionnaire** (extensions, comme D20) : `envoye_a` (objet, vide s'il est masqué), `envoye_a.nom`, `envoye_a.adresse`, `formules[].base_taxe`, `paiements[].payeur`.
- **H53, vérifié en session 5a (09/10/2026)** : `envoye_a` est bien un **objet à sous-champs** (`{ nom, adresse }`, ou vide quand « Envoyé à » est masqué : `donnees.ts`, dictionnaire `envoye_a` de type « objet » avec `envoye_a.nom` et `envoye_a.adresse`). Les trois extensions sont décrites dans l'aide intégrée « Aide à la rédaction des modèles Word », qui tient lieu de guide « rédiger un modèle Word » (CDC §16, D12) : règle du bloc `{%p if envoye_a %}`, `f.base_taxe`, `p.payeur`. H53 reste **à valider par Thierry**.

### Hypothèses de la session 4b, à faire confirmer

| # | Point | Hypothèse retenue (à faire confirmer) |
| --- | --- | --- |
| H33 | Trop-perçu | **refusé** : un paiement ne dépasse jamais le restant dû (message à l'écran, et refus de la base en dernier recours). Un excédent éventuel se traite hors du module. **Question pour la Technique** : faut-il un jour l'accepter (avoir, remboursement, report sur l'échéance suivante) ? |
| H47 | Avoir | annulation **totale** d'une facture émise (montants de la facture en négatif, `doc.facture_origine`, motif obligatoire), un seul avoir par facture. **Refusé si la facture a déjà reçu un paiement** : le sort des sommes encaissées n'est pas défini. Pas d'avoir partiel. **Questions** : avoir partiel ? que faire d'une facture déjà payée en partie ? |
| H48 | Facture d'affaire nouvelle | préparée en **brouillon après l'émission des CP**, avec les montants et l'échéancier de la police (moteur, à l'identique) ; seul « Envoyé à » se modifie. `police.date_souscription` = date de création de la police (acceptation de la cotation). Une seule facture d'affaire nouvelle non annulée par police |
| H49 | Échéances et paiements | les paiements couvrent les échéances **dans l'ordre** ; une échéance n'est « Payé » que couverte en entier. Une facture en une seule tranche n'a pas d'échéancier (`echeances` vide) ; sans paiement, `paiements` est vide (blocs conditionnels du modèle) |
| H50 | Renouvellement | du lendemain de l'échéance précédente, pour un an ; **tarif en vigueur à la nouvelle date d'effet** (version du produit et taxe) ; formules, effectifs et nombre de tranches de la période précédente, **modifiables dans le brouillon** ; accessoires du paramétrage ; aucune prime forcée reprise ; suit une facture émise (affaire nouvelle ou renouvellement précédent), un seul renouvellement en cours à la fois |
| H51 | Avenant d'incorporation | une facture par incorporation d'adhérents ; prime additionnelle **au prorata** du jour de l'incorporation à l'échéance de la période facturée qui la contient ; une unité par adhérent dans sa formule, à la prime unitaire, à la taxe et à l'arrondi de cette période ; **sans prime minimale, sans accessoires**, en une tranche. Aucun avenant pour un retrait (pas de ristourne). **Questions** : accessoires et prime minimale sur un avenant ? ristourne d'un retrait ? adhérent « Famille » = une famille ? |
| H52 | Droits sur l'avoir | niveaux du CDC §4 appliqués tels quels : Technique « Valide », Comptabilité « Oui », DG « Valide » émettent l'avoir directement, **sans circuit de validation** ; Gestionnaire et Commercial non. **Question** : « Valide » veut-il dire que l'avoir d'un autre profil doit être validé ? |
| H53 | Extensions du dictionnaire | `envoye_a` (et `.nom`, `.adresse`), `formules[].base_taxe`, `paiements[].payeur` : ajoutés pour la facture et le reçu (comme `doc.auteur_nom`, D20). **À valider par Thierry** avant le balisage des modèles de SIM |
| H54 | Reçu | un reçu par paiement : ce paiement seul, le solde après lui, la facture réglée (`doc.facture_origine`) ; payeur par défaut : le « Facturé à » ; référence obligatoire sauf en espèces ; date jamais dans le futur. `doc.auteur_nom` d'une facture, d'un avoir ou d'un reçu = l'utilisateur qui l'émet |
| H55 | PDF en attente et réédition | le modèle est choisi **avant** le numéro (sans modèle publié, aucun numéro n'est consommé) ; modèle du produit, sinon modèle commun. Une facture, un avoir ou un reçu **ne se réédite pas** depuis la recherche des documents : la facture est rééditée à chaque paiement, un PDF en attente se relance depuis la fiche de la facture |
| H56 | Seuil d'une facture | « Oui (sous seuil) » comme pour les contrats (H44) : TTC de la facture comparé **strictement** au seuil de la **version du produit dont vient le tarif** ; au-dessus, le Gestionnaire enregistre une demande « À valider » sans numéro ; un profil « Oui » (Technique, Comptabilité) autre que le demandeur émet, ce qui vaut validation ; **la DG ne valide pas** (même écart que H44) |
| H57 | Contenu obligatoire d'un modèle de facture | contrôlé **au dépôt** (comme H35) : numéro et date, `police.numero`, dates, souscripteur et son adresse, taux de taxe, taxe, TTC **avec le filtre `lettres`**, RCCM, NCC, au moins un RIB, au moins un Mobile Money, la mention de l'**article 13 du Code CIMA**, `signature_sim`, QR code. Avoir : numéro, date, facture d'origine, police, souscripteur, TTC, QR code. Le texte exact de la mention CIMA reste celui du modèle de SIM |
| H58 | T2 : tarif de test | le CDC donne les totaux, pas le tarif : il est reconstitué pour les retrouver au franc (Solo 236 453,25 × 8 = 1 891 626 ; Famille 307 389,16 × 31 = 9 529 064 ; taxe 1,5 % par ligne = 28 374 + 142 936 = 171 310 ; TTC 11 592 000 ; 4 × 2 898 000 ; sans accessoires). T3 de même : prime 270 129,11 × 163/365 = 120 633, taxe 1 809, TTC 122 442, restant dû 81 442 après 41 000. **Données inventées, sans valeur tarifaire** |
| H59 | Facture de groupe | une facture **globale** pour la police mère ; le détail par adhérent (formule, prime H45) est **toujours renvoyé en annexe**, comme pour les CP (§10.2). Les assurés de la facture d'affaire nouvelle sont ceux de la liste initiale (celle du calcul) ; ceux d'un renouvellement, la liste courante ; ceux d'un avenant, les adhérents incorporés |

## D24 — File de tâches BullMQ, import en masse, stockage indisponible (session 5a)

- **Date** : 09/10/2026. Branche `phase-5a`, créée depuis `phase-4b` (non fusionnée). Migration `20261009120000_import_masse_stockage_differe`, nommée après `20261009110000` (test de l'ordre des migrations étendu).
- **File de tâches : BullMQ, choix validé par Thierry.** Le CDC §15.1 cite « Celery/RQ + Redis » **en exemple**. BullMQ est retenu parce que les tâches ont besoin de ce qui vit **côté application** : la base (Prisma), le dictionnaire, le moteur de calcul et la logique d'émission (`emettreCertificat`, numérotation, audit, droits). Avec Celery ou RQ, les tâches tourneraient dans Python : il faudrait soit donner au générateur un accès à la base et réécrire en Python la logique d'émission (deux sources de vérité, contraire à « le moteur reste la seule source des montants » et à D4), soit faire rappeler l'application par le générateur. Redis était déjà prévu dans le Docker Compose ; seule la bibliothèque change. Le générateur reste un service sans état métier.
- **Service `travailleur`** : même image (étape `outils`) et même code `serveur/` que l'application, lancé par `npm run travailleur` (`scripts/travailleur.mts`). Deux files : `imports` (un lot à la fois) et `stockage` (reprise des écritures). Identifiants de tâche stables (`lot-N`, `ecriture-N`) : enfiler deux fois ne crée qu'une tâche. Au démarrage, il reprend les lots confirmés non terminés et les écritures en attente. `REDIS_URL` est facultative pour l'application (l'import se contrôle et se confirme, le traitement attend le travailleur) et obligatoire pour le travailleur.
- **Rejouable sans doublon** : un certificat par adhérent est garanti par la base (index unique partiel `documents_emis_certificat_par_adherent`, version 1 d'un CERTIFICAT par police et numéro d'ordre) ; une ligne déjà liée à un document n'est pas retraitée, un certificat déjà émis est rattaché au lieu d'être émis de nouveau. Testé (tâche rejouée après une interruption simulée).
- **Import en masse (CDC §13)** : fichier modèle .xlsx par produit (colonnes du dictionnaire, ligne d'exemple inventée, listes déroulantes, feuille d'aide avec les âges) ; dépôt .xlsx ou .csv (10 Mo, 5 000 lignes au plus) ; contrôle ligne par ligne **sans rien créer** (lot « Contrôlé ») ; rapport d'erreurs .xlsx (Ligne, Colonne, Valeur, Message) ; à la confirmation, les lignes valides sont **recontrôlées** contre l'état courant de la police puis incorporées en **une seule** nouvelle version de la liste ; le travailleur produit ensuite un certificat par ligne (QR, empreinte, stockage en ajout seul), puis une archive ZIP stockée et un récapitulatif (traités, en erreur, en échec, durée) au journal (`IMPORT_TERMINE`). Une erreur sur un certificat n'arrête pas le lot (§15.3) : la ligne passe « en échec », relançable. Écran : barre de progression rafraîchie toutes les 3 secondes.
- **Conversions en parallèle (T8)** : le générateur convertit jusqu'à `CONVERSIONS_SIMULTANEES` documents à la fois (2 par défaut, 1 à 16), **chacun avec son propre profil LibreOffice** (`<profil>/conversion-1..N`, prêtés par un pool) ; le travailleur traite autant de certificats à la fois.
- **Stockage indisponible (T14, adapté par D11)** : si l'écriture du PDF échoue (générateur injoignable, disque plein, erreur du serveur), le document **reste émis** ; son PDF est gardé en base (table `ecritures_differees`, « en attente d'écriture »), le journal reçoit `ECRITURE_PARTAGE_ECHEC` (CDC §15.4), l'Admin système voit un **bandeau** et l'écran « Stockage », et la file retente l'écriture via `serveur/stockage.ts` avec des **délais croissants** (30 s puis doublés, 12 essais). Réussite : ligne supprimée, `ECRITURE_REPRISE` au journal. Un fichier déjà présent avec la **même empreinte** (réponse perdue) est accepté. En attendant, le document se télécharge depuis la base (empreinte vérifiée) ; il est exclu des archives ZIP. « Relancer maintenant » (Admin) : `ECRITURE_RELANCEE`. Restent bloquants : un chemin déjà occupé par un autre fichier et une empreinte différente. Vaut pour les CP, certificats, factures, avoirs et reçus.

### Hypothèses de la session 5a, à faire confirmer

| # | Point | Hypothèse retenue (à faire confirmer) |
| --- | --- | --- |
| H60 | Colonnes du fichier d'import | les noms du dictionnaire des assurés : `numero_certificat`, `nom_prenoms`, `date_naissance`, `sexe`, `lien`, `formule` (en-têtes reconnus sans casse ni accents, avec ou sans le préfixe `assures[].`). Le **numéro du certificat** est fourni par le fichier, comme à la saisie unitaire (H37 : numéro attribué par SIM, même format que les polices, unique) |
| H61 | Champs obligatoires de l'import | numéro du certificat, nom et prénoms, **date de naissance** et **formule** (nécessaires aux contrôles d'âge et de formule exigés par le CDC §13) ; sexe et lien facultatifs. Dates : JJ/MM/AAAA, AAAA-MM-JJ ou cellule date d'Excel ; un nombre seul est refusé |
| H62 | Âges limites | **Validée par Thierry le 09/10/2026.** Âges **ajoutés au paramétrage des formules** (âge minimal et maximal, facultatifs, entiers de 0 à 120) : le CDC §13 les cite sans dire où ils sont paramétrés. Âge en **années révolues à la date d'adhésion** : pour un adhérent ajouté en cours de contrat, c'est la date d'effet de son incorporation (date saisie à l'import), **pas** la date d'effet de la police (précision de Thierry, test dédié). Sans limite paramétrée, aucun contrôle d'âge. Contrôlés à l'import seulement (pas encore à la saisie unitaire ni dans la cotation) |
| H63 | Doublon | **Tranchée par Thierry le 09/10/2026 : un doublon = même nom et même date de naissance.** C'était déjà la règle du code (vérifiée, rien à corriger) : nom et prénoms comparés sans casse, accents ni espaces superflus, **et** même date de naissance ; dans le fichier (la première ligne valide est gardée, les suivantes sont en erreur) et avec la liste courante de la police. Deux homonymes nés à des jours différents ne sont pas des doublons. À part, et ce n'est pas un doublon de personne : un numéro de certificat donné deux fois dans le fichier, ou déjà pris par une police ou un document, est en erreur (unicité du numéro, H37) |
| H64 | Pièces après un import | **Tranchée par Thierry le 09/10/2026 : pas d'émission automatique, mais deux tâches visibles.** L'import produit les certificats ; à sa confirmation, il crée sur la police deux tâches, « **Nouvelle version des CP à émettre** » et « **Facture d'avenant à émettre** » (table `taches_police`, migration `20261009130000_taches_police`), affichées sur l'écran de la cotation acceptée et sur celui des adhérents jusqu'à l'émission de la pièce (règle de fermeture : H66). Test d'intégration dans `import-masse.integration.test.ts` |
| H65 | Montant dans un import | **Tranchée par Thierry le 09/10/2026 : pas de colonne de montant.** Un import d'adhérents n'a aucune colonne de montant (pas de prime sur le certificat, H36 ; le moteur reste la seule source des montants) : le « montant ambigu » des instructions de T8 est sans objet, T8 garde ses 12 autres types d'erreur |
| H66 | Fermeture des tâches de H64 | l'état d'une tâche n'est **jamais stocké** : il est recalculé à chaque lecture depuis la base. « Nouvelle version des CP à émettre » se ferme dès qu'une version des CP **émise** reprend la liste de l'import ou une liste plus récente (une seule mise à jour des CP ferme les tâches de plusieurs imports). « Facture d'avenant à émettre » se ferme quand la facture d'avenant de **cette** version de la liste est **émise** (numéro FAC attribué) : un brouillon ou une facture « À valider » ne la ferme pas ; une facture d'avenant annulée ensuite par un avoir ne rouvre pas la tâche (l'écran des factures propose toujours de refaire l'avenant). Tâches visibles par les profils qui lisent les contrats ou les factures. **À confirmer par Thierry** |

## D26 — Valeur vide dans un filtre et refus groupé (correction de recette du 09/10/2026)

- **Date** : 09/10/2026, règle de Thierry après la recette de la 4b (défaut : « date : date absente ou illisible (None) », sans nom de champ ; même défaut avec `pct`). Numéro D26 : D24 et D25 sont pris par les branches `phase-5a` et `phase-5b`.
- **Règle** : une valeur vide (null, texte vide ou blanc) passée dans un des 6 filtres (`montant`, `lettres`, `date`, `dateheure`, `pct`, `case`) s'écrit **vide** si le champ est **facultatif** (liste de D19, envoyée par l'application avec chaque demande de PDF : `CHAMPS_FACULTATIFS` de `dictionnaire.ts`) ; sinon la génération s'arrête en **nommant le champ** par son chemin complet, rang compris : « champ obligatoire vide : « formules[0].taux_couverture » (filtre pct) ». Hors filtre, rien ne change : une valeur vide s'écrit vide (D19).
- **Précision de D19** : D19 et D22 disaient qu'un champ « saisi puis laissé vide s'écrit vide ». C'est toujours vrai hors filtre ; **dans un filtre, un champ obligatoire vide bloque désormais**, comme le demande Thierry.
- **Refus groupé à l'émission** : la fusion va jusqu'au bout du corps, des annexes et des sous-modèles avant de refuser. Le message liste d'un coup toutes les données absentes, tous les champs obligatoires vides passés dans un filtre et les sous-modèles introuvables : « Génération impossible : 3 points à corriger : … ; … ; … ». Un seul problème garde son message habituel. La génération ayant lieu avant la transaction d'émission, un refus ne consomme aucun numéro.
- **Chemins** : les éléments d'une liste sont nommés avec leur rang (`assures[1].date_naissance`, à partir de 0), y compris pour une donnée absente (avant : `assures[].date_naissance`).

## Décisions en attente

| Sujet | Qui décide | Échéance |
| --- | --- | --- |
| Nouveau dépôt dédié, ou module du dépôt portailrh | Superviseur | à fixer |
| Nom de domaine de l'application (le VPS est celui du portail RH ; variable `URL_PUBLIQUE`, D14) | Superviseur | avant la phase 6 |
| Q2 : copie des polices Microsoft (Tahoma, Calibri, Arial…) dans l'image Docker ; jamais dans un registre public (D14) | Superviseur | avant la mise en production |
| H13 à H17 (modèles Word, voir D15) | Direction Technique | avant le balisage des modèles |
| Police de remplacement de Tahoma (test D) ; puis Dockerfile et polices exigées par `/sante` (D16) | Thierry | avant la mise en production |
| H18 à H27 (émission des documents, voir D17) | Direction Technique | avant la recette |
| Durée de validité d'une cotation : confirmer « 3 mois » (D10) | Direction Technique | avant la recette |
| H2 (garanties à prime fixe et à prime calculée), H8 (options au choix), H28 (voir D18) | Direction Technique | avant la recette |
| H29 à H31 (type de contrat et taux, conflit T3, numéro de police : voir D18) ; liste des champs facultatifs (D19) | Direction Technique | avant la recette |
| Date d'entrée en vigueur des taux, à confirmer par la Technique (date provisoire du 01/01/2026, D21) | Direction Technique | avant la recette |
| H32 : branche fiscale et taux pour SECURMOTO, RELAXVOYAGE, SECURECOLTE et les autres produits hors tableau | Direction Technique | avant la recette |
| Écart avec le CDC §4.1 : validation par la Technique seule (D21) | Superviseur (à lui présenter) | avant la recette |
| H34 à H46 (contrats complets et groupes : voir D22), en particulier H44 (validation du contrat, écart DG) et H46 (`police.reference`) ; H37 et H39 sont tranchées par Thierry le 08/10/2026 | Direction Technique | avant la recette |
| H31 : les 5 chiffres du numéro de police sont-ils le numéro de l'adhérent ? | Direction Technique | avant la recette |
| Écart avec le CDC §4 : Comptabilité en « Lecture » au lieu de « Taxes (proposition) » (D21) ; écart avec le CDC §4.1 : la DG ne valide pas non plus l'émission d'un contrat (H44) ni d'une facture (H56) | Superviseur (à lui présenter) | avant la recette |
| H33 et H47 à H59 (factures, avoirs, paiements, reçus : voir D23), en particulier H33 (trop-perçu), H47 (avoir partiel, facture déjà payée), H51 (avenant), H52 (sens de « Valide » pour l'avoir) ; H45 : prime d'un membre de famille | Direction Technique | avant la recette |
| H60, H61 et H66 (import en masse : voir D24) ; H62 à H65 tranchées par Thierry le 09/10/2026, H62 (âges limites dans le paramétrage des formules) reste à présenter à la Direction Technique | Thierry, puis Direction Technique | avant la recette |

Questions **réglées le 05/10/2026** : Q1 (VPS du portail, domaine à définir), Q3 (plus de dossier partagé : D11), Q4 (`assures[].sexe` ajouté : D12), Q5 (Thierry balise d'abord, puis la Technique : D12), H6 (validité en mois : D10).
