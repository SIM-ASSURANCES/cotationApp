# Compte rendu — bareme-formulaire-ergonomie (02/11/2026)

Branche `bareme-formulaire-ergonomie`, issue de `main` (48861e5), worktree `sim-documents-ergonomie`. Commit local, rien de fusionné ni poussé. Décision D62, hypothèses H180 à H183 (D61 et H173+ pris par la session bareme-documents-garanties).

## Ce qui est livré
1. **Champs de garantie sous leur case** (cotation, jeux d'essai, aperçu) : cocher Vol puis caisse affiche la liste de montants juste dessous, décocher la retire (et ne l'envoie pas). `aria-expanded` / `aria-controls`, groupe nommé, aucune colonne double sous `sm` (390 px sans débordement).
2. **Calcul automatique** serveur, anti-rebond 600 ms, une requête en vol, réponse périmée ignorée, seulement si le visible obligatoire est rempli, sinon « Complétez : … » ; E4 comme avant ; « Calculer » et Entrée conservés ; « Calcul en cours… ». Aucun calcul ni barème côté navigateur.

## Fichiers
- `domaine/bareme/formulaire.ts` : `ancrageDesChamps`, `champsManquants`.
- `composants/bareme/calculDiffere.ts` (nouveau, sans React) ; `composants/bareme/FormulaireCotation.tsx` (cases avec panneau, `data-formulaire-bareme`) ; `app/(protege)/cotations/champs-bareme.tsx` (calcul automatique).
- Recette navigateur : `app/scripts/verifier-formulaire-ergonomie.mjs` (nouveau), `verifier-cotation-bareme.mjs` (mis à jour : le total arrive seul, plus de « calculez de nouveau »).
- Docs : `decisions.md` (D62, H180 à H183), captures `captures-ergonomie/` (1440 et 390 px).

## Tests
- Unitaires nouveaux : `calculDiffere.test.ts` (10 : délai 600 ms, anti-rebond, saisie lue au départ, une seule requête en vol, réponse périmée ignorée, annulation, « Calculer » immédiat, échec) ; `formulaire.test.ts` (+8 : ancrage, champs manquants, effectif) ; `FormulaireCotation.test.tsx` (7 : champ sous la case, composante par composante, panneau caché, aria, groupe, pas de grille double à 390 px).
- Intégration (`cotation-bareme.integration.test.ts`, +1) : réponse = `empreinte`, `lignes`, `totaux` seulement, lignes sans taux ni table, aucun secret du barème, appels répétés identiques, aucune cotation écrite.
- E2E navigateur (Chrome, application compilée, base jetable `sim_ergo_recette_test`, SECURPRO inventé, 1440 et 390 px) : `verifier-formulaire-ergonomie.mjs` **TOUT VERT** (53 contrôles : liste sous la case, clavier Espace, masquage et non-envoi, « Complétez » sans requête ni erreur rouge, total sans clic, montant modifié → total mis à jour, frappe rapide de 7 caractères = 1 requête, E4 sans clic, aucun débordement : champ le plus à droite 346 / 390) ; `verifier-cotation-bareme.mjs` **vert** (51 contrôles, 139 420 F TTC, Entrée, refus, enregistrement).
- Suite complète (projet `sim-ergo`, jamais `sim-b1`) : lint et typecheck sans erreur ; unitaires **69 fichiers, 852 tests** ; intégration (relancée le 02/11, machine calme, pile `sim-ergo`, 208 s) : **30 fichiers verts sur 32, 358 tests passés, 67 sautés, 2 fichiers en échec de `beforeAll`** (voir « Écarts ») ; e2e **10 fichiers, 18 tests** (Redis ajouté à la pile d'essai).

## Écarts et points ouverts
- Le tableau des primes défile horizontalement dans sa carte à 390 px (comportement existant).
- La session bareme-documents-garanties modifie aussi la table de résultat de `champs-bareme.tsx` : conflit probable au rebase, à résoudre en gardant sa table et mon bloc de calcul.
- Le script de recette `verifier-formulaire-ergonomie.mjs` n'est pas lancé par `npm`, comme ses prédécesseurs (Playwright installé à part).

## Intégration complète relancée (machine calme, une seule pile)
Deux fichiers n'ont pas démarré : `cotation-bareme.integration.test.ts` (beforeAll ligne 183) et `factures.integration.test.ts` (beforeAll ligne 193), « Hook timed out in 10000ms ». Durée mesurée : **supérieure à 10 000 ms** (le hook est abandonné à la limite par défaut de Vitest, `hookTimeout` non réglé dans `vitest.integration.config.mts` ; la durée réelle n'est pas mesurée). Ils n'ont **pas** été relancés seuls, sur consigne. Ce que fait chaque beforeAll : remplace le générateur et le stockage par des faux, initialise les profils et droits, crée un administrateur puis cinq comptes (mots de passe hachés) et des données de référence (branches, taxes, modèle de CG publié, produit SECURPRO inventé, versions, publication du barème dans le premier fichier). La charge est donc surtout le hachage des mots de passe et des dizaines d'écritures en base. Le fichier fautif change d'une exécution à l'autre (`composition-prime` à la première, ces deux-ci à la seconde) : défaut de délai sous charge CPU du conteneur, pas d'une assertion ; rien dans ce travail ne touche ces fichiers hors un test ajouté à `cotation-bareme` (après son beforeAll). Piste : fixer `hookTimeout` à 60 s dans la config d'intégration (non faite, hors périmètre).
