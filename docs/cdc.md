SIM ASSURANCES CÔTE D’IVOIRE

Direction Technique

CAHIER DES CHARGES

Module de génération automatique des documents

Cotations • Contrats • Factures • Reçus • Avis d’échéance et relances

Rendu PDF à partir de modèles Word modifiables


| Version | 1.0 – document de travail |
|---|---|
| Date | 25 septembre 2026 |
| Auteur | YEO Yamani – Responsable Technique |
| Destinataires | Équipe de développement / DSI |
| Statut | À valider par la Direction Générale |

Sommaire


# 1. Contexte et objectifs


## 1.1 Contexte

SIM Assurances CI produit aujourd’hui ses cotations, contrats (Conditions Particulières – CP) et factures manuellement dans Word, à partir de modèles hétérogènes. L’analyse des modèles existants (16 CP, 6 Conditions Générales/Conventions Spéciales, 2 factures, 1 offre santé) fait apparaître :

- des zones à remplir non normalisées (traits « |____| », « XXX », « 00/00/00 », « Variable système », « [à préciser] », cellules vides) qui empêchent toute automatisation ;
- des erreurs de recopie : références de visa incohérentes, montants de taxe erronés, dates saisies en dur, taux de couverture figés ;
- des factures sans format unique (deux présentations différentes, numérotation remise à zéro chaque mois, mentions légales absentes) ;
- un délai de production incompatible avec les volumes de la micro-assurance (contrats de groupe, IMF, centaines d’adhérents).
Des gabarits HTML ont déjà été utilisés pour générer certains contrats (ex. RELAXMOTO). Ils seront remplacés par des modèles Word, format maîtrisé par les équipes métier.


## 1.2 Objectifs

- Générer automatiquement en PDF les cotations, contrats, factures, reçus, avis d’échéance et lettres de relance à partir des données du back-office.
- Laisser la main au métier : les modèles restent des fichiers Word que la Direction Technique modifie sans intervention informatique.
- Fiabiliser les calculs (prime nette, accessoires, taxes, prorata, fractionnement, arrondis) par un moteur unique et paramétrable.
- Tracer et sécuriser : versions des modèles, validation, numérotation continue, QR code d’authenticité, archivage scellé 10 ans.
- Passer à l’échelle : génération en masse (contrats de groupe, certificats d’adhésion, bordereaux IMF).

## 1.3 Documents de référence


| Référence | Contenu |
|---|---|
| CDC Back-office central SIM | Application de gestion dont le présent module fait partie (clients, polices, primes, paiements, fiscalité, audit). |
| CDC Portail de souscription IMF | Source de données pour les produits IMF (temporaire décès, décès emprunteur). |
| Modèles CP (dossier « CP word ») | 16 modèles de Conditions Particulières – inventaire en Annexe B. |
| Conditions Générales / Conventions Spéciales | SECURVIE (01497), SECUR RECOLTE (01496), SECUR DOMMAGE (01498), RELAXVOYAGE (01504), RELAXSANTE CS (01505), RELAX ACCIDENTS (01507). |
| Factures de référence | Facture 003-0926 (CGE-SN GCAR-CI) et 004-0926 (Yao Fowoundi). |
| Offre de référence | Offre d’assurance santé BENI ASSURANCES du 24/09/2026. |
| Code CIMA | Notamment art. 13 (prise d’effet subordonnée au paiement de la prime). |


# 2. Périmètre


## 2.1 Positionnement

Le module est un composant du back-office central. Il ne gère pas lui-même les clients, polices ou paiements : il lit ces données, calcule les montants, fusionne les données dans les modèles Word et produit les PDF. Une saisie libre est prévue pour les cotations adressées à des prospects non encore enregistrés dans le back-office.


## 2.2 Documents couverts en version 1


| Document | Déclencheur | Signature SIM | Observations |
|---|---|---|---|
| Cotation (offre) | Demande commerciale | Automatique (scan) | 1 à 3 formules comparées ; validité paramétrable |
| Contrat – Conditions Particulières | Acceptation de la cotation / souscription | Automatique (scan) | PDF unique CP + CS + CG ; zone signature client manuscrite |
| Certificat d’adhésion | Contrat de groupe | Automatique (scan) | Un par adhérent, généré en masse |
| Facture | Émission du contrat, renouvellement, avenant | Automatique (scan) | Modèle unique ; échéancier et/ou paiements |
| Facture d’avoir | Annulation / correction / retrait | Automatique (scan) | Seul moyen de corriger une facture émise |
| Reçu de paiement | Enregistrement d’un paiement | Aucune | Met à jour le « restant dû » |
| Avis d’échéance | J-x avant échéance d’une tranche ou du terme | Aucune | Délai paramétrable |
| Lettre de relance | Tranche impayée à J+x | Aucune | Niveaux de relance paramétrables |


## 2.3 Produits couverts en version 1


| Gamme | Produits | CG / CS de rattachement |
|---|---|---|
| SECUR (dommages) | SECURHOME, SECURHOME PLUS, SECURPRO, SECURSTOCK, SECURMOTO, Vol, Bris de glace, Dégâts des eaux, Dommages électriques | SECUR DOMMAGE – N° 01498 |
| SECUR (vie / agricole) | SECURVIE (temporaire décès), SECURECOLTE | N° 01497 / N° 01496 |
| RELAX | RELAXSANTE (individuelle, groupe, PLUS), RELAXACCIDENT (moto-livreur, VTC, artisan), RELAXVOYAGE, RELAXVOYAGE+ | CS RELAXSANTE 01505 ; RELAX ACCIDENTS 01507 ; RELAXVOYAGE 01504 |
| Produits IMF | Temporaire décès titulaire de compte, Décès emprunteur | Selon produit (à paramétrer) |
| Autres | Moto-livraison, Multirisque agricole, Produit intégré frais médicaux accidentels | Selon produit (à paramétrer) |


| Principe clé : aucun produit n’est « codé en dur ». Tout nouveau produit doit pouvoir être ajouté par paramétrage + dépôt de modèles Word, sans développement. |
|---|


## 2.4 Hors périmètre V1

- Attestations d’assurance et cartes d’assuré (V2).
- Documents d’avenant autres que la facture d’avenant (V2).
- Envoi automatique par e-mail, WhatsApp/SMS et espace client (V2) – l’architecture doit toutefois le permettre.
- Signature électronique du client (non retenue).

# 3. Glossaire à l’usage des développeurs


