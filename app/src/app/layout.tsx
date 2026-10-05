import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

// Montserrat : police institutionnelle de la charte. Téléchargée à la construction
// (`next build`), puis servie par l'application elle-même : aucun appel à Google à l'exécution.
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat" });

export const metadata: Metadata = {
  title: "SIM Documents",
  description: "Génération des documents d'assurance de SIM Assurances CI",
  robots: { index: false, follow: false }, // application interne : à l'écart des moteurs de recherche
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
