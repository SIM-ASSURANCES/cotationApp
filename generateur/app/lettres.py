"""Montant en lettres, en francs CFA (CDC §8.6)."""

from decimal import Decimal, InvalidOperation

from num2words import num2words


class MontantInvalide(ValueError):
    """Montant illisible ou qui n'est pas un nombre entier de francs."""


def montant_en_lettres(valeur: Decimal | str) -> str:
    """Écrit un montant entier de francs CFA en toutes lettres.

    Les montants sont des Decimal ou des textes, jamais des float. Un montant avec des
    centimes est REFUSÉ au lieu d'être tronqué : le franc CFA n'a pas de subdivision, et un
    montant arrondi en amont ne doit jamais arriver ici avec des décimales.

    >>> montant_en_lettres("11592000")
    'onze millions cinq cent quatre-vingt-douze mille francs CFA'
    """
    try:
        montant = Decimal(valeur) if isinstance(valeur, str) else valeur
    except InvalidOperation:
        raise MontantInvalide("montant illisible") from None
    if not isinstance(montant, Decimal) or not montant.is_finite():
        raise MontantInvalide("montant illisible")
    if montant != montant.to_integral_value():
        raise MontantInvalide("le montant doit être un nombre entier de francs")

    entier = int(montant)
    absolu = abs(entier)
    texte = num2words(absolu, lang="fr")
    # « un million DE francs », « quinze milliards DE francs » : « de » après un million ou un
    # milliard ROND (rien après). Pas pour « quinze millions six cent mille francs ».
    if absolu >= 1_000_000 and absolu % 1_000_000 == 0:
        texte += " de"
    unite = "franc CFA" if absolu in (0, 1) else "francs CFA"
    return f"{'moins ' if entier < 0 else ''}{texte} {unite}"
