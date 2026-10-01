import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { crearToken, exigirAutenticacion } from "../middleware/autenticacion.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";

export const rutasAutenticacion = Router();
const cuenta = z.object({ correo: z.string().email(), contrasena: z.string().min(8), nombre: z.string().min(2), apellido: z.string().optional(), nombreEstudio: z.string().min(2), slug: z.string().min(2).regex(/^[a-z0-9-]+$/) });

rutasAutenticacion.post("/registro", async (req, res) => {
  const datos = cuenta.parse(req.body);
  const existe = await prisma.usuario.findUnique({ where: { correo: datos.correo } });
  if (existe) throw new ErrorHttp(409, "Ya existe una cuenta con ese correo");
  const resultado = await prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.create({ data: { correo: datos.correo, contrasenaHash: await bcrypt.hash(datos.contrasena, 12), nombre: datos.nombre, apellido: datos.apellido } });
    const organizacion = await tx.organizacion.create({ data: { nombre: datos.nombreEstudio, slug: datos.slug } });
    await tx.miembroOrganizacion.create({ data: { usuarioId: usuario.id, organizacionId: organizacion.id, rol: "PROPIETARIO" } });
    return { usuario, organizacion };
  });
  const token = crearToken({ usuarioId: resultado.usuario.id, organizacionId: resultado.organizacion.id });
  res.status(201).json({ token, usuario: { id: resultado.usuario.id, correo: resultado.usuario.correo, nombre: resultado.usuario.nombre }, organizacion: resultado.organizacion });
});

rutasAutenticacion.post("/inicio-sesion", async (req, res) => {
  const datos = z.object({ correo: z.string().email(), contrasena: z.string().min(1), organizacionId: z.string().uuid().optional() }).parse(req.body);
  const usuario = await prisma.usuario.findUnique({ where: { correo: datos.correo }, include: { membresias: { include: { organizacion: true } } } });
  if (!usuario || !(await bcrypt.compare(datos.contrasena, usuario.contrasenaHash))) throw new ErrorHttp(401, "Correo o contraseña incorrectos");
  const miembro = datos.organizacionId ? usuario.membresias.find((m) => m.organizacionId === datos.organizacionId) : usuario.membresias[0];
  if (!miembro) throw new ErrorHttp(403, "La cuenta no tiene una organización disponible");
  await prisma.usuario.update({ where: { id: usuario.id }, data: { ultimoAccesoEn: new Date() } });
  res.json({ token: crearToken({ usuarioId: usuario.id, organizacionId: miembro.organizacionId }), usuario: { id: usuario.id, correo: usuario.correo, nombre: usuario.nombre, apellido: usuario.apellido }, organizacion: miembro.organizacion, organizaciones: usuario.membresias.map((m) => m.organizacion) });
});

rutasAutenticacion.get("/yo", exigirAutenticacion, async (req: SolicitudAutenticada, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.sesion!.usuarioId }, select: { id: true, correo: true, nombre: true, apellido: true, telefono: true, avatarUrl: true, zonaHoraria: true } });
  res.json(usuario);
});
