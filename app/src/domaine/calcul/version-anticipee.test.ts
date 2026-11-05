import { describe, expect, it } from "vitest";

import { dateDeVersionAnticipee, enVigueur } from "./parametrage";

// D65, décision 3 : un produit se cote dès sa création, même si sa première version commence plus tard.
describe("dateDeVersionAnticipee", () => {
  it("garde le jour donné quand une version est déjà en vigueur", () => {
    expect(dateDeVersionAnticipee(["2026-01-01", "2027-01-01"], "2026-11-05")).toBe("2026-11-05");
  });
  it("prend la date de la première version quand toutes commencent plus tard", () => {
    expect(dateDeVersionAnticipee(["2027-03-01", "2027-01-01"], "2026-11-05")).toBe("2027-01-01");
  });
  it("la version de cette date est alors trouvée par enVigueur", () => {
    const versions = [{ dateEffet: "2027-03-01" }, { dateEffet: "2027-01-01" }];
    const jour = dateDeVersionAnticipee(versions.map((v) => v.dateEffet), "2026-11-05");
    expect(enVigueur(versions, "2026-11-05")).toBeNull();
    expect(enVigueur(versions, jour)?.dateEffet).toBe("2027-01-01");
  });
  it("sans aucune version, rend le jour donné (l'erreur habituelle s'applique)", () => {
    expect(dateDeVersionAnticipee([], "2026-11-05")).toBe("2026-11-05");
  });
});
