"""Polices installées sur la machine du générateur (CDC §15.1 : polices des modèles installées).

Sous Linux (image Docker, VPS), la liste vient de fontconfig (`fc-list`), la même source que celle
qu'utilise LibreOffice. Sous Windows (poste de développement), elle vient du registre ; la
correspondance y est approximative (« Arial Black » fait croire à la présence d'« Arial »), ce qui
est sans conséquence : seul le rendu Linux compte pour la production.

La liste est lue une seule fois par processus : les polices d'une image ne changent pas pendant
qu'elle tourne.

D69 : AUCUNE police Microsoft n'est à fournir. Une police demandée par un modèle est « couverte » si elle est
installée, OU si fontconfig la résout vers un remplaçant AUTORISÉ de mêmes dimensions (`REMPLACANTS_AUTORISES`,
source unique de /sante et du vérificateur de modèle). Jamais un repli quelconque : `fc-match` renvoie TOUJOURS
une police (DejaVu, Inter…), ce n'est pas une preuve.
"""

import shutil
import subprocess
import sys
from collections.abc import Callable
from functools import lru_cache

# Polices indispensables, utilisées par les modèles actuels : sans elles (ou sans leur remplaçant autorisé), la
# pagination de Word n'est pas reproduite (recette.md §1.2, variante A).
POLICES_REQUISES = ("Tahoma", "Calibri")

# Remplaçants AUTORISÉS (D69) : police demandée par les modèles → familles LIBRES de mêmes dimensions de caractères
# que fontconfig peut lui substituer. Seule source : /sante (`routes/sante.py`), `analyse.py` et le vérificateur de
# modèle (`scripts/verifier_modele.py`) l'importent d'ici. Une police absente de cette table n'a pas de remplaçant :
# elle sera remplacée par une police de secours aux dimensions DIFFÉRENTES (les sauts de page peuvent se décaler).
REMPLACANTS_AUTORISES: dict[str, tuple[str, ...]] = {
    # Carlito : métriquement compatible avec Calibri (paquet fonts-crosextra-carlito) ; fontconfig l'y résout lui-même.
    "Calibri": ("Carlito",),
    # La police de remplacement du projet Wine (paquet fonts-wine, licence LGPL-2.1+) se nomme « Tahoma » : une fois
    # exposée à fontconfig, elle EST la famille Tahoma, sans alias. Une vraie Tahoma déposée dans generateur/polices/
    # porterait le même nom : /sante ne les distingue pas, `fc-match -f '%{file}' Tahoma` dit laquelle est retenue.
    "Tahoma": ("Tahoma",),
    # Liberation : métriquement compatible avec Arial et Times New Roman (paquet fonts-liberation).
    "Arial": ("Liberation Sans",),
    "Times New Roman": ("Liberation Serif",),
}

# Ce que fontconfig choisit pour une police demandée : les familles de la police retenue (None : impossible à savoir).
Resolveur = Callable[[str], frozenset[str] | None]

_SUFFIXES_REGISTRE = ("(TrueType)", "(OpenType)", "(All res)")


