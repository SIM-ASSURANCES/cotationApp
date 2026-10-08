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
| H21 | Droits sur les documents émis (lecture, émission, réédition) | selon le type : cotation ← « Créer une cotation » ; CP ← « Émettre un contrat » (le « sous seuil » du Gestionnaire n'est pas encore contrôlé) ; facture, avis, relance ← « Émettre une facture » ; avoir et annulation ← « Émettre un avoir » ; reçu ← « Enregistrer un paiement » |
| H22 | Où sont les fichiers | sur le volume du générateur ; l'application y accède par ses routes internes (écriture, lecture, ZIP) |
| H23 | Émission du PDF d'une cotation | automatique après l'émission ; si elle échoue (modèle non publié, générateur arrêté…), la cotation reste émise et le bouton « Émettre le PDF » permet de recommencer. Le PDF d'une cotation ne joint pas les CG (seulement les CP) |
| H24 | Réédition | images (signature, cachet) : celles en vigueur le jour de la réédition (elles ne sont pas conservées avec le document) ; filigrane « EXPIRÉE » si la cotation a expiré, « ANNULÉ » si le document a été annulé par un avoir |
| H25 | Statut « Expiré » de la page de vérification | selon la fin de validité enregistrée à l'émission |
| H26 | Plusieurs modèles de CP pour un même produit (H16 les permet) | l'émission prend le plus ancien qui a une version en vigueur : un critère de choix (individuel, famille, groupe…) reste à définir |
| H27 | Limite de la page de vérification | 30 requêtes par minute et par adresse IP, en mémoire du serveur (une seule instance) |
H28 – Accessoires et prorata
Retenu : quand un contrat dure moins d'un an, la prime nette est proratisée (par exemple × 163/365), mais les accessoires restent entiers. Exemple, formule Solo du 22/07 au 31/12/2026 : prime nette de 280 744 ramenée à 125 373, accessoires maintenus à 3 000.
Question : les accessoires (frais de gestion de police) sont-ils un montant fixe par contrat, ou doivent-ils eux aussi être proratisés à la durée ?
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
| Format du numéro de police (provisoire : POL-AAAA-NNNNNN) | Direction Technique | avant la recette |
| H1 à H5 (moteur de calcul, voir D9) et H7 à H12 (cotation, voir D13) | Direction Technique | avant la recette |

Questions **réglées le 05/10/2026** : Q1 (VPS du portail, domaine à définir), Q3 (plus de dossier partagé : D11), Q4 (`assures[].sexe` ajouté : D12), Q5 (Thierry balise d'abord, puis la Technique : D12), H6 (validité en mois : D10).
