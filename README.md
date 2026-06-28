# BTC Quant Dashboard Pro v2

Dashboard cuantitativo de Bitcoin (BTC/USDT) — versión ampliada del proyecto original,
con gráfico tipo TradingView, ~20 indicadores, un motor de Smart Money Concepts
heurístico, derivados, sentimiento/noticias, watchlist, bitácora de operaciones con
export a Excel, y alertas por Telegram.

## Antes de nada: qué es esto y qué no es

- El **score 0-100 y el veredicto COMPRAR/VENDER/NO OPERAR son un sistema de reglas
  ponderadas** (igual que tu framework "Prompt Maestro" original), no un modelo de
  machine learning entrenado y validado estadísticamente. No hay un "% de probabilidad
  de éxito" respaldado por backtesting real — eso requeriría datos históricos
  etiquetados y validación fuera de muestra, que no existen todavía para esta
  herramienta.
- El motor de "Smart Money Concepts" (BOS/CHOCH, FVG, liquidity sweeps, order blocks) es
  una **aproximación heurística simplificada**, no un motor ICT institucional.
- "Actividad de ballenas" es una aproximación gratuita vía trades públicos grandes en
  Binance (`aggTrades`), no datos on-chain reales (eso requeriría Glassnode/Whale Alert,
  de pago).
- No hay calendario económico (CPI, NFP, FOMC...): las APIs gratuitas confiables para
  esto son escasas; si lo quieres, la opción más viable es Trading Economics o FRED con
  registro gratuito, como siguiente paso.
- No hay autenticación multiusuario (JWT/OAuth): es un dashboard de uso personal, igual
  que el de EUR/USD.

Esto es una herramienta de apoyo a la decisión. El criterio final de entrada/salida
sigue siendo tuyo.

## Qué incluye

**Datos en tiempo real (sin API key):**
- Precio, cambio %, volumen, spread implícito (Binance público)
- Funding rate, Open Interest (+ cambio 2h), Long/Short Ratio (Binance Futures público)
- Fear & Greed Index (alternative.me)
- Noticias (RSS de CoinDesk/Cointelegraph) con sentimiento por palabras clave, o vía
  Claude Haiku si configuras `ANTHROPIC_API_KEY`

**Gráfico:** velas reales con lightweight-charts (la librería de TradingView),
overlay de EMA20/50/200, volumen.

**~20 indicadores:** EMA9/20/50/100/200, RSI14, Stochastic RSI, MACD, ADX+DI, ATR,
VWAP, Bandas de Bollinger, OBV, Supertrend, Parabolic SAR, Ichimoku (Tenkan/Kijun/
SpanA/SpanB, sin desplazamiento), Volume Profile (POC), imbalance de order book.

**Score "Prompt Maestro" ponderado a 100 puntos:**

| Categoría | Puntos | Basado en |
|---|---|---|
| Tendencia | 20 | EMA200, cruce EMA50/200, ADX+DI, Supertrend |
| Momentum | 15 | RSI, MACD, Stochastic RSI, Parabolic SAR |
| Volumen | 15 | Volumen vs promedio, OBV, Volume Profile, order book |
| Smart Money | 20 | BOS/CHOCH, FVG, liquidity sweeps, order blocks, ballenas |
| Sentimiento | 10 | Fear & Greed Index (lectura contraria en extremos) |
| Derivados | 10 | Funding rate, OI vs precio, Long/Short ratio |
| Noticias | 10 | Sentimiento de titulares ponderado por recencia |

Señal de **COMPRAR/VENDER solo con score ≥ 85/100** en una dirección clara; cualquier
otro caso es **NO OPERAR**. Cuando hay señal, se calculan Stop Loss y 3 Take Profit
basados en ATR(14) (riesgo = 1.5×ATR, TPs en 1.5×/2.5×/4× ese riesgo).

**Watchlist:** agrega cualquier par de Binance, precio y cambio 24h en vivo
(localStorage, por navegador).

**Bitácora de operaciones (paper trading):** registra trades, calcula win rate y PnL,
exporta a `.xlsx` con un clic (localStorage, por navegador).

**Alertas por Telegram:** función programada de Netlify que corre cada 15 min y avisa
**solo cuando el veredicto cambia** (para no saturarte con ruido) — ver configuración
abajo.

**Tema claro/oscuro**, multi-timeframe (1m a 1M), modo Live/Demo explícito (nunca
cambia solo).

## Stack

Next.js 14 (App Router) + TypeScript + Tailwind CSS + lightweight-charts + SheetJS
(export Excel) + fast-xml-parser (RSS) + Netlify Functions/Blobs (alertas).

## Correr en local

```bash
npm install
npm run dev
```

## Desplegar en Netlify

```bash
git init && git add . && git commit -m "BTC Quant Dashboard Pro v2"
gh repo create btc-quant-dashboard --public --source=. --push
```

En Netlify: "Add new site" → "Import an existing project" → conecta el repo. El
`netlify.toml` ya trae el build command y el plugin de Next.js configurados.

### Variables de entorno (todas opcionales)

En Netlify → Site settings → Environment variables:

| Variable | Para qué |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Habilita las alertas. Créalo hablando con `@BotFather` en Telegram. |
| `TELEGRAM_CHAT_ID` | El chat/usuario que recibe la alerta. Puedes obtenerlo enviando un mensaje a tu bot y consultando `https://api.telegram.org/bot<TOKEN>/getUpdates`. |
| `ANTHROPIC_API_KEY` | Mejora la clasificación de sentimiento de noticias (usa Claude Haiku en vez del clasificador de palabras clave). |

Sin estas variables, el dashboard funciona igual — simplemente sin alertas push y con
el clasificador de noticias gratuito.

## Limitaciones conocidas (documentadas a propósito)

- **VWAP** es de ventana móvil sobre las velas obtenidas, no de sesión calendario
  (reinicio a las 00:00 UTC). Ver `lib/indicators.ts`.
- **Ichimoku** se calcula sin el desplazamiento de 26 periodos hacia adelante (valor
  actual de Tenkan/Kijun/SpanA/SpanB) para simplificar el score; el gráfico no dibuja
  la nube sombreada.
- **Volume Profile** es un histograma simplificado de 24 bins sobre las últimas 120
  velas, no un perfil de mercado tick-by-tick.
- **Smart Money Concepts** y **ballenas**: heurísticas explicadas arriba — útiles como
  contexto, no como verdad absoluta.
- El **deduplicado de alertas** vive en Netlify Blobs por verdict; si quieres lógica más
  fina (ej. no repetir si ya alertó hace menos de X horas aunque cambie de dirección),
  es una extensión sencilla sobre `netlify/functions/scheduled-alert.ts`.

## Ajustes rápidos

- Umbral de señal (85/100): constante `THRESHOLD` en `lib/score.ts`
- Frecuencia de polling del navegador: `POLL_MS` en `app/page.tsx`
- Caché del servidor: TTLs en `lib/binance.ts`
- Frecuencia de la función de alertas: `schedule` en
  `netlify/functions/scheduled-alert.ts` (cron estándar)
- Umbral de "ballena": `thresholdUsd` en `getWhaleSummary()` (`lib/binance.ts`)
