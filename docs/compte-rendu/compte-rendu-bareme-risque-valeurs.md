# Barème, documents : valeurs intermédiaires et attributs tarifaires sous `risque.*`

Branche `bareme-risque-valeurs` (depuis `main`). Commits locaux, rien de poussé. Décision D54, hypothèse H148.

## Ce qui change
- `risqueDuBareme` (`domaine/bareme/documents.ts`) fournit désormais trois familles de balises : (1) champs du barème (inchangé) ; (2) attributs tarifaires de la valeur choisie d'un champ liste, `risque.<champ>_<attribut>` (SECURPRO : `risque.type_commerce_classe`) ; (3) valeurs intermédiaires calculées par le moteur (`risque.contenu`, `risque.capital_immo`, `risque.capitaux_totaux`).
- Elles sont figées avec la cotation (`cotation.risque`, reprise par la police) au même endroit que les champs : aucune autre couche touchée.
- `codesRisqueDuBareme` les inclut : le contrôle des modèles au dépôt (D52) ne les signale plus comme inconnues.
- Une valeur qui dépend d'un champ inapplicable vaut « » (jamais zéro). Même code sur deux sources : le champ gagne, puis l'attribut, puis l'intermédiaire. Seuls les attributs au nom de balise valide sont exposés (H148).
- `guide-balisage.md` mis à jour.

## Tests (SECURPRO inventé)
- Unitaires (`documents.test.ts`) : contenu 8 866 500, capital_immo 18 000 000 (loyer × 120), capitaux_totaux 26 866 500 (locataire) ; 1 000 000 / 20 000 000 / 21 000 000 (propriétaire) ; classe 2 (Électronique), 1 (Bureau), 4 (Quincaillerie) ; attribut et intermédiaire vides si le champ est inapplicable ; priorité du champ sur un intermédiaire de même code.
- Intégration (`cotation-bareme.integration.test.ts`, 18/18) : la cotation enregistrée porte ces valeurs, la demande de PDF les reçoit, le dépôt d'un modèle qui les emploie ne produit aucun avertissement.
- Unitaires 673/673 ; `tsc` et eslint (domaine/bareme, test d'intégration) verts.
- Non lancés : suite d'intégration complète, e2e, `npm run build`, pytest. `cotations.integration.test.ts > le format du numéro de police se paramètre` ÉCHOUE déjà sur `main` sans mes changements (constaté par remise de `main`) : sans rapport, à regarder à part.

## Besoins notés (non codés)
- Les cotations enregistrées avant D54 n'ont pas ces clés (non recalculées) : un modèle qui les emploie n'est pas garanti de se générer pour elles tant qu'elles ne sont pas réenregistrées (à vérifier).
- Pas de recette sur un vrai PDF : le générateur est simulé en test.

## Commits
(voir `git log` de la branche)
