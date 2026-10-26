# Socle de paramétrage des produits — document d'exploration (23/10/2026)

> Avec la Direction Technique. Objectif : un socle unique pour paramétrer **n'importe quel produit** (garanties, champs, sous-jacents, formules) **sans code propre au produit**.
> Vérifié contre les 6 feuilles finales du simulateur V8.

---

## 1. Lecture des trois approches proposées

Les trois approches ne s'opposent pas : ce sont **trois étages** du même socle.

| Approche | Ce qu'elle apporte | Ce qui lui manque |
|---|---|---|
| 1. Garantie : nom, taux, limite de capital, définition (affichée ou non) | La **fiche de base** de toute garantie | Le taux est fixe : il ne varie pas selon le risque (classe, gardien…) |
| 2. Taux et limites **par catégorie** | Le taux varie selon une catégorie (classe 1 à 4) | La « catégorie » est elle-même **déduite d'un champ** (type de commerce → classe) : c'est déjà un sous-jacent. Attention à **ne pas mélanger** deux notions : la **classe de risque** (tarif) et la **catégorie de taxe** (fiscalité) |
| 3. Sous-jacents qui agissent sur le taux d'une garantie | La forme générale : un champ du risque modifie le calcul d'une ou plusieurs garanties | Il faut définir **comment** un sous-jacent agit, sans laisser la Technique écrire des formules libres partout |

**Conclusion** : le socle = approche 1 (fiche garantie) + approche 3 (sous-jacents), l'approche 2 devenant un cas particulier de la 3 (le sous-jacent « classe » choisit le taux dans une table).

---

## 2. Le constat qui simplifie tout

Dans les **6 produits** du simulateur, toutes les primes suivent la même équation :

```
prime d'une garantie = assiette × taux × coefficients     (puis minimum, × effectif, − réduction)
```

et un sous-jacent n'agit jamais que de **cinq façons** :

| # | Effet d'un sous-jacent | Exemple du simulateur |
|---|---|---|
| E1 | **Choisit le taux** dans une table | Type de commerce → classe → taux incendie 0,72 ‰ … 1,24416 ‰ (SECURPRO) ; âge de la moto → 2,5 % … 9,7 % (SECURMOTO) |
| E2 | **Multiplie** le taux ou la prime (coefficient) | Gardien et extincteurs → × 0,80 / × 0,90 (incendie) ; électronique → × 1,2 (vol contenu) |
| E3 | **Donne l'assiette** (le capital) | Loyer × 120 (risque locatif) ; nombre de pièces × 1 333 500 (SECURHOME) ; 15 % du contenu plafonné à 2 000 000 (vol contenu) ; valeur moto × 50 / 35 / 20 % |
| E4 | **Contrôle** (plafond, condition) → refus avec message | Capitaux > limite de la classe ; valeur moto > 700 000 ; vol seulement pour une moto neuve |
| E5 | **Ajoute ou borne** un montant | Minimum de prime 2 500 (vol caisse) ; accessoires par tranche d'effectif (IA) |

**Conséquence** : la Technique n'a pas besoin d'écrire des formules libres. Elle choisit, pour chaque sous-jacent, **un effet parmi cinq**, la ou les **garanties ciblées**, et remplit une **valeur ou une table**. Le moteur applique toujours le même ordre de calcul (section 6).

