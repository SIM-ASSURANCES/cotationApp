"""Stockage des documents émis (CDC §14.3, décision D11) : volume persistant, EN AJOUT SEUL.

Un fichier écrit n'est jamais remplacé : écrire un chemin qui existe déjà est refusé. Une
réédition est donc un NOUVEAU fichier (version +1), à côté du premier. L'écriture est atomique :
le fichier est d'abord écrit à part, puis lié à son nom définitif par un lien physique, qui échoue
si le nom existe ; un document à moitié écrit n'apparaît jamais. Le fichier est ensuite mis en
lecture seule.

Racine : DOSSIER_SORTIE/documents (dans l'image Docker : le volume `documents`).
"""

import hashlib
import io
import os
import re
import stat
import tempfile
import zipfile
from pathlib import Path

# Chemin relatif : segments de lettres, chiffres, « _ », « - » et « . », jamais « .. ».
_SEGMENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,120}$")


class CheminInvalide(ValueError):
    pass


class DejaStocke(Exception):
    """Le chemin existe : un document émis n'est jamais écrasé."""


class Introuvable(Exception):
    pass


def racine(dossier_sortie: Path) -> Path:
    return dossier_sortie / "documents"


def _resoudre(base: Path, chemin: str) -> Path:
    segments = chemin.split("/")
    if not segments or len(segments) > 10 or any(not _SEGMENT.match(s) or s in (".", "..") for s in segments):
        raise CheminInvalide(f"chemin de stockage invalide : {chemin!r}")
    return base.joinpath(*segments)


def ecrire(base: Path, chemin: str, contenu: bytes) -> str:
    """Écrit le fichier s'il n'existe pas ; renvoie son empreinte SHA-256."""
    cible = _resoudre(base, chemin)
    cible.parent.mkdir(parents=True, exist_ok=True)
    if cible.exists():
        raise DejaStocke(chemin)
    descripteur, provisoire = tempfile.mkstemp(dir=cible.parent, prefix=".ecriture-")
    try:
        with os.fdopen(descripteur, "wb") as fichier:
            fichier.write(contenu)
            fichier.flush()
            os.fsync(fichier.fileno())
        try:
            os.link(provisoire, cible)  # échoue si `cible` existe : jamais d'écrasement
        except FileExistsError:
            raise DejaStocke(chemin) from None
    finally:
        Path(provisoire).unlink(missing_ok=True)
    cible.chmod(stat.S_IRUSR | stat.S_IRGRP)
    return hashlib.sha256(contenu).hexdigest()


def lire(base: Path, chemin: str) -> bytes:
    cible = _resoudre(base, chemin)
    if not cible.is_file():
        raise Introuvable(chemin)
    return cible.read_bytes()


def zipper(base: Path, fichiers: list[tuple[str, str]]) -> bytes:
    """Archive ZIP de fichiers stockés : (chemin stocké, nom ou chemin dans l'archive)."""
    sortie = io.BytesIO()
    with zipfile.ZipFile(sortie, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for chemin, nom in fichiers:
            chemin_archive = "/".join(_resoudre(Path(""), nom).parts)
            archive.writestr(chemin_archive, lire(base, chemin))
    return sortie.getvalue()


def zipper_et_stocker(base: Path, fichiers: list[tuple[str, str]], chemin: str) -> tuple[str, int]:
    """Archive ZIP de fichiers stockés, ÉCRITE dans le stockage (ajout seul) : (empreinte, taille).

    Sert à l'archive d'un import en masse (phase 5) : les PDF ne repassent pas par l'application.
    """
    contenu = zipper(base, fichiers)
    return ecrire(base, chemin, contenu), len(contenu)
