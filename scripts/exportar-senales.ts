/**
 * EXPORTAR ALERTAS PARA ANÁLISIS
 *
 * Baja todas las alertas registradas en Supabase y las velas de Coinbase
 * que cubren su periodo, y lo guarda todo en data/senales-export.json.
 *
 * Por qué también las velas: los resultados guardados en Supabase no sirven
 * para calibrar. El evaluador revisa una vez por hora contra el cierre de la
 * última vela de 1h, así que no ve los toques de stop o de objetivo dentro
 * de la hora, y su MFE/MAE es una copia del movimiento al cierre, no el
 * máximo y el mínimo reales. Con las velas de 5 minutos cada alerta se puede
 * volver a simular contra el precio real, con el stop, el objetivo y el
 * vencimiento que se quieran probar.
 *
 * Las llaves de Supabase no están en este equipo (solo en Netlify), así que
 * se pasan por variables de entorno de la sesión de PowerShell:
 *
 *   $env:SUPABASE_URL = "https://xxxx.supabase.co"
 *   $env:SUPABASE_SERVICE_KEY = "eyJ..."
 *   npx tsx scripts/exportar-senales.ts
 *
 * Las variables viven solo en esa ventana de PowerShell; al cerrarla se van.
 * El script no escribe las llaves en ningún archivo.
 *
 * Solo lectura: hace SELECT sobre signal_records y GET sobre velas públicas.
 */

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TABLE = "signal_records";
const COINBASE = "https://api.exchange.coinbase.com";

interface Vela {
  t: number; // apertura, ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

async function leerAlertas(): Promise<any[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY en esta sesión de PowerShell.");
    console.error("Cópialas de Netlify → Site configuration → Environment variables y corre:");
    console.error('  $env:SUPABASE_URL = "https://xxxx.supabase.co"');
    console.error('  $env:SUPABASE_SERVICE_KEY = "eyJ..."');
    process.exit(1);
  }

  // Verificación previa con fetch directo. El cliente de Supabase reporta
  // cualquier fallo de red como "TypeError: fetch failed" y se come la causa
  // real (DNS, certificado, conexión rechazada), que es justo lo que hace
  // falta para saber qué arreglar.
  let base: URL;
  try {
    base = new URL(url.trim());
  } catch {
    console.error(`SUPABASE_URL no es una dirección válida: "${url}"`);
    process.exit(1);
  }
  if (base.pathname !== "/" && base.pathname !== "") {
    console.error(`SUPABASE_URL trae una ruta de más ("${base.pathname}").`);
    console.error(`Debe ser solo: ${base.origin}`);
    process.exit(1);
  }
  console.log(`  servidor: ${base.host}`);

  // Conectividad primero: cualquier respuesta HTTP significa que el servidor
  // existe y es alcanzable. La validez de la llave la decide la consulta real
  // de abajo, porque con las llaves nuevas (sb_secret_...) la raíz de la API
  // puede responder 401 aunque la llave sea correcta.
  try {
    await fetch(`${base.origin}/rest/v1/`, { method: "HEAD" });
  } catch (e: any) {
    const causa = e?.cause?.code ?? e?.cause?.message ?? e?.message;
    if (causa === "ENOTFOUND") {
      throw new Error(
        `el servidor ${base.host} no existe. Copia SUPABASE_URL otra vez, sin espacios ni comillas sobrantes.`
      );
    }
    throw new Error(`no se pudo conectar a ${base.host}: ${causa}`);
  }

  if (key.startsWith("pega-aqui") || key.length < 30) {
    throw new Error(
      `SUPABASE_SERVICE_KEY tiene "${key.slice(0, 12)}...", que no es una llave. Asígnala en su propia línea, entre comillas.`
    );
  }

