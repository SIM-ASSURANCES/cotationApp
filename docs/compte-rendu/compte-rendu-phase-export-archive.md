# Compte rendu — Export d'archive et vérification (branche `phase-export-archive`)

Décision **D44**, hypothèses **H124** et **H125** (`docs/decisions.md`). Branche issue de `phase-sauvegarde` (non fusionnée) : elle réutilise `lib-sauvegarde.sh`. Aucun code applicatif touché.

## Fichiers

- `scripts/export-archive.sh -p PROJET -d DESTINATION [-s SOUS_DOSSIER]` : copie de l'arborescence + `MANIFESTE.csv` (numéro, type, date d'émission, chemin, empreinte SHA-256) + copie du vérificateur.
- `scripts/verifier-archive.sh` : autonome (bash et `sha256sum`), recalcule chaque empreinte, signale empreinte différente, fichier absent, non listé, ligne invalide, doublon (codes 0 / 2 / 1).
- `scripts/tests/export-archive.test.sh`, `lib-pile-test.sh` (préparation de pile partagée avec l'essai de sauvegarde).
- `scripts/lib-sauvegarde.sh` : garde « hors des données du projet » extraite en `refuser_dans_donnees`, partagée avec `sauvegarde.sh`.
- `docs/deploiement.md` §7 (« Export d'archive et vérification »), D44, H124-H125.

## Garde-fous

- Destination absolue, vide ou inexistante (jamais d'écrasement), hors volumes et montages du projet ; retirée si l'export échoue en cours de route.
- Sous-dossier validé comme `stockage.py` ; filtre par segment entier (pas de `LIKE`) : « POL-…90000 » ne capte pas « POL-…900001 ».
- Pile en lecture seule : volume monté `:ro`, base lue par `SELECT`.
- Manifeste lu AVANT la copie ; l'archive est vérifiée en fin d'export (code de sortie = celui de la vérification).

## Tests

- `export-archive.test.sh` : 44 contrôles verts sur la pile jetable `export-test` (vraie base migrée, 3 PDF et 1 ZIP d'import écrits par le stockage du générateur) : 10 refus, export complet, export d'un sous-dossier, vérification autonome, base et volume inchangés, puis fichier modifié, fichier supprimé, fichier en trop, chemin `../`, doublon, empreinte falsifiée, manifeste absent : chacun signalé, codes 2 et 1.
- `sauvegarde-restauration.test.sh` rejoué après le refactoring : 48 contrôles verts (dont le ZIP d'import restauré à l'identique). `rotation.test.sh` inchangé.
- Piles supprimées à la fin (0 conteneur, 0 volume). `npm test`, lint et typecheck non relancés : aucun fichier de l'application modifié depuis l'étape 8.

## Écarts et points ouverts

- **H125** : le manifeste n'est pas signé (un fichier et sa ligne modifiés ensemble passent). Parade documentée (SHA-256 du manifeste noté à part, ou nouvel export comparé) ; signature à décider, non codée.
- Documents en écriture différée : non listés tant que le PDF n'est pas dans le volume (signalé à l'export).
- Essai fait sous Windows (Git Bash + Docker Desktop) : à rejouer une fois sur le VPS Linux.
