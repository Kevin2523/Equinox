import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";
import { registrarActividad } from "../utilidades/actividad.js";

export const rutasFacturas = Router();
const uuid = z.string().uuid();

const montoEsquema = z.union([z.number(), z.string()]).transform((val, ctx) => {
  const texto = typeof val === "number" ? String(val) : val.trim();
  if ((typeof val === "number" && !Number.isFinite(val)) || !/^\d{1,10}(?:\.\d{1,2})?$/.test(texto)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "El monto debe ser positivo y tener como máximo dos decimales" });
    return z.NEVER;
  }
  const monto = new Prisma.Decimal(texto);
  if (!monto.greaterThan(0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "El monto debe ser positivo" });
    return z.NEVER;
  }
  return monto;
});

const estadosValidos = ["BORRADOR", "ENVIADA", "PAGADA", "VENCIDA", "CANCELADA"] as const;
const estadoEsquema = z.enum(estadosValidos);

const esquemaCrearFactura = z.object({
  clienteId: uuid,
  proyectoId: uuid.optional().nullable(),
  numero: z.string().trim().min(1).max(50).optional(),
  concepto: z.string().trim().min(1).max(500),
  monto: montoEsquema,
  moneda: z.string().trim().length(3).transform((m) => m.toUpperCase()).optional(),
  estado: estadoEsquema.optional(),
  visibleEnPortal: z.boolean().optional(),
  fechaEmision: z.coerce.date().optional(),
  fechaVencimiento: z.coerce.date().optional().nullable(),
  notas: z.string().trim().max(2000).optional().nullable(),
});

const esquemaEditarFactura = z.object({
  clienteId: uuid.optional(),
  proyectoId: uuid.optional().nullable(),
  concepto: z.string().trim().min(1).max(500).optional(),
  monto: montoEsquema.optional(),
  moneda: z.string().trim().length(3).transform((m) => m.toUpperCase()).optional(),
  estado: estadoEsquema.optional(),
  visibleEnPortal: z.boolean().optional(),
  fechaEmision: z.coerce.date().optional(),
  fechaVencimiento: z.coerce.date().optional().nullable(),
  notas: z.string().trim().max(2000).optional().nullable(),
  motivo: z.string().trim().max(500).optional(),
});

const esquemaPago = z.object({
  monto: montoEsquema,
  moneda: z.string().trim().length(3).transform((m) => m.toUpperCase()).optional(),
  metodo: z.string().trim().max(100).optional().nullable(),
  referencia: z.string().trim().max(100).optional().nullable(),
  notas: z.string().trim().max(1000).optional().nullable(),
});

function exigirPropietario(req: SolicitudAutenticada) {
  if (req.sesion?.tipoAcceso !== "ORGANIZACION" || req.sesion.rolOrganizacion !== "PROPIETARIO") {
    throw new ErrorHttp(403, "Solo el propietario de la organización puede emitir facturas o registrar pagos");
  }
}

async function facturaPropia(id: string, organizacionId: string) {
  const f = await prisma.factura.findFirst({
    where: { id, organizacionId },
    include: {
      cliente: { select: { id: true, nombre: true, empresa: true } },
      proyecto: { select: { id: true, nombre: true } },
      pagos: { orderBy: { creadoEn: "desc" } },
      historial: {
        include: { usuario: { select: { id: true, nombre: true, apellido: true } } },
        orderBy: { creadoEn: "desc" },
      },
    },
  });
  if (!f) throw new ErrorHttp(404, "Factura no encontrada");
  return f;
}

