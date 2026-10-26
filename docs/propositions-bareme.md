# Propositions — moteur de barème (session B1)

> Document d'options, **aucun code, aucune migration**. Cahier des charges : [socle-parametrage.md](socle-parametrage.md). Décisions déjà prises : instructions B1 (9 points) et réponses de la Technique du 23/10/2026 (A1 à A8, tracées en D47 et H133 à H136 de [decisions.md](decisions.md)).
> Vocabulaire : le **barème** d'une version de produit = ses champs, garanties, sous-jacents, tables et jeux d'essai. Mode `BAREME` = la prime est calculée, **mode cible de tous les produits** (D48) ; `FORMULE` reste pour la santé ; la composition manuelle (ex-mode `GARANTIES`) devient un **secours par cotation**.

## 0. Recommandations en un coup d'œil

| # | Sujet | Recommandation |
|---|---|---|
| 1 | Stockage | **(c)** document JSON validé (zod) dans une **table dédiée** `bareme_documents` (brouillon, publié, empreinte SHA-256), plus un contrôle d'intégrité en TypeScript pur |
| 2 | Saisie Technique | **(a)** écrans par onglets d'abord ; **(c)** export puis import Excel/JSON ensuite, sur le même document |
| 3 | Saisie Commercial | écran de cotation **généré** depuis les champs, résultat en lignes, détail des taux réservé à la Technique |
| 4 | Assiettes | 7 opérations fermées, profondeur 2 au plus, **valeurs intermédiaires nommées** pour le reste |
| 5 | Moteur | `domaine/bareme/`, fonctions pures, decimal.js, **le barème produit des lignes de prime** ; taxe, arrondi et TTC restent à `composer()` |
| 6 | Intégration | **même type `COMPOSITION`** avec `origine: "BAREME"` ; nouvelle version pour changer de mode ; renouvellement recalculé au barème en vigueur |
| 7 | Sessions | 8 sessions (B2 à B9), B2 sans écran ni migration ; ordre B3 → B9 → B6 → B4, B5 → B7, B8 |

Écart signalé d'entrée : **les chiffres réels du simulateur ne sont pas dans le dépôt** (D31). Le jeu d'essai du §1 est donc **inventé**, calé à la main sur 139 420 F ; la Technique doit le remplacer ou le confirmer (Q1).

## 1. Le cas d'épreuve : SECURPRO

### 1.1 Fiche neutre (valable pour toutes les options)

| Élément | Contenu |
|---|---|
| Produit | taxe par défaut **IARD 7,25 %** ; accessoires par défaut **2 500 par garantie souscrite** (Q2) ; arrondi du produit : 1 F, au plus proche, niveau ligne (A8) |
| Champs | `type_commerce` (liste : Bureau c1, Épicerie c2, Électronique c2, Mèches c3, Superette c3, Quincaillerie c4, la **classe** est une valeur tarifaire), `occupation` (Locataire / Propriétaire), `situation` (Boutique / En marché), `gardien`, `extincteurs`, `camera`, `volet` (oui/non), `loyer_mensuel` (si Locataire), `valeur_batiment` (si Propriétaire), `stocks`, `materiel`, `mobilier`, `amenagement`, `informatique` (montants), `dde_montant`, `de_montant`, `bdg_montant`, `tempete_montant`, `tri_montant`, `vol_caisse_montant` (listes de montants, A7) |
| Intermédiaires (E3) | `capital_immo` = loyer × 120, ou valeur du bâtiment ; `contenu` = somme des 5 champs ; `capitaux_totaux` = capital_immo + contenu |
| Incendie | obligatoire, taxe **INCENDIE 12,5 %** (remplace celle du produit) ; assiette `capitaux_totaux` ; taux par table de la classe **[E1]** : 0,72 / 0,864 / 1,0368 / 1,24416 ‰ ; × table gardien × extincteurs **[E2]** (0,80 / 0,90 / 0,90 / 1) |
| Vol (une garantie, A6) | composante **contenu** : min(15 % du `contenu` ; 2 000 000) × 1 % × 1,2 si Électronique ou Mèches **[E3, E2]** ; composante **caisse** : `vol_caisse_montant` × 2,5 %, minimum 2 500, × 1,25 si Superette ou Quincaillerie ; **un seul accessoire** pour la garantie |
| DDE, DE, BDG, Tempête, TRI | optionnelles ; assiette = montant du champ ; taux fixes 6 / 10 / 20 / 0,72 / 4 ‰ |
| Contrôle **[E4]** | `capitaux_totaux` > limite(classe, situation) → refus, texte saisi par la Technique (A2). Limites inventées : Boutique 100 / 80 / 60 / 50 M selon la classe 1 à 4 ; **En marché 5 000 000** pour les quatre classes (A3, un paramètre de la table, rien dans le code) |
| Déclarations | `camera`, `volet` : aucun effet (A5) |

Hypothèses de chiffrage (à confirmer, Q1) : classes 3 et 4 de la table Incendie obtenues en multipliant par 1,2 (le socle donne 0,72 / 0,864 et 1,24416, la suite géométrique les relie) ; classes des types de commerce, limites des classes, Incendie obligatoire.

### 1.2 Jeu d'essai « Électronique, locataire, boutique »

Entrées : Électronique (classe 2), Locataire, loyer 150 000, Boutique, gardien Oui, extincteurs Non (coefficient 0,90), caméra Oui, volet Non, stocks 6 866 500, matériel 1 000 000, mobilier 500 000, aménagement 500 000, informatique 0 ; souscrites : Incendie, Vol (contenu **et** caisse, caisse 200 000), DDE 2 000 000, DE 1 000 000, BDG 500 000, TRI 10 000 000 ; Tempête non souscrite.