| Terme | Définition |
|---|---|
| Souscripteur | Personne (physique ou morale) qui signe le contrat et paie la prime. |
| Assuré | Personne (ou bien) sur laquelle porte le risque. Peut être différent du souscripteur. |
| Bénéficiaire | Personne qui reçoit l’indemnité en cas de sinistre (ex. décès). |
| Intermédiaire | Courtier ou agent qui apporte l’affaire (ex. BENI ASSURANCES). Certains contrats en ont deux. |
| Police / N° de police | Le contrat et son identifiant unique, attribué par le back-office. |
| Police mère / certificat d’adhésion | Contrat de groupe (entreprise, IMF) et document individuel remis à chaque adhérent. |
| Formule / option | Niveau de garantie d’un produit (ex. Solo / Famille ; taux 70 % / 80 %). |
| Prime nette (HT) | Coût du risque + chargements, hors accessoires et taxes. |
| Accessoires | Frais de gestion de police, fixes ou proportionnels. |
| Taxe | Taxe sur les primes, taux fixé par branche (ex. 1,5 %). |
| Prime TTC | Prime nette + accessoires + taxes : montant payé par le client. |
| Prorata temporis | Prime ajustée à la durée réelle de couverture lorsqu’elle diffère d’un an. |
| Fractionnement | Paiement de la prime en plusieurs tranches (échéancier). |
| Avenant | Modification d’un contrat en cours (ajout/retrait d’assuré, changement de garantie). |
| Ristourne / Avoir | Remboursement ou annulation de prime (ex. retrait d’un assuré). |
| CP / CG / CS | Conditions Particulières (propres au client), Conditions Générales (communes au produit, visées par la Direction des Assurances), Conventions Spéciales (compléments de garanties). |
| Visa DA | Référence d’approbation des CG par la Direction des Assurances (ex. « MFB/DGTCP/DA/N° 01498 du 19 juin 2025 »). |
| Délai de carence | Période après l’effet pendant laquelle une garantie ne joue pas encore. |
| S/P | Rapport sinistres / primes : indicateur de rentabilité d’un contrat. |


# 4. Acteurs, profils et droits


| Action | Commercial | Gestionnaire production | Technique (valideur) | Comptabilité | Direction Générale | Admin système |
|---|---|---|---|---|---|---|
| Créer une cotation | Oui | Oui | Oui | – | Lecture | – |
| Forcer une prime | Demande | Demande | Valide | – | Valide | – |
| Émettre un contrat | – | Oui (sous seuil) | Oui | – | Lecture | – |
| Émettre une facture | – | Oui (sous seuil) | Oui | Oui | Lecture | – |
| Émettre un avoir | – | – | Valide | Oui | Valide | – |
| Enregistrer un paiement / reçu | – | Oui | – | Oui | – | – |
| Déposer/modifier un modèle Word | – | – | Oui | – | – | – |
| Publier un modèle | – | – | Non (auteur) | – | Oui | – |
| Paramétrer produits, taxes, arrondis | – | – | Oui | Taxes (proposition) | Valide | – |
| Gérer utilisateurs, dossier partagé | – | – | – | – | – | Oui |
| Consulter le journal d’audit | – | – | Lecture | – | Lecture | Lecture |

Les profils sont ceux du back-office central (authentification unique). Les droits ci-dessus sont paramétrables par l’administrateur.


## 4.1 Règles de double validation

- Tout document dont la prime TTC dépasse un seuil paramétrable (par produit) passe en statut « À valider » et doit être validé par un profil Technique ou DG avant émission.
- Tout forçage de prime (écart par rapport au tarif calculé) exige un motif obligatoire et une validation, quel que soit le montant.
- Le valideur ne peut pas être l’auteur du document (séparation des tâches).
- Un document validé est figé : toute modification ultérieure repasse par le circuit.

# 5. Architecture fonctionnelle

Le traitement d’un document suit une chaîne unique, quel que soit son type :

Back-office (clients, polices,     Paramétrage produit        Bibliothèque de modèles

primes, paiements)  ──────┐        (tarifs, taxes, arrondis)  (Word versionnés)

▼                 │                        │

[1] Constitution du jeu de données (JSON)  ◄─────────┘

│                 │

▼                 ▼

[2] Moteur de calcul (primes, taxes, prorata, échéancier, arrondis)

│

▼

[3] Contrôles (champs obligatoires, cohérences, seuils) ─► À valider ?

│

▼

[4] Fusion Word (docxtpl) ─► [5] Conversion PDF (LibreOffice)

│

▼

[6] Assemblage (CP + CS + CG + annexes) + QR code + empreinte SHA-256

│

▼

[7] Archivage (base + dossier partagé réseau SIM) + journal d’audit

Exigence : l’étape [2] est la seule source des montants. Aucun montant n’est saisi directement dans un modèle ; le modèle ne fait qu’afficher des valeurs déjà calculées et arrondies.


# 6. Gestion des modèles Word


## 6.1 Principes

- Un modèle est un fichier .docx standard, éditable dans Microsoft Word, contenant des balises remplacées à la génération.
- Syntaxe retenue : Jinja2 / docxtpl – {{ objet.champ }} pour une valeur, {% if %} pour un bloc conditionnel, {%tr for %} pour une ligne de tableau répétée.
- Les éléments communs (logo, pied de page légal, adresse, capital social, e-mail de réclamation) ne sont jamais écrits en dur : ils proviennent du paramétrage Société ({{ societe.* }}).
- Les CG et CS sont des modèles fixes (sans balise, hormis éventuellement le visa) convertis une fois en PDF et versionnés.

## 6.2 Syntaxe des balises


| Besoin | Syntaxe dans le Word | Exemple de rendu |
|---|---|---|
| Valeur simple | {{ souscripteur.nom }} | KOUASSI |
| Montant formaté | {{ prime.ttc \| montant }} | 11 592 000 |
| Montant en lettres | {{ prime.ttc \| lettres }} | onze millions cinq cent quatre-vingt-douze mille francs CFA |
| Date | {{ police.date_effet \| date }} | 01/09/2026 |
| Date et heure | {{ police.date_effet \| dateheure }} | 01/09/2026 à 08h00 |
| Pourcentage | {{ formule.taux_couverture \| pct }} | 80 % |
| Case à cocher | {{ risque.statut == "PROPRIETAIRE" \| case }} | ☒ Propriétaire  ☐ Locataire |
| Bloc conditionnel | {% if police.nantissement %} … {% endif %} | Clause « Nantissement » affichée ou non |
| Ligne de tableau répétée | {%tr for a in assures %} … {%tr endfor %} | Une ligne par assuré |
| Sous-modèle (formule) | {{ bloc("garanties", formule.code) }} | Insère le tableau de garanties de la formule |
| Image (signature, QR) | {{ signature_sim }}  {{ qr_code }} | Image insérée à la taille prévue |

