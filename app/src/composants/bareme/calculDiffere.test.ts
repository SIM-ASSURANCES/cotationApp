// Calcul différé du formulaire de cotation (D62) : anti-rebond, une seule requête en vol, réponse périmée ignorée. Minuteurs simulés,
// aucun serveur : `executer` est un faux dont on maîtrise la réponse.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { creerCalculDiffere, DELAI_CALCUL_MS } from "./calculDiffere";

/** Un faux serveur : chaque appel crée une promesse qu'on résout à la main, dans l'ordre voulu. */
function banc() {
  const appels: { saisie: number; repondre: (v: string) => void; echouer: (e: Error) => void }[] = [];
  const resultats: string[] = [];
  const erreurs: unknown[] = [];
  const attentes: boolean[] = [];
  let saisie = 0; // la « saisie courante » lue au départ de la requête
  const calcul = creerCalculDiffere<string>({
    delaiMs: DELAI_CALCUL_MS,
    executer: () =>
      new Promise<string>((resolve, reject) => {
        appels.push({ saisie, repondre: resolve, echouer: reject });
      }),
    surResultat: (r) => resultats.push(r),
    surErreur: (e) => erreurs.push(e),
    surAttente: (a) => attentes.push(a),
  });
  return { calcul, appels, resultats, erreurs, attentes, modifier: () => ++saisie };
}
const laisserPasser = () => vi.advanceTimersByTimeAsync(0);

describe("calcul différé", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("le délai est d'environ 600 ms", () => {
    expect(DELAI_CALCUL_MS).toBe(600);
  });

  it("anti-rebond : rien ne part avant la fin du délai, et chaque frappe repousse le départ", async () => {
    const b = banc();
    b.calcul.planifier();
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS - 1);
    expect(b.appels).toHaveLength(0);
    b.calcul.planifier(); // nouvelle frappe : le décompte repart de zéro
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS - 1);
    expect(b.appels).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.appels).toHaveLength(1); // une seule requête pour deux modifications
  });

  it("la saisie envoyée est celle du moment du départ, pas celle de la première frappe", async () => {
    const b = banc();
    b.modifier();
    b.calcul.planifier();
    await vi.advanceTimersByTimeAsync(300);
    b.modifier();
    b.calcul.planifier();
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS);
    expect(b.appels.map((a) => a.saisie)).toEqual([2]);
  });

  it("le résultat est livré, puis l'attente retombe", async () => {
    const b = banc();
    b.calcul.planifier();
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS);
    expect(b.attentes.at(-1)).toBe(true);
    b.appels[0].repondre("139 420");
    await laisserPasser();
    expect(b.resultats).toEqual(["139 420"]);
    expect(b.attentes.at(-1)).toBe(false);
  });

  it("une seule requête en vol : une modification pendant le calcul attend la réponse, puis part", async () => {
    const b = banc();
    b.calcul.planifier();
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS);
    expect(b.appels).toHaveLength(1);
    b.modifier();
    b.calcul.planifier();
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS * 3);
    expect(b.appels).toHaveLength(1); // toujours une seule en vol
    b.appels[0].repondre("périmé");
    await laisserPasser();
    expect(b.appels).toHaveLength(2); // la suivante part à la réponse
    expect(b.appels[1].saisie).toBe(1);
    expect(b.resultats).toEqual([]); // et la réponse de la saisie dépassée est ignorée
    b.appels[1].repondre("à jour");
    await laisserPasser();
    expect(b.resultats).toEqual(["à jour"]);
  });

  it("réponse périmée ignorée : la saisie a changé pendant le calcul, seule la dernière réponse est livrée", async () => {
    const b = banc();
    b.calcul.planifier();
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS);
    b.calcul.planifier(); // modification pendant le vol, décompte en cours
    b.appels[0].repondre("ancien");
    await laisserPasser();
    expect(b.resultats).toEqual([]);
    expect(b.attentes.at(-1)).toBe(true); // un calcul est encore attendu
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS);
    b.appels[1].repondre("récent");
    await laisserPasser();
    expect(b.resultats).toEqual(["récent"]);
  });

  it("annuler (saisie incomplète) : rien ne part, et la réponse déjà en vol est ignorée", async () => {
    const b = banc();
    b.calcul.planifier();
    b.calcul.annuler();
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS * 2);
    expect(b.appels).toHaveLength(0);

    b.calcul.planifier();
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS);
    b.calcul.annuler(); // le champ vient d'être vidé
    b.appels[0].repondre("ne doit pas s'afficher");
    await laisserPasser();
    expect(b.resultats).toEqual([]);
    expect(b.attentes.at(-1)).toBe(false);
  });

  it("annuler pendant le vol, après une modification en attente : la requête de remplacement ne part pas", async () => {
    const b = banc();
    b.calcul.planifier();
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS);
    b.calcul.planifier();
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS); // le minuteur échoue à partir (une requête en vol) : à relancer
    b.calcul.annuler();
    b.appels[0].repondre("x");
    await laisserPasser();
    expect(b.appels).toHaveLength(1);
    expect(b.resultats).toEqual([]);
  });

  it("« Calculer » (secours) : part tout de suite, sans attendre le délai", async () => {
    const b = banc();
    b.calcul.planifier();
    b.calcul.maintenant();
    expect(b.appels).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS * 2);
    expect(b.appels).toHaveLength(1); // le décompte en attente a été remplacé
    b.appels[0].repondre("ok");
    await laisserPasser();
    expect(b.resultats).toEqual(["ok"]);
  });

  it("un échec du serveur est signalé une fois, et le calcul suivant repart normalement", async () => {
    const b = banc();
    b.calcul.planifier();
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS);
    b.appels[0].echouer(new Error("réseau"));
    await laisserPasser();
    expect(b.erreurs).toHaveLength(1);
    expect(b.attentes.at(-1)).toBe(false);
    b.calcul.planifier();
    await vi.advanceTimersByTimeAsync(DELAI_CALCUL_MS);
    b.appels[1].repondre("ok");
    await laisserPasser();
    expect(b.resultats).toEqual(["ok"]);
  });
});
