# Recette

Consigne ce qui a été vérifié, comment, et ce qui reste à vérifier. Seuls les résultats **réellement obtenus** y figurent ; ce qui n'a pas été exécuté est marqué « non exécuté ».

## 1. Test de fidélité du rendu PDF (CDC §15.3)

Objectif : le PDF produit par LibreOffice reproduit la mise en page du PDF exporté par Word (nombre de pages, sauts de page, polices).

Outil : `generateur/scripts/test_fidelite.py` (voir son en-tête pour l'usage). Il convertit le .docx avec la même fonction que le service (`app/conversion.py`) et le compare au PDF Word.

### 1.1 Windows, poste de développement : exécuté le 05/10/2026

| Élément | Valeur |
| --- | --- |
| Document | CP RELAXSANTE rempli avec des données inventées (hors dépôt) |
| LibreOffice | 26.8.0.3, polices Microsoft installées sur le poste |
| Résultat | **13 pages dans Word, 13 pages dans LibreOffice ; fin de page identique sur les 13 ; texte identique à 100 % page par page** |
| Polices du PDF Word | ArialMT, Calibri, SegoeUISymbol, SymbolMT, Tahoma, Tahoma-Bold |
| Polices du PDF LibreOffice | Calibri, OpenSymbol, SymbolMT, Tahoma, Tahoma-Bold |
| Substituées | ArialMT et SegoeUISymbol absentes du PDF LibreOffice (probablement remplacées par des polices voisines : sans effet sur la pagination ici) |

Ce résultat sert de **référence** : avec les polices d'origine, LibreOffice est fidèle sur ce modèle.

### 1.2 Linux dans le conteneur : exécuté le 06/10/2026

Mêmes fichiers qu'en 1.1 (le CP rempli de données inventées et son PDF exporté par Word, hors dépôt). Docker 29.7.2 sur Docker Desktop. Commandes :

```powershell
docker compose build generateur
docker compose run --rm -v ${PWD}/essais:/essais generateur python scripts/test_fidelite.py --modele /essais/CP_test.docx --reference /essais/CP_test_word.pdf
```

Image : `python:3.14-slim-trixie` + **LibreOffice 25.2.3.2** (paquet Debian `libreoffice-writer-nogui`), à comparer au 26.8.0.3 du poste Windows (§1.1). Polices libres de l'image : Carlito, Liberation, DejaVu.

- **A, sans polices Microsoft** : dossier `generateur/polices/` vidé (README seul), image reconstruite. Cas le plus défavorable.
- **B, avec polices Microsoft** : les 21 fichiers de `generateur/polices/` (dont Tahoma, Calibri, Symbol, Segoe UI Symbol, Arial).
- **C, paquets Debian à la place du dossier `polices/`** (06/10/2026) : image sans `generateur/polices/`, avec `ttf-mscorefonts-installer` (dépôt *contrib*, licence acceptée au build par `debconf-set-selections`, polices téléchargées depuis SourceForge pendant la construction), `fonts-crosextra-carlito` et `fonts-wine`. Dockerfile d'essai hors dépôt. Polices obtenues : Arial, Times New Roman, Verdana, Georgia, Trebuchet MS, Courier New, Comic Sans MS, Impact, Webdings, Andale Mono, Arial Black ; **ni Calibri, ni Tahoma** (absentes de ttf-mscorefonts-installer). `fonts-wine` installe Tahoma, Symbol et Wingdings dans `/usr/share/wine/fonts`, **dossier que fontconfig ne lit pas** : `fc-match Tahoma` donne DejaVu Sans.
- **C′ = C + le dossier de Wine déclaré à fontconfig** (fichier `/etc/fonts/conf.d/50-wine.conf`) : les Tahoma et Tahoma Bold de Wine deviennent visibles (`fc-match Tahoma` → `tahoma.ttf`).

Mots par page comptés avec `pdftotext` (poppler) sur chaque PDF, polices lues avec `pdffonts`.

| | Word (référence) | A : sans polices | B : avec polices | C : paquets Debian | C′ : C + Tahoma de Wine |
| --- | --- | --- | --- | --- | --- |
| Pages | 13 | 13 | 13 | 13 | 13 |
| Mots par page (1 à 13) | 240 · 505 · 418 · 258 · 43 · 165 · 27 · 519 · 413 · 375 · 184 · 124 · 303 | 240 · 505 · 416 · 258 · 43 · 165 · 27 · **501 · 408 · 351 · 238 · 126** · 303 | 240 · 505 · **417** · 258 · 43 · 165 · 27 · 519 · 413 · 375 · 184 · 124 · 303 | 240 · 505 · **416** · 258 · 43 · 165 · 27 · **501 · 408 · 351 · 238 · 126** · 303 (comme A) | **348 · 548 · 422 · 104** · 43 · 165 · 27 · **586 · 461 · 432 · 12** · 124 · 303 |
| Fins de page identiques à Word (`test_fidelite.py`) | n/a | **10 sur 13** : pages 8, 9, 10 décalées (ressemblance du texte 98 %, 94 %, 89 %) ; code de sortie 1 | **13 sur 13**, texte identique à 100 % page par page ; code de sortie 0 | **10 sur 13** : pages 8, 9, 10 décalées, exactement comme A ; code de sortie 1 | **8 sur 13** : pages 2, 3, 8, 9, 10 décalées ; ressemblance du texte jusqu'à 13 % (page 11) ; code de sortie 1 |
| Polices du PDF (`pdffonts`) | Calibri, Tahoma, Tahoma-Bold, ArialMT, SymbolMT, SegoeUISymbol | Carlito-Regular, DejaVuSans, DejaVuSans-Bold, OpenSymbol | Calibri, Tahoma, Tahoma-Bold, SymbolMT, DejaVuSans | Carlito-Regular, DejaVuSans, DejaVuSans-Bold, OpenSymbol (comme A) | Carlito-Regular, WineTahoma, WineTahomaBold, Webdings, DejaVuSans |

Lecture :

- **B reproduit la pagination de Word** : mêmes pages, mêmes fins de page, mêmes polices Calibri, Tahoma, Tahoma-Bold et SymbolMT. L'écart de 1 mot à la page 3 (417 contre 418) est un écart de comptage du texte extrait ; le test de fidélité y trouve un texte identique à 100 % et une fin de page identique. Non expliqué plus avant.
- **A garde le même nombre de pages mais décale du texte** : 18 mots de la page 8 passent sur les suivantes, et la page 11 en reçoit 54 de trop (238 au lieu de 184). Le nombre de pages seul ne suffit donc pas à juger la fidélité : il faut comparer les fins de page. Aucune police d'origine n'est présente dans le PDF (Calibri devient Carlito ; Tahoma, absent, devient DejaVu Sans, plus large).
- **Arial et Segoe UI Symbol** : présents dans l'image en B, mais absents du PDF LibreOffice, comme sur le poste Windows en 1.1 (la police réellement utilisée à leur place n'a pas été identifiée ; DejaVu Sans figure dans le PDF). Sans effet sur la pagination de ce modèle ; à surveiller si un autre modèle en dépend davantage.
- **C ne change rien par rapport à A** : ce modèle utilise Calibri et Tahoma, que `ttf-mscorefonts-installer` ne fournit pas ; les polices qu'il apporte (Arial, Times…) n'apparaissent pas dans le PDF. Et `fonts-wine` est sans effet tant que fontconfig ne lit pas son dossier.
- **C′ est pire que A** : la Tahoma de Wine n'a pas les dimensions de celle de Microsoft : plus de texte tient sur chaque page, le texte remonte dès la page 1 (348 mots au lieu de 240) et 5 fins de page sont décalées. Des symboles sont en outre pris dans Webdings, police de pictogrammes : ils sont probablement faux (non vérifié à l'œil).
- **Conséquence pour le VPS** : les polices Tahoma et Calibri doivent être présentes dans l'image pour garder la pagination de Word. Elles ne sont pas versionnées (licence, question Q2 au superviseur) : le déploiement les copie à la main dans `generateur/polices/`. Les paquets Debian (variante C) ne sont **pas** une alternative pour ces modèles : ils ne fournissent ni Calibri, ni Tahoma.

