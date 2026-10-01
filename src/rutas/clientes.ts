import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";
import { registrarActividad } from "../utilidades/actividad.js";

export const rutasClientes = Router();
const esquema = z.object({ nombre: z.string().min(2), empresa: z.string().optional().nullable(), correo: z.string().email().optional().nullable(), telefono: z.string().optional().nullable(), direccion: z.string().optional().nullable(), sitioWeb: z.string().url().optional().nullable(), notasInternas: z.string().optional().nullable(), estado: z.enum(["ACTIVO", "INACTIVO", "PROSPECTO", "ARCHIVADO"]).optional() });
const id = z.string().uuid();
const pertenece = async (clienteId: string, organizacionId: string) => { const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, organizacionId } }); if (!cliente) throw new ErrorHttp(404, "Cliente no encontrado"); return cliente; };

rutasClientes.get("/", async (req: SolicitudAutenticada, res) => {
  const buscar = typeof req.query.buscar === "string" ? req.query.buscar : undefined;
  const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
  const where = { organizacionId: req.sesion!.organizacionId, ...(estado ? { estado: estado as "ACTIVO" | "INACTIVO" | "PROSPECTO" | "ARCHIVADO" } : {}), ...(buscar ? { OR: [{ nombre: { contains: buscar, mode: "insensitive" as const } }, { empresa: { contains: buscar, mode: "insensitive" as const } }] } : {}) };
  res.json(await prisma.cliente.findMany({ where, include: { _count: { select: { proyectos: true } } }, orderBy: { creadoEn: "desc" } }));
});
rutasClientes.post("/", async (req: SolicitudAutenticada, res) => { const cliente = await prisma.cliente.create({ data: { ...esquema.parse(req.body), organizacionId: req.sesion!.organizacionId } }); await registrarActividad({ organizacionId: req.sesion!.organizacionId, usuarioId: req.sesion!.usuarioId, entidad: "cliente", entidadId: cliente.id, accion: "CREAR", descripcion: `Creó el cliente ${cliente.nombre}` }); res.status(201).json(cliente); });
rutasClientes.get("/:id", async (req: SolicitudAutenticada, res) => { const clienteId = id.parse(req.params.id); await pertenece(clienteId, req.sesion!.organizacionId); res.json(await prisma.cliente.findUnique({ where: { id: clienteId }, include: { proyectos: { orderBy: { creadoEn: "desc" } }, facturas: { orderBy: { fechaEmision: "desc" } }, accesosPortal: true } })); });
rutasClientes.patch("/:id", async (req: SolicitudAutenticada, res) => { const cliente = await pertenece(id.parse(req.params.id), req.sesion!.organizacionId); res.json(await prisma.cliente.update({ where: { id: cliente.id }, data: esquema.partial().parse(req.body) })); });
rutasClientes.delete("/:id", async (req: SolicitudAutenticada, res) => { const cliente = await pertenece(id.parse(req.params.id), req.sesion!.organizacionId); const [proyectos, facturas] = await Promise.all([prisma.proyecto.count({ where: { clienteId: cliente.id } }), prisma.factura.count({ where: { clienteId: cliente.id } })]); if (proyectos || facturas) throw new ErrorHttp(409, "No se puede eliminar un cliente con proyectos o facturas"); await prisma.cliente.delete({ where: { id: cliente.id } }); res.status(204).end(); });
