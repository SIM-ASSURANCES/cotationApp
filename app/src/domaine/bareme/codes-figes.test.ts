// Codes figés et balises des modèles (B5, ajouts 9 et 10) : règles pures. Les services qui les appliquent sont testés en intégration.
import { describe, expect, it } from "vitest";

import { balisesRisqueDeLAnalyse, balisesSansCle, renommagesInterdits } from "./codes-figes";
import { codesRisqueDuBareme } from "./documents";
import type { Bareme } from "./schema";
import { baremeSecurpro } from "./securpro-fixture";
import { verifierBareme } from "./verification";

const clone = (): Bareme => structuredClone(baremeSecurpro());

describe("renommer un code publié (ajout 10)", () => {
  const origine = baremeSecurpro();

  it("un barème identique ne renomme rien", () => {
    expect(renommagesInterdits(origine, clone())).toEqual([]);
  });
  it("renommer un champ (même type, même libellé) est reconnu et refusé en nommant l'ancien et le nouveau code", () => {
    const etiquete = (b: Bareme): Bareme => ({ ...b, champs: b.champs.map((c) => (c.code === "stocks" ? { ...c, libelle: "Stocks" } : c)) });
    const avant = etiquete(origine);
    const nouveau: Bareme = { ...avant, champs: avant.champs.map((c) => (c.code === "stocks" ? { ...c, code: "stock_marchandises", libelle: " stocks " } : c)) };
    const messages = renommagesInterdits(avant, nouveau);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("« stocks »");
    expect(messages[0]).toContain("« stock_marchandises »");
    expect(messages[0]).toContain("ne peut pas changer");
  });
  it("renommer un champ sans libellé est reconnu aussi : tout le reste est identique, seul le code diffère", () => {
    const b = clone();
    b.champs = b.champs.map((c) => (c.code === "stocks" ? { ...c, code: "stocks_2" } : c));
    expect(renommagesInterdits(origine, b)).toEqual([expect.stringContaining("« stocks_2 »")]);
  });
  it("renommer une liste est reconnu même sans libellé : mêmes valeurs de liste (au moins deux)", () => {
    const b = clone();
    b.champs = b.champs.map((c) => (c.code === "situation" ? { ...c, code: "lieu" } : c));
    expect(renommagesInterdits(origine, b)).toEqual([expect.stringContaining("« situation »")]);
  });
  it("supprimer un champ sans le recréer reste permis (le contrôle des balises protège les modèles)", () => {
    const b = clone();
    b.champs = b.champs.filter((c) => c.code !== "camera");
    expect(renommagesInterdits(origine, b)).toEqual([]);
  });
  it("supprimer un champ et en ajouter un autre, de type ou de nature différente, n'est pas un renommage", () => {
    const b = clone();
    b.champs = [...b.champs.filter((c) => c.code !== "camera"), { code: "alarme", type: "MONTANT", libelle: "Alarme", obligatoire: false }];
    expect(renommagesInterdits(origine, b)).toEqual([]);
  });
  it("ajouter un champ nouveau garde les anciens : rien à dire", () => {
    const b = clone();
    b.champs = [...b.champs, { code: "zone", type: "TEXTE", libelle: "Zone" }];
    expect(renommagesInterdits(origine, b)).toEqual([]);
  });
  it("renommer une valeur intermédiaire (même calcul) est refusé aussi", () => {
    const b = clone();
    b.intermediaires = b.intermediaires.map((i) => (i.code === "contenu" ? { ...i, code: "contenu_total" } : i));
    const messages = renommagesInterdits(origine, b);
    expect(messages).toEqual([expect.stringContaining("valeur intermédiaire « contenu »")]);
  });
  it("une valeur intermédiaire supprimée ou au calcul modifié n'est pas un renommage", () => {
    const b = clone();
    b.intermediaires = b.intermediaires.map((i) => (i.code === "contenu" ? { code: "contenu_total", op: ["SOMME", "stocks", "materiel"] } : i));
    expect(renommagesInterdits(origine, b)).toEqual([]);
  });
});

