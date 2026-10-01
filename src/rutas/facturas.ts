import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";

export const rutasFacturas = Router();
const uuid = z.string().uuid();
const esquema = z.object({ clienteId: uuid, proyectoId: uuid.optional().nullable(), numero: z.string().min(1), concepto: z.string().min(1), monto: z.coerce.number().positive(), moneda: z.string().length(3).optional(), estado: z.enum(["BORRADOR", "ENVIADA", "PAGADA", "VENCIDA", "CANCELADA"]).optional(), fechaEmision: z.coerce.date().optional(), fechaVencimiento: z.coerce.date().optional().nullable(), notas: z.string().optional().nullable() });
const propia = async (id: string, organizacionId: string) => { const factura = await prisma.factura.findFirst({ where: { id, organizacionId } }); if (!factura) throw new ErrorHttp(404, "Factura no encontrada"); return factura; };
rutasFacturas.get("/", async (req: SolicitudAutenticada, res) => res.json(await prisma.factura.findMany({ where: { organizacionId: req.sesion!.organizacionId }, include: { cliente: { select: { nombre: true, empresa: true } }, proyecto: { select: { nombre: true } } }, orderBy: { fechaEmision: "desc" } })));
rutasFacturas.post("/", async (req: SolicitudAutenticada, res) => { const datos = esquema.parse(req.body), organizacionId = req.sesion!.organizacionId; if (!await prisma.cliente.findFirst({ where: { id: datos.clienteId, organizacionId } })) throw new ErrorHttp(422, "El cliente no pertenece a tu organización"); if (datos.proyectoId && !await prisma.proyecto.findFirst({ where: { id: datos.proyectoId, clienteId: datos.clienteId, organizacionId } })) throw new ErrorHttp(422, "El proyecto no coincide con el cliente"); res.status(201).json(await prisma.factura.create({ data: { ...datos, organizacionId, ...(datos.estado === "PAGADA" && { pagadaEn: new Date() }) } })); });
rutasFacturas.patch("/:id", async (req: SolicitudAutenticada, res) => { const f = await propia(uuid.parse(req.params.id), req.sesion!.organizacionId); const datos = esquema.partial().parse(req.body); res.json(await prisma.factura.update({ where: { id: f.id }, data: { ...datos, ...(datos.estado === "PAGADA" && { pagadaEn: new Date() }) } })); });
rutasFacturas.delete("/:id", async (req: SolicitudAutenticada, res) => { const f = await propia(uuid.parse(req.params.id), req.sesion!.organizacionId); await prisma.factura.delete({ where: { id: f.id } }); res.status(204).end(); });
