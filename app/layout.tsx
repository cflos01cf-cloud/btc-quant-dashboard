import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTC Quant Dashboard Pro | Prompt Maestro",
  description:
    "Dashboard cuantitativo de Bitcoin con motor de score ponderado (Tendencia, Momentum, Volumen, Smart Money, Sentimiento, Derivados, Noticias) — señal solo con 85+/100.",
};

// Runs before paint to avoid a flash of the wrong theme.
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('btc-dashboard-theme');
    if (stored === 'light') document.documentElement.classList.add('light');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-app text-ink-100 font-sans antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
