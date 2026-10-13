"""Analyse d'un modèle Word au dépôt (CDC §6.7) : FAITS, sans décision.

Le générateur relève ce que contient le .docx : balises et données qu'elles lisent (avec leur
emplacement), erreurs de structure, champs Word, polices, texte des paragraphes. C'est
l'application qui décide (rejet, avertissement) : elle seule connaît le dictionnaire des champs
(CDC §6.3), sa source unique de vérité.

Principe : chaque partie du document (corps, en-têtes, pieds de page, notes) est un gabarit Jinja
distinct pour docxtpl. On relève les balises paragraphe par paragraphe, avec leur emplacement, puis
on les recompose en un « squelette » d'une balise par ligne : une erreur de syntaxe Jinja (numéro
de ligne) se rattache ainsi exactement à la balise fautive et à son emplacement dans le Word.
"""

import io
import re
import zipfile
from dataclasses import dataclass

from docx import Document
from docxtpl import DocxTemplate
from jinja2 import Environment, TemplateSyntaxError, nodes
from lxml import etree
from pydantic import BaseModel

from app.filtres import FILTRES
from app.polices import familles_installees, polices_absentes

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
w = lambda nom: f"{{{W}}}{nom}"  # noqa: E731

# Au-delà, le fichier est refusé avant toute lecture (archive piégée). Audit M6 : un .docx de 0,5 Mo qui se décompressait en 150 Mo
# de XML occupait le générateur 94 s à l'analyse (la limite était de 200 Mo) ; un modèle réel de 15 Mo au plus en fait bien moins de 30.
TAILLE_DECOMPRESSEE_MAX = 30 * 1024 * 1024
# Rapport taille décompressée / taille du fichier au-delà duquel une archive est refusée (XML répétitif fabriqué pour peser lourd).
# Un document Word ordinaire se compresse de 3 à 10 fois ; les images sont déjà compressées. Contrôle appliqué au-dessus de 5 Mo
# décompressés seulement : un petit fichier très compressible ne coûte rien.
TAUX_COMPRESSION_MAX = 100
SEUIL_CONTROLE_TAUX = 5 * 1024 * 1024

# Filtres Jinja utilisables en plus de ceux du module. « default » est exclu : il masquerait une
# donnée absente (un blanc silencieux), ce que la fusion interdit.
FILTRES_JINJA_AUTORISES = frozenset({"upper", "lower", "capitalize", "title", "trim", "length", "join", "first", "last"})
TESTS_AUTORISES = frozenset({"none", "even", "odd"})
FONCTIONS = frozenset({"bloc"})

RE_BALISE = re.compile(r"\{\{.*?\}\}|\{%.*?%\}|\{#.*?#\}")
RE_DELIMITEUR = re.compile(r"\{\{|\}\}|\{%|%\}|\{#|#\}")
# Reste d'XML Word dans une balise (« <w:t> ») : docxtpl n'a pas su la recoller. Un « < » seul
# peut être une comparaison ({% if a < b %}).
RE_XML = re.compile(r"</?\w+:\w+")
GUILLEMETS = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"})


# ------------------------------------------------------------------ Résultat


class Emplacement(BaseModel):
    partie: str  # « corps », « en-tête », « pied de page », « notes de bas de page »
    paragraphe: int  # rang du paragraphe dans la partie, à partir de 1
    tableau: int | None = None  # rang du tableau dans la partie, à partir de 1
    ligne: int | None = None
    colonne: int | None = None
    extrait: str  # texte du paragraphe autour de l'endroit en cause


class Reference(BaseModel):
    chemin: str  # « souscripteur.nom », « assures[].nom_prenoms »
    balise: str
    emplacement: Emplacement


class Probleme(BaseModel):
    code: str
    message: str
    emplacement: Emplacement | None = None


class ChampWord(BaseModel):
    instruction: str
    emplacement: Emplacement


class AppelBloc(BaseModel):
    nom: str
    cle: str | None  # chemin de la donnée qui choisit le sous-modèle (« formules[].code »)
    emplacement: Emplacement


class TexteParagraphe(BaseModel):
    texte: str
    emplacement: Emplacement


class Analyse(BaseModel):
    docx_valide: bool
    erreur: str | None = None
    nombre_balises: int = 0
    references: list[Reference] = []
    problemes: list[Probleme] = []
    champs_word: list[ChampWord] = []
    blocs: list[AppelBloc] = []
    filtres: list[str] = []
    polices: list[str] = []
    polices_absentes: list[str] | None = None
    textes: list[TexteParagraphe] = []


