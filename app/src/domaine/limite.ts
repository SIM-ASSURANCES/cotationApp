/**
 * Limite du nombre de requêtes par clé (adresse IP) sur une fenêtre de temps glissante. Règle pure :
 * l'heure est passée en paramètre. Sert à la page publique de vérification (CDC §14.1) : on ne
 * devine pas un jeton de 256 bits, mais on ne laisse pas non plus un robot interroger sans fin.
 */
export class LimiteRequetes {
  private readonly appels = new Map<string, number[]>();

  constructor(
    private readonly maximum: number,
    private readonly fenetreMs: number,
    private readonly clesMax = 10_000,
  ) {}

  /** Enregistre un appel ; renvoie false si la limite est dépassée. */
  accepter(cle: string, maintenant: number): boolean {
    const recents = (this.appels.get(cle) ?? []).filter((t) => maintenant - t < this.fenetreMs);
    if (recents.length >= this.maximum) {
      this.appels.set(cle, recents);
      return false;
    }
    recents.push(maintenant);
    this.appels.set(cle, recents);
    if (this.appels.size > this.clesMax) {
      // Mémoire bornée : on oublie les clés sans appel récent.
      for (const [c, t] of this.appels) if (t.every((x) => maintenant - x >= this.fenetreMs)) this.appels.delete(c);
    }
    return true;
  }
}
