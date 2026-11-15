import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Request, Response } from "express";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { LimitadorMemoria } from "../src/middleware/rate-limit.js";
import { hooksPruebas } from "../src/utilidades/hooks-pruebas.js";
import { hashTokenInvitacion, obtenerHorasExpiracion } from "../src/utilidades/invitaciones.js";
import {
  limitadorConsultaGlobalIp, limitadorConsultaEspecifico,
  limitadorAceptacionGlobalIp, limitadorAceptacionEspecifico,
} from "../src/rutas/invitaciones-publicas.js";

interface Contexto {
  urlApi: string;
  clienteId: string;
  organizacionId: string;
  usuarioId: string;
  tokenProp: string;
  tokenBeta: string;
  tokenCliente: string;
}

const limitadores = [limitadorConsultaGlobalIp, limitadorConsultaEspecifico,
  limitadorAceptacionGlobalIp, limitadorAceptacionEspecifico];

function sinSecretos(valor: unknown, secretos: string[]) {
  const texto = typeof valor === "string" ? valor : JSON.stringify(valor);
  for (const secreto of secretos) assert.ok(!texto.includes(secreto), "No debe exponerse material secreto");
}

async function sinTokenEnPostgres(tokens: string[]) {
  const tablas = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  for (const { tablename } of tablas) {
    assert.ok(/^[a-z_]+$/.test(tablename), "Identificador de tabla seguro");
    const resultado = await prisma.$queryRawUnsafe<Array<{ filtrado: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM "${tablename}" t, unnest($1::text[]) s(token)
       WHERE strpos(to_jsonb(t)::text, s.token) > 0) AS filtrado`, tokens);
    assert.equal(resultado[0].filtrado, false, "Ninguna tabla debe persistir tokens planos");
  }
}

async function capturarLogs<T>(accion: () => Promise<T>) {
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  const logs: string[] = [];
  const capturar = (chunk: any, ...args: any[]) => {
    logs.push(String(chunk));
    const callback = args.find(a => typeof a === "function");
    if (callback) callback();
    return true;
  };
  try {
    process.stdout.write = capturar as typeof stdout;
    process.stderr.write = capturar as typeof stderr;
    const resultado = await accion();
    return { resultado, logs: logs.join("") };
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}

export async function ejecutarBloqueos(ctx: Contexto): Promise<number> {
  assert.equal(process.env.NODE_ENV, "test");
  const destino = new URL(process.env.DATABASE_URL || "");
  assert.equal(destino.pathname, "/equinox_issue4_test");
  const base = `/api/clientes/${ctx.clienteId}/invitaciones`;
  let completados = 0;
  const secretos: string[] = [];
  async function caso(nombre: string, ejecutar: () => Promise<void>) {
    hooksPruebas.limpiar();
    for (const l of limitadores) { l.reiniciar(); l.configurarCapacidadPrueba(null); }
    try {
      await ejecutar();
      completados++;
      console.log(`[bloqueos] Caso ${35 + completados} OK: ${nombre}`);
    } finally {
      hooksPruebas.limpiar();
      for (const l of limitadores) { l.reiniciar(); l.configurarCapacidadPrueba(null); }
    }
  }
  async function solicitud(ruta: string, metodo = "GET", datos?: object, token = ctx.tokenProp, url = ctx.urlApi, headers: Record<string, string> = {}) {
    const res = await fetch(`${url}${ruta}`, {
      method: metodo,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...headers },
      ...(datos ? { body: JSON.stringify(datos) } : {}),
    });
    return { status: res.status, headers: res.headers, body: await res.json() as any };
  }
  const reenviar = (id: string) => solicitud(`${base}/${id}/reenviar`, "POST");
  const leer = (id: string) => prisma.invitacionCliente.findUniqueOrThrow({ where: { id } });
  const actividades = (id: string, accion = "REENVIAR") => prisma.actividad.count({ where: { entidadId: id, accion } });
  const ahora = new Date("2030-04-05T12:00:00.000Z");
  let secuencia = 0;
  async function fixture(estado: "PENDIENTE" | "EXPIRADA" = "PENDIENTE", delta = -1, correo?: string) {
    const token = `centinela_bloqueos_${++secuencia}_solo_pruebas_123456789`;
    secretos.push(token);
    const inv = await prisma.invitacionCliente.create({ data: {
      clienteId: ctx.clienteId, organizacionId: ctx.organizacionId, invitadoPorId: ctx.usuarioId,
      correo: correo || `bloqueo.${secuencia}@example.test`, rol: "TITULAR", estado,
      tokenHash: hashTokenInvitacion(token), expiraEn: new Date(ahora.getTime() + delta),
    } });
    return { inv, token };
  }
  function versionIgual(actual: Awaited<ReturnType<typeof leer>>, anterior: Awaited<ReturnType<typeof leer>>) {
    assert.equal(actual.estado, anterior.estado);
    assert.ok(actual.tokenHash === anterior.tokenHash, "El hash previo debe conservarse");
    assert.equal(actual.expiraEn.getTime(), anterior.expiraEn.getTime());
  }

  // Se arranca una aplicación nueva: Morgan y Express también se configuran en producción.
  const hijo = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "test/servidor-produccion-invitaciones.ts"], {
    env: { ...process.env, NODE_ENV: "production", ENTORNO: "produccion" },
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
  });
  const salidaHijo: string[] = [];
  hijo.stdout!.on("data", b => salidaHijo.push(String(b)));
  hijo.stderr!.on("data", b => salidaHijo.push(String(b)));
  const cerrado = once(hijo, "exit");
  let creacion: any;
  let tokenInicial = "";
  let tokenNuevo = "";
  try {
    const mensaje = await Promise.race([
      once(hijo, "message"),
      cerrado.then(() => { throw new Error("El servidor de producción terminó antes de iniciar"); }),
    ]);
    const urlProduccion = `http://127.0.0.1:${(mensaje[0] as any).puerto}`;
    await caso("Producción: creación autenticada y controles de acceso", async () => {
      const rutaPrueba = await fetch(`${urlProduccion}/__prueba_ip__`);
      assert.equal(rutaPrueba.status, 404);
      for (const [credencial, esperado] of [["", 401], [ctx.tokenBeta, 404], [ctx.tokenCliente, 403]] as const) {
        const r = await solicitud(base, "POST", { correo: "produccion@example.test" }, credencial, urlProduccion);
        assert.equal(r.status, esperado);
        assert.ok(!r.body.enlaceInvitacion);
      }
      const r = await solicitud(base, "POST", { correo: "produccion@example.test" }, ctx.tokenProp, urlProduccion);
      assert.equal(r.status, 201);
      assert.equal(r.headers.get("cache-control"), "no-store");
      creacion = r.body.invitacion;
      assert.ok(typeof r.body.enlaceInvitacion === "string");
      tokenInicial = new URL(r.body.enlaceInvitacion).pathname.split("/").pop()!;
      secretos.push(tokenInicial);
      const persistida = await leer(creacion.id);
      assert.ok(persistida.tokenHash === hashTokenInvitacion(tokenInicial));
      assert.equal(await actividades(creacion.id, "INVITAR"), 1);
      sinSecretos(creacion, [tokenInicial, persistida.tokenHash]);
    });
    await caso("Producción: reenvío entrega únicamente el enlace nuevo", async () => {
      for (const [credencial, esperado] of [["", 401], [ctx.tokenBeta, 404], [ctx.tokenCliente, 403]] as const) {
        const r = await solicitud(`${base}/${creacion.id}/reenviar`, "POST", undefined, credencial, urlProduccion);
        assert.equal(r.status, esperado);
        assert.ok(!r.body.enlaceInvitacion);
      }
      const r = await solicitud(`${base}/${creacion.id}/reenviar`, "POST", undefined, ctx.tokenProp, urlProduccion);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), "no-store");
      tokenNuevo = new URL(r.body.enlaceInvitacion).pathname.split("/").pop()!;
      secretos.push(tokenNuevo);
      assert.ok(tokenInicial !== tokenNuevo);
      sinSecretos(r.body, [tokenInicial]);
      assert.ok((await leer(creacion.id)).tokenHash === hashTokenInvitacion(tokenNuevo));
      assert.equal(await actividades(creacion.id), 1);
    });
    await caso("Producción: consultas, errores, auditoría y PostgreSQL sin token plano", async () => {
      const reservados = [tokenInicial, tokenNuevo, hashTokenInvitacion(tokenInicial), hashTokenInvitacion(tokenNuevo)];
      for (const [ruta, esperado] of [[base, 200], [`/api/invitaciones/${tokenInicial}`, 404], [`/api/invitaciones/${tokenNuevo}`, 200]] as const) {
        const r = await solicitud(ruta, "GET", undefined, ctx.tokenProp, urlProduccion,
          { Referer: `https://ejemplo.test/invitacion/${tokenNuevo}` });
        assert.equal(r.status, esperado);
        sinSecretos(r.body, reservados);
        assert.ok(!JSON.stringify(r.body).includes("enlaceInvitacion"));
      }
      await solicitud(`${base}/${creacion.id}/revocar`, "POST", undefined, ctx.tokenProp, urlProduccion);
      const anterior = await leer(creacion.id);
      const fallo = await solicitud(`${base}/${creacion.id}/reenviar`, "POST", undefined, ctx.tokenProp, urlProduccion);
      assert.equal(fallo.status, 409);
      assert.ok(!fallo.body.enlaceInvitacion);
      versionIgual(await leer(creacion.id), anterior);
      assert.equal(await actividades(creacion.id), 1);
      sinSecretos(fallo.body, reservados);
      sinSecretos(await prisma.actividad.findMany(), reservados);
      await sinTokenEnPostgres([tokenInicial, tokenNuevo]);
    });
    await caso("Producción: logs redactan URL, Referer y saturación por IP", async () => {
      for (let i = 0; i < 31; i++) {
        const r = await solicitud(`/api/invitaciones/${tokenNuevo}`, "GET", undefined, "", urlProduccion,
          { Referer: `https://ejemplo.test/invitacion/${tokenNuevo}` });
        if (i === 30) {
          assert.equal(r.status, 429);
          assert.ok(Number(r.headers.get("retry-after")) > 0);
          assert.equal(r.headers.get("x-ratelimit-id"), null);
          sinSecretos(r.body, [tokenNuevo, hashTokenInvitacion(tokenNuevo), "127.0.0.1"]);
        }
      }
      hijo.send("cerrar");
      const [codigo] = await cerrado;
      assert.equal(codigo, 0);
      const logs = salidaHijo.join("");
      assert.ok(logs.includes("[REDACTADO]"));
      sinSecretos(logs, [tokenInicial, tokenNuevo, hashTokenInvitacion(tokenInicial), hashTokenInvitacion(tokenNuevo)]);
      const publicos = logs.split("\n").filter(l => l.includes("/api/invitaciones/"));
      assert.ok(publicos.some(l => l.includes(" 429 ")));
      sinSecretos(publicos, ["127.0.0.1"]);
    });
  } finally {
    if (hijo.exitCode === null) { hijo.kill(); await cerrado; }
  }

  for (const operacion of ["crear", "reenviar"] as const) {
    await caso(`Rollback real después de ${operacion}: sin enlace ni actividad`, async () => {
      const { inv } = await fixture("PENDIENTE", 1000);
      const centinela = `centinela_rollback_${operacion}_123456789`;
      secretos.push(centinela);
      hooksPruebas.fijarReloj(ahora);
      hooksPruebas.encolarTokens([centinela]);
      hooksPruebas.registrarInyectorFallo(`despues_${operacion}_invitacion`, () =>
        new Error(`Diagnóstico sensible simulado ${centinela} ${hashTokenInvitacion(centinela)}`));
      const cantidad = await prisma.invitacionCliente.count();
      const totalActividad = await prisma.actividad.count();
      const entornoPrevio = process.env.ENTORNO;
      try {
        process.env.ENTORNO = "produccion"; // Hooks siguen exclusivamente en NODE_ENV=test.
        const { resultado: r, logs } = await capturarLogs(() => operacion === "crear"
          ? solicitud(base, "POST", { correo: inv.correo }) : reenviar(inv.id));
        assert.equal(r.status, 500);
        assert.ok(!r.body.enlaceInvitacion);
        sinSecretos(r.body, [centinela, hashTokenInvitacion(centinela)]);
        sinSecretos(logs, [centinela, hashTokenInvitacion(centinela)]);
        versionIgual(await leer(inv.id), inv);
        assert.equal(await prisma.invitacionCliente.count(), cantidad);
        assert.equal(await prisma.actividad.count(), totalActividad);
        await sinTokenEnPostgres([centinela]);
      } finally { process.env.ENTORNO = entornoPrevio; }
    });
  }

  await caso("LimitadorMemoria real conserva contadores y libera solo expirados", async () => {
    const l = new LimitadorMemoria(1000, 2, "Espere", 2);
    const ejecutar = (clave: string) => {
      let pasa = false, status = 200;
      const headers: Record<string, string> = {};
      const res = { setHeader: (k: string, v: string) => { headers[k] = v; },
        status: (s: number) => { status = s; return res; }, json: () => res };
      l.limitar(() => clave)({} as Request, res as unknown as Response, () => { pasa = true; });
      return { pasa, status, headers };
    };
    try {
      hooksPruebas.fijarReloj(ahora);
      assert.equal(ejecutar("activa").pasa, true);
      assert.equal(ejecutar("activa").pasa, true);
      hooksPruebas.fijarReloj(new Date(ahora.getTime() + 500));
      assert.equal(ejecutar("segunda").pasa, true);
      const rechazo = ejecutar("tercera");
      assert.equal(rechazo.status, 429);
      assert.equal(rechazo.pasa, false);
      assert.equal(rechazo.headers["Retry-After"], "1");
      assert.equal(ejecutar("activa").status, 429);
      assert.equal(l.tamano(), 2);
      hooksPruebas.fijarReloj(new Date(ahora.getTime() + 1000));
      assert.equal(ejecutar("tercera").pasa, true);
      assert.equal(l.tamano(), 2);
      assert.equal(ejecutar("segunda").pasa, true);
      assert.equal(ejecutar("segunda").status, 429);
      assert.equal(ejecutar("cuarta").status, 429);
    } finally { l.detener(); }
  });

  // Cada uno de los cuatro almacenes reales se llena mediante HTTP, sin precargar claves.
  for (const [indice, limite, aceptar, global] of [[0, 60, false, true], [1, 30, false, false],
    [2, 15, true, true], [3, 5, true, false]] as const) {
    await caso(`Capacidad HTTP real: ${aceptar ? "aceptación" : "consulta"} ${global ? "IP" : "IP + hash"}`, async () => {
      const trust = aplicacion.get("trust proxy");
      const l = limitadores[indice];
      const t1 = `centinela_capacidad_${indice}_a_123456789`;
      const t2 = `centinela_capacidad_${indice}_b_123456789`;
      const ip1 = "198.51.100.201", ip2 = "198.51.100.202";
      try {
        aplicacion.set("trust proxy", 1);
        hooksPruebas.fijarReloj(ahora);
        l.configurarCapacidadPrueba(1);
        const pedir = (token: string, ip: string) => solicitud(`/api/invitaciones/${token}${aceptar ? "/aceptar" : ""}`,
          aceptar ? "POST" : "GET", undefined, "", ctx.urlApi,
          { "X-Forwarded-For": ip, Referer: `https://ejemplo.test/invitacion/${token}` });
        const { logs } = await capturarLogs(async () => {
          for (let n = 0; n < limite; n++) assert.equal((await pedir(global ? `${t1}_${n}` : t1, ip1)).status, 404);
          const rechazo = await pedir(t2, global ? ip2 : ip1);
          assert.equal(rechazo.status, 429);
          assert.equal(rechazo.headers.get("retry-after"), "60");
          assert.ok(rechazo.headers.get("x-ratelimit-id")?.includes(global ? "global-ip" : "especifico-token"));
          sinSecretos(rechazo.body, [t1, t2, ip1, ip2, hashTokenInvitacion(t1), hashTokenInvitacion(t2)]);
          assert.equal(l.tamano(), 1);
          assert.equal((await pedir(t1, ip1)).status, 429);
          hooksPruebas.fijarReloj(new Date(ahora.getTime() + 60000));
          assert.equal((await pedir(t2, global ? ip2 : ip1)).status, 404);
          assert.equal(l.tamano(), 1);
        });
        assert.ok(logs.includes("[REDACTADO]"));
        sinSecretos(logs, [t1, t2, ip1, ip2, hashTokenInvitacion(t1), hashTokenInvitacion(t2)]);
      } finally { aplicacion.set("trust proxy", trust); }
    });
  }

  await caso("Reloj y capacidad de prueba se ignoran fuera de NODE_ENV=test", async () => {
    const l = new LimitadorMemoria(60000, 1, "Espere", 3);
    const entorno = process.env.NODE_ENV;
    let paso = 0;
    const res = { setHeader: () => {}, status: () => res, json: () => res } as unknown as Response;
    try {
      l.configurarCapacidadPrueba(1);
      hooksPruebas.fijarReloj(ahora);
      process.env.NODE_ENV = "production";
      l.configurarCapacidadPrueba(1);
      assert.ok(hooksPruebas.obtenerAhora().getTime() !== ahora.getTime());
      l.limitar(() => "uno")({} as Request, res, () => paso++);
      l.limitar(() => "dos")({} as Request, res, () => paso++);
      l.reiniciar();
      l.limitar(() => "uno")({} as Request, res, () => paso++);
      assert.equal(paso, 2);
      assert.equal(l.tamano(), 2);
    } finally { process.env.NODE_ENV = entorno; l.detener(); }
  });

  for (const [estado, delta, nombre] of [["PENDIENTE", -1, "vencida"], ["PENDIENTE", 0, "límite exacto"],
    ["EXPIRADA", -1, "EXPIRADA persistida"]] as const) {
    await caso(`Reenvío ${nombre}: nuevo hash, validez, actividad y enlace`, async () => {
      const { inv, token } = await fixture(estado, delta);
      hooksPruebas.fijarReloj(ahora);
      const nuevo = `centinela_renovacion_${secuencia}_123456789`;
      secretos.push(nuevo);
      hooksPruebas.encolarTokens([nuevo]);
      const r = await reenviar(inv.id);
      assert.equal(r.status, 200);
      assert.ok(r.body.enlaceInvitacion.endsWith(`/invitacion/${nuevo}`));
      const final = await leer(inv.id);
      assert.equal(final.estado, "PENDIENTE");
      assert.ok(final.tokenHash === hashTokenInvitacion(nuevo) && final.tokenHash !== inv.tokenHash);
      assert.equal(final.expiraEn.getTime(), ahora.getTime() + obtenerHorasExpiracion() * 3600000);
      assert.equal(await actividades(inv.id), 1);
      assert.equal((await solicitud(`/api/invitaciones/${token}`)).status, 404);
      assert.equal((await solicitud(`/api/invitaciones/${token}/aceptar`, "POST", { nombre: "Cliente", contrasena: "Password123!" })).status, 404);
      assert.equal((await solicitud(`/api/invitaciones/${nuevo}`)).status, 200);
      sinSecretos(await prisma.actividad.findMany({ where: { entidadId: inv.id } }), [token, nuevo, inv.tokenHash, final.tokenHash]);
    });
  }

  await caso("Vence entre lectura y CAS: usa el instante transaccional", async () => {
    const { inv } = await fixture("PENDIENTE", 1);
    hooksPruebas.fijarReloj(ahora);
    hooksPruebas.registrar("antes_reenviar_invitacion", () => hooksPruebas.fijarReloj(inv.expiraEn));
    const r = await reenviar(inv.id);
    assert.equal(r.status, 200);
    const final = await leer(inv.id);
    assert.equal(final.estado, "PENDIENTE");
    assert.ok(final.tokenHash !== inv.tokenHash && Boolean(r.body.enlaceInvitacion));
    assert.equal(final.expiraEn.getTime(), inv.expiraEn.getTime() + obtenerHorasExpiracion() * 3600000);
    assert.equal(await actividades(inv.id), 1);
  });

  for (const estado of ["EXPIRADA", "PENDIENTE"] as const) {
    await caso(`Otra pendiente al reenviar ${estado}: conflicto sin sobrescritura`, async () => {
      const { inv } = await fixture(estado);
      hooksPruebas.fijarReloj(ahora);
      let otraId = "";
      const insertarOtra = async () => {
        // Dos PENDIENTE del mismo correo son imposibles por el índice. En el caso
        // por fecha se reproduce la carrera real: otra operación expira y crea.
        if (estado === "PENDIENTE") await prisma.invitacionCliente.update({ where: { id: inv.id }, data: { estado: "EXPIRADA" } });
        otraId = (await fixture("PENDIENTE", 10000, inv.correo)).inv.id;
      };
      if (estado === "EXPIRADA") await insertarOtra();
      else hooksPruebas.registrar("antes_reenviar_invitacion", insertarOtra);
      const r = await reenviar(inv.id);
      assert.equal(r.status, 409);
      assert.ok(!r.body.enlaceInvitacion);
      versionIgual(await leer(inv.id), { ...inv, estado: "EXPIRADA" });
      assert.equal((await leer(otraId)).estado, "PENDIENTE");
      assert.equal(await actividades(inv.id), 0);
      assert.equal(await prisma.invitacionCliente.count({ where: { clienteId: ctx.clienteId, correo: inv.correo, estado: "PENDIENTE" } }), 1);
    });
  }

  for (const operacion of ["aceptar", "revocar", "reenviar", "vencimiento", "expirar"] as const) {
    await caso(`Carrera determinista: ${operacion} gana al reenvío`, async () => {
      const { inv, token } = await fixture("PENDIENTE", operacion === "expirar" ? -1 : 60000);
      hooksPruebas.fijarReloj(ahora);
      let versionGanadora = inv;
      let entro = false;
      hooksPruebas.registrar("antes_reenviar_invitacion", async () => {
        if (entro) return;
        entro = true;
        if (operacion === "vencimiento") {
          await prisma.invitacionCliente.update({ where: { id: inv.id }, data: { expiraEn: new Date(ahora.getTime() - 1) } });
        } else if (operacion === "expirar") {
          assert.equal((await solicitud(`/api/invitaciones/${token}`)).status, 410);
        } else {
          const r = operacion === "aceptar"
            ? await solicitud(`/api/invitaciones/${token}/aceptar`, "POST", { nombre: "Cliente", contrasena: "Password123!" })
            : await solicitud(`${base}/${inv.id}/${operacion}`, "POST");
          assert.equal(r.status, 200);
        }
        versionGanadora = await leer(inv.id);
      });
      const r = await reenviar(inv.id);
      assert.equal(r.status, 409);
      assert.ok(!r.body.enlaceInvitacion);
      versionIgual(await leer(inv.id), versionGanadora);
      assert.equal(await actividades(inv.id), operacion === "reenviar" ? 1 : 0);
      if (operacion === "aceptar") {
        assert.equal(versionGanadora.estado, "ACEPTADA");
        assert.equal(await actividades(inv.id, "ACEPTAR"), 1);
      }
      if (operacion === "revocar") {
        assert.equal(versionGanadora.estado, "REVOCADA");
        assert.equal(await actividades(inv.id, "REVOCAR"), 1);
      }
      if (operacion === "expirar" || operacion === "vencimiento") {
        const aceptar = await solicitud(`/api/invitaciones/${token}/aceptar`, "POST", { nombre: "Cliente", contrasena: "Password123!" });
        assert.equal(aceptar.status, 410);
        assert.equal(await actividades(inv.id, "ACEPTAR"), 0);
      }
    });
  }

  await caso("PostgreSQL y auditoría finales libres de todos los centinelas nuevos", async () => {
    await sinTokenEnPostgres(secretos);
    sinSecretos(await prisma.actividad.findMany(), [...secretos, ...secretos.map(hashTokenInvitacion)]);
  });
  return completados;
}