describe("balises des modèles publiés (ajout 9)", () => {
  const b = baremeSecurpro();

  it("extrait risque.<code> et risque_code.<code> des chemins lus dans un modèle, sans doublon, en ignorant le reste", () => {
    expect(balisesRisqueDeLAnalyse(["risque.stocks", "risque_code.situation", "risque.stocks", "police.numero", "risque", "assures[].nom"])).toEqual([
      { chemin: "risque.stocks", code: "stocks" },
      { chemin: "risque_code.situation", code: "situation" },
    ]);
  });
  it("une balise dont le code est une clé du barème est acceptée, attributs et valeurs intermédiaires compris (mêmes clés que l'émission)", () => {
    const chemins = ["risque.stocks", "risque_code.type_commerce", "risque.type_commerce_classe", "risque.capitaux_totaux"];
    expect(codesRisqueDuBareme(b)).toEqual(expect.arrayContaining(["stocks", "type_commerce_classe", "capitaux_totaux"]));
    expect(balisesSansCle([{ description: "modèle CP X v1", chemins }], b)).toEqual([]);
  });
  it("une balise sans clé est nommée avec le modèle et la balise", () => {
    expect(balisesSansCle([{ description: "modèle CP SECURPRO v3", chemins: ["risque.contenu_inconnu", "risque_code.situation"] }], b)).toEqual(["modèle CP SECURPRO v3 cite risque.contenu_inconnu, absent du barème"]);
  });
  it("chaque modèle est examiné : cotation et certificat aussi", () => {
    const messages = balisesSansCle(
      [
        { description: "modèle CP A v1", chemins: ["risque.zz"] },
        { description: "modèle COTATION B v2", chemins: ["risque.yy", "risque.stocks"] },
        { description: "modèle CERTIFICAT C v1", chemins: ["risque_code.xx"] },
      ],
      b,
    );
    expect(messages).toEqual(["modèle CP A v1 cite risque.zz, absent du barème", "modèle COTATION B v2 cite risque.yy, absent du barème", "modèle CERTIFICAT C v1 cite risque_code.xx, absent du barème"]);
  });
  it("retirer un champ du barème fait apparaître sa balise", () => {
    const sans = clone();
    sans.champs = sans.champs.filter((c) => c.code !== "camera");
    expect(balisesSansCle([{ description: "modèle CP S v1", chemins: ["risque.camera"] }], sans)).toEqual(["modèle CP S v1 cite risque.camera, absent du barème"]);
  });
});

describe("D64 (point 5) : changer le type d'un champ « liste » en « montant » dans une version issue d'un publié", () => {
  const origine = baremeSecurpro();
  /** `vol_caisse_montant` est une liste de montants (50 000, 100 000, 200 000) : elle devient un montant borné. */
  const enMontant = (b: Bareme, code = "vol_caisse_montant"): Bareme => ({
    ...b,
    champs: b.champs.map((c) => (c.code === "vol_caisse_montant" ? { code, type: "MONTANT", bloc: c.bloc, si: c.si, min: "50000", max: "200000", libelle: c.libelle } : c)),
    jeuxEssai: b.jeuxEssai,
  });
  it("même code, autre type, avec bornes : la garde des codes (H167) ne refuse rien", () => {
    expect(renommagesInterdits(origine, enMontant(origine))).toEqual([]);
  });
  it("autre code, autre type : ce n'est pas un renommage (le type diffère), la garde ne refuse rien non plus", () => {
    const b = enMontant(origine, "vol_caisse_saisie");
    expect(b.champs.some((c) => c.code === "vol_caisse_montant")).toBe(false);
    expect(renommagesInterdits(origine, b)).toEqual([]);
  });
  it("le barème reste valide au sens de verifierBareme (le champ n'est la clé d'aucune table)", () => {
    expect(verifierBareme(enMontant(origine)).map((p) => p.code)).not.toContain("CLE_INVALIDE");
  });
});
