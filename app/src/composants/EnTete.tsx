import Link from "next/link";

export type LienNavigation = { href: string; libelle: string };

/** Bandeau de l'application : marque, navigation selon les droits, identité et déconnexion. */
export function EnTete({
  nom,
  libelleProfil,
  liens,
  deconnexion,
}: {
  nom: string;
  libelleProfil: string;
  liens: LienNavigation[];
  /** Server Action de déconnexion (passée par la page : composants/ n'importe pas serveur/). */
  deconnexion: () => Promise<void>;
}) {
  return (
    <header className="bandeau-sim">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <Link href="/" className="text-lg font-bold tracking-wide">
          SIM <span className="font-light">DOCUMENTS</span>
        </Link>
        <nav aria-label="Navigation principale" className="flex flex-wrap gap-4 text-sm">
          {liens.map((lien) => (
            <Link key={lien.href} href={lien.href} className="underline-offset-4 hover:underline">
              {lien.libelle}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <Link href="/mon-compte" className="text-right leading-tight underline-offset-4 hover:underline">
            <span className="block font-semibold">{nom}</span>
            <span className="block text-xs opacity-90">{libelleProfil}</span>
          </Link>
          <form action={deconnexion}>
            <button type="submit" className="rounded border border-white/70 px-3 py-1 hover:bg-white/15">
              Déconnexion
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