# ------------------------------------------------------------------ Lecture des parties


@dataclass
class Paragraphe:
    element: etree._Element
    texte: str
    emplacement: Emplacement


@dataclass
class BaliseLue:
    texte: str
    paragraphe: Paragraphe


def _dans_repli(element: etree._Element) -> bool:
    """mc:Fallback double le contenu des zones de texte (version VML) : on ne le lit qu'une fois."""
    return any(a.tag == f"{{{MC}}}Fallback" for a in element.iterancestors())


def _plus_proche(element: etree._Element, balise: str) -> etree._Element | None:
    return next(element.iterancestors(w(balise)), None)


def _extrait(texte: str, centre: str | None = None, largeur: int = 40) -> str:
    texte = texte.strip()
    if len(texte) <= 2 * largeur + 20:
        return texte
    debut = texte.find(centre) if centre else 0
    if debut < 0:
        debut = 0
    a, b = max(0, debut - largeur), min(len(texte), debut + len(centre or "") + largeur)
    return ("…" if a > 0 else "") + texte[a:b] + ("…" if b < len(texte) else "")


def _paragraphes(racine: etree._Element, partie: str) -> list[Paragraphe]:
    tableaux = [t for t in racine.iter(w("tbl")) if not _dans_repli(t)]
    rang_tableau = {id(t): i + 1 for i, t in enumerate(tableaux)}
    resultat: list[Paragraphe] = []
    for p in racine.iter(w("p")):
        if _dans_repli(p):
            continue
        # Texte propre au paragraphe : pas celui d'un paragraphe imbriqué (zone de texte).
        texte = "".join(t.text or "" for t in p.iter(w("t")) if _plus_proche(t, "p") is p and not _dans_repli(t))
        tableau = ligne = colonne = None
        cellule = _plus_proche(p, "tc")
        if cellule is not None:
            rang = _plus_proche(cellule, "tr")
            tbl = _plus_proche(cellule, "tbl")
            if rang is not None and tbl is not None:
                tableau = rang_tableau.get(id(tbl))
                lignes = [r for r in tbl.iter(w("tr")) if _plus_proche(r, "tbl") is tbl]
                cellules = [c for c in rang.iter(w("tc")) if _plus_proche(c, "tr") is rang]
                ligne = lignes.index(rang) + 1
                colonne = cellules.index(cellule) + 1
        resultat.append(
            Paragraphe(
                p,
                texte,
                Emplacement(
                    partie=partie,
                    paragraphe=len(resultat) + 1,
                    tableau=tableau,
                    ligne=ligne,
                    colonne=colonne,
                    extrait=_extrait(texte),
                ),
            )
        )
    return resultat


def _parties(archive: zipfile.ZipFile) -> list[tuple[str, etree._Element]]:
    noms = archive.namelist()
    ordre = [("word/document.xml", "corps")]
    ordre += [(n, "en-tête") for n in sorted(noms) if re.fullmatch(r"word/header\d*\.xml", n)]
    ordre += [(n, "pied de page") for n in sorted(noms) if re.fullmatch(r"word/footer\d*\.xml", n)]
    ordre += [(n, "notes de bas de page") for n in noms if n == "word/footnotes.xml"]
    return [(libelle, etree.fromstring(archive.read(nom))) for nom, libelle in ordre if nom in noms]


# ------------------------------------------------------------------ Balises d'un paragraphe


def _balises_du_paragraphe(p: Paragraphe, problemes: list[Probleme]) -> list[BaliseLue]:
    trouvees = [BaliseLue(m.group(0), p) for m in RE_BALISE.finditer(p.texte)]
    reste = RE_BALISE.sub("", p.texte)
    if RE_DELIMITEUR.search(reste):
        problemes.append(
            Probleme(
                code="BALISE_NON_FERMEE",
                message="balise ouverte sans être fermée (ou fermée sans être ouverte) dans ce paragraphe ; "
                "une balise ne peut pas s'étendre sur deux paragraphes",
                emplacement=p.emplacement,
            )
        )
    if trouvees:
        # docxtpl recolle une balise que Word a découpée en plusieurs morceaux de texte ; on vérifie
        # qu'il y parvient ici, en appliquant SON traitement au paragraphe.
        xml = etree.tostring(p.element, encoding="unicode")
        recollees = RE_BALISE.findall(DocxTemplate.patch_xml(None, xml))  # type: ignore[arg-type]
        if len(recollees) != len(trouvees) or any(RE_XML.search(b) for b in recollees):
            problemes.append(
                Probleme(
                    code="BALISE_COUPEE",
                    message="balise coupée par Word en plusieurs morceaux (mise en forme, correction, suivi des "
                    "modifications) : effacez-la et retapez-la d'un seul tenant",
                    emplacement=p.emplacement,
                )
            )
    return trouvees


