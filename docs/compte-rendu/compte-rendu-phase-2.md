# Compte rendu de la phase 2 : cotation

Écrit le 06/10/2026. Détail des règles : [decisions.md](decisions.md) (D10, D13) ; vérifications : [recette.md](recette.md) (§2 ter et §3).

## 1. Ce qui est fait

| Domaine | Livré |
| --- | --- |
| **Validité** | « date d'établissement + N mois » (3 par défaut, paramétrable par produit) ; le dernier jour reste valable, la cotation devient « Expirée » le lendemain (D10, cas T1) |
| **Statuts** | Brouillon → « À valider » (si prime forcée **ou** TTC au-dessus du seuil du produit) ou directement « Émise » → Acceptée, Refusée ou Expirée |
| **Numérotation** | COT-AAAA-MM-NNNN attribué **à l'émission** (un brouillon n'a pas de numéro), compteur annuel sans trou, même avec 8 émissions simultanées |
| **Forçage de prime** | on force la prime **unitaire** d'une formule ; le moteur recalcule ; motif obligatoire (5 caractères) pour tout écart ; réservé aux profils ayant le droit « Forcer une prime » |
| **Double validation** | un valideur différent de l'auteur (Technique ou Direction Générale) valide, ou renvoie en brouillon avec une raison |
| **Figement** | dès l'émission, un déclencheur PostgreSQL interdit toute modification et suppression, **même en SQL direct** ; une cotation expirée ne peut plus devenir acceptée |
| **Acceptation** | le client retient une ou plusieurs formules ; recalcul sur ces formules avec les paramètres **figés** de la cotation ; création de la police (numéro provisoire POL-AAAA-NNNNNN) |
| **Refus** | avec motif obligatoire |
| **Écrans** | liste filtrée par statut, nouvelle cotation (souscripteur, formules, forçage, assurés avec sexe, champs `risque.*`), fiche (primes, échéancier, filigrane « EXPIRÉE », actions selon statut et droits), clients |
| **Audit** | chaque action est écrite au journal en ajout seul |

**Cas du CDC** : T1 (BENI : Solo 288 000, Famille 15 600 000, total 15 888 000, validité +3 mois), T11 (cotation expirée) et T13 (double validation) sont **verts**. T3 (prorata) l'était depuis la phase 1.

## 2. Comment c'est vérifié

110 tests unitaires, 57 tests d'intégration sur une vraie base PostgreSQL (dont 27 pour la cotation), 3 mutations volontaires toutes détectées, et un parcours HTTP de 28 contrôles en soumettant les vrais formulaires (détail en recette §2 ter).

## 3. Ce qui n'est pas fait ou pas vérifié

