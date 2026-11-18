# Compte rendu — phase-polices-libres (18/11/2026)

Branche `phase-polices-libres` depuis `main` (1135522). Décision **D69**, hypothèses **H227 à H231**. Pas de migration.

## Décision de Thierry (question posée en cours de session)
`recette.md` §1.2 (variante C′, 06/10/2026) avait mesuré, contre le PDF Word, que la Tahoma de Wine **ne reproduit pas** la pagination (348 mots en page 1 au lieu de 240 ; 8 fins de page sur 13 contre 10 sur 13 sans Tahoma). Mes mesures, sans police Microsoft, disent l'inverse (chiffres 0,546 em, hauteur de ligne 1,207 em). Choix retenu : **Tahoma reste fournie par SIM** et exigée par `/sante` ; Calibri, Arial et Times New Roman passent aux polices libres ; la Tahoma de Wine est un **essai** (`TAHOMA_LIBRE=oui`), adoptable en une ligne après le test de fidélité.

## Fichiers
- `generateur/Dockerfile` (argument `TAHOMA_LIBRE`, affichage de `fc-match`), `generateur/fontconfig/tahoma-wine.conf`, `docker-compose.yml`, `.env.example`.
- `generateur/app/polices.py` (table unique `REMPLACANTS_AUTORISES`), `routes/sante.py`, `analyse.py`, `scripts/verifier_modele.py`.
- Tests : `test_sante.py` (+10), `test_verifier_modele.py` (+2), `test_polices_libres.py` (4, PDF réels lus avec `pdffonts`).
- Docs : `generateur/polices/README.md`, `installation.md`, `deploiement.md` (mise à jour complète a à h, sans valeur de tarif), `exigences-serveur`, `guide-balisage`, `recette`, `README`, `decisions` (D69).

## Paquets de polices (Debian ; versions de l'environnement Ubuntu 24.04)
| Paquet | Version | Licence | Rôle |
| --- | --- | --- | --- |
| `fonts-crosextra-carlito` | 20230309-2 | SIL OFL 1.1 | Calibri |
| `fonts-liberation` | 1:2.1.5-3 | SIL OFL 1.1 | Arial, Times New Roman |
| `fonts-wine` (essai) | 9.0 | LGPL-2.1+ | Tahoma (« Wine Tahoma ») |
| `fonts-dejavu-core` | 2.37-8 | Bitstream Vera / DejaVu | secours seulement, jamais un remplaçant |

## Ce que renvoie fontconfig (`fc-match`)
| Demandée | Image par défaut | Essai `TAHOMA_LIBRE=oui` |
| --- | --- | --- |
| Tahoma | repli sans rapport (Inter ici, DejaVu Sans dans l'image) : `/sante` dit `["Tahoma"]` | **Wine Tahoma** (`tahoma.ttf`, gras `tahomabd.ttf`) : `/sante` ok |
| Calibri | **Carlito** (`Carlito-Regular.ttf`) | Carlito |
Arial → Liberation Sans, Times New Roman → Liberation Serif. Une vraie Tahoma déposée dans `polices/` est **retenue en priorité** (éprouvé avec une police libre renommée, jamais une police Microsoft). PDF sans fichier dans `polices/` : `WineTahoma`, `WineTahomaBold`, `Carlito-Regular/Bold`, `LiberationSans/Serif` (pas DejaVu).

## Tests (PostgreSQL 16, base vierge, suite complète)
| Suite | Fichiers | Tests |
| --- | --- | --- |
| Unitaires | 81 | 981 |
| Intégration | 39 | 511 (1re passe : 510, l'export du journal, test instable, voir écarts ; relance verte) |
| Bout en bout | 15 | 31 |
| pytest (générateur) | — | 262 |
`eslint`, `tsc`, `npm run build` sans erreur. `docker build --check` du Dockerfile (deux modes) : sans avertissement.

## Ce qui n'a pas tourné
- **Construction de l'image** : le démon Docker démarre dans la session et l'image de base se tire, mais `apt-get update` est refusé (403 du proxy : tous les miroirs Debian sont interdits). Les **mêmes paquets** sont installés dans l'environnement et la même configuration fontconfig y est éprouvée (H229). La 1re vraie construction est la vérification.
- Test de fidélité contre un PDF Word : aucune référence Word dans la session.

## Écarts
- Le brief adoptait la Tahoma de Wine ; la décision l'a ramenée à l'essai. `deploiement.md` demande donc encore de copier **Tahoma** (seule police à fournir).
- `test_sante.py` : l'aide `polices()` simule aussi `fc-match` ; aucune valeur attendue d'un test existant n'a changé.
- Test d'export du journal (`audit-export`) : exige un ordre strict des horodatages de TOUT le journal ; il échoue s'il suit le test de numérotation sous concurrence (transactions parallèles), sans rapport avec les polices.

## Recette pour Thierry (6 étapes)
1. `docker compose build generateur` : lire les lignes `fc-match` (Calibri → Carlito, Arial → Liberation Sans, Times New Roman → Liberation Serif, Tahoma → la vôtre).
2. Déposer `tahoma.ttf` et `tahomabd.ttf` dans `generateur/polices/`, reconstruire ; `/api/sante` : `generateur: "ok"`. Sans eux : `polices_manquantes: ["Tahoma"]`.
3. `docker compose exec generateur fc-list : family > polices-image.txt`, puis `python scripts/verifier_modele.py <modèle> --type CP --polices-image polices-image.txt` : plus d'« absente » pour Calibri, Arial, Times New Roman.
4. **Test de fidélité** de la CP SECURPRO et de la facture contre leur PDF exporté par Word (`recette.md` §1.2, `test_fidelite.py`), image par défaut : fins de page identiques (code de sortie 0).
5. **Essai Wine** : `TAHOMA_LIBRE=oui`, `polices/` vidé, reconstruire ; `fc-match Tahoma` → Wine Tahoma ; rejouer l'étape 4. Identique à Word : passer `ARG TAHOMA_LIBRE` à `oui` ; sinon laisser `non`.
6. Contrôler un PDF émis avec `pdffonts` : Calibri rendue en Carlito, jamais DejaVu.
