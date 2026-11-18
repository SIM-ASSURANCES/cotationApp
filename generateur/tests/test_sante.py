import ast
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import __version__
from app.config import charger_parametres, obtenir_parametres
from app.main import app
from app import polices as module_polices
from app.polices import (
    REMPLACANTS_AUTORISES,
    analyser_fc_list,
    analyser_registre,
    est_installee,
    polices_absentes,
    polices_remplacees,
    resolution_fontconfig,
    resolution_supposee,
)
from app.routes.sante import obtenir_familles, obtenir_resolveur

TOUTES = frozenset({"Calibri", "Tahoma", "Carlito", "DejaVu Sans"})


@pytest.fixture
def libreoffice_present(tmp_path: Path) -> None:
    soffice = tmp_path / "soffice.com"
    soffice.write_bytes(b"")  # simple fichier vide : LibreOffice n'est pas lancé
    app.dependency_overrides[obtenir_parametres] = lambda: charger_parametres(
        _env_file=None, libreoffice_chemin=soffice
    )


def polices(familles: frozenset[str] | None, resolutions: dict[str, set[str]] | None = None) -> None:
    """Simule `fc-list` (familles installées) et `fc-match` (ce que fontconfig retient pour une police demandée).

    Sans `resolutions`, fontconfig ne résout rien vers un remplaçant : seule l'installation compte (cas des tests d'avant D69)."""
    app.dependency_overrides[obtenir_familles] = lambda: familles
    table = {police: frozenset(retenues) for police, retenues in (resolutions or {}).items()}
    app.dependency_overrides[obtenir_resolveur] = lambda: table.get


def test_sante_est_degradee_sans_libreoffice(client: TestClient) -> None:
    polices(TOUTES)
    reponse = client.get("/sante")

    assert reponse.status_code == 200
    assert reponse.json() == {
        "statut": "degrade",  # le chemin de test pointe vers un fichier absent
        "version": __version__,
        "libreoffice_trouve": False,
        "polices_manquantes": [],
    }


@pytest.mark.usefixtures("libreoffice_present")
def test_sante_ok_avec_libreoffice_et_polices(client: TestClient) -> None:
    polices(TOUTES)
    corps = client.get("/sante").json()
    assert corps["libreoffice_trouve"] is True
    assert corps["polices_manquantes"] == []
    assert corps["statut"] == "ok"


@pytest.mark.usefixtures("libreoffice_present")
def test_sante_degradee_si_tahoma_ou_calibri_absente(client: TestClient) -> None:
    # Polices ni installées ni résolues par fontconfig vers un remplaçant (Carlito est là, mais fontconfig n'y résout pas Calibri).
    polices(frozenset({"Carlito", "DejaVu Sans", "Liberation Sans"}))
    corps = client.get("/sante").json()
    assert corps["statut"] == "degrade"
    assert corps["polices_manquantes"] == ["Calibri", "Tahoma"]


@pytest.mark.usefixtures("libreoffice_present")
def test_sante_degradee_si_liste_des_polices_impossible(client: TestClient) -> None:
    polices(None)  # fc-list absent
    corps = client.get("/sante").json()
    assert corps["statut"] == "degrade"
    assert corps["polices_manquantes"] is None


def test_lecture_de_fc_list() -> None:
    sortie = "Tahoma\nMS Gothic,ＭＳ ゴシック\nCarlito\n\nDejaVu Sans\n"
    familles = analyser_fc_list(sortie)
    assert familles == {"Tahoma", "MS Gothic", "ＭＳ ゴシック", "Carlito", "DejaVu Sans"}
    # Correspondance exacte : Carlito ne passe pas pour Calibri.
    assert polices_absentes(("Tahoma", "Calibri"), familles) == ["Calibri"]


def test_lecture_du_registre_windows() -> None:
    familles = analyser_registre(
        ["Calibri Bold (TrueType)", "MS Gothic & MS UI Gothic & MS PGothic (TrueType)", "Tahoma (TrueType)"]
    )
    assert {"Calibri Bold", "MS Gothic", "MS UI Gothic", "Tahoma"} <= familles
    assert est_installee("ms gothic", familles)


