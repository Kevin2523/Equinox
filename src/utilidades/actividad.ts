import { prisma } from "../prisma.js";

type ClientePrisma = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma;

export async function registrarActividad(
  datos: {
    organizacionId: string;
    usuarioId?: string;
    entidad: string;
    entidadId: string;
    accion: string;
    descripcion?: string;
    metadatos?: object;
  },
  tx?: ClientePrisma
) {
  const cliente = tx || prisma;
  await cliente.actividad.create({ data: datos });
}
