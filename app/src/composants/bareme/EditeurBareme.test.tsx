// Éditeur de barème (B4, D58) : rendu statique côté serveur, sans navigateur. On vérifie la structure accessible (onglets, panneaux,
// étiquettes), la lecture seule et les contrôles en continu. SECURPRO INVENTÉ. Le comportement (clavier, enregistrement) est vérifié
// au navigateur (compte rendu) et par les tests du domaine et des services.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { baremeVide, schemaBareme } from "@/domaine/bareme";
import { baremeSecurpro } from "@/domaine/bareme/securpro-fixture";

import { EditeurBareme } from "./EditeurBareme";
import { EditeurCondition } from "./EditeurCondition";
import { EditeurOperande } from "./EditeurOperande";
import { PanneauControles } from "./PanneauControles";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const action = async () => ({});
const rejeu = async () => ({ etat: {} });
const controles = async () => ({ controles: { nombreEssais: 0, ecarts: [], balises: [] } });
const publication = { brouillon: { empreinte: "a".repeat(64) }, publie: null, peutBasculer: false, auBareme: false, dateEffet: "01/12/2026" };
const rendre = (element: React.ReactElement) => renderToStaticMarkup(element);
const editeur = (options: { lectureSeule?: boolean; initial?: ReturnType<typeof baremeSecurpro> } = {}) =>
  rendre(
    <EditeurBareme
      versionId={7}
      initial={options.initial ?? baremeSecurpro()}
      lectureSeule={options.lectureSeule ?? false}
      codesFiges={["stocks"]}
      categoriesTaxe={["IARD", "INCENDIE"]}
      publication={publication}
      enregistrer={action}
      rejouer={rejeu}
      controler={controles}
      publier={action}
      basculer={action}
    />,
  );

describe("EditeurBareme : onglets", () => {
  const html = editeur();

  it("huit onglets dans une liste d'onglets, le premier sélectionné, les autres hors de l'ordre de tabulation", () => {
    expect(html).toContain('role="tablist"');
    const onglets = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
    expect(onglets).toHaveLength(8);
    expect(onglets.filter((o) => o.includes('aria-selected="true"'))).toHaveLength(1);
    expect(onglets[0]).toContain('aria-selected="true"');
    expect(onglets[0]).toContain('tabindex="0"');
    for (const o of onglets.slice(1)) expect(o).toContain('tabindex="-1"');
    for (const nom of ["Champs", "Intermédiaires", "Garanties", "Tables", "Sous-jacents", "Jeux d&#x27;essai", "Aperçu Commercial", "Publier"]) expect(html).toContain(nom);
  });

  it("chaque onglet commande un panneau étiqueté par lui ; seul le premier panneau est visible", () => {
    const panneaux = [...html.matchAll(/<div[^>]*role="tabpanel"[^>]*>/g)].map((m) => m[0]);
    expect(panneaux).toHaveLength(8);
    expect(panneaux.filter((p) => !p.includes("hidden"))).toHaveLength(1);
    for (const id of ["champs", "intermediaires", "garanties", "tables", "sous-jacents", "essais", "apercu", "publier"]) {
      expect(html).toContain(`aria-controls="panneau-${id}"`);
      expect(html).toContain(`id="panneau-${id}"`);
      expect(html).toContain(`aria-labelledby="onglet-${id}"`);
    }
  });

  it("plus aucun onglet n'est en lecture seule ni ne renvoie au classeur : tout s'écrit à l'écran", () => {
    expect(html).not.toContain("(lecture)");
    expect(html).not.toContain("jusqu&#x27;à la session B5");
    expect(html).not.toContain("modifiable par le classeur");
  });

  it("la barre : enregistrer (rien à enregistrer) et rejouer les essais ; la publication a son onglet", () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Enregistrer/);
    expect(html).toContain("Rejouer les essais");
    expect(html).toContain("Tout est enregistré.");
  });
});

describe("EditeurBareme : lecture seule (barème publié)", () => {
  const html = editeur({ lectureSeule: true });
  it("explique qu'un publié ne se modifie pas, sans bouton d'enregistrement ni de suppression", () => {
    expect(html).toContain("Barème publié : consultation seule");
    expect(html).not.toMatch(/<button[^>]*>[^<]*Rejouer les essais/);
    expect(html).not.toContain(">Supprimer<");
    expect(html).not.toContain("Ajouter le champ");
  });
  it("les champs sont désactivés", () => {
    expect(html).toMatch(/<input[^>]*disabled=""/);
  });
});

