// Tests d'intégration : vraie base PostgreSQL de test (npm run test:integration).
import { describe, expect, it } from "vitest";

import { obtenirPrisma } from "./prisma";

describe("index de l'audit (m8)", () => {
  it("les sept index existent dans la base migrée", async () => {
    const lignes = await obtenirPrisma().$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const noms = lignes.map((l) => l.indexname);
    for (const attendu of [
      "cotations_auteur_identifiant_idx",
      "cotations_cree_le_idx",
      "cotations_emise_le_idx",
      "cotations_acceptee_le_idx",
      "documents_emis_cotation_id_idx",
      "factures_date_emission_idx",
      "paiements_date_idx",
    ]) {
      expect(noms).toContain(attendu);
    }
  });
});