Vérification à la main (chaque ligne : nette, accessoires et taxe arrondies séparément, TTC = leur somme) :

| Ligne | Calcul exact | Nette | Acc. | Taxe (base = nette exacte + acc.) | TTC |
|---|---|---|---|---|---|
| Intermédiaires | capital_immo = 150 000 × 120 = 18 000 000 ; contenu = 6 866 500 + 1 000 000 + 500 000 + 500 000 = 8 866 500 ; capitaux_totaux = **26 866 500** ≤ 80 000 000 : contrôle passé | | | | |
| Incendie | 26 866 500 × 0,864 ‰ = 23 212,656 ; × 0,90 = 20 891,3904 | 20 891 | 2 500 | 23 391,3904 × 12,5 % = 2 923,92 → 2 924 | **26 315** |
| Vol | contenu : min(1 329 975 ; 2 000 000) × 1 % × 1,2 = 15 959,70 ; caisse : 200 000 × 2,5 % = 5 000 (≥ minimum 2 500, coefficient 1) ; ligne = 20 959,70 | 20 960 | 2 500 | 23 459,70 × 7,25 % = 1 700,83 → 1 701 | **25 161** |
| DDE | 2 000 000 × 6 ‰ = 12 000 | 12 000 | 2 500 | 14 500 × 7,25 % = 1 051,25 → 1 051 | **15 551** |
| DE | 1 000 000 × 10 ‰ = 10 000 | 10 000 | 2 500 | 12 500 × 7,25 % = 906,25 → 906 | **13 406** |
| BDG | 500 000 × 20 ‰ = 10 000 | 10 000 | 2 500 | 906 | **13 406** |
| TRI | 10 000 000 × 4 ‰ = 40 000 | 40 000 | 2 500 | 42 500 × 7,25 % = 3 081,25 → 3 081 | **45 581** |
| **Total** | 26 315 + 25 161 + 15 551 + 13 406 + 13 406 + 45 581 | **113 851** | **15 000** | **10 569** | **139 420** |

Contre-épreuve : 113 851 + 15 000 + 10 569 = 139 420 F TTC. Le calcul a aussi été refait par un script (decimal, arrondi au plus proche) : même résultat. Le minimum de la caisse (2 500) n'est pas atteint ici ; un second jeu d'essai (caisse 50 000 → 1 250 relevé à 2 500) doit le couvrir (§7).

## 2. Modèle conceptuel retenu (commun aux options)

