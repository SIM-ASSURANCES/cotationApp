# Compte rendu — Étape 8 : sauvegarde hebdomadaire et restauration (branche `phase-sauvegarde`)

Décision **D43**, hypothèses **H120 à H123** (`docs/decisions.md`). Aucun code applicatif touché : scripts bash et documentation.

## Fichiers

- `scripts/sauvegarde.sh`, `restauration.sh`, `rotation-sauvegardes.sh`, `lib-sauvegarde.sh` (bash, Docker seulement, `-p PROJET`).
- `scripts/tests/rotation.test.sh` (dates simulées), `sauvegarde-restauration.test.sh` + `donnees-inventees.sql` (pile jetable).
- `docs/deploiement.md` §2, §5, §7 réécrit : dossier cible, conservation, lignes `cron`, restauration, test trimestriel.

## Ce que font les scripts

- **Sauvegarde** : `pg_dump -Fc` et archive du volume `documents` écrits DANS les conteneurs puis `docker cp` (empreintes comparées), manifeste (lignes de 5 tables clés + migrations), écriture provisoire puis renommage, verrou.
- **`DOSSIER_SAUVEGARDE`** obligatoire : refus si vide, relatif, inexistant (jamais créé) ou à l'intérieur d'un volume ou montage du projet.
- **Restauration** : refuse, avant d'écrire, une base non vide ou un volume `documents` non vide ; `pg_restore` en une transaction ; vérifie migrate status, comptes de lignes, fichiers cités par la base, ouverture d'un PDF par le générateur.
- **Conservation** : 7 quotidiennes, 8 hebdomadaires, 12 mensuelles, 10 annuelles (première sauvegarde du mois / de l'année), déduites des noms, sans état.

## Tests

- `rotation.test.sh` : 13 contrôles verts (jour par jour 09/2024 → 10/2026 : 29 sauvegardes gardées, aucune mensuelle valable supprimée ; annuelles sur 10 ans ; simulation ; dossiers étrangers intacts).
- `sauvegarde-restauration.test.sh` : 47 contrôles verts sur la pile `sauvegarde-test` (migrations réelles, 3 vrais PDF) : sauvegarde, suppression de la pile, restauration sur pile neuve, comptes identiques, 3 PDF ouverts avec leur empreinte, droits et propriétaire conservés, seconde restauration refusée. Pile supprimée à la fin.
- `npm test` (498), `npm run lint`, `npm run typecheck` verts. Intégration et e2e non relancés : aucun code applicatif modifié (le `npm run build` des images a été exécuté par l'essai Docker).

## Défaut trouvé et corrigé en route

Sur une base neuve, le healthcheck de PostgreSQL passe pendant le serveur d'initialisation temporaire (puis redémarrage) : `restauration.sh` attend maintenant le serveur définitif (`attendre_postgres`).

## Écarts et points ouverts

- Essai fait sous Windows (Git Bash + Docker Desktop) : les droits `600` des fichiers ne sont vérifiables que sous Linux (contrôle sauté ici). **À rejouer une fois sur le VPS.**
- **H121** : « jamais supprimée » lu comme « tant que dans sa durée » (sinon le disque croît sans limite). À confirmer.
- Dossier cible, disque ou serveur distinct : à fixer par le superviseur. Espace disque : une trentaine de copies complètes en régime établi.
- Le `.env` (secrets) et Redis ne sont pas sauvegardés (H122) ; le `.env` doit être conservé à part.
- Hors périmètre, non codé : alerte si la dernière sauvegarde est trop ancienne (cron envoie un courrier seulement en cas d'échec).