Les filtres montant, lettres, date, dateheure, pct, case et la fonction bloc() sont fournis par le module et documentés dans l’aide intégrée.


## 6.3 Dictionnaire des champs

Le dictionnaire ci-dessous est normatif : les développeurs doivent exposer exactement ces noms ; les modèles ne peuvent utiliser que ces champs. Il est extensible par paramétrage (champs spécifiques produit dans risque.*).


### 6.3.1 Société, produit, intermédiaire


| Champ | Type | Description / source |
|---|---|---|
| societe.raison_sociale, .forme, .capital, .capital_libere | Texte | SIM Assurances Côte d’Ivoire, SA, 727 000 000, 77 % |
| societe.adresse, .bp, .telephone, .email_reclamation, .site | Texte | Paramètre Société (e-mail de réclamation à renseigner) |
| societe.rccm, .ncc, .agrement | Texte | Mentions légales |
| societe.rib[], .mobile_money[] | Liste | Banque, n° compte / opérateur, n° marchand |
| societe.recours[] | Liste | OQSF-CI, Direction des Assurances, Médiation (libellé + URL) |
| produit.code, .libelle, .gamme, .branche | Texte | Ex. RELAXSANTE, Santé |
| produit.cg_libelle, .cg_visa, .cg_date | Texte/Date | Ex. « SECUR DOMMAGE », « MFB/DGTCP/DA/N° 01498 », 19/06/2025 |
| produit.cs_libelle, .cs_visa | Texte | Conventions spéciales éventuelles |
| intermediaires[] (.nom, .code, .role) | Liste | 0 à 2 intermédiaires (SECURSTOCK en prévoit deux) |


### 6.3.2 Souscripteur, assurés, bénéficiaires, risque


| Champ | Type | Description / source |
|---|---|---|
| souscripteur.type | Liste | PHYSIQUE / MORALE |
| souscripteur.nom, .prenoms, .raison_sociale | Texte |  |
| souscripteur.num_identification, .date_naissance, .lieu_naissance | Texte/Date | CNI, passeport… |
| souscripteur.profession, .activite, .employeur | Texte |  |
| souscripteur.adresse, .bp, .localite, .sous_prefecture | Texte |  |
| souscripteur.telephone, .whatsapp, .mobile_money, .email | Texte |  |
| souscripteur.situation_matrimoniale, .nb_enfants, .groupe_sanguin | Texte/Entier | Santé |
| assures[] (.ordre, .nom_prenoms, .date_naissance, .lien, .formule, .prime) | Liste | Assurés du contrat |
| beneficiaires[] (.ordre, .nom_prenoms, .lien, .contact, .quote_part) | Liste | SECURVIE, RELAXACCIDENT |
| contacts_urgence[] (.nom_prenoms, .contact) | Liste | RELAXVOYAGE |
| risque.* | Variable | Champs propres au produit : moto (chassis, marque, puissance, 1re mise en circulation, valeur neuve, âge), logement (nb pièces, statut, identifiant CIE/SODECI), stock (montant total, montant nanti, construction, toiture, prévention, protection), voyage (départ, arrivée, n° départ, n° ticket), récolte (semence, montant du pack), vol (capitaux choisis, gardiennage jour/nuit…) |


### 6.3.3 Police, formule, primes, échéances, paiements


| Champ | Type | Description / source |
|---|---|---|
| police.numero, .reference | Texte | Attribué par le back-office |
| police.date_souscription, .date_effet, .date_echeance | Date(heure) | Heure obligatoire pour RELAXVOYAGE |
| police.duree_jours, .duree_libelle | Entier/Texte | Calculé |
| police.type_contrat | Liste | INDIVIDUEL / FAMILLE / GROUPE / GROUPE_OUVERT |
| police.police_mere | Texte | Pour un certificat d’adhésion |
| police.nantissement (.beneficiaire, .montant) | Objet | SECURSTOCK |
| formules[] (.code, .libelle, .taux_couverture, .effectif, .prime_unitaire, .prime_nette, .accessoires, .taxe, .ttc) | Liste | Une ligne par formule (Solo, Famille…) |
| prime.nette, .accessoires, .base_taxe, .taux_taxe, .taxe, .ttc | Montant | Totaux arrondis selon le produit |
| prime.forcee, .motif_forcage | Booléen/Texte | Non affiché au client |
| echeances[] (.numero, .date, .montant, .statut) | Liste | Échéancier |
| paiements[] (.numero, .date, .montant, .reference, .canal, .restant_du) | Liste | Historique |
| solde.total_paye, .restant_du | Montant | Calculé |


### 6.3.4 Document


| Champ | Type | Description |
|---|---|---|
| doc.type, .numero, .version, .date_emission, .lieu_emission | Texte/Date | Ex. FACTURE, FAC-2026-09-0003, v1, 16/09/2026, Abidjan |
| doc.date_validite | Date | Cotations |
| doc.signataire_nom, .signataire_fonction | Texte | Ex. YEO Yamani – Responsable Technique |
| signature_sim, cachet_sim | Image | Selon le signataire, pour cotation, facture et contrat |
| qr_code, doc.url_verification, doc.empreinte | Image/Texte | Vérification d’authenticité |
| doc.facture_origine | Texte | Référence de la facture annulée (avoir) |


## 6.4 Blocs variables et sous-modèles

Les zones aujourd’hui marquées « Variable système » (garanties, options de couverture, classes de risque, barèmes de prestations) sont gérées de deux manières selon les cas :

- Automatique : le paramétrage de la formule désigne le sous-modèle Word à insérer (ex. barème RELAXSANTE 70 % ou 80 %) et les conditions d’affichage des clauses (nantissement si police.nantissement, tiers payant NOVELIA si le produit l’active, prime enfant supplémentaire si plus de 3 enfants, clause S/P pour la santé).
- Manuel : pour les clauses marquées « optionnelles » dans le paramétrage, l’utilisateur coche au moment de la génération les blocs à inclure ; son choix est tracé dans le journal.

## 6.5 Listes longues

