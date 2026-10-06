import { describe, expect, it } from "vitest";

import { LimiteRequetes } from "./limite";

describe("limite de requêtes par adresse", () => {
  it("refuse au-delà du maximum dans la fenêtre, puis accepte de nouveau", () => {
    const limite = new LimiteRequetes(3, 60_000);
    expect([0, 1, 2, 3].map((i) => limite.accepter("10.0.0.1", 1000 + i))).toEqual([true, true, true, false]);
    expect(limite.accepter("10.0.0.2", 1005)).toBe(true); // une autre adresse n'est pas touchée
    expect(limite.accepter("10.0.0.1", 61_001)).toBe(true); // fenêtre écoulée
  });
});
