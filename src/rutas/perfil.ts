import { Router } from "express";
import { z } from "zod";
import type { SolicitudAutenticada } from "../tipos.js";
import {
  actualizarIdiomaUsuario,
  esquemaIdiomaUsuario,
  obtenerPreferenciasUsuario,
} from "../servicios/preferencias-usuario.js";

export const rutasPerfil = Router();

const esquemaActualizarIdioma = z.object({
  idioma: esquemaIdiomaUsuario,
});

const esquemaActualizarPreferencias = z.object({
  idioma: esquemaIdiomaUsuario.optional(),
});

// Cualquier usuario autenticado (propietario, colaborador, cliente o admin global)
// puede leer y actualizar únicamente su propia preferencia de idioma.
rutasPerfil.get("/preferencias", async (req: SolicitudAutenticada, res, next) => {
  try {
    const preferencias = await obtenerPreferenciasUsuario(req.sesion!.usuarioId);
    res.json(preferencias);
  } catch (err) {
    next(err);
  }
});

rutasPerfil.patch("/preferencias", async (req: SolicitudAutenticada, res, next) => {
  try {
    const datos = esquemaActualizarPreferencias.parse(req.body);
    const usuarioId = req.sesion!.usuarioId;
    const preferencias = datos.idioma
      ? await actualizarIdiomaUsuario(usuarioId, datos.idioma)
      : await obtenerPreferenciasUsuario(usuarioId);
    res.json(preferencias);
  } catch (err) {
    next(err);
  }
});

rutasPerfil.get("/idioma", async (req: SolicitudAutenticada, res, next) => {
  try {
    const preferencias = await obtenerPreferenciasUsuario(req.sesion!.usuarioId);
    res.json({ idioma: preferencias.idioma });
  } catch (err) {
    next(err);
  }
});

async function manejarGuardarIdioma(req: SolicitudAutenticada, res: any, next: any) {
  try {
    const { idioma } = esquemaActualizarIdioma.parse(req.body);
    const preferencias = await actualizarIdiomaUsuario(req.sesion!.usuarioId, idioma);
    res.json({ idioma: preferencias.idioma });
  } catch (err) {
    next(err);
  }
}

rutasPerfil.put("/idioma", manejarGuardarIdioma);
rutasPerfil.patch("/idioma", manejarGuardarIdioma);
