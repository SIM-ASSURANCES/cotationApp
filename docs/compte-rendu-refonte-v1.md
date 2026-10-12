# Compte rendu de la refonte visuelle, session V1 : fondations, connexion, coquille

Écrit le 12/10/2026, branche `claude/zealous-dirac-4nt0p9` (la branche de la session, à la place de `refonte-visuelle`), créée depuis `main` après la fusion de la 6.1 (PR #6), **non fusionnée**. Décision : [decisions.md](decisions.md#d30--refonte-visuelle-alignée-sur-le-portail-rh-session-v1) (D30). **Présentation seulement** : rien dans `domaine/` (hors le nouveau `navigation.ts`), `serveur/`, le schéma, les migrations, le générateur ni les droits ; aucune dépendance npm ajoutée. **La V2 (pages métier) n'est pas commencée** : elle attend ton essai et la fusion de la V1.

## Ce qui est fait

| Point des instructions | Livré | Logique |
| --- | --- | --- |
| §1.1 Tokens | `globals.css` : palette `sim-*` et tokens sémantiques du portail, ombres, courbes, animations sous `prefers-reduced-motion` ; anciens tokens retirés partout | Un seul endroit pour les couleurs. Règle de calques : `:focus-visible` dans `@layer base`, mes classes en `@utility` (hors calque elles battaient les classes Tailwind) |
| §1.1 Garde « aucune couleur en dur » | `src/couleurs.test.ts` | Le test parcourt `src/` et refuse palette Tailwind, `bg-white`/`text-white`, valeurs arbitraires, littéraux de couleur, `rgb()`, styles en ligne et anciens tokens ; sa détection est elle-même testée (échantillons interdits et permis). **Méthode proposée** : un test, plutôt qu'une règle ESLint `no-restricted-syntax` (voir D30) |
| §1.2 Police et métadonnées | `layout.tsx` : titre « SIM Assurances — Documents », description, `lang="fr"`, Montserrat **locale** conservée | Mesuré sur la version construite : les graisses 300, 400, 500, 600, 700 et 900 rendent six largeurs distinctes et croissantes (police variable) |
| §1.3 Favicon | `icon.tsx`, `apple-icon.tsx` (pictogramme blanc sur bleu), `favicon.ico` supprimé | Seule retouche près de l'authentification : le `matcher` de `proxy.ts` exempte `/icon` et `/apple-icon` (sans quoi la page de connexion n'aurait pas de favicon). Vérifié : 200 sans session, `/` redirige toujours |
| §1.4 Connexion | `CoquilleConnexion` + `connexion/page.tsx` | Même Server Action, mêmes champs, mêmes messages ; « Se souvenir de moi » absent (D6) ; « Mot de passe oublié ? » déplie le texte de l'administrateur, sans route ni courriel. Accès refusé et mot de passe à changer prennent la même coquille |
| §1.5 Bibliothèque | `composants/ui/` : `Bouton`, `Champ`, `ZoneTexte`, `ListeDeroulante`, `ChampFormulaire`, `Carte`, `Pastille`, `EnTetePage`, `Tableau`, `EtatVide`, `CarteIndicateur`, `Icone`, `FondDeMarque`, `pictogramme.ts` | `FormulaireAction` et son `Champ` s'appuient dessus : tous les formulaires existants changent d'aspect, pas de comportement (mêmes `name`, même envoi, vérifié par rendu comparé à l'ancien) |
| §1.6 Coquille | `Coquille`, `BarreLaterale`, `BarreHaut`, `MenuProfil` ; `(protege)/layout.tsx` | Cadre bleu, filigrane, barre à branches dépliables, repli à 72 px mémorisé (`sim-documents-barre-repliee`), tiroir mobile, alerte de stockage dans l'en-tête, menu du profil au clavier |
| §1.6 Navigation | `domaine/navigation.ts` + test | Fonction pure. Conditions d'affichage **recopiées de l'ancien layout** ; le test les compare à une copie de l'ancienne logique pour les 6 profils par défaut et sur 3 072 combinaisons de niveaux |
| §1.7 Vérification publique | `verif/[jeton]/page.tsx` | Même coquille, statut en `Pastille` (valide succès, annulé danger, expiré neutre), aucune donnée de plus |
| §1.8 Règles | `CLAUDE.md` « Design system », D30 | |

## Captures

`docs/captures/refonte-v1/avant/` et `apres/`, en 1440 px et 390 px, données de test inventées uniquement (obtenues par les tests de bout en bout) : connexion et erreur de connexion, `/verif` (valide, annulé, expiré, inconnu), mot de passe à changer, accès refusé, accueil, liste des cotations, choix du produit et **formulaire de cotation**, liste des factures, **alerte de stockage** (administrateur). Seulement « après » : barre repliée, tiroir mobile, menu du profil. Le script `app/scripts/capturer-ecrans.mjs` les reproduit (Playwright, hors dépendances du projet).

## Revue contradictoire

Quatre relecteurs indépendants ont relu le travail sans le modifier. Ils n'ont trouvé **aucun écart de périmètre ni de navigation**, mais des défauts réels, **tous corrigés avant ce commit** (détail dans D30) : classes CSS écrasées par un calque mal placé, anneau de focus à 2,5:1, débordement permanent de 6 px, tiroir mobile sans gestion du focus, alerte de stockage qui recouvrait le menu du profil sur petit écran, champs de 14 px (zoom de Safari sur iPhone), puces de statut décolorées par ma migration automatique, champs invisibles dans les panneaux pâles, trous du test anti-couleurs. Les corrections sont vérifiées sur la version construite : 16 contrôles automatiques (pas de défilement parasite, repli mémorisé, premier Tab sur « Aller au contenu », anneau de focus bleu, tiroir : focus entrant, contenu inerte, Tab confiné, Échap qui rend le focus, pas de débordement à 390 px).

## Tests

| Suite | Résultat |
| --- | --- |
| Unitaires (`npm test`) | 401 verts (333 avant) : navigation (27), anti-couleurs (3), proxy (20), bibliothèque d'interface (19) |
| Intégration (`npm run test:integration`) | 176 verts (inchangé) |
| Bout en bout (`npm run test:e2e`, vrai générateur) | en cours au moment de ce commit (voir le commit suivant) |
| Générateur (`pytest`) | 220 verts (inchangé) |
| `npm run lint`, `npm run typecheck`, `npm run build` | propres |

Aucun test métier n'a été modifié.

## Écarts avec les instructions, à valider

- **Branche** : celle de la session, pas `refonte-visuelle`.
- **Deux couleurs assombries** pour tenir WCAG AA en texte : `success` `#15803d` (le portail : `#16a34a`, 3,3:1) et `sidebar-section` `#64748b` (le portail : 2,6:1).
- **Champs teintés** (`primary-bg`), comme demandé ; le code du portail laisse le fond transparent, donc blanc. Se change à un seul endroit (`classesControle`).
- **Alerte de stockage** : bandeau sous la barre du haut (texte entier) plutôt qu'étiquette dans les 64 px de la barre, qui recouvrait le menu du profil sur petit écran.
- **Accès refusé** : la page sort du groupe `(protege)` (URL inchangée) et porte son propre bouton « Déconnexion », sous la carte, comme l'écran de mot de passe à changer.
- **Expiré en neutre** sur la page publique de vérification (consigne) : avant, tout statut non valide était rouge ; un code inconnu reste en danger.
- **Ordre du Paramétrage** : celui de la consigne (Produits, Branches, Taxes, Intermédiaires, Société) ; l'ancien bandeau mettait Intermédiaires avant Taxes.
- **Logos** : copiés tels quels ; `.gitattributes` du dépôt normalise leurs fins de ligne en LF (même rendu).
- **`vitest.config.mts`** accepte maintenant les fichiers `.test.tsx`.

## Laissé à la V2 (visible dès maintenant)

Les boutons et liens-boutons des pages gardent leur style d'avant à côté de `FormulaireAction` (déjà en `Bouton`) ; les `<select>` des pages restent blancs à côté des champs teintés ; chaque page répète son titre sous celui de la barre du haut ; les tableaux, statuts, en-têtes et indicateurs ne sont pas encore en `Tableau`, `Pastille`, `EnTetePage`, `CarteIndicateur`.

## Non vérifié

Rien n'a été essayé hors Chromium sous Linux : ni Safari sur iPhone (le zoom au focus est évité par les 16 px, pas constaté), ni Windows, ni lecteur d'écran réel ; les formulaires métier n'ont pas été soumis dans un navigateur (seule la connexion l'a été, par les captures et les contrôles) ; `npm run dev` n'a pas été lancé.

## Pour Thierry : essai de la V1

1. `npm run build` puis `npm start` (ou ton `npm run dev`), connexion avec un compte de chaque profil : le menu de chacun doit montrer **exactement** les écrans qu'il voyait avant (le test le garantit, regarde-le quand même).
2. Barre repliée, rechargement de la page (la préférence est gardée), navigation au clavier (Tab, Échap), tiroir sur un téléphone.
3. Un compte dont le mot de passe doit être changé : l'écran de changement et le bouton « Déconnexion » dessous.
4. Un QR code de facture annulée et un jeton inconnu sur `/verif/…` depuis un téléphone.
5. Dire si tu gardes les champs teintés, le bandeau d'alerte et « Expiré » en neutre ; ensuite seulement, lancer la V2.