Lorsqu’une liste (assurés, bénéficiaires, formules, échéances) dépasse 10 lignes, le corps du document affiche « Voir annexe – Liste des assurés (N personnes) » et la liste complète est rendue dans une annexe générée à partir d’un modèle d’annexe dédié, placée à la fin du PDF. Le seuil est paramétrable.


## 6.6 Cycle de vie et versions des modèles


| Statut | Qui | Effet |
|---|---|---|
| Brouillon | Technique | Dépôt d’un .docx ; utilisable seulement en « aperçu » avec données fictives |
| Soumis | Technique | Contrôles automatiques réussis (§6.7) ; en attente de validation |
| Publié | DG / Responsable technique (≠ auteur) | Utilisé pour toutes les nouvelles générations à partir de sa date d’effet |
| Archivé | Système | Remplacé par une nouvelle version ; conservé indéfiniment |

- Chaque version porte : n° de version, date d’effet, auteur, valideur, commentaire de modification, empreinte du fichier.
- Régénération à l’identique : la ré-édition d’un document émis utilise la version du modèle et des paramètres en vigueur à sa date d’émission (et non la dernière version).
- Comparaison possible entre deux versions (aperçu PDF côte à côte).

## 6.7 Contrôles au dépôt d’un modèle

- Le fichier s’ouvre et est un .docx valide.
- Toutes les balises utilisées existent dans le dictionnaire (sinon : rejet avec la liste des balises inconnues et leur emplacement).
- Les blocs if/for sont correctement fermés.
- Les champs obligatoires du type de document sont présents (ex. une facture doit contenir doc.numero, prime.ttc, societe.rccm).
- Absence de marqueurs hérités : « XXX », « 00/00/00 », « [à préciser] », « Variable système », « Nom de la compagnie », suites de « ___ ».
- Génération d’un aperçu PDF avec un jeu de données de test du produit.

## 6.8 Assemblage du contrat

Le PDF du contrat est un seul fichier composé dans l’ordre : CP (générées) → Annexes éventuelles (liste des assurés) → Conventions Spéciales (si le produit en a) → Conditions Générales. Le visa cité dans les CP est lu dans le paramétrage produit et doit être identique à celui des CG jointes (contrôle bloquant).


# 7. Paramétrage produit

Chaque produit dispose d’une fiche de paramétrage, historisée avec date d’effet (un changement de taux ne modifie jamais les documents déjà émis).


| Rubrique | Paramètres |
|---|---|
| Identification | Code, libellé, gamme, branche, statut (actif/inactif) |
| Références contractuelles | CG (fichier, libellé, visa, date), CS éventuelles |
| Modèles | Modèle de cotation, de CP, de certificat, d’annexe ; sous-modèles par formule |
| Formules | Code, libellé, taux de couverture, garanties, plafonds, barème, prime unitaire ou mode de calcul |
| Accessoires | Mode : fixe par contrat / par tête / par famille / % de la prime nette ; montant ou taux |
| Taxe | Branche fiscale (taux et assiette hérités de la table des taxes §8.3) |
| Arrondis | Précision (1, 10, 100, 1 000), sens (proche / supérieur / inférieur), niveau (ligne / total), composante absorbant l’écart |
| Prorata | Actif / inactif ; convention de décompte ; prime minimale |
| Fractionnement | Nombre de tranches autorisées, répartition (%), dates types, frais de fractionnement |
| Cotation | Durée de validité (jours ; 90 par défaut), nombre maximal de formules comparées (3) |
| Validation | Seuil de prime TTC déclenchant la double validation |
| Numérotation police | Format (préfixe, année, séquence) – appliqué par le back-office |
| Clauses optionnelles | Liste des blocs activables manuellement |
| Signature | Mode par type de document : scan automatique / manuscrite |
| Relances | Délai avis d’échéance (J-x), niveaux de relance (J+x), modèle par niveau |


# 8. Règles de calcul


| Toutes les règles ci-dessous sont paramétrables ; les valeurs citées sont celles constatées dans les documents actuels et servent de valeurs par défaut et de jeux de tests. |
|---|


## 8.1 Chaîne de calcul

Pour chaque formule f :

prime_nette_f  = prime_unitaire_f × effectif_f × coef_prorata

accessoires_f  = selon mode : fixe | par tête × effectif

| par famille × effectif | % × prime_nette_f

base_taxe_f    = prime_nette_f + accessoires_f   (assiette retenue)

taxe_f         = base_taxe_f × taux_taxe(branche, date_effet)

ttc_f          = prime_nette_f + accessoires_f + taxe_f

Totaux  = Σ f ;  puis application des règles d’arrondi du produit (§8.5)

Contrôle bloquant : TTC = Nette + Accessoires + Taxe (après arrondi, à 0 F près)


## 8.2 Prorata temporis

- coef_prorata = nombre de jours couverts / 365, avec nombre de jours = date d’échéance – date d’effet + 1 (bornes incluses).
- Exemple : effet 22/07/2026, échéance 31/12/2026 → 163 jours → coef = 163/365 = 0,44658.
- Si le produit définit une prime minimale, la prime nette retenue est max(prime proratisée, prime minimale).

## 8.3 Taxes

Une table des taxes est gérée par la comptabilité : branche, taux, assiette, date d’effet, date de fin. Assiette retenue par défaut : prime nette + accessoires (constaté dans l’offre BENI : 1,5 % × (280 744 + 3 000) = 4 256).


| Anomalie à corriger : la facture 004-0926 (Yao Fowoundi) affiche une taxe de 2 292 F sur une base de 120 633 F, soit 1,90 %. Il s’agit d’une erreur de saisie confirmée ; le montant correct au taux de 1,5 % est 1 809,50 F avant arrondi. Ce cas est repris dans le plan de tests (§15). |
|---|


## 8.4 Fractionnement et échéancier

- L’échéancier est proposé selon le paramétrage produit puis modifiable à la cotation (nombre de tranches, dates, montants), dans les limites autorisées.
- Contrôle : la somme des tranches = prime TTC ; la dernière tranche absorbe l’écart d’arrondi.
- Frais de fractionnement éventuels ajoutés aux accessoires.
- Rappel CIMA (art. 13) : la prise d’effet est subordonnée au paiement ; le sort de la garantie en cas de paiement partiel suit la règle produit du back-office.

## 8.5 Arrondis

Paramétrés par produit : précision (1, 10, 100, 1 000 F), sens (au plus proche, supérieur, inférieur), niveau (chaque ligne ou total seulement) et composante absorbant l’écart lorsqu’on arrondit le TTC à un montant rond. Les primes unitaires sont stockées avec décimales et seuls les montants affichés sont arrondis.

