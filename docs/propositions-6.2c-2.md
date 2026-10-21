# Propositions d'architecture — Session 6.2c-2 : Réductions selon l'effectif

> Document d'analyse et de propositions préalables à tout développement (phase 6.2c-2).
> **Périmètre** : analyse technique, options comparées, spécifications de calcul et questions pour la Direction Technique.
> **Règle** : aucun code ni migration dans cette session. La réalisation sera menée lors d'une session ultérieure après décision de Thierry et retour de la Technique.

---

## 1. Contexte et constats préalables

### 1.1 Produits par garanties et accessoires dégressifs (ex : RELAXACCIDENTS / IA)
- **Constat** : Le produit Individuelle Accidents (**IA / RELAXACCIDENTS**) a été basculé en mode `GARANTIES` lors de la session 6.2a (D32, D37). En mode `GARANTIES`, la prime n'est pas calculée par le moteur : la Technique compose directement chaque ligne (libellé, branche fiscale, prime nette, accessoires, montant garanti).
- **Conséquence sur les accessoires dégressifs** : Les accessoires dégressifs selon le nombre de personnes (ex. 2 500 F pour 1 personne, 2 000 F par personne pour 2 à 5, etc.) sont calculés dans le simulateur de la Technique et saisis manuellement dans les champs accessoires de la composition.
- **Décision** : **Aucun nouveau mode d'accessoires dégressifs n'est à développer** dans le moteur de calcul tant que l'IA reste gérée en mode par garanties.

### 1.2 Produits à la formule (ex : SECURMOTO, RELAXSANTE)
- **Constat** : Les produits santé et auto en mode `FORMULES` utilisent le moteur automatique (`primeUnitaire × effectif × prorata + accessoires + taxe`).
- **Besoin** : Une réduction commerciale selon l'effectif du groupe ou selon une négociation commerciale doit pouvoir être accordée sur ces contrats. C'est sur ce mode de tarification que le moteur de calcul doit évoluer.

### 1.3 Hypothèse H94 et montants négatifs
- L'hypothèse **H94** (D32) interdit actuellement tout montant négatif dans une composition (`prime nette > 0`, `accessoires ≥ 0`). Toute évolution sur la composition par garanties doit prendre en compte cette contrainte.

---

## 2. Réductions sur un produit à la formule (`FORMULES`)

### 2.1 Description des options

#### Option 1.A — Barème de réduction par tranches d'effectif paramétré + forçage en cas de dépassement (Recommandée)
- **Principe** :
  - La version historisée du produit définit une table de tranches d'effectif avec le taux maximal de réduction autorisé pour chaque tranche.
    *Exemple inventé* :
    - [1 à 5 assurés] : 0 % (aucune réduction autorisée sans validation)
    - [6 à 10 assurés] : réduction maximale autorisée = 5 %
    - [11 à 25 assurés] : réduction maximale autorisée = 10 %
    - [26 assurés et plus] : réduction maximale autorisée = 15 %
  - À la saisie de la cotation, le commercial peut renseigner un taux de réduction demandé (en pourcentage, entier ou décimal à 1 chiffre).
  - Si le taux demandé est **inférieur ou égal au maximum de la tranche**, la cotation est valide et s'émet selon le circuit normal (ou sous seuil TTC).
  - Si le taux demandé **dépasse le maximum de la tranche** (ou si le commercial demande une réduction sur une tranche à 0 %), la cotation passe à l'état **« À valider »** avec motif obligatoire, empruntant le même circuit de validation que `FORCER_PRIME` (droit `VALIDER_COTATION`, Technique / Direction).

#### Option 1.B — Réduction commerciale libre (montant FCFA ou %), validation systématique
- **Principe** :
  - Aucun barème de tranches n'est stocké dans la version du produit.
  - Le commercial saisit librement une réduction (en montant fixe FCFA ou en pourcentage de la prime brute), accompagnée d'un motif obligatoire.
  - **Toute cotation comportant une réduction passe systématiquement par l'état « À valider »** avant émission (analogue à une prime forcée).
- **Conséquence** : Très rapide à mettre en place, mais fait peser la charge de chaque réduction sur les valideurs.

#### Option 1.C — Réduction automatique par tranche d'effectif + sur-remise commerciale optionnelle
- **Principe** :
  - La tranche d'effectif applique automatiquement un rabais contractuel (ex : 5 % dès 10 personnes) sans intervention humaine.
  - Le commercial peut en plus demander une sur-remise commerciale négociée, qui requiert une validation hiérarchique.
- **Conséquence** : Combinaison puissante mais plus lourde à paramétrer, à tester et à afficher clairement pour le souscripteur.

---

### 2.2 Analyse comparative des options (Formules)

