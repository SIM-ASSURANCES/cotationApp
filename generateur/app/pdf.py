"""Opérations sur les PDF produits : QR code, filigrane, assemblage (CDC §6.8, §9.3, §14.1)."""

import io
import math

import qrcode
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, FloatObject, NameObject

# Largeurs de Helvetica-Bold (police standard des PDF, toujours disponible), en millièmes d'em :
# seulement pour centrer le filigrane.
_LARGEURS = {"E": 667, "X": 667, "P": 667, "I": 278, "R": 722, "É": 667, "A": 722, "N": 722, "U": 722, "L": 611, "S": 667, "T": 611, " ": 278}


def qr_png(url: str) -> bytes:
    """QR code de vérification (correction d'erreur M : lisible même un peu abîmé)."""
    image = qrcode.make(url, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=2)
    sortie = io.BytesIO()
    image.save(sortie, format="PNG")
    return sortie.getvalue()


def _chaine_pdf(texte: str) -> bytes:
    """Chaîne littérale PDF en WinAnsi (É compris), caractères spéciaux échappés."""
    octets = texte.encode("cp1252")
    return b"(" + b"".join(b"\\" + bytes([o]) if o in b"()\\" else bytes([o]) for o in octets) + b")"


def filigraner(pdf: bytes, texte: str) -> bytes:
    """Ajoute `texte` en grand, en diagonale et en transparence sur chaque page (« EXPIRÉE », T11)."""
    lecteur = PdfReader(io.BytesIO(pdf))
    redacteur = PdfWriter(clone_from=lecteur)
    for page in redacteur.pages:
        largeur, hauteur = float(page.mediabox.width), float(page.mediabox.height)
        angle = math.atan2(hauteur, largeur)
        diagonale = math.hypot(largeur, hauteur)
        em = sum(_LARGEURS.get(c, 650) for c in texte) / 1000
        taille = min(diagonale * 0.7 / em, 160)
        cos, sin = math.cos(angle), math.sin(angle)
        demi = em * taille / 2
        x = largeur / 2 - demi * cos + 0.35 * taille * sin
        y = hauteur / 2 - demi * sin - 0.35 * taille * cos
        contenu = (
            f"q /GSfiligrane gs 0.80 0.10 0.10 rg BT /Ffiligrane {taille:.1f} Tf "
            f"{cos:.4f} {sin:.4f} {-sin:.4f} {cos:.4f} {x:.1f} {y:.1f} Tm "
        ).encode() + _chaine_pdf(texte) + b" Tj ET Q"
        calque = PdfWriter().add_blank_page(largeur, hauteur)
        flux = DecodedStreamObject()
        flux.set_data(contenu)
        calque[NameObject("/Contents")] = flux
        calque[NameObject("/Resources")] = DictionaryObject(
            {
                NameObject("/Font"): DictionaryObject(
                    {
                        NameObject("/Ffiligrane"): DictionaryObject(
                            {
                                NameObject("/Type"): NameObject("/Font"),
                                NameObject("/Subtype"): NameObject("/Type1"),
                                NameObject("/BaseFont"): NameObject("/Helvetica-Bold"),
                                NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
                            }
                        )
                    }
                ),
                NameObject("/ExtGState"): DictionaryObject(
                    {
                        NameObject("/GSfiligrane"): DictionaryObject(
                            {NameObject("/Type"): NameObject("/ExtGState"), NameObject("/ca"): FloatObject(0.25), NameObject("/CA"): FloatObject(0.25)}
                        )
                    }
                ),
            }
        )
        page.merge_page(calque)
    sortie = io.BytesIO()
    redacteur.write(sortie)
    return sortie.getvalue()


def assembler(morceaux: list[bytes]) -> bytes:
    """Un seul PDF, dans l'ordre donné (CP → annexes → CS → CG, CDC §6.8)."""
    if len(morceaux) == 1:
        return morceaux[0]
    assemblage = PdfWriter()
    for morceau in morceaux:
        assemblage.append(PdfReader(io.BytesIO(morceau)))
    sortie = io.BytesIO()
    assemblage.write(sortie)
    return sortie.getvalue()
