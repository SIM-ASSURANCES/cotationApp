Interface (composants React) : n'importe jamais `serveur/` (règle vérifiée par ESLint) ; reçoit ses données par les props.

| Dossier | Rôle |
| --- | --- |
| `ui/` | Bibliothèque d'interface du design system (`Bouton`, `Champ`, `Carte`, `Pastille`, `Tableau`, `Icone`…) : noms français, aspect seulement, jamais de comportement métier. Règles : « Design system » de `CLAUDE.md`. |
| `coquille/` | `Coquille` (application : cadre bleu, barre latérale, barre du haut) et `CoquilleConnexion` (connexion, accès refusé, mot de passe à changer, page publique `/verif`). |

Les autres fichiers sont des composants de formulaire propres à l'application (`FormulaireAction`, `LignesFormules`…).
