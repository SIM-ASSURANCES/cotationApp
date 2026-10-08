import { describe, expect, it } from "vitest";

import { ErreurCalcul } from "../calcul/montant";
import { libelleDuree } from "./duree";

describe("police.duree_libelle (H39) : années, mois civils ou jours", () => {
  it.each([
    ["année civile pleine", "2026-01-01", "2026-12-31", "1 an"],
    ["un an d'une date quelconque à la veille de la suivante", "2026-07-22", "2027-07-21", "1 an"],
    ["année bissextile (366 jours) = 1 an", "2028-01-01", "2028-12-31", "1 an"],
    ["deux ans", "2026-01-01", "2027-12-31", "2 ans"],
    ["six mois", "2026-07-22", "2027-01-21", "6 mois"],
    ["un mois", "2026-01-01", "2026-01-31", "1 mois"],
    ["un mois de février", "2026-02-01", "2026-02-28", "1 mois"],
    ["trois mois", "2026-10-08", "2027-01-07", "3 mois"],
    ["dix-huit mois : ni année pleine ni moins d'un an, on garde les mois", "2026-01-01", "2027-06-30", "18 mois"],
    ["un quantième du 31 qui existe dans le mois d'arrivée", "2026-01-31", "2026-03-30", "2 mois"],
  ])("%s : %s → %s = « %s »", (_nom, effet, echeance, attendu) => {
    expect(libelleDuree(effet, echeance)).toBe(attendu);
  });

  it.each([
    ["163 jours (T3)", "2026-07-22", "2026-12-31", "163 jours"],
    ["365 jours qui ne tombent pas sur un quantième : du 2 janvier au 31 décembre", "2026-01-02", "2026-12-31", "364 jours"],
    ["le 31 janvier + 1 mois n'existe pas en février : on compte les jours", "2026-01-31", "2026-02-27", "28 jours"],
    ["un mois « à cheval » sans quantième identique", "2026-01-15", "2026-02-20", "37 jours"],
    ["un seul jour", "2026-05-05", "2026-05-05", "1 jour"],
    ["deux jours", "2026-05-05", "2026-05-06", "2 jours"],
  ])("%s : %s → %s = « %s »", (_nom, effet, echeance, attendu) => {
    expect(libelleDuree(effet, echeance)).toBe(attendu);
  });

  it("refuse une échéance avant l'effet et une date impossible", () => {
    expect(() => libelleDuree("2026-12-31", "2026-01-01")).toThrow(ErreurCalcul);
    expect(() => libelleDuree("2026-02-30", "2026-12-31")).toThrow(ErreurCalcul);
  });
});
