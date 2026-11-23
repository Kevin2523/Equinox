import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const esquemaUuid = z.string().uuid();
const esquemaCorreo = z.string().trim().email().max(254);

export interface OpcionesSeparacionIdentidad {
  organizacionId: string;
  correoOrigen: string;
  correoDestino: string;
  nombreDestino?: string;
  apellidoDestino?: string | null;
  crearDestinoSiFalta?: boolean;
  contrasenaDestino?: string;
  obtenerContrasenaDestino?: () => Promise<string>;
  confirmar: boolean;
}

export interface ResultadoSeparacionIdentidad {
  organizacionId: string;
  organizacionNombre: string;
  usuarioOrigenId: string;
  correoOrigen: string;
  usuarioDestinoId: string;
  correoDestino: string;
  destinoCreado: boolean;
  sesionesOrigenRevocadas: number;
  sesionesDestinoRevocadas: number;
}

function normalizarCorreo(correo: string): string {
  return (correo || "").trim().toLowerCase();
}

function validarContrasenaNueva(contrasena: string): string {
  if (typeof contrasena !== "string" || contrasena.length < 8 || contrasena.length > 128) {
    throw new Error("La contraseña de la cuenta destino debe tener entre 8 y 128 caracteres.");
  }
  return contrasena;
}

async function leerContrasenaOculta(promptTexto: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Se requiere una terminal interactiva (TTY) para ingresar la contraseña de forma segura."
    );
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let valor = "";
    const estabaEnRaw = Boolean(stdin.isRaw);

    const limpiar = () => {
      stdin.removeListener("data", onData);
      if (typeof stdin.setRawMode === "function") {
        stdin.setRawMode(estabaEnRaw);
      }
      stdin.pause();
    };

    const onData = (chunk: Buffer) => {
      const texto = chunk.toString("utf8");
      for (const ch of texto) {
        if (ch === "\u0003") {
          stdout.write("\n");
          limpiar();
          reject(new Error("Operación cancelada por el usuario."));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          stdout.write("\n");
          limpiar();
          resolve(valor);
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (valor.length > 0) {
            valor = valor.slice(0, -1);
          }
          continue;
        }
        valor += ch;
      }
    };

    stdout.write(promptTexto);
    stdin.resume();
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
    }
    stdin.on("data", onData);
  });
}

async function solicitarContrasenaInteractiva(correoDestino: string): Promise<string> {
  const primera = await leerContrasenaOculta(
    `Ingresa la contraseña para la nueva cuenta '${correoDestino}' (mín. 8 caracteres): `
  );
  validarContrasenaNueva(primera);

  const confirmacion = await leerContrasenaOculta("Confirma la contraseña: ");
  if (primera !== confirmacion) {
    throw new Error("Las contraseñas ingresadas no coinciden.");
  }
  return primera;
}

/**
 * Separa de forma atómica la identidad ADMIN_GLOBAL de la propiedad de una organización,
 * transfiriendo la membresía PROPIETARIO a una cuenta separada (creándola con contraseña
 * elegida por el usuario si falta), revocando sesiones previas y preservando atribuciones históricas.
 */
