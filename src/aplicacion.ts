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
import { rutasFotografia } from "./rutas/fotografia.js";
import { rutasInvitacionesPublicas } from "./rutas/invitaciones-publicas.js";
import { rutasAdmin } from "./rutas/admin.js";
import { rutasAdminSuscripciones } from "./rutas/admin-suscripciones.js";
import {
  exigirAutenticacion,
  exigirOrganizacion,
  exigirCliente,
  exigirSuperadmin,
} from "./middleware/autenticacion.js";
import { manejarErrores } from "./utilidades/errores.js";
import { obtenerHorasExpiracion } from "./utilidades/invitaciones.js";

export const aplicacion = express();
aplicacion.use(helmet());
aplicacion.use(cors({
  origin: (process.env.ORIGENES_PERMITIDOS || "http://localhost:4200").split(","),
  credentials: true,
  exposedHeaders: ["X-Portal-Finanzas"],
}));
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
// Redacta tokens en URLs y encabezados Referer para evitar registrar tokens planos o secretos,
// y elimina caracteres de control / comillas dobles para prevenir log injection.
export function sanitizarTextoParaLogs(valor: string): string {
  if (!valor) return "";
  return valor
    .replace(/[\r\n\x00-\x1f\x7f]+/g, " ")
    .replace(/"/g, '\\"')
    .trim();
}

export function sanitizarUrlParaLogs(url: string): string {
  if (!url) return "";
  const redactada = url
    .replace(/\/invitacion\/([^/?#\s]+)/gi, "/invitacion/[REDACTADO]")
    .replace(/\/api\/portal\/(?!(?:proyectos|facturas|sesiones-fotograficas)(?:\/|[?#\s]|$))([^/?#\s]+)/gi,
      "/api/portal/[REDACTADO]")
    .replace(/\/portal\/(?!(?:proyectos|facturas|sesiones-fotograficas)(?:\/|[?#\s]|$))([^/?#\s]+)/gi,
      "/portal/[REDACTADO]")
    .replace(/\/api\/invitaciones\/([^/?#\s]+)(\/aceptar)?/gi, (_match, _p1, p2) => {
      return `/api/invitaciones/[REDACTADO]${p2 || ""}`;
    })
    .replace(/([?&]token=)([^&#\s]+)/gi, "$1[REDACTADO]")
    .replace(/\/recuperar-contrasena\/([^/?#\s]+)/gi, "/recuperar-contrasena/[REDACTADO]")
    .replace(/\/recuperar-mfa\/([^/?#\s]+)/gi, "/recuperar-mfa/[REDACTADO]")
    .replace(/\/api\/autenticacion\/(?:validar-token-recuperacion|recuperar-contrasena)\/([^/?#\s]+)/gi,
      "/api/autenticacion/recuperar-contrasena/[REDACTADO]");
  return sanitizarTextoParaLogs(redactada);
}

morgan.token("url-redactada", (req: any) => {
  const urlOriginal = (req.originalUrl || req.url || "") as string;
  return sanitizarUrlParaLogs(urlOriginal);
});

morgan.token("referrer-redactado", (req: any) => {
  const ref = (req.headers["referer"] || req.headers["referrer"] || "") as string;
  return ref ? `"${sanitizarUrlParaLogs(ref)}"` : '""';
});

morgan.token("user-agent-seguro", (req: any) => {
  const ua = (req.headers["user-agent"] || "") as string;
  return sanitizarTextoParaLogs(ua) || "-";
});

morgan.token("direccion-segura", (req: any) => {
  // Las rutas públicas (incluidos rechazos por capacidad) no registran la IP.
  const dir = /^\/api\/invitaciones(?:\/|$)/i.test(req.originalUrl || req.url || "")
    ? "[REDACTADO]"
    : req.ip || req.socket?.remoteAddress || "-";
  return sanitizarTextoParaLogs(String(dir));
});

const formatoMorgan = process.env.ENTORNO === "produccion"
  ? ':direccion-segura - :remote-user [:date[clf]] ":method :url-redactada HTTP/:http-version" :status :res[content-length] :referrer-redactado ":user-agent-seguro"'
  : ":method :url-redactada :status :response-time ms - :res[content-length]";

aplicacion.use(morgan(formatoMorgan));

aplicacion.get("/salud", (_req, res) => res.json({ estado: "disponible", servicio: "equinox-api" }));
aplicacion.use("/api/autenticacion", rutasAutenticacion);
aplicacion.use("/api/invitaciones", rutasInvitacionesPublicas);
aplicacion.use("/api/admin/suscripciones", exigirAutenticacion, exigirSuperadmin, rutasAdminSuscripciones);
aplicacion.use("/api/admin", exigirAutenticacion, exigirSuperadmin, rutasAdmin);
aplicacion.use("/api/portal", exigirAutenticacion, exigirCliente, rutasPortal);
aplicacion.use("/api/organizacion", exigirAutenticacion, exigirOrganizacion, rutasOrganizacion);
aplicacion.use("/api/clientes", exigirAutenticacion, exigirOrganizacion, rutasFotografia);
aplicacion.use("/api/clientes", exigirAutenticacion, exigirOrganizacion, rutasClientes);
aplicacion.use("/api/proyectos", exigirAutenticacion, exigirOrganizacion, rutasProyectos);
aplicacion.use("/api/facturas", exigirAutenticacion, exigirOrganizacion, rutasFacturas);
aplicacion.use((_req, res) => res.status(404).json({ error: "Ruta no encontrada" }));
aplicacion.use(manejarErrores);
