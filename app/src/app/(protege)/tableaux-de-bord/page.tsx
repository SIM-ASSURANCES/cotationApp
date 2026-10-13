import { redirect } from "next/navigation";

/** Ancienne adresse : les tableaux de bord sont maintenant la page d'accueil (la période demandée est conservée). */
export default async function AncienneAdresse(props: PageProps<"/tableaux-de-bord">) {
  const recherche = await props.searchParams;
  const parametres = new URLSearchParams();
  for (const cle of ["debut", "fin"]) {
    const v = recherche[cle];
    if (typeof v === "string") parametres.set(cle, v);
  }
  const suite = parametres.toString();
  redirect(suite ? `/?${suite}` : "/");
}
