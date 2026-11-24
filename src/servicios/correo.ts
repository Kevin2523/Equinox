import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { prisma } from "../prisma.js";
import { IDIOMAS_SOPORTADOS, type IdiomaSoportado } from "../tipos.js";
import { estanHooksHabilitados } from "../utilidades/hooks-pruebas.js";

export interface OpcionesEnvioRecuperacion {
  destinatario: string;
  nombre: string;
  enlace: string;
  minutosExpiracion?: number;
  idioma?: IdiomaSoportado | string | null;
}

export interface OpcionesEnvioInvitacion {
  destinatario: string;
  nombreCliente?: string;
  nombreOrganizacion: string;
  rol?: string;
  enlace: string;
  horasExpiracion?: number;
  idioma?: IdiomaSoportado | string | null;
}

export interface CorreoCapturado {
  destinatario: string;
  asunto: string;
  texto: string;
  html: string;
  enlace: string;
  idioma?: IdiomaSoportado;
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

export function normalizarIdiomaCorreo(valor: unknown): IdiomaSoportado {
  if (typeof valor !== "string") return "es";
  const limpio = valor.trim().toLowerCase();
  if ((IDIOMAS_SOPORTADOS as readonly string[]).includes(limpio)) {
    return limpio as IdiomaSoportado;
  }
  const prefijo = limpio.split(/[-_]/)[0];
  if ((IDIOMAS_SOPORTADOS as readonly string[]).includes(prefijo)) {
    return prefijo as IdiomaSoportado;
  }
  return "es";
}

function escaparHtmlCorreo(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function resolverIdiomaDestinatario(
  destinatario: string,
  idiomaExplicito?: IdiomaSoportado | string | null
): Promise<IdiomaSoportado> {
  if (typeof idiomaExplicito === "string" && idiomaExplicito.trim().length > 0) {
    return normalizarIdiomaCorreo(idiomaExplicito);
  }
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { correo: destinatario.trim().toLowerCase() },
      select: { idioma: true },
    });
    return normalizarIdiomaCorreo(usuario?.idioma);
  } catch {
    return "es";
  }
}

interface TextosRecuperacion {
  tituloPagina: string;
  asunto: string;
  encabezado: string;
  saludo: (nombre: string) => string;
  cuerpo: string;
  boton: string;
  expiraHtml: (minutos: number) => string;
  expiraTexto: (minutos: number) => string;
  ignorar: string;
  enlaceAlternativo: string;
  pie: string;
  nombreDefecto: string;
  textoTitulo: string;
  textoInstruccion: string;
  textoIgnorar: string;
}