def _normaliser(texte: str) -> str | None:
    """Balise telle que la voit Jinja après le traitement de docxtpl ; None si elle disparaît."""
    texte = texte.translate(GUILLEMETS)
    if texte.startswith("{#"):
        return None
    # Préfixes de docxtpl, collés au délimiteur : {%tr for … %}, {{p bloc(…) }}.
    texte = re.sub(r"^\{%(?:tr|tc|p|r) ", "{% ", texte)
    texte = re.sub(r"^\{\{(?:tr|tc|p|r) ", "{{ ", texte)
    if re.fullmatch(r"\{%\s*(vm|hm)\s*%\}", texte):
        return None
    special = re.fullmatch(r"\{%\s*(?:colspan|cellbg)\s+(.*?)%\}", texte, flags=re.DOTALL)
    if special:
        return "{{ " + special.group(1) + " }}"
    return texte


# ------------------------------------------------------------------ Structure des blocs


def _verifier_blocs(balises: list[tuple[str, BaliseLue]], problemes: list[Probleme]) -> bool:
    """if/for bien ouverts et fermés, dans l'ordre. Renvoie False s'il manque quelque chose."""
    pile: list[tuple[str, BaliseLue]] = []
    correct = True
    for texte, lue in balises:
        m = re.match(r"\{%-?\s*(\w+)", texte)
        if not m:
            continue
        mot = m.group(1)
        if mot in ("if", "for"):
            pile.append((mot, lue))
        elif mot in ("elif", "else"):
            if not pile:
                problemes.append(Probleme(code="BLOC_MAL_FORME", message=f"« {mot} » sans « if » ou « for » ouvert avant", emplacement=lue.paragraphe.emplacement))
                correct = False
        elif mot in ("endif", "endfor"):
            attendu = mot[3:]
            if not pile:
                problemes.append(Probleme(code="BLOC_MAL_FORME", message=f"« {mot} » sans « {attendu} » ouvert avant", emplacement=lue.paragraphe.emplacement))
                correct = False
            elif pile[-1][0] != attendu:
                ouvert, ou = pile.pop()
                problemes.append(
                    Probleme(
                        code="BLOC_MAL_FORME",
                        message=f"« {mot} » ferme un « {ouvert} » (ouvert au paragraphe {ou.paragraphe.emplacement.paragraphe}) : "
                        "les blocs se ferment dans l'ordre inverse de leur ouverture",
                        emplacement=lue.paragraphe.emplacement,
                    )
                )
                correct = False
            else:
                pile.pop()
    for mot, lue in pile:
        problemes.append(
            Probleme(
                code="BLOC_NON_FERME",
                message=f"bloc « {mot} » jamais fermé : ajoutez {{% end{mot} %}} (ou {{%tr end{mot} %}} dans un tableau)",
                emplacement=lue.paragraphe.emplacement,
            )
        )
        correct = False
    return correct


# ------------------------------------------------------------------ Données lues par les balises


@dataclass
class _Contexte:
    balises: list[BaliseLue]  # ligne n du squelette = balise n - 1
    references: list[Reference]
    problemes: list[Probleme]
    blocs: list[AppelBloc]
    filtres: set[str]
    partie: str

    def emplacement(self, noeud: nodes.Node) -> Emplacement:
        return self.balises[max(0, (noeud.lineno or 1) - 1)].paragraphe.emplacement

    def balise(self, noeud: nodes.Node) -> str:
        return self.balises[max(0, (noeud.lineno or 1) - 1)].texte

    def probleme(self, code: str, message: str, noeud: nodes.Node) -> None:
        self.problemes.append(Probleme(code=code, message=message, emplacement=self.emplacement(noeud)))


LOCAL = object()  # variable sans donnée derrière (loop, variable de boucle sur autre chose qu'une donnée)

OPERATIONS = (nodes.Add, nodes.Sub, nodes.Mul, nodes.Div, nodes.FloorDiv, nodes.Mod, nodes.Pow, nodes.Neg, nodes.Pos)
INSTRUCTIONS_INTERDITES = (
    nodes.Assign, nodes.AssignBlock, nodes.With, nodes.Macro, nodes.CallBlock, nodes.FilterBlock,
    nodes.Include, nodes.Import, nodes.FromImport, nodes.Extends, nodes.Block, nodes.Scope,
    nodes.ExprStmt, nodes.Continue, nodes.Break,
)


