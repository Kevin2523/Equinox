import "dotenv/config";
import { PrismaClient } from "@prisma/client";

export interface OpcionesBootstrapAdmin {
  correo: string;
  confirmar: boolean;
}

export interface ResultadoBootstrapAdmin {
  usuarioId: string;
  correo: string;
  rolPlataforma: "ADMIN_GLOBAL";
}

export async function ejecutarBootstrapAdmin(
  prismaCliente: PrismaClient,
  opciones: OpcionesBootstrapAdmin
): Promise<ResultadoBootstrapAdmin> {
  if (!opciones.confirmar) {
    throw new Error(
      "Debes pasar explícitamente --confirmar para ejecutar la elevación única a ADMIN_GLOBAL."
    );
  }

  const correoNormalizado = (opciones.correo || "").trim().toLowerCase();
  if (!correoNormalizado || !correoNormalizado.includes("@")) {
    throw new Error("Debes proporcionar un correo válido mediante --correo <email>.");
  }

  return prismaCliente.$transaction(async (tx) => {
    const adminsExistentes = await tx.usuario.count({
      where: { rolPlataforma: "ADMIN_GLOBAL" },
    });

    if (adminsExistentes > 0) {
      throw new Error(
        "Ya existe al menos un ADMIN_GLOBAL en la base de datos. El bootstrap es estrictamente de un solo uso."
      );
    }

    const usuario = await tx.usuario.findUnique({
      where: { correo: correoNormalizado },
      select: { id: true, correo: true, rolPlataforma: true },
    });

    if (!usuario) {
      throw new Error(
        `No existe ninguna cuenta registrada con el correo '${correoNormalizado}'. Registra primero la cuenta.`
      );
    }

    const actualizado = await tx.usuario.update({
      where: { id: usuario.id },
      data: { rolPlataforma: "ADMIN_GLOBAL" },
      select: { id: true, correo: true, rolPlataforma: true },
    });

    await tx.auditoriaAdmin.create({
      data: {
        actorUsuarioId: actualizado.id,
        actorCorreo: actualizado.correo,
        accion: "ADMIN_BOOTSTRAP_ELEVACION",
        entidad: "Usuario",
        entidadId: actualizado.id,
        resultado: "EXITO",
        metadatos: {
          origen: "CLI_BOOTSTRAP",
          mfaRequeridoEnPrimerIngreso: true,
        },
      },
    });

    return {
      usuarioId: actualizado.id,
      correo: actualizado.correo,
      rolPlataforma: "ADMIN_GLOBAL",
    };
  });
}

function parsearArgumentos(argv: string[]): OpcionesBootstrapAdmin {
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
    const resultado = await ejecutarBootstrapAdmin(prisma, opciones);
    console.log(
      `[BOOTSTRAP_ADMIN] Cuenta '${resultado.correo}' (${resultado.usuarioId}) elevada a ADMIN_GLOBAL. ` +
        `Deberá configurar MFA TOTP obligatoriamente en su primer inicio de sesión administrativo.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

const esEjecucionDirecta =
  typeof process.argv[1] === "string" &&
  /[\\/]bootstrap-admin\.(ts|js)$/.test(process.argv[1]);

if (esEjecucionDirecta) {
  main().catch((err) => {
    console.error(`[BOOTSTRAP_ADMIN] Error: ${err?.message || err}`);
    process.exit(1);
  });
}