const TEXTOS_RECUPERACION: Record<IdiomaSoportado, TextosRecuperacion> = {
  es: {
    tituloPagina: "Restablecer contraseña - Equinox",
    asunto: "Restablece tu contraseña en Equinox",
    encabezado: "Restablece tu contraseña",
    saludo: (nombre) =>
      `Hola ${nombre}, recibimos una solicitud para restablecer la contraseña de tu cuenta en Equinox.`,
    cuerpo: "Haz clic en el siguiente botón para elegir una nueva contraseña:",
    boton: "Restablecer contraseña",
    expiraHtml: (minutos) => `Este enlace es de un solo uso y vencerá en <strong>${minutos} minutos</strong>.`,
    expiraTexto: (minutos) => `Este enlace es de un solo uso y vencerá en ${minutos} minutos.`,
    ignorar:
      "Si tú no solicitaste este restablecimiento, puedes ignorar este correo de manera segura. Tu contraseña actual seguirá siendo la misma.",
    enlaceAlternativo: "Si el botón no funciona, copia y pega el siguiente enlace en tu navegador:",
    pie: "EQUINOX &middot; TU TRABAJO EN EQUILIBRIO",
    nombreDefecto: "usuario",
    textoTitulo: "Restablece tu contraseña en Equinox",
    textoInstruccion: "Puedes elegir una nueva contraseña abriendo el siguiente enlace:",
    textoIgnorar:
      "Si tú no solicitaste este cambio, puedes ignorar este correo. Tu contraseña actual permanecerá intacta.",
  },
  en: {
    tituloPagina: "Reset password - Equinox",
    asunto: "Reset your Equinox password",
    encabezado: "Reset your password",
    saludo: (nombre) =>
      `Hi ${nombre}, we received a request to reset the password for your Equinox account.`,
    cuerpo: "Click the button below to choose a new password:",
    boton: "Reset password",
    expiraHtml: (minutos) => `This link is single-use and will expire in <strong>${minutos} minutes</strong>.`,
    expiraTexto: (minutos) => `This link is single-use and will expire in ${minutos} minutes.`,
    ignorar:
      "If you did not request this reset, you can safely ignore this email. Your current password will remain unchanged.",
    enlaceAlternativo: "If the button does not work, copy and paste the following link into your browser:",
    pie: "EQUINOX &middot; YOUR WORK IN BALANCE",
    nombreDefecto: "user",
    textoTitulo: "Reset your Equinox password",
    textoInstruccion: "You can choose a new password by opening the following link:",
    textoIgnorar:
      "If you did not request this change, you can ignore this email. Your current password will remain unchanged.",
  },
  pt: {
    tituloPagina: "Redefinir senha - Equinox",
    asunto: "Redefina sua senha no Equinox",
    encabezado: "Redefina sua senha",
    saludo: (nombre) =>
      `Olá ${nombre}, recebemos uma solicitação para redefinir a senha da sua conta no Equinox.`,
    cuerpo: "Clique no botão abaixo para escolher uma nova senha:",
    boton: "Redefinir senha",
    expiraHtml: (minutos) => `Este link é de uso único e expirará em <strong>${minutos} minutos</strong>.`,
    expiraTexto: (minutos) => `Este link é de uso único e expirará em ${minutos} minutos.`,
    ignorar:
      "Se você não solicitou esta redefinição, pode ignorar este e-mail com segurança. Sua senha atual continuará a mesma.",
    enlaceAlternativo: "Se o botão não funcionar, copie e cole o seguinte link no seu navegador:",
    pie: "EQUINOX &middot; SEU TRABALHO EM EQUILÍBRIO",
    nombreDefecto: "usuário",
    textoTitulo: "Redefina sua senha no Equinox",
    textoInstruccion: "Você pode escolher uma nova senha abrindo o seguinte link:",
    textoIgnorar:
      "Se você não solicitou esta alteração, pode ignorar este e-mail. Sua senha atual permanecerá intacta.",
  },
};

function envolverPlantillaCorreo(
  lang: IdiomaSoportado,
  tituloPagina: string,
  contenidoHtml: string,
  pieHtml: string
): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tituloPagina}</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
    <tr>
      <td style="background-color: #0b1736; padding: 28px 32px; text-align: center;">
        <span style="display: inline-block; width: 14px; height: 14px; border-radius: 50%; background-color: #38bdf8; vertical-align: middle; margin-right: 8px;"></span>
        <span style="font-size: 20px; font-weight: 700; letter-spacing: -0.5px; color: #ffffff; vertical-align: middle;">equinox</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 36px 32px 24px 32px;">
        ${contenidoHtml}
      </td>
    </tr>
    <tr>
      <td style="background-color: #f8fafc; padding: 16px 32px; text-align: center; border-top: 1px solid #f1f5f9;">
        <span style="font-size: 11px; color: #94a3b8; letter-spacing: 0.5px;">${pieHtml}</span>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Genera la plantilla de correo de recuperación con la identidad visual de Equinox.
 */
export function generarPlantillaRecuperacion(
  nombre: string,
  enlace: string,
  minutos: number = 30,
  idioma: IdiomaSoportado | string | null = "es"
): { html: string; texto: string; asunto: string } {
  const lang = normalizarIdiomaCorreo(idioma);
  const t = TEXTOS_RECUPERACION[lang];
  const nombreCrudo = nombre.trim() || t.nombreDefecto;
  const nombreSeguro = escaparHtmlCorreo(nombreCrudo);

  const contenidoHtml = `
        <h2 style="font-size: 20px; font-weight: 600; color: #0f172a; margin-top: 0; margin-bottom: 16px;">${t.encabezado}</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px;">
          ${t.saludo(nombreSeguro)} ${t.cuerpo}
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${enlace}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-weight: 600; font-size: 15px; padding: 12px 28px; border-radius: 6px; text-decoration: none; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
            ${t.boton}
          </a>
        </div>
        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-bottom: 8px;">
          ${t.expiraHtml(minutos)}
        </p>
        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-bottom: 24px;">
          ${t.ignorar}
        </p>
        <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
        <p style="font-size: 12px; line-height: 1.4; color: #94a3b8; word-break: break-all; margin: 0;">
          ${t.enlaceAlternativo}<br>
          <a href="${enlace}" style="color: #2563eb; text-decoration: underline;">${enlace}</a>
        </p>`;

  const html = envolverPlantillaCorreo(lang, t.tituloPagina, contenidoHtml, t.pie);

  const texto = `${t.textoTitulo}

${t.saludo(nombreCrudo)}
${t.textoInstruccion}

${enlace}

${t.expiraTexto(minutos)}

${t.textoIgnorar}
`;

  return { html, texto, asunto: t.asunto };
}

