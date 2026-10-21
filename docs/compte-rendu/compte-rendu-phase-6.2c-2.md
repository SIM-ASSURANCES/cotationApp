# Compte rendu — session 6.2c-2 (Réductions selon l'effectif : options)

Branche `phase-6.2c-2`. Livrable : [`docs/propositions-6.2c-2.md`](../propositions-6.2c-2.md). **Aucun code, aucune migration.**

## Synthèse de l'analyse et constats

1. **Produits par garanties (IA / RELAXACCIDENTS)** :
   - Le produit IA est en mode `GARANTIES` depuis la 6.2a (D32, D37) : la Technique saisit déjà prime nette et accessoires ligne par ligne.
   - Les accessoires dégressifs par personne sont calculés par la Technique dans son simulateur et saisis : **aucun nouveau mode d'accessoires n'est nécessaire** dans le moteur tant que l'IA reste en mode par garanties.
2. **Produits à la formule (SECURMOTO, RELAXSANTE)** :
   - Le moteur actuel applique la formule stricte sans réduction. C'est ici que le moteur devra évoluer lors de la réalisation.
3. **Anomalies du simulateur corrigées dans les spécifications** :
   - *Anomalie n° 1 (trous dans les tranches)* : tranches contiguës strictes `[min_effectif, max_effectif]`, sans trou ni chevauchement, testées aux bornes.
   - *Anomalie n° 2 (assiette fiscale)* : calcul légal CIMA de la taxe **après réduction** sur la prime nette réellement exigible (+ accessoires).

## Options analysées et recommandations

- **Produits à la formule (`FORMULES`)** :
  - **Option 1.A (Recommandée, 2,5 j)** : table de tranches d'effectifs avec taux maximal de réduction dans la version du produit ; saisie d'un taux demandé ; si dépassement de tranche, passage en `« À valider »` (réutilisation du circuit `FORCER_PRIME`).
  - *Option 1.B (1,5 j)* : réduction libre validée systématiquement.
  - *Option 1.C (3,5 j)* : rabais automatique par tranche + sur-remise commerciale.
- **Produits par garanties (`GARANTIES`)** :
  - **Option 2.B (Recommandée, 0 j)** : la Technique applique la réduction dans son calcul amont et saisit la prime nette finale remisée. Traçabilité par le motif obligatoire de composition (`COTATION_COMPOSEE`). Zéro code, zéro risque de distorsion fiscale multi-branches (H94 préservée).
  - *Option 2.A (2 j)* : ligne de composition négative (écartée car ambiguïté fiscale multi-branches).
  - *Option 2.C (1 j)* : taux de réduction global en % au prorata des garanties.

## Questions pour la Technique

Cinq questions rédigées dans [`docs/propositions-6.2c-2.md`](../propositions-6.2c-2.md) prêtes à être envoyées par Thierry à la Technique (barèmes d'effectif, caractère automatique ou facultatif, valideurs habilités, validation de l'option 2.B et confirmation de l'assiette fiscale).
