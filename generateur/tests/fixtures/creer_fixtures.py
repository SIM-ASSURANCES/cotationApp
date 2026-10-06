"""Crée les modèles Word de TEST de ce dossier (données inventées, aucun modèle réel).

Ils servent au test de bout en bout de l'application (app/src/serveur/modeles.e2e.test.ts) et
à l'essai à la main de la bibliothèque de modèles (docs/compte-rendu-phase-3a.md). Les recréer,
depuis generateur/, environnement activé :

    python -m tests.fixtures.creer_fixtures
"""

from pathlib import Path

from tests.fabrique import avec_champ_word, document

ICI = Path(__file__).resolve().parent

FIXTURES: dict[str, bytes] = {
    # CP correct : valeurs, chaque filtre, condition, boucle de tableau sur les assurés, sous-modèle.
    "cp_test.docx": document(
        "CONDITIONS PARTICULIÈRES – {{ produit.libelle }} – police n° {{ police.numero }}",
        "Souscripteur : {{ souscripteur.nom }} {{ souscripteur.prenoms }}, né(e) le {{ souscripteur.date_naissance | date }}",
        "Effet : {{ police.date_effet | dateheure }} ; échéance : {{ police.date_echeance | date }}",
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
        "Prime TTC : {{ prime.ttc | montant }} F CFA, soit {{ prime.ttc | lettres }}.",
        "{% if police.nantissement %}Clause de nantissement au profit de {{ police.nantissement.beneficiaire }}.{% endif %}",
        '{{ (risque.statut == "PROPRIETAIRE") | case }} Propriétaire   {{ (risque.statut == "LOCATAIRE") | case }} Locataire',
        "Conditions générales {{ produit.cg_libelle }}, visa {{ produit.cg_visa }}.",
        "Fait à {{ doc.lieu_emission }}, le {{ doc.date_emission | date }}. {{ societe.raison_sociale }}, RCCM {{ societe.rccm }}.",
        police="Calibri",
    ),
    # T9 : balise hors dictionnaire, dans une cellule de tableau (le reste est correct, socle obligatoire compris).
    "t9_balise_inconnue.docx": document(
        "CONDITIONS PARTICULIÈRES – police n° {{ police.numero }}",
        [["Nom du client", "Téléphone"], ["{{ client.nom }}", "{{ souscripteur.telephone }}"]],
        "Souscripteur : {{ souscripteur.nom }} ; du {{ police.date_effet | date }} au {{ police.date_echeance | date }} ; prime TTC {{ prime.ttc | montant }}",
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