export async function obtenerSiguienteNumeroFactura(
  tx: Prisma.TransactionClient,
  organizacionId: string
): Promise<string> {
  // Inicializar secuencia con el mayor correlativo existente en facturas si la fila aún no existe
  await tx.$executeRaw`
    INSERT INTO "secuencias_facturas" ("id", "organizacion_id", "ultimo_numero", "actualizado_en")
    VALUES (
      gen_random_uuid(),
      ${organizacionId}::uuid,
      COALESCE((
        SELECT MAX(NULLIF(SUBSTRING("numero" FROM '^[iI][nN][vV]-([0-9]+)$'), '')::integer)
        FROM "facturas"
        WHERE "organizacion_id" = ${organizacionId}::uuid
      ), 0),
      NOW()
    )
    ON CONFLICT ("organizacion_id") DO NOTHING;
  `;

  const res = await tx.$queryRaw<Array<{ ultimo_numero: number }>>`
    UPDATE "secuencias_facturas"
    SET "ultimo_numero" = "ultimo_numero" + 1, "actualizado_en" = NOW()
    WHERE "organizacion_id" = ${organizacionId}::uuid
    RETURNING "ultimo_numero";
  `;
  let num = res[0].ultimo_numero;
  let candidato = `INV-${String(num).padStart(4, "0")}`;

  while (await tx.factura.findFirst({ where: { organizacionId, numero: candidato }, select: { id: true } })) {
    const inc = await tx.$queryRaw<Array<{ ultimo_numero: number }>>`
      UPDATE "secuencias_facturas"
      SET "ultimo_numero" = "ultimo_numero" + 1, "actualizado_en" = NOW()
      WHERE "organizacion_id" = ${organizacionId}::uuid
      RETURNING "ultimo_numero";
    `;
    num = inc[0].ultimo_numero;
    candidato = `INV-${String(num).padStart(4, "0")}`;
  }
  return candidato;
}

// GET /api/facturas/totales
rutasFacturas.get("/totales", async (req: SolicitudAutenticada, res, next) => {
  try {
    const organizacionId = req.sesion!.organizacionId;

    const facturas = await prisma.factura.findMany({
      where: { organizacionId },
      select: {
        id: true,
        monto: true,
        moneda: true,
        estado: true,
        pagos: { select: { monto: true } },
      },
    });

    const mapas = new Map<string, {
      moneda: string;
      totalPorCobrar: Prisma.Decimal;
      totalCobrado: Prisma.Decimal;
      facturasEmitidas: number;
      facturasPendientes: number;
      facturasPagadas: number;
    }>();

    for (const f of facturas) {
      const m = f.moneda || "PAB";
      if (!mapas.has(m)) {
        mapas.set(m, {
          moneda: m,
          totalPorCobrar: new Prisma.Decimal(0),
          totalCobrado: new Prisma.Decimal(0),
          facturasEmitidas: 0,
          facturasPendientes: 0,
          facturasPagadas: 0,
        });
      }
      const item = mapas.get(m)!;
      item.facturasEmitidas++;

      const pagadoFactura = f.pagos.reduce(
        (sum, p) => Prisma.Decimal.add(sum, p.monto),
        new Prisma.Decimal(0)
      );

      item.totalCobrado = Prisma.Decimal.add(item.totalCobrado, pagadoFactura);

      if (f.estado === "PAGADA") {
        item.facturasPagadas++;
      } else if (f.estado !== "CANCELADA") {
        item.facturasPendientes++;
        const pendiente = Prisma.Decimal.sub(f.monto, pagadoFactura);
        if (pendiente.greaterThan(0)) {
          item.totalPorCobrar = Prisma.Decimal.add(item.totalPorCobrar, pendiente);
        }
      }
    }

    const totalesPorMoneda = Array.from(mapas.values()).map((t) => ({
      moneda: t.moneda,
      totalPorCobrar: t.totalPorCobrar.toNumber(),
      totalCobrado: t.totalCobrado.toNumber(),
      totalPorCobrarDecimal: t.totalPorCobrar.toString(),
      totalCobradoDecimal: t.totalCobrado.toString(),
      facturasEmitidas: t.facturasEmitidas,
      facturasPendientes: t.facturasPendientes,
      facturasPagadas: t.facturasPagadas,
    }));

    res.json({ totalesPorMoneda });
  } catch (err) {
    next(err);
  }
});

