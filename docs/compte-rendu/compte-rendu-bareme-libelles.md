# Correction des libellés : risque.<champ> = libellé, risque_code.<champ> = code

Branche `bareme-libelles` (depuis `main`), à fusionner AVANT `bareme-risque-valeurs`. Commits locaux, rien de poussé. Décision D55, hypothèses H149 et H150 (D54 / H148 restent à `bareme-risque-valeurs`).

## Ce qui change
- `risque.<champ>` (produit au barème) rend ce que voit le Commercial : liste → libellé (à défaut le code) ; oui / non → « Oui » / « Non » ; choix multiples → libellés séparés par des virgules ; montant, nombre, texte, date → valeur saisie.
- Nouvel objet `risque_code.<champ>` : le code (liste : code ; oui / non : OUI / NON ; choix multiples : codes ; autres : comme `risque`). Connu du dictionnaire, du contrôle au dépôt (D52), de la liste des champs facultatifs, de l'aperçu (données d'exemple), de l'aide des modèles et du guide de balisage (exemple `{{ (risque_code.occupation == "LOCATAIRE") | case }}`).
- `surDocuments: false` : champ vide dans `risque` ET `risque_code` (H149 : absent ou vrai = imprimable).
- Cotations antérieures : `risque` et `risque_code` sont recalculés à chaque document depuis la saisie et le barème figés (version + empreinte), calcul pur, rien d'écrit. Ce calcul l'emporte sur les valeurs enregistrées des champs du barème (les anciennes cotations y stockaient des codes) ; les clés propres à la cotation sont gardées ; saisie incomplète : clés vides, jamais d'erreur. Appliqué à la cotation, à la police (CP, certificat) et à la police des factures, avoirs et reçus.
- `SourceDocument.risqueCode` (obligatoire) → `risque_code` dans les données envoyées au générateur.

## Tests
- Unitaires (`documents.test.ts`) : chaque type de champ dans `risque` et `risque_code` (liste avec et sans libellé, oui/non, choix multiples, montant, nombre, texte, date), champ non imprimable, champ inapplicable, `risque_code` connu du dictionnaire et signalé au dépôt s'il n'est pas un champ du barème, clés vides facultatives.
- Intégration SECURPRO (`cotation-bareme.integration.test.ts`) : cotation → données de la cotation avec libellés et codes ; cotation « ancienne » (risque = codes, sans risque_code) → CP avec libellés et codes, police inchangée en base, clé propre gardée ; saisie figée incomplète → clés vides, aucune erreur. Les trois échouent sans le chargement des données.
- Unitaires 674/674, lint et typecheck propres, build réussi. Intégration et e2e dans le conteneur : voir le tableau ci-dessous.

## Écarts et besoins notés (non codés)
- H150 : un modèle déjà publié qui compare `risque.<champ>` à un code cesse de cocher la case dès que libellé et code diffèrent ; il faut le passer à `risque_code.<champ>`. Aucun avertissement automatique au dépôt (l'analyse ne relève pas les comparaisons).
- Les fixtures e2e (CP VOL) comparent encore `risque.statut` avec des données de fixture : sans effet, elles ne passent pas par le barème. Pas de PDF e2e avec `risque_code` sur un produit au barème.
- À la fusion avec `bareme-risque-valeurs` : conflits attendus dans `domaine/bareme/documents.ts`, `serveur/bareme.ts`, `serveur/documents.ts`, `serveur/factures.ts` et les tests (même fonction `avecRisque…` des deux côtés) ; les valeurs intermédiaires et attributs de D54 doivent alors exister dans `risque` ET `risque_code`.

## Tableau de la suite complète
| Contrôle | Résultat |
|---|---|
| Unitaires | 674/674 |
| Lint / typecheck | 0 erreur / vert |
| Build | réussi |
| Intégration (conteneur, base recréée, vrai générateur) | 29 fichiers, 370/370 |
| E2E (conteneur, vrai générateur, Redis, pdftotext) | 6 fichiers, 13/13 |
| pytest (générateur) | non lancé (aucun fichier du générateur touché) |
Conteneur : image d'outils du dépôt, `src` / `prisma` / `scripts` montés en lecture seule, Postgres / Redis / générateur jetables sur un réseau à part (supprimés ensuite).

## Commits
(voir `git log` de la branche)