describe("EditeurBareme : contenu des onglets actifs", () => {
  const html = editeur();
  it("liste les champs avec leur code et leur type, et les garanties avec leurs composantes", () => {
    expect(html).toContain("type_commerce");
    expect(html).toContain("Liste déroulante");
    expect(html).toContain("Nouveau champ (libellé)");
    expect(html).toContain("Incendie");
    expect(html).toContain("Taxe et accessoires du produit");
    expect(html).toContain("2 composantes");
    expect(html).toContain("capitaux_totaux");
  });
  it("un champ publié a son code verrouillé avec l'explication", () => {
    expect(html).toContain("figure dans un barème publié : son code ne change plus");
  });
  it("les champs sont des champs du design system (étiquette liée), les actions des boutons à libellé écrit", () => {
    expect(html).toMatch(/<label for="[^"]+"[^>]*>Libellé<\/label>/);
    expect(html).toContain('aria-label="Monter');
    expect(html).toContain('aria-label="Supprimer');
  });
});

describe("EditeurBareme : onglets de la session B5 (tables, sous-jacents, essais, aperçu, publication)", () => {
  const html = editeur();

  it("Tables : création guidée par les champs, cases comptées, « Remplir avec 1 », collage d'une plage, suppression", () => {
    expect(html).toContain("Nouvelle table (nom)");
    expect(html).toContain("Champ lu (lignes)");
    expect(html).toContain("Second champ lu (colonnes, facultatif)");
    expect(html).toContain("Une table lit un ou deux champs au plus");
    expect(html).toContain("8 / 8 cases remplies"); // la table « limites » de SECURPRO : 4 classes × 2 situations
    expect(html).toContain("Remplir les cases vides avec 1");
    expect(html).toContain("Coller une plage copiée depuis un tableur");
    expect(html).toContain('aria-label="Supprimer la table limites"');
    // Chaque case est un champ étiqueté par sa ligne et sa colonne (accessible au clavier et aux lecteurs d'écran).
    expect(html).toMatch(/<input[^>]*aria-label="gardien : Oui × extincteurs : Non"[^>]*inputMode="decimal"|<input[^>]*inputMode="decimal"[^>]*aria-label="gardien : Oui × extincteurs : Non"/);
    expect(html).toContain('<th scope="row"');
  });

  it("Sous-jacents : les cinq effets proposés, l'ordre de calcul affiché, E3 réglé dans les assiettes", () => {
    for (const e of ["E1 — Choisit le taux dans une table", "E2 — Coefficient", "E3 — Donne l&#x27;assiette", "E4 — Refuse le risque, avec un message", "E5 — Minimum, plafond ou ajout"]) expect(html).toContain(e);
    expect(html).toContain("Ordre de calcul (fixe, le même pour tous les produits)");
    expect(html).toContain("Cet ordre n&#x27;est pas modifiable");
    expect(html).toContain("E3 — Assiettes");
    expect(html).toContain("Ajouter le sous-jacent");
    expect(html).toContain("Sous-jacents du barème (E1, E2, E4, E5)");
  });

  it("Jeux d'essai : la saisie par le formulaire généré, l'attendu à taper, jamais calculé", () => {
    expect(html).toContain("1. Saisie (comme le Commercial)");
    expect(html).toContain("2. Résultat attendu (à taper, jamais calculé par l&#x27;application)");
    expect(html).toContain("TTC total attendu");
    expect(html).toContain("Prime nette attendu");
    expect(html).toContain("Ajouter une ligne attendue pour la garantie");
    expect(html).toContain("Rejouer les essais");
    expect(html).toContain("Nouveau jeu d&#x27;essai (nom du cas)");
  });

  it("Aperçu Commercial : le formulaire généré, avec ce qui s'affiche selon les réponses", () => {
    expect(html).toContain("Ce qui s&#x27;affiche selon les réponses");
    expect(html).toContain("affiché si « occupation » vaut « LOCATAIRE »");
    expect(html).toContain("vos réponses ne sont pas conservées");
  });

  it("Publier : empreinte du brouillon, rejeu de tous les essais, motif obligatoire", () => {
    expect(html).toContain("Rejouer tous les essais et contrôler");
    expect(html).toContain("Motif de la publication (obligatoire)");
    expect(html).toContain("a".repeat(64));
    expect(html).toContain("Publier le barème");
  });

  it("barème publié : consultation seule, mais l'onglet Publier dit l'empreinte, le motif et propose la bascule", () => {
    const rendu = rendre(
      <EditeurBareme
        versionId={7}
        initial={baremeSecurpro()}
        lectureSeule
        codesFiges={[]}
        categoriesTaxe={["IARD"]}
        publication={{ brouillon: null, publie: { empreinte: "c".repeat(64), publieLe: "30/10/2026", publiePar: "technique", motif: "Barème de test" }, peutBasculer: true, auBareme: false, dateEffet: "01/12/2026" }}
        enregistrer={action}
        rejouer={rejeu}
        controler={controles}
        publier={action}
        basculer={action}
      />,
    );
    expect(rendu).toContain("Barème publié : il ne se modifie plus");
    expect(rendu).toContain("c".repeat(64));
    expect(rendu).toContain("Motif : Barème de test");
    expect(rendu).toContain("Basculer la version au barème");
    expect(rendu).not.toContain("Publier le barème");
    expect(rendu).not.toContain("Ajouter le sous-jacent");
    expect(rendu).not.toContain("Créer la table");
  });
});

