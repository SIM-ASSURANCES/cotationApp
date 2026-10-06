"""Filtres des modèles Word (CDC §6.2) : montant, lettres, date, dateheure, pct, case.

Le générateur ne CALCULE rien (CDC §5) : il reçoit des montants déjà arrondis par le moteur de
calcul de l'application et ne fait que les écrire. Un montant n'est jamais un nombre à virgule
flottante : il arrive en texte (« 11592000 », « 1809.50 ») ou en entier.

Une valeur que le filtre ne sait pas écrire fait ÉCHOUER la génération (ErreurFiltre), avec un
message clair : jamais un blanc ni une valeur approximative dans un document émis.
"""

import re
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

from app.lettres import MontantInvalide, montant_en_lettres

# Espace insécable (U+00A0) : « 300 » et « 000 » ne se retrouvent jamais sur deux lignes.
# L'espace fine insécable (U+202F) est absente d'Arial Narrow et de MS Gothic, utilisées par les
# modèles : elle serait remplacée par une police de secours (vérifié avec fc-list dans l'image).
ESPACE_INSECABLE = " "
CASE_COCHEE = "☒"  # U+2612
CASE_VIDE = "☐"  # U+2610


class ErreurFiltre(ValueError):
    """Valeur qu'un filtre ne sait pas écrire : la génération s'arrête avec ce message."""


def _decimal(valeur: object, filtre: str) -> Decimal:
    if isinstance(valeur, bool) or isinstance(valeur, float) or valeur is None:
        raise ErreurFiltre(f"{filtre} : valeur {valeur!r} refusée (attendu : un nombre en texte ou un entier)")
    if isinstance(valeur, (int, Decimal)):
        nombre = Decimal(valeur)
    elif isinstance(valeur, str) and re.fullmatch(r"-?\d+(\.\d+)?", valeur.strip()):
        nombre = Decimal(valeur.strip())
    else:
        raise ErreurFiltre(f"{filtre} : valeur illisible {valeur!r}")
    if not nombre.is_finite():
        raise ErreurFiltre(f"{filtre} : valeur illisible {valeur!r}")
    return nombre


def _grouper(entier: str) -> str:
    """« 11592000 » → « 11 592 000 » (espaces insécables)."""
    groupes = []
    while len(entier) > 3:
        groupes.insert(0, entier[-3:])
        entier = entier[:-3]
    groupes.insert(0, entier)
    return ESPACE_INSECABLE.join(groupes)


def _ecrire(nombre: Decimal, supprimer_zeros: bool) -> str:
    """Écrit un nombre tel qu'il est reçu : virgule décimale, milliers groupés, AUCUN arrondi."""
    texte = format(nombre, "f")
    signe = ""
    if texte.startswith("-"):
        signe, texte = "-", texte[1:]
    entier, _, decimales = texte.partition(".")
    if supprimer_zeros:
        decimales = decimales.rstrip("0")
    resultat = _grouper(entier) + ("," + decimales if decimales else "")
    return "0" if resultat == "0" else signe + resultat


def montant(valeur: object) -> str:
    """« 11592000 » → « 11 592 000 » ; « 1809.50 » → « 1 809,50 » ; « 15600000.00 » → « 15 600 000 ».

    Les décimales reçues sont écrites telles quelles (le moteur a déjà arrondi) ; des décimales
    toutes nulles ne s'écrivent pas.
    """
    nombre = _decimal(valeur, "montant")
    entier, _, decimales = format(nombre, "f").partition(".")
    return _ecrire(nombre, supprimer_zeros=not decimales.strip("0"))


def lettres(valeur: object) -> str:
    """« 11592000 » → « onze millions cinq cent quatre-vingt-douze mille francs CFA »."""
    nombre = _decimal(valeur, "lettres")
    try:
        return montant_en_lettres(nombre)
    except MontantInvalide as erreur:
        raise ErreurFiltre(f"lettres : {erreur}") from None


def _lire_date(valeur: object, filtre: str) -> date | datetime:
    if isinstance(valeur, datetime):
        return valeur
    if isinstance(valeur, date):
        return valeur
    if not isinstance(valeur, str) or not valeur.strip():
        raise ErreurFiltre(f"{filtre} : date absente ou illisible ({valeur!r})")
    texte = valeur.strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", texte):
            return date.fromisoformat(texte)
        moment = datetime.fromisoformat(texte.replace("Z", "+00:00"))
    except ValueError:
        raise ErreurFiltre(f"{filtre} : date illisible ({valeur!r}), attendu AAAA-MM-JJ ou AAAA-MM-JJTHH:MM") from None
    # Abidjan est à UTC+0 toute l'année : une heure avec fuseau est ramenée en temps universel.
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone.utc).replace(tzinfo=None)
    return moment


def date_fr(valeur: object) -> str:
    """« 2026-09-01 » → « 01/09/2026 » (une heure éventuelle n'est pas écrite)."""
    return _lire_date(valeur, "date").strftime("%d/%m/%Y")


def dateheure(valeur: object) -> str:
    """« 2026-09-01T08:00 » → « 01/09/2026 à 08h00 ». Une date sans heure est refusée."""
    moment = _lire_date(valeur, "dateheure")
    if not isinstance(moment, datetime):
        raise ErreurFiltre(f"dateheure : heure absente ({valeur!r}), attendu AAAA-MM-JJTHH:MM")
    return moment.strftime("%d/%m/%Y à %Hh%M")


def pct(valeur: object) -> str:
    """« 80 » ou « 80.000 » → « 80 % » ; « 1.5 » → « 1,5 % » (espace insécable avant %)."""
    return _ecrire(_decimal(valeur, "pct"), supprimer_zeros=True) + ESPACE_INSECABLE + "%"


def case(valeur: object) -> str:
    """Vrai → ☒, faux → ☐. Seul un booléen est accepté : écrire la condition dans le modèle,
    ENTRE PARENTHÈSES : {{ (risque.statut == "PROPRIETAIRE") | case }}."""
    if not isinstance(valeur, bool):
        raise ErreurFiltre(
            f"case : vrai ou faux attendu, reçu {valeur!r} ; écrire une condition entre parenthèses, "
            'par exemple {{ (risque.statut == "PROPRIETAIRE") | case }}'
        )
    return CASE_COCHEE if valeur else CASE_VIDE


FILTRES = {
    "montant": montant,
    "lettres": lettres,
    "date": date_fr,
    "dateheure": dateheure,
    "pct": pct,
    "case": case,
}
