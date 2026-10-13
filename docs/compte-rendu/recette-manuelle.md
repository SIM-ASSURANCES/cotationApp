Cahier de recette manuelle test effectué par Thierry 
06-10-26

# Etape 0 : Environnement
**Etape | Action | Resultat Attendu | Resultat Obtenu**
| --- | --- | --- | --- | --- | | --- | --- |
Verification etat service | commande docker compose ps | 4 services healthy | OK
Verification route api sante | taper http://127.0.0.1:3000/api/sante dans le browser | {"statut":"ok","base":"ok","generateur":"ok"} | OK
Verification coupure du generateur | docker compose stop generateur | le generateur dans api/sante doit etre KO et status degrade | OK
Verification start du generateur | docker compose start generateur | le generateur dans api/sante doit etre Ok et statut ok  | OK

# Etape 1 : Connexions et droits (phase 0)

**Etape | Action | Resultat Attendu | Resultat Obtenu**

Test Hors connexion | Acceder a la page /calcul sans être connecté | redirection vers /connexion | OK
Test Blocage multi connexion | Tenter de se connecter plus de 5 fois avec un mauvais mdp | Bloquage et attente de 15 minutes,  aucune signalisation a l'interface | OK ( Ecrire dans les logs systeme )
Test droit Accordé | COnnexion avec droit commercial et acces a la page d'admin | Page de refus afficher a l'utilisateur | OK
Test de droit | Desactiver ou donenr acces a un droit | peut ou ne peut plus acceder au droit accorder /retirer sans rechargement de la page | Ok (partiel car on doit actualiser la page avant de recevoir les modifs de l'admin)
Consultation audit systeme |Ouvrir la page des lors et voir les differentes action efectué sur le systeme | Voir un journal avec les details de l'action et l'ip | OK


# Etape 2 : parametrage et calcul (phase 1)

**Etape | Action | Resultat Attendu | Resultat Obtenu**

Creation de taxes | Creation d'une taxe avenc date d'effet | Ligne ajouté et non modifiable | OK (Nuance la ligne est ajouter, mais on peut choisir un date picker pour la date d'eefet et la date de fin facultative et puis comment on sait que la taxes presente est une nouvelle version de la taxe passé? car j'ai crée deux taxes de la meme branche SANTE je ne vois pas en quoi elle sont lié, l'option de modification de la date a effet n'est pas presente ce qui est une bonne chose en soit la ligne est en affichage seulement )

Produit Beni | Creation du produit et ses deux formules | Apparition des formules y compris centimes | OK

Simulateur t1 | Se rendre dans calcul et executer les nombres du CDC | Obtenir le meme resultat que celui calculer a partir du CDC et a la main | OK

Simulateur T3 prorata | changer la date d'eefet d'un contrat et regarder si le le prorata fonctionne (borne incluse)  | Date de prorata obtenu et calcul en fonction effectué | OK
Echeancier t1| Verifié si les echances se font effectivment par tranche et additionner chaque echance pour trouver le ttc | tranche selectionné apliqué et correcpondante| OK 

Echeancier t2| Verifié si les echances se font effectivment par tranche et additionner chaque echance pour trouver le ttc selectionner une tranche non divisible pour verifié si l'ecart arrondi se met sur la derniere echeanche | tranche selectionné appliqué et correcpondante puis relicat appliqué a la derniere echeance | OK 


# Etape 3 : Cotation (phase 2)

3.1. Creation d'une cotation : 

Données inventé , produit Beni, premier probleme : Il n'y qu'une formule qui s'affiche (solo) la formule famille ne s'affiche pas, 
Quand Soumis et approuvé : validité = date + 3 mois 
le numero de cotation est attriuber a l'emission, 

3.2. Modification auteur 

Je me connecte en tant que technique apres avoir crée un brouillon sur l'ecran commercial, le technique vois le brouillon mais ne peux pas l'editer, il faut noter a ce moment (stade de brouillon) que aucune date de validité et date d'etablisement n'a été renseigner.


3.3 seuil de validation
 
J'ai récré un modele avec seuil de validation, mais la cotation n'est pas passer au statut a (à valider
) 



3.4. forcage de prime : 

le forcage ne passe pas sans motif voici le message *"Le motif du forçage de prime est obligatoire (5 caractères au moins)."*
quand on enregistre en brouillon et le forcage n'est pas rempli les champ sont reinitialise pourtant on peut laisser les autres et remplir le champ concerné ici le motif , 

QUand motif est renseingné le mot affiché : Validation exigée : Prime forcée. sort dans une banniere,
on  peut renvoyer le brouillon mais des qu'on le renvoyer il perd son statut et devients un simple brouillon au lieur d'etre A valider (visuellement), 
Point critique, le commertial peut valider sa propre cotation je me dit que c'est a cause des droit accordé (a verifier dans peanneua admin ) mais la cotation forcé ne peut etre validé par le commercial,


Montant forcé conservé et motif aussi 


presnece dans le journal d'audit du forcage de la prime 
refus de cotation , le retour de la cotation comme cité plus haut fonction avec le motif sauf que la cotation perd son statut a validé une fois retourné et devient brouillon meme quand le commertial le soumet a nouveau

Point d'arrêt du 07/10

Recette : étapes 0, 1 et 2 faites ; étape 3 (cotation : 3.1 à 3.8) à faire, sur la base Docker actuelle.
KO ouvert : saisie des montants au format français (erreur 500) → correction demandée à Claude Code : fonction unique de lecture des montants.
À faire avant la remise à zéro : héberger Montserrat dans le dépôt (le build échoue sur Google Fonts), puis down -v, initialiser, creer-admin et seed:dev.
Test 2.2b à ajouter : deux taxes SANTE dont les périodes se chevauchent.
Test D des polices (Tahoma → Arial) : à faire.
Mail à la Technique : ajouter H28 (accessoires non proratisés).
Phases restantes : 4 (factures, avoirs, reçus), 5 (masse, relances), 6 (VPS, balisage, documentation).





//Formatage par une IA.
# Cahier de recette manuelle

- **Date** : 06-10-26
- **Testeur** : Thierry
- **Environnement** : pile Docker (`docker compose`), 4 services
- **Version testée** : à renseigner avec `git log -1 --oneline` (dernier commit)

## Étape 0 : Environnement

| N° | Action | Attendu | Obtenu | Statut | Remarque |
| --- | --- | --- | --- | --- | --- |
| 0.1 | Vérification état service : `docker compose ps` | 4 services healthy | 4 services healthy | OK | |
| 0.2 | Vérification route API santé : `http://127.0.0.1:3000/api/sante` dans le navigateur | `{"statut":"ok","base":"ok","generateur":"ok"}` | `{"statut":"ok","base":"ok","generateur":"ok"}` | OK | |
| 0.3 | Vérification coupure du générateur : `docker compose stop generateur` | Le générateur dans `api/sante` doit être KO et statut dégradé | Générateur KO, statut dégradé | OK | |
| 0.4 | Vérification redémarrage du générateur : `docker compose start generateur` | Le générateur dans `api/sante` doit être OK et statut OK | Générateur OK, statut OK | OK | |

## Étape 1 : Connexions et droits (phase 0)

| N° | Action | Attendu | Obtenu | Statut | Remarque |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Test hors connexion : accéder à `/calcul` sans être connecté | Redirection vers `/connexion` | Redirection vers `/connexion` | OK | |
| 1.2 | Test blocage multi-connexion : tenter de se connecter plus de 5 fois avec un mauvais mot de passe | Blocage et attente de 15 minutes, aucune signalisation à l’interface | Blocage et attente de 15 minutes, aucune signalisation à l’interface | OK avec réserve | Écrire l’événement dans les logs système. |
| 1.3 | Test droit accordé : connexion avec droit commercial et accès à la page d’admin | Page de refus affichée à l’utilisateur | Page de refus affichée | OK | |
| 1.4 | Test de droit : désactiver ou donner accès à un droit | Peut ou ne peut plus accéder au droit accordé/retiré sans rechargement de la page | L’accès change après actualisation manuelle de la page | OK avec réserve | Ce n’est pas un « partiel » : le serveur revérifie les droits à chaque requête. Dès que la page suivante se charge, l’accès change. La page déjà affichée ne se met pas à jour toute seule, et c’est normal. |
| 1.5 | Consultation audit système : ouvrir la page des logs et voir les différentes actions effectuées sur le système | Voir un journal avec les détails de l’action et l’IP | Journal avec détails de l’action et IP | OK | |

## Étape 2 : Paramétrage et calcul (phase 1)

| N° | Action | Attendu | Obtenu | Statut | Remarque |
| --- | --- | --- | --- | --- | --- |
| 2.1 | Création de taxes : création d’une taxe avec date d’effet | Ligne ajoutée et non modifiable | Ligne ajoutée ; date picker pour date d’effet et date de fin facultative ; ligne en affichage seul | OK avec réserve | Défaut d’affichage : deux taxes SANTE apparaissent sans qu’on voie qu’il s’agit de deux versions de la même taxe. Il faut un historique par branche, avec la période de chaque version. La date de fin facultative pose la question du chevauchement. |
| 2.2b | Créer deux taxes SANTE dont les périodes se chevauchent (taux différents) | Refus du chevauchement, avec un message | Non exécuté | à faire | Test à ajouter : le moteur doit choisir une seule taxe, sans ambiguïté. |
| 2.3 | Produit Beni : création du produit et ses deux formules | Apparition des formules y compris centimes | Formules affichées, y compris centimes | OK | |
| 2.3a | Saisie d’une prime au format français (93 581,33) | Enregistrement, ou message sous le champ | Page d’erreur 500 (`PrismaClientValidationError`) | KO | Correction demandée à Claude Code : lecture unique des montants. À retester après correction. |
| 2.4 | Simulateur T1 : se rendre dans calcul et exécuter les nombres du CDC | Obtenir le même résultat que celui calculé à partir du CDC et à la main | Montants lus à l’écran : 288 000 / 15 600 000 / 15 888 000 | OK | |
| 2.5 | Simulateur T3 prorata : changer la date d’effet d’un contrat et regarder si le prorata fonctionne (borne incluse) | Date de prorata obtenue et calcul en fonction effectué | 163 jours, coefficient 0,44658 | OK | |
| 2.6 | Échéancier T1 : vérifier si les échéances se font effectivement par tranche et additionner chaque échéance pour trouver le TTC | Tranche sélectionnée appliquée et correspondante | Tranches appliquées et correspondantes ; somme des échéances = TTC | OK | |
| 2.7 | Échéancier T2 : vérifier si les échéances se font par tranche et additionner chaque échéance pour trouver le TTC ; sélectionner une tranche non divisible pour vérifier si l’écart d’arrondi se met sur la dernière échéance | Tranche sélectionnée appliquée et correspondante, puis reliquat appliqué à la dernière échéance | Tranche appliquée et correspondante ; reliquat d’arrondi appliqué à la dernière échéance | OK | |

## Étape 3 : Vérifications de sécurité

| N° | Action | Attendu | Obtenu | Statut | Remarque |
| --- | --- | --- | --- | --- | --- |
| 3.1 | Vérifier le journal d’audit inviolable en base | Preuve d’inviolabilité : contraintes, permissions, triggers, hash chaîné, etc. | Non testé | non fait | À ajouter : ce qui n’est pas noté est réputé non testé. |
| 3.2 | Vérifier les en-têtes HTTP de sécurité | En-têtes attendus présents : CSP, HSTS, X-Content-Type-Options, etc. | Non testé | non fait | |
| 3.3 | Tester une redirection ouverte | Refus ou redirection limitée aux domaines autorisés | Non testé | non fait | |
| 3.4 | Accéder à une ressource protégée sans authentification | Réponse HTTP 401 | Non testé | non fait | |

## Points saillants

- **KO principal** : 2.3a — saisie d’une prime au format français `93 581,33` → erreur 500 `PrismaClientValidationError`. Correction demandée, à retester.
- **Réserve** : 2.1 — affichage/historique des taxes SANTE par branche, avec période de chaque version.
- **À faire** : 2.2b — refus du chevauchement de deux taxes SANTE à taux différents.
- **Non fait** : 3.1 à 3.4 — vérifications de sécurité (journal d’audit inviolable, en-têtes HTTP, redirection ouverte, code 401).