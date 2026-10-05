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

### 1.2 Linux dans le conteneur : NON EXÉCUTÉ

Docker n'est pas installé sur le poste de développement. Le test sous Linux, le seul qui compte pour le VPS, reste à faire :

```powershell
# 1. Placer les polices dans generateur/polices/ (voir son README), puis construire l'image
docker compose build generateur
# 2. Mettre le CP de test et son PDF Word dans un dossier essais/ (hors dépôt) et lancer le test
docker compose run --rm -v ${PWD}/essais:/essais generateur python scripts/test_fidelite.py --modele /essais/CP_test.docx --reference /essais/CP_test_word.pdf
```

À noter ici : le résultat (pages Word / LibreOffice, fins de page, polices substituées), d'abord **sans** les polices Microsoft (cas le plus défavorable), puis **avec**. Écart de version à surveiller : l'image utilise le LibreOffice de Debian, pas le 26.8 du poste.

## 2. Phase 0 : socle, connexion, droits, audit

| Vérification | Comment | Résultat |
| --- | --- | --- |
| Tests unitaires de l'application (domaine, configuration, conformité du tableau des droits au CDC §4) | `npm test` | 26 verts |
| Tests d'intégration (base PostgreSQL réelle) : journal en ajout seul, verrouillage, comptes désactivés, droits, mot de passe | `npm run test:integration` | 15 verts ; 2 protections affaiblies volontairement ont fait échouer les tests (puis restaurées) |
| Tests du générateur (dont conversion avec le vrai LibreOffice) | `pytest` | 15 verts |
| Types et lint (dont règles de couches et accès au journal) | `npm run typecheck`, `npm run lint` | sans erreur |
| Parcours HTTP réel : redirections, 401 des routes `/api`, droits par profil, mot de passe provisoire, redirection ouverte, cookie HttpOnly, en-têtes de sécurité | script de parcours, 21 contrôles | 21 sur 21, en développement **et** sur la version de production (`npm start`) |
| `docker compose up` : les 4 services démarrent | | **non exécuté** (Docker absent) ; syntaxe du fichier compose validée seulement |
| Connexion fonctionnelle derrière un proxy HTTPS | | **non exécuté** |

## 3. Cas de test du CDC (§16.1)

| N° | Cas | État |
| --- | --- | --- |
| T1 | Cotation santé BENI (2 formules) | non commencé (phase 1) |
| T2 | Facture groupe CGE-SN | non commencé (phase 4) |
| T3 | Facture individuelle YAO (prorata) | non commencé (phases 1 et 4) |
| T4 | Correction de facture (avoir) | non commencé (phase 4) |
| T5 | SECURVIE avec 3 bénéficiaires | non commencé (phase 4) |
| T6 | CP VOL, cases à cocher | non commencé (phase 4) |
| T7 | Liste de plus de 10 assurés | non commencé (phase 3) |
| T8 | Génération en masse | non commencé (phase 5) |
| T9 | Modèle avec balise inconnue | non commencé (phase 3) |
| T10 | Régénération historique | non commencé (phase 3) |
| T11 | Cotation expirée | non commencé (phase 2) |
| T12 | QR code | non commencé (phase 3) |
| T13 | Double validation | non commencé (phase 2) ; la règle « le valideur n'est pas l'auteur » est préparée dans les droits (niveau « Valide » distinct de « Oui ») |
| T14 | Dossier partagé indisponible | non commencé (phase 5, selon la réponse à Q3) |
