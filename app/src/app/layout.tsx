import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Montserrat : police institutionnelle de la charte, hébergée dans le dépôt (polices/, licence SIL OFL 1.1
// dans polices/OFL.txt). Aucun téléchargement, ni à la construction ni à l'exécution.
const montserrat = localFont({
  src: [
    { path: "./polices/Montserrat-wght.ttf", weight: "100 900", style: "normal" },
    { path: "./polices/Montserrat-Italic-wght.ttf", weight: "100 900", style: "italic" },
  ],
  variable: "--font-montserrat",
  display: "swap",
});

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
