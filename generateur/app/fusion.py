"""Fusion d'un modèle Word avec des données (CDC §6.2, §6.4, §6.5), par docxtpl.

Règles :
  - une donnée ABSENTE fait échouer la fusion avec son chemin (« souscripteur.nom ») : jamais un
    blanc silencieux. Une donnée présente mais vide (null) s'écrit vide : c'est l'application qui
    décide qu'elle n'a pas de valeur ;
  - autoescape : un « < » ou un « & » dans les données ne casse jamais le document ;
  - bac à sable Jinja : un modèle déposé ne peut atteindre aucun objet Python interne ;
  - aucun calcul : les montants arrivent arrondis et ne sont que formatés (filtres.py).

Listes longues (§6.5) : au-delà du seuil — ou toujours, pour les listes que l'appelant déclare
`listes_en_annexe` (liste des adhérents d'une police de groupe, §10.2) — chaque boucle {%tr for … %} (ligne de tableau) ou
{%p for … %} (paragraphes) du corps sur cette liste est remplacée par le renvoi « Voir annexe –
Liste des assurés (25 personnes) », et la liste complète est rendue par le modèle d'annexe.
"""

import copy
import io
import re
from collections.abc import Callable, Collection
from dataclasses import dataclass, field
from typing import Any

from docx.shared import Mm
from docxtpl import DocxTemplate, InlineImage
from jinja2 import StrictUndefined, TemplateError, TemplateSyntaxError, UndefinedError
from jinja2.sandbox import SandboxedEnvironment, SecurityError
from jinja2.utils import missing
from lxml import etree

from app.filtres import FILTRES, ErreurFiltre

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
w = lambda nom: f"{{{W}}}{nom}"  # noqa: E731

# Listes pouvant passer en annexe : libellé et unité du renvoi.
LISTES_LONGUES: dict[str, tuple[str, str]] = {
    "assures": ("Liste des assurés", "personnes"),
    "beneficiaires": ("Liste des bénéficiaires", "personnes"),
    "formules": ("Liste des formules", "formules"),
    "echeances": ("Échéancier", "échéances"),
}


class ErreurFusion(Exception):
    """La fusion est impossible : message lisible, destiné à l'utilisateur."""


# ------------------------------------------------------------------ Données et données absentes


class Objet(dict):  # type: ignore[type-arg]
    """Objet des données qui connaît son chemin, pour nommer précisément une donnée absente."""

    def __init__(self, valeurs: dict[str, Any], chemin: str) -> None:
        super().__init__(valeurs)
        self._chemin = chemin


class Liste(list):  # type: ignore[type-arg]
    def __init__(self, valeurs: list[Any], chemin: str) -> None:
        super().__init__(valeurs)
        self._chemin = chemin


def envelopper(valeur: Any, chemin: str = "") -> Any:
    if isinstance(valeur, dict):
        return Objet({k: envelopper(v, f"{chemin}.{k}" if chemin else k) for k, v in valeur.items()}, chemin)
    if isinstance(valeur, list):
        return Liste([envelopper(v, f"{chemin}[]") for v in valeur], chemin)
    return valeur


class DonneeAbsente(StrictUndefined):
    __slots__ = ()

    @property
    def _undefined_message(self) -> str:
        nom = self._undefined_name
        conteneur = getattr(self._undefined_obj, "_chemin", None) if self._undefined_obj is not missing else ""
        if conteneur is None:
            return f"donnée absente : « {nom} »"
        chemin = f"{conteneur}.{nom}" if conteneur else str(nom)
        if isinstance(self._undefined_obj, list):
            chemin = f"{conteneur}[{nom}]"
        return f"donnée absente : « {chemin} »"


def _environnement() -> SandboxedEnvironment:
    environnement = SandboxedEnvironment(
        undefined=DonneeAbsente,
        autoescape=True,
        # null s'écrit vide (et non « None ») ; une donnée absente, elle, fait échouer la fusion.
        finalize=lambda valeur: "" if valeur is None else valeur,
    )
    environnement.filters.update(FILTRES)
    return environnement


# ------------------------------------------------------------------ Retouches du modèle avant fusion


def _texte(element: etree._Element) -> str:
    return "".join(t.text or "" for t in element.iter(w("t")))


def _ecrire(paragraphe: etree._Element, texte: str) -> None:
    """Remplace le contenu d'un paragraphe par `texte`, avec la mise en forme de son premier morceau."""
    premier = paragraphe.find(f".//{w('r')}")
    proprietes = premier.find(w("rPr")) if premier is not None else None
    for enfant in list(paragraphe):
        if enfant.tag != w("pPr"):
            paragraphe.remove(enfant)
    run = etree.SubElement(paragraphe, w("r"))
    if proprietes is not None:
        run.append(copy.deepcopy(proprietes))
    t = etree.SubElement(run, w("t"))
    t.text = texte
    t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")


