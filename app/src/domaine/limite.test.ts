import { describe, expect, it } from "vitest";

import { LimiteRequetes } from "./limite";

describe("limite de requêtes par adresse", () => {
  it("refuse au-delà du maximum dans la fenêtre, puis accepte de nouveau", () => {
    const limite = new LimiteRequetes(3, 60_000);
    expect([0, 1, 2, 3].map((i) => limite.accepter("10.0.0.1", 1000 + i))).toEqual([true, true, true, false]);
    expect(limite.accepter("10.0.0.2", 1005)).toBe(true); // une autre adresse n'est pas touchée
    expect(limite.accepter("10.0.0.1", 61_001)).toBe(true); // fenêtre écoulée
  });

  it("saturee() lit l'état sans enregistrer d'appel", () => {
    const limite = new LimiteRequetes(2, 60_000);
    expect(limite.saturee("a", 1000)).toBe(false);
    expect(limite.saturee("a", 1000)).toBe(false); // lire ne consomme rien
    limite.accepter("a", 1000);
    expect(limite.saturee("a", 1001)).toBe(false);
    limite.accepter("a", 1002);
    expect(limite.saturee("a", 1003)).toBe(true);
    expect(limite.saturee("b", 1003)).toBe(false);
    expect(limite.saturee("a", 61_003)).toBe(false); // fenêtre écoulée
  });
});
