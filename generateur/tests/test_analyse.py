"""Analyse d'un modèle au dépôt (CDC §6.7) : faits relevés, avec leur emplacement."""

from app.analyse import Analyse, analyser
from tests.fabrique import avec_champ_word, avec_texte_supprime, document


def chemins(analyse: Analyse) -> set[str]:
    return {r.chemin for r in analyse.references}


def codes(analyse: Analyse) -> list[str]:
    return [p.code for p in analyse.problemes]


def test_fichier_qui_n_est_pas_un_docx() -> None:
    analyse = analyser(b"ceci n'est pas un document Word")
    assert analyse.docx_valide is False
    assert analyse.erreur and ".docx" in analyse.erreur


def test_releve_les_donnees_lues_et_leur_emplacement() -> None:
    analyse = analyser(document("Souscripteur : {{ souscripteur.nom }} {{ souscripteur.prenoms }}", "Prime : {{ prime.ttc | montant }}"))
    assert analyse.docx_valide
    assert analyse.problemes == []
    assert chemins(analyse) == {"souscripteur.nom", "souscripteur.prenoms", "prime.ttc"}
    prime = next(r for r in analyse.references if r.chemin == "prime.ttc")
    assert prime.emplacement.partie == "corps"
    assert prime.emplacement.paragraphe == 2
    assert prime.emplacement.tableau is None
    assert prime.balise == "{{ prime.ttc | montant }}"
    assert analyse.filtres == ["montant"]
    assert analyse.nombre_balises == 3


def test_t9_balise_inconnue_dans_une_cellule_de_tableau() -> None:
    """T9 : {{ client.nom }} est relevé avec son emplacement exact (l'application le rejette :
    « client » n'est pas dans le dictionnaire)."""
    analyse = analyser(document("Conditions particulières", [["Nom du client", "Contrat"], ["{{ client.nom }}", "{{ police.numero }}"]]))
    client = next(r for r in analyse.references if r.chemin == "client.nom")
    assert client.emplacement.tableau == 1
    assert client.emplacement.ligne == 2
    assert client.emplacement.colonne == 1
    assert client.emplacement.extrait == "{{ client.nom }}"
    assert client.balise == "{{ client.nom }}"


def test_variables_de_boucle_rattachees_a_la_liste() -> None:
    analyse = analyser(
        document(
            [
                ["N°", "Nom et prénoms", "Naissance"],
                ["{%tr for a in assures %}", "", ""],
                ["{{ loop.index }}", "{{ a.nom_prenoms }}", "{{ a.date_naissance | date }}"],
                ["{%tr endfor %}", "", ""],
            ]
        )
    )
    assert analyse.problemes == []
    assert chemins(analyse) == {"assures", "assures[].nom_prenoms", "assures[].date_naissance"}


def test_balise_coupee_en_plusieurs_morceaux_recollee_par_docxtpl() -> None:
    # Word découpe souvent une balise en plusieurs « runs » : docxtpl les recolle, pas d'erreur.
    analyse = analyser(document(["Nom : {", "{ souscripteur", ".nom }", "}"]))
    assert analyse.problemes == []
    assert chemins(analyse) == {"souscripteur.nom"}


def test_balise_coupee_que_docxtpl_ne_recolle_pas() -> None:
    # Un morceau supprimé en suivi des modifications au milieu de « {{ » : invisible pour l'auteur.
    analyse = analyser(avec_texte_supprime("Nom : {", "x", "{ souscripteur.nom }}"))
    assert "BALISE_COUPEE" in codes(analyse)
    probleme = next(p for p in analyse.problemes if p.code == "BALISE_COUPEE")
    assert probleme.emplacement and probleme.emplacement.paragraphe == 1


def test_balise_non_fermee_dans_le_paragraphe() -> None:
    analyse = analyser(document("Nom : {{ souscripteur.nom", "suite }}"))
    assert codes(analyse).count("BALISE_NON_FERMEE") == 2


def test_bloc_if_non_ferme_situe_a_son_ouverture() -> None:
    analyse = analyser(document("Début", "{% if police.nantissement %}", "Clause de nantissement", "Fin"))
    probleme = next(p for p in analyse.problemes if p.code == "BLOC_NON_FERME")
    assert probleme.emplacement and probleme.emplacement.paragraphe == 2
    assert "endif" in probleme.message


def test_blocs_croises() -> None:
    analyse = analyser(document("{% if police.nantissement %}", "{% for a in assures %}", "{% endif %}", "{% endfor %}"))
    assert "BLOC_MAL_FORME" in codes(analyse)


def test_filtre_inconnu_et_filtre_default_refuse() -> None:
    analyse = analyser(document("{{ prime.ttc | monnaie }}", "{{ souscripteur.email | default('') }}"))
    assert codes(analyse) == ["FILTRE_INCONNU", "FILTRE_INCONNU"]


def test_case_sans_parentheses() -> None:
    # Jinja lit {{ a == "X" | case }} comme {{ a == ("X" | case) }} : piège de la syntaxe du CDC.
    analyse = analyser(document('{{ risque.statut == "PROPRIETAIRE" | case }} Propriétaire', '{{ (risque.statut == "LOCATAIRE") | case }} Locataire'))
    assert codes(analyse) == ["CASE_SANS_PARENTHESES"]
    assert analyse.problemes[0].emplacement and analyse.problemes[0].emplacement.paragraphe == 1


def test_guillemets_typographiques_de_word_acceptes() -> None:
    # Word remplace " par “ ” à la frappe ; docxtpl les remet droits.
    analyse = analyser(document("{{ (risque.statut == “PROPRIETAIRE”) | case }}"))
    assert analyse.problemes == []


def test_calcul_interdit_dans_un_modele() -> None:
    analyse = analyser(document("{{ prime.ttc * 2 }}"))
    assert codes(analyse) == ["CALCUL_DANS_LE_MODELE"]


def test_instructions_et_appels_interdits() -> None:
    analyse = analyser(document("{% set x = 1 %}", "{{ souscripteur.nom.upper() }}", "{{ ''.__class__ }}"))
    assert set(codes(analyse)) == {"INSTRUCTION_INTERDITE", "APPEL_INTERDIT", "ATTRIBUT_INTERDIT"}


def test_appels_de_bloc() -> None:
    analyse = analyser(
        document(
            "{%p for f in formules %}",
            '{{p bloc("garanties", f.code) }}',
            "{%p endfor %}",
            'Voir {{ bloc("garanties", "SOLO") }} ci-dessous',
        )
    )
    assert [(b.nom, b.cle) for b in analyse.blocs] == [("garanties", "formules[].code"), ("garanties", None)]
    assert codes(analyse) == ["BLOC_NON_ISOLE"]


def test_champ_word_qui_imite_une_balise() -> None:
    analyse = analyser(avec_champ_word("Nom : ", " souscripteur.nom "))
    assert [(c.instruction, c.emplacement.paragraphe) for c in analyse.champs_word] == [("souscripteur.nom", 1)]


def test_balises_de_l_en_tete() -> None:
    analyse = analyser(document("Corps", entete="Police n° {{ police.numero }}"))
    reference = analyse.references[0]
    assert reference.chemin == "police.numero"
    assert reference.emplacement.partie == "en-tête"


def test_modele_sans_balise() -> None:
    analyse = analyser(document("Texte fixe, sans aucune balise."))
    assert analyse.nombre_balises == 0
    assert analyse.textes[0].texte == "Texte fixe, sans aucune balise."


def test_polices_utilisees() -> None:
    analyse = analyser(document("Texte", police="Tahoma"))
    assert "Tahoma" in analyse.polices
