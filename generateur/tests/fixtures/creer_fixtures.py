"""Crée les modèles Word de TEST de ce dossier (données inventées, aucun modèle réel).

Ils servent au test de bout en bout de l'application (app/src/serveur/modeles.e2e.test.ts) et
à l'essai à la main de la bibliothèque de modèles (docs/compte-rendu-phase-3a.md). Les recréer,
depuis generateur/, environnement activé :

    python -m tests.fixtures.creer_fixtures
"""

from pathlib import Path

from tests.fabrique import avec_champ_word, document

ICI = Path(__file__).resolve().parent

# Contenu obligatoire des CP (CDC §10.1) hors identification, assurés et garanties : bloc des primes COMPLET,
# clause citant les CG et leur visa, clause de réclamation, lieu et date d'émission (date dynamique), signatures.
CLAUSES_FINALES_CP: list[str] = [
    "Primes : nette {{ prime.nette | montant }} ; accessoires {{ prime.accessoires | montant }} ; taxe ({{ prime.taux_taxe | pct }}) {{ prime.taxe | montant }} ; TOTAL TTC {{ prime.ttc | montant }} F CFA, soit {{ prime.ttc | lettres }}.",
    "Composition du contrat : les présentes conditions particulières et les conditions générales {{ produit.cg_libelle }}, visa {{ produit.cg_visa }}, forment le contrat.",
    "Réclamation : toute réclamation s'adresse à {{ societe.email_reclamation }}, puis, à défaut de réponse, aux voies de recours prévues par la loi.",
    "Fait à {{ doc.lieu_emission }}, le {{ doc.date_emission | date }}. {{ societe.raison_sociale }}, RCCM {{ societe.rccm }}.",
    "Pour SIM Assurances : {{ signature_sim }}   Le souscripteur (signature manuscrite précédée de « lu et approuvé ») :",
    "Vérification : {{ doc.url_verification }}   {{ qr_code }}",
]

IDENTIFICATION_CP: list[str] = [
    "CONDITIONS PARTICULIÈRES – {{ produit.libelle }} – police n° {{ police.numero }}",
    "Souscripteur : {% if souscripteur.type == 'MORALE' %}{{ souscripteur.raison_sociale }}{% else %}{{ souscripteur.nom }} {{ souscripteur.prenoms }}{% endif %}",
    "Effet : {{ police.date_effet | date }} ; échéance : {{ police.date_echeance | date }} ; durée : {{ police.duree_libelle }}",
    "{%p for i in intermediaires %}",
    "Intermédiaire : {{ i.nom }} ({{ i.code }})",
    "{%p endfor %}",
]

