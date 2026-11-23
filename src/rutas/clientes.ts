import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";
import { registrarActividad } from "../utilidades/actividad.js";
import { rutasInvitacionesClientes } from "./invitaciones-clientes.js";

export const rutasClientes = Router();
rutasClientes.use("/:clienteId/invitaciones", rutasInvitacionesClientes);
const esUrlHttpSegura = (val: string) => {
  try {
    const parsed = new URL(val);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const urlHttpSegura = z
  .string()
  .url()
  .max(2048)
  .refine(esUrlHttpSegura, "Solo se permiten URLs con protocolo HTTP o HTTPS");

const esquema = z.object({
  nombre: z.string().min(2).max(200),
  empresa: z.string().max(200).optional().nullable(),
  correo: z.preprocess((val) => (val === "" ? null : val), z.string().email().max(254).nullable().optional()),
  telefono: z.string().max(50).optional().nullable(),
  direccion: z.string().max(500).optional().nullable(),
  sitioWeb: z.preprocess((val) => (val === "" ? null : val), urlHttpSegura.nullable().optional()),
  notasInternas: z.string().max(2000).optional().nullable(),
  estado: z.enum(["ACTIVO", "INACTIVO", "PROSPECTO", "ARCHIVADO"]).optional()
});
const queryClientesSchema = z.object({
  buscar: z.preprocess((val) => (val === "" ? undefined : val), z.string().trim().max(200).optional()),
  estado: z.preprocess((val) => (val === "" ? undefined : val), z.enum(["ACTIVO", "INACTIVO", "PROSPECTO", "ARCHIVADO"]).optional()),
});
const id = z.string().uuid();
const contextoOrg = (req: SolicitudAutenticada) => {
  const sesion = req.sesion!;
  if (sesion.tipoAcceso !== "ORGANIZACION") throw new ErrorHttp(403, "Acceso restringido a miembros de la organización");
  return sesion;
};
const pertenece = async (clienteId: string, organizacionId: string) => { const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, organizacionId } }); if (!cliente) throw new ErrorHttp(404, "Cliente no encontrado"); return cliente; };

rutasClientes.get("/", async (req: SolicitudAutenticada, res) => {
  const { organizacionId } = contextoOrg(req);
  const { buscar, estado } = queryClientesSchema.parse(req.query);
  const where = { organizacionId, ...(estado ? { estado } : {}), ...(buscar ? { OR: [{ nombre: { contains: buscar, mode: "insensitive" as const } }, { empresa: { contains: buscar, mode: "insensitive" as const } }] } : {}) };
  res.json(await prisma.cliente.findMany({
    where,
    include: {
      _count: { select: { proyectos: true } },
      proyectos: {
        orderBy: { actualizadoEn: "desc" },
        take: 1,
        include: {
          tareas: { select: { id: true, estado: true } }
        }
      },
      invitacionesCliente: {
        orderBy: { creadoEn: "desc" },
        take: 1,
        select: { id: true, estado: true, expiraEn: true }
      },
      accesosCliente: {
        where: { activo: true },
        take: 1,
        select: { id: true, activo: true }
      }
    },
    orderBy: { actualizadoEn: "desc" }
  }));
});
rutasClientes.post("/", async (req: SolicitudAutenticada, res) => {
  const { organizacionId, usuarioId } = contextoOrg(req);
  const datos = esquema.parse(req.body);
  if (!datos.estado) {
    datos.estado = "ACTIVO";
  }
  const cliente = await prisma.cliente.create({ data: { ...datos, organizacionId } });
  await registrarActividad({ organizacionId, usuarioId, entidad: "cliente", entidadId: cliente.id, accion: "CREAR", descripcion: `Creó el cliente ${cliente.nombre}` });
  res.status(201).json(cliente);
});
rutasClientes.get("/:id", async (req: SolicitudAutenticada, res) => {
  const { organizacionId } = contextoOrg(req);
  const clienteId = id.parse(req.params.id);
  await pertenece(clienteId, organizacionId);
  res.json(await prisma.cliente.findUnique({
    where: { id: clienteId },
    include: {
      proyectos: {
        orderBy: { creadoEn: "desc" },
        include: {
          tareas: { select: { id: true, estado: true } }
        }
      },
      facturas: { orderBy: { fechaEmision: "desc" } },
      invitacionesCliente: {
        orderBy: { creadoEn: "desc" },
        select: { id: true, correo: true, rol: true, estado: true, expiraEn: true, aceptadaEn: true, creadoEn: true },
      },
      accesosCliente: { select: { id: true, activo: true, rol: true, ultimoAccesoEn: true } }
    }
  }));
});
rutasClientes.patch("/:id", async (req: SolicitudAutenticada, res) => { const { organizacionId } = contextoOrg(req); const cliente = await pertenece(id.parse(req.params.id), organizacionId); res.json(await prisma.cliente.update({ where: { id: cliente.id }, data: esquema.partial().parse(req.body) })); });
rutasClientes.delete("/:id", async (req: SolicitudAutenticada, res) => {
  const { organizacionId } = contextoOrg(req);
  const cliente = await pertenece(id.parse(req.params.id), organizacionId);
  const [proyectos, facturas, sesiones] = await Promise.all([
    prisma.proyecto.count({ where: { clienteId: cliente.id } }),
    prisma.factura.count({ where: { clienteId: cliente.id } }),
    prisma.sesionFotografica.count({ where: { clienteId: cliente.id } }),
  ]);
  if (proyectos || facturas || sesiones) {
    throw new ErrorHttp(409, "No se puede eliminar un cliente con proyectos, facturas o sesiones fotográficas asociadas");
  }
  await prisma.cliente.delete({ where: { id: cliente.id } });
  res.status(204).end();
});
