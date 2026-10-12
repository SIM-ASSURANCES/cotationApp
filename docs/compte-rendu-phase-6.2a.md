# Compte rendu de la session 6.2a : blocage des produits tarifés par garanties

Écrit le 12/10/2026, branche `claude/zealous-dirac-4nt0p9`, **à la suite de la refonte visuelle V1** (même branche, non fusionnée). Décision : [decisions.md](decisions.md#d31--produits-tarifés-par-garanties--blocage-du-calcul-automatique-session-62a) (D31, H85 à H88). Source : instructions de la phase 6.2 (hors dépôt). Le simulateur de primes de la Technique reste **hors dépôt** et aucun de ses chiffres n'est repris : les tests posent les chiffres de T1 ou des chiffres inventés.

## Ce qui est fait

| Point des instructions | Livré | Logique |
| --- | --- | --- |
| 1. Mode de tarification | `produit_versions.mode_tarification` (`FORMULE` par défaut, `GARANTIES`), migration `20261012100000_mode_tarification`, `CHECK` en base ; `modeTarification` dans `VersionSaisie` (facultatif, absent = `FORMULE`) et `VersionProduit` ; sélecteur dans « Ajouter une version », mode affiché dans l'historique | Propriété de la **version** historisée : une version en vigueur ne se modifie plus (déclencheur existant) ; on change de mode en ajoutant une version |
| 2. Refus du calcul automatique | `exigerCalculAutomatique` et message verbatim de la Technique, appliqués en **cinq sites** : `resoudreContexte` (avant la taxe), `construireEntree`, l'émission d'une cotation (version figée **et** version en vigueur), l'émission d'une facture de renouvellement, `montantsDu` | « Sûr par défaut » : seule la chaîne exacte `FORMULE` se calcule. Le moteur n'est pas modifié. Liste détaillée et raisons : D31 |
| 2. Remplace le refus IARD | Un produit IARD se paramètre en `GARANTIES` ; le contrôle « taux mixte » de `choisirTaux` reste comme filet pour un produit à la formule sur une branche à taux mixte | H32 reste ouverte jusqu'à la 6.2b |
| 3. Données de démarrage | **Aucun produit créé.** D31 consigne que SECURPRO, SECURHOME, SECURHOME + et RELAXACCIDENTS doivent être en mode `GARANTIES` dès leur première version | |
| 4. Tests | voir ci-dessous | |
| Écrans | « Nouvelle cotation » et « Modifier le brouillon » affichent le message à la place du formulaire quand la version en vigueur est `GARANTIES` (un composant, `MessageTarificationParGaranties`) ; la page produit explique la consigne « dès la première version » | Présentation seulement ; le refus reste porté par le serveur |

## Tests

| Suite | Résultat |
| --- | --- |
| Unitaires (`npm test`) | 407 verts (401 avant la 6.2a) |
| Intégration (`npm run test:integration`) | 192 verts (176 avant la 6.2a) |
| Bout en bout (`npm run test:e2e`, vrai générateur) | 12 verts (inchangé) |
| Générateur (`pytest`) | 220 verts (inchangé) |
| `npm run lint`, `npm run typecheck` | propres |
| `npm run build` | propre (lancé dans l'arbre principal, après la fusion) |

Nouveaux tests : domaine (`tarification.test.ts`), lecture du formulaire (`lire-version.test.ts`), intégration (`tarification-garanties.integration.test.ts`, un fichier ; un cas dans `factures.integration.test.ts`), et le test T6 de `contrats-4a.e2e.test.ts`, qui vérifie maintenant les deux refus (GARANTIES, puis taux mixte à la formule).

- **GARANTIES ne calcule pas** : `calculerPourProduit` refuse avec le message, que la branche ait un taux simple ou un taux mixte (le message ne dépend plus du taux) ; `construireEntree` refuse aussi un contexte fabriqué à la main, avec un mode inconnu.
- **GARANTIES n'émet pas de cotation** : aucun brouillon ne naît (0 ligne en base) ; un produit **basculé** en `GARANTIES` ne permet plus de soumettre, modifier **ni valider** une cotation d'avant (scénario réel, sans SQL) ; la ceinture sur la version figée est éprouvée par un état fabriqué en SQL.
- **GARANTIES n'émet pas de facture** : le renouvellement (création, recalcul, émission) est refusé après la bascule ; `montantsDu` refuse une version `GARANTIES`.
- **FORMULE ne change pas d'un franc** : T1 (15 888 000, échéancier 4 × 3 972 000) identique pour une version sans mode et pour une version `FORMULE` explicite ; le `DEFAULT` de la colonne est vérifié par une insertion SQL sans mode ; une cotation à la formule s'émet toujours ; T2 et T3 passent dans leurs suites inchangées. **T10** : une cotation émise avant la bascule reste acceptable, et la facture d'affaire nouvelle d'une police figée s'émet encore (101 500 F).
- **Version future** (H86) : une version `GARANTIES` datée dans l'avenir ne bloque rien avant sa date, et bloque à sa date.
- **Sabotage vérifié** : chaque garde (sept retraits, un par site ou par contrôle) a été retirée l'une après l'autre ; chaque retrait fait échouer au moins un test.
- **Non testé automatiquement** : les deux pages (`/cotations/nouvelle`, `/cotations/[id]/modifier`) et le sélecteur de la page produit, qui sont des pages serveur sans test de composant dans ce dépôt ; ni le sélecteur ni l'affichage du message n'ont été vus dans un navigateur.

## Revue contradictoire

Quatre relecteurs indépendants (contournements, régressions et intégrité, qualité des tests, périmètre et interface), puis un sceptique par constat : 32 constats bruts, 26 confirmés (beaucoup de doublons), 6 écartés. Aucun écart de périmètre, aucun barème, aucune donnée réelle. **Deux vrais contournements, corrigés avant le commit** :

1. « Valider » émettait une cotation « À valider » créée avant la bascule : la garde de l'émission ne regardait que la version figée sur la cotation. Elle regarde maintenant aussi la version en vigueur aujourd'hui. Mon premier test fabriquait l'état en SQL et masquait ce défaut : il est remplacé par le scénario réel.
2. `emettreFacture` n'avait aucune garde : un brouillon de renouvellement préparé avant la bascule s'émettait après. Il est maintenant refusé (H87).

Corrigés aussi : documentation trop affirmative (« montantsDu, passage obligé de toute facture et de tout document » était faux : le certificat, l'avoir et le reçu n'utilisent aucun montant du moteur), message de « Nouvelle cotation » avec un point final de trop, écran de modification d'un brouillon sans protection, `DEFAULT` non testé, T10 non éprouvé, comptage faux dans un commentaire, lien symbolique `node_modules` du worktree.

## Écarts, hypothèses ouvertes

- **Branche** : la 6.2a n'a pas sa propre branche (la seule branche où je peux pousser dans cette session est celle de la V1). Elle a été construite dans un `git worktree` à part, sur le dernier commit de code de la V1, puis ajoutée à la suite de la V1. Elle ne dépend pas du code de la V1, mais elle modifie trois fichiers que la V1 a aussi modifiés (`CLAUDE.md`, `README.md`, `docs/decisions.md`, à des endroits différents). Deux fusions séparées sont possibles si tu m'autorises une seconde branche, avec la V1 fusionnée en premier.
- **H85** : une version `GARANTIES` doit encore porter au moins une formule (règle de saisie inchangée) ; elle ne sert jamais au calcul. À relâcher en 6.2b si la liste des garanties la remplace.
- **H86** : le refus suit la version en vigueur à la date du document (date du jour pour une cotation, validation comprise ; date d'effet pour un renouvellement).
- **H87** : un brouillon de renouvellement créé avant la bascule ne peut plus être modifié ni émis ; la police ne se renouvelle plus avant la 6.2b, car aucune fonction ne supprime un brouillon. À décider : faut-il une action « abandonner le brouillon » ?
- **H88** : l'affaire nouvelle et l'avenant d'une police figée avant la bascule restent facturables (T10). À faire confirmer.
- **Limite connue, par construction** : une version `FORMULE` plus ancienne reste calculable pour tout document daté avant la date d'effet de la version `GARANTIES`. D'où la consigne : paramétrer ces quatre produits en `GARANTIES` dès leur **première** version.
- **Non vérifié** : le comportement sous navigateur des deux pages modifiées ; la migration sur une base de production (elle ne fait qu'ajouter une colonne avec valeur par défaut et une contrainte, les versions existantes prennent `FORMULE`).

## Pour Thierry

1. Dire si la 6.2a part avec la V1 dans une seule fusion ou si tu préfères deux branches.
2. Faire paramétrer SECURPRO, SECURHOME, SECURHOME + et RELAXACCIDENTS en mode « Par garanties » **avant** tout autre paramétrage de ces produits.
3. Trancher H87 (abandon d'un brouillon de renouvellement) et confirmer H88.
4. La 6.2b (composition manuelle) peut démarrer quand tu le décides ; elle devra lever les gardes de la 6.2a produit par produit (liste dans D31).
