// Session 6.0 : numéros de contrat et de certificat (réponses de la Technique, D27 ; H31, H37 fermées).
import { describe, expect, it } from "vitest";

import { avertissementNumeroContrat, numeroCertificatParDefaut, problemesNumeroCertificat, racineCertificat } from "./police";

describe("numéro de contrat : se termine par 00000 après G ou I (avertissement, jamais bloquant)", () => {
  it("aucun avertissement pour G00000 ou I00000, ni pour un champ vide", () => {
    expect(avertissementNumeroContrat("SCD-2026-000088-G00000")).toBeNull();
    expect(avertissementNumeroContrat(" scd-2026-000088-i00000 ")).toBeNull();
    expect(avertissementNumeroContrat("")).toBeNull();
  });

  it("avertit si les 5 derniers chiffres ne sont pas 00000", () => {
    expect(avertissementNumeroContrat("SCD-2026-000088-G00012")).toMatch(/ne se termine pas par 00000 après G ou I .* \(il reste accepté\)/);
  });
});

describe("numéro de certificat dérivé de la police mère", () => {
  it("racine : jusqu'à la lettre G ou I comprise ; null si le numéro ne s'y prête pas", () => {
    expect(racineCertificat("SCD-2026-000088-G00000")).toBe("SCD-2026-000088-G");
    expect(racineCertificat("SCD-2026-000088-I00000")).toBe("SCD-2026-000088-I");
    expect(racineCertificat("ANCIEN-123")).toBeNull();
  });

  it("valeur par défaut : numéro d'ordre complété de zéros sur 5 chiffres", () => {
    expect(numeroCertificatParDefaut("SCD-2026-000088-G00000", 1)).toBe("SCD-2026-000088-G00001");
    expect(numeroCertificatParDefaut("SCD-2026-000088-G00000", 12345)).toBe("SCD-2026-000088-G12345");
    expect(numeroCertificatParDefaut("SCD-2026-000088-G00000", 100000)).toBeNull();
    expect(numeroCertificatParDefaut("ANCIEN-123", 1)).toBeNull();
  });

  it("contrôle : même racine, même lettre, 5 chiffres, jamais 00000", () => {
    const police = "SCD-2026-000088-G00000";
    expect(problemesNumeroCertificat("SCD-2026-000088-G00042", police)).toEqual([]);
    expect(problemesNumeroCertificat("SCD-2026-000088-I00042", police)[0]).toMatch(/doit s'écrire SCD-2026-000088-G suivi/);
    expect(problemesNumeroCertificat("SCD-2026-000089-G00042", police)[0]).toMatch(/doit s'écrire/);
    expect(problemesNumeroCertificat("SCD-2026-000088-G0042", police)[0]).toMatch(/doit s'écrire/);
    expect(problemesNumeroCertificat("SCD-2026-000088-G00000", police)[0]).toMatch(/réservé au contrat/);
    expect(problemesNumeroCertificat("", police)).toEqual(["Le numéro du certificat est obligatoire."]);
  });
});
