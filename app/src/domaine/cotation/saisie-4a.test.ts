// Session 4a : compléments du souscripteur, bénéficiaires, contacts d'urgence, adhérents d'un contrat de groupe.
import { describe, expect, it } from "vitest";

import { dateAdhesion, estContratDeGroupe, incorporer, problemesDateChangement, retirer, type VersionAdherents } from "./adherents";
import {
  complementsVides,
  problemesBeneficiaires,
  problemesContactsUrgence,
  problemesSouscripteur,
  type Assure,
  type Beneficiaire,
  type Souscripteur,
} from "./saisie";

const base: Souscripteur = { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Awa", raison_sociale: "", telephone: "", email: "", adresse: "" };
const benef = (ordre: number, quote: string, nom = `Bénéficiaire ${ordre}`): Beneficiaire => ({ ordre, nom_prenoms: nom, lien: "Enfant", contact: "0700000000", quote_part: quote });
const assure = (ordre: number, formule = "SOLO"): Assure => ({ ordre, nom_prenoms: `Adhérent ${ordre}`, date_naissance: "1990-01-01", sexe: "F", lien: "Salarié", formule });

describe("compléments du souscripteur (dictionnaire §6.3.2)", () => {
  it("un souscripteur sans compléments (cotation d'avant la 4a) reste valide : ils sont facultatifs à la saisie", () => {
    expect(problemesSouscripteur(base, "2026-10-08")).toEqual([]);
    expect(problemesSouscripteur({ ...base, ...complementsVides() }, "2026-10-08")).toEqual([]);
  });

  it("contrôle la date de naissance, le nombre d'enfants et le groupe sanguin", () => {
    expect(problemesSouscripteur({ ...base, date_naissance: "1985-04-12", nb_enfants: 2, groupe_sanguin: "O+" }, "2026-10-08")).toEqual([]);
    expect(problemesSouscripteur({ ...base, date_naissance: "2999-01-01" }, "2026-10-08").join(" ")).toContain("date de naissance");
    expect(problemesSouscripteur({ ...base, date_naissance: "1985-13-45" }, "2026-10-08").join(" ")).toContain("date de naissance");
    expect(problemesSouscripteur({ ...base, nb_enfants: -1 }).join(" ")).toContain("nombre d'enfants");
    expect(problemesSouscripteur({ ...base, nb_enfants: 2.5 }).join(" ")).toContain("nombre d'enfants");
    expect(problemesSouscripteur({ ...base, groupe_sanguin: "C+" }).join(" ")).toContain("groupe sanguin");
  });
});

describe("bénéficiaires : la somme des quotes-parts fait 100 %", () => {
  it("accepte une liste vide (champ saisi vide), un seul bénéficiaire à 100 %, et 3 bénéficiaires 50/30/20", () => {
    expect(problemesBeneficiaires([])).toEqual([]);
    expect(problemesBeneficiaires([benef(1, "100")])).toEqual([]);
    expect(problemesBeneficiaires([benef(1, "50"), benef(2, "30"), benef(3, "20")])).toEqual([]);
  });

  it("calcule en décimal exact : 33,33 + 33,33 + 33,34 = 100, mais 33,33 × 3 = 99,99 est refusé", () => {
    expect(problemesBeneficiaires([benef(1, "33,33"), benef(2, "33.33"), benef(3, "33,34")])).toEqual([]);
    const p = problemesBeneficiaires([benef(1, "33,33"), benef(2, "33,33"), benef(3, "33,33")]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("99,99 %");
  });

  it("refuse une somme différente de 100, une quote-part vide, nulle, supérieure à 100 ou illisible, et un nom vide", () => {
    expect(problemesBeneficiaires([benef(1, "50"), benef(2, "40")]).join(" ")).toContain("100 %");
    expect(problemesBeneficiaires([benef(1, "60"), benef(2, "60")]).join(" ")).toContain("120 %");
    expect(problemesBeneficiaires([benef(1, "")]).join(" ")).toContain("quote-part obligatoire");
    expect(problemesBeneficiaires([benef(1, "0"), benef(2, "100")]).join(" ")).toContain("supérieure à 0");
    expect(problemesBeneficiaires([benef(1, "150")]).join(" ")).toContain("au plus 100");
    expect(problemesBeneficiaires([benef(1, "1.234,5")]).join(" ")).toContain("quote-part illisible");
    expect(problemesBeneficiaires([benef(1, "100", " ")]).join(" ")).toContain("nom et prénoms");
  });
});

describe("contacts d'urgence", () => {
  it("exige un nom et un contact pour chaque ligne saisie", () => {
    expect(problemesContactsUrgence([])).toEqual([]);
    expect(problemesContactsUrgence([{ nom_prenoms: "KOUADIO Paul", contact: "0700000001" }])).toEqual([]);
    expect(problemesContactsUrgence([{ nom_prenoms: "KOUADIO Paul", contact: "" }]).join(" ")).toContain("contact");
    expect(problemesContactsUrgence([{ nom_prenoms: "", contact: "0700000001" }]).join(" ")).toContain("nom et prénoms");
  });
});

describe("adhérents d'un contrat de groupe (§10.2)", () => {
  it("seuls GROUPE et GROUPE_OUVERT ont des adhérents", () => {
    expect(estContratDeGroupe("GROUPE")).toBe(true);
    expect(estContratDeGroupe("GROUPE_OUVERT")).toBe(true);
    expect(["INDIVIDUEL", "FAMILLE", null].map(estContratDeGroupe)).toEqual([false, false, false]);
  });

  it("l'incorporation numérote à la suite du plus grand numéro jamais attribué, retirés compris", () => {
    const r = incorporer([assure(1), assure(3)], [1, 2, 3], [{ nom_prenoms: "Nouveau", date_naissance: "1992-02-02", sexe: "M", lien: "Salarié", formule: "SOLO" }], ["SOLO"], "2026-10-08");

    expect("liste" in r && r.liste.map((a) => a.ordre)).toEqual([1, 3, 4]);
    expect("ordres" in r && r.ordres).toEqual([4]);
  });

  it("refuse une incorporation vide, une formule inconnue et un nom vide", () => {
    expect(incorporer([assure(1)], [1], [], ["SOLO"], "2026-10-08")).toEqual({ problemes: ["Indiquez au moins un adhérent à incorporer."] });
    const inconnue = incorporer([assure(1)], [1], [{ nom_prenoms: "X", date_naissance: "", sexe: "", lien: "", formule: "NOPE" }], ["SOLO"], "2026-10-08");
    expect("problemes" in inconnue && inconnue.problemes.join(" ")).toContain("inconnue");
    const sansNom = incorporer([assure(1)], [1], [{ nom_prenoms: " ", date_naissance: "", sexe: "", lien: "", formule: "SOLO" }], ["SOLO"], "2026-10-08");
    expect("problemes" in sansNom && sansNom.problemes.join(" ")).toContain("nom et prénoms");
  });

  it("le retrait vise des adhérents existants et laisse au moins un adhérent", () => {
    const ok = retirer([assure(1), assure(2), assure(3)], [2, 2]);
    expect("liste" in ok && ok.liste.map((a) => a.ordre)).toEqual([1, 3]);
    expect(retirer([assure(1)], [9])).toEqual({ problemes: ["Adhérent(s) introuvable(s) dans la liste courante : n° 9."] });
    expect(retirer([assure(1)], [1])).toHaveProperty("problemes");
    expect(retirer([assure(1)], [])).toHaveProperty("problemes");
  });

  it("la date d'un changement reste dans la période de la police et ne remonte pas dans le temps", () => {
    const police = { dateEffet: "2026-01-01", dateEcheance: "2026-12-31" };

    expect(problemesDateChangement("2026-06-01", police, "2026-01-01")).toEqual([]);
    expect(problemesDateChangement("2025-12-31", police, "2026-01-01")).toHaveLength(2);
    expect(problemesDateChangement("2027-01-01", police, "2026-01-01")).toHaveLength(1);
    expect(problemesDateChangement("2026-03-01", police, "2026-06-01")[0]).toContain("dernier changement");
    expect(problemesDateChangement("2026-02-30", police, "2026-01-01")[0]).toContain("invalide");
  });

  it("la date d'adhésion est celle de la version qui a fait entrer l'adhérent (date d'effet de la police pour la liste initiale)", () => {
    const versions: VersionAdherents[] = [
      { numero: 1, motif: "INITIALE", dateEffet: "2026-01-01", adherents: [assure(1), assure(2)], concernes: [] },
      { numero: 2, motif: "INCORPORATION", dateEffet: "2026-06-15", adherents: [assure(1), assure(2), assure(3)], concernes: [3] },
      { numero: 3, motif: "RETRAIT", dateEffet: "2026-09-01", adherents: [assure(1), assure(3)], concernes: [2] },
    ];

    expect(dateAdhesion(versions, 1, "2026-01-01")).toBe("2026-01-01");
    expect(dateAdhesion(versions, 3, "2026-01-01")).toBe("2026-06-15");
    expect(dateAdhesion(versions, 9, "2026-01-01")).toBeNull();
  });
});