- **Garantie** : code, nom, définition, afficher sur les documents, souscription (obligatoire / optionnelle / selon une condition), taxe et accessoires facultatifs (héritage du produit), **composantes** (au moins une).
- **Composante** (A6) : code, souscription Oui/Non propre (champ implicite `souscrit.<garantie>.<composante>`), assiette, taux (fixe ou table), minimum, par tête. Prime de la garantie = **somme exacte** des composantes souscrites ; une seule ligne de composition, un seul accessoire. Une garantie à une composante n'affiche pas la notion.
- **Sous-jacent** : effet E1 à E5, champs lus (un ou deux), garanties ou composantes ciblées (`vol.caisse`, `incendie.base`), table. Les coefficients de plusieurs sous-jacents se multiplient (commutatif).
- **Réduction commerciale** : traitée comme un coefficient appliqué **après** le minimum (champ liste à valeur tarifaire) ; c'est la seule nuance du socle, à valider (Q5).
- **Table** : une ou deux clés (champ, ou valeur tarifaire d'un champ comme `type_commerce.classe`). Elle doit être **complète** à la publication : pas de valeur par défaut, toute clé absente à l'exécution est un refus (A4). L'éditeur propose « remplir avec 1 » pour les tables de coefficients.
- **Montant garanti** de la ligne (D37) = somme des assiettes des composantes souscrites (Vol : 1 329 975 + 200 000), sauf champ désigné par la Technique (Q7).

## 3. Stockage du barème

### Option (a) — document JSON dans la version du produit (`produit_versions.bareme`)
- **Avantages** : un seul objet à lire, copier, comparer ; l'historisation est celle qui existe (une version à date atteinte ne se modifie plus, déclencheur D31) ; une migration par évolution du **schéma zod**, pas de la base ; lisible par un successeur (un fichier).
- **Limites** : pas de brouillon distinct (une version à date future reste corrigeable, mais sans notion de « publié ») ; pas d'intégrité par clé étrangère ; la requête « quels produits lisent ce champ ? » se fait en TypeScript.
- **Risque** : un barème incohérent écrit hors de l'application. Atténué par `verifierBareme()` à chaque enregistrement et par un `CHECK` sur le mode.

### Option (b) — tables relationnelles
Douze tables : `bareme_champs`, `_champ_valeurs`, `_intermediaires`, `_operandes`, `_tables`, `_table_lignes`, `_sous_jacents`, `_cibles`, `_garanties`, `_composantes`, `_jeux_essai`, `_essai_lignes`, chacune rattachée à la version.
- **Avantages** : « champ supprimé encore lu par un sous-jacent » refusé par la base (`ON DELETE RESTRICT`) ; requêtes SQL libres.
- **Limites** : une nouvelle version = **copie de douze familles de lignes** ; un déclencheur de gel par table (le projet en compte déjà plus de soixante) ; la table à deux entrées devient `(cle1, cle2, valeur)` ; ajouter un effet ou une opération d'assiette = migration ; un successeur reconstitue le barème en dix jointures.
- **Risque** : copie partielle d'une version, barème à moitié gelé. Les contrôles « table complète » et « pas de cycle » restent de toute façon à écrire en TypeScript.

### Option (c) — JSON validé dans une table dédiée `bareme_documents`
Une ligne par état du barème d'une version : `version_id`, `statut` (BROUILLON / PUBLIE), `schema_version`, `contenu` (jsonb), `empreinte` (SHA-256 du JSON canonique), `publie_par`, `publie_le`. Un déclencheur gèle une ligne PUBLIE.
- **Avantages** : tous ceux de (a), plus le **brouillon** (la Technique travaille plusieurs jours sans toucher la version en vigueur), la **publication** est un acte (jeux d'essai rejoués, tout vert, sinon refus), l'**empreinte** identifie le barème exact figé sur une cotation (T10, audit).
- **Limites** : une table et un déclencheur de plus que (a) ; le passage brouillon → publié doit rester atomique (une transaction).
- **Risque** : deux brouillons concurrents d'une même version. Verrou de ligne (comme la composition, D32) et un brouillon par version.

| Critère | (a) JSON en colonne | (b) Relationnel | (c) JSON, table dédiée |
|---|---|---|---|
| Historisation | héritée de la version | copie + gel × 12 tables | héritée + brouillon + empreinte |
| Intégrité | TypeScript | base **et** TypeScript | TypeScript |
| Lisibilité (successeur) | bonne | faible | bonne |
| Migrations futures | schéma zod | SQL à chaque évolution | schéma zod (`schema_version`) |
| Effort | faible | élevé | moyen |

**Recommandation : (c).** Raison décisive : la décision 9 (publication refusée si un essai échoue) exige un état « brouillon » que (a) n'a pas, et (b) coûte douze familles de lignes pour une intégrité qu'il faut quand même recoder.

### SECURPRO en JSON (options a et c, même document)

```json
{ "schema": 1,
  "produit": { "taxe": "IARD", "accessoires": { "mode": "PAR_GARANTIE", "montant": "2500" } },
  "blocs": [ {"code":"local","libelle":"Local et sécurité"}, {"code":"capitaux","libelle":"Capitaux"}, {"code":"garanties","libelle":"Garanties"} ],
  "champs": [
    {"code":"type_commerce","type":"LISTE","bloc":"local","obligatoire":true,"valeurs":[
       {"v":"BUREAU","l":"Bureau","classe":1}, {"v":"EPICERIE","l":"Épicerie","classe":2}, {"v":"ELECTRONIQUE","l":"Électronique","classe":2},
       {"v":"MECHES","l":"Mèches","classe":3}, {"v":"SUPERETTE","l":"Superette","classe":3}, {"v":"QUINCAILLERIE","l":"Quincaillerie","classe":4} ]},
    {"code":"occupation","type":"LISTE","bloc":"local","valeurs":["LOCATAIRE","PROPRIETAIRE"]},
    {"code":"situation","type":"LISTE","bloc":"local","valeurs":["BOUTIQUE","MARCHE"]},
    {"code":"gardien","type":"OUI_NON","bloc":"local"}, {"code":"extincteurs","type":"OUI_NON","bloc":"local"},
    {"code":"camera","type":"OUI_NON","bloc":"local"}, {"code":"volet","type":"OUI_NON","bloc":"local"},
    {"code":"loyer_mensuel","type":"MONTANT","bloc":"capitaux","si":{"champ":"occupation","egal":"LOCATAIRE"}},
    {"code":"valeur_batiment","type":"MONTANT","bloc":"capitaux","si":{"champ":"occupation","egal":"PROPRIETAIRE"}},
    {"code":"stocks","type":"MONTANT","bloc":"capitaux"}, {"code":"materiel","type":"MONTANT","bloc":"capitaux"},
    {"code":"mobilier","type":"MONTANT","bloc":"capitaux"}, {"code":"amenagement","type":"MONTANT","bloc":"capitaux"},
    {"code":"informatique","type":"MONTANT","bloc":"capitaux"},
    {"code":"dde_montant","type":"LISTE","numerique":true,"bloc":"garanties","si":{"souscrit":"dde"},"valeurs":["500000","1000000","2000000"]},
    {"code":"de_montant","type":"LISTE","numerique":true,"bloc":"garanties","si":{"souscrit":"de"},"valeurs":["500000","1000000"]},
    {"code":"bdg_montant","type":"LISTE","numerique":true,"bloc":"garanties","si":{"souscrit":"bdg"},"valeurs":["250000","500000"]},
    {"code":"tempete_montant","type":"LISTE","numerique":true,"bloc":"garanties","si":{"souscrit":"tempete"},"valeurs":["2000000","5000000"]},
    {"code":"tri_montant","type":"LISTE","numerique":true,"bloc":"garanties","si":{"souscrit":"tri"},"valeurs":["5000000","10000000"]},
    {"code":"vol_caisse_montant","type":"LISTE","numerique":true,"bloc":"garanties","si":{"souscrit":"vol.caisse"},"valeurs":["50000","100000","200000"]} ],
  "intermediaires": [
    {"code":"capital_immo","op":["PREMIER",["FOIS","loyer_mensuel",{"k":"120"}],"valeur_batiment"]},
    {"code":"contenu","op":["SOMME","stocks","materiel","mobilier","amenagement","informatique"]},
    {"code":"capitaux_totaux","op":["SOMME","capital_immo","contenu"]} ],
  "tables": [
    {"code":"taux_incendie","cles":["type_commerce.classe"],"lignes":{"1":"0.72","2":"0.864","3":"1.0368","4":"1.24416"}},
    {"code":"secu_incendie","cles":["gardien","extincteurs"],"lignes":{"OUI|OUI":"0.80","OUI|NON":"0.90","NON|OUI":"0.90","NON|NON":"1"}},
    {"code":"coef_vol_contenu","cles":["type_commerce"],"lignes":{"BUREAU":"1","EPICERIE":"1","ELECTRONIQUE":"1.2","MECHES":"1.2","SUPERETTE":"1","QUINCAILLERIE":"1"}},
    {"code":"coef_vol_caisse","cles":["type_commerce"],"lignes":{"BUREAU":"1","EPICERIE":"1","ELECTRONIQUE":"1","MECHES":"1","SUPERETTE":"1.25","QUINCAILLERIE":"1.25"}},
    {"code":"limites","cles":["type_commerce.classe","situation"],"lignes":{"1|BOUTIQUE":"100000000","2|BOUTIQUE":"80000000","3|BOUTIQUE":"60000000","4|BOUTIQUE":"50000000",
      "1|MARCHE":"5000000","2|MARCHE":"5000000","3|MARCHE":"5000000","4|MARCHE":"5000000"}} ],
  "sousJacents": [
    {"code":"classe","effet":"E1","table":"taux_incendie","cibles":["incendie.base"]},
    {"code":"securite","effet":"E2","table":"secu_incendie","cibles":["incendie.base"]},
    {"code":"electronique","effet":"E2","table":"coef_vol_contenu","cibles":["vol.contenu"]},
    {"code":"commerce_caisse","effet":"E2","table":"coef_vol_caisse","cibles":["vol.caisse"]},
    {"code":"plafond","effet":"E4","quand":[">","capitaux_totaux",["TABLE","limites"]],
     "message":"Les capitaux dépassent la limite de la classe : ce risque ne peut pas être assuré dans ce barème."} ],
  "garanties": [
    {"code":"incendie","nom":"Incendie","taxe":"INCENDIE","souscription":"OBLIGATOIRE","composantes":[
       {"code":"base","assiette":"capitaux_totaux","taux":{"source":"E1","unite":"PERMILLE"}} ]},
    {"code":"vol","nom":"Vol","souscription":"OPTIONNELLE","composantes":[
       {"code":"contenu","souscription":"OPTIONNELLE","assiette":["PCT_PLAFOND","contenu","15","2000000"],"taux":{"fixe":"1","unite":"POURCENT"}},
       {"code":"caisse","souscription":"OPTIONNELLE","assiette":"vol_caisse_montant","taux":{"fixe":"2.5","unite":"POURCENT"},"minimum":"2500"} ]},
    {"code":"dde","nom":"Dégâts des eaux","souscription":"OPTIONNELLE","composantes":[{"code":"base","assiette":"dde_montant","taux":{"fixe":"6","unite":"PERMILLE"}}]},
    {"code":"de","nom":"Dommages électriques","souscription":"OPTIONNELLE","composantes":[{"code":"base","assiette":"de_montant","taux":{"fixe":"10","unite":"PERMILLE"}}]},
    {"code":"bdg","nom":"Bris de glaces","souscription":"OPTIONNELLE","composantes":[{"code":"base","assiette":"bdg_montant","taux":{"fixe":"20","unite":"PERMILLE"}}]},
    {"code":"tempete","nom":"Tempête","souscription":"OPTIONNELLE","composantes":[{"code":"base","assiette":"tempete_montant","taux":{"fixe":"0.72","unite":"PERMILLE"}}]},
    {"code":"tri","nom":"Tous risques informatique","souscription":"OPTIONNELLE","composantes":[{"code":"base","assiette":"tri_montant","taux":{"fixe":"4","unite":"PERMILLE"}}]} ],
  "jeuxEssai": [ {"nom":"Électronique, locataire, boutique",
    "entrees":{"champs":{"type_commerce":"ELECTRONIQUE","occupation":"LOCATAIRE","situation":"BOUTIQUE","gardien":true,"extincteurs":false,"camera":true,"volet":false,
      "loyer_mensuel":"150000","stocks":"6866500","materiel":"1000000","mobilier":"500000","amenagement":"500000","informatique":"0","vol_caisse_montant":"200000",
      "dde_montant":"2000000","de_montant":"1000000","bdg_montant":"500000","tri_montant":"10000000"},
      "souscrit":["incendie","vol.contenu","vol.caisse","dde","de","bdg","tri"]},
    "attendu":{"lignes":[{"g":"incendie","nette":"20891","acc":"2500","taxe":"2924","ttc":"26315"},{"g":"vol","nette":"20960","acc":"2500","taxe":"1701","ttc":"25161"},
      {"g":"dde","ttc":"15551"},{"g":"de","ttc":"13406"},{"g":"bdg","ttc":"13406"},{"g":"tri","ttc":"45581"}],"ttc":"139420"} } ] }
```

Réalisé en B2 : le taux d'une composante est `{fixe, unite}` ou `{source:"E1", unite}` (un sous-jacent E1 le fournit) ; la **réduction** est un sous-jacent E2 avec `reduction:true` (valeur en %, cible = la garantie) ; E5 a trois modes (`MINIMUM`, `PLAFOND`, `AJOUT`) ; tout champ actif est obligatoire sauf `obligatoire:false`.

Notation des opérandes : une chaîne = un champ ou un intermédiaire ; `{"k":"120"}` = constante ; `[OP, …]` = opération (§6). Les nombres sont des **textes décimaux** (D3). `camera` et `volet` sont des déclarations sans effet (A5) : aucun sous-jacent ne les lit.

### SECURPRO en tables (option b)

| Table | Lignes SECURPRO | Exemple de ligne |
|---|---|---|
| `bareme_champs` | 20 (dont 6 listes de montants) | `(v, 'loyer_mensuel', MONTANT, si_champ='occupation', si_egal='LOCATAIRE')` |
| `bareme_champ_valeurs` | 6 + 2 + 2 + 14 montants | `(v, 'type_commerce', 'EPICERIE', classe=2)` |
| `bareme_intermediaires` + `_operandes` | 3 + 11 | `('capital_immo', PREMIER, rang 1 → FOIS(loyer_mensuel, 120))` |
| `bareme_tables` + `_lignes` | 5 + 28 | `('secu_incendie', 'OUI', 'NON', '0.90')` |
| `bareme_sous_jacents` + `_cibles` | 5 + 4 | `('securite', E2, table 'secu_incendie') → ('incendie','base')` |
| `bareme_garanties` + `_composantes` | 7 + 8 | `('vol','caisse', assiette 'vol_caisse_montant', taux 2.5 %, minimum 2500)` |
| `bareme_jeux_essai` + `_lignes` | 1 + 6 | `(essai 1, 'incendie', ttc 26315)` |

Mêmes données qu'en JSON, éclatées sur 12 tables (122 lignes) : la comparaison de deux versions n'est plus un simple « diff » de fichier.

## 4. Saisie par la Technique

Droit : celui de paramétrer les produits (écran « Produits », D31) ; la **publication** d'un barème exige en plus un motif (journalisé, avant/après) et que **tous les jeux d'essai passent** (décision 9). Qui publie : Q8.

### Option (a) — écrans par onglets
```
Produit SECURPRO · barème, brouillon du 24/10 · [Enregistrer] [Rejouer les essais] [Publier]
 Champs | Garanties | Sous-jacents | Tables | Jeux d'essai | Aperçu Commercial
┌ Garanties ──────────────────────────────────────────────────────────────────┐
│ ▸ Incendie · obligatoire · taxe INCENDIE (remplace IARD) · accessoires : défaut│
│ ▾ Vol · optionnelle · taxe : défaut · accessoires : défaut (une fois)          │
│    Composante « contenu »  assiette  [Pourcentage plafonné ▾] [contenu] 15 % max [2 000 000]│
│                            taux      [Fixe ▾] 1 %    minimum [  ]  par tête [ ]│
│                            effets liés : « electronique » (coefficient)      │
│    Composante « caisse »   assiette  [Champ ▾] [vol_caisse_montant]           │
│                            taux      [Fixe ▾] 2,5 %  minimum [2 500]          │
│                            effets liés : « commerce_caisse » (coefficient)    │
│    [+ composante]                                                             │
│ ▸ Dégâts des eaux · optionnelle … (5 autres garanties)        [+ garantie]    │
└───────────────────────────────────────────────────────────────────────────────┘
Table « secu_incendie » (deux entrées)         extincteurs →  OUI      NON
 lecture des champs : gardien (lignes) × extincteurs (colonnes)   gardien OUI [0,80] [0,90]
 [Remplir avec 1]                                                 gardien NON [0,90] [1   ]
 Contrôles : ✔ complète (4/4) · cible : Incendie · lue par 1 sous-jacent
```
**Contrôles affichés en continu** (panneau de droite, rouge = bloque la publication) : champ lu par un sous-jacent introuvable ou supprimé (« Le champ `gardien` est lu par le sous-jacent `securite` : supprimez d'abord le sous-jacent ») ; table incomplète (« 1 case vide : OUI|NON ») ; clé d'une valeur de liste absente d'une table ; garantie sans composante ; composante ciblée par aucun taux ; intermédiaire en cycle ; jeu d'essai en échec avec l'écart ligne à ligne. **Tables à deux entrées** : une grille (une clé en lignes, une en colonnes), cases validées au décimal ; au-delà de deux clés, l'éditeur refuse (Q9).
- **Avantages** : un onglet par concept, correction locale, modification d'un barème existant facile. **Limites** : beaucoup d'écrans (5) et d'aller-retour pour créer un produit de zéro. **Risque** : barème incomplet laissé en brouillon (la publication le refuse).

### Option (b) — assistant pas à pas
Neuf étapes imposées : Identité, Champs, Capitaux (intermédiaires), Garanties, Effets (E1 à E5 un par un), Contrôles, Taux et tables, Essais, Publier.
```
Étape 4/9 — Garanties de SECURPRO                         [◀ Précédent] [Suivant ▶]
 Garanties déclarées : Incendie, Vol, DDE, DE, BDG, Tempête, TRI          [+ ajouter]
 Vol : cette garantie a-t-elle plusieurs composantes ?  (●) Oui  ( ) Non
   composante 1 : contenu · composante 2 : caisse                         [+ composante]
 Vous ne pouvez passer à l'étape 5 qu'avec chaque garantie rattachée à une assiette.
 Les tables (étape 7) : « secu_incendie » demandera gardien × extincteurs → 4 valeurs.
```
- **Avantages** : guide la création d'un nouveau produit, impossible d'oublier un contrôle. **Limites** : pénible pour **corriger un taux** (il faut rejouer le parcours ou ouvrir un mode « libre » : on retombe sur l'option a) ; l'ordre imposé gêne les produits atypiques. **Risque** : on maintient deux interfaces. Écartée comme interface unique.

### Option (c) — import / export Excel ou JSON en plus des écrans
Les écrans de (a), plus **Exporter** (JSON du document, ou classeur Excel avec les feuilles `Champs`, `Valeurs`, `Garanties`, `Composantes`, `Tables`, `SousJacents`, `Essais`) et **Importer** (crée un **brouillon**, jamais une publication).
```
Importer un barème (brouillon)   fichier : SECURPRO_v2.xlsx    [Vérifier]
 ✖ Tables!C7  clé « OUI|NON » absente de la table « secu_incendie »
 ✖ Garanties!B5  la composante « vol.caisse » cible un sous-jacent inexistant : « caisse_commerce »
 ✔ 22 champs · 7 garanties · 5 tables · 1 jeu d'essai lus        [Créer le brouillon]
```
Une table à deux entrées est une **grille de la feuille** (lignes × colonnes), plus naturelle qu'à l'écran pour la Technique, qui travaille déjà dans Excel (le simulateur). L'import passe par le **même** schéma zod et la même `verifierBareme()` que l'écran : une seule vérité. `exceljs` est déjà une dépendance (export du journal). Fichiers `.xlsx` ignorés par `.gitignore` (aucune donnée réelle dans le dépôt).
- **Avantages** : relecture du barème par la Direction Technique dans un tableur, reprise du simulateur sans ressaisie, sauvegarde. **Limites** : un format de plus à maintenir ; l'import est un risque de fichier trafiqué (contrôle identique à la saisie, brouillon seul). **Risque** : confusion entre fichier et version publiée, d'où l'empreinte affichée dans le fichier exporté.

**Recommandation** : **(a) d'abord** (sessions B4, B5), **(c)** comme ajout (B9) sur le même document. (b) n'est pas retenue.

## 5. Saisie par le Commercial

L'écran de cotation d'un produit au barème est **généré** depuis le document publié en vigueur à la date d'effet.
```
Nouvelle cotation · SECURPRO · barème du 01/11/2026 (empreinte 7f3a…)
┌ Local et sécurité ────────────────────┐ ┌ Résultat (se met à jour à « Calculer ») ─────────┐
│ Type de commerce *  [Électronique ▾]   │ │ Incendie        garanti 26 866 500   26 315│
│ Occupation *        [Locataire ▾]      │ │ Vol             garanti 1 529 975    25 161│
│ Loyer mensuel *     [150 000]  (aide)  │ │ Dégâts des eaux garanti 2 000 000    15 551│
│ Gardien [Oui▾] Extincteurs [Non▾] …    │ │ …                                         │
├ Capitaux ─────────────────────────────┤ │ Prime nette 113 851 · Accessoires 15 000   │
│ Stocks * … Matériel * …                │ │ Taxes 10 569 · TTC 139 420 F               │
├ Garanties ────────────────────────────┤ │ [Demander un forçage] [Soumettre]          │
│ [x] Vol : [x] contenu [x] caisse 200 000│ └────────────────────────────────────────────┘
│ [ ] Tempête …                          │
└───────────────────────────────────────┘
```
- **Champs** : chaque bloc = une `Carte`, composants existants (`Champ`, `ListeDeroulante`, `ChampDate`, 16 px sous `sm`) ; **condition d'affichage** évaluée côté navigateur pour l'affichage et **recontrôlée au serveur** (un champ caché n'est jamais lu) ; l'aide = le texte du champ ; les garanties optionnelles sont des cases Oui/Non, leurs montants des listes (A7).
- **Résultat** : lignes de composition, montant garanti, prime, TTC ; refus affiché en `Bandeau` avec le **message de la Technique** (A2) ; toute valeur manquante nomme le champ. Un changement de champ vide le résultat (« Recalculez »).
- **Forçage** (droit existant « Forcer une prime », CDC §4) : après calcul, par ligne, `Demander un forçage` ouvre prime nette forcée + motif obligatoire ; l'écran montre **calculée → forcée, écart en F et en %**, la taxe recalculée par la règle (jamais forcée), et la mention « validation obligatoire ». Le détail (taux, coefficients, composantes) n'est montré qu'à la Technique (Q6).
- **Option écartée** : calcul à chaque frappe (aller-retour serveur trop fréquent, messages d'erreur sur des saisies incomplètes). On garde « Calculer » ; le calcul en direct reste possible plus tard.

## 6. Représentation des assiettes (E3), sans formule libre

| Opération | Forme | Exemple SECURPRO | Saisie |
|---|---|---|---|
| Champ ou intermédiaire | `"stocks"` | assiette DDE = `dde_montant` | liste déroulante des champs numériques |
| Constante | `{"k":"2000000"}` | plafond de 2 000 000 | case montant |
| Somme | `["SOMME", a, b, …]` | `contenu` | cases à cocher sur les champs/intermédiaires |
| Champ × constante | `["FOIS", a, {"k"}]` | loyer × 120 | champ + case montant |
| Pourcentage plafonné | `["PCT_PLAFOND", a, "15", plafond]` | min(15 % du contenu ; 2 000 000) | champ + % + plafond (constante ou champ) |
| Table | `["TABLE", code, clés…]` | `limites` (classe, situation) | liste des tables ; les clés sont celles de la table |
| Premier renseigné | `["PREMIER", a, b, …]` | loyer × 120, **ou** valeur du bâtiment (champs conditionnels) | liste ordonnée ; refus si aucun n'est renseigné |

Règles : profondeur **2 au plus** (une opération dans une opération, ex. `PREMIER` de `FOIS` ci-dessus) ; au-delà, on **nomme** un intermédiaire (`capital_immo`) ; les intermédiaires se calculent dans l'ordre de la liste, **aucune référence en avant ni cycle** (refus à l'enregistrement). Pas de division, de soustraction ni de condition `si` : si un produit en a besoin, c'est un sixième effet (le socle, §8, option C), pas une formule libre. **Option écartée** : modèles d'assiette tout faits sans imbrication ; ils couvriraient SECURPRO, mais le cas « loyer × 120 ou bâtiment » force un modèle sur mesure et reporte la dette sur le code.

## 7. Moteur pur `domaine/bareme/`

| Fichier | Fonctions (toutes pures) |
|---|---|
| `schema.ts` | schéma zod du document ; types déduits (`Bareme`, `Saisie`, `JeuEssai`) |
| `verification.ts` | `verifierBareme(bareme): Probleme[]` : références (champ, table, cible), tables complètes, cycles, jeux d'essai présents, conditions d'affichage lisibles |
| `champs.ts` | `controlerSaisie(bareme, saisie)` : obligatoires, bornes, valeurs de liste, champs actifs (conditions) |
| `operandes.ts` | `evaluerOperande(op, contexte)`, `calculerIntermediaires` |
| `tables.ts` | `chercher(table, cles)` : refus avec message si la clé est absente (A4) |
| `garantie.ts` | `calculerComposante`, `calculerGarantie` (somme exacte des composantes, héritage taxe/accessoires) |
| `controles.ts` | `appliquerControles` (E4) : tous les échecs rassemblés, un seul message affiché par échec |
| `bareme.ts` | `calculerBareme(bareme, saisie, parametres): ResultatBareme` dans **l'ordre du socle §6** |
| `forcage.ts` | `appliquerForcage`, `effacerForcages` (empreinte de la saisie changée) |
| `essais.ts` | `rejouerJeuxEssai(bareme, parametres): Ecart[]` : calcule, passe par `composer()`, compare ligne à ligne |

- **Frontière avec l'existant** : `calculerBareme` rend des `LigneDePrime` (`libelle`, `branche` = catégorie de taxe de la garantie, `montantGaranti`, `primeNette` **exacte non arrondie**, `accessoires`) ; `composer()` (`domaine/calcul/composition.ts`) résout la taxe, arrondit selon la règle du produit (A8) et totalise : on n'écrit **aucune seconde règle d'arrondi**. L'aval ne change pas (décision 7).
- **Décimales** : `montant()` / `DecimalMontant` (decimal.js, 40 chiffres, D3), taux en texte avec leur unité (‰ ou %) et jamais de `number` ; aucune division sauf la conversion ‰ → fraction.
- **Erreurs** : une classe `ErreurBareme { code, message, champ?, garantie? }`, message en français qui nomme le champ, la table et la valeur : « Incendie : le type de commerce « Mèches » n'a pas de ligne dans la table « Taux Incendie » ; ce risque ne peut pas être tarifé. » · « Le champ « Loyer mensuel » est obligatoire (occupation : Locataire). » · le texte E4 de la Technique, tel quel. **Jamais de 0 silencieux** : une garantie souscrite dont l'assiette est vide est un refus.
- **Tests** : (1) un test par effet qui échoue quand on retire l'effet du moteur (méthode des sessions précédentes) ; (2) A6 : composante non souscrite sans effet, minimum de la caisse atteint et non atteint ; (3) **jeux d'essai** : SECURPRO du §1 et le second essai à minimum ; (4) **propriétés** (boucles à graine fixe sous vitest, ou `fast-check` si l'équipe accepte la dépendance, Q10) : déterminisme ; permuter l'ordre des sous-jacents ne change rien ; un coefficient 1 équivaut à l'absence du sous-jacent ; monotonie de la prime en l'assiette ; somme des lignes = total ; jamais de ligne à 0 ; (5) **oracle indépendant** en fractions entières (BigInt) pour 200 saisies tirées, comme l'oracle de D32 ; (6) tout barème de test est **inventé** (aucun chiffre réel dans le dépôt).

## 8. Intégration

- **Mode** : `ModeTarification` gagne `BAREME` (contrainte `CHECK`, D31) ; les contrôles « sûr par défaut » ne l'acceptent que pour la nature de calcul `BAREME`. Les **cinq sites** de D31/D32 (`resoudreContexte`, `construireEntree`, émission, émission de facture de renouvellement, `montantsDu`) doivent être relus : la règle devient « nature figée ↔ mode » à **trois** valeurs (automatique ↔ `FORMULE`, composition manuelle ↔ `GARANTIES`, composition `BAREME` ↔ `BAREME`), via `exigerModeCoherent`. **Mode cible (D48)** : `BAREME` pour tous les produits ; `FORMULE` conservé pour la santé jusqu'à preuve que le barème le remplace ; `GARANTIES` cesse d'être un mode de produit et devient un **secours par cotation**. **Secours en cas de refus**, deux branches selon la réponse de la Technique à Q3 : **(a)** refus sans exception ; **(b)** composition manuelle sur **cette cotation seule**, avec motif et validation obligatoires. **Jamais une nouvelle version du produit pour un seul risque.** **Prorata temporis** : paramètre du produit (actif ou non, jours inclus / 365, comme la formule), appliqué à la prime nette **après la réduction et avant les accessoires**.
- **Nature figée** : deux options. (i) **même type `COMPOSITION`** avec `origine: "BAREME"`, l'empreinte du barème, la saisie et les taux figés ; (ii) nouveau type `BAREME`. **Recommandation (i)** : `montantsDu`, `recalculer`, les documents et l'aval reconnaissent déjà `estComposition` ; seul `exigerModeCoherent` apprend l'origine. Risque (i) : confondre une composition manuelle et une composition de barème, d'où un test par site (D31).
- **De `GARANTIES` à `BAREME`** : une **nouvelle version** de date d'effet postérieure (jamais rétroactive). L'éditeur propose « reprendre les garanties de la version précédente » (libellé, catégorie de taxe, montant garanti, accessoires) comme point de départ. Les cotations émises et les polices restent figées (T10, aucune n'est recalculée) ; un brouillon **à composer** d'avant la bascule ne se convertit pas, il se recrée (comme H89).
- **Cotations existantes** : intactes. Le barème n'est jamais relu pour une cotation émise : on relit ses lignes figées. Un barème publié ne se modifie plus ; une correction = nouvelle version.
- **Forçage** : `forcage` porté par la ligne (prime calculée, prime forcée, motif, auteur, date), taxe recalculée par la règle ; la cotation passe **toujours** « À valider » (CDC §4.1), valideur ≠ auteur ≠ préparateur ≠ composeur ≠ celui qui a forcé (H95 étendue) ; un changement de champ **efface** les forçages et les garde au journal (comme H98).
- **Renouvellement (H90)** : recalcul **au barème en vigueur** à la date d'effet de la nouvelle période, saisie de la police reprise ; si le nouveau barème ajoute un champ obligatoire, le brouillon passe « à compléter » ; les forçages de la période précédente **ne sont pas reportés** ; l'émission suit le seuil (D39). Option écartée : reprendre les lignes sans recalcul (c'est le comportement D38 des produits `GARANTIES`, faute de tarif ; ici le tarif existe). Avenant d'incorporation : inchangé (pas de prorata automatique, D45).
- **Documents** : chaque champ devient `risque.<code>` ; c'est une **extension du dictionnaire** (jusqu'ici statique) : balises **facultatives** par produit, résolues sur le barème figé, contrôle des modèles à l'enregistrement ; à consigner en décision avant B6. Aucun nouveau champ de `garanties_souscrites[]`.

## 9. Découpage en sessions (une session = une branche recettable)

| Session | Branche | Contenu | Recette |
|---|---|---|---|
| B2 | `bareme-b2-moteur` | schéma zod, `verifierBareme`, `calculerBareme`, essais, SECURPRO inventé ; **ni écran ni migration** | `npm test`, jeux d'essai (139 420 F) |
| B3 | `bareme-b3-stockage` | migration `bareme_documents` + mode `BAREME`, publication avec essais rejoués, journal | publier / refuser un barème par script |
| B4 | `bareme-b4-champs-garanties` | onglets Champs et Garanties (composantes) | créer un produit, voir les contrôles |
| B5 | `bareme-b5-sousjacents-tables` | onglets Sous-jacents, Tables (grille à deux entrées), Jeux d'essai, Publier | SECURPRO saisi à l'écran = 139 420 F |
| B6 | `bareme-b6-cotation` | écran Commercial généré, `COMPOSITION` d'origine `BAREME`, gardes D31/D32 relues, balises `risque.*` | cotation → CP → facture au barème |
| B7 | `bareme-b7-forcage` | forçage, « À valider » obligatoire, séparation des tâches, écart affiché | scénario de forçage et de refus |
| B8 | `bareme-b8-renouvellement` | renouvellement et avenant d'une police au barème, passage `GARANTIES` → `BAREME` | renouvellement N+1, bascule |
| B9 | `bareme-b9-excel` | export / import Excel et JSON, SECURPRO **réel** paramétré par la Technique | revue Direction Technique |

Ordre retenu : **B2 → B3 → B9 (import Excel) → B6 → (B4, B5) → (B7, B8)**. Le contrat est prolongé : B2 à B9 sont le plan, la fin de stage de fin octobre ne le borne plus.

## 10. Questions encore ouvertes pour la Technique

1. **Q1** : un cas réel du simulateur corrigé (entrées et TTC) pour remplacer le jeu d'essai inventé ; valeurs réelles des types de commerce et de leurs classes, des limites (classe × situation), classes 3 et 4 de la table Incendie, Incendie obligatoire ?
2. **Q2** : accessoires de 2 500 : par garantie souscrite (Vol = un seul), ou par contrat ? Les autres produits (par tête, par tranche d'effectif) sont-ils les seuls modes ?
3. **Q3** : A2 : un risque refusé par le barème : **(a)** refus sans exception, ou **(b)** composition manuelle sur cette cotation seule (motif et validation obligatoires) ? (H133)
4. **Q4** : A1 : la prime nette totale additionne bien toutes les garanties, y compris celles à 0 accessoire ?
5. **Q5** : réduction commerciale : coefficient **après** le minimum (proposé) ou avant ? Même table pour toutes les garanties ?
6. **Q6** : le Commercial voit-il le détail (taux, coefficients, composantes) ou seulement les lignes (proposé) ? Qui voit l'écart de forçage ?
7. **Q7** : montant garanti de la ligne Vol = somme des assiettes des composantes souscrites (proposé), ou un champ désigné ?
8. **Q8** : qui publie un barème ? (Technique seule, ou double : Technique puis Direction ?) Quel droit ?
9. **Q9** : une table à **trois clés** est-elle nécessaire pour un produit hors simulateur (RELAXVOYAGE, SECURECOLTE, produits IMF) ? Les cinq effets suffisent-ils ? (socle, 9.1)
10. **Q10** (Thierry) : dépendance `fast-check` pour les tests de propriétés : acceptée, ou boucles à graine fixe sous vitest (proposé) ?
11. **Q11** : blocs de champs réutilisables entre produits (socle, 9.3) : utiles, ou un bloc par produit (proposé pour B4) ?
12. **Q12** : renouvellement d'une police au barème : recalcul au tarif de l'année N+1 confirmé ? Forçages non reportés ?