Un seul cas a besoin de **deux champs à la fois** : gardien ET extincteurs → 0,80 (ce n'est pas 0,90 × 0,90 = 0,81). Solution : un sous-jacent peut lire **une table à deux entrées** (gardien × extincteurs → coefficient).

---

## 3. Les champs (ce que le Commercial remplit, comme dans le Word)

| Propriété d'un champ | Valeurs |
|---|---|
| Code | `type_commerce` (devient la balise Word `risque.type_commerce`) |
| Libellé, aide | « Type de commerce » |
| **Type** | texte · nombre · montant · date · oui/non · **liste déroulante** · liste à choix multiples |
| Valeurs de la liste | saisies par la Technique (Bureau, Épicerie…) ; chaque valeur peut porter une **valeur tarifaire** (classe, coefficient) |
| Obligatoire | oui / non |
| Bornes | min / max (ex. valeur moto ≤ 700 000) |
| **Condition d'affichage** | « si occupation = Locataire » → loyer mensuel ; « si Propriétaire » → valeur du bâtiment |
| Bloc | regroupement à l'écran : « Local et sécurité », « Capitaux », « Personnes »… (un bloc réutilisable par plusieurs produits) |
| Sur les documents | oui / non (balise `risque.*`) |

Un champ **sans sous-jacent** est une simple **déclaration** (ex. la caméra aujourd'hui) : il est saisi et imprimé, sans effet sur la prime.

---

## 4. La fiche d'une garantie (approche 1, complétée)

| Propriété | Exemple (Dégâts des eaux, SECURPRO) |
|---|---|
| Code, nom | `dde`, « Dégâts des eaux » |
| **Définition** (texte) + **afficher sur les documents** oui/non | « Garantit les dommages causés par… » — oui |
| Souscription | obligatoire / **optionnelle** (case Oui/Non à la cotation) / selon une condition |
| **Assiette** (capital) | un champ (`dde_montant`) ; ou une valeur fixe ; ou une table ; ou une **opération simple** (somme de champs, champ × constante, % d'une autre valeur plafonné) |
| **Taux de base** | 6 ‰ ; ou une **table** selon un sous-jacent (E1) |
| Limite de capital | 1 500 000 (au-delà : refus ou plafonnement, au choix) |
| Minimum de prime | facultatif (2 500 pour le vol caisse) |
| Par tête | oui (× effectif) / non |
| **Catégorie de taxe** | IARD — **par défaut celle du produit**, modifiable par garantie |
| **Accessoires** | 2 500 — **par défaut ceux du produit**, modifiables par garantie ; modes : par garantie, par contrat, par tête, par tranche d'effectif |

> Réponse au « Warning » : taxe et accessoires se renseignent **une fois pour le produit**, et **une garantie peut les remplacer** (héritage). L'IA en a besoin : « Décès toutes causes » à 0 % alors que le reste est à 7,25 %.

---

## 5. Les sous-jacents (approche 3, rendue précise)

| Propriété d'un sous-jacent | Exemple 1 (SECURPRO) | Exemple 2 (SECURPRO) |
|---|---|---|
| Nom | Classe d'activité | Sécurité incendie |
| Champ(s) lu(s) | `type_commerce` | `gardien`, `extincteurs` |
| **Effet** (E1 à E5) | E1 — choisit le taux | E2 — coefficient |
| Garantie(s) ciblée(s) | Incendie | Incendie |
| Table | Bureau → 0,72 ‰ ; Épicerie → 0,864 ‰ ; … | Oui+Oui → 0,80 ; Oui+Non → 0,90 ; Non+Oui → 0,90 ; Non+Non → 1 |
| Valeur si réponse absente de la table | **refus** (jamais 0) | 1 |

Un sous-jacent peut cibler **plusieurs garanties**, et une garantie peut avoir **plusieurs sous-jacents** (leurs coefficients se multiplient).

---

## 6. L'ordre de calcul (fixe, le même pour tous les produits)

1. Contrôler les **champs** (obligatoires, bornes, valeurs de liste).
2. Calculer les **valeurs intermédiaires** (classe, capital immobilier, contenu…).
3. Pour chaque **garantie souscrite** :
   assiette (E3) → taux de base ou table (E1) → × coefficients (E2) → minimum (E5) → × effectif si par tête → − réduction commerciale.
4. Appliquer les **contrôles** (E4) : un seul échec = refus avec son message.
5. **Accessoires** (mode du produit ou de la garantie), **taxes** par catégorie, **TTC** — déjà dans l'application.
6. Produire les **lignes de composition** — déjà dans l'application : tout l'aval (validation, CP, facture, documents) ne change pas.

---

## 7. Preuve sur deux produits

### SECURPRO
| Élément | Paramétrage |
|---|---|
| Champs | type_commerce (liste), occupation (liste), situation (liste), gardien, extincteurs, camera, volet (oui/non), loyer_mensuel (si locataire), valeur_batiment (si propriétaire), stocks, materiel, mobilier, amenagement, informatique, montants des 1ers risques |
| Valeurs intermédiaires | capital_immo = loyer × 120 **ou** valeur_batiment ; contenu = somme de 5 champs ; capitaux_totaux = capital_immo + contenu |
| Garantie Incendie | assiette capitaux_totaux ; taux par table (classe) [E1] ; × sécurité incendie [E2] ; INCENDIE 12,5 % ; 2 500 |
| Garantie Vol contenu | assiette min(15 % du contenu ; 2 000 000) [E3] ; 1 % ; × 1,2 si électronique ou mèches [E2] |
| Garantie Vol caisse | assiette vol_caisse_montant ; 2,5 % ; minimum 2 500 [E5] ; × 1,25 si superette, quincaillerie… [E2] |
| DDE, DE, BDG, Tempête, TRI | assiette = montant ; taux fixe 6 ‰ / 10 ‰ / 20 ‰ / 0,72 ‰ / 4 ‰ |
| Contrôle | capitaux_totaux > limite(classe, situation) → refus [E4] |

### RELAXACCIDENTS (IA)
| Élément | Paramétrage |
|---|---|
| Champs | profession (texte), type_activite (liste → classe), type_couverture (liste), effectif, IJ (liste 1 500…5 000), frais_medicaux (liste), IPT et décès accidentel (montants), décès toutes causes (oui/non + montant) |
| Garanties | IJ : montant choisi × taux(classe) [E1] ; frais médicaux : table (montant × classe) [E1] ; IPT, DA : capital × taux(classe) ; DTC : capital × 0,55 % — **par tête** |
| Particularités | DTC en catégorie DÉCÈS 0 % ; réduction selon l'effectif (liste 0 à 40 %) ; accessoires par tranche d'effectif [E5] |

**Les 6 produits du simulateur se décrivent ainsi sans formule libre.** RELAXSANTE reste plus simple en mode « formule » (prime par catégorie de personne × effectif), déjà dans l'application.

---

## 8. Options pour les « formules »

| | A. Effets typés + tables, sans formule libre (recommandé pour la version 1) | B. Formules libres contrôlées (langage d'expressions) | C. Hybride : A, plus une formule libre en dernier recours sur une garantie |
|---|---|---|---|
| Pour la Technique | Des listes et des tableaux, comme dans Excel, sans syntaxe | Écrire `capitaux * taux * si(gardien; 0,9; 1)` | A au quotidien ; B pour un cas exceptionnel |
| Couvre le simulateur | Les 6 produits | Tout | Tout |
| Sûreté | Haute : rien ne peut être mal écrit, chaque table se vérifie | Moyenne : une formule fausse passe si les jeux d'essai ne l'attrapent pas (cf. cellule `H33`) | Haute sur l'essentiel |
| Effort | Moyen (écrans de tables) | Élevé (analyseur, éditeur, messages d'erreur) | A + B |
| Évolution | Un nouvel effet = un développement | Aucun développement | Un développement seulement pour un cas vraiment nouveau |

> Je révise ma recommandation de ce midi (formules courtes partout) : après l'analyse champ par champ des 6 produits, **A suffit** et reste **compréhensible par la Technique**. C reste la voie d'évolution si un futur produit sort des cinq effets.

**Dans tous les cas** : des **jeux d'essai** enregistrés avec chaque version du produit (entrées + TTC attendu, validés par la Technique contre le simulateur corrigé) ; la version ne se publie que si tous passent.

---

## 9. Questions à trancher en équipe
1. Les **cinq effets** (E1 à E5) couvrent-ils tous les produits SIM, y compris ceux hors simulateur (RELAXVOYAGE, SECURECOLTE, produits IMF) ?
2. Au-delà d'une **limite de capital** : refus, ou plafonnement automatique du capital ?
3. Les **blocs de champs** réutilisables (« Local et sécurité », « Personnes ») : utiles, ou chaque produit définit ses champs ?
4. Qui saisit les tables (Technique) et qui **valide** une nouvelle version de produit avant publication ?
5. Garde-t-on la **composition manuelle** (mode actuel) comme secours quand un cas sort du barème ?

## 10. Suite proposée
1. Valider ce modèle (sections 2 à 6) et répondre aux questions 9.
2. Session « options » : modèle de données et écrans (au moins 2 options), sans code.
3. Moteur pur + jeux d'essai, avec SECURPRO **inventé** ; puis paramétrage de SECURPRO réel par la Technique.
4. Délai : fin de stage fin octobre → le **modèle validé et documenté** est le livrable sûr ; le moteur complet peut être la première tâche du successeur.
