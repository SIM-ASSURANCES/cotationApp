# Guide de balisage des modèles Word

Pour Thierry, qui balise les modèles réels (annexe A du CDC). Aucun modèle réel n'entre dans le dépôt : tout se fait **hors du dépôt**, sur des copies. Syntaxe de référence : [CDC §6.2](cdc.md#62-syntaxe-des-balises) ; noms des champs : écran **Modèles > Aide à la rédaction des modèles** de l'application (dictionnaire normatif, `app/src/domaine/documents/dictionnaire.ts`).

## La méthode, pas à pas

1. **Copier** le modèle réel dans un dossier hors du dépôt (par exemple `C:\essais\modeles\`). On travaille sur la copie, jamais sur l'original. Le script refuse un fichier situé dans le dépôt.
2. **Baliser** la copie dans Word, en tapant chaque balise **au clavier, d'un seul tenant** (voir les pièges ci-dessous). Remplacer chaque zone « `|____|` », « `XXX` », « `00/00/00` », « `[à préciser]` », « `Variable système` » par la balise du dictionnaire.
3. **Vérifier avec le script**, depuis `generateur/`, environnement virtuel activé (Node et `npm ci` dans `app/` sont nécessaires : le dictionnaire et les contrôles sont lus dans l'application, pas recopiés) :

   ```powershell
   python scripts/verifier_modele.py "C:\essais\modeles\CP_sante.docx" --type CP
   ```

   `--type` est obligatoire : c'est le type choisi au dépôt (`CP`, `CERTIFICAT`, `COTATION`, `FACTURE`, `AVOIR`, `RECU`, `AVIS_ECHEANCE`, `RELANCE`, `ANNEXE`, `SOUS_MODELE`, `CG`, `CS`), qui fixe les champs, filtres et mentions obligatoires. Le script lit le fichier sur ta machine, **n'envoie rien, ne stocke rien**, et affiche : les balises trouvées et leur emplacement, les balises inconnues, les champs Word, les balises coupées, les blocs mal fermés, les polices (utilisées, absentes), les filtres sur champs obligatoires, puis ce que ferait le dépôt (rejets et avertissements, identiques à l'application). Code de sortie : 0 accepté, 1 refusé, 2 script impossible à lancer.

   Polices : sans option, la comparaison se fait avec les polices de **ta machine**, ce qui n'est exact que sous Linux. Pour comparer avec l'**image** du générateur, extraire sa liste (en dehors du dépôt) puis la fournir :

   ```powershell
   docker compose exec generateur fc-list : family | Out-File -Encoding utf8 C:\essais\polices-image.txt
   python scripts/verifier_modele.py "C:\essais\modeles\CP_sante.docx" --type CP --polices-image C:\essais\polices-image.txt
   ```

4. **Corriger** jusqu'à « dépôt ACCEPTÉ », et comprendre chaque avertissement (police absente, marqueur hérité).
5. **Déposer** dans l'application (**Modèles** : créer le modèle, déposer la version), regarder l'**aperçu PDF** (données fictives), puis soumettre (Technique) et publier (Direction Générale). Le dépôt refuse ce que le script refuse.

## Les pièges réels

| Piège | Ce qui se passe | Que faire |
| --- | --- | --- |
| **Champ Word** (Ctrl+F9, publipostage) | Une balise saisie comme champ Word n'est pas une balise : le dépôt la rejette. | Supprimer le champ, retaper la balise au clavier avec des accolades ordinaires. Les champs légitimes (numéro de page, date…) sont acceptés. |
| **Balise coupée** | Word découpe le texte (correction orthographique, mise en forme au milieu, suivi des modifications) : la balise n'est plus lisible. | Effacer la balise entière et la retaper d'un seul tenant, sans changer de mise en forme à l'intérieur ; désactiver le suivi des modifications. Une balise ne s'étend jamais sur deux paragraphes. |
| **`case` sans parenthèses** | `{{ risque.statut == "PROPRIETAIRE" \| case }}` (exemple du CDC §6.2) s'applique au seul texte « PROPRIETAIRE » : la case serait fausse. Le dépôt la rejette. | Écrire `{{ (risque.statut == "PROPRIETAIRE") \| case }}`, **condition entre parenthèses**. |
| **Filtre sur un champ vide** | Un champ **obligatoire** vide passé dans un filtre (`montant`, `lettres`, `date`, `dateheure`, `pct`, `case`) arrête la génération en nommant le champ (D26). Un champ **facultatif** (`intermediaires`, `police.police_mere`, `police.nantissement`, `formules[].taux_couverture`, `doc.empreinte`, et depuis la session 6.2b `garanties_souscrites` et `prime.taux_taxe`) s'écrit vide (D19, D32). | Le script liste les filtres posés sur des champs obligatoires : vérifier que la donnée est toujours renseignée, sinon demander à la Technique de déclarer le champ facultatif. Hors filtre, un champ vide s'écrit vide. |
| **Champ jamais fourni** | Un champ que l'application ne fournit pas (profession non saisie, par exemple) bloque la génération s'il est dans le modèle, sauf s'il est facultatif (D19). | Ne l'utiliser que si la donnée est saisie ; l'aperçu et l'émission d'essai le disent, en nommant le champ. |
| **`risque.*` propre au produit** | Tout `risque.nom_en_minuscules` est accepté au dépôt (CDC §6.3 : extensible) : le dépôt **ne sait pas** si le produit renseigne ce champ. | Reprendre les noms exacts de la saisie du produit (`risque.marque`, `risque.statut`…) et vérifier par une cotation d'essai (données inventées). |
| **Bloc mal fermé** | `{% if %}` sans `{% endif %}`, blocs croisés : tant qu'un bloc est mal fermé, les autres balises de cette partie du document ne sont **pas relevées** (le script le dit). | Corriger les blocs d'abord, puis relancer pour voir le reste. |
| **Calcul, `default`, `set`, appel de fonction** | `{{ a + b }}`, `\| default`, `{% set %}` et tout appel autre que `bloc()` sont interdits : les montants viennent du moteur de calcul. | Utiliser la donnée du dictionnaire ; `bloc("garanties", f.code)` seul dans son paragraphe, dans le corps. |
| **CG et CS** | Documents fixes : seules les balises du visa sont permises (`produit.cg_libelle`, `produit.cg_visa`, `produit.cg_date` ; `produit.cs_libelle`, `produit.cs_visa`). | Aucune autre balise, pas de `bloc()`. |
| **Polices** | Tahoma et Calibri n'ont pas d'équivalent libre : si l'image ne les a pas, la pagination diffère de Word. | Voir `generateur/polices/README.md`. |
| **Échéances d'une facture** (6.1) | `echeances[].statut` vaut « Payé », « Partiellement payé » ou « Non payé » ; `echeances[].paye` et `echeances[].restant` donnent la part payée et le reste à payer de l'échéance. | Les afficher dans la boucle `{%p for e in echeances %}` du modèle de facture. |

## Les anomalies A1 à A20 et ce qui les corrige

Les anomalies viennent de l'[annexe A du CDC](cdc.md#annexe-a--anomalies-des-modèles-actuels-à-corriger). La colonne de droite donne la balise ou la clause ; « texte » veut dire qu'aucune balise ne règle le défaut, il se corrige dans le Word.

| N° | Modèle | Balise ou clause qui corrige |
| --- | --- | --- |
| A1 | Tous les CP | Chaque zone hétérogène (`\|____\|`, `XXX`, `00/00/00`, `Variable système`, cellules vides) est remplacée par la balise du dictionnaire ; le dépôt avertit des marqueurs hérités. |
| A2 | Tous les CP | `{{ societe.email_reclamation }}` |
| A3 | Tous les CP | `{{ r.libelle }}` et `{{ r.url }}` dans `{%p for r in societe.recours %}` ; l'URL officielle de la Médiation est à vérifier par la Technique, puis saisie dans le paramétrage Société (pas dans le modèle). |
| A4 | Plusieurs CP | `{{ produit.cg_visa }}` : visa unique, issu du paramétrage du produit. |
| A5 | RELAXVOYAGE, RELAXVOYAGE+ | `{{ produit.cg_libelle }}` et `{{ produit.cg_visa }}` en bas de page (au lieu du libellé écrit en dur). |
| A6 | RELAXVOYAGE+ | Texte : « SIM ASSURANCES CI » dans la clause de réclamation (ou `{{ societe.raison_sociale }}`), « Compagnie de voyage » dans le tableau de l'assuré. |
| A7 | SECURMOTO | **Décision de la Technique d'abord** : quelles CG s'appliquent (01507 ou 01498) ? Ensuite `{{ produit.cg_libelle }}` et `{{ produit.cg_visa }}` partout. |
| A8 | RELAXACCIDENT | `{{ produit.cg_visa }}` : visa complet, avec l'autorité. |
| A9 | SECURMOTO, SECURECOLTE | Bloc de prime complet : `{{ prime.nette \| montant }}`, `{{ prime.accessoires \| montant }}`, `{{ prime.taxe \| montant }}`, `{{ prime.ttc \| montant }}`. |
| A10 | SECURVIE | Le même bloc de prime complet ; garanties par `{{ bloc("garanties", f.code) }}` dans `{%p for f in formules %}` (sous-modèle). |
| A11 | CP VOL | `{{ doc.lieu_emission }}, le {{ doc.date_emission \| date }}` à la place de la date saisie en dur. |
| A12 | RELAXSANTE PLUS | `{{ f.taux_couverture \| pct }}` dans `{%tr for f in formules %}` (champ facultatif : vide hors santé) ; texte : orthographe « RELAXSANTE ». |
| A13 | SECURECOLTE | Texte : retirer les guillemets autour de « [SIM ASSURANCES CI] » et la puce vide. |
| A14 | Facture 003-0926 | Modèle de facture unique : `{{ police.numero }}` et une colonne `{{ f.accessoires \| montant }}` dans `{%tr for f in formules %}`. |
| A15 | Facture 004-0926 | `{{ souscripteur.adresse }}` ; bloc `{%p if envoye_a %}` … `{{ envoye_a.nom }}`, `{{ envoye_a.adresse }}` … `{%p endif %}` (masqué s'il est identique à « Facturé à ») ; `{{ prime.taux_taxe \| pct }}` et `{{ prime.taxe \| montant }}`. Le taux de 1,90 % et la date d'émission relèvent du moteur et de l'application, pas du modèle. |
| A16 | Factures | `{{ societe.rccm }}`, `{{ societe.ncc }}`, `{%p for r in societe.rib %}`, `{%p for m in societe.mobile_money %}`, `{{ prime.ttc \| lettres }}`. La numérotation continue est faite par l'application. |
| A17 | Offre BENI | Texte : inverser les deux listes de pièces (décès, IPT). |
| (6.2b) | Produit tarifé par garanties (SECURPRO, SECURHOME…) | **Une ligne par garantie souscrite**, avec son taux : `{%tr for g in garanties_souscrites %}` puis `{{ g.libelle }}`, `{{ g.branche }}`, `{{ g.prime_nette \| montant }}`, `{{ g.accessoires \| montant }}`, `{{ g.taux_taxe \| pct }}`, `{{ g.taxe \| montant }}`, `{{ g.ttc \| montant }}` ; `formules` est **vide** pour ces produits. `prime.nette`, `prime.accessoires`, `prime.taxe` et `prime.ttc` restent les totaux ; `prime.taux_taxe` n'est rempli que si un seul taux s'applique (vide sinon). Attention : `bloc("garanties", …)` est un **sous-modèle**, pas cette liste. |
| A18 | Offre BENI | Texte : « Invalidité » au lieu d'« Indemnité permanente totale ». |
| A19 | Offre BENI | Texte : harmoniser le réseau et le barème de la chambre (décision de la Technique). |
| A20 | Offre BENI | À recréer en Word balisé, type `COTATION` (modèle de cotation santé). |