def _isoler_les_blocs(corps: etree._Element) -> None:
    """{{ bloc(…) }} seul dans son paragraphe devient {{p bloc(…) }} : le sous-modèle remplace le
    paragraphe entier (docxtpl ne peut pas insérer un tableau au milieu d'une ligne de texte)."""
    for p in corps.iter(w("p")):
        texte = _texte(p).strip()
        m = re.fullmatch(r"\{\{\s*(bloc\(.*\))\s*\}\}", texte)
        if m:
            _ecrire(p, "{{p " + m.group(1) + " }}")


def _rangs(tableau: etree._Element) -> list[etree._Element]:
    return [r for r in tableau.iterchildren(w("tr"))]


def _remplacer_boucles(corps: etree._Element, liste: str, renvoi: str) -> int:
    """Remplace dans le corps les boucles sur `liste` par le renvoi. Renvoie le nombre de boucles."""
    debut_tr = re.compile(rf"\{{%tr\s+for\s+\w+\s+in\s+{liste}\s*-?%\}}")
    debut_p = re.compile(rf"\{{%p\s+for\s+\w+\s+in\s+{liste}\s*-?%\}}")
    fin = lambda prefixe: re.compile(rf"\{{%{prefixe}\s+endfor\s*-?%\}}")  # noqa: E731
    remplacees = 0

    # Lignes de tableau : {%tr for a in assures %} / lignes du modèle / {%tr endfor %}.
    for tableau in list(corps.iter(w("tbl"))):
        rangs = _rangs(tableau)
        i = 0
        while i < len(rangs):
            if not debut_tr.search(_texte(rangs[i])):
                i += 1
                continue
            profondeur, j = 1, i + 1
            while j < len(rangs) and profondeur:
                texte = _texte(rangs[j])
                profondeur += bool(re.search(r"\{%tr\s+for\s", texte)) - bool(fin("tr").search(texte))
                j += 1
            if profondeur:
                raise ErreurFusion(f"boucle sur « {liste} » sans {{%tr endfor %}} dans le tableau")
            modele = rangs[i + 1] if i + 1 < j - 1 else rangs[i]
            nouveau = copy.deepcopy(modele)
            cellules = list(nouveau.iterchildren(w("tc")))
            largeur = 0
            for c in cellules:
                span = c.find(f"{w('tcPr')}/{w('gridSpan')}")
                largeur += int(span.get(w("val"))) if span is not None else 1
            for c in cellules[1:]:
                nouveau.remove(c)
            premiere = cellules[0]
            proprietes = premiere.find(w("tcPr"))
            if proprietes is None:
                proprietes = etree.Element(w("tcPr"))
                premiere.insert(0, proprietes)
            for ancien in proprietes.findall(w("gridSpan")) + proprietes.findall(w("vMerge")) + proprietes.findall(w("hMerge")):
                proprietes.remove(ancien)
            if largeur > 1:
                span = etree.Element(w("gridSpan"))
                span.set(w("val"), str(largeur))
                # Ordre imposé par le schéma de Word : cnfStyle, tcW, puis gridSpan.
                avant = proprietes.find(w("tcW"))
                if avant is None:
                    avant = proprietes.find(w("cnfStyle"))
                if avant is not None:
                    avant.addnext(span)
                else:
                    proprietes.insert(0, span)
            paragraphes = list(premiere.iterchildren(w("p")))
            for p in paragraphes[1:]:
                premiere.remove(p)
            _ecrire(paragraphes[0], renvoi)
            rangs[i].addprevious(nouveau)
            for rang in rangs[i:j]:
                tableau.remove(rang)
            remplacees += 1
            rangs = _rangs(tableau)
            i += 1

    # Paragraphes : {%p for a in assures %} / paragraphes du modèle / {%p endfor %}.
    paragraphes = [p for p in corps.iter(w("p"))]
    for p in paragraphes:
        if p.getparent() is None or not debut_p.search(_texte(p)):
            continue
        freres = [p] + [f for f in p.itersiblings()]
        profondeur, k = 1, 1
        while k < len(freres) and profondeur:
            texte = _texte(freres[k])
            profondeur += bool(re.search(r"\{%p\s+for\s", texte)) - bool(fin("p").search(texte))
            k += 1
        if profondeur:
            raise ErreurFusion(f"boucle sur « {liste} » sans {{%p endfor %}}")
        modele = freres[1] if k > 2 and freres[1].tag == w("p") else p
        nouveau = copy.deepcopy(modele)
        _ecrire(nouveau, renvoi)
        p.addprevious(nouveau)
        parent = p.getparent()
        for element in freres[:k]:
            parent.remove(element)
        remplacees += 1

    # Toute autre boucle sur la liste (dans une ligne de texte) ne peut pas passer en annexe.
    for p in corps.iter(w("p")):
        if re.search(rf"\{{%-?\s*for\s+\w+\s+in\s+{liste}\b", _texte(p)):
            raise ErreurFusion(
                f"liste « {liste} » trop longue pour le corps du document, mais sa boucle ne peut pas être "
                "remplacée par un renvoi en annexe : utilisez {%tr for … %} (ligne de tableau) ou {%p for … %}"
            )
    return remplacees


