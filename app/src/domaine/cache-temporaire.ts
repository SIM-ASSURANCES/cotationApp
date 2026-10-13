/**
 * Mémoire à durée de vie courte (audit M7) : une valeur calculée est gardée `dureeMs`, puis recalculée. Règle PURE : l'heure
 * est passée en paramètre. Sert aux tableaux de bord, dont le calcul relit beaucoup de lignes à chaque affichage de la page
 * d'arrivée. Deux appels simultanés pour la même clé partagent le même calcul ; un calcul qui échoue n'est jamais gardé ;
 * le nombre de clés est borné (les plus anciennes sont oubliées).
 */
export class CacheTemporaire<V> {
  private readonly entrees = new Map<string, { expire: number; valeur: Promise<V> }>();

  constructor(
    private readonly dureeMs: number,
    private readonly clesMax = 200,
  ) {}

  obtenir(cle: string, maintenant: number, calculer: () => Promise<V>): Promise<V> {
    const existante = this.entrees.get(cle);
    if (existante && existante.expire > maintenant) return existante.valeur;

    const valeur = calculer();
    this.entrees.delete(cle); // une clé réinsérée passe en dernier (ordre d'insertion de la Map)
    this.entrees.set(cle, { expire: maintenant + this.dureeMs, valeur });
    valeur.catch(() => {
      if (this.entrees.get(cle)?.valeur === valeur) this.entrees.delete(cle);
    });
    while (this.entrees.size > this.clesMax) this.entrees.delete(this.entrees.keys().next().value as string);
    return valeur;
  }

  /** Oublie tout (tests, ou après une écriture qui doit se voir tout de suite). */
  vider(): void {
    this.entrees.clear();
  }
}
