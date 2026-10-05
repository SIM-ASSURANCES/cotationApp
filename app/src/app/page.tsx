export default function Accueil() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold">SIM Documents</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Génération des documents d’assurance de SIM Assurances CI. Socle technique en place :
        aucune fonctionnalité métier pour l’instant.
      </p>
      <p>
        État du service :{" "}
        <a className="font-medium underline" href="/api/sante">
          /api/sante
        </a>
      </p>
    </main>
  );
}
