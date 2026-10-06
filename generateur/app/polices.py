"""Polices installées sur la machine du générateur (CDC §15.1 : polices des modèles installées).

Sous Linux (image Docker, VPS), la liste vient de fontconfig (`fc-list`), la même source que celle
qu'utilise LibreOffice. Sous Windows (poste de développement), elle vient du registre ; la
correspondance y est approximative (« Arial Black » fait croire à la présence d'« Arial »), ce qui
est sans conséquence : seul le rendu Linux compte pour la production.

La liste est lue une seule fois par processus : les polices d'une image ne changent pas pendant
qu'elle tourne.
"""

import shutil
import subprocess
import sys
from functools import lru_cache

# Polices sans équivalent libre de mêmes dimensions, utilisées par les modèles actuels : sans elles,
# la pagination de Word n'est pas reproduite (recette.md §1.2, variante A).
POLICES_REQUISES = ("Tahoma", "Calibri")

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


def polices_absentes(polices: list[str] | tuple[str, ...], familles: frozenset[str]) -> list[str]:
    return sorted({p for p in polices if not est_installee(p, familles)})
