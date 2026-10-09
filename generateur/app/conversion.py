"""Conversion d'un .docx en PDF avec LibreOffice sans interface.

C'est la SEULE fonction du code qui lance LibreOffice : si le serveur impose une
autre méthode, on ne change qu'ici. Elle applique les garde-fous du CDC §15.3 :
  - délai maximal : la conversion bloquée est tuée (avec ses processus enfants),
    ce qui évite qu'un seul document bloque toute la file ;
  - profils LibreOffice dédiés au service : pas de conflit avec un LibreOffice
    ouvert par un utilisateur ; un profil par conversion simultanée (phase 5,
    CONVERSIONS_SIMULTANEES), car un profil ne supporte qu'une conversion à la fois ;
  - export PDF sans perte (UseLosslessCompression) : les images ne sont pas
    recompressées.
"""

import os
import queue
import signal
import subprocess
import sys
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

OPTIONS_PDF = '{"UseLosslessCompression":{"type":"boolean","value":"true"}}'



class _Profils:
    """Profils LibreOffice prêtés aux conversions (phase 5, T8).

    Un profil ne supporte qu'une conversion à la fois. Avec N conversions simultanées, N profils
    distincts (`<profil>/conversion-1` … `conversion-N`) sont prêtés tour à tour : la (N+1)e demande
    attend qu'un profil se libère. Le serveur HTTP traite les requêtes en parallèle ; c'est ici que
    leur nombre est borné (VPS partagé avec le portail RH : 2 par défaut).
    """

    def __init__(self) -> None:
        self._verrou = threading.Lock()
        self._files: dict[tuple[Path, int], queue.Queue[Path]] = {}

    @contextmanager
    def emprunter(self, base: Path, nombre: int) -> Iterator[Path]:
        with self._verrou:
            file = self._files.get((base, nombre))
            if file is None:
                file = queue.Queue()
                for i in range(1, nombre + 1):
                    file.put(base / f"conversion-{i}")
                self._files[(base, nombre)] = file
        profil = file.get()
        try:
            yield profil
        finally:
            file.put(profil)


_PROFILS = _Profils()


class ConversionEchouee(Exception):
    """LibreOffice a échoué ou n'a pas produit de PDF."""


class ConversionDelaiDepasse(ConversionEchouee):
    """La conversion a dépassé le délai maximal et a été interrompue."""


def _tuer_arbre(processus: subprocess.Popen[bytes]) -> None:
    """Tue LibreOffice et ses enfants (soffice.com lance soffice.bin sous Windows)."""
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(processus.pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
    else:
        os.killpg(processus.pid, signal.SIGKILL)  # groupe créé par start_new_session
    processus.wait()


def convertir_en_pdf(
    docx: Path,
    dossier_sortie: Path,
    *,
    executable: Path,
    profil: Path,
    delai_s: float,
    simultanees: int = 1,
) -> Path:
    """Convertit docx en PDF dans dossier_sortie et renvoie le chemin du PDF.

    Lève ConversionDelaiDepasse au-delà de delai_s secondes, ConversionEchouee
    dans les autres cas d'échec. Les messages ne contiennent aucune donnée du document.
    `profil` est le dossier de base des profils ; `simultanees` le nombre de conversions qui
    peuvent tourner en même temps (un profil chacune).
    """
    dossier_sortie.mkdir(parents=True, exist_ok=True)
    pdf = dossier_sortie / (docx.stem + ".pdf")
    pdf.unlink(missing_ok=True)  # un ancien PDF ne doit jamais passer pour le résultat

    with _PROFILS.emprunter(profil, simultanees) as dedie:
        _lancer(docx, dossier_sortie, executable=executable, profil=dedie, delai_s=delai_s)
    if not pdf.is_file():
        raise ConversionEchouee("LibreOffice n'a pas produit de PDF")
    return pdf


def _lancer(docx: Path, dossier_sortie: Path, *, executable: Path, profil: Path, delai_s: float) -> None:
    profil.mkdir(parents=True, exist_ok=True)
    commande = [
        str(executable),
        "--headless",
        "--norestore",
        f"-env:UserInstallation={profil.resolve().as_uri()}",
        "--convert-to",
        f"pdf:writer_pdf_Export:{OPTIONS_PDF}",
        "--outdir",
        str(dossier_sortie),
        str(docx),
    ]
    processus = subprocess.Popen(
        commande,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=sys.platform != "win32",
    )
    try:
        processus.communicate(timeout=delai_s)
    except subprocess.TimeoutExpired:
        _tuer_arbre(processus)
        raise ConversionDelaiDepasse(f"conversion interrompue après {delai_s} s") from None
    if processus.returncode != 0:
        raise ConversionEchouee(f"LibreOffice a échoué (code {processus.returncode})")