- **Pas de PDF** : la cotation est numérotée, figée et porte le drapeau de filigrane, mais le document PDF arrive en phase 3 (fusion des modèles Word). Le filigrane « EXPIRÉE » dans le PDF aussi.
- **Non vérifié** : le comportement JavaScript côté navigateur (ajout et retrait de lignes d'assurés et de formules) et le rendu visuel : aucun navigateur n'a été piloté. **C'est précisément ce que tu peux vérifier à la main** (§4).
- **Hypothèses à faire confirmer par la Direction Technique** : H7 à H12 (qui valide, total à plusieurs formules, qui modifie un brouillon, format du numéro de police, refus d'une cotation « À valider »), et « 3 mois » comme durée par défaut (decisions.md, « Décisions en attente »).
- Comme la phase 0, une connexion derrière le proxy HTTPS n'a pas été essayée.

## 4. Simuler les tests de la phase 2 toi-même

Deux façons : **A**, relancer les tests automatiques ; **B**, dérouler à la main les cas T1, T13, T11 dans l'application, avec un navigateur.

### A. Relancer les tests automatiques (5 minutes)

Depuis `app/` (PostgreSQL du poste démarré) :

```powershell
npm test                    # 110 tests unitaires, sans base
npm run test:integration    # 57 tests sur une base de test supprimée et recréée (nom en _test)
npm run typecheck ; npm run lint
```

Les scénarios sont lisibles dans `app/src/serveur/cotations.integration.test.ts` (T1, T11, T13, numérotation).

### B. Parcours à la main dans l'application

**Préparation (une fois).** Soit avec la pile Docker déjà décrite en recette (`docker compose up -d` à la racine ; application sur http://localhost:3000), soit en développement (`npm run dev` dans `app/`, voir [installation.md](installation.md)). Avec Docker, la base est vide au départ :

```powershell
docker compose run --rm outils npm run initialiser      # crée les 6 profils et leurs droits
docker compose run --rm outils npm run creer-admin      # identifiant, nom, mot de passe (12 caractères minimum), saisis dans le terminal
```

Se connecter en administrateur, puis, dans **Admin → Utilisateurs**, créer **trois comptes** avec un mot de passe provisoire (à changer à la première connexion) :

| Identifiant (au choix) | Profil | Rôle dans le test |
| --- | --- | --- |
| `commercial1` | Commercial | crée et force (à valider) |
| `technique1` | Technique (valideur) | valide ; paramètre les produits |
| `dg1` | Direction Générale | second valideur |

L'administrateur ne crée pas de cotation (droit « Aucun » dans le tableau du CDC §4) : il ne sert qu'aux comptes. Pour tester chaque profil, se déconnecter et se reconnecter, ou utiliser deux navigateurs (l'un en navigation privée).

**Paramétrage de départ (avec `technique1` ou `dg1`).**

1. **Paramétrage → Taxes** : ajouter la branche `SANTE`, taux `1,5`, date d'effet `2026-01-01`.
2. **Paramétrage → Produits** : créer le produit `BENI`, libellé « Santé BENI », gamme `RELAX`, branche `SANTE`.
3. Sur la fiche du produit, **Ajouter une version** : date d'effet `2026-01-01`, précision d'arrondi `1`, sens « Au plus proche », niveau « Ligne » et composante absorbante « Taxe » (valeurs par défaut), tranches max `1`, frais `0`, validité `3` mois, formules comparées `3`, **seuil de TTC pour la double validation : `20000000`**, prorata décoché (la cotation T1 est sur une année pleine). Deux formules :
   - `SOLO` : prime unitaire `93581.33`, accessoires **FIXE** `3000`
   - `FAMILLE` : prime unitaire `252657.63`, accessoires **FIXE** `210000`

**Cas T1 : cotation BENI (avec `commercial1`).** *Cotations → Nouvelle cotation* : produit BENI, souscripteur au choix (nom inventé), période du `2026-10-01` au `2027-09-30`, formules : Solo effectif `3`, Famille effectif `60`, aucune prime forcée. **Créer le brouillon**, puis **Soumettre (émettre)**.
Attendu : statut **Émise**, numéro `COT-2026-10-0001` (mois de l'émission), valide jusqu'à la date d'émission + 3 mois. Montants : Solo HT **280 744**, taxe **4 256**, TTC **288 000** ; Famille HT **15 159 458**, taxe **230 542**, TTC **15 600 000** ; total **15 888 000** ; TTC par personne **96 000** et par famille **260 000** (sous le seuil de 20 000 000 : aucune validation).
Puis **Accepter et créer la police** en retenant les deux formules : une police POL-… apparaît sur la fiche, et la cotation ne se modifie plus.

**Cas T13 : double validation (forçage).** Avec `commercial1`, nouvelle cotation avec une **prime unitaire forcée** (par exemple Solo à `90000`), motif `remise commerciale` ; essayer d'abord **sans motif** : refus attendu. Avec motif : **Soumettre**.
Attendu : statut **À valider**, **pas de numéro**, bandeau « Validation exigée » ; `commercial1` n'a **aucun** bouton de validation. Se connecter avec `technique1` : boutons **Valider et émettre** et **Renvoyer en brouillon** ; valider → **Émise**, avec numéro. Refaire avec un forçage créé par `technique1` lui-même : il ne peut pas valider **sa propre** cotation (il faut `dg1`). Variante : une cotation sans forçage mais au TTC supérieur à 20 000 000 passe aussi en « À valider ».

**Cas T11 : cotation expirée.** On ne peut pas attendre 3 mois : on avance le temps en base, en suspendant volontairement le déclencheur (comme le fait le test automatique ; **uniquement sur une base de test, jamais en production**). Noter l'identifiant interne de la cotation émise (dans l'adresse de sa fiche : `/cotations/<id>`), puis :

```powershell
docker compose exec postgres psql -U sim -d sim_documents -c "ALTER TABLE cotations DISABLE TRIGGER cotations_figees; UPDATE cotations SET date_validite = '2020-06-30' WHERE id = <id>; ALTER TABLE cotations ENABLE TRIGGER cotations_figees;"
```

Recharger la fiche. Attendu : statut **Expirée**, drapeau « EXPIRÉE », **plus de bouton d'acceptation** ; forcer l'acceptation est refusé (« expirée »).

**Contrôle du figement.** Sur une cotation émise, tenter en SQL de modifier un montant : PostgreSQL refuse (déclencheur `cotations_figees`).

**À regarder en particulier** (non vérifié par automate) : l'ajout et le retrait de lignes d'assurés et de formules dans le formulaire (JavaScript), l'affichage sur un écran étroit, la lisibilité des messages d'erreur, et les boutons visibles selon le profil. Noter tout écart : ce sont des corrections à faire avant la phase 3.

## 5. Suite

Phase 3 : fusion des modèles Word, PDF de la cotation, filigrane, contrôles au dépôt d'un modèle (balises inconnues rejetées avec leur emplacement), QR code. Avant : dérouler le [plan de test de tous les modèles](plan-test-modeles.md) pour savoir lesquels posent problème à LibreOffice.
