import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";
import { exigirRolOrganizacion } from "../middleware/autenticacion.js";

export const rutasFacturas = Router();
const uuid = z.string().uuid();
const contextoOrg = (req: SolicitudAutenticada) => {
  const sesion = req.sesion!;
  if (sesion.tipoAcceso !== "ORGANIZACION") throw new ErrorHttp(403, "Acceso restringido a miembros de la organización");
  return sesion;
};
const MONEDAS_VALIDAS = new Set(Intl.supportedValuesOf("currency"));
const monedaSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "La moneda debe ser un código ISO 4217 de 3 letras")
  .refine((val) => MONEDAS_VALIDAS.has(val), "Código de moneda ISO 4217 no válido");

const montoSchema = z.coerce
  .number()
  .positive()
  .max(9_999_999_999.99, "El monto supera el valor máximo soportado")
  .refine((v) => Math.round(v * 100) <= 999_999_999_999, "El monto supera el valor máximo soportado");

const esquema = z.object({
  clienteId: uuid,
  proyectoId: uuid.optional().nullable(),
  numero: z.string().min(1).max(100),
  concepto: z.string().min(1).max(500),
  monto: montoSchema,
  moneda: monedaSchema.optional(),
  estado: z.enum(["BORRADOR", "ENVIADA", "PAGADA", "VENCIDA", "CANCELADA"]).optional(),
  fechaEmision: z.coerce.date().optional(),
  fechaVencimiento: z.coerce.date().optional().nullable(),
  notas: z.string().max(2000).optional().nullable()
});

const propia = async (id: string, organizacionId: string) => {
  const factura = await prisma.factura.findFirst({
    where: { id, organizacionId },
    include: {
      cliente: { select: { id: true, nombre: true, empresa: true, correo: true } },
      proyecto: { select: { id: true, nombre: true } }
    }
  });
  if (!factura) throw new ErrorHttp(404, "Factura no encontrada");
  return factura;
};

rutasFacturas.get("/", async (req: SolicitudAutenticada, res) => {
  const { organizacionId } = contextoOrg(req);
  const facturas = await prisma.factura.findMany({
    where: { organizacionId },
    include: {
      cliente: { select: { id: true, nombre: true, empresa: true, correo: true } },
      proyecto: { select: { id: true, nombre: true } }
    },
    orderBy: { fechaEmision: "desc" }
  });
  res.json(facturas);
});

rutasFacturas.get("/:id", async (req: SolicitudAutenticada, res) => {
  const { organizacionId } = contextoOrg(req);
  const factura = await propia(uuid.parse(req.params.id), organizacionId);
  res.json(factura);
});

rutasFacturas.post("/", exigirRolOrganizacion("PROPIETARIO"), async (req: SolicitudAutenticada, res) => {
  const datos = esquema.parse(req.body);
  const { organizacionId } = contextoOrg(req);

  if (!await prisma.cliente.findFirst({ where: { id: datos.clienteId, organizacionId } })) {
    throw new ErrorHttp(422, "El cliente no pertenece a tu organización");
  }
  if (datos.proyectoId && !await prisma.proyecto.findFirst({ where: { id: datos.proyectoId, clienteId: datos.clienteId, organizacionId } })) {
    throw new ErrorHttp(422, "El proyecto no coincide con el cliente");
  }

  const existente = await prisma.factura.findUnique({
    where: { organizacionId_numero: { organizacionId, numero: datos.numero } }
  });
  if (existente) {
    throw new ErrorHttp(409, `Ya existe una factura con el número ${datos.numero}`);
  }

  let moneda = datos.moneda;
  if (!moneda) {
    const org = await prisma.organizacion.findUnique({ where: { id: organizacionId }, select: { moneda: true } });
    moneda = org?.moneda || "PAB";
  }

  const estado = datos.estado || "ENVIADA";
  const pagadaEn = estado === "PAGADA" ? new Date() : null;

  const factura = await prisma.factura.create({
    data: {
      ...datos,
      moneda,
      estado,
      organizacionId,
      pagadaEn
    },
    include: {
      cliente: { select: { id: true, nombre: true, empresa: true, correo: true } },
      proyecto: { select: { id: true, nombre: true } }
    }
  });

  res.status(201).json(factura);
});

rutasFacturas.patch("/:id", exigirRolOrganizacion("PROPIETARIO"), async (req: SolicitudAutenticada, res) => {
  const { organizacionId } = contextoOrg(req);
  const f = await propia(uuid.parse(req.params.id), organizacionId);
  const esquemaActualizacion = esquema.partial().extend({
    pagadaEn: z.coerce.date().optional().nullable()
  });
  const datos = esquemaActualizacion.parse(req.body);

  if (datos.numero && datos.numero !== f.numero) {
    const existente = await prisma.factura.findUnique({
      where: { organizacionId_numero: { organizacionId, numero: datos.numero } }
    });
    if (existente) {
      throw new ErrorHttp(409, `Ya existe una factura con el número ${datos.numero}`);
    }
  }

  if (datos.clienteId && !await prisma.cliente.findFirst({ where: { id: datos.clienteId, organizacionId } })) {
    throw new ErrorHttp(422, "El cliente no pertenece a tu organización");
  }

  const clienteIdFinal = datos.clienteId ?? f.clienteId;
  const proyectoIdFinal = datos.proyectoId !== undefined ? datos.proyectoId : f.proyectoId;
  if (proyectoIdFinal && !await prisma.proyecto.findFirst({ where: { id: proyectoIdFinal, clienteId: clienteIdFinal, organizacionId } })) {
    throw new ErrorHttp(422, "El proyecto no coincide con el cliente");
  }

  const estadoFinal = datos.estado ?? f.estado;
  if (datos.pagadaEn !== undefined && datos.pagadaEn !== null && estadoFinal !== "PAGADA") {
    throw new ErrorHttp(422, "Solo las facturas en estado PAGADA pueden tener fecha de pago");
  }

  let pagadaEn: Date | null = null;
  if (estadoFinal === "PAGADA") {
    pagadaEn = datos.pagadaEn !== undefined ? (datos.pagadaEn ?? new Date()) : (f.pagadaEn ?? new Date());
  }

  const factura = await prisma.factura.update({
    where: { id: f.id },
    data: {
      ...datos,
      pagadaEn
    },
    include: {
      cliente: { select: { id: true, nombre: true, empresa: true, correo: true } },
      proyecto: { select: { id: true, nombre: true } }
    }
  });

  res.json(factura);
});

rutasFacturas.delete("/:id", exigirRolOrganizacion("PROPIETARIO"), async (req: SolicitudAutenticada, res) => {
  const { organizacionId } = contextoOrg(req);
  const f = await propia(uuid.parse(req.params.id), organizacionId);
  await prisma.factura.delete({ where: { id: f.id } });
  res.status(204).end();
});