Exemple constaté (facture CGE-SN) : 8 × prime unitaire affichée 236 453 = 1 891 624, mais la ligne affiche 1 891 626 car la prime unitaire réelle est 236 453,25. Le document doit donc afficher soit la prime unitaire avec décimales, soit une ligne recalculée à partir de la valeur arrondie : règle à fixer par produit (par défaut : affichage de la prime unitaire arrondie et montant de ligne = valeur exacte arrondie, avec mention « montants arrondis »).


## 8.6 Montant en lettres

Généré automatiquement en français (bibliothèque num2words ou équivalent), suffixé « francs CFA ». Ex. 11 592 000 → « onze millions cinq cent quatre-vingt-douze mille francs CFA ».


# 9. Module Cotation


## 9.1 Parcours

- Sélection du produit ; saisie du prospect (saisie libre) ou sélection d’un client du back-office.
- Saisie des caractéristiques du risque (champs risque.* du produit) et des effectifs par formule.
- Choix de 1 à 3 formules à comparer ; calcul automatique (§8).
- Forçage éventuel d’une prime avec motif → passage en « À valider ».
- Choix de l’échéancier proposé et des clauses optionnelles.
- Aperçu PDF ; validation si requise ; émission (numéro définitif, signature scannée, QR).

## 9.2 Contenu type (modèle de référence : offre BENI)

- En-tête : intermédiaire, durée, territorialité, réseau de soins, gestionnaire.
- Tableau des primes par formule : effectif, prime HT unitaire, prime totale HT, accessoires, taxes, TTC, total général.
- Tableau comparatif des formules (jusqu’à 3) et prime par personne / par famille.
- Barème des prestations de chaque formule (sous-modèle).
- Nature des prestations, délais de carence, conditions de souscription, services, pièces à fournir, mode de remboursement, dispositions particulières (clause S/P).
- Date d’établissement, date de fin de validité, signature SIM.

## 9.3 Statuts


| Statut | Transition |
|---|---|
| Brouillon | Création ; modifiable |
| À valider | Seuil dépassé ou prime forcée |
| Émise / Envoyée | Numéro COT-AAAA-MM-NNNN attribué ; figée |
| Acceptée | Le client choisit une formule → transformation (§9.4) |
| Refusée | Motif de refus obligatoire (liste paramétrable) |
| Expirée | Automatique à la date de validité ; le PDF ré-édité porte le filigrane « EXPIRÉE » |


## 9.4 Transformation

À l’acceptation, le module transmet au back-office la formule retenue, les assurés et l’échéancier. Le back-office crée la police (numéro) ; le module génère alors le contrat puis la facture sans ressaisie. Tableau de bord : nombre de cotations par statut, taux de transformation par produit, par intermédiaire et par commercial.


# 10. Module Contrat (Conditions Particulières)


## 10.1 Contenu obligatoire des CP

- Bloc d’identification : n° de police, intermédiaire(s), souscripteur, contact, dates de souscription / effet / échéance, durée.
- Bloc des primes complet : prime nette, accessoires, taxe, prime TTC (aujourd’hui absent de SECURMOTO et SECURECOLTE, incomplet dans SECURVIE).
- Déclaration du souscripteur et caractéristiques du risque.
- Assurés, bénéficiaires, contacts d’urgence (tableaux répétés ; annexe au-delà de 10).
- Garanties / options / classes de risque (sous-modèles).
- Clause de composition du contrat citant les CG et leur visa issus du paramétrage.
- Clause réclamation avec {{ societe.email_reclamation }} et voies de recours.
- Lieu, date d’émission, zone de signature client (manuscrite) et signature SIM scannée.

## 10.2 Contrats de groupe

- Police mère : CP de groupe + annexe liste des adhérents.
- Certificats d’adhésion individuels générés en masse (§13), chacun avec son QR code, renvoyant à la police mère.
- Incorporation / retrait d’adhérents : régénération de l’annexe (nouvelle version) et facture d’avenant.

# 11. Module Facture


## 11.1 Modèle unique

Un seul modèle de facture, avec affichage conditionnel :

- Bloc échéancier (n°, date d’échéance, montant, statut Payé/Non payé) si le contrat est fractionné ;
- Bloc paiements reçus (n°, date, montant, référence, restant dû) dès qu’un paiement existe ;
- Les deux blocs peuvent coexister.

## 11.2 Contenu obligatoire


| Zone | Éléments |
|---|---|
| En-tête | Logo, raison sociale, adresse, RCCM, NCC, n° de facture, date, n° de police (obligatoire – absent de la facture CGE-SN), dates d’effet et de fin |
| Client | « Facturé à » (souscripteur, adresse – absente de la facture YAO) et « Envoyé à » (si différent, sinon masqué) |
| Détail | Produit, formule, prime unitaire HT, nombre, prime HT, accessoires, montant HT par ligne |
| Totaux | Total HT, taxe (taux affiché), total TTC en chiffres et en lettres |
| Paiement | Échéancier / paiements ; RIB ; numéros Mobile Money ; conditions de paiement (rappel art. 13 CIMA) |
| Pied | Signataire, signature scannée, QR code, mentions légales |


## 11.3 Types de factures


| Type | Déclencheur | Particularités |
|---|---|---|
| Affaire nouvelle | Émission du contrat | – |
| Renouvellement | Échéance / tacite reconduction | Nouvelles dates, tarif en vigueur au renouvellement |
| Avenant (incorporation) | Ajout d’assurés / garanties | Prime additionnelle au prorata |
| Avoir (retrait / annulation / correction) | Retrait d’assurés, annulation, erreur | Montants négatifs ; référence à la facture d’origine |
| Facture de groupe | Contrat de groupe / IMF | Une facture globale + annexe par adhérent |


## 11.4 Numérotation

- Format par défaut `FAC-AAAA-MM-NNNN` (ex. FAC-2026-09-0003) ; avoir `AV-AAAA-MM-NNNN` ; cotation `COT-AAAA-MM-NNNN` ; reçu `REC-AAAA-MM-NNNN`.
- Compteur annuel, unique, continu et sans trou, attribué uniquement à l’émission (un brouillon n’a pas de numéro).
- Format paramétrable par l’administrateur ; toute modification est tracée.

## 11.5 Intangibilité

