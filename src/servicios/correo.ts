import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { estanHooksHabilitados } from "../utilidades/hooks-pruebas.js";

export interface OpcionesEnvioRecuperacion {
  destinatario: string;
  nombre: string;
  enlace: string;
  minutosExpiracion?: number;
}

export interface CorreoCapturado {
  destinatario: string;
  asunto: string;
  texto: string;
  html: string;
  enlace: string;
  fecha: Date;
}

let transportePrueba: Transporter | null = null;
let capturadorPruebasActivo = false;
const correosCapturados: CorreoCapturado[] = [];

/**
 * Verifica si existe un transporte de correo configurado y operativo.
 * En producción o desarrollo real: requiere SMTP_HOST.
 * En pruebas: acepta capturador de prueba o transporte inyectado.
 */
export function estaConfiguradoTransporte(): boolean {
  if (capturadorPruebasActivo || transportePrueba !== null) {
    return true;
  }
  const host = process.env.SMTP_HOST?.trim();
  return Boolean(host && host.length > 0);
}

/**
 * Permite inyectar un transporte personalizado exclusivamente en entornos de prueba.
 */
export function configurarTransportePrueba(transporte: Transporter | null): void {
  if (!estanHooksHabilitados()) return;
  transportePrueba = transporte;
}

/**
 * Habilita el capturador en memoria para pruebas de integración y E2E sin salida de red.
 */
export function habilitarCapturadorPruebas(habilitar: boolean = true): void {
  if (!estanHooksHabilitados()) return;
  capturadorPruebasActivo = habilitar;
}

export function obtenerCorreosCapturados(): CorreoCapturado[] {
  return [...correosCapturados];
}

export function limpiarCorreosCapturados(): void {
  correosCapturados.length = 0;
}

/**
 * Inicializa el transporte SMTP a partir de variables de entorno.
 */
function crearTransporte(): Transporter {
  if (transportePrueba) {
    return transportePrueba;
  }

  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    throw new Error("SMTP_HOST no está configurado en las variables de entorno");
  }

  const puerto = Number(process.env.SMTP_PORT?.trim() || "587");
  const seguro = process.env.SMTP_SECURE === "true" || puerto === 465;
  const usuario = process.env.SMTP_USER?.trim();
  const contrasena = process.env.SMTP_PASS?.trim();

  const opcionesTransporte: any = {
    host,
    port: puerto,
    secure: seguro,
  };

  if (usuario && contrasena) {
    opcionesTransporte.auth = {
      user: usuario,
      pass: contrasena,
    };
  }

  return nodemailer.createTransport(opcionesTransporte);
}

/**
 * Genera la plantilla de correo con la identidad visual de Equinox.
 */
export function generarPlantillaRecuperacion(nombre: string, enlace: string, minutos: number = 30): { html: string; texto: string } {
  const nombreLimpio = nombre.trim() || "usuario";

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Restablecer contraseña - Equinox</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
    <!-- Encabezado con marca Equinox -->
    <tr>
      <td style="background-color: #0b1736; padding: 28px 32px; text-align: center;">
        <span style="display: inline-block; width: 14px; height: 14px; border-radius: 50%; background-color: #38bdf8; vertical-align: middle; margin-right: 8px;"></span>
        <span style="font-size: 20px; font-weight: 700; letter-spacing: -0.5px; color: #ffffff; vertical-align: middle;">equinox</span>
      </td>
    </tr>
    <!-- Contenido principal -->
    <tr>
      <td style="padding: 36px 32px 24px 32px;">
        <h2 style="font-size: 20px; font-weight: 600; color: #0f172a; margin-top: 0; margin-bottom: 16px;">Restablece tu contraseña</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px;">
          Hola ${nombreLimpio}, recibimos una solicitud para restablecer la contraseña de tu cuenta en Equinox.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${enlace}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-weight: 600; font-size: 15px; padding: 12px 28px; border-radius: 6px; text-decoration: none; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
            Restablecer contraseña
          </a>
        </div>
        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-bottom: 8px;">
          Este enlace es de un solo uso y vencerá en <strong>${minutos} minutos</strong>.
        </p>
        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-bottom: 24px;">
          Si tú no solicitaste este restablecimiento, puedes ignorar este correo de manera segura. Tu contraseña actual seguirá siendo la misma.
        </p>
        <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
        <p style="font-size: 12px; line-height: 1.4; color: #94a3b8; word-break: break-all; margin: 0;">
          Si el botón no funciona, copia y pega el siguiente enlace en tu navegador:<br>
          <a href="${enlace}" style="color: #2563eb; text-decoration: underline;">${enlace}</a>
        </p>
      </td>
    </tr>
    <!-- Pie de página -->
    <tr>
      <td style="background-color: #f8fafc; padding: 16px 32px; text-align: center; border-top: 1px solid #f1f5f9;">
        <span style="font-size: 11px; color: #94a3b8; letter-spacing: 0.5px;">EQUINOX &middot; TU TRABAJO EN EQUILIBRIO</span>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const texto = `Restablece tu contraseña en Equinox

Hola ${nombreLimpio}:

Recibimos una solicitud para restablecer la contraseña de tu cuenta en Equinox.
Puedes elegir una nueva contraseña abriendo el siguiente enlace:

${enlace}

Este enlace es de un solo uso y vencerá en ${minutos} minutos.

Si tú no solicitaste este cambio, puedes ignorar este correo. Tu contraseña actual permanecerá intacta.
`;

  return { html, texto };
}

/**
 * Envía el correo de restablecimiento de contraseña.
 * Retorna true si fue enviado o capturado con éxito.
 * Lanza un error si falla el envío.
 */
export async function enviarCorreoRecuperacion(opciones: OpcionesEnvioRecuperacion): Promise<void> {
  const { destinatario, nombre, enlace, minutosExpiracion = 30 } = opciones;
  const { html, texto } = generarPlantillaRecuperacion(nombre, enlace, minutosExpiracion);
  const asunto = "Restablece tu contraseña en Equinox";
  const remitente = process.env.SMTP_FROM?.trim() || "Equinox <no-reply@equinox.app>";

  // Modo capturador para pruebas (sin red)
  if (capturadorPruebasActivo) {
    correosCapturados.push({
      destinatario,
      asunto,
      texto,
      html,
      enlace,
      fecha: new Date(),
    });
    return;
  }

  // Envío real a través de SMTP
  const transportador = crearTransporte();
  await transportador.sendMail({
    from: remitente,
    to: destinatario,
    subject: asunto,
    text: texto,
    html,
  });
}