CHAINE = (nodes.Name, nodes.Getattr, nodes.Getitem)


def _chemin(noeud: nodes.Expr, portee: dict[str, object], ctx: _Contexte) -> object | str | None:
    """Chemin de donnée d'une expression (« souscripteur.nom »), LOCAL, ou None (pas une donnée).

    Une expression qui n'est pas une donnée (filtre, appel…) au bas de la chaîne est parcourue,
    pour relever les données qu'elle lit elle-même.
    """
    if isinstance(noeud, nodes.Name):
        return portee.get(noeud.name, noeud.name)
    if not isinstance(noeud, (nodes.Getattr, nodes.Getitem)):
        _visiter(noeud, portee, ctx)
        return None
    base = _chemin(noeud.node, portee, ctx)
    if isinstance(noeud, nodes.Getattr):
        nom: str | None = noeud.attr
    elif isinstance(noeud.arg, nodes.Const) and isinstance(noeud.arg.value, str):
        nom = noeud.arg.value
    else:
        nom = None  # indice : assures[0], assures[n]
        _visiter(noeud.arg, portee, ctx)
    if nom is not None and nom.startswith("_"):
        ctx.probleme("ATTRIBUT_INTERDIT", f"nom interdit « {nom} » (commence par « _ »)", noeud)
        return None
    if base is LOCAL or base is None:
        return base
    return f"{base}.{nom}" if nom is not None else f"{base}[]"


def _noter(chemin: object, noeud: nodes.Node, ctx: _Contexte) -> None:
    if isinstance(chemin, str):
        ctx.references.append(Reference(chemin=chemin, balise=ctx.balise(noeud), emplacement=ctx.emplacement(noeud)))


def _visiter(noeud: nodes.Node, portee: dict[str, object], ctx: _Contexte) -> None:
    if isinstance(noeud, INSTRUCTIONS_INTERDITES):
        ctx.probleme(
            "INSTRUCTION_INTERDITE",
            f"instruction « {type(noeud).__name__.lower()} » non autorisée : un modèle n'utilise que "
            "{{ … }}, {% if %} et {% for %}",
            noeud,
        )
        return
    if isinstance(noeud, CHAINE):
        _noter(_chemin(noeud, portee, ctx), noeud, ctx)
        return
    if isinstance(noeud, OPERATIONS):
        ctx.probleme(
            "CALCUL_DANS_LE_MODELE",
            "calcul interdit dans un modèle : les montants viennent tous du moteur de calcul (CDC §5)",
            noeud,
        )
    if isinstance(noeud, nodes.For):
        iterable = _chemin(noeud.iter, portee, ctx)
        _noter(iterable, noeud.iter, ctx)
        interieur = dict(portee, loop=LOCAL)
        if isinstance(noeud.target, nodes.Name):
            interieur[noeud.target.name] = f"{iterable}[]" if isinstance(iterable, str) else LOCAL
        else:
            for nom in noeud.target.find_all(nodes.Name):
                interieur[nom.name] = LOCAL
        for enfant in noeud.body:
            _visiter(enfant, interieur, ctx)
        for enfant in noeud.else_:
            _visiter(enfant, portee, ctx)
        if noeud.test is not None:
            _visiter(noeud.test, interieur, ctx)
        return
    if isinstance(noeud, nodes.Call):
        if isinstance(noeud.node, nodes.Name) and noeud.node.name in FONCTIONS and noeud.node.name not in portee:
            _appel_bloc(noeud, portee, ctx)
        else:
            ctx.probleme("APPEL_INTERDIT", "appel de fonction non autorisé : seule bloc(…) est disponible", noeud)
        return
    if isinstance(noeud, nodes.Filter):
        ctx.filtres.add(noeud.name)
        if noeud.name not in FILTRES and noeud.name not in FILTRES_JINJA_AUTORISES:
            ctx.probleme("FILTRE_INCONNU", f"filtre inconnu « {noeud.name} »", noeud)
        elif noeud.name in FILTRES and (noeud.args or noeud.kwargs):
            ctx.probleme("FILTRE_ARGUMENTS", f"le filtre « {noeud.name} » ne prend pas d'argument", noeud)
        if noeud.name == "case" and isinstance(noeud.node, nodes.Const):
            ctx.probleme(
                "CASE_SANS_PARENTHESES",
                "« case » s'applique ici à une constante : mettez la condition entre parenthèses, "
                'par exemple {{ (risque.statut == "PROPRIETAIRE") | case }}',
                noeud,
            )
    if isinstance(noeud, nodes.Test) and noeud.name not in TESTS_AUTORISES:
        ctx.probleme("TEST_INTERDIT", f"test « is {noeud.name} » non autorisé", noeud)
    for enfant in noeud.iter_child_nodes():
        _visiter(enfant, portee, ctx)


