"""Conversion d'un .docx en PDF avec LibreOffice sans interface.

C'est la SEULE fonction du code qui lance LibreOffice : si le serveur impose une
autre méthode, on ne change qu'ici. Elle applique les garde-fous du CDC §15.3 :
  - délai maximal : la conversion bloquée est tuée (avec ses processus enfants),
    ce qui évite qu'un seul document bloque toute la file ;
  - profil LibreOffice dédié au service : pas de conflit avec un LibreOffice
    ouvert par un utilisateur ;
  - export PDF sans perte (UseLosslessCompression) : les images ne sont pas
    recompressées.
"""

import os
import signal
import subprocess
import sys
import threading
from pathlib import Path

OPTIONS_PDF = '{"UseLosslessCompression":{"type":"boolean","value":"true"}}'

# Un profil LibreOffice ne supporte qu'une conversion à la fois : deux demandes simultanées (le
# serveur HTTP traite les requêtes en parallèle) sont donc mises l'une après l'autre. La génération
# en masse (phase 5) passera par une file de tâches.
_UNE_A_LA_FOIS = threading.Lock()


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
) -> Path:
    """Convertit docx en PDF dans dossier_sortie et renvoie le chemin du PDF.

    Lève ConversionDelaiDepasse au-delà de delai_s secondes, ConversionEchouee
    dans les autres cas d'échec. Les messages ne contiennent aucune donnée du document.
    """
    dossier_sortie.mkdir(parents=True, exist_ok=True)
    profil.mkdir(parents=True, exist_ok=True)
    pdf = dossier_sortie / (docx.stem + ".pdf")
    pdf.unlink(missing_ok=True)  # un ancien PDF ne doit jamais passer pour le résultat

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
    with _UNE_A_LA_FOIS:
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

    if processus.returncode != 0 or not pdf.is_file():
        raise ConversionEchouee(f"LibreOffice a échoué (code {processus.returncode})")
    return pdf