// GET /api/facturas
rutasFacturas.get("/", async (req: SolicitudAutenticada, res, next) => {
  try {
    const organizacionId = req.sesion!.organizacionId;
    const { clienteId, proyectoId, estado, busqueda } = req.query;

    const where: Prisma.FacturaWhereInput = { organizacionId };

    if (clienteId && typeof clienteId === "string") {
      where.clienteId = uuid.parse(clienteId);
    }
    if (proyectoId && typeof proyectoId === "string") {
      where.proyectoId = uuid.parse(proyectoId);
    }
    if (estado && typeof estado === "string" && estadosValidos.includes(estado as any)) {
      where.estado = estado as any;
    }
    if (busqueda && typeof busqueda === "string" && busqueda.trim()) {
      const q = busqueda.trim();
      where.OR = [
        { numero: { contains: q, mode: "insensitive" } },
        { concepto: { contains: q, mode: "insensitive" } },
        { cliente: { nombre: { contains: q, mode: "insensitive" } } },
      ];
    }

    const facturas = await prisma.factura.findMany({
      where,
      include: {
        cliente: { select: { id: true, nombre: true, empresa: true } },
        proyecto: { select: { id: true, nombre: true } },
        pagos: { select: { id: true, monto: true, moneda: true, creadoEn: true } },
      },
      orderBy: [{ fechaEmision: "desc" }, { creadoEn: "desc" }],
    });

    const enriquecidas = facturas.map((f) => {
      const totalPagado = f.pagos.reduce(
        (sum, p) => Prisma.Decimal.add(sum, p.monto),
        new Prisma.Decimal(0)
      );
      const montoPendiente = Prisma.Decimal.sub(f.monto, totalPagado);
      return {
        ...f,
        monto: f.monto.toNumber(),
        totalPagado: totalPagado.toNumber(),
        montoPendiente: montoPendiente.toNumber(),
      };
    });

    res.json(enriquecidas);
  } catch (err) {
    next(err);
  }
});