Limite : un seul modèle (CP RELAXSANTE) a été testé. Les autres modèles Word (facture, avenants, CG) restent à passer au test : outils prêts (`generateur/scripts/exporter_word.ps1` et `test_fidelite_lot.py`, essayés sur ce seul modèle) et déroulement dans [plan-test-modeles.md](plan-test-modeles.md). Lot complet : non exécuté.

## 2. Phase 0 : socle, connexion, droits, audit

| Vérification | Comment | Résultat |
| --- | --- | --- |
| Tests unitaires de l'application (domaine, configuration, conformité du tableau des droits au CDC §4) | `npm test` | 26 verts |
| Tests d'intégration (base PostgreSQL réelle) : journal en ajout seul, verrouillage, comptes désactivés, droits, mot de passe | `npm run test:integration` | 15 verts ; 2 protections affaiblies volontairement ont fait échouer les tests (puis restaurées) |
| Tests du générateur (dont conversion avec le vrai LibreOffice) | `pytest` | 15 verts |
| Types et lint (dont règles de couches et accès au journal) | `npm run typecheck`, `npm run lint` | sans erreur |
| Parcours HTTP réel : redirections, 401 des routes `/api`, droits par profil, mot de passe provisoire, redirection ouverte, cookie HttpOnly, en-têtes de sécurité | script de parcours, 21 contrôles | 21 sur 21, en développement **et** sur la version de production (`npm start`) |
| `docker compose build` puis `docker compose up -d` : les 4 services démarrent | Docker 29.7.2, 06/10/2026, `.env` racine avec secrets aléatoires jetables | **vert** : postgres, redis, generateur et app « healthy » ; l'étape `outils` applique les 5 migrations puis se termine (code 0) |
| `/api/sante` dans le conteneur | `GET http://127.0.0.1:3000/api/sante` | `{"statut":"ok","base":"ok","generateur":"ok"}` (vérifié aussi après la reconstruction de l'image du générateur) |
| Connexion fonctionnelle derrière un proxy HTTPS | | **non exécuté** |

## 2 bis. Phase 1 : paramétrage et moteur de calcul

| Vérification | Comment | Résultat |
| --- | --- | --- |
| Moteur pur (domaine) : T1, T3, échéancier, accessoires, assiette, frais, prime minimale, refus d'entrées invalides | `npm test` | 84 verts au total (dont 48 pour le moteur) |
| Invariants sur **72 règles d'arrondi × 40 cotations aléatoires** : TTC = nette + accessoires + taxe après arrondi, montants multiples de la précision, total cohérent | idem | vert |
| Échéancier : somme des tranches = TTC sur **1 000 cas aléatoires** (précision 1, 10, 100, 1 000 ; 3 sens ; 1 à 12 tranches) | idem | vert (a révélé un défaut : 100/3 × 3 ≠ 100 en décimal, corrigé) |
| T1, T3, historisation par date d'effet, droits, déclencheurs de l'historique, via la **base** | `npm run test:integration` | 30 verts |
| Mutations : bornes du prorata (162 jours) et arrondi « inférieur » au lieu de « plus proche » | à la main, puis code restauré | détectées (13 tests en échec pour la première, plusieurs pour la seconde) |
| Écrans (taxes, produits, calcul) : T1 et T3 affichés, erreurs, droits par profil | parcours HTTP, 23 contrôles | 23 sur 23 |
| Montant en lettres (CDC §8.6), côté générateur : 11 592 000 → « onze millions cinq cent quatre-vingt-douze mille francs CFA » | `pytest` | 38 verts au total |
| Versions épinglées (Auth.js, Next, Prisma, decimal.js) | test dans `npm test` | vert ; échoue si une version devient une plage |

## 2 ter. Phase 2 : cotation

| Vérification | Comment | Résultat |
| --- | --- | --- |
| Règles pures : statuts, expiration (dernier jour valable), forçage, raisons de validation, valideur ≠ auteur, numérotation, saisie (sexe compris) | `npm test` | 110 verts au total |
| Cotation de bout en bout via la base : T1, T11, T13, figement, acceptation en police, refus, droits, journal | `npm run test:integration` | 57 verts au total (27 pour la cotation) |
| Numérotation sans trou : 8 émissions simultanées = 8 numéros consécutifs ; une transaction annulée ne laisse aucun trou | idem | vert |
| Mutations (code cassé volontairement, puis restauré) : « l'auteur peut valider », « plus de contrôle d'expiration », « compteur hors transaction » | à la main | chacune détectée par 2 tests |
| Écrans : en soumettant les **vrais formulaires** (champs `$ACTION_*`, comme un navigateur sans JavaScript) : création, soumission, émission, acceptation → police, forçage → validation par un autre profil, refus avec motif, modification, erreurs de saisie, droits par profil, filigrane | parcours HTTP, 28 contrôles | 28 sur 28 |
| Non vérifié | | le comportement JavaScript côté navigateur (ajout et retrait de lignes d'assurés et de risque) et le rendu visuel : pas de navigateur piloté dans cette session |

## 2 quater. Phase 3a : modèles Word, contrôles au dépôt, fusion, conversion (06/10/2026)

| Vérification | Comment | Résultat |
| --- | --- | --- |
| `/sante` du générateur : « dégradé » si Tahoma ou Calibri manque (`fc-list`), ou si la liste des polices est impossible | `pytest` (polices simulées) ; puis l'image réelle | 6 tests verts ; image avec les polices : `{"statut":"ok", "polices_manquantes":[]}` et `/api/sante` ok |
| Filtres `montant`, `lettres`, `date`, `dateheure`, `pct`, `case` : rendus, refus (flottant, date sans heure, `case` sur autre chose qu'un booléen), jamais d'espace ordinaire dans un montant | `pytest` (`test_filtres.py`) | verts |
| Analyse au dépôt : données lues et emplacement (corps, en-tête, cellule de tableau), balise coupée que docxtpl ne recolle pas, balise non fermée, blocs if/for mal fermés ou croisés, filtre inconnu, `default`, calcul, `set`, appels, attributs « _ », champ Word (Ctrl+F9), `case` sans parenthèses, guillemets de Word, polices | `pytest` (`test_analyse.py`), modèles de test produits par python-docx | 19 verts |
| Décision au dépôt (dictionnaire, champs Word, sans balise, CG/CS, facture, avertissements polices et marqueurs) ; dictionnaire (noms, exemples, données fictives sans nom inventé) ; cycle de vie et version en vigueur | `npm test` (`documents.test.ts`) | 27 verts (137 au total) |
| Fusion : donnée absente nommée par son chemin (« souscripteur.prenoms », « assures[].date_naissance »), null écrit vide, échappement de « & » et « < », bac à sable, sous-modèle `bloc()`, image, listes longues (tableau, paragraphes, boucle en ligne refusée, sans modèle d'annexe refusée, seuil paramétrable) | `pytest` (`test_fusion.py`) | 15 verts |
| Un modèle de test avec **chaque filtre** produit un PDF dans le conteneur ; le rendu de chaque filtre est vérifié dans le **texte extrait du PDF** | `pytest` dans le conteneur (`test_generation.py`) | vert. Sous Windows, ce test est sauté : pypdf lit mal le texte accentué des PDF du LibreOffice Windows 26.8 (« à » lu « a! »), alors que `pdftotext` lit correctement ces mêmes PDF |
| **Contrôle visuel des cases ☒ ☐** dans le conteneur (PDF converti en image) | modèle de test : cases dans un texte en Calibri, puis en MS Gothic (comme les modèles actuels) | **correct** dans les deux cas. En Calibri, qui n'a pas ces caractères, LibreOffice les dessine avec DejaVu Sans ; en MS Gothic, avec MS Gothic (`pdffonts`). Choix du séparateur de milliers : U+00A0, car U+202F manque dans Arial Narrow et MS Gothic (`fc-list ':charset=202f'`) |
| Rendu d'un CP de test complet (25 assurés, sous-modèle, annexe, images) dans le conteneur | PDF converti en image et relu | renvoi « Voir annexe – Liste des assurés (25 personnes) » sur toute la largeur du tableau ; tableau de garanties inséré par formule ; page 2 : annexe des 25 assurés |
| Bibliothèque via la **base** (générateur simulé) : droits, refus de dépôt non enregistré et journalisé, empreinte, numérotation, soumission par l'auteur, publication par la DG, renvoi, date future, CG converties **une seule fois**, aperçu, seuil historisé | `npm run test:integration` (`modeles.integration.test.ts`) | 12 verts (69 au total) |
| Déclencheurs : version jamais modifiée ni supprimée, cycle imposé, publication par l'auteur refusée **par la base**, modèle jamais supprimé | idem, en SQL direct | verts |
| **Bout en bout** : vraie base de test **et** vrai générateur, avec les modèles de test de `generateur/tests/fixtures/` | `npm run test:e2e` (générateur lancé) | 4 verts : T9, champ Word, aperçu et T7, CG publiée en PDF |
| Écrans, version de production (`npm start`), en soumettant les **vrais formulaires** (fichiers compris) : droits par profil, aide, création, T9 et champ Word refusés avec emplacement, fichier de 3 Mo transmis (limite de 1 Mo des Server Actions levée), dépôt, téléchargement identique, 401/403, aperçus (refus expliqués sans annexe ni sous-modèle), annexe publiée par les écrans puis T7, soumission, publication (date passée refusée), seuil | parcours HTTP, 35 contrôles | 35 sur 35 |
| Image Docker reconstruite : migration `modeles` appliquée par `outils`, 4 services « healthy », `/api/sante` ok | `docker compose build`, `up -d` | vert |
| Mutations : « tout nom est connu du dictionnaire » ; « plus de contrôle des balises coupées » | à la main, puis code restauré | détectées (3 tests, puis 1) |
| Non vérifié | | le rendu dans un vrai navigateur (pas de navigateur piloté) ; les **vrais** modèles de SIM (ils ne sont pas réunis : voir plan-test-modeles.md) ; l'ouverture dans Word d'un document dont une liste est passée en annexe (la ligne de renvoi est construite par le générateur ; LibreOffice l'affiche correctement) |

## 2 quinquies. Phase 3b : émission, assemblage, QR code, archivage (06/10/2026)

| Vérification | Comment | Résultat |
| --- | --- | --- |
| Champs obligatoires des CP, cotations et reçus (D16) : numéro, souscripteur (physique ou moral), dates d'effet et d'échéance, prime TTC ; reçu : montant et facture | `npm test` | verts (145 tests unitaires au total) |
| Règles de l'émission : souscripteur masqué, chemin de stockage, statut public (valide, expiré, « Annulée – avoir AV-… »), contrôle des visas, données T1 dans les noms du dictionnaire, paramètres de la société, limite de requêtes | `npm test` (`emission.test.ts`, `limite.test.ts`) | verts |
| Générateur : QR code, filigrane sur chaque page, assemblage dans l'ordre, stockage en ajout seul (refus d'écraser, chemins douteux refusés, fichier en lecture seule, ZIP), routes de stockage | `pytest` (`test_pdf_stockage.py`) | 13 verts (136 au total dans le conteneur) |
| **Cotation T1 complète dans le conteneur** : modèle de test, montants, QR code, CG jointes à la fin, filigrane | `pytest` dans le conteneur (`test_generation.py`) | vert |
| Émission via la **base** (générateur simulé, stockage en mémoire) : T1, T10, T11, T12, CP assemblées avec les CG et refus si visa incohérent ou CG absentes, déclencheurs (ajout seul), droits par type, recherche, ZIP, fichier altéré refusé au téléchargement | `npm run test:integration` (`documents.integration.test.ts`) | 7 verts (76 au total) |
| **Bout en bout** : vraie base, vrai générateur, vrai stockage : cotation T1 émise, PDF stocké et relu (empreinte), page de vérification, réédition en v2 sans toucher la v1 | `npm run test:e2e` (générateur lancé) | 5 verts au total |
| **Recette T1 sur la pile Docker** (app, générateur, base ; écrans) : modèle de cotation déposé (Technique) et publié (DG), cotation soumise par le Commercial → émise → **PDF émis aussitôt**, téléchargé, recherche dans « Documents émis », réédition | parcours HTTP + `pdftotext`, `zbarimg` (conteneur jetable) | **montants identiques à T1** (Solo 280 744 / 4 256 / 288 000 ; Famille 15 159 458 / 230 542 / 15 600 000 ; total 15 888 000, en lettres) ; **QR code lisible** : il donne `http://127.0.0.1:3000/verif/<jeton>` ; **page /verif** : « Valide », Cotation COT-2026-10-0001, produit, souscripteur « K****** A. » (nom en clair absent), **empreinte affichée = SHA-256 du PDF téléchargé** ; jeton inconnu : page neutre ; 35 requêtes d'une même adresse : 30 acceptées puis 429 |
| Non vérifié | | ouverture des PDF dans un vrai navigateur ; émission des CP **par les écrans** (testée par la base et le service) ; écrans « Société » et références contractuelles du produit (types et lint seulement) ; les messages affichés après la soumission d'une cotation disparaissent avec son formulaire (le nouveau statut et la liste des PDF en tiennent lieu) |

## 2 sexies. Phase 4a : contrats complets et groupes (08/10/2026)

| Vérification | Comment | Résultat |
| --- | --- | --- |
| Compléments du souscripteur, bénéficiaires (somme 100 % en décimal exact), contacts d'urgence, incorporation, retrait, date d'adhésion | `npm test` (`saisie-4a.test.ts`) | verts (240 au total après les corrections du 08/10/2026) |
| Saisies de bout en bout dans la base : compléments recopiés dans la police, « jamais fournis » (`null`) distinct de « saisis vides » (`[]`), cotation figée protégée par la base ; groupe : annexe imposée, nouvelles versions de la liste et des CP, numéros jamais réutilisés, réédition à l'identique, certificat d'adhésion | `npm run test:integration` (`contrats-4a`, `groupes`) | 18 tests verts (129 au total après les corrections) |
| CP SECURVIE (T5), CP VOL (T6), police mère en annexe, certificat, `listes_en_annexe` inconnue refusée (422), rendu PDF | `pytest` (`test_contrats_4a.py`, `test_fusion.py`) | verts (162 au total) |
| **Bout en bout** : vraie base, vrai générateur, vrai stockage ; T5 émis et relu, refus de l'IARD, T6 rendu avec deux dates d'émission | `npm run test:e2e` (générateur lancé) | 8 verts au total |
| **Corrections du 08/10/2026** : droits par défaut = tableau du CDC §4 (code et base, cellule par cellule), « Proposition » retiré, validation de la cotation indépendante de « Forcer une prime », émission d'un contrat sous seuil (demande « À valider », validation par un autre profil « Oui », séparation des tâches, seuil strict, contraintes de la base), `assures[].prime` du moteur, durée en années, mois ou jours | `npm test`, `npm run test:integration` (`droits-defauts`, `validation-contrat`, `cotations`, `groupes`) | verts |
| Non vérifié | | écrans de saisie des compléments et des adhérents dans un navigateur ; ouverture des PDF dans un vrai lecteur ; rendu sous Windows |

## 3. Cas de test du CDC (§16.1)

| N° | Cas | État |
| --- | --- | --- |
| T1 | Cotation santé BENI (2 formules) | **montants VERTS (phase 1)** : Solo HT 280 744 / taxe 4 256 / TTC 288 000 ; Famille HT 15 159 458 / taxe 230 542 / TTC 15 600 000 ; total 15 888 000 ; TTC par personne 96 000 et par famille 260 000. Vérifiés en test unitaire, de bout en bout via la base, et à l'écran. **Validité « date + 3 mois » VERTE (phase 2)** : émise le jour J, la cotation est valide jusqu'à J + 3 mois (durée paramétrable par produit, D10). Le PDF de la cotation arrive en phase 3. |
| T2 | Facture groupe CGE-SN | **VERT (phase 4b)** : HT 11 420 690, taxe 171 310, TTC 11 592 000, 4 échéances de 2 898 000 « Non payé », numéro de police présent, TTC en lettres (« onze millions cinq cent quatre-vingt-douze mille francs CFA »), détail par adhérent en annexe. Tarif de test reconstitué (H58). Testé en intégration (`factures.integration.test.ts`), au niveau du .docx (`test_factures_4b.py`) et de bout en bout, PDF relu par `pdftotext` (`factures.e2e.test.ts`). |
| T3 | Facture individuelle YAO (prorata) | **calcul VERT (phase 1)** : 163 jours, coefficient 0,44658, taxe de 1,5 % sur 120 633 = **1 809,495** exactement (1 809,50 à deux décimales, 1 809 au franc), jamais 2 292. **Facture, paiement et reçu VERTS (phase 4b)** : facture HT 120 633, taxe 1 809, TTC 122 442 ; paiement de 41 000 → reçu REC, restant dû 81 442, facture rééditée en v2 (même numéro, mêmes modèles) ; trop-perçu refusé (H33). Intégration et bout en bout. |
| T4 | Correction de facture (avoir) | **VERT (phase 4b)** : une facture émise ne se modifie ni ne se supprime, même en SQL direct (déclencheur) ; avoir AV aux montants négatifs avec la facture d'origine ; la facture devient « Annulée – avoir AV-… » sur sa page de vérification ; nouvelle facture liée à celle qu'elle remplace, au numéro suivant, sans trou ; 20 émissions simultanées reçoivent 20 numéros consécutifs. Intégration et bout en bout. |
| T5 | SECURVIE avec 3 bénéficiaires | **VERT (phase 4a)** : 3 bénéficiaires (50/30/20 %) dans un tableau répété ; garanties issues du sous-modèle de la formule ; visa `MFB/DGTCP/DA/N° 01497` identique dans le CP et dans les CG jointes (l'émission est refusée si les visas diffèrent) ; branche `DECES` : taxe 0 %, TTC 105 000. Testé au niveau du .docx et du PDF (`test_contrats_4a.py`) et de bout en bout, PDF stocké relu par `pdftotext` (`contrats-4a.e2e.test.ts`). |
| T6 | CP VOL, cases à cocher | **VERT pour le document (phase 4a)** : capital vol caisse 100 000, gardiennage de nuit, locataire → une seule case cochée par ligne, les autres vides ; une valeur hors liste ne coche rien ; la date d'émission suit le jour d'émission. **Document seul, montants de fixture** (taux de 10 % inventé) : l'IARD est refusé par le moteur de calcul tant que H32 n'est pas tranchée, ce que le test de bout en bout vérifie aussi (H43). |
| T7 | Liste de plus de 10 assurés | **VERT (phase 3a)** : 25 assurés, seuil 10 → le corps affiche « Voir annexe – Liste des assurés (25 personnes) » et l'annexe complète est à la fin du PDF. Testé au niveau du .docx (`test_fusion.py`), du PDF dans le conteneur (`test_generation.py`), de bout en bout (`npm run test:e2e`) et par les écrans (aperçu à 25 assurés). Seuil paramétrable (historisé). Reste avec l'émission : les autres listes (bénéficiaires…) sur un vrai document. |
| T8 | Génération en masse | **VERT (session 5a, 09/10/2026)** : fichier de 500 adhérents **généré par le test** (noms inventés), dont 12 lignes portant chacune une erreur d'un type différent (champ obligatoire vide, date impossible, date future, sexe invalide, formule inconnue, formule non retenue, âge sous le minimum, âge au-dessus du maximum, doublon dans le fichier, doublon avec un adhérent existant, numéro hors format, numéro donné deux fois). Résultat : rapport de **12 lignes** (une par erreur, dans la bonne colonne), **488 certificats** distincts (numéro, jeton du QR code et empreinte uniques, PDF relu par `pdftotext`), une seule nouvelle version de la liste (490 adhérents), archive ZIP de 488 PDF, récapitulatif au journal. **Durée : 312 s (5 min 12 s)** de la confirmation à la fin du lot, pour une limite de 15 minutes. Conteneur Linux à **4 processeurs**, LibreOffice 24.2, `CONVERSIONS_SIMULTANEES=2`, générateur, base, Redis et travailleur sur la même machine (`import-masse.e2e.test.ts`). Pour comparaison, avec une seule conversion à la fois (générateur d'avant la 5a) : 567 s. À mesurer de nouveau sur le VPS. |
| T9 | Modèle avec balise inconnue | **VERT (phase 3a)** : le dépôt d'un .docx contenant `{{ client.nom }}` est refusé avec « Balise inconnue « client.nom » … — corps, tableau 1, ligne 2, colonne 1 : « {{ client.nom }} » » ; rien n'est enregistré, le refus est journalisé. Testé dans l'analyse (`pytest`), la décision (`npm test`), la base (`test:integration`), de bout en bout (`test:e2e`) et par l'écran. |
| T10 | Régénération historique | **VERT (phase 3b)** : une cotation émise avec le modèle v1 ; la v1 passe en 2020, une v2 est publiée et en vigueur ; la réédition utilise **la v1** et les données d'origine (même prime, même souscripteur), avec un nouveau fichier et un nouveau jeton ; une nouvelle cotation, elle, prend la v2 (`documents.integration.test.ts`). |
| T11 | Cotation expirée | **VERT (phase 2)** : statut « Expirée » le lendemain de la fin de validité, drapeau de filigrane « EXPIRÉE », transformation en police impossible, et impossible même en SQL direct (déclencheur). **Filigrane VERT (phase 3b)** : la réédition d'une cotation expirée porte « EXPIRÉE » sur chaque page (test d'intégration ; texte du PDF vérifié dans le conteneur). |
| T12 | QR code | **VERT (phase 3b)** : une facture annulée par un avoir affiche « Annulée – avoir AV-2026-10-0001 » sur la page de vérification, pour toutes ses versions ; l'annulation exige le droit « Émettre un avoir » et ne se fait qu'une fois. Depuis la 4b, vérifié aussi avec une vraie facture et un vrai avoir (T4). QR code lisible et page /verif vérifiés sur une cotation T1 dans la pile Docker. |
| T13 | Double validation | **VERT (phase 2)** : prime forcée par un commercial → « À valider », sans numéro ; l'auteur ne peut pas valider (refusé par le service, bouton absent à l'écran), même s'il est Technique ; un autre valideur (Technique ou DG) valide et la cotation est émise. Le motif est obligatoire dès le moindre écart. |
| T14 | **Stockage indisponible à l'émission** (redéfini par D11 : plus de dossier partagé) | **VERT (session 5a, 09/10/2026)** : stockage simulé en panne → le certificat est **émis** (numéro, jeton, empreinte), son PDF attend en base (« en attente d'écriture »), `ECRITURE_PARTAGE_ECHEC` au journal, bandeau pour l'Admin système seulement ; le document se télécharge depuis la base (empreinte vérifiée) mais reste hors des archives ZIP ; la file BullMQ retente avec des délais croissants (essais en échec comptés) ; au retour du stockage, le fichier est écrit avec la même empreinte, la ligne d'attente disparaît, `ECRITURE_REPRISE` au journal, plus d'alerte. Aussi testés : import en masse pendant la panne, « Relancer maintenant », fichier déjà écrit dont la réponse s'était perdue (`import-masse.integration.test.ts`, vrai Redis et vrai travailleur). |