- Une facture émise ne peut pas être modifiée ni supprimée. Toute correction passe par une facture d’avoir puis une nouvelle facture.
- À chaque paiement : génération d’un reçu et réédition de la facture (même numéro, version +1) avec le restant dû mis à jour. Toutes les versions sont conservées.

# 12. Reçus, avis d’échéance et relances

- Reçu : n° REC, date, payeur, police, facture, montant, canal (espèces, chèque, virement, Mobile Money), référence de transaction, total payé, restant dû.
- Avis d’échéance : généré automatiquement J-x (paramétrable, 15 jours par défaut) avant chaque tranche ou avant le terme ; liste quotidienne des avis à produire.
- Relances : niveaux paramétrables (ex. J+7, J+15, J+30 – mise en demeure) avec un modèle Word par niveau ; arrêt automatique dès paiement.
- Génération individuelle ou par lot (liste des polices concernées).

# 13. Génération en masse

- Import d’un fichier Excel/CSV selon un fichier modèle téléchargeable par produit.
- Contrôles ligne par ligne (champs obligatoires, formats, doublons, âges limites, cohérence des formules) → rapport d’erreurs téléchargeable ; les lignes valides peuvent être traitées.
- Traitement asynchrone en tâche de fond, avec barre de progression ; l’utilisateur peut continuer à travailler.
- Résultat : PDF individuels rangés dans le dossier partagé + archive ZIP + récapitulatif.
- Performance attendue : 500 certificats en moins de 15 minutes sur le serveur SIM.

# 14. QR code, stockage et archivage


## 14.1 QR code d’authenticité

- Présent sur tous les documents émis.
- Encode une URL de vérification sur le réseau SIM : …/verif/{identifiant_aleatoire} (identifiant non devinable, pas le n° de police en clair).
- La page de vérification affiche : type et n° du document, date d’émission, souscripteur (masqué partiellement), statut en temps réel (valide, annulé par avoir, expiré), empreinte.

## 14.2 Dossier partagé du réseau SIM

Chaque PDF émis est enregistré automatiquement dans un dossier partagé du réseau SIM, selon une arborescence paramétrable. Proposition par défaut :

\\<SERVEUR>\SIM_DOCUMENTS\{Produit}\{AAAA}\{MM}\{TypeDocument}\

{N°Police ou N°Cotation}_{TypeDocument}_{N°Document}_{AAAAMMJJ}_v{version}.pdf

Exemple :  \\SRV-SIM\SIM_DOCUMENTS\RELAXSANTE\2026\09\FACTURE\

260000329_FACTURE_FAC-2026-09-0004_20260918_v2.pdf

- Écriture par un compte de service ; les utilisateurs ont un accès en lecture seule au dossier.
- En cas d’indisponibilité du partage : mise en file d’attente et nouvelle tentative, alerte à l’administrateur ; le document reste disponible dans l’application.

## 14.3 Archivage

- Conservation 10 ans minimum, en lecture seule.
- Empreinte SHA-256 calculée à l’émission, stockée en base et vérifiable à tout moment (contrôle d’intégrité).
- Sauvegarde quotidienne de la base et des documents ; test de restauration trimestriel.

# 15. Exigences techniques


## 15.1 Environnement


| Élément | Exigence / recommandation |
|---|---|
| Hébergement | Serveur interne SIM, même réseau que le back-office et le dossier partagé |
| Moteur de fusion | Open source : docxtpl (Python, syntaxe Jinja2) – alternative : docxtemplater (Node.js) si le back-office est en JavaScript |
| Conversion PDF | LibreOffice en mode sans interface (headless), polices des modèles installées sur le serveur (Calibri, etc.) pour un rendu fidèle |
| Assemblage PDF | pypdf (ou équivalent) ; QR : bibliothèque qrcode ; montant en lettres : num2words (fr) |
| Base de données | Celle du back-office (PostgreSQL recommandé) |
| Tâches de fond | File de tâches (ex. Celery/RQ + Redis) pour la masse, les relances et l’écriture sur le partage |
| Intégration | API interne REST documentée (OpenAPI) entre back-office et module |
| Interface | Intégrée au back-office (mêmes menus, profils, charte) |


## 15.2 API interne (principaux points d’entrée)


| Méthode | Point d’entrée | Rôle |
|---|---|---|
| POST | /documents/preview | Aperçu PDF à partir d’un jeu de données (sans numéro) |
| POST | /documents | Émission d’un document (type, référence, options) |
| GET | /documents/{id} | Métadonnées, versions, statut |
| GET | /documents/{id}/pdf?version=n | Téléchargement |
| POST | /documents/{id}/avoir | Émission d’un avoir |
| POST | /lots | Génération en masse (fichier + produit) |
| GET | /lots/{id} | Avancement, rapport d’erreurs, ZIP |
| POST/GET | /modeles, /modeles/{id}/versions | Dépôt, contrôle, validation, publication des modèles |
| GET | /verif/{token} | Page publique de vérification du QR code |


## 15.3 Exigences non fonctionnelles

- Temps de génération d’un document unitaire (CP + CG) : < 10 secondes.
- Fidélité : le PDF doit reproduire la mise en page du modèle Word (colonnes, tableaux, en-têtes, pieds de page, images).
- Sécurité : authentification du back-office, droits par profil, HTTPS sur le réseau interne, journalisation des accès.
- Robustesse : une erreur sur un document d’un lot n’interrompt pas le lot.
- Paramétrage sans redéploiement : produits, taxes, arrondis, formats de numéros, arborescence, seuils.

## 15.4 Journal d’audit

Toute action est journalisée de façon non modifiable (horodatage, utilisateur, action, avant/après) : dépôt et publication de modèle, modification de paramètre, forçage de prime, validation, émission, réédition, avoir, téléchargement, échec d’écriture sur le partage. Consultable par l’Admin, la Technique et la DG ; exportable en Excel.


# 16. Plan de tests et recette


## 16.1 Cas de tests de référence