export async function ejecutarSeparacionIdentidad(
  prismaCliente: PrismaClient,
  opciones: OpcionesSeparacionIdentidad
): Promise<ResultadoSeparacionIdentidad> {
  if (!opciones.confirmar) {
    throw new Error(
      "Debes pasar explícitamente --confirmar para ejecutar la separación de identidades."
    );
  }

  const orgIdValidado = esquemaUuid.safeParse((opciones.organizacionId || "").trim());
  if (!orgIdValidado.success) {
    throw new Error("Debes proporcionar un UUID válido mediante --organizacion-id <uuid>.");
  }

  const correoOrigen = normalizarCorreo(opciones.correoOrigen);
  const correoDestino = normalizarCorreo(opciones.correoDestino);

  if (!esquemaCorreo.safeParse(correoOrigen).success) {
    throw new Error("Debes proporcionar un correo origen válido mediante --correo-origen <email>.");
  }
  if (!esquemaCorreo.safeParse(correoDestino).success) {
    throw new Error("Debes proporcionar un correo destino válido mediante --correo-destino <email>.");
  }
  if (correoOrigen === correoDestino) {
    throw new Error("El correo origen y el correo destino deben ser distintos.");
  }

  // Verificar si el destino existe antes de solicitar contraseña (si hace falta crearlo).
  const destinoExistente = await prismaCliente.usuario.findUnique({
    where: { correo: correoDestino },
    select: { id: true },
  });

  let contrasenaPlanaNueva: string | null = null;
  let contrasenaHashNueva: string | null = null;
  if (!destinoExistente) {
    if (!opciones.crearDestinoSiFalta) {
      throw new Error(
        `La cuenta destino '${correoDestino}' no existe. Créala primero o usa --crear-destino para definir su contraseña de forma segura.`
      );
    }

    const contrasenaPlana =
      opciones.contrasenaDestino !== undefined
        ? opciones.contrasenaDestino
        : opciones.obtenerContrasenaDestino
          ? await opciones.obtenerContrasenaDestino()
          : await solicitarContrasenaInteractiva(correoDestino);

    validarContrasenaNueva(contrasenaPlana);
    contrasenaPlanaNueva = contrasenaPlana;
    contrasenaHashNueva = await bcrypt.hash(contrasenaPlana, 12);
  }

  const ahora = new Date();

  return prismaCliente.$transaction(async (tx) => {
    const organizacion = await tx.organizacion.findUnique({
      where: { id: orgIdValidado.data },
      select: { id: true, nombre: true },
    });
    if (!organizacion) {
      throw new Error(`No existe ninguna organización con id '${orgIdValidado.data}'.`);
    }

    const usuarioOrigen = await tx.usuario.findUnique({
      where: { correo: correoOrigen },
      select: {
        id: true,
        correo: true,
        contrasenaHash: true,
        rolPlataforma: true,
        mfaHabilitado: true,
      },
    });
    if (!usuarioOrigen) {
      throw new Error(`No existe ninguna cuenta registrada con el correo '${correoOrigen}'.`);
    }
    if (usuarioOrigen.rolPlataforma !== "ADMIN_GLOBAL") {
      throw new Error(
        `La cuenta origen '${correoOrigen}' no tiene rol ADMIN_GLOBAL; esta operación solo separa cuentas de superadministración.`
      );
    }

    const membresiaOrigen = await tx.miembroOrganizacion.findUnique({
      where: {
        usuarioId_organizacionId: {
          usuarioId: usuarioOrigen.id,
          organizacionId: organizacion.id,
        },
      },
      select: { id: true, rol: true },
    });
    if (!membresiaOrigen || membresiaOrigen.rol !== "PROPIETARIO") {
      throw new Error(
        `La cuenta '${correoOrigen}' no es PROPIETARIO de la organización '${organizacion.nombre}' (${organizacion.id}).`
      );
    }

    let usuarioDestino = await tx.usuario.findUnique({
      where: { correo: correoDestino },
      select: {
        id: true,
        correo: true,
        rolPlataforma: true,
      },
    });

    let destinoCreado = false;
    if (!usuarioDestino) {
      if (!contrasenaHashNueva || !contrasenaPlanaNueva) {
        throw new Error(
          `La cuenta destino '${correoDestino}' no existe y no se proporcionó contraseña para crearla.`
        );
      }
      if (await bcrypt.compare(contrasenaPlanaNueva, usuarioOrigen.contrasenaHash)) {
        throw new Error(
          "La contraseña de la cuenta destino debe ser distinta a la de la cuenta administrativa origen."
        );
      }

      const nombreDestino = (opciones.nombreDestino || organizacion.nombre).trim();
      if (nombreDestino.length < 2 || nombreDestino.length > 120) {
        throw new Error("El nombre de la cuenta destino debe tener entre 2 y 120 caracteres.");
      }

      usuarioDestino = await tx.usuario.create({
        data: {
          correo: correoDestino,
          contrasenaHash: contrasenaHashNueva,
          nombre: nombreDestino,
          apellido: opciones.apellidoDestino?.trim() || null,
          rolPlataforma: "USUARIO",
          mfaHabilitado: false,
        },
        select: {
          id: true,
          correo: true,
          rolPlataforma: true,
        },
      });
      destinoCreado = true;
    } else {
      if (usuarioDestino.id === usuarioOrigen.id) {
        throw new Error("El usuario origen y destino no pueden ser la misma identidad.");
      }
      if (usuarioDestino.rolPlataforma !== "USUARIO") {
        throw new Error(
          `La cuenta destino '${correoDestino}' tiene rolPlataforma='${usuarioDestino.rolPlataforma}'. Debe ser 'USUARIO' para evitar acceso cruzado.`
        );
      }
    }

    // Transferencia atómica de membresía PROPIETARIO hacia usuarioDestino
    const membresiaDestinoExistente = await tx.miembroOrganizacion.findUnique({
      where: {
        usuarioId_organizacionId: {
          usuarioId: usuarioDestino.id,
          organizacionId: organizacion.id,
        },
      },
      select: { id: true, rol: true },
    });

    if (membresiaDestinoExistente) {
      if (membresiaDestinoExistente.rol !== "PROPIETARIO") {
        await tx.miembroOrganizacion.update({
          where: { id: membresiaDestinoExistente.id },
          data: { rol: "PROPIETARIO" },
        });
      }
    } else {
      await tx.miembroOrganizacion.create({
        data: {
          usuarioId: usuarioDestino.id,
          organizacionId: organizacion.id,
          rol: "PROPIETARIO",
        },
      });
    }

    // Remover membresía del ADMIN_GLOBAL sin alterar atribuciones históricas
    await tx.miembroOrganizacion.delete({
      where: { id: membresiaOrigen.id },
    });

    // Verificar postcondición de propiedad antes de cerrar la transacción
    const propietariosRestantes = await tx.miembroOrganizacion.count({
      where: { organizacionId: organizacion.id, rol: "PROPIETARIO" },
    });
    if (propietariosRestantes < 1) {
      throw new Error("Invariante violada: la organización quedaría sin PROPIETARIO.");
    }

    // Revocar todas las sesiones activas previas de ambas cuentas para evitar acceso cruzado
    const revocadasOrigen = await tx.sesion.updateMany({
      where: { usuarioId: usuarioOrigen.id, revocadaEn: null },
      data: { revocadaEn: ahora },
    });

    const revocadasDestino = await tx.sesion.updateMany({
      where: { usuarioId: usuarioDestino.id, revocadaEn: null },
      data: { revocadaEn: ahora },
    });

    await tx.auditoriaAdmin.create({
      data: {
        actorUsuarioId: usuarioOrigen.id,
        actorCorreo: usuarioOrigen.correo,
        accion: "ADMIN_SEPARACION_IDENTIDAD_ORGANIZACION",
        entidad: "Organizacion",
        entidadId: organizacion.id,
        organizacionId: organizacion.id,
        resultado: "EXITO",
        metadatos: {
          origen: "CLI_SEPARAR_IDENTIDAD",
          usuarioOrigenId: usuarioOrigen.id,
          usuarioDestinoId: usuarioDestino.id,
          correoDestino: usuarioDestino.correo,
          destinoCreado,
          sesionesOrigenRevocadas: revocadasOrigen.count,
          sesionesDestinoRevocadas: revocadasDestino.count,
          mfaOrigenPreservado: usuarioOrigen.mfaHabilitado,
        },
      },
    });

    return {
      organizacionId: organizacion.id,
      organizacionNombre: organizacion.nombre,
      usuarioOrigenId: usuarioOrigen.id,
      correoOrigen: usuarioOrigen.correo,
      usuarioDestinoId: usuarioDestino.id,
      correoDestino: usuarioDestino.correo,
      destinoCreado,
      sesionesOrigenRevocadas: revocadasOrigen.count,
      sesionesDestinoRevocadas: revocadasDestino.count,
    };
  });
}

