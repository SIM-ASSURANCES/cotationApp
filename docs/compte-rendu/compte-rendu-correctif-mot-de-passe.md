# Compte rendu : défaut de recette, premier changement de mot de passe

Écrit le 14/10/2026, branche `correctif-mot-de-passe` (depuis `corrections-audit`), **non poussée, non fusionnée**. Décision : D36 (`docs/decisions.md`).

## Cause (d'abord)

Après le changement de mot de passe obligatoire, l'accueil s'affichait « en écran rétréci » parce qu'il était rendu dans la **mauvaise coquille** : le layout `(protege)` choisit la coquille de connexion tant que `doitChangerMotDePasse` est vrai, et l'action finissait par `redirect("/")`, une navigation côté client dans le même layout, que Next.js ne rend pas de nouveau. Le compte était bien à jour en base ; seule la mise en page était périmée jusqu'à un rechargement. Reproduit dans Edge avant le correctif : après le changement, URL `/`, **pas de menu ni de barre du haut, contenu de 366 px sur 1440 px**.

## Correction

| Fichier | Changement |
| --- | --- |
| `app/(protege)/mon-compte/actions.ts` | après `changerMotDePasse`, `signOut({ redirectTo: "/connexion?motdepasse=modifie" })` au lieu de `redirect("/")` (obligatoire et volontaire : même code) |
| `domaine/acces.ts` | adresse de retour, message et `messageDeConnexion(valeur)` : une seule valeur donne un message |
| `app/connexion/page.tsx` | bandeau de succès (`role="status"`) quand le paramètre vaut `modifie` |

Rien d'autre ne change sur l'écran « Mon compte ».

## Tests

- `domaine/acces.test.ts` : adresse publique, message exact, aucune autre valeur n'affiche quoi que ce soit (texte venu de l'adresse compris).
- `documentation.test.ts` : **`jszip` figé** (version exacte, sans `^` ni `~`, identique dans `package.json` et dans le lockfile), demandé par Thierry avec ce point.
- Recette en navigateur : `app/scripts/verifier-mot-de-passe.mjs` (Playwright hors dépendances du projet, comme `capturer-ecrans.mjs`), exécutée sur la version construite, base de recette à part, Edge, comptes inventés. Pour **1440 px puis 390 px**, deux scénarios (A : changement obligatoire après création du compte par l'Admin ; B : changement volontaire depuis « Mon compte »), environ 30 contrôles par taille : première connexion → changement → page de connexion avec le message ; `/`, `/cotations`, `/mon-compte`, `/admin/utilisateurs` renvoient vers `/connexion` ; aucun cookie de session ; l'ancien mot de passe ne connecte plus ; reconnexion avec le nouveau → accueil dans la coquille de l'application, pas de défilement horizontal, contenu de 1130 px sur 1440 px et de 352 px sur 390 px. **Résultat : tous les contrôles passent** (avant le correctif : échecs dès le premier retour).
- `npm test` 477 verts, `npm run lint`, `npm run typecheck` et `npm run build` propres.

## Limite

La session fermée est celle de ce navigateur. Le jeton ne contenant que l'identifiant, un cookie copié avant le changement reste valable jusqu'à 8 h : m1 de l'audit couvert en partie seulement.