def _appel_bloc(appel: nodes.Call, portee: dict[str, object], ctx: _Contexte) -> None:
    if len(appel.args) != 2 or appel.kwargs or not isinstance(appel.args[0], nodes.Const) or not isinstance(appel.args[0].value, str):
        ctx.probleme("BLOC_MAL_ECRIT", 'bloc() s\'écrit bloc("nom", donnée), par exemple bloc("garanties", formule.code)', appel)
        return
    cle = _chemin(appel.args[1], portee, ctx)
    _noter(cle, appel.args[1], ctx)
    ctx.blocs.append(AppelBloc(nom=appel.args[0].value, cle=cle if isinstance(cle, str) else None, emplacement=ctx.emplacement(appel)))
    if ctx.partie != "corps":
        ctx.probleme("BLOC_HORS_CORPS", "bloc() n'est utilisable que dans le corps du document", appel)
        return
    paragraphe = ctx.balises[max(0, (appel.lineno or 1) - 1)].paragraphe
    if paragraphe.texte.strip() != ctx.balise(appel).strip():
        ctx.probleme("BLOC_NON_ISOLE", "bloc(…) doit être seul dans son paragraphe (il y insère un tableau ou des paragraphes)", appel)


# ------------------------------------------------------------------ Champs Word et polices


def _champs_word(racine: etree._Element, paragraphes: list[Paragraphe]) -> list[ChampWord]:
    par_element = {id(p.element): p for p in paragraphes}

    def emplacement(element: etree._Element) -> Emplacement | None:
        p = element if element.tag == w("p") else _plus_proche(element, "p")
        trouve = par_element.get(id(p)) if p is not None else None
        return trouve.emplacement if trouve else None

    @dataclass
    class Champ:
        morceaux: list[str]
        ou: Emplacement | None
        releve: bool = False

    champs: list[ChampWord] = []

    def relever(champ: Champ) -> None:
        if not champ.releve and champ.ou is not None:
            champs.append(ChampWord(instruction="".join(champ.morceaux).strip(), emplacement=champ.ou))
        champ.releve = True

    # Un champ Word : fldChar « begin », instructions (instrText), « separate », résultat, « end ».
    # Les champs peuvent s'imbriquer : d'où la pile.
    pile: list[Champ] = []
    for element in racine.iter(w("fldChar"), w("instrText"), w("fldSimple")):
        if _dans_repli(element):
            continue
        if element.tag == w("fldSimple"):
            ou = emplacement(element)
            if ou:
                champs.append(ChampWord(instruction=(element.get(w("instr")) or "").strip(), emplacement=ou))
        elif element.tag == w("instrText"):
            if pile and not pile[-1].releve:
                pile[-1].morceaux.append(element.text or "")
        else:
            genre = element.get(w("fldCharType"))
            if genre == "begin":
                pile.append(Champ([], emplacement(element)))
            elif genre == "separate" and pile:
                relever(pile[-1])
            elif genre == "end" and pile:
                relever(pile.pop())
    return champs