// GET /api/facturas/:id
rutasFacturas.get("/:id", async (req: SolicitudAutenticada, res, next) => {
  try {
    const facturaId = uuid.parse(req.params.id);
    const organizacionId = req.sesion!.organizacionId;
    const f = await facturaPropia(facturaId, organizacionId);

    const totalPagado = f.pagos.reduce(
      (sum, p) => Prisma.Decimal.add(sum, p.monto),
      new Prisma.Decimal(0)
    );
    const montoPendiente = Prisma.Decimal.sub(f.monto, totalPagado);

    res.json({
      ...f,
      monto: f.monto.toNumber(),
      totalPagado: totalPagado.toNumber(),
      montoPendiente: montoPendiente.toNumber(),
      pagos: f.pagos.map((p) => ({
        ...p,
        monto: p.monto.toNumber(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/facturas
rutasFacturas.post("/", async (req: SolicitudAutenticada, res, next) => {
  try {
    exigirPropietario(req);
    const organizacionId = req.sesion!.organizacionId;
    const usuarioId = req.sesion!.usuarioId;
    const datos = esquemaCrearFactura.parse(req.body);

    const factura = await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.findFirst({
        where: { id: datos.clienteId, organizacionId },
        select: { id: true },
      });
      if (!cliente) throw new ErrorHttp(422, "El cliente no pertenece a tu organización");

      if (datos.proyectoId) {
        const p = await tx.proyecto.findFirst({
          where: { id: datos.proyectoId, clienteId: datos.clienteId, organizacionId },
          select: { id: true },
        });
        if (!p) throw new ErrorHttp(422, "El proyecto seleccionado no pertenece al cliente especificado");
      }

      let numero = datos.numero;
      if (numero) {
        const existente = await tx.factura.findUnique({
          where: { organizacionId_numero: { organizacionId, numero } },
          select: { id: true },
        });
        if (existente) throw new ErrorHttp(409, "El número de factura ya está en uso");
      } else {
        numero = await obtenerSiguienteNumeroFactura(tx, organizacionId);
      }

      const org = await tx.organizacion.findUnique({
        where: { id: organizacionId },
        select: { moneda: true },
      });
      const moneda = datos.moneda || org?.moneda || "PAB";
      const estado = datos.estado || "BORRADOR";
      if (estado === "PAGADA") throw new ErrorHttp(422, "Una factura solo queda pagada al registrar pagos por su monto completo");
      const visibleEnPortal =
        datos.visibleEnPortal !== undefined
          ? datos.visibleEnPortal
          : estado !== "BORRADOR";

      const nueva = await tx.factura.create({
        data: {
          organizacionId,
          clienteId: datos.clienteId,
          proyectoId: datos.proyectoId || null,
          numero,
          concepto: datos.concepto,
          monto: datos.monto,
          moneda,
          estado,
          visibleEnPortal,
          fechaEmision: datos.fechaEmision || new Date(),
          fechaVencimiento: datos.fechaVencimiento || null,
          pagadaEn: null,
          notas: datos.notas || null,
        },
        include: {
          cliente: { select: { nombre: true, empresa: true } },
          proyecto: { select: { nombre: true } },
        },
      });

      await tx.historialFactura.create({
        data: {
          facturaId: nueva.id,
          estadoAnterior: null,
          estadoNuevo: estado,
          usuarioId,
          motivo: "Emisión o creación de factura",
        },
      });

      await registrarActividad(
        {
          organizacionId,
          usuarioId,
          entidad: "factura",
          entidadId: nueva.id,
          accion: "CREAR",
          metadatos: { numero: nueva.numero, monto: nueva.monto.toString(), moneda: nueva.moneda },
        },
        tx
      );

      return nueva;
    });

    res.status(201).json(factura);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/facturas/:id
rutasFacturas.patch("/:id", async (req: SolicitudAutenticada, res, next) => {
  try {
    exigirPropietario(req);
    const facturaId = uuid.parse(req.params.id);
    const organizacionId = req.sesion!.organizacionId;
    const usuarioId = req.sesion!.usuarioId;
    const datos = esquemaEditarFactura.parse(req.body);

    const actualizada = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "facturas" WHERE "id" = ${facturaId}::uuid AND "organizacion_id" = ${organizacionId}::uuid FOR UPDATE`;
      const f = await tx.factura.findFirst({
        where: { id: facturaId, organizacionId },
      });
      if (!f) throw new ErrorHttp(404, "Factura no encontrada");

      const pagos = await tx.pago.aggregate({ where: { facturaId: f.id }, _sum: { monto: true }, _count: { id: true } });
      const abonado = pagos._sum.monto ?? new Prisma.Decimal(0);
      const montoFinal = datos.monto ?? f.monto;
      const monedaFinal = datos.moneda ?? f.moneda;
      const estadoFinal = datos.estado ?? f.estado;
      if (pagos._count.id > 0 && (!montoFinal.equals(f.monto) || monedaFinal !== f.moneda)) {
        throw new ErrorHttp(422, "No se puede cambiar monto ni moneda después de registrar pagos");
      }
      if (estadoFinal === "PAGADA" && !abonado.equals(montoFinal)) {
        throw new ErrorHttp(422, "El total de pagos debe cubrir exactamente el monto para marcar la factura pagada");
      }
      if (pagos._count.id > 0 && (estadoFinal === "CANCELADA" || (abonado.equals(montoFinal) && estadoFinal !== "PAGADA"))) {
        throw new ErrorHttp(422, "El estado no es compatible con los pagos registrados");
      }

      if (datos.clienteId && datos.clienteId !== f.clienteId) {
        const c = await tx.cliente.findFirst({
          where: { id: datos.clienteId, organizacionId },
          select: { id: true },
        });
        if (!c) throw new ErrorHttp(422, "El cliente no pertenece a tu organización");
      }

      const clienteRef = datos.clienteId !== undefined ? datos.clienteId : f.clienteId;
      const proyectoRef = datos.proyectoId !== undefined ? datos.proyectoId : f.proyectoId;

      if (proyectoRef) {
        const p = await tx.proyecto.findFirst({
          where: { id: proyectoRef, clienteId: clienteRef, organizacionId },
          select: { id: true },
        });
        if (!p) throw new ErrorHttp(422, "El proyecto no pertenece al cliente de la factura");
      }

      const dataParaActualizar: Prisma.FacturaUpdateInput = {};
      if (datos.concepto !== undefined) dataParaActualizar.concepto = datos.concepto;
      if (datos.monto !== undefined) dataParaActualizar.monto = datos.monto;
      if (datos.moneda !== undefined) dataParaActualizar.moneda = datos.moneda;
      if (datos.fechaEmision !== undefined) dataParaActualizar.fechaEmision = datos.fechaEmision;
      if (datos.fechaVencimiento !== undefined) dataParaActualizar.fechaVencimiento = datos.fechaVencimiento;
      if (datos.notas !== undefined) dataParaActualizar.notas = datos.notas;
      if (datos.visibleEnPortal !== undefined) dataParaActualizar.visibleEnPortal = datos.visibleEnPortal;
      if (datos.clienteId !== undefined) dataParaActualizar.cliente = { connect: { id: datos.clienteId } };
      if (datos.proyectoId !== undefined) {
        dataParaActualizar.proyecto = datos.proyectoId
          ? { connect: { id: datos.proyectoId } }
          : { disconnect: true };
      }

      const cambioEstado = datos.estado !== undefined && datos.estado !== f.estado;
      const cambioImporte = !montoFinal.equals(f.monto) || monedaFinal !== f.moneda;
      if (cambioEstado) {
        dataParaActualizar.estado = datos.estado;
        if (datos.estado === "PAGADA") {
          dataParaActualizar.pagadaEn = new Date();
        } else if (f.estado === "PAGADA") {
          dataParaActualizar.pagadaEn = null;
        }
      }

      const facturaModificada = await tx.factura.update({
        where: { id: f.id },
        data: dataParaActualizar,
        include: {
          cliente: { select: { nombre: true, empresa: true } },
          proyecto: { select: { nombre: true } },
        },
      });

      if (cambioEstado || cambioImporte) {
        await tx.historialFactura.create({
          data: {
            facturaId: f.id,
            estadoAnterior: f.estado,
            estadoNuevo: estadoFinal,
            usuarioId,
            motivo: datos.motivo || (cambioImporte
              ? `Importe actualizado: ${f.monto} ${f.moneda} a ${montoFinal} ${monedaFinal}`
              : "Actualización de estado"),
          },
        });
      }

      await registrarActividad(
        {
          organizacionId,
          usuarioId,
          entidad: "factura",
          entidadId: f.id,
          accion: "EDITAR",
          metadatos: {
            cambioEstado,
            estadoNuevo: datos.estado,
          },
        },
        tx
      );

      return facturaModificada;
    });

    res.json(actualizada);
  } catch (err) {
    next(err);
  }
});

// POST /api/facturas/:id/pagos
rutasFacturas.post("/:id/pagos", async (req: SolicitudAutenticada, res, next) => {
  try {
    exigirPropietario(req);
    const facturaId = uuid.parse(req.params.id);
    const organizacionId = req.sesion!.organizacionId;
    const usuarioId = req.sesion!.usuarioId;
    const datos = esquemaPago.parse(req.body);

    const resultado = await prisma.$transaction(async (tx) => {
      // Bloqueo pesimista FOR UPDATE para sincronizar pagos concurrentes
      const filas = await tx.$queryRaw<Array<{
        id: string;
        organizacion_id: string;
        cliente_id: string;
        proyecto_id: string | null;
        numero: string;
        concepto: string;
        monto: Prisma.Decimal;
        moneda: string;
        estado: "BORRADOR" | "ENVIADA" | "PAGADA" | "VENCIDA" | "CANCELADA";
        visible_en_portal: boolean;
        fecha_emision: Date;
        fecha_vencimiento: Date | null;
        pagada_en: Date | null;
        notas: string | null;
      }>>`
        SELECT * FROM "facturas"
        WHERE "id" = ${facturaId}::uuid AND "organizacion_id" = ${organizacionId}::uuid
        FOR UPDATE
      `;
      if (!filas.length) throw new ErrorHttp(404, "Factura no encontrada");
      const f = {
        id: filas[0].id,
        organizacionId: filas[0].organizacion_id,
        clienteId: filas[0].cliente_id,
        proyectoId: filas[0].proyecto_id,
        numero: filas[0].numero,
        concepto: filas[0].concepto,
        monto: filas[0].monto,
        moneda: filas[0].moneda,
        estado: filas[0].estado,
        visibleEnPortal: filas[0].visible_en_portal,
        fechaEmision: filas[0].fecha_emision,
        fechaVencimiento: filas[0].fecha_vencimiento,
        pagadaEn: filas[0].pagada_en,
        notas: filas[0].notas,
      };

      if (f.estado === "CANCELADA") {
        throw new ErrorHttp(422, "No se pueden registrar pagos en facturas canceladas");
      }
      if (f.estado === "PAGADA") {
        throw new ErrorHttp(422, "La factura ya se encuentra pagada");
      }

      if (datos.moneda && datos.moneda !== f.moneda) {
        throw new ErrorHttp(422, `La moneda del pago (${datos.moneda}) no coincide con la moneda de la factura (${f.moneda})`);
      }

      const totalPrevio = await tx.pago.aggregate({
        where: { facturaId: f.id },
        _sum: { monto: true },
      });
      const pagadoAntes = totalPrevio._sum.monto ?? new Prisma.Decimal(0);
      const saldoPendiente = Prisma.Decimal.sub(f.monto, pagadoAntes);

      if (datos.monto.greaterThan(saldoPendiente)) {
        throw new ErrorHttp(
          422,
          `El monto del pago (${datos.monto}) supera el saldo pendiente (${saldoPendiente})`
        );
      }

      const pago = await tx.pago.create({
        data: {
          facturaId: f.id,
          monto: datos.monto,
          moneda: f.moneda,
          metodo: datos.metodo || null,
          referencia: datos.referencia || null,
          notas: datos.notas || null,
          registradoPorId: usuarioId,
        },
      });

      const nuevoTotal = Prisma.Decimal.add(pagadoAntes, datos.monto);
      let facturaActualizada = f;

      if (nuevoTotal.greaterThanOrEqualTo(f.monto)) {
        facturaActualizada = await tx.factura.update({
          where: { id: f.id },
          data: {
            estado: "PAGADA",
            pagadaEn: new Date(),
          },
        });

        await tx.historialFactura.create({
          data: {
            facturaId: f.id,
            estadoAnterior: f.estado,
            estadoNuevo: "PAGADA",
            usuarioId,
            motivo: `Pago total registrado: factura saldada con pago ${pago.id}`,
          },
        });
      } else {
        await tx.historialFactura.create({
          data: {
            facturaId: f.id,
            estadoAnterior: f.estado,
            estadoNuevo: f.estado,
            usuarioId,
            motivo: `Pago parcial registrado: ${datos.monto} ${f.moneda}`,
          },
        });
      }

      await registrarActividad(
        {
          organizacionId,
          usuarioId,
          entidad: "factura",
          entidadId: f.id,
          accion: "REGISTRAR_PAGO",
          metadatos: {
            pagoId: pago.id,
            monto: datos.monto.toString(),
            moneda: f.moneda,
            saldada: nuevoTotal.greaterThanOrEqualTo(f.monto),
          },
        },
        tx
      );

      return { pago, factura: facturaActualizada, saldoRestante: Prisma.Decimal.sub(f.monto, nuevoTotal).toNumber() };
    });

    res.status(201).json(resultado);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/facturas/:id
rutasFacturas.delete("/:id", async (req: SolicitudAutenticada, res, next) => {
  try {
    exigirPropietario(req);
    const facturaId = uuid.parse(req.params.id);
    const organizacionId = req.sesion!.organizacionId;
    const usuarioId = req.sesion!.usuarioId;

    await prisma.$transaction(async (tx) => {
      const f = await tx.factura.findFirst({
        where: { id: facturaId, organizacionId },
        select: { id: true, numero: true },
      });
      if (!f) throw new ErrorHttp(404, "Factura no encontrada");

      const totalPagos = await tx.pago.count({ where: { facturaId: f.id } });
      if (totalPagos > 0) {
        throw new ErrorHttp(409, "No se puede eliminar una factura que tiene pagos registrados");
      }

      await tx.factura.delete({ where: { id: f.id } });

      await registrarActividad(
        {
          organizacionId,
          usuarioId,
          entidad: "factura",
          entidadId: f.id,
          accion: "ELIMINAR",
          metadatos: { numero: f.numero },
        },
        tx
      );
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