interface TextosInvitacion {
  tituloPagina: string;
  asunto: (organizacion: string) => string;
  encabezado: (organizacion: string) => string;
  saludo: (nombre: string) => string;
  cuerpo: (organizacion: string, rolLegible: string) => string;
  boton: string;
  expiraHtml: (horas: number) => string;
  expiraTexto: (horas: number) => string;
  ignorar: string;
  enlaceAlternativo: string;
  pie: string;
  nombreDefecto: string;
  rolTitular: string;
  rolColaborador: string;
}

const TEXTOS_INVITACION: Record<IdiomaSoportado, TextosInvitacion> = {
  es: {
    tituloPagina: "Invitación al portal de cliente - Equinox",
    asunto: (org) => `Invitación al portal de ${org} en Equinox`,
    encabezado: (org) => `${org} te invitó al portal de cliente`,
    saludo: (nombre) => `Hola ${nombre},`,
    cuerpo: (org, rol) =>
      `Has recibido una invitación para acceder al portal de cliente de ${org} en Equinox con rol de ${rol}.`,
    boton: "Aceptar invitación",
    expiraHtml: (horas) => `Este enlace es personal y vencerá en <strong>${horas} horas</strong>.`,
    expiraTexto: (horas) => `Este enlace es personal y vencerá en ${horas} horas.`,
    ignorar: "Si no esperabas esta invitación, puedes ignorar este correo de forma segura.",
    enlaceAlternativo: "Si el botón no funciona, copia y pega el siguiente enlace en tu navegador:",
    pie: "EQUINOX &middot; TU TRABAJO EN EQUILIBRIO",
    nombreDefecto: "cliente",
    rolTitular: "Titular",
    rolColaborador: "Colaborador",
  },
  en: {
    tituloPagina: "Client portal invitation - Equinox",
    asunto: (org) => `Invitation to ${org}'s client portal on Equinox`,
    encabezado: (org) => `${org} invited you to the client portal`,
    saludo: (nombre) => `Hi ${nombre},`,
    cuerpo: (org, rol) =>
      `You have been invited to access ${org}'s client portal on Equinox as ${rol}.`,
    boton: "Accept invitation",
    expiraHtml: (horas) => `This link is personal and will expire in <strong>${horas} hours</strong>.`,
    expiraTexto: (horas) => `This link is personal and will expire in ${horas} hours.`,
    ignorar: "If you were not expecting this invitation, you can safely ignore this email.",
    enlaceAlternativo: "If the button does not work, copy and paste the following link into your browser:",
    pie: "EQUINOX &middot; YOUR WORK IN BALANCE",
    nombreDefecto: "client",
    rolTitular: "Owner",
    rolColaborador: "Collaborator",
  },
  pt: {
    tituloPagina: "Convite para o portal do cliente - Equinox",
    asunto: (org) => `Convite para o portal de ${org} no Equinox`,
    encabezado: (org) => `${org} convidou você para o portal do cliente`,
    saludo: (nombre) => `Olá ${nombre},`,
    cuerpo: (org, rol) =>
      `Você recebeu um convite para acessar o portal do cliente de ${org} no Equinox como ${rol}.`,
    boton: "Aceitar convite",
    expiraHtml: (horas) => `Este link é pessoal e expirará em <strong>${horas} horas</strong>.`,
    expiraTexto: (horas) => `Este link é pessoal e expirará em ${horas} horas.`,
    ignorar: "Se você não esperava este convite, pode ignorar este e-mail com segurança.",
    enlaceAlternativo: "Se o botão não funcionar, copie e cole o seguinte link no seu navegador:",
    pie: "EQUINOX &middot; SEU TRABALHO EM EQUILÍBRIO",
    nombreDefecto: "cliente",
    rolTitular: "Titular",
    rolColaborador: "Colaborador",
  },
};