| N° | Cas | Données | Résultat attendu |
|---|---|---|---|
| T1 | Cotation santé BENI (2 formules) | Solo : 3 × 93 581,33 ; acc. 3 000 ; Famille : 60 × 252 657,63 ; acc. 210 000 ; taxe 1,5 % sur nette + acc. | Solo : HT 280 744 ; taxe 4 256 ; TTC 288 000. Famille : HT 15 159 458 ; taxe 230 542 ; TTC 15 600 000. Total 15 888 000. TTC/personne 96 000 ; /famille 260 000. Validité = date + 3 mois |
| T2 | Facture groupe CGE-SN | RELAXSANTE 80 % ; Solo 8 ; Famille 31 ; taxe 1,5 % ; 4 échéances | HT 11 420 690 ; taxe 171 310 ; TTC 11 592 000 ; 4 × 2 898 000 ; n° police présent ; montant en lettres |
| T3 | Facture individuelle YAO (prorata) | Effet 22/07/2026 – échéance 31/12/2026 ; HT 120 633 ; paiement 41 000 | 163 jours ; taxe 1,5 % = 1 809,50 avant arrondi (et non 2 292) ; restant dû recalculé ; reçu REC généré |
| T4 | Correction de facture | Facture T3 émise avec erreur | Modification impossible ; avoir AV lié + nouvelle facture ; numérotation sans trou |
| T5 | SECURVIE avec 3 bénéficiaires | Bénéficiaires, garanties par formule | Tableau répété ; garanties issues du sous-modèle ; visa 01497 cohérent avec les CG jointes |
| T6 | CP VOL – cases à cocher | Capital vol caisse 100 000 ; gardiennage nuit ; locataire | Bonnes cases cochées ; date d’émission dynamique (plus de « 10/03/2026 » en dur) |
| T7 | Liste > 10 assurés | Contrat famille/groupe 25 assurés | Renvoi en annexe dans le corps ; annexe complète en fin de PDF |
| T8 | Génération en masse | Fichier 500 adhérents dont 12 lignes erronées | 488 certificats + rapport des 12 erreurs ; < 15 min ; ZIP + dossier partagé |
| T9 | Modèle avec balise inconnue | Dépôt d’un .docx contenant {{ client.nom }} | Rejet avec message et emplacement |
| T10 | Régénération historique | Document émis avec modèle v1, modèle passé en v2 | La réédition utilise v1 et les paramètres de l’époque |
| T11 | Cotation expirée | Validité dépassée | Statut « Expirée » ; filigrane sur la réédition ; transformation impossible |
| T12 | QR code | Scan d’une facture annulée par avoir | Page de vérification : « Annulée – avoir AV-… » |
| T13 | Double validation | Prime forcée par un commercial | Statut « À valider » ; l’auteur ne peut pas valider |
| T14 | Dossier partagé indisponible | Partage coupé à l’émission | Document émis, écriture différée, alerte admin, reprise automatique |


## 16.2 Critères de recette

- 100 % des cas T1 à T14 conformes.
- Les 16 modèles CP + facture + cotation santé migrés, balisés et publiés sans erreur de contrôle.
- Écart nul entre montants affichés et montants en base.
- Recette utilisateur par la Direction Technique et la Comptabilité sur 2 semaines de production parallèle (ancien et nouveau processus).

# 17. Livrables et lotissement


| Lot | Contenu | Livrables attendus des développeurs |
|---|---|---|
| Lot 1 – Socle | Bibliothèque de modèles (dépôt, contrôles, versions, publication), dictionnaire, moteur de fusion, conversion PDF, assemblage, QR, archivage, dossier partagé, audit | Code source, documentation technique, guide « rédiger un modèle Word » |
| Lot 2 – Calcul & Cotation | Paramétrage produit, moteur de calcul, cotation (comparatif, forçage, statuts, transformation) | Jeux de tests T1, T11, T13 |
| Lot 3 – Contrat & Facture | CP, certificats, factures, avoirs, reçus, numérotation | Jeux de tests T2 à T7, T10, T12 |
| Lot 4 – Masse & Relances | Import en masse, avis d’échéance, relances, tableaux de bord | Jeux de tests T8, T14 ; manuel utilisateur |

Pour chaque lot : démonstration, recette sur l’environnement de test, correction des anomalies, mise en production. Les développeurs remettent le code source, les scripts d’installation sur le serveur SIM et la documentation.


# Annexe A – Anomalies des modèles actuels à corriger

À corriger par la Direction Technique lors de la migration des modèles vers le balisage (§6).


| N° | Document | Anomalie | Correction |
|---|---|---|---|
| A1 | Tous les CP | Zones à remplir hétérogènes : « \|____\| », « XXX », « 00/00/00 et heure », « Variable système », cellules vides | Remplacer par les balises du dictionnaire |
| A2 | Tous les CP | E-mail de réclamation « [à préciser] » | {{ societe.email_reclamation }} |
| A3 | Tous les CP | URL « medaitionassuranceci.net » (coquille probable) | Vérifier l’URL officielle de la Médiation ; la mettre dans societe.recours |
| A4 | Plusieurs CP | Autorité du visa écrite « MFB/DGTCP/DA » ou « MEMEF/DGTCP/DA » selon les endroits | Visa unique issu du paramétrage produit |
| A5 | RELAXVOYAGE, RELAXVOYAGE+ | Bas de page : « CG INDIVIDUELLE ACCIDENTS N° 01504 » alors que 01504 = RELAXVOYAGE | {{ produit.cg_libelle }} / {{ produit.cg_visa }} |
| A6 | RELAXVOYAGE+ | « Nom de la compagnie » laissé dans la clause réclamation et dans le tableau assuré | SIM ASSURANCES CI / « Compagnie de voyage » |
| A7 | SECURMOTO | En-tête : CG RELAX ACCIDENTS 01507 ; bas : « CG DOMMAGES 01507 » (DOMMAGES = 01498) | Déterminer les CG applicables et unifier |
| A8 | RELAXACCIDENT | « Contrat RELAX ACCIDENTS du N° 01507 » : autorité manquante | Visa complet paramétré |
| A9 | SECURMOTO, SECURECOLTE | Aucun bloc de prime | Ajouter Prime nette / Acc. / Taxe / TTC |
| A10 | SECURVIE | Bloc de prime sans accessoires ni TTC ; garanties « variable système » | Bloc complet ; sous-modèle garanties |
| A11 | CP VOL | Date « Abidjan, le 10/03/2026 » saisie en dur | {{ doc.lieu_emission }}, le {{ doc.date_emission \| date }} |
| A12 | RELAXSANTE PLUS | Taux de couverture « 70 % » figé ; « RELASANTE » | {{ formule.taux_couverture \| pct }} ; orthographe |
| A13 | SECURECOLTE | Guillemets « [SIM ASSURANCES CI] » et puce vide | Nettoyage |
| A14 | Facture 003-0926 | N° de police absent ; colonne accessoires absente | Modèle unique §11 |
| A15 | Facture 004-0926 | Taxe 2 292 (1,90 %) au lieu de 1,5 % ; adresse client absente ; « Envoyé à » = « Facturé à » ; facture datée après l’effet et le 1er paiement | Moteur de calcul ; bloc client ; émission à la souscription |
| A16 | Factures | Sans RCCM, NCC, RIB, Mobile Money, montant en lettres ; numérotation remise à zéro mensuelle | §11.2 et §11.4 |
| A17 | Offre BENI | Listes de pièces décès / IPT inversées (acte de décès sous IPT) | Inverser les deux listes |
| A18 | Offre BENI | « Indemnité permanente totale » au lieu d’« Invalidité » | Corriger |
| A19 | Offre BENI | Réseau « Hôpitaux publics » mais forfait chambre « Hôpitaux privés » prévu | Harmoniser réseau et barème |
| A20 | Offre BENI | Disponible en PDF uniquement | Recréer en modèle Word balisé (modèle de cotation santé) |


