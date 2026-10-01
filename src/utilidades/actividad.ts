import { prisma } from "../prisma.js";

export async function registrarActividad(datos: { organizacionId: string; usuarioId?: string; entidad: string; entidadId: string; accion: string; descripcion?: string; metadatos?: object }) {
  await prisma.actividad.create({ data: datos });
}