describe("PanneauControles", () => {
  it("rien à signaler : message de succès", () => {
    const html = rendre(<PanneauControles problemes={[]} structure={[]} />);
    expect(html).toContain("Aucun problème");
  });
  it("un problème : le code et le message de verifierBareme, la publication est bloquée (rouge)", () => {
    const html = rendre(<PanneauControles problemes={[{ code: "TABLE_INCOMPLETE", message: "Table « limites » : la ligne « 1|MARCHE » manque." }]} structure={[]} />);
    expect(html).toContain("1 problème : la publication est bloquée");
    expect(html).toContain("[TABLE_INCOMPLETE]");
    expect(html).toContain("la ligne « 1|MARCHE » manque.");
    expect(html).toContain("text-danger");
  });
  it("un barème vide annonce l'absence de jeu d'essai (même exigence qu'à la publication)", () => {
    const html = editeur({ initial: schemaBareme.parse(baremeVide("IARD")) as ReturnType<typeof baremeSecurpro> });
    expect(html).toContain("[AUCUN_ESSAI]");
    expect(html).toContain("la publication est bloquée");
  });
});

describe("EditeurOperande : les sept façons de donner un montant, par listes", () => {
  const b = baremeSecurpro();
  const rendreOp = (op: Parameters<typeof EditeurOperande>[0]["op"], niveau = 0) => rendre(<EditeurOperande b={b} op={op} onChange={() => {}} etiquette="Assiette" intermediaires={["capital_immo", "contenu"]} niveau={niveau} />);

  it("propose champ, valeur intermédiaire, nombre fixe et les cinq opérations", () => {
    const html = rendreOp("stocks");
    for (const libelle of ["Un champ du formulaire", "Une valeur intermédiaire", "Un nombre fixe", "La somme de", "Le produit de deux valeurs", "Un pourcentage, plafonné", "Une valeur lue dans une table", "La première valeur renseignée parmi"]) {
      expect(html).toContain(libelle);
    }
  });
  it("seuls les champs numériques sont proposés pour un champ", () => {
    const html = rendreOp("stocks");
    expect(html).toContain(">stocks<");
    expect(html).not.toContain(">type_commerce<");
    expect(html).not.toContain(">gardien<");
  });
  it("une opération de la racine montre ses opérandes étiquetés (valeur / pourcentage / plafond)", () => {
    const html = rendreOp(["PCT_PLAFOND", "contenu", "15", "2000000"]);
    expect(html).toContain("Valeur de base — genre");
    expect(html).toContain("Pourcentage (%) — genre");
    expect(html).toContain("Plafond — genre");
  });
  it("au troisième niveau, les opérations sont désactivées avec la raison (profondeur 2 au plus)", () => {
    const html = rendreOp("stocks", 2);
    expect(html).toMatch(/<option value="SOMME" disabled="">[^<]*2 niveaux au plus/);
    expect(html).not.toMatch(/<option value="CHAMP"[^>]*disabled/);
  });
  it("une opération inconnue du document reste visible avec un message, jamais effacée", () => {
    const html = rendreOp(["BIDON", "a", "b"] as never);
    expect(html).toContain("Opération inconnue");
  });
});

describe("EditeurCondition : des listes, jamais de texte libre", () => {
  const b = baremeSecurpro();
  const rendreCond = (valeur: Parameters<typeof EditeurCondition>[0]["valeur"], sauf?: string) => rendre(<EditeurCondition b={b} valeur={valeur} onChange={() => {}} etiquette="Afficher ce champ" sauf={sauf} />);

  it("sans condition : un seul choix, « Toujours »", () => {
    const html = rendreCond(undefined, "loyer_mensuel");
    expect(html).toContain("Toujours");
    expect(html).not.toContain("<input");
  });
  it("un champ et une valeur : listes des champs liste ou oui/non, puis des valeurs", () => {
    const html = rendreCond({ champ: "occupation", egal: "LOCATAIRE" }, "loyer_mensuel");
    expect(html).toContain(">occupation<");
    expect(html).not.toContain(">stocks<"); // un montant n'est pas comparable
    expect(html).toContain("LOCATAIRE");
    expect(html).toContain("PROPRIETAIRE");
    expect(html).not.toContain("<input");
  });
  it("un oui / non propose Oui et Non", () => {
    const html = rendreCond({ champ: "gardien", egal: "OUI" }, "loyer_mensuel");
    expect(html).toContain(">Oui (OUI)<");
    expect(html).toContain(">Non (NON)<");
  });
  it("le champ ne se lit pas lui-même", () => {
    expect(rendreCond({ champ: "occupation", egal: "LOCATAIRE" }, "occupation")).toContain("introuvable ou non comparable");
  });
  it("une garantie souscrite : liste des garanties et composantes", () => {
    const html = rendreCond({ souscrit: "vol.caisse" }, "dde_montant");
    expect(html).toContain("Garantie « Incendie »");
    expect(html).toContain("Composante « Vol — caisse »");
  });
});