# Annexe B – Inventaire des modèles à migrer


| Modèle source | Type | CG / CS | Particularités de balisage |
|---|---|---|---|
| CONTRAT SECURVIE | CP | 01497 | Bénéficiaires (liste), garanties par formule |
| CP BRIS DE GLACE FINALISE | CP | 01498 | Capitaux / cases à cocher |
| CP DEGATS DES EAUX FINALISE | CP | 01498 | Capitaux / cases à cocher |
| CP DOMMAGES ELECTRIQUES FINALISE | CP | 01498 | Capitaux / cases à cocher |
| CP VOL FINALISE | CP | 01498 | Moyens de protection jour/nuit, capitaux cochés, date dynamique |
| NEW_CP_SECURECOLTE | CP | 01496 | Semence, pack, sous-préfecture ; bloc prime à créer |
| NEW_CP_SECUREHOME / HOME_PLUS | CP | 01498 | Nb pièces, statut propriétaire/locataire, identifiant CIE/SODECI |
| NEW_CP_SECUREPRO | CP | 01498 | Caractéristiques du local |
| NEW_CP_SECURESTOCK | CP | 01498 | 2 intermédiaires, stock total/nanti, classes de risque, clause nantissement conditionnelle |
| NEW_CP_SECURMOTO_V2 | CP | À trancher (A7) | Engin, âge, barème de couverture par âge ; bloc prime à créer |
| NEW_RELAXACCIDENT MOTO-LIVREUR-VTC-ARTISAN | CP | 01507 | Assurés, bénéficiaires, tiers payant NOVELIA |
| NEW_RELAXSANTE_PLUS_INDIVIDUELLE | CP | CG 01505 + CS | Options de couverture, taux variable |
| RELAXSANTE Conventions Spéciales | CS | 01505 | Fixe |
| RELAXVOYAGE / RELAXVOYAGE+ | CP | 01504 | Dates avec heure, trajet, ticket, contact d’urgence |
| CG SECURVIE, SECUR RECOLTE, SECUR DOMMAGE, RELAXVOYAGE, RELAX ACCIDENTS | CG | – | Fixes, converties en PDF versionnés |
| Factures 003-0926 / 004-0926 | Facture | – | Fusionnées en un modèle unique |
| Offre santé BENI | Cotation | – | Modèle de référence des cotations santé |
| Gabarits HTML (RELAXMOTO…) | CP | 01507 | À convertir en Word |


# Annexe C – Décisions de cadrage


| N° | Sujet | Décision |
|---|---|---|
| 1 | Positionnement | Module du back-office central ; saisie libre pour les prospects |
| 2 | Gabarits HTML | Migration vers Word |
| 3 | Produits V1 | SECUR, RELAX, IMF, autres (moto-livraison, agricole, produit intégré) |
| 4 | Documents V1 | Cotation, contrat, facture + reçu, avis d’échéance, relances |
| 5 | Balisage | {{ objet.champ }} (Jinja2 / docxtpl) |
| 6 | Gouvernance modèles | Modification par la Technique, validation avant publication |
| 7 | Versions | Historique complet ; régénération avec la version en vigueur à l’émission |
| 8 | Listes longues | Annexe au-delà de 10 lignes |
| 9 | Blocs variables | Automatiques (paramétrage) ou manuels selon les cas |
| 10 | PDF contrat | Fichier unique CP + CS + CG |
| 11 | Signature | Scan SIM automatique sur cotation, facture et contrat ; client manuscrit |
| 12 | QR code | Sur tous les documents |
| 13 | Modèle de cotation | Un par produit |
| 14 | Comparatif | Jusqu’à 3 formules |
| 15 | Primes | Moteur de calcul + forçage motivé et validé |
| 16 | Cycle cotation | Validité paramétrable, statuts, transformation à l’acceptation |
| 17 | Facture | Modèle unique, blocs échéancier / paiements |
| 18 | Numérotation | FAC-AAAA-MM-NNNN, compteur annuel continu |
| 19 | Mentions facture | RCCM, NCC, RIB, Mobile Money, montant en lettres, conditions de paiement |
| 20 | Correction | Avoir + nouvelle facture |
| 21 | Types de factures | Renouvellement, avenants, groupe |
| 22 | Paiements | Reçu + réédition de la facture (version +1) |
| 23 | Assiette taxe | Prime nette + accessoires |
| 24 | Facture YAO | Taxe erronée (erreur de saisie) |
| 25 | Arrondis | Paramétrables par produit |
| 26 | Prorata | Au jour près / 365 |
| 27 | Accessoires | Paramétrables par produit |
| 28 | Fractionnement | Paramétrable par produit |
| 29 | N° de police | Attribué par le back-office, format par produit |
| 30 | Groupe | Police mère + certificats d’adhésion |
| 31 | Validation | Double validation au-delà d’un seuil ou en cas de forçage |
| 32 | Masse | Oui, en tâche de fond |
| 33 | Diffusion | Téléchargement + enregistrement automatique dans un dossier partagé du réseau SIM |
| 34 | Archivage | 10 ans, lecture seule, empreinte d’intégrité |
| 35 | Hébergement | Serveur interne SIM |
| 36 | Moteur | Open source (docxtpl / docxtemplater + LibreOffice) |
| 37 | Anomalies | Listées en annexe A ; corrigées par la Technique |
| 38 | Recette | Plan de tests avec cas réels |
| 39 | Livrable | Word, fonctionnel + technique |
| 40 | E-mail de réclamation | Paramètre Société, à renseigner |