  const sb = createClient(base.origin, key.trim(), { auth: { persistSession: false } });
  const filas: any[] = [];
  const PAGINA = 1000;
  for (let desde = 0; ; desde += PAGINA) {
    // Reintentos ante fallas momentáneas del servidor (522, 503, timeouts).
    // Supabase va detrás de Cloudflare, y un 522 solo significa que esa
    // petición no recibió respuesta a tiempo; el siguiente intento suele pasar.
    let data: any[] | null = null;
    let ultimoError = "";
    for (let intento = 1; intento <= 5; intento++) {
      const res = await sb
        .from(TABLE)
        .select("*")
        .order("created_at", { ascending: true })
        .range(desde, desde + PAGINA - 1);
      if (!res.error) {
        data = res.data ?? [];
        break;
      }
      const msg = res.error.message ?? String(res.error);
      if (/invalid api key|jwt|unauthorized/i.test(msg)) {
        throw new Error(`Supabase rechazó la llave (${msg}). Revisa que sea la secreta / service_role completa.`);
      }
      const codigo = msg.match(/Error code (\d{3})/)?.[1] ?? msg.match(/\b(5\d\d)\b/)?.[1];
      ultimoError = codigo ? `HTTP ${codigo} (el servidor no respondió a tiempo)` : msg.slice(0, 200);
      const espera = 3000 * intento;
      console.log(`  intento ${intento}/5 falló: ${ultimoError} — reintento en ${espera / 1000}s`);
      await new Promise((r) => setTimeout(r, espera));
    }
    if (data === null) {
      throw new Error(
        `Supabase no respondió tras 5 intentos (${ultimoError}). Revisa en supabase.com si el proyecto aparece pausado o con aviso de uso excedido.`
      );
    }
    filas.push(...data);
    if (data.length < PAGINA) break;
  }
  return filas;
}

/** Velas de Coinbase entre dos instantes, paginando de 300 en 300. */
async function velasRango(granSeg: number, startMs: number, endMs: number, etiqueta: string): Promise<Vela[]> {
  const periodo = granSeg * 1000;
  const CHUNK = 300 * periodo;
  const mapa = new Map<number, Vela>();
  const total = Math.ceil((endMs - startMs) / CHUNK);
  let fallos = 0;

  process.stderr.write(`  ${etiqueta.padEnd(3)} ${String(total).padStart(3)} pet. `);

  for (let ini = startMs, n = 0; ini < endMs; ini += CHUNK, n++) {
    const fin = Math.min(ini + CHUNK, endMs);
    const url =
      `${COINBASE}/products/BTC-USD/candles?granularity=${granSeg}` +
      `&start=${new Date(ini).toISOString()}&end=${new Date(fin).toISOString()}`;

    let ok = false;
    for (let intento = 1; intento <= 4 && !ok; intento++) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": "exportar-senales" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = (await res.json()) as number[][];
        for (const [t, low, high, open, close, volume] of raw) {
          const tMs = t * 1000;
          // Solo velas cerradas
          if (tMs + periodo > Date.now()) continue;
          mapa.set(tMs, { t: tMs, o: open, h: high, l: low, c: close, v: volume });
        }
        ok = true;
      } catch {
        await new Promise((r) => setTimeout(r, 400 * intento));
      }
    }
    if (!ok) fallos++;
    if (n % 10 === 0) process.stderr.write(".");
    await new Promise((r) => setTimeout(r, 130));
  }

  const velas = [...mapa.values()].sort((a, b) => a.t - b.t);
  process.stderr.write(` → ${velas.length}${fallos ? ` (${fallos} peticiones fallaron)` : ""}\n`);
  return velas;
}

async function main() {
  console.log("\nLeyendo alertas de Supabase...");
  const alertas = await leerAlertas();
  if (alertas.length === 0) {
    console.log("No hay alertas registradas.");
    return;
  }

  const porFuente = alertas.reduce<Record<string, number>>((a, s) => {
    a[s.source] = (a[s.source] ?? 0) + 1;
    return a;
  }, {});
  const primera = Math.min(...alertas.map((s) => Number(s.created_at)));
  const ahora = Date.now();

  console.log(
    `  ${alertas.length} alertas (${Object.entries(porFuente).map(([k, v]) => `${k} ${v}`).join(" · ")})`
  );
  console.log(`  desde ${new Date(primera).toISOString().slice(0, 16)}`);

  console.log("\nDescargando velas de Coinbase:");
  // 5m: trayectoria de cada alerta, desde un día antes de la primera
  const m5 = await velasRango(300, primera - 24 * 3600_000, ahora, "M5");
  // 1h y 6h: contexto de indicadores al momento de cada alerta
  const h1 = await velasRango(3600, primera - 300 * 3600_000, ahora, "H1");
  const h6 = await velasRango(21600, primera - 300 * 21600_000, ahora, "H6");

  const dir = join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const archivo = join(dir, "senales-export.json");
  writeFileSync(
    archivo,
    JSON.stringify({ exportadoEn: ahora, alertas, velas: { m5, h1, h6 } })
  );

  console.log(`\nListo: ${archivo}`);
  console.log("Avísame y lo analizo.");
}

main().catch((e) => {
  console.error("\nError:", e?.message ?? e);
  process.exitCode = 1;
});