export function generarPlantillaInvitacion(opciones: {
  nombreCliente?: string;
  nombreOrganizacion: string;
  rol?: string;
  enlace: string;
  horasExpiracion?: number;
  idioma?: IdiomaSoportado | string | null;
}): { html: string; texto: string; asunto: string } {
  const lang = normalizarIdiomaCorreo(opciones.idioma);
  const t = TEXTOS_INVITACION[lang];
  const horas = opciones.horasExpiracion ?? 168;
  const nombreCrudo = opciones.nombreCliente?.trim() || t.nombreDefecto;
  const orgCruda = opciones.nombreOrganizacion.trim() || "Equinox";
  const rolCrudo = opciones.rol === "COLABORADOR" ? t.rolColaborador : t.rolTitular;

  const nombreSeguro = escaparHtmlCorreo(nombreCrudo);
  const orgSegura = escaparHtmlCorreo(orgCruda);

  const contenidoHtml = `
        <h2 style="font-size: 20px; font-weight: 600; color: #0f172a; margin-top: 0; margin-bottom: 16px;">${t.encabezado(orgSegura)}</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px;">
          ${t.saludo(nombreSeguro)} ${t.cuerpo(orgSegura, rolCrudo)}
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${opciones.enlace}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-weight: 600; font-size: 15px; padding: 12px 28px; border-radius: 6px; text-decoration: none; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
            ${t.boton}
          </a>
        </div>
        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-bottom: 8px;">
          ${t.expiraHtml(horas)}
        </p>
        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-bottom: 24px;">
          ${t.ignorar}
        </p>
        <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
        <p style="font-size: 12px; line-height: 1.4; color: #94a3b8; word-break: break-all; margin: 0;">
          ${t.enlaceAlternativo}<br>
          <a href="${opciones.enlace}" style="color: #2563eb; text-decoration: underline;">${opciones.enlace}</a>
        </p>`;

  const html = envolverPlantillaCorreo(lang, t.tituloPagina, contenidoHtml, t.pie);
  const texto = `${t.encabezado(orgCruda)}

${t.saludo(nombreCrudo)}
${t.cuerpo(orgCruda, rolCrudo)}

${opciones.enlace}

${t.expiraTexto(horas)}

${t.ignorar}
`;

  return { html, texto, asunto: t.asunto(orgCruda) };
}

async function entregarCorreo(opciones: {
  destinatario: string;
  asunto: string;
  texto: string;
  html: string;
  enlace: string;
  idioma: IdiomaSoportado;
}): Promise<void> {
  const remitente = process.env.SMTP_FROM?.trim() || "Equinox <no-reply@equinox.app>";

  if (capturadorPruebasActivo) {
    correosCapturados.push({
      destinatario: opciones.destinatario,
      asunto: opciones.asunto,
      texto: opciones.texto,
      html: opciones.html,
      enlace: opciones.enlace,
      idioma: opciones.idioma,
      fecha: new Date(),
    });
    return;
  }

  const transportador = crearTransporte();
  await transportador.sendMail({
    from: remitente,
    to: opciones.destinatario,
    subject: opciones.asunto,
    text: opciones.texto,
    html: opciones.html,
  });
}

/**
 * Envía el correo de restablecimiento de contraseña en el idioma del destinatario (fallback 'es').
 * Lanza un error si falla el envío.
 */
export async function enviarCorreoRecuperacion(opciones: OpcionesEnvioRecuperacion): Promise<void> {
  const { destinatario, nombre, enlace, minutosExpiracion = 30 } = opciones;
  const idioma = await resolverIdiomaDestinatario(destinatario, opciones.idioma);
  const { html, texto, asunto } = generarPlantillaRecuperacion(nombre, enlace, minutosExpiracion, idioma);
  await entregarCorreo({ destinatario, asunto, texto, html, enlace, idioma });
}

/**
 * Envía el correo de invitación al portal de cliente en el idioma del destinatario (fallback 'es').
 */
export async function enviarCorreoInvitacion(opciones: OpcionesEnvioInvitacion): Promise<void> {
  const idioma = await resolverIdiomaDestinatario(opciones.destinatario, opciones.idioma);
  const { html, texto, asunto } = generarPlantillaInvitacion({
    ...opciones,
    idioma,
  });
  await entregarCorreo({
    destinatario: opciones.destinatario,
    asunto,
    texto,
    html,
    enlace: opciones.enlace,
    idioma,
  });
}
