# Compte rendu : corrections de l'audit avant mise en production

Écrit le 14/10/2026, branche `corrections-audit` (depuis `main` = `sim/main`, commit `0c2244c`), **non poussée, non fusionnée**. Un commit par constat, chacun avec son test. Source : `docs/audit-pre-production.md` (rapport local, ignoré par Git).

| Constat | Commit | Correction | Test |
| --- | --- | --- | --- |
| B2 (bloquant) | `084976b` | `.xlsx` : le répertoire central du ZIP est lu **avant** ExcelJS ; refus au-delà de 30 Mo décompressés ou 200 parties (`domaine/imports/archive.ts`) | 7 tests de l'archive (dont 60 Mo en 61 Ko refusés en moins de 2 s, taille déclarée mensongère, commentaire d'archive, fichier tronqué) + 3 sur `lireFichierImport` |
| M4 | `e51a9ca` | Identifiant inconnu journalisé seulement s'il a la forme d'un identifiant | 2 tests de domaine + 1 d'intégration (journal réel) |
| M5 | `803204f` | `mem_limit` et `cpus` sur les 6 services | Le test échoue si un service perd sa limite (vérifié en retirant celle de Redis) |
| M1 | `8824727` | Adresse du client = N-ième élément de `X-Forwarded-For` en partant de la droite, `PROXIES_DE_CONFIANCE` (défaut 1, validé au démarrage) ; `X-Real-IP` n'est plus lu | 7 tests de domaine + 1 de configuration ; essai sur le build : 35 requêtes avec adresse gauche forgée → 200 ×30 puis 429 ×5 |
| M6 | `7b126b3` | Analyse d'un modèle : 30 Mo décompressés et taux de compression ≤ 100 | 3 tests pytest (150 Mo → refusé en < 2 s, avant : 94 s) |
| M3 | `4608b94` | CSP sans jeton dans `next.config.ts` | 3 tests ; en-tête relevé sur le build ; `/connexion` et `/verif/…` chargés dans Edge sans violation |
| M7 | `9f50875` | Mémoire de 60 s pour les tableaux de bord de la page d'arrivée (`serveur/tableaux-memorises.ts`) | 6 tests du cache + 1 d'intégration (droit vérifié avant la mémoire, pas de mélange entre commerciaux, erreur non gardée) |
| m8 | `3d8f37c` | Migration `20261014090000_index_audit` : 7 index | Test d'intégration (les 7 index existent) |

## Tests

`npm test` 474 verts ; `npm run lint` et `npm run typecheck` propres ; intégration : 236 verts, 13 ignorés, **1 fichier non exécuté** (`import-masse.integration.test.ts` exige Redis, absent de ce poste : à relancer là où Redis tourne) ; `pytest` du générateur : 224 verts, 6 ignorés, **4 échecs sans lien** (`test_conversion` : conversions simultanées, déjà en échec avant mes changements ; `test_verifier_modele` : décodage de la console Windows).

## Écarts et limites

- **B2 sans JSZip directement** : il n'est qu'une dépendance indirecte d'ExcelJS (le `package.json` ne le déclare pas) ; l'importer aurait créé une dépendance non déclarée. Le contrôle lit le répertoire central lui-même (30 lignes, sans dépendance). ExcelJS (JSZip) refuse une partie dont la taille réelle diffère de celle déclarée : testé.
- **M4 : limite connue.** Un mot de passe composé seulement de lettres, chiffres et `. _ @ -` (3 à 64 caractères) a la forme d'un identifiant et reste journalisé. L'option 2 du rapport (empreinte tronquée de la saisie) la lèverait : **décision de Thierry**.
- **M1 : à faire vérifier jeudi** sur le proxy réellement installé (procédure dans `docs/deploiement.md`). Un nombre trop bas donne l'adresse du proxy ; trop haut, un visiteur choisit la sienne.
- **M7** : les chiffres de la page d'arrivée ont jusqu'à 60 s de retard (noté dans D34).
- **M3** : `'unsafe-inline'` pour les scripts et styles ; la CSP à jeton reste à faire. Les pages derrière la connexion n'ont pas été ouvertes dans un navigateur avec la CSP (aucun compte sur ce poste) : à regarder pendant la recette.
- **M5** : valeurs de départ, à contrôler avec `docker stats` (import de 500 adhérents compris).
- **m8** : la base de développement `sim_documents_docker` doit recevoir la migration (`npm run migrate:deploy`).
- **Non traités** (décision de Thierry) : M2 (dépend de M1, maintenant possible), m1 à m7 et m9 à m14 ; B1 (essai Docker complet sur Linux) reste à faire avant la mise en ligne.

## Hypothèses ouvertes

Aucune nouvelle (H101 reste la dernière).
