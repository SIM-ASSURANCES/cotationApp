import { describe, expect, it } from "vitest";

import { CacheTemporaire } from "./cache-temporaire";

describe("mémoire à durée de vie courte (audit M7)", () => {
  it("calcule une fois dans la minute, recalcule après", async () => {
    const cache = new CacheTemporaire<number>(60_000);
    let appels = 0;
    const calcul = async () => ++appels;
    expect(await cache.obtenir("a", 0, calcul)).toBe(1);
    expect(await cache.obtenir("a", 59_999, calcul)).toBe(1);
    expect(appels).toBe(1);
    expect(await cache.obtenir("a", 60_000, calcul)).toBe(2);
    expect(appels).toBe(2);
  });

  it("deux clés ne se mélangent jamais", async () => {
    const cache = new CacheTemporaire<string>(60_000);
    expect(await cache.obtenir("commercial|com1", 0, async () => "chiffres de com1")).toBe("chiffres de com1");
    expect(await cache.obtenir("commercial|com2", 1, async () => "chiffres de com2")).toBe("chiffres de com2");
    expect(await cache.obtenir("commercial|com1", 2, async () => "recalculé")).toBe("chiffres de com1");
  });

  it("deux appels simultanés partagent le même calcul", async () => {
    const cache = new CacheTemporaire<number>(60_000);
    let appels = 0;
    const calcul = async () => {
      appels++;
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    };
    expect(await Promise.all([cache.obtenir("a", 0, calcul), cache.obtenir("a", 1, calcul), cache.obtenir("a", 2, calcul)])).toEqual([42, 42, 42]);
    expect(appels).toBe(1);
  });

  it("un calcul qui échoue n'est pas gardé : l'appel suivant réessaie", async () => {
    const cache = new CacheTemporaire<number>(60_000);
    await expect(cache.obtenir("a", 0, async () => Promise.reject(new Error("base indisponible")))).rejects.toThrow("base indisponible");
    expect(await cache.obtenir("a", 1, async () => 7)).toBe(7);
  });

  it("le nombre de clés est borné : la plus ancienne est oubliée", async () => {
    const cache = new CacheTemporaire<string>(60_000, 2);
    await cache.obtenir("a", 0, async () => "a1");
    await cache.obtenir("b", 0, async () => "b1");
    await cache.obtenir("c", 0, async () => "c1");
    expect(await cache.obtenir("a", 1, async () => "a2")).toBe("a2"); // oubliée, recalculée
    expect(await cache.obtenir("c", 1, async () => "c2")).toBe("c1"); // encore là
  });

  it("vider() oublie tout", async () => {
    const cache = new CacheTemporaire<number>(60_000);
    await cache.obtenir("a", 0, async () => 1);
    cache.vider();
    expect(await cache.obtenir("a", 1, async () => 2)).toBe(2);
  });
});