function parsearArgumentos(argv: string[]): OpcionesSeparacionIdentidad {
  let organizacionId = "";
  let correoOrigen = "";
  let correoDestino = "";
  let nombreDestino: string | undefined;
  let apellidoDestino: string | undefined;
  let crearDestinoSiFalta = false;
  let confirmar = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirmar") {
      confirmar = true;
    } else if (arg === "--crear-destino") {
      crearDestinoSiFalta = true;
    } else if (arg === "--contrasena" || arg.startsWith("--contrasena=")) {
      throw new Error(
        "No se permite pasar contraseñas por línea de comandos. Usa --crear-destino en una terminal interactiva."
      );
    } else if (arg === "--organizacion-id" && i + 1 < argv.length) {
      organizacionId = argv[++i];
    } else if (arg.startsWith("--organizacion-id=")) {
      organizacionId = arg.slice("--organizacion-id=".length);
    } else if (arg === "--correo-origen" && i + 1 < argv.length) {
      correoOrigen = argv[++i];
    } else if (arg.startsWith("--correo-origen=")) {
      correoOrigen = arg.slice("--correo-origen=".length);
    } else if (arg === "--correo-destino" && i + 1 < argv.length) {
      correoDestino = argv[++i];
    } else if (arg.startsWith("--correo-destino=")) {
      correoDestino = arg.slice("--correo-destino=".length);
    } else if (arg === "--nombre-destino" && i + 1 < argv.length) {
      nombreDestino = argv[++i];
    } else if (arg.startsWith("--nombre-destino=")) {
      nombreDestino = arg.slice("--nombre-destino=".length);
    } else if (arg === "--apellido-destino" && i + 1 < argv.length) {
      apellidoDestino = argv[++i];
    } else if (arg.startsWith("--apellido-destino=")) {
      apellidoDestino = arg.slice("--apellido-destino=".length);
    }
  }

  return {
    organizacionId,
    correoOrigen,
    correoDestino,
    nombreDestino,
    apellidoDestino,
    crearDestinoSiFalta,
    confirmar,
  };
}

async function main() {
  const opciones = parsearArgumentos(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const res = await ejecutarSeparacionIdentidad(prisma, opciones);
    console.log(
      `[SEPARAR_IDENTIDAD] Organización '${res.organizacionNombre}' (${res.organizacionId}) transferida de ` +
        `'${res.correoOrigen}' a '${res.correoDestino}' (${res.usuarioDestinoId}). ` +
        `Cuenta destino creada: ${res.destinoCreado ? "sí" : "no"}. ` +
        `Sesiones revocadas -> origen: ${res.sesionesOrigenRevocadas}, destino: ${res.sesionesDestinoRevocadas}.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

const esEjecucionDirecta =
  typeof process.argv[1] === "string" &&
  /[\\/]separar-identidad\.(ts|js)$/.test(process.argv[1]);

if (esEjecucionDirecta) {
  main().catch((err) => {
    console.error(`[SEPARAR_IDENTIDAD] Error: ${err?.message || err}`);
    process.exit(1);
  });
}
