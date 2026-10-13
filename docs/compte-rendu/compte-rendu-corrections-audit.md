# Compte rendu : corrections de l'audit avant mise en production

Écrit le 14/10/2026, branche `corrections-audit` (depuis `main` = `sim/main`, commit `0c2244c`), **non poussée, non fusionnée**. Un commit par constat, chacun avec son test. Source : `docs/audit-pre-production.md` (rapport local, ignoré par Git).

| Constat | Commit | Correction | Test |
| --- | --- | --- | --- |
| B2 (bloquant) | `084976b`, puis `08b5229` | `.xlsx` : le répertoire central du ZIP est lu **avant** ExcelJS ; refus au-delà de 30 Mo décompressés ou 200 parties (`domaine/imports/archive.ts`). Lecteur maison remplacé par **JSZip déclaré** (voir Finalisation) | 7 tests de l'archive (dont 60 Mo en 61 Ko refusés en moins de 2 s, taille déclarée mensongère, commentaire d'archive, fichier tronqué) + 3 sur `lireFichierImport` |
| M4 | `e51a9ca`, puis `6bb18a7` | Identifiant inconnu : **rien de la saisie** n'est journalisé (raison, adresse IP, heure) ; le contrôle de forme du premier commit est supprimé | 1 test d'intégration sur la ligne entière du journal |
| M5 | `803204f` | `mem_limit` et `cpus` sur les 6 services | Le test échoue si un service perd sa limite (vérifié en retirant celle de Redis) |
| M1 | `8824727` | Adresse du client = N-ième élément de `X-Forwarded-For` en partant de la droite, `PROXIES_DE_CONFIANCE` (défaut 1, validé au démarrage) ; `X-Real-IP` n'est plus lu | 7 tests de domaine + 1 de configuration ; essai sur le build : 35 requêtes avec adresse gauche forgée → 200 ×30 puis 429 ×5 |
| M6 | `7b126b3` | Analyse d'un modèle : 30 Mo décompressés et taux de compression ≤ 100 | 3 tests pytest (150 Mo → refusé en < 2 s, avant : 94 s) |
| M3 | `4608b94` | CSP sans jeton dans `next.config.ts` | 3 tests ; en-tête relevé sur le build ; `/connexion` et `/verif/…` chargés dans Edge sans violation |
| M7 | `9f50875` | Mémoire de 60 s pour les tableaux de bord de la page d'arrivée (`serveur/tableaux-memorises.ts`) | 6 tests du cache + 1 d'intégration (droit vérifié avant la mémoire, pas de mélange entre commerciaux, erreur non gardée) |
| m8 | `3d8f37c` | Migration `20261014090000_index_audit` : 7 index | Test d'intégration (les 7 index existent) |

## Tests

