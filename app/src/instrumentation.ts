/**
 * Next.js appelle register() une seule fois, au démarrage du serveur, avant la
 * première requête. On y valide la configuration : si une variable manque ou est
 * invalide, le serveur s'arrête en listant les variables en faute.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { validerConfigAuDemarrage } = await import("@/serveur/config");
  await validerConfigAuDemarrage();
}
