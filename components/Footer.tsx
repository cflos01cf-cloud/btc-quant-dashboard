export default function Footer() {
  return (
    <footer className="mt-8 pb-6 text-center text-xs text-ink-500 space-y-1">
      <p>
        BTC Quant Dashboard Pro v2 — arquitectura hermana del EUR/USD Quant Dashboard Pro.
        Datos vía Binance (precio, derivados, order book), alternative.me (Fear &amp; Greed) y
        feeds RSS públicos (noticias).
      </p>
      <p>
        El score, las señales y los eventos de Smart Money son heurísticas basadas en reglas, no
        un modelo de IA entrenado y validado estadísticamente. Esto no es asesoría financiera; es
        una herramienta de apoyo a la decisión. El criterio final es tuyo.
      </p>
    </footer>
  );
}
