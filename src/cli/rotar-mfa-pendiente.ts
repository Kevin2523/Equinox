import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { cifrarSecretoMfa, generarSecretoBase32 } from "../utilidades/mfa.js";

export interface OpcionesRotarMfaPendiente {
  correo: string;
  confirmar: boolean;
}

export interface ResultadoRotarMfaPendiente {
  usuarioId: string;
  correo: string;
  rotado: true;
}

export async function ejecutarRotacionMfaPendiente(
  prismaCliente: PrismaClient,
  opciones: OpcionesRotarMfaPendiente
): Promise<ResultadoRotarMfaPendiente> {
  if (!opciones.confirmar) {
    throw new Error(
      "Debes pasar explícitamente --confirmar para rotar el secreto de enrolamiento MFA pendiente."
    );
  }

  const correoNormalizado = (opciones.correo || "").trim().toLowerCase();
  if (!correoNormalizado || !correoNormalizado.includes("@")) {
    throw new Error("Debes proporcionar un correo válido mediante --correo <email>.");
  }

  return prismaCliente.$transaction(async (tx) => {
    const usuario = await tx.usuario.findUnique({
      where: { correo: correoNormalizado },
      select: {
        id: true,
        correo: true,
        rolPlataforma: true,
        mfaHabilitado: true,
        mfaPendienteSecretoCifrado: true,
      },
    });

    if (!usuario) {
      throw new Error(`No existe ninguna cuenta registrada con el correo '${correoNormalizado}'.`);
    }

    if (usuario.rolPlataforma !== "ADMIN_GLOBAL") {
      throw new Error("La rotación de enrolamiento MFA pendiente solo aplica a cuentas ADMIN_GLOBAL.");
    }

    if (usuario.mfaHabilitado) {
      throw new Error(
        "El MFA ya está habilitado para esta cuenta. No se permite rotar ni desactivar un MFA activo mediante esta operación."
      );
    }

    if (!usuario.mfaPendienteSecretoCifrado) {
      throw new Error("La cuenta no tiene un secreto de enrolamiento MFA pendiente para rotar.");
    }

    const nuevoSecretoCifrado = cifrarSecretoMfa(generarSecretoBase32());

    await tx.usuario.update({
      where: { id: usuario.id },
      data: {
        mfaPendienteSecretoCifrado: nuevoSecretoCifrado,
      },
    });

    await tx.auditoriaAdmin.create({
      data: {
        actorUsuarioId: usuario.id,
        actorCorreo: usuario.correo,
        accion: "ADMIN_MFA_PENDIENTE_ROTADO",
        entidad: "Usuario",
        entidadId: usuario.id,
        resultado: "EXITO",
        metadatos: {
          origen: "CLI_ROTAR_MFA_PENDIENTE",
          motivo: "INVALIDACION_ENROLAMIENTO_PENDIENTE",
        },
      },
    });

    return {
      usuarioId: usuario.id,
      correo: usuario.correo,
      rotado: true,
    };
  });
}

function parsearArgumentos(argv: string[]): OpcionesRotarMfaPendiente {
  let correo = "";
  let confirmar = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirmar") {
      confirmar = true;
    } else if (arg === "--correo" && i + 1 < argv.length) {
      correo = argv[++i];
    } else if (arg.startsWith("--correo=")) {
      correo = arg.slice("--correo=".length);
    }
  }

  return { correo, confirmar };
}

async function main() {
  const opciones = parsearArgumentos(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const resultado = await ejecutarRotacionMfaPendiente(prisma, opciones);
    console.log(
      `[ROTAR_MFA_PENDIENTE] Secreto de enrolamiento MFA pendiente rotado de forma segura para '${resultado.correo}' (${resultado.usuarioId}).`
    );
  } finally {
    await prisma.$disconnect();
  }
}

const esEjecucionDirecta =
  typeof process.argv[1] === "string" &&
  /[\\/]rotar-mfa-pendiente\.(ts|js)$/.test(process.argv[1]);

if (esEjecucionDirecta) {
  main().catch((err) => {
    console.error(`[ROTAR_MFA_PENDIENTE] Error: ${err?.message || err}`);
    process.exit(1);
  });
}