def _familles_fc_list() -> frozenset[str] | None:
    executable = shutil.which("fc-list")
    if executable is None:
        return None
    try:
        sortie = subprocess.run(
            [executable, ":", "family"], capture_output=True, text=True, check=True, timeout=30
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return None
    return analyser_fc_list(sortie)


def analyser_fc_list(sortie: str) -> frozenset[str]:
    """« MS Gothic,ＭＳ ゴシック » : une ligne par police, noms alternatifs séparés par des virgules."""
    return frozenset(
        nom.strip() for ligne in sortie.splitlines() for nom in ligne.split(",") if nom.strip()
    )


@lru_cache
def resolution_fontconfig(police: str) -> frozenset[str] | None:
    """Familles de la police que fontconfig retient pour `police` (`fc-match`), ou None si c'est impossible à savoir.

    `fc-match` renvoie toujours une police : si `police` n'existe pas, c'est un repli sans rapport (DejaVu Sans, Inter…).
    Seul `est_couverte` décide si ce résultat est un remplaçant autorisé. Sous Windows, il n'y a pas de fontconfig : None."""
    if sys.platform == "win32":
        return None
    executable = shutil.which("fc-match")
    if executable is None:
        return None
    try:
        sortie = subprocess.run(
            [executable, "-f", "%{family}\n", police], capture_output=True, text=True, check=True, timeout=30
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return None
    return analyser_fc_list(sortie)


def resolution_supposee(familles: frozenset[str]) -> Resolveur:
    """Résolution SUPPOSÉE à partir d'une simple liste de familles (`fc-list : family`), quand on n'a pas fontconfig sous la
    main (vérificateur de modèle sur une liste fournie) : chaque police est supposée résolue vers le premier de ses
    remplaçants autorisés qui est présent dans la liste, ce que fait l'image (D69). /sante, lui, interroge fontconfig."""

    def resoudre(police: str) -> frozenset[str] | None:
        present = frozenset(r for r in REMPLACANTS_AUTORISES.get(police, ()) if r in familles)
        return present or None

    return resoudre


def _familles_registre_windows() -> frozenset[str] | None:
    import winreg  # Windows seulement

    noms: list[str] = []
    cles = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"),
    ]
    for racine, chemin in cles:
        try:
            with winreg.OpenKey(racine, chemin) as cle:
                indice = 0
                while True:
                    try:
                        noms.append(winreg.EnumValue(cle, indice)[0])
                    except OSError:
                        break
                    indice += 1
        except OSError:
            continue
    return analyser_registre(noms) if noms else None


def analyser_registre(noms: list[str]) -> frozenset[str]:
    """« Calibri Bold (TrueType) », « MS Gothic & MS UI Gothic & MS PGothic (TrueType) »."""
    familles: set[str] = set()
    for nom in noms:
        for suffixe in _SUFFIXES_REGISTRE:
            nom = nom.replace(suffixe, "")
        familles.update(partie.strip() for partie in nom.split("&") if partie.strip())
    return frozenset(familles)


@lru_cache
def familles_installees() -> frozenset[str] | None:
    """Noms des polices installées, ou None si la liste est impossible à obtenir."""
    if sys.platform == "win32":
        return _familles_registre_windows()
    return _familles_fc_list()


def est_installee(police: str, familles: frozenset[str]) -> bool:
    """Exacte avec fontconfig ; sous Windows, « Calibri » est présente si « Calibri Bold » l'est."""
    cible = police.casefold()
    for famille in familles:
        nom = famille.casefold()
        if nom == cible or (sys.platform == "win32" and nom.startswith(cible + " ")):
            return True
    return False


def remplacant_autorise(police: str, resolution: frozenset[str] | None) -> str | None:
    """Le remplaçant AUTORISÉ de `police` parmi les familles que fontconfig retient, ou None. Insensible à la casse."""
    if not resolution:
        return None
    retenues = {r.casefold() for r in resolution}
    return next((r for r in REMPLACANTS_AUTORISES.get(police, ()) if r.casefold() in retenues), None)


def est_couverte(police: str, familles: frozenset[str], resolution: frozenset[str] | None = None) -> bool:
    """Installée, OU résolue par fontconfig vers un remplaçant autorisé. Jamais un repli quelconque."""
    return est_installee(police, familles) or remplacant_autorise(police, resolution) is not None


def polices_absentes(
    polices: list[str] | tuple[str, ...], familles: frozenset[str], resolveur: Resolveur | None = None
) -> list[str]:
    """Polices ni installées ni couvertes par un remplaçant autorisé. Sans `resolveur`, seule l'installation compte."""
    return sorted({p for p in polices if not est_couverte(p, familles, resolveur(p) if resolveur else None)})


def polices_remplacees(
    polices: list[str] | tuple[str, ...], familles: frozenset[str], resolveur: Resolveur | None = None
) -> dict[str, str]:
    """{police: remplaçant autorisé} pour les polices NON installées mais couvertes (pour les rapports)."""
    resultat: dict[str, str] = {}
    for p in sorted(set(polices)):
        if est_installee(p, familles):
            continue
        remplacant = remplacant_autorise(p, resolveur(p) if resolveur else None)
        if remplacant is not None:
            resultat[p] = remplacant
    return resultat
