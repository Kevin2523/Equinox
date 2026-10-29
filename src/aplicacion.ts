import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { rutasAutenticacion } from "./rutas/autenticacion.js";
import { rutasClientes } from "./rutas/clientes.js";
import { rutasProyectos } from "./rutas/proyectos.js";
import { rutasOrganizacion } from "./rutas/organizacion.js";
import { rutasFacturas } from "./rutas/facturas.js";
import { rutasPortal } from "./rutas/portal.js";
import { rutasInvitacionesPublicas } from "./rutas/invitaciones-publicas.js";
import { exigirAutenticacion, exigirOrganizacion } from "./middleware/autenticacion.js";
import { manejarErrores } from "./utilidades/errores.js";
import { obtenerHorasExpiracion } from "./utilidades/invitaciones.js";

export const aplicacion = express();
aplicacion.use(helmet());
aplicacion.use(cors({ origin: (process.env.ORIGENES_PERMITIDOS || "http://localhost:4200").split(","), credentials: true }));
aplicacion.use(express.json({ limit: "2mb" }));

// Validación estricta y segura de CONFIAR_PROXY:
// Acepta únicamente: variable ausente, vacía, "false", "0", o un entero positivo acotado (1 a 10).
// Rechaza explícitamente "true", cadenas con basura ("1junk"), negativos, decimales o valores excesivos.
const MAX_SALTOS_PROXY = 10;

export function parsearConfiarProxy(valor?: string | null): boolean | number {
  if (valor === undefined || valor === null || valor.trim() === "") {
    return false;
  }
  const valorLimpio = valor.trim().toLowerCase();
  if (valorLimpio === "false" || valorLimpio === "0") {
    return false;
  }
  if (!/^\d+$/.test(valorLimpio)) {
    throw new Error(
      `[SEGURIDAD] Valor inválido para CONFIAR_PROXY: '${valor}'. Solo se acepta 'false', '0' o un entero de 1 a ${MAX_SALTOS_PROXY}.`
    );
  }
  const saltos = Number(valorLimpio);
  if (saltos < 1 || saltos > MAX_SALTOS_PROXY) {
    throw new Error(
      `[SEGURIDAD] Cantidad de saltos de proxy fuera de rango permitido (1 a ${MAX_SALTOS_PROXY}): ${saltos}`
    );
  }
  return saltos;
}

aplicacion.set("trust proxy", parsearConfiarProxy(process.env.CONFIAR_PROXY));

// Validar al iniciar que VENCIMIENTO_INVITACION_HORAS cumpla estrictamente su contrato:
obtenerHorasExpiracion();

// Endpoint exclusivo para arnés de pruebas (nunca expuesto en producción ni desarrollo normal):
if (process.env.NODE_ENV === "test") {
  aplicacion.get("/__prueba_ip__", (req, res) => {
    res.json({
      ip: req.ip,
      ips: req.ips,
      remoteAddress: req.socket.remoteAddress,
    });
  });
}

// Sanitización segura de tokens para logs en desarrollo, pruebas y producción:
// Redacta tokens en URLs y encabezados Referer para evitar registrar tokens planos o secretos
export function sanitizarUrlParaLogs(url: string): string {
  if (!url) return "";
  return url
    .replace(/\/invitacion\/([^/?#\s]+)/gi, "/invitacion/[REDACTADO]")
    .replace(/\/api\/invitaciones\/([^/?#\s]+)(\/aceptar)?/gi, (_match, _p1, p2) => {
      return `/api/invitaciones/[REDACTADO]${p2 || ""}`;
    });
}

morgan.token("url-redactada", (req: any) => {
  const urlOriginal = (req.originalUrl || req.url || "") as string;
  return sanitizarUrlParaLogs(urlOriginal);
});

morgan.token("referrer-redactado", (req: any) => {
  const ref = (req.headers["referer"] || req.headers["referrer"] || "") as string;
  return ref ? `"${sanitizarUrlParaLogs(ref)}"` : '""';
});

morgan.token("direccion-segura", (req: any) => {
  // Las rutas públicas (incluidos rechazos por capacidad) no registran la IP.
  return /^\/api\/invitaciones(?:\/|$)/i.test(req.originalUrl || req.url || "")
    ? "[REDACTADO]"
    : req.ip || req.socket?.remoteAddress || "-";
});

const formatoMorgan = process.env.ENTORNO === "produccion"
  ? ':direccion-segura - :remote-user [:date[clf]] ":method :url-redactada HTTP/:http-version" :status :res[content-length] :referrer-redactado ":user-agent"'
  : ":method :url-redactada :status :response-time ms - :res[content-length]";

aplicacion.use(morgan(formatoMorgan));

aplicacion.get("/salud", (_req, res) => res.json({ estado: "disponible", servicio: "equinox-api" }));
aplicacion.use("/api/autenticacion", rutasAutenticacion);
aplicacion.use("/api/invitaciones", rutasInvitacionesPublicas);
aplicacion.use("/api/portal", rutasPortal);
aplicacion.use("/api/organizacion", exigirAutenticacion, exigirOrganizacion, rutasOrganizacion);
aplicacion.use("/api/clientes", exigirAutenticacion, exigirOrganizacion, rutasClientes);
aplicacion.use("/api/proyectos", exigirAutenticacion, exigirOrganizacion, rutasProyectos);
aplicacion.use("/api/facturas", exigirAutenticacion, exigirOrganizacion, rutasFacturas);
aplicacion.use((_req, res) => res.status(404).json({ error: "Ruta no encontrada" }));
aplicacion.use(manejarErrores);