FIXTURES: dict[str, bytes] = {
    # CP correct : valeurs, chaque filtre, condition, boucle de tableau sur les assurés, sous-modèle, et le contenu
    # obligatoire du §10.1 (durée, bloc des primes complet, clause CG, réclamation, lieu, date, signature).
    "cp_test.docx": document(
        *IDENTIFICATION_CP,
        "Né(e) le {{ souscripteur.date_naissance | date }}",
        [
            ["N°", "Nom et prénoms", "Naissance", "Sexe"],
            ["{%tr for a in assures %}", "", "", ""],
            ["{{ a.ordre }}", "{{ a.nom_prenoms }}", "{{ a.date_naissance | date }}", "{{ a.sexe }}"],
            ["{%tr endfor %}", "", "", ""],
        ],
        "Nombre d'assurés : {{ assures | length }}",
        "{%p for f in formules %}",
        "Formule {{ f.libelle }} ({{ f.taux_couverture | pct }}) : {{ f.ttc | montant }} F CFA",
        '{{ bloc("garanties", f.code) }}',
        "{%p endfor %}",
        "{% if police.nantissement %}Clause de nantissement au profit de {{ police.nantissement.beneficiaire }}.{% endif %}",
        '{{ (risque.statut == "PROPRIETAIRE") | case }} Propriétaire   {{ (risque.statut == "LOCATAIRE") | case }} Locataire',
        *CLAUSES_FINALES_CP,
        police="Calibri",
    ),
    # T9 : balise hors dictionnaire, dans une cellule de tableau (le reste est correct, socle obligatoire compris).
    "t9_balise_inconnue.docx": document(
        *IDENTIFICATION_CP,
        [["Nom du client", "Téléphone"], ["{{ client.nom }}", "{{ souscripteur.telephone }}"]],
        *CLAUSES_FINALES_CP,
    ),
    # Piège réel du 02/10 : une « balise » saisie comme champ Word (Ctrl+F9).
    "champ_word.docx": avec_champ_word("Souscripteur : ", " souscripteur.nom "),
    # Annexe des listes longues (T7).
    "annexe_assures.docx": document(
        "ANNEXE – Liste des assurés de la police n° {{ police.numero }}",
        [
            ["N°", "Nom et prénoms", "Naissance"],
            ["{%tr for a in assures %}", "", ""],
            ["{{ a.ordre }}", "{{ a.nom_prenoms }}", "{{ a.date_naissance | date }}"],
            ["{%tr endfor %}", "", ""],
        ],
        police="Calibri",
    ),
    # Sous-modèle bloc("garanties", "SOLO") : tableau fixe.
    "garanties_solo.docx": document(
        "Garanties de la formule Solo (tableau inventé)",
        [["Garantie", "Taux", "Plafond"], ["Hospitalisation", "80 %", "1 500 000"], ["Pharmacie", "80 %", "300 000"]],
        police="Calibri",
    ),
    # Cotation (offre de type BENI) : socle obligatoire, tableau des formules, totaux, QR code (T1).
    "cotation_test.docx": document(
        "COTATION n° {{ doc.numero }} ({{ doc.version }}) – {{ produit.libelle }}",
        "Souscripteur : {% if souscripteur.type == 'MORALE' %}{{ souscripteur.raison_sociale }}{% else %}{{ souscripteur.nom }} {{ souscripteur.prenoms }}{% endif %}",
        "Période : du {{ police.date_effet | date }} au {{ police.date_echeance | date }} ({{ police.duree_jours }} jours)",
        [
            ["Formule", "Effectif", "Prime unitaire HT", "Prime HT", "Accessoires", "Taxe", "TTC"],
            ["{%tr for f in formules %}", "", "", "", "", "", ""],
            ["{{ f.libelle }}", "{{ f.effectif }}", "{{ f.prime_unitaire | montant }}", "{{ f.prime_nette | montant }}", "{{ f.accessoires | montant }}", "{{ f.taxe | montant }}", "{{ f.ttc | montant }}"],
            ["{%tr endfor %}", "", "", "", "", "", ""],
        ],
        "Total HT : {{ prime.nette | montant }} ; accessoires : {{ prime.accessoires | montant }} ; taxe ({{ prime.taux_taxe | pct }}) : {{ prime.taxe | montant }}",
        "Total TTC : {{ prime.ttc | montant }} F CFA, soit {{ prime.ttc | lettres }}.",
        "Établie à {{ doc.lieu_emission }} le {{ doc.date_emission | date }}, valable jusqu'au {{ doc.date_validite | date }}.",
        "{{ societe.raison_sociale }}",
        "{{ qr_code }}",
        "Vérification : {{ doc.url_verification }}",
        police="Calibri",
    ),
    # T5 : CP SECURVIE (branche décès) : tableau répété des bénéficiaires (quotes-parts), contacts d'urgence,
    # garanties issues du sous-modèle de la formule, clause citant les CG et leur visa.
    "cp_securvie_test.docx": document(
        *IDENTIFICATION_CP,
        "Bénéficiaires du capital décès :",
        [
            ["N°", "Nom et prénoms", "Lien", "Contact", "Quote-part"],
            ["{%tr for b in beneficiaires %}", "", "", "", ""],
            ["{{ b.ordre }}", "{{ b.nom_prenoms }}", "{{ b.lien }}", "{{ b.contact }}", "{{ b.quote_part | pct }}"],
            ["{%tr endfor %}", "", "", "", ""],
        ],
        "{%p for u in contacts_urgence %}",
        "Personne à prévenir : {{ u.nom_prenoms }} ({{ u.contact }})",
        "{%p endfor %}",
        "{%p for f in formules %}",
        "Formule {{ f.libelle }}",
        '{{ bloc("garanties", f.code) }}',
        "{%p endfor %}",
        *CLAUSES_FINALES_CP,
        police="Calibri",
    ),
    # Sous-modèle bloc("garanties", "STANDARD") du produit SECURVIE : tableau fixe inventé.
    "garanties_securvie_standard.docx": document(
        "Garanties de la formule Standard (tableau inventé)",
        [["Garantie", "Capital"], ["Décès toutes causes", "5 000 000"], ["Invalidité permanente totale", "5 000 000"], ["Frais funéraires", "500 000"]],
        police="Calibri",
    ),
    # T6 : CP VOL (branche IARD) : cases à cocher selon le risque saisi, date d'émission dynamique.
    "cp_vol_test.docx": document(
        *IDENTIFICATION_CP,
        'Vol caisse, capital garanti : {{ (risque.capital_vol_caisse == "100000") | case }} 100 000 F   {{ (risque.capital_vol_caisse == "250000") | case }} 250 000 F   {{ (risque.capital_vol_caisse == "500000") | case }} 500 000 F',
        'Gardiennage : {{ (risque.gardiennage == "JOUR") | case }} Jour   {{ (risque.gardiennage == "NUIT") | case }} Nuit   {{ (risque.gardiennage == "JOUR_NUIT") | case }} Jour et nuit',
        'Statut de l\'assuré : {{ (risque.statut == "PROPRIETAIRE") | case }} Propriétaire   {{ (risque.statut == "LOCATAIRE") | case }} Locataire',
        *CLAUSES_FINALES_CP,
        police="Calibri",
    ),
    # Police mère d'un contrat de groupe : la liste des adhérents est TOUJOURS en annexe (§10.2).
    "cp_groupe_test.docx": document(
        *IDENTIFICATION_CP,
        "Adhérents de la police mère :",
        [
            ["N°", "Nom et prénoms", "Formule"],
            ["{%tr for a in assures %}", "", ""],
            ["{{ a.ordre }}", "{{ a.nom_prenoms }}", "{{ a.formule }}"],
            ["{%tr endfor %}", "", ""],
        ],
        *CLAUSES_FINALES_CP,
        police="Calibri",
    ),
    # Certificat d'adhésion unitaire : son numéro, la police mère, l'adhérent, la date d'adhésion, son propre QR code. Pas de prime.
    "certificat_test.docx": document(
        "CERTIFICAT D'ADHÉSION n° {{ police.numero }}",
        "Police mère n° {{ police.police_mere }} – souscripteur : {{ souscripteur.raison_sociale }}",
        "{%p for a in assures %}",
        "Adhérent n° {{ a.ordre }} : {{ a.nom_prenoms }}, né(e) le {{ a.date_naissance | date }}, formule {{ a.formule }}",
        "{%p endfor %}",
        "Date d'adhésion : {{ police.date_effet | date }} ; fin de la période de la police : {{ police.date_echeance | date }}",
        "Délivré à {{ doc.lieu_emission }}, le {{ doc.date_emission | date }}. {{ societe.raison_sociale }}",
        "Vérification : {{ doc.url_verification }}   {{ qr_code }}",
        police="Calibri",
    ),
    # Session 4b : facture (CDC §11.2) : police, « Facturé à » avec adresse, « Envoyé à » masqué s'il est vide, taux de
    # taxe, TTC en chiffres et en lettres, échéances Payé / Non payé si fractionnée, paiements et restant dû s'il y en a,
    # RIB, Mobile Money, rappel de l'article 13 du Code CIMA, signature, QR code.
    "facture_test.docx": document(
        "FACTURE n° {{ doc.numero }} ({{ doc.version }}) – {{ produit.libelle }}",
        "Police n° {{ police.numero }}, souscrite le {{ police.date_souscription | date }} ; période du {{ police.date_effet | date }} au {{ police.date_echeance | date }}",
        "Facturé à : {% if souscripteur.type == 'MORALE' %}{{ souscripteur.raison_sociale }}{% else %}{{ souscripteur.nom }} {{ souscripteur.prenoms }}{% endif %}, {{ souscripteur.adresse }}",
        "{%p if envoye_a %}",
        "Envoyé à : {{ envoye_a.nom }}, {{ envoye_a.adresse }}",
        "{%p endif %}",
        [
            ["Formule", "Effectif", "Prime HT", "Taxe", "TTC"],
            ["{%tr for f in formules %}", "", "", "", ""],
            ["{{ f.libelle }}", "{{ f.effectif }}", "{{ f.prime_nette | montant }}", "{{ f.taxe | montant }}", "{{ f.ttc | montant }}"],
            ["{%tr endfor %}", "", "", "", ""],
        ],
        "Détail par assuré (facture de groupe : renvoyé en annexe) :",
        [
            ["N°", "Nom et prénoms", "Formule", "Prime TTC"],
            ["{%tr for a in assures %}", "", "", ""],
            ["{{ a.ordre }}", "{{ a.nom_prenoms }}", "{{ a.formule }}", "{{ a.prime | montant }}"],
            ["{%tr endfor %}", "", "", ""],
        ],
        "Total HT : {{ prime.nette | montant }} ; accessoires : {{ prime.accessoires | montant }} ; taxe ({{ prime.taux_taxe | pct }}) : {{ prime.taxe | montant }}",
        "Total TTC : {{ prime.ttc | montant }} F CFA, soit {{ prime.ttc | lettres }}.",
        "{%p for e in echeances %}",
        "Échéance {{ e.numero }} du {{ e.date | date }} : {{ e.montant | montant }} F CFA – {{ e.statut }}",
        "Détail de l'échéance {{ e.numero }} : payé {{ e.paye | montant }} F CFA, restant {{ e.restant | montant }} F CFA",
        "{%p endfor %}",
        "{%p if paiements %}",
        "{%p for p in paiements %}",
        "Paiement {{ p.numero }} du {{ p.date | date }} : {{ p.montant | montant }} F CFA ({{ p.canal }})",
        "{%p endfor %}",
        "Restant dû : {{ solde.restant_du | montant }} F CFA",
        "{%p endif %}",
        "{%p for r in societe.rib %}",
        "Virement : {{ r.banque }}, compte {{ r.numero }}",
        "{%p endfor %}",
        "{%p for m in societe.mobile_money %}",
        "Mobile Money : {{ m.operateur }}, numéro marchand {{ m.numero_marchand }}",
        "{%p endfor %}",
        "Article 13 du Code CIMA : la prise d'effet du contrat est subordonnée au paiement de la prime.",
        "{{ societe.raison_sociale }} – RCCM {{ societe.rccm }} – NCC {{ societe.ncc }}",
        "Fait à {{ doc.lieu_emission }}, le {{ doc.date_emission | date }}. Pour SIM Assurances : {{ signature_sim }}",
        "Vérification : {{ doc.url_verification }}   {{ qr_code }}",
        police="Calibri",
    ),
    # Avoir (CDC §11.3) : la facture annulée, montants négatifs.
    "avoir_test.docx": document(
        "AVOIR n° {{ doc.numero }} – annule la facture {{ doc.facture_origine }}",
        "Police n° {{ police.numero }} – {% if souscripteur.type == 'MORALE' %}{{ souscripteur.raison_sociale }}{% else %}{{ souscripteur.nom }} {{ souscripteur.prenoms }}{% endif %}",
        "Montant de l'avoir : HT {{ prime.nette | montant }} ; taxe {{ prime.taxe | montant }} ; TTC {{ prime.ttc | montant }} F CFA",
        "Émis à {{ doc.lieu_emission }}, le {{ doc.date_emission | date }}.",
        "Vérification : {{ doc.url_verification }}   {{ qr_code }}",
        police="Calibri",
    ),
    # Reçu (CDC §12) : CE paiement, la facture réglée, le restant dû après lui.
    "recu_test.docx": document(
        "REÇU n° {{ doc.numero }} – facture {{ doc.facture_origine }}",
        "Police n° {{ police.numero }} du {{ police.date_effet | date }} au {{ police.date_echeance | date }} – {% if souscripteur.type == 'MORALE' %}{{ souscripteur.raison_sociale }}{% else %}{{ souscripteur.nom }} {{ souscripteur.prenoms }}{% endif %} – facture de {{ prime.ttc | montant }} F CFA",
        "{%p for p in paiements %}",
        "Reçu de {{ p.payeur }}, le {{ p.date | date }} : {{ p.montant | montant }} F CFA, soit {{ p.montant | lettres }} ({{ p.canal }} {{ p.reference }})",
        "{%p endfor %}",
        "Total payé : {{ solde.total_paye | montant }} F CFA ; restant dû : {{ solde.restant_du | montant }} F CFA",
        "Fait à {{ doc.lieu_emission }}, le {{ doc.date_emission | date }}. {{ signature_sim }}",
        "Vérification : {{ doc.url_verification }}   {{ qr_code }}",
        police="Calibri",
    ),
    # Conditions générales : texte fixe et le seul visa.
    "cg_test.docx": document(
        "CONDITIONS GÉNÉRALES {{ produit.cg_libelle }} (texte inventé pour les tests)",
        "Visa : {{ produit.cg_visa }} du {{ produit.cg_date | date }}",
        "Article 1 – Objet du contrat. Texte de démonstration, sans valeur contractuelle.",
        police="Calibri",
    ),
}


def main() -> None:
    for nom, contenu in FIXTURES.items():
        (ICI / nom).write_bytes(contenu)
        print(f"{nom} : {len(contenu)} octets")


if __name__ == "__main__":
    main()