# ------------------------------------------------------------------ D69 : remplaçants libres autorisés (sorties fc-list / fc-match simulées)

IMAGE_LIBRE = frozenset({"Tahoma", "Carlito", "Liberation Sans", "Liberation Serif", "DejaVu Sans"})  # fc-list de l'image : aucune police Microsoft


@pytest.mark.usefixtures("libreoffice_present")
def test_sante_ok_quand_les_polices_sont_installees(client: TestClient) -> None:
    polices(frozenset({"Tahoma", "Calibri", "DejaVu Sans"}))  # polices sous licence déposées par SIM : installées telles quelles
    corps = client.get("/sante").json()
    assert (corps["statut"], corps["polices_manquantes"]) == ("ok", [])


@pytest.mark.usefixtures("libreoffice_present")
def test_sante_ok_quand_fontconfig_resout_vers_un_remplacant_autorise(client: TestClient) -> None:
    # L'image libre : Calibri n'est pas installée, fontconfig la résout en Carlito ; Tahoma est la police de Wine, nommée « Tahoma ».
    polices(IMAGE_LIBRE, {"Calibri": {"Carlito"}, "Tahoma": {"Tahoma"}})
    corps = client.get("/sante").json()
    assert (corps["statut"], corps["polices_manquantes"]) == ("ok", [])


@pytest.mark.usefixtures("libreoffice_present")
def test_sante_ko_quand_fontconfig_se_replie_sur_une_police_quelconque(client: TestClient) -> None:
    # fc-match renvoie TOUJOURS une police : un repli sur DejaVu (ou sur n'importe quelle autre) n'est pas une preuve.
    polices(frozenset({"Carlito", "DejaVu Sans"}), {"Calibri": {"DejaVu Sans"}, "Tahoma": {"DejaVu Sans", "DejaVu Sans Bold"}})
    corps = client.get("/sante").json()
    assert corps["statut"] == "degrade"
    assert corps["polices_manquantes"] == ["Calibri", "Tahoma"]


@pytest.mark.usefixtures("libreoffice_present")
def test_sante_ko_quand_le_remplacant_est_celui_d_une_autre_police(client: TestClient) -> None:
    # Carlito remplace Calibri, pas Tahoma : un remplaçant autorisé ne vaut que pour SA police.
    polices(frozenset({"Carlito"}), {"Calibri": {"Carlito"}, "Tahoma": {"Carlito"}})
    assert client.get("/sante").json()["polices_manquantes"] == ["Tahoma"]