| Critère | Option 1.A (Barème + Forçage) | Option 1.B (Réduction libre validée) | Option 1.C (Automatique + Sur-remise) |
|---|---|---|---|
| **Avantages** | Autonomie encadrée des commerciaux ; respecte la politique commerciale de la compagnie ; circuit de validation existant réutilisé | Zéro paramétrage de tranches ; simplicité de saisie ; contrôle total de la hiérarchie | Zéro oubli d'application des barèmes contractuels ; flexibilité pour les grands comptes |
| **Limites** | Écran de paramétrage de version produit enrichi (table des tranches) | Validation obligatoire même pour les remises usuelles (engorgement potentiel) | Complexité d'affichage (distinction remise barème vs remise commerciale) ; risque de confusion |
| **Coût estimé** | **2,5 jours** | **1,5 jour** | **3,5 jours** |
| **Niveau de risque** | Faible (décalque le mécanisme de `FORCER_PRIME`) | Faible (très simple côté moteur) | Moyen (double réduction à ordonnancer) |
| **Recommandation** | **Recommandée** | Option de repli si la Technique n'a pas de barème fixe | À écarter pour le moment |

---

### 2.3 Spécifications techniques indispensables pour le calcul à la formule

#### Règle n° 1 : Assiette de la taxe (anomalie n° 2 du simulateur à ne pas reproduire)
- **Anomalie constatée dans le simulateur Excel** : La taxe d'assurance y était calculée sur la prime nette brute avant application de la réduction.
- **Règle fiscale impérative (CIMA / Droit ivoirien)** : La taxe d'assurance frappe les sommes effectivement exigibles auprès de l'assuré (prime nette nette de remises + accessoires).
- **Formule retenue** :
  $$\text{Assiette} = \text{Prime Nette Réduite} + \text{Accessoires} \quad (\text{ou } \text{Prime Nette Réduite seule si assiette = NETTE})$$
  $$\text{Taxe} = \text{Assiette} \times \text{Taux de Taxe}$$

#### Règle n° 2 : Ordre d'enchaînement du calcul
Pour chaque formule :
1. $\text{Prime brute annuelle} = \text{PrimeUnitaire} \times \text{Effectif}$
2. $\text{Prorata} = \text{Prime brute} \times \text{coef\_prorata}$
3. $\text{Réduction} = \text{Prorata} \times \text{taux\_reduction}$
4. $\text{Prime nette brute après réduction} = \text{Prorata} - \text{Réduction}$
5. $\text{Plancher} = \max(\text{Prime nette après réduction}, \text{PrimeMinimale})$ (la réduction ne peut descendre sous la prime minimale si celle-ci est paramétrée)
6. $\text{Accessoires} = \text{accessoiresDe}(\text{mode}, \text{valeur}, \text{effectif}, \text{nette\_reduite})$ (si mode `%`, assis sur la nette réduite)
7. $\text{Taxe} = \text{taxer}(\text{nette\_reduite}, \text{accessoires}, \text{taux}, \text{assiette})$
8. $\text{Arrondis} = \text{arrondirComposants}$ selon la règle du produit (`LIGNE` ou `TOTAL`). Invariant strict préservé : $\text{TTC} = \text{Nette} + \text{Accessoires} + \text{Taxe}$.

