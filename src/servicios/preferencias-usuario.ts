import { z } from "zod";
import { prisma } from "../prisma.js";
import { IDIOMAS_SOPORTADOS, type IdiomaSoportado } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";

export const esquemaIdiomaUsuario = z.enum(IDIOMAS_SOPORTADOS);

export interface PreferenciasUsuario {
  idioma: IdiomaSoportado;
  zonaHoraria: string;
}

export async function obtenerPreferenciasUsuario(usuarioId: string): Promise<PreferenciasUsuario> {
  const usuario = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: {
      idioma: true,
      zonaHoraria: true,
    },
  });

  if (!usuario) {
    throw new ErrorHttp(404, "Usuario no encontrado");
  }

  return {
    idioma: usuario.idioma as IdiomaSoportado,
    zonaHoraria: usuario.zonaHoraria,
  };
}

export async function actualizarIdiomaUsuario(
  usuarioId: string,
  idioma: IdiomaSoportado
): Promise<PreferenciasUsuario> {
  const existente = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { id: true },
  });

  if (!existente) {
    throw new ErrorHttp(404, "Usuario no encontrado");
  }

  const actualizado = await prisma.usuario.update({
    where: { id: usuarioId },
    data: { idioma },
    select: {
      idioma: true,
      zonaHoraria: true,
    },
  });

  return {
    idioma: actualizado.idioma as IdiomaSoportado,
    zonaHoraria: actualizado.zonaHoraria,
  };
}