# ------------------------------------------------------------------ Fusion


@dataclass
class Image:
    png: bytes
    largeur_mm: float


@dataclass
class Annexe:
    liste: str
    docx: bytes


@dataclass
class Resultat:
    corps: bytes
    annexes: list[Annexe] = field(default_factory=list)


def _rendre(
    modele: bytes,
    donnees: dict[str, Any],
    images: dict[str, Image],
    retouche: Callable[[etree._Element], None] | None = None,
    sous_modeles: dict[str, dict[str, bytes]] | None = None,
) -> bytes:
    gabarit = DocxTemplate(io.BytesIO(modele))
    gabarit.init_docx()
    corps = gabarit.docx.element.body
    if retouche:
        retouche(corps)
    environnement = _environnement()
    contexte = envelopper(donnees)
    for nom, image in images.items():
        contexte[nom] = InlineImage(gabarit, io.BytesIO(image.png), width=Mm(image.largeur_mm))

    if sous_modeles is not None:
        rendus: dict[tuple[str, str], Any] = {}

        def bloc(nom: str, cle: object) -> Any:
            cle_texte = str(cle)
            if (nom, cle_texte) not in rendus:
                sous_modele = sous_modeles.get(nom, {}).get(cle_texte)
                if sous_modele is None:
                    raise ErreurFusion(f"sous-modèle « {nom} » introuvable pour « {cle_texte} »")
                # Le sous-modèle est fusionné avec les mêmes données (sans bloc() à son tour).
                rendu = _rendre(sous_modele, donnees, images)
                rendus[(nom, cle_texte)] = gabarit.new_subdoc(io.BytesIO(rendu))
            return rendus[(nom, cle_texte)]

        environnement.globals["bloc"] = bloc

    try:
        gabarit.render(contexte, jinja_env=environnement, autoescape=True)
    except ErreurFusion:
        raise
    except UndefinedError as erreur:
        raise ErreurFusion(str(erreur) + _pres_de(erreur)) from None
    except ErreurFiltre as erreur:
        raise ErreurFusion(str(erreur)) from None
    except SecurityError:
        raise ErreurFusion("opération interdite dans le modèle") from None
    except TemplateSyntaxError as erreur:
        raise ErreurFusion(f"modèle invalide : {erreur.message}{_pres_de(erreur)}") from None
    except TemplateError as erreur:
        raise ErreurFusion(f"fusion impossible : {erreur}") from None
    sortie = io.BytesIO()
    gabarit.save(sortie)
    return sortie.getvalue()


def _pres_de(erreur: Exception) -> str:
    """docxtpl joint à l'erreur le texte autour de la balise fautive."""
    contexte = getattr(erreur, "docx_context", None)
    if not contexte:
        return ""
    texte = " ".join(ligne.strip() for ligne in contexte if ligne.strip())
    return f" (près de : « {texte[:160]} »)" if texte else ""


def fusionner(
    modele: bytes,
    donnees: dict[str, Any],
    *,
    seuil_liste: int,
    annexes: dict[str, bytes] | None = None,
    sous_modeles: dict[str, dict[str, bytes]] | None = None,
    images: dict[str, Image] | None = None,
    listes_en_annexe: Collection[str] = (),
) -> Resultat:
    """Fusionne le modèle ; produit le corps et, pour chaque liste trop longue ou imposée, son annexe."""
    annexes = annexes or {}
    images = images or {}
    en_annexe: list[str] = []

    def retouche(corps: etree._Element) -> None:
        _isoler_les_blocs(corps)
        for liste, (libelle, unite) in LISTES_LONGUES.items():
            valeur = donnees.get(liste)
            imposee = liste in listes_en_annexe
            if not isinstance(valeur, list) or (len(valeur) <= seuil_liste and not imposee):
                continue
            renvoi = f"Voir annexe – {libelle} ({len(valeur)} {unite})"
            if _remplacer_boucles(corps, liste, renvoi):
                if liste not in annexes:
                    raison = "renvoyée en annexe" if imposee else f"trop longue ({len(valeur)} lignes, seuil {seuil_liste})"
                    raise ErreurFusion(f"{libelle} {raison} : aucun modèle d'annexe pour « {liste} »")
                en_annexe.append(liste)

    corps = _rendre(modele, donnees, images, retouche, sous_modeles or {})
    return Resultat(
        corps=corps,
        annexes=[Annexe(liste, _rendre(annexes[liste], donnees, images, sous_modeles=sous_modeles or {})) for liste in en_annexe],
    )