#### Règle n° 3 : Tranches bornées sans trou (anomalie n° 1 du simulateur à ne pas reproduire)
- **Anomalie constatée dans le simulateur Excel** : Certaines tranches présentaient des discontinuités (ex. tranche [1-10] puis [12-20], omettant 11).
- **Spécification du module** :
  - Les tranches sont définies par `min_effectif` et `max_effectif` (`null` pour l'infini).
  - Contrôle bloquant au paramétrage : la tranche $k$ commence exactement à $\text{max}_{k-1} + 1$.
  - La première tranche commence obligatoirement à 1, la dernière tranche a `max_effectif = null`. Aucun effectif valide ne peut être orphelin.

#### Règle n° 4 : Dictionnaire DOCX pour les modèles Word
Nouveaux champs proposés pour les modèles de Conditions Particulières (`CP`) et Factures :
- `formules[].taux_reduction` : pourcentage de réduction accordé sur la formule (ex : `"10 %"`, vide ou `"0 %"` si aucune).
- `formules[].montant_reduction` : montant en FCFA de la réduction sur la ligne.
- `prime.nette_avant_reduction` : prime nette globale avant réduction.
- `prime.reduction_totale` : total des réductions accordées sur la cotation.
- `prime.nette` : prime nette finale exigible après réduction (champ existant inchangé).

---

## 3. Réductions sur un produit par garanties (`GARANTIES`)

En mode `GARANTIES` (ex : SECURPRO), la Technique saisit manuellement les lignes de prime.

### 3.1 Description des options

#### Option 2.A — Ligne de réduction négative dans la composition (Assouplissement de H94)
- **Principe** : Permettre d'ajouter une ligne de prime particulière de libellé « Réduction commerciale » avec un montant négatif.
- **Difficulté majeure** : Chaque ligne de composition est rattachée à une **branche fiscale** (ex : Incendie à 12,5 %, IARD à 7,25 %). Si la négociation commerciale porte sur une réduction globale de 50 000 F CFA sur la police, sur quelle branche faut-il imputer cette ligne négative ?
  - Si imputée sur une seule branche, la fiscalité est faussée au détriment ou au bénéfice de l'assureur.
  - Si ventilée, la Technique doit calculer elle-même la quote-part négative sur chaque garantie, ce qui est source d'erreurs.
  - Risque d'avoir une prime nette négative sur une branche si la réduction dépasse la prime de ladite branche.
- **Recommandation** : **À écarter.**

#### Option 2.B — Saisie directe de la prime nette remisée par la Technique avec justification dans le motif (Recommandée)
- **Principe** :
  - **Aucun développement informatique supplémentaire.**
  - La Technique applique la réduction commerciale convenue directement dans son calcul préalable (sur son simulateur interne) et entre les montants nets réduits pour chaque garantie.
  - La traçabilité et l'audit sont pleinement assurés par le champ obligatoire `composition_motif` de `composerLaPrime` (obligatoire, 3 à 500 caractères, tracé dans le journal `COTATION_COMPOSEE`).
    *Exemple de motif* : *« Remise commerciale de 10 % accordée selon accord DG du 21/10 pour flotte de 35 véhicules »*.
- **Avantages** : Zéro coût, zéro délai, aucun risque de régression, conformité fiscale native (chaque branche garde sa quote-part exacte).

#### Option 2.C — Champ global « Taux de réduction commerciale (%) » sur la cotation composée
- **Principe** :
  - La Technique saisit les garanties à leur tarif normal hors réduction.
  - Un champ d'en-tête « Taux de réduction (%) » applique une décote uniforme de $X\,\%$ sur la prime nette de chaque garantie souscrite.
  - La taxe de chaque garantie est calculée sur la prime nette remisée.
- **Coût estimé** : **1 jour**.

---

### 3.2 Analyse comparative des options (Garanties)

| Critère | Option 2.A (Ligne négative) | Option 2.B (Saisie nette remisée + motif) | Option 2.C (Taux global %) |
|---|---|---|---|
| **Avantages** | Réduction explicite sous forme de ligne | **Zéro développement** ; traçabilité totale au journal ; aucune ambiguïté de ventilation fiscale | Réduction explicite ; calcul de ventilation automatique et uniforme |
| **Limites** | Casse-tête de ventilation de taxe multi-branches ; contredit H94 ; risque de montants négatifs | La réduction n'apparaît pas comme une ligne séparée sur les CP | Ne permet pas des réductions différenciées selon les garanties |
| **Coût estimé** | 2 jours | **0 jour** | 1 jour |
| **Niveau de risque** | Élevé (fiscalité) | **Nul** | Faible |
| **Recommandation** | À écarter | **Recommandée** | Alternative acceptable si la Technique exige un taux global |

---

## 4. Questions pour la Direction Technique (prêtes pour envoi par Thierry)

Voici les questions précises, formulées pour être transmises telles quelles à la Direction Technique :

> ### Message à destination de la Direction Technique :
>
> **Objet : Spécifications des réductions selon l'effectif et réductions commerciales (Phase 6.2c-2)**
>
> Dans le cadre de la mise en place de la tarification des contrats de groupe et des remises commerciales, merci de nous éclairer sur les points suivants :
>
> 1. **Barèmes par effectif (Santé / Auto à la formule)** :
>    Quelles sont les tranches d'effectifs officielles et les taux de réduction maximaux applicables pour les produits à la formule (notamment SECURMOTO et RELAXSANTE) ?
>    *Exemple : [1-5] = 0 %, [6-10] = 5 %, [11-20] = 10 %, [21 et +] = 15 % ?*
>
> 2. **Application de la réduction** :
>    La réduction selon la tranche d'effectif doit-elle s'appliquer **automatiquement** dès la saisie de l'effectif, ou rester une **faculté facultative** activée par le Commercial dans la limite du barème autorisé ?
>
> 3. **Circuit de validation des dépassements** :
>    Si un Commercial sollicite un taux supérieur au barème autorisé pour un effectif donné, qui est habilité à valider cette dérogation (profil `TECHNIQUE` seul, `DIRECTION_GENERALE` seule, ou l'un des deux) ?
>
> 4. **Produits tarifés par garanties (SECURPRO, RELAXACCIDENTS, etc.)** :
>    Pour les produits dont vous composez manuellement la prime par garantie, confirmez-vous qu'une remise commerciale éventuelle est directement déduite par vos soins lors de la saisie de la prime nette, avec justification dans le motif obligatoire de composition (Option 2.B) ? Ou souhaitez-vous un champ spécifique de réduction en % ?
>
> 5. **Confirmation de l'assiette fiscale** :
>    Confirmez-vous que la taxe d'assurance légale doit être assise sur la prime nette **après déduction** de la réduction commerciale (taxe sur la prime nette réellement facturée au client + accessoires), conformément aux règles du code CIMA ?