def test_la_table_des_remplacants_autorises_est_la_seule_source() -> None:
    assert REMPLACANTS_AUTORISES == {
        "Calibri": ("Carlito",),
        "Tahoma": ("Tahoma",),
        "Arial": ("Liberation Sans",),
        "Times New Roman": ("Liberation Serif",),
    }
    # /sante, l'analyse et le vérificateur de modèle importent la table du MÊME module : aucun nom de remplaçant n'est recopié ailleurs.
    racine = Path(__file__).resolve().parent.parent
    familles_libres = {famille for remplacants in REMPLACANTS_AUTORISES.values() for famille in remplacants} - set(REMPLACANTS_AUTORISES)
    for fichier in ("app/routes/sante.py", "app/analyse.py", "scripts/verifier_modele.py"):
        arbre = ast.parse((racine / fichier).read_text(encoding="utf-8"))
        litteraux = {n.value for n in ast.walk(arbre) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
        assert not litteraux & familles_libres, (fichier, litteraux & familles_libres)
    assert "REMPLACANTS_AUTORISES" in (racine / "scripts" / "verifier_modele.py").read_text(encoding="utf-8")


def test_polices_remplacees_et_absentes_selon_la_resolution() -> None:
    resoudre = {"Calibri": frozenset({"Carlito"}), "Arial": frozenset({"Liberation Sans"}), "Aptos": frozenset({"DejaVu Sans"})}.get
    polices_demandees = ("Tahoma", "Calibri", "Arial", "Aptos", "Segoe UI")
    assert polices_absentes(polices_demandees, IMAGE_LIBRE, resoudre) == ["Aptos", "Segoe UI"]
    assert polices_remplacees(polices_demandees, IMAGE_LIBRE, resoudre) == {"Arial": "Liberation Sans", "Calibri": "Carlito"}
    # Sans résolveur, seule l'installation compte (comportement d'avant D69).
    assert polices_absentes(polices_demandees, IMAGE_LIBRE) == ["Aptos", "Arial", "Calibri", "Segoe UI"]


def test_resolution_supposee_a_partir_d_une_liste_de_familles() -> None:
    resoudre = resolution_supposee(frozenset({"Carlito", "Liberation Sans", "DejaVu Sans"}))
    assert resoudre("Calibri") == {"Carlito"} and resoudre("Arial") == {"Liberation Sans"}
    assert resoudre("Tahoma") is None and resoudre("Aptos") is None  # un repli quelconque n'est jamais supposé


def _simuler_fc_match(monkeypatch: pytest.MonkeyPatch, sorties: dict[str, str] | None) -> list[list[str]]:
    """Remplace `shutil.which` et `subprocess.run` du module : `sorties` = sortie de fc-match par police (None : fc-match absent)."""
    appels: list[list[str]] = []
    monkeypatch.setattr(module_polices.shutil, "which", lambda nom: "/usr/bin/fc-match" if sorties is not None else None)

    def faux_run(commande: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        appels.append(commande)
        return subprocess.CompletedProcess(commande, 0, stdout=(sorties or {})[commande[-1]], stderr="")

    monkeypatch.setattr(module_polices.subprocess, "run", faux_run)
    resolution_fontconfig.cache_clear()
    return appels


def test_resolution_fontconfig_lit_la_sortie_de_fc_match(monkeypatch: pytest.MonkeyPatch) -> None:
    appels = _simuler_fc_match(monkeypatch, {"Calibri": "Carlito\n", "Tahoma": "DejaVu Sans,DejaVu Sans Bold\n", "Times New Roman": "Liberation Serif\n"})
    try:
        assert resolution_fontconfig("Calibri") == {"Carlito"}
        assert resolution_fontconfig("Tahoma") == {"DejaVu Sans", "DejaVu Sans Bold"}
        # Le nom est passé tel quel (une seule fois, mis en cache), avec le format « famille » de fc-match.
        assert resolution_fontconfig("Times New Roman") == {"Liberation Serif"}
        assert resolution_fontconfig("Calibri") == {"Carlito"} and len(appels) == 3
        assert appels[0] == ["/usr/bin/fc-match", "-f", "%{family}\n", "Calibri"]
    finally:
        resolution_fontconfig.cache_clear()


def test_resolution_fontconfig_est_inconnue_sans_fc_match_ou_sous_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    try:
        _simuler_fc_match(monkeypatch, None)
        assert resolution_fontconfig("Calibri") is None
        _simuler_fc_match(monkeypatch, {"Calibri": "Carlito\n"})
        monkeypatch.setattr(sys, "platform", "win32")  # poste de développement : pas de fontconfig
        resolution_fontconfig.cache_clear()
        assert resolution_fontconfig("Calibri") is None
    finally:
        resolution_fontconfig.cache_clear()


def test_comportement_windows_inchange(monkeypatch: pytest.MonkeyPatch) -> None:
    # Sous Windows, les polices viennent du registre ; aucun remplaçant n'est jamais supposé (la vraie police est là ou ne l'est pas).
    monkeypatch.setattr(sys, "platform", "win32")
    resolution_fontconfig.cache_clear()
    try:
        familles = analyser_registre(["Calibri Bold (TrueType)", "Tahoma (TrueType)", "Carlito (TrueType)"])
        assert polices_absentes(("Tahoma", "Calibri", "Arial"), familles, resolution_fontconfig) == ["Arial"]
        # « Calibri Bold » fait croire à « Calibri » (approximation connue) ; Carlito ne remplace rien.
        assert polices_absentes(("Calibri",), analyser_registre(["Carlito (TrueType)"]), resolution_fontconfig) == ["Calibri"]
    finally:
        resolution_fontconfig.cache_clear()
