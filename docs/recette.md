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

Mots par page comptés avec `pdftotext` (poppler) sur les trois PDF, polices lues avec `pdffonts`.

| | Word (référence) | A : sans polices | B : avec polices |
| --- | --- | --- | --- |
| Pages | 13 | 13 | 13 |
| Mots par page (1 à 13) | 240 · 505 · 418 · 258 · 43 · 165 · 27 · 519 · 413 · 375 · 184 · 124 · 303 | 240 · 505 · 416 · 258 · 43 · 165 · 27 · **501 · 408 · 351 · 238 · 126** · 303 | 240 · 505 · **417** · 258 · 43 · 165 · 27 · 519 · 413 · 375 · 184 · 124 · 303 |
| Fins de page identiques à Word (`test_fidelite.py`) | n/a | **10 sur 13** : pages 8, 9, 10 décalées (ressemblance du texte 98 %, 94 %, 89 %) ; code de sortie 1 | **13 sur 13**, texte identique à 100 % page par page ; code de sortie 0 |
| Polices du PDF (`pdffonts`) | Calibri, Tahoma, Tahoma-Bold, ArialMT, SymbolMT, SegoeUISymbol | Carlito-Regular, DejaVuSans, DejaVuSans-Bold, OpenSymbol | Calibri, Tahoma, Tahoma-Bold, SymbolMT, DejaVuSans |

Lecture :

- **B reproduit la pagination de Word** : mêmes pages, mêmes fins de page, mêmes polices Calibri, Tahoma, Tahoma-Bold et SymbolMT. L'écart de 1 mot à la page 3 (417 contre 418) est un écart de comptage du texte extrait ; le test de fidélité y trouve un texte identique à 100 % et une fin de page identique. Non expliqué plus avant.
- **A garde le même nombre de pages mais décale du texte** : 18 mots de la page 8 passent sur les suivantes, et la page 11 en reçoit 54 de trop (238 au lieu de 184). Le nombre de pages seul ne suffit donc pas à juger la fidélité : il faut comparer les fins de page. Aucune police d'origine n'est présente dans le PDF (Calibri devient Carlito ; Tahoma, absent, devient DejaVu Sans, plus large).
- **Arial et Segoe UI Symbol** : présents dans l'image en B, mais absents du PDF LibreOffice, comme sur le poste Windows en 1.1 (la police réellement utilisée à leur place n'a pas été identifiée ; DejaVu Sans figure dans le PDF). Sans effet sur la pagination de ce modèle ; à surveiller si un autre modèle en dépend davantage.
- **Conséquence pour le VPS** : les polices Tahoma et Calibri doivent être présentes dans l'image pour garder la pagination de Word. Elles ne sont pas versionnées (licence, question Q2 au superviseur) : le déploiement les copie à la main dans `generateur/polices/`.

Limite : un seul modèle (CP RELAXSANTE) a été testé. Les autres modèles Word (facture, avenants, CG) restent à passer au test à mesure qu'ils arrivent.

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

## 3. Cas de test du CDC (§16.1)

| N° | Cas | État |
| --- | --- | --- |
| T1 | Cotation santé BENI (2 formules) | **montants VERTS (phase 1)** : Solo HT 280 744 / taxe 4 256 / TTC 288 000 ; Famille HT 15 159 458 / taxe 230 542 / TTC 15 600 000 ; total 15 888 000 ; TTC par personne 96 000 et par famille 260 000. Vérifiés en test unitaire, de bout en bout via la base, et à l'écran. **Validité « date + 3 mois » VERTE (phase 2)** : émise le jour J, la cotation est valide jusqu'à J + 3 mois (durée paramétrable par produit, D10). Le PDF de la cotation arrive en phase 3. |
| T2 | Facture groupe CGE-SN | non commencé (phase 4) |
| T3 | Facture individuelle YAO (prorata) | **calcul VERT (phase 1)** : 163 jours, coefficient 0,44658, taxe de 1,5 % sur 120 633 = **1 809,495** exactement (1 809,50 à deux décimales, 1 809 au franc), jamais 2 292. Reste : paiement 41 000, restant dû et reçu REC (phase 4). |
| T4 | Correction de facture (avoir) | non commencé (phase 4) |
| T5 | SECURVIE avec 3 bénéficiaires | non commencé (phase 4) |
| T6 | CP VOL, cases à cocher | non commencé (phase 4) |
| T7 | Liste de plus de 10 assurés | non commencé (phase 3) |
| T8 | Génération en masse | non commencé (phase 5) |
| T9 | Modèle avec balise inconnue | non commencé (phase 3) |
| T10 | Régénération historique | non commencé (phase 3) |
| T11 | Cotation expirée | **VERT (phase 2)** : statut « Expirée » le lendemain de la fin de validité, drapeau de filigrane « EXPIRÉE » (affiché sur la fiche ; le filigrane dans le PDF ré-édité viendra avec la phase 3), transformation en police impossible, et impossible même en SQL direct (déclencheur). |
| T12 | QR code | non commencé (phase 3) |
| T13 | Double validation | **VERT (phase 2)** : prime forcée par un commercial → « À valider », sans numéro ; l'auteur ne peut pas valider (refusé par le service, bouton absent à l'écran), même s'il est Technique ; un autre valideur (Technique ou DG) valide et la cotation est émise. Le motif est obligatoire dès le moindre écart. |
| T14 | **Stockage indisponible à l'émission** (redéfini par D11 : plus de dossier partagé) | non commencé (phase 5) : document conservé en attente, alerte à l'administrateur, reprise automatique |