def _polices(archive: zipfile.ZipFile, contenus: list[etree._Element]) -> list[str]:
    """Polices réellement utilisées : mise en forme directe, styles employés (et leurs parents),
    styles par défaut, polices du thème qu'ils désignent, symboles (w:sym)."""
    theme: dict[str, str] = {}
    if "word/theme/theme1.xml" in archive.namelist():
        racine_theme = etree.fromstring(archive.read("word/theme/theme1.xml"))
        for genre in ("major", "minor"):
            latin = racine_theme.find(f".//{{{A}}}{genre}Font/{{{A}}}latin")
            if latin is not None and latin.get("typeface"):
                theme[genre] = latin.get("typeface")

    def noms(rfonts: etree._Element) -> set[str]:
        trouves: set[str] = set()
        for attribut in ("ascii", "hAnsi"):
            if rfonts.get(w(attribut)):
                trouves.add(rfonts.get(w(attribut)))
            reference = rfonts.get(w(attribut + "Theme")) or ""
            if reference.startswith(("major", "minor")) and reference[:5] in theme:
                trouves.add(theme[reference[:5]])
        return trouves

    polices: set[str] = set()
    styles_utilises: set[str] = set()
    for racine in contenus:
        for rfonts in racine.iter(w("rFonts")):
            polices |= noms(rfonts)
        for sym in racine.iter(w("sym")):
            if sym.get(w("font")):
                polices.add(sym.get(w("font")))
        for genre in ("pStyle", "rStyle", "tblStyle"):
            styles_utilises |= {e.get(w("val")) for e in racine.iter(w(genre)) if e.get(w("val"))}

    if "word/styles.xml" in archive.namelist():
        styles = etree.fromstring(archive.read("word/styles.xml"))
        defauts = styles.find(w("docDefaults"))
        if defauts is not None:
            for rfonts in defauts.iter(w("rFonts")):
                polices |= noms(rfonts)
        par_id = {s.get(w("styleId")): s for s in styles.iter(w("style"))}
        styles_utilises |= {s.get(w("styleId")) for s in par_id.values() if s.get(w("default")) in ("1", "true")}
        a_voir = list(styles_utilises)
        vus: set[str] = set()
        while a_voir:
            identifiant = a_voir.pop()
            style = par_id.get(identifiant)
            if identifiant in vus or style is None:
                continue
            vus.add(identifiant)
            for rfonts in style.iter(w("rFonts")):
                polices |= noms(rfonts)
            for lien in ("basedOn", "link"):
                parent = style.find(w(lien))
                if parent is not None and parent.get(w("val")):
                    a_voir.append(parent.get(w("val")))
    return sorted(p for p in polices if p.strip())


# ------------------------------------------------------------------ Point d'entrée


def analyser(contenu: bytes) -> Analyse:
    """Analyse un .docx (octets). Ne lève pas d'exception sur un fichier invalide : le dit."""
    try:
        with zipfile.ZipFile(io.BytesIO(contenu)) as archive:
            decompressee = sum(i.file_size for i in archive.infolist())
            if decompressee > TAILLE_DECOMPRESSEE_MAX:
                return Analyse(docx_valide=False, erreur="fichier trop volumineux une fois décompressé")
            if decompressee > SEUIL_CONTROLE_TAUX and decompressee / max(len(contenu), 1) > TAUX_COMPRESSION_MAX:
                return Analyse(docx_valide=False, erreur="fichier suspect : taux de compression anormalement élevé")
        Document(io.BytesIO(contenu))  # refuse ce que Word ne considère pas comme un .docx
        archive = zipfile.ZipFile(io.BytesIO(contenu))
        parties = _parties(archive)
    except Exception:  # noqa: BLE001  (fichier quelconque déposé par un utilisateur)
        return Analyse(docx_valide=False, erreur="le fichier n'est pas un document Word .docx valide")

    analyse = Analyse(docx_valide=True)
    filtres: set[str] = set()
    environnement = Environment()
    for libelle, racine in parties:
        paragraphes = _paragraphes(racine, libelle)
        analyse.textes += [TexteParagraphe(texte=p.texte, emplacement=p.emplacement) for p in paragraphes if p.texte.strip()]
        analyse.champs_word += _champs_word(racine, paragraphes)
        lues = [b for p in paragraphes for b in _balises_du_paragraphe(p, analyse.problemes)]
        analyse.nombre_balises += len(lues)
        retenues = [(n, b) for b in lues if (n := _normaliser(b.texte)) is not None]
        if not retenues or not _verifier_blocs(retenues, analyse.problemes):
            continue
        squelette = "\n".join(n for n, _ in retenues)
        ctx = _Contexte([b for _, b in retenues], analyse.references, analyse.problemes, analyse.blocs, filtres, libelle)
        try:
            arbre = environnement.parse(squelette)
        except TemplateSyntaxError as erreur:
            ctx.problemes.append(
                Probleme(
                    code="SYNTAXE",
                    message=f"balise mal écrite : {erreur.message}",
                    emplacement=ctx.balises[max(0, (erreur.lineno or 1) - 1)].paragraphe.emplacement,
                )
            )
            continue
        _visiter(arbre, {}, ctx)

    analyse.filtres = sorted(filtres)
    analyse.polices = _polices(archive, [r for _, r in parties])
    familles = familles_installees()
    analyse.polices_absentes = None if familles is None else polices_absentes(analyse.polices, familles)
    return analyse