`npm test` 474 verts (version de la première livraison ; voir Finalisation pour l'état final) ; `npm run lint` et `npm run typecheck` propres ; intégration : 236 verts, 13 ignorés, **1 fichier non exécuté** (`import-masse.integration.test.ts` exige Redis, absent de ce poste : à relancer là où Redis tourne) ; `pytest` du générateur : 224 verts, 6 ignorés, **4 échecs sans lien** (`test_conversion` : conversions simultanées, déjà en échec avant mes changements ; `test_verifier_modele` : décodage de la console Windows).

## Écarts et limites

- **B2 et M4** : décisions de Thierry du 13/10 appliquées, voir « Finalisation ».
- **M1 : à faire vérifier jeudi** sur le proxy réellement installé (procédure dans `docs/deploiement.md`). Un nombre trop bas donne l'adresse du proxy ; trop haut, un visiteur choisit la sienne.
- **M7** : les chiffres de la page d'arrivée ont jusqu'à 60 s de retard (noté dans D34).
- **M3** : `'unsafe-inline'` pour les scripts et styles ; la CSP à jeton reste à faire. Les pages derrière la connexion n'ont pas été ouvertes dans un navigateur avec la CSP (aucun compte sur ce poste) : à regarder pendant la recette.
- **M5** : valeurs de départ, à contrôler avec `docker stats` (import de 500 adhérents compris).
- **m8** : la base de développement `sim_documents_docker` doit recevoir la migration (`npm run migrate:deploy`).
- **Non traités** (décision de Thierry) : M2 (dépend de M1, maintenant possible), m1 à m7 et m9 à m14 ; B1 (essai Docker complet sur Linux) reste à faire avant la mise en ligne.

## Hypothèses ouvertes

Aucune nouvelle (H101 reste la dernière).

## Finalisation (14/10/2026)

Décisions de Thierry du 13/10/2026, un commit par point : `08b5229` (JSZip), `6bb18a7` (M4), `a9b7fd6` (OpenSSL).

1. **B2, JSZip déclaré** : `jszip` 3.10.2 dans `package.json`, version déjà résolue par ExcelJS ; le lockfile ne gagne **qu'une ligne** (la déclaration à la racine). `npm install` ne pouvait pas être utilisé sur ce poste (téléchargements distants désactivés) : les deux fichiers ont été modifiés à la main et validés par un `npm ci` complet dans la construction Docker. Mêmes bornes (30 Mo, 200 parties). Archive tronquée, corrompue ou aléatoire : message « Fichier Excel illisible… » (`ErreurMetier`), jamais une erreur du serveur. **Point de vigilance** : JSZip ne publie pas les tailles décompressées dans son interface publique ; le contrôle lit `_data.uncompressedSize`. Si une version future de JSZip le retirait, le fichier serait refusé (échec fermé) et le test « un vrai classeur de 5 000 lignes passe » échouerait aussitôt.
2. **M4, rien journalisé** : un identifiant inconnu écrit `{ "raison": "identifiant inconnu" }`, l'adresse et l'heure ; ni texte, ni empreinte, ni longueur. Le test saisit `motdepasse.secret2026.xxxxxx` et une phrase de passe, puis vérifie **toute la ligne** du journal (toutes colonnes). Identifiant connu : inchangé. Trace : D35.
3. **OpenSSL** : étape commune `base` dans `app/Dockerfile`, dont héritent `dependances` (donc `construction`, `outils`, `travailleur`) et `execution` (`app`). Avant : `prisma:warn Prisma failed to detect the libssl/openssl version…` ; après : plus d'avertissement, moteur `schema-engine-debian-openssl-3.0.x`. Test dans `documentation.test.ts`.

### `pytest` dans le conteneur `generateur` (Linux, LibreOffice de l'image)

Image `sim-documents-generateur` (construite avant ces corrections), tests montés depuis une copie de chaque branche.

| Ensemble | `main` (`0c2244c`) | `corrections-audit` |
| --- | --- | --- |
| Tous les tests du générateur | 224 réussis, 7 ignorés, **0 échec** | 227 réussis, 7 ignorés, **0 échec** (+3 tests de l'archive piégée, M6) |
| `test_conversion` (conversions simultanées, un profil chacune) | réussi | réussi (en échec sur Windows, sur `main` aussi : sans lien avec la branche) |
| `test_analyse` (analyse des modèles, y compris M6) | réussi | réussi (3 nouveaux) |
| `test_verifier_modele` (outil de balisage) | 7 ignorés dans le conteneur (Node et `npm ci` absents) ; **12 réussis** sur le poste, Node présent, `PYTHONUTF8=1` | **12 réussis**, mêmes conditions |

Aucun test réussi sur `main` n'échoue sur la branche : **aucune régression**. Les échecs vus sur Windows (`test_verifier_modele`, 3 tests) venaient du décodage de la console en cp1252, pas du code.

### Intégration avec Redis (conteneur `outils`, PostgreSQL 18.6, Redis 7)

| Fichier / ensemble | `main` | `corrections-audit` |
| --- | --- | --- |
| `import-masse.integration.test.ts` (T8, T14, H64…) | non rejoué | **13 réussis sur 13** |
| Suite d'intégration complète | — | 247 réussis, **2 échecs** |
| `droits-defauts.integration.test.ts` (« droits par défaut = tableau du CDC ») | échoue de la même façon | échoue : le test lit `docs/cdc.md`, absent de l'image (`ENOENT /docs/cdc.md`) ; réussi sur le poste |
| `factures.integration.test.ts`, T4 (« avoir AV… »), dernière assertion | échoue de la même façon | échoue : une écriture directe sur une facture annulée lève bien une erreur, mais Prisma la rapporte comme « Foreign key constraint violated » au lieu du message français du déclencheur ; réussi sur le poste. Le déclencheur, lui, répond correctement (`facture FAC-… : annulée, aucune modification possible` vu avec `psql` dans le conteneur) |

Les deux échecs sont **identiques sur `main`** : ce n'est pas une régression de la branche. Ils ne sont pas résolus : le premier est un fichier de documentation absent de l'image, le second une différence de rapport d'erreur de Prisma entre le poste et le conteneur (mêmes versions de paquets, mêmes versions de PostgreSQL). **Décision de Thierry** : les corriger dans une session séparée (hors du périmètre de cette finalisation).

### Vérifications sur le poste et pile complète

- `npm test` 474 verts, `npm run lint`, `npm run typecheck`, `npm run build` propres. Intégration sur le poste (PostgreSQL 18.6, sans Redis) : 236 verts, 13 ignorés (l'import, rejoué dans le conteneur avec Redis ci-dessus).
- Pile complète construite et lancée dans un projet Compose à part (`docker compose up -d`) : tous les services sains, `/api/sante` → `ok`, en-tête `Content-Security-Policy` servi, limites de mémoire appliquées (`docker stats` : app 171 Mo / 1 Go, travailleur 236 Mo / 1 Go, générateur 63 Mo / 2 Go, postgres 74 Mo / 1 Go, redis 6 Mo / 256 Mo au repos), 35 requêtes avec adresse gauche forgée sur `/verif` → 200 ×30 puis 429 ×5. Pile supprimée ensuite (volumes et images de ce projet seulement).
