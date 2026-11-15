import assert from "node:assert/strict";
import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { hashTokenInvitacion } from "../src/utilidades/invitaciones.js";
import { Prisma } from "@prisma/client";
import {
  limitadorConsultaGlobalIp,
  limitadorConsultaEspecifico,
  limitadorAceptacionGlobalIp,
  limitadorAceptacionEspecifico,
  generarClaveIp,
  generarClaveIpTokenHash,
} from "../src/rutas/invitaciones-publicas.js";
import { LimitadorMemoria } from "../src/middleware/rate-limit.js";
import { hooksPruebas, crearBarreraConcurrencia, estanHooksHabilitados } from "../src/utilidades/hooks-pruebas.js";
import { parsearConfiarProxy } from "../src/aplicacion.js";
import { parsearVencimientoInvitacionHoras } from "../src/utilidades/invitaciones.js";
import { ejecutarBloqueos } from "./casos-bloqueos-invitaciones.js";

const BASE_ESPERADA = "equinox_issue4_test";

async function verificarBaseActual() {
  const resultado: Array<{ current_database: string }> =
    await prisma.$queryRaw`SELECT current_database();`;

  const nombreActual = resultado[0]?.current_database;
  if (nombreActual !== BASE_ESPERADA) {
    console.error(
      `[SEGURIDAD CRÍTICA] La base actual es '${nombreActual}', pero se exige '${BASE_ESPERADA}'. Abortando inmediatamente.`
    );
    process.exit(1);
  }
}

async function ejecutarCasos() {
  await verificarBaseActual();

  let servidor: ReturnType<typeof createServer> | null = null;
  let urlApi = "";

  try {
    // Iniciar servidor HTTP dinámico
    await new Promise<void>((resolve) => {
      servidor = createServer(aplicacion);
      servidor.listen(0, () => {
        const addr = servidor!.address();
        if (typeof addr === "object" && addr) {
          urlApi = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    // Limpieza inicial en equinox_issue4_test
    await prisma.actividad.deleteMany();
    await prisma.sesion.deleteMany();
    await prisma.invitacionCliente.deleteMany();
    await prisma.accesoCliente.deleteMany();
    await prisma.miembroOrganizacion.deleteMany();
    await prisma.cliente.deleteMany();
    await prisma.proyecto.deleteMany();
    await prisma.factura.deleteMany();
    await prisma.organizacion.deleteMany();
    await prisma.usuario.deleteMany();

    // -----------------------------------------------------------------
    // Configuración base de prueba: Organización Alfa, Propietario y Colaborador
    // -----------------------------------------------------------------
    const contrasenaHash = await bcrypt.hash("Password123!", 12);

    // Registro de propietario
    const resRegProp = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "propietario@example.test",
        contrasena: "Password123!",
        nombre: "Propietario",
        apellido: "Alfa",
        nombreEstudio: "Estudio Alfa",
        slug: "estudio-alfa",
      }),
    });
    assert.equal(resRegProp.status, 201);
    const datosRegProp = (await resRegProp.json()) as any;
    const tokenProp = datosRegProp.token;
    const orgAlfaId = datosRegProp.organizacion.id;
    const usuarioPropId = datosRegProp.usuario.id;

    // Crear cliente Alfa
    const resCliente = await fetch(`${urlApi}/api/clientes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenProp}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nombre: "Cliente Corporativo Alfa",
        empresa: "Alfa Corp",
        correo: "contacto@alfacorp.test",
      }),
    });
    assert.equal(resCliente.status, 201);
    const clienteAlfa = (await resCliente.json()) as any;

    // Crear colaborador en Org Alfa
    const usuarioColab = await prisma.usuario.create({
      data: {
        correo: "colaborador@example.test",
        contrasenaHash,
        nombre: "Colaborador",
      },
    });
    await prisma.miembroOrganizacion.create({
      data: {
        usuarioId: usuarioColab.id,
        organizacionId: orgAlfaId,
        rol: "COLABORADOR",
      },
    });
    const resLoginColab = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "colaborador@example.test",
        contrasena: "Password123!",
      }),
    });
    const tokenColab = ((await resLoginColab.json()) as any).token;

    // Organización Beta para pruebas de aislamiento
    const resRegBeta = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "prop.beta@example.test",
        contrasena: "Password123!",
        nombre: "Beta",
        nombreEstudio: "Estudio Beta",
        slug: "estudio-beta",
      }),
    });
    const datosRegBeta = (await resRegBeta.json()) as any;
    const tokenBeta = datosRegBeta.token;
    const orgBetaId = datosRegBeta.organizacion.id;

    // -----------------------------------------------------------------
    // Caso 1: Propietario crea una invitación válida
    // -----------------------------------------------------------------
    const resInvProp = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenProp}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "nuevo.cliente@example.test",
        rol: "TITULAR",
      }),
    });
    assert.equal(resInvProp.status, 201);
    const datosInvProp = (await resInvProp.json()) as any;
    assert.ok(datosInvProp.invitacion.id);
    assert.equal(datosInvProp.invitacion.correo, "nuevo.cliente@example.test");
    assert.equal(datosInvProp.invitacion.rol, "TITULAR");
    assert.ok(datosInvProp.enlaceInvitacion, "En entorno test debe devolverse el enlace");
    const tokenInvitacionProp = datosInvProp.enlaceInvitacion.split("/invitacion/")[1];
    assert.ok(tokenInvitacionProp);

    // -----------------------------------------------------------------
    // Caso 2: Colaborador autorizado crea una invitación
    // -----------------------------------------------------------------
    const resInvColab = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenColab}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "segundo.cliente@example.test",
        rol: "COLABORADOR",
      }),
    });
    assert.equal(resInvColab.status, 201);
    const datosInvColab = (await resInvColab.json()) as any;
    assert.equal(datosInvColab.invitacion.rol, "COLABORADOR");

    // -----------------------------------------------------------------
    // Caso 3: Contexto CLIENTE recibe 403 al intentar invitar
    // -----------------------------------------------------------------
    const usuarioClienteExistente = await prisma.usuario.create({
      data: {
        correo: "titular.previo@example.test",
        contrasenaHash,
        nombre: "Titular",
      },
    });
    await prisma.accesoCliente.create({
      data: {
        usuarioId: usuarioClienteExistente.id,
        clienteId: clienteAlfa.id,
        organizacionId: orgAlfaId,
        rol: "TITULAR",
        activo: true,
      },
    });
    const resLoginCliente = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "titular.previo@example.test",
        contrasena: "Password123!",
      }),
    });
    const tokenClienteRol = ((await resLoginCliente.json()) as any).token;

    const resInvDesdeCliente = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenClienteRol}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "otro@example.test",
        rol: "TITULAR",
      }),
    });
    assert.equal(resInvDesdeCliente.status, 403);

    // -----------------------------------------------------------------
    // Caso 4: Una organización no puede invitar para un cliente ajeno
    // -----------------------------------------------------------------
    const resInvClienteAjeno = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenBeta}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "espia@example.test",
        rol: "TITULAR",
      }),
    });
    assert.equal(resInvClienteAjeno.status, 404);

    // -----------------------------------------------------------------
    // Caso 5: PostgreSQL almacena el hash SHA-256 y no el token original
    // -----------------------------------------------------------------
    const invGuardada = await prisma.invitacionCliente.findUnique({
      where: { id: datosInvProp.invitacion.id },
    });
    assert.ok(invGuardada);
    assert.equal(invGuardada.tokenHash, hashTokenInvitacion(tokenInvitacionProp));
    assert.notEqual(invGuardada.tokenHash, tokenInvitacionProp);

    // -----------------------------------------------------------------
    // Caso 6: Las respuestas nunca exponen tokenHash
    // -----------------------------------------------------------------
    const respuestaTexto = JSON.stringify(datosInvProp);
    assert.ok(!respuestaTexto.includes("tokenHash"), "No debe exponer tokenHash");

    // -----------------------------------------------------------------
    // Caso 7: La consulta interna lista solo invitaciones de la organización actual
    // -----------------------------------------------------------------
    const resListaAlfa = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      headers: { Authorization: `Bearer ${tokenProp}` },
    });
    assert.equal(resListaAlfa.status, 200);
    const listaAlfa = (await resListaAlfa.json()) as any[];
    assert.ok(listaAlfa.length >= 2);

    const resListaBeta = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      headers: { Authorization: `Bearer ${tokenBeta}` },
    });
    assert.equal(resListaBeta.status, 404);

    // -----------------------------------------------------------------
    // Caso 8: El token válido puede consultarse públicamente sin exponer correo completo
    // -----------------------------------------------------------------
    const resPublica = await fetch(`${urlApi}/api/invitaciones/${tokenInvitacionProp}`);
    assert.equal(resPublica.status, 200);
    const datosPublicos = (await resPublica.json()) as any;
    assert.equal(datosPublicos.rol, "TITULAR");
    assert.equal(datosPublicos.cliente.nombre, clienteAlfa.nombre);
    assert.ok(datosPublicos.correoEnmascarado);
    assert.equal(datosPublicos.correo, undefined, "No debe incluir correo completo");
    assert.ok(!JSON.stringify(datosPublicos).includes("tokenHash"));

    // -----------------------------------------------------------------
    // Caso 9: Token inexistente o manipulado es rechazado
    // -----------------------------------------------------------------
    const resManipulado = await fetch(`${urlApi}/api/invitaciones/${tokenInvitacionProp}extra`);
    assert.equal(resManipulado.status, 404);

    // -----------------------------------------------------------------
    // Caso 10: Invitación vencida es rechazada y queda EXPIRADA de forma segura
    // -----------------------------------------------------------------
    const tokenVencidoPlano = "token_de_prueba_vencido_1234567890abcdef";
    const invVencida = await prisma.invitacionCliente.create({
      data: {
        clienteId: clienteAlfa.id,
        organizacionId: orgAlfaId,
        correo: "vencido@example.test",
        tokenHash: hashTokenInvitacion(tokenVencidoPlano),
        rol: "TITULAR",
        estado: "PENDIENTE",
        expiraEn: new Date(Date.now() - 60000), // Venció hace 1 minuto
        invitadoPorId: usuarioPropId,
      },
    });

    const resConsVencida = await fetch(`${urlApi}/api/invitaciones/${tokenVencidoPlano}`);
    assert.equal(resConsVencida.status, 410);

    const invVencidaBD = await prisma.invitacionCliente.findUnique({
      where: { id: invVencida.id },
    });
    assert.equal(invVencidaBD?.estado, "EXPIRADA");

    // Sub-caso 10.B: Verificación determinista de reloj controlado: expiraEn === ahora, expiraEn < ahora y carrera antes de CAS
    // Instante base fijo para pruebas deterministas
    const instanteBase = new Date("2026-10-26T12:00:00.000Z");

    try {
      // 1. expiraEn === ahora en Consulta:
      hooksPruebas.fijarReloj(instanteBase);
      const tokenExactoCons = "token_expira_exacto_cons_1234567890";
      const invExactoCons = await prisma.invitacionCliente.create({
        data: {
          clienteId: clienteAlfa.id,
          organizacionId: orgAlfaId,
          correo: "expira.exacto.cons@example.test",
          tokenHash: hashTokenInvitacion(tokenExactoCons),
          rol: "TITULAR",
          estado: "PENDIENTE",
          expiraEn: new Date(instanteBase.getTime()), // exactamente igual
          invitadoPorId: usuarioPropId,
        },
      });

      const resConsExacta = await fetch(`${urlApi}/api/invitaciones/${tokenExactoCons}`);
      assert.equal(resConsExacta.status, 410, "expiraEn === ahora en consulta debe responder 410");
      const invConsExactaBD = await prisma.invitacionCliente.findUnique({
        where: { id: invExactoCons.id },
      });
      assert.equal(invConsExactaBD?.estado, "EXPIRADA", "Debe quedar en estado EXPIRADA");

      // Repetir la consulta debe seguir respondiendo 410
      const resConsExactaRepetida = await fetch(`${urlApi}/api/invitaciones/${tokenExactoCons}`);
      assert.equal(resConsExactaRepetida.status, 410, "Repetir consulta expirada debe seguir respondiendo 410");

      // 2. expiraEn === ahora en Aceptación:
      const tokenExactoAcept = "token_expira_exacto_acept_1234567890";
      const invExactoAcept = await prisma.invitacionCliente.create({
        data: {
          clienteId: clienteAlfa.id,
          organizacionId: orgAlfaId,
          correo: "expira.exacto.acept@example.test",
          tokenHash: hashTokenInvitacion(tokenExactoAcept),
          rol: "TITULAR",
          estado: "PENDIENTE",
          expiraEn: new Date(instanteBase.getTime()), // exactamente igual
          invitadoPorId: usuarioPropId,
        },
      });

      const resAceptExacta = await fetch(`${urlApi}/api/invitaciones/${tokenExactoAcept}/aceptar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "NoCreado", contrasena: "Password123!" }),
      });
      assert.equal(resAceptExacta.status, 410, "expiraEn === ahora en aceptación debe responder 410");
      const invAceptExactaBD = await prisma.invitacionCliente.findUnique({
        where: { id: invExactoAcept.id },
      });
      assert.equal(invAceptExactaBD?.estado, "EXPIRADA");
      assert.equal(invAceptExactaBD?.aceptadaEn, null);
      assert.equal(invAceptExactaBD?.aceptadaPorId, null);

      const usrExacto = await prisma.usuario.findUnique({
        where: { correo: "expira.exacto.acept@example.test" },
      });
      assert.equal(usrExacto, null, "No debe crearse Usuario");

      const accExacto = await prisma.accesoCliente.findFirst({
        where: { usuario: { correo: "expira.exacto.acept@example.test" } },
      });
      assert.equal(accExacto, null, "No debe crearse AccesoCliente");

      const actExacto = await prisma.actividad.findFirst({
        where: { entidadId: invExactoAcept.id, accion: "ACEPTAR" },
      });
      assert.equal(actExacto, null, "No debe registrarse actividad ACEPTAR");

      // Repetir solicitud de aceptación sigue respondiendo 410
      const resAceptExactaRepetida = await fetch(`${urlApi}/api/invitaciones/${tokenExactoAcept}/aceptar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "NoCreado", contrasena: "Password123!" }),
      });
      assert.equal(resAceptExactaRepetida.status, 410, "Repetir aceptación expirada debe seguir respondiendo 410");

      // 3. expiraEn < ahora en Aceptación:
      const instantePasado = new Date(instanteBase.getTime() - 60000); // 1 minuto antes
      const tokenPasadoAcept = "token_expira_menor_acept_1234567890";
      const invPasadoAcept = await prisma.invitacionCliente.create({
        data: {
          clienteId: clienteAlfa.id,
          organizacionId: orgAlfaId,
          correo: "expira.menor.acept@example.test",
          tokenHash: hashTokenInvitacion(tokenPasadoAcept),
          rol: "TITULAR",
          estado: "PENDIENTE",
          expiraEn: instantePasado,
          invitadoPorId: usuarioPropId,
        },
      });

      const resAceptMenor = await fetch(`${urlApi}/api/invitaciones/${tokenPasadoAcept}/aceptar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "NoCreadoMenor", contrasena: "Password123!" }),
      });
      assert.equal(resAceptMenor.status, 410, "expiraEn < ahora en aceptación debe responder 410");
      const invPasadoBD = await prisma.invitacionCliente.findUnique({
        where: { id: invPasadoAcept.id },
      });
      assert.equal(invPasadoBD?.estado, "EXPIRADA");
      assert.equal(invPasadoBD?.aceptadaEn, null);
      assert.equal(invPasadoBD?.aceptadaPorId, null);

      const usrPasado = await prisma.usuario.findUnique({
        where: { correo: "expira.menor.acept@example.test" },
      });
      assert.equal(usrPasado, null);
      const accPasado = await prisma.accesoCliente.findFirst({
        where: { usuario: { correo: "expira.menor.acept@example.test" } },
      });
      assert.equal(accPasado, null);
      const actPasado = await prisma.actividad.findFirst({
        where: { entidadId: invPasadoAcept.id, accion: "ACEPTAR" },
      });
      assert.equal(actPasado, null);

      // Repetir sigue respondiendo 410
      const resAceptMenorRep = await fetch(`${urlApi}/api/invitaciones/${tokenPasadoAcept}/aceptar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "NoCreadoMenor", contrasena: "Password123!" }),
      });
      assert.equal(resAceptMenorRep.status, 410);

      // 4. Carrera: La invitación vence DESPUÉS de la lectura inicial y ANTES del CAS
      // La invitación es válida inicialmente (expira a las 12:00:05), la lectura ocurre a las 12:00:00
      const instanteLectura = new Date("2026-10-26T12:00:00.000Z");
      const instanteExpiraCarrera = new Date("2026-10-26T12:00:05.000Z");
      const instanteDespuesDeVencer = new Date("2026-10-26T12:00:06.000Z");

      hooksPruebas.fijarReloj(instanteLectura);
      const tokenCarreraVenc = "token_carrera_venc_cas_1234567890";
      const invCarreraVenc = await prisma.invitacionCliente.create({
        data: {
          clienteId: clienteAlfa.id,
          organizacionId: orgAlfaId,
          correo: "carrera.venc.cas@example.test",
          tokenHash: hashTokenInvitacion(tokenCarreraVenc),
          rol: "TITULAR",
          estado: "PENDIENTE",
          expiraEn: instanteExpiraCarrera,
          invitadoPorId: usuarioPropId,
        },
      });

      // Hook antes de CAS: avanzar el reloj controlado para que venza justo antes del CAS
      hooksPruebas.registrar("antes_aceptar_invitacion", () => {
        hooksPruebas.fijarReloj(instanteDespuesDeVencer);
      });

      const resAceptCarrera = await fetch(`${urlApi}/api/invitaciones/${tokenCarreraVenc}/aceptar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "UsuarioCarreraVenc", contrasena: "Password123!" }),
      });
      assert.equal(resAceptCarrera.status, 410, "Invitación que vence antes de CAS debe responder 410");
      const invCarreraBD = await prisma.invitacionCliente.findUnique({
        where: { id: invCarreraVenc.id },
      });
      assert.equal(invCarreraBD?.estado, "EXPIRADA", "Debe quedar en estado EXPIRADA tras revalidación en transacción");
      assert.equal(invCarreraBD?.aceptadaEn, null, "aceptadaEn debe ser null");
      assert.equal(invCarreraBD?.aceptadaPorId, null, "aceptadaPorId debe ser null");

      const usrCarrera = await prisma.usuario.findUnique({
        where: { correo: "carrera.venc.cas@example.test" },
      });
      assert.equal(usrCarrera, null, "No debe crearse Usuario tras vencer en CAS");
      const accCarrera = await prisma.accesoCliente.findFirst({
        where: { usuario: { correo: "carrera.venc.cas@example.test" } },
      });
      assert.equal(accCarrera, null, "No debe crearse AccesoCliente tras vencer en CAS");
      const actCarrera = await prisma.actividad.findFirst({
        where: { entidadId: invCarreraVenc.id, accion: "ACEPTAR" },
      });
      assert.equal(actCarrera, null, "No debe registrarse actividad ACEPTAR");

      // Repetir la solicitud sigue respondiendo 410
      const resAceptCarreraRep = await fetch(`${urlApi}/api/invitaciones/${tokenCarreraVenc}/aceptar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "UsuarioCarreraVenc", contrasena: "Password123!" }),
      });
      assert.equal(resAceptCarreraRep.status, 410, "Repetir solicitud debe seguir respondiendo 410");

      // 5. Caso de control: expiraEn inmediatamente posterior al instante de referencia (sigue siendo válida)
      hooksPruebas.limpiar();
      hooksPruebas.fijarReloj(instanteBase);
      const instanteFuturo = new Date(instanteBase.getTime() + 10000); // 10 segundos en el futuro
      const tokenFuturoValido = "token_limite_futuro_valido_1234567890";
      const invFutura = await prisma.invitacionCliente.create({
        data: {
          clienteId: clienteAlfa.id,
          organizacionId: orgAlfaId,
          correo: "limite.futuro.valido@example.test",
          tokenHash: hashTokenInvitacion(tokenFuturoValido),
          rol: "TITULAR",
          estado: "PENDIENTE",
          expiraEn: instanteFuturo,
          invitadoPorId: usuarioPropId,
        },
      });
      const resConsFutura = await fetch(`${urlApi}/api/invitaciones/${tokenFuturoValido}`);
      assert.equal(resConsFutura.status, 200, "expiraEn > ahora debe ser válida (HTTP 200)");
      const invFuturaBD = await prisma.invitacionCliente.findUnique({
        where: { id: invFutura.id },
      });
      assert.equal(invFuturaBD?.estado, "PENDIENTE", "Debe permanecer PENDIENTE");
    } finally {
      hooksPruebas.limpiar();
      limitadorAceptacionGlobalIp.reiniciar();
      limitadorAceptacionEspecifico.reiniciar();
    }

    // -----------------------------------------------------------------
    // Caso 11: Invitación revocada no puede consultarse ni aceptarse
    // -----------------------------------------------------------------
    const resRevocar = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${datosInvProp.invitacion.id}/revocar`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenProp}` },
      }
    );
    assert.equal(resRevocar.status, 200);

    const resConsRevocada = await fetch(`${urlApi}/api/invitaciones/${tokenInvitacionProp}`);
    assert.equal(resConsRevocada.status, 410);

    const resAceptarRevocada = await fetch(`${urlApi}/api/invitaciones/${tokenInvitacionProp}/aceptar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: "Intento",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resAceptarRevocada.status, 410);

    // -----------------------------------------------------------------
    // Caso 12: Reenviar genera un token nuevo e invalida el anterior
    // -----------------------------------------------------------------
    const resInvParaReenvio = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenProp}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "para.reenvio@example.test",
        rol: "TITULAR",
      }),
    });
    const datosParaReenvio = (await resInvParaReenvio.json()) as any;
    const tokenViejo = datosParaReenvio.enlaceInvitacion.split("/invitacion/")[1];

    const resReenviar = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${datosParaReenvio.invitacion.id}/reenviar`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenProp}` },
      }
    );
    assert.equal(resReenviar.status, 200);
    const datosReenviados = (await resReenviar.json()) as any;
    const tokenNuevo = datosReenviados.enlaceInvitacion.split("/invitacion/")[1];
    assert.notEqual(tokenViejo, tokenNuevo);

    // El token anterior da 404 al consultar públicamente
    const resViejo = await fetch(`${urlApi}/api/invitaciones/${tokenViejo}`);
    assert.equal(resViejo.status, 404);

    // El nuevo funciona normalmente
    const resNuevo = await fetch(`${urlApi}/api/invitaciones/${tokenNuevo}`);
    assert.equal(resNuevo.status, 200);

    // -----------------------------------------------------------------
    // Caso 13: El token anterior no puede aceptar después de un reenvío
    // -----------------------------------------------------------------
    const resAceptarTokenViejo = await fetch(`${urlApi}/api/invitaciones/${tokenViejo}/aceptar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: "IntentoTokenViejo",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resAceptarTokenViejo.status, 404, "El token anterior no debe poder aceptar");

    // -----------------------------------------------------------------
    // Caso 14: Usuario nuevo acepta y crea Usuario + AccesoCliente
    // -----------------------------------------------------------------
    const resInvNuevoUsuario = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenProp}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "flamante.cliente@example.test",
        rol: "TITULAR",
      }),
    });
    const datosNuevoUsuario = (await resInvNuevoUsuario.json()) as any;
    const tokenNuevoUsuario = datosNuevoUsuario.enlaceInvitacion.split("/invitacion/")[1];

    const resAceptarNuevo = await fetch(`${urlApi}/api/invitaciones/${tokenNuevoUsuario}/aceptar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: "Flamante",
        apellido: "Cliente",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resAceptarNuevo.status, 200);

    const usuarioCreado = await prisma.usuario.findUnique({
      where: { correo: "flamante.cliente@example.test" },
      include: { accesosCliente: true },
    });
    assert.ok(usuarioCreado);
    assert.equal(usuarioCreado.nombre, "Flamante");
    assert.equal(usuarioCreado.accesosCliente.length, 1);
    assert.equal(usuarioCreado.accesosCliente[0].clienteId, clienteAlfa.id);
    assert.equal(usuarioCreado.accesosCliente[0].rol, "TITULAR");

    // -----------------------------------------------------------------
    // Caso 15: Usuario existente acepta sin crear una cuenta duplicada
    // -----------------------------------------------------------------
    const resInvExistente = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenProp}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "titular.previo@example.test",
        rol: "COLABORADOR",
      }),
    });
    const datosExistente = (await resInvExistente.json()) as any;
    const tokenExistente = datosExistente.enlaceInvitacion.split("/invitacion/")[1];

    const totalUsuariosAntes = await prisma.usuario.count();

    const resAceptarExistente = await fetch(`${urlApi}/api/invitaciones/${tokenExistente}/aceptar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contrasena: "Password123!",
      }),
    });
    assert.equal(resAceptarExistente.status, 200);

    const totalUsuariosDespues = await prisma.usuario.count();
    assert.equal(totalUsuariosDespues, totalUsuariosAntes, "No debe duplicar Usuario");

    // -----------------------------------------------------------------
    // Caso 16: Contraseña incorrecta de usuario existente no vincula la cuenta
    // -----------------------------------------------------------------
    const resInvPassErroneo = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenProp}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "titular.previo@example.test",
        rol: "TITULAR",
      }),
    });
    const datosPassErroneo = (await resInvPassErroneo.json()) as any;
    const tokenPassErroneo = datosPassErroneo.enlaceInvitacion.split("/invitacion/")[1];

    const resAceptarPassErroneo = await fetch(`${urlApi}/api/invitaciones/${tokenPassErroneo}/aceptar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contrasena: "ContrasenaEquivocada!",
      }),
    });
    assert.equal(resAceptarPassErroneo.status, 401);

    // -----------------------------------------------------------------
    // Caso 17: El correo de la invitación no puede sustituirse durante la aceptación
    // -----------------------------------------------------------------
    const resAceptarIntentoCorreo = await fetch(`${urlApi}/api/invitaciones/${tokenPassErroneo}/aceptar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "suplantador@example.test",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resAceptarIntentoCorreo.status, 200);
    const suplantadorExiste = await prisma.usuario.findUnique({
      where: { correo: "suplantador@example.test" },
    });
    assert.equal(suplantadorExiste, null, "No debe haberse creado el correo suplantador");

    // -----------------------------------------------------------------
    // Caso 18: El rol de AccesoCliente coincide con el de la invitación
    // -----------------------------------------------------------------
    const resInvRol = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenProp}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "rol.verificado@example.test",
        rol: "COLABORADOR",
      }),
    });
    const datosRol = (await resInvRol.json()) as any;
    const tokenRol = datosRol.enlaceInvitacion.split("/invitacion/")[1];

    await fetch(`${urlApi}/api/invitaciones/${tokenRol}/aceptar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: "Rol",
        contrasena: "Password123!",
      }),
    });

    const accesoCreado = await prisma.accesoCliente.findFirst({
      where: { usuario: { correo: "rol.verificado@example.test" } },
    });
    assert.equal(accesoCreado?.rol, "COLABORADOR");

    // -----------------------------------------------------------------
    // Caso 19: El token no puede reutilizarse después de aceptar
    // -----------------------------------------------------------------
    const resReusarToken = await fetch(`${urlApi}/api/invitaciones/${tokenRol}/aceptar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: "Otro",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resReusarToken.status, 409);

    // -----------------------------------------------------------------
    // Caso 20: Una invitación ACEPTADA nunca vuelve a PENDIENTE ni REVOCADA
    // -----------------------------------------------------------------
    const invAceptadaBD = await prisma.invitacionCliente.findFirst({
      where: { tokenHash: hashTokenInvitacion(tokenRol) },
    });
    assert.equal(invAceptadaBD?.estado, "ACEPTADA");

    const resReenviarAceptada = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${invAceptadaBD!.id}/reenviar`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenProp}` },
      }
    );
    assert.equal(resReenviarAceptada.status, 409);

    const resRevocarAceptada = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${invAceptadaBD!.id}/revocar`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenProp}` },
      }
    );
    assert.equal(resRevocarAceptada.status, 409);

    const invSigueAceptada = await prisma.invitacionCliente.findUnique({
      where: { id: invAceptadaBD!.id },
    });
    assert.equal(invSigueAceptada?.estado, "ACEPTADA");

    // -----------------------------------------------------------------
    // Caso 21: Una invitación REVOCADA nunca puede reactivarse
    // -----------------------------------------------------------------
    const invRevocadaBD = await prisma.invitacionCliente.findUnique({
      where: { id: datosInvProp.invitacion.id },
    });
    assert.equal(invRevocadaBD?.estado, "REVOCADA");

    const resReenviarRevocada = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${invRevocadaBD!.id}/reenviar`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenProp}` },
      }
    );
    assert.equal(resReenviarRevocada.status, 409);

    // -----------------------------------------------------------------
    // Caso 22: Reenviar una EXPIRADA cuando ya existe otra PENDIENTE responde 409
    // -----------------------------------------------------------------
    const correoReactivar = "reactivar.expirada@example.test";
    // 1. Crear una invitación expirada
    const tokenExpPlano = "token_expirada_para_reactivar_123456789";
    const invExpiradaDirecta = await prisma.invitacionCliente.create({
      data: {
        clienteId: clienteAlfa.id,
        organizacionId: orgAlfaId,
        correo: correoReactivar,
        rol: "TITULAR",
        tokenHash: hashTokenInvitacion(tokenExpPlano),
        estado: "EXPIRADA",
        expiraEn: new Date(Date.now() - 3600000), // Expiró hace 1 hora
        invitadoPorId: usuarioPropId,
      },
    });

    // 2. Crear una invitación PENDIENTE para el mismo cliente y correo
    const resCrearPendienteVigente = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenProp}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          correo: correoReactivar,
          rol: "TITULAR",
        }),
      }
    );
    assert.equal(resCrearPendienteVigente.status, 201);
    const datosPendienteVigente = (await resCrearPendienteVigente.json()) as any;

    // 3. Intentar reenviar la que está EXPIRADA: debe responder 409
    const resReenviarExpiradaConflicto = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${invExpiradaDirecta.id}/reenviar`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenProp}` },
      }
    );
    assert.equal(
      resReenviarExpiradaConflicto.status,
      409,
      "Reenviar una expirada cuando existe otra pendiente debe responder 409"
    );

    // 4. Verificar en PostgreSQL que sigue existiendo exactamente una PENDIENTE
    const pendientesReactivar = await prisma.invitacionCliente.findMany({
      where: {
        clienteId: clienteAlfa.id,
        correo: correoReactivar,
        estado: "PENDIENTE",
      },
    });
    assert.equal(pendientesReactivar.length, 1);
    assert.equal(pendientesReactivar[0].id, datosPendienteVigente.invitacion.id);

    // 5. Verificar que la expirada continúa en EXPIRADA
    const estadoExpiradaDespues = await prisma.invitacionCliente.findUnique({
      where: { id: invExpiradaDirecta.id },
    });
    assert.equal(estadoExpiradaDespues?.estado, "EXPIRADA");
    assert.equal(estadoExpiradaDespues?.tokenHash, hashTokenInvitacion(tokenExpPlano));

    // 6. Verificar que NO se registró actividad REENVIAR para la operación fallida
    const actividadReenviarFallida = await prisma.actividad.findFirst({
      where: {
        entidadId: invExpiradaDirecta.id,
        accion: "REENVIAR",
      },
    });
    assert.equal(actividadReenviarFallida, null);

    // -----------------------------------------------------------------
    // Caso 23: Carrera Aceptar vs Revocar con hook interno antes de CAS
    // -----------------------------------------------------------------
    const resInvCarrera1 = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenProp}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "carrera.revocar@example.test",
        rol: "TITULAR",
      }),
    });
    const datosCarrera1 = (await resInvCarrera1.json()) as any;
    const tokenCarrera1 = datosCarrera1.enlaceInvitacion.split("/invitacion/")[1];

    // Barrera interna en el servidor: ambas operaciones deben llegar al punto CAS antes de liberarse
    const barreraInternaC1 = crearBarreraConcurrencia(2);
    hooksPruebas.registrar("antes_aceptar_invitacion", async () => {
      await barreraInternaC1.esperar();
    });
    hooksPruebas.registrar("antes_revocar_invitacion", async () => {
      await barreraInternaC1.esperar();
    });

    let resAceptarC1: any;
    let resRevocarC1: any;
    try {
      [resAceptarC1, resRevocarC1] = await Promise.all([
        fetch(`${urlApi}/api/invitaciones/${tokenCarrera1}/aceptar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: "GanadorC1", contrasena: "Password123!" }),
        }),
        fetch(
          `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${datosCarrera1.invitacion.id}/revocar`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenProp}` },
          }
        ),
      ]);
    } finally {
      hooksPruebas.limpiar();
    }

    const estadosC1 = [resAceptarC1.status, resRevocarC1.status].sort();
    assert.deepEqual(estadosC1, [200, 409], "Una transición debe ganar y la otra recibir 409");

    const estadoFinalC1 = await prisma.invitacionCliente.findUnique({
      where: { id: datosCarrera1.invitacion.id },
    });
    assert.ok(estadoFinalC1);
    if (resAceptarC1.status === 200) {
      assert.equal(estadoFinalC1.estado, "ACEPTADA");
      assert.ok(estadoFinalC1.aceptadaEn);
      assert.ok(estadoFinalC1.aceptadaPorId);
      const accesos = await prisma.accesoCliente.findMany({
        where: { clienteId: clienteAlfa.id, usuarioId: estadoFinalC1.aceptadaPorId },
      });
      assert.equal(accesos.length, 1);
    } else {
      assert.equal(estadoFinalC1.estado, "REVOCADA");
      assert.equal(estadoFinalC1.aceptadaEn, null);
      assert.equal(estadoFinalC1.aceptadaPorId, null);
    }

    // -----------------------------------------------------------------
    // Caso 24: Carrera Aceptar vs Reenviar con hook interno antes de CAS
    // -----------------------------------------------------------------
    const resInvCarrera2 = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenProp}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "carrera.reenviar@example.test",
        rol: "TITULAR",
      }),
    });
    const datosCarrera2 = (await resInvCarrera2.json()) as any;
    const tokenCarrera2 = datosCarrera2.enlaceInvitacion.split("/invitacion/")[1];

    const barreraInternaC2 = crearBarreraConcurrencia(2);
    hooksPruebas.registrar("antes_aceptar_invitacion", async () => {
      await barreraInternaC2.esperar();
    });
    hooksPruebas.registrar("antes_reenviar_invitacion", async () => {
      await barreraInternaC2.esperar();
    });

    let resAceptarC2: any;
    let resReenviarC2: any;
    try {
      [resAceptarC2, resReenviarC2] = await Promise.all([
        fetch(`${urlApi}/api/invitaciones/${tokenCarrera2}/aceptar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: "GanadorC2", contrasena: "Password123!" }),
        }),
        fetch(
          `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${datosCarrera2.invitacion.id}/reenviar`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenProp}` },
          }
        ),
      ]);
    } finally {
      hooksPruebas.limpiar();
    }

    const estadosC2 = [resAceptarC2.status, resReenviarC2.status].sort();
    assert.deepEqual(estadosC2, [200, 409], "Una transición debe ganar y la otra recibir 409");

    const estadoFinalC2 = await prisma.invitacionCliente.findUnique({
      where: { id: datosCarrera2.invitacion.id },
    });
    assert.ok(estadoFinalC2);
    if (resAceptarC2.status === 200) {
      assert.equal(estadoFinalC2.estado, "ACEPTADA");
      assert.equal(estadoFinalC2.tokenHash, hashTokenInvitacion(tokenCarrera2));
      assert.ok(estadoFinalC2.aceptadaEn);
    } else {
      assert.equal(estadoFinalC2.estado, "PENDIENTE");
      assert.notEqual(estadoFinalC2.tokenHash, hashTokenInvitacion(tokenCarrera2));
      assert.equal(estadoFinalC2.aceptadaEn, null);
    }

    // -----------------------------------------------------------------
    // Caso 25: Carrera Reenviar vs Revocar con hook interno antes de CAS
    // -----------------------------------------------------------------
    const resInvCarrera3 = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenProp}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "carrera.reenv.revoc@example.test",
        rol: "TITULAR",
      }),
    });
    const datosCarrera3 = (await resInvCarrera3.json()) as any;

    const barreraInternaC3 = crearBarreraConcurrencia(2);
    hooksPruebas.registrar("antes_reenviar_invitacion", async () => {
      await barreraInternaC3.esperar();
    });
    hooksPruebas.registrar("antes_revocar_invitacion", async () => {
      await barreraInternaC3.esperar();
    });

    let resReenviarC3: any;
    let resRevocarC3: any;
    try {
      [resReenviarC3, resRevocarC3] = await Promise.all([
        fetch(
          `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${datosCarrera3.invitacion.id}/reenviar`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenProp}` },
          }
        ),
        fetch(
          `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${datosCarrera3.invitacion.id}/revocar`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenProp}` },
          }
        ),
      ]);
    } finally {
      hooksPruebas.limpiar();
    }

    const estadosC3 = [resReenviarC3.status, resRevocarC3.status].sort();
    assert.deepEqual(estadosC3, [200, 409], "Una transición debe ganar y la otra recibir 409");

    const estadoFinalC3 = await prisma.invitacionCliente.findUnique({
      where: { id: datosCarrera3.invitacion.id },
    });
    assert.ok(estadoFinalC3);
    if (resReenviarC3.status === 200) {
      assert.equal(estadoFinalC3.estado, "PENDIENTE");
      assert.notEqual(estadoFinalC3.tokenHash, hashTokenInvitacion(datosCarrera3.enlaceInvitacion.split("/invitacion/")[1]));
    } else {
      assert.equal(estadoFinalC3.estado, "REVOCADA");
    }

    // -----------------------------------------------------------------
    // Caso 26: Token anterior vs Reenvío con hook interno antes de CAS
    // -----------------------------------------------------------------
    const resInvCarrera4 = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenProp}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "carrera.tokenprevio@example.test",
        rol: "TITULAR",
      }),
    });
    const datosCarrera4 = (await resInvCarrera4.json()) as any;
    const tokenCarrera4 = datosCarrera4.enlaceInvitacion.split("/invitacion/")[1];

    const barreraInternaC4 = crearBarreraConcurrencia(2);
    hooksPruebas.registrar("antes_reenviar_invitacion", async () => {
      await barreraInternaC4.esperar();
    });
    hooksPruebas.registrar("antes_aceptar_invitacion", async () => {
      await barreraInternaC4.esperar();
    });

    let resReenviarC4: any;
    let resAceptarViejoC4: any;
    try {
      [resReenviarC4, resAceptarViejoC4] = await Promise.all([
        fetch(
          `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${datosCarrera4.invitacion.id}/reenviar`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenProp}` },
          }
        ),
        fetch(`${urlApi}/api/invitaciones/${tokenCarrera4}/aceptar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: "ConcViejo", contrasena: "Password123!" }),
        }),
      ]);
    } finally {
      hooksPruebas.limpiar();
    }

    const estadosC4 = [resReenviarC4.status, resAceptarViejoC4.status].sort();
    assert.ok(
      estadosC4[0] === 200 && (estadosC4[1] === 404 || estadosC4[1] === 409),
      `Una debe ganar (200) y la otra perder (404/409). Obtenidos: ${estadosC4.join(", ")}`
    );

    // -----------------------------------------------------------------
    // Caso 27: Cuatro creaciones simultáneas coordinadas con hook interno antes de inserción
    // -----------------------------------------------------------------
    limitadorAceptacionGlobalIp.reiniciar();
    limitadorAceptacionEspecifico.reiniciar();
    const correoCuatro = "cuatro.simultaneas@example.test";
    const barreraInternaCrear = crearBarreraConcurrencia(4, 5000);

    // Cada una de las 4 peticiones esperará a que las 4 hayan alcanzado el hook antes de insertar
    hooksPruebas.registrar("antes_crear_invitacion", async () => {
      await barreraInternaCrear.esperar();
    });

    let r1: any, r2: any, r3: any, r4: any;
    try {
      [r1, r2, r3, r4] = await Promise.all([
        fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenProp}`, "Content-Type": "application/json" },
          body: JSON.stringify({ correo: correoCuatro, rol: "TITULAR" }),
        }),
        fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenProp}`, "Content-Type": "application/json" },
          body: JSON.stringify({ correo: correoCuatro, rol: "COLABORADOR" }),
        }),
        fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenProp}`, "Content-Type": "application/json" },
          body: JSON.stringify({ correo: correoCuatro, rol: "TITULAR" }),
        }),
        fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenProp}`, "Content-Type": "application/json" },
          body: JSON.stringify({ correo: correoCuatro, rol: "COLABORADOR" }),
        }),
      ]);
    } finally {
      hooksPruebas.limpiar();
    }

    const respuestasCuatro = [r1, r2, r3, r4];
    // 1. Ninguna respuesta debe ser 500
    for (let i = 0; i < 4; i++) {
      assert.notEqual(
        respuestasCuatro[i].status,
        500,
        `La petición ${i + 1} no debe devolver 500`
      );
      // 2. Exactamente cuatro respuestas HTTP 201
      assert.equal(
        respuestasCuatro[i].status,
        201,
        `La petición ${i + 1} debe devolver HTTP 201`
      );
    }

    // 3. Capturar de forma segura los cuatro tokens devueltos
    const tokensDevueltos: string[] = [];
    for (const r of respuestasCuatro) {
      const bodyJson = (await r.json()) as any;
      assert.ok(bodyJson.enlaceInvitacion, "Cada respuesta 201 debe incluir enlaceInvitacion");
      const t = bodyJson.enlaceInvitacion.split("/invitacion/")[1];
      assert.ok(t, "El token debe estar presente en el enlace");
      tokensDevueltos.push(t);
    }

    // 4. Exactamente cuatro tokens presentes y todos diferentes entre sí
    assert.equal(tokensDevueltos.length, 4, "Deben haberse capturado exactamente cuatro tokens");
    const tokensUnicos = new Set(tokensDevueltos);
    assert.equal(tokensUnicos.size, 4, "Los cuatro tokens devueltos deben ser diferentes entre sí");

    // 5. Exactamente cuatro invitaciones persistidas para el correo en PostgreSQL
    const todasInvitacionesCuatro = await prisma.invitacionCliente.findMany({
      where: { clienteId: clienteAlfa.id, correo: correoCuatro },
      orderBy: { creadoEn: "asc" },
    });
    assert.equal(
      todasInvitacionesCuatro.length,
      4,
      "Deben existir exactamente cuatro invitaciones persistidas para el correo"
    );

    // 6. Exactamente una PENDIENTE y tres REVOCADA
    const pendientesCuatro = todasInvitacionesCuatro.filter((inv) => inv.estado === "PENDIENTE");
    const revocadasCuatro = todasInvitacionesCuatro.filter((inv) => inv.estado === "REVOCADA");
    assert.equal(pendientesCuatro.length, 1, "Debe existir exactamente UNA invitación PENDIENTE");
    assert.equal(revocadasCuatro.length, 3, "Deben existir exactamente TRES invitaciones REVOCADA");

    const invitacionPendienteActiva = pendientesCuatro[0];

    // 7. El hash de cada token debe corresponder a su respectiva invitación persistida
    const hashesPersistidos = new Set(todasInvitacionesCuatro.map((inv) => inv.tokenHash));
    for (const t of tokensDevueltos) {
      const h = hashTokenInvitacion(t);
      assert.ok(
        hashesPersistidos.has(h),
        "El hash de cada token devuelto debe corresponder a una de las cuatro invitaciones persistidas"
      );
    }

    // 8. Solo el token de la pendiente debe responder HTTP 200 en consulta, y los tres revocados HTTP 410
    let tokenPendienteParaAceptar = "";
    for (const t of tokensDevueltos) {
      const h = hashTokenInvitacion(t);
      const resConsulta = await fetch(`${urlApi}/api/invitaciones/${t}`);
      if (h === invitacionPendienteActiva.tokenHash) {
        assert.equal(resConsulta.status, 200, "El token de la invitación PENDIENTE debe responder HTTP 200");
        tokenPendienteParaAceptar = t;
      } else {
        assert.equal(
          resConsulta.status,
          410,
          "Cada uno de los tres tokens de invitaciones revocadas debe responder HTTP 410 en consulta"
        );
      }
    }

    // 9. Ningún token revocado debe poder aceptar (deben responder HTTP 410)
    for (const t of tokensDevueltos) {
      const h = hashTokenInvitacion(t);
      if (h !== invitacionPendienteActiva.tokenHash) {
        const resAceptarRevocado = await fetch(`${urlApi}/api/invitaciones/${t}/aceptar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: "IntentoRevocado", contrasena: "Password123!" }),
        });
        assert.equal(
          resAceptarRevocado.status,
          410,
          "Aceptar con un token revocado debe ser rechazado con HTTP 410"
        );
      }
    }

    // 10. Solo el token pendiente debe poder completar la aceptación con HTTP 200
    assert.ok(tokenPendienteParaAceptar, "Debe haberse identificado el token pendiente");
    const resAceptarPendiente = await fetch(`${urlApi}/api/invitaciones/${tokenPendienteParaAceptar}/aceptar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: "UsuarioGanadorCuatro", contrasena: "Password123!" }),
    });
    assert.equal(
      resAceptarPendiente.status,
      200,
      "El token de la invitación PENDIENTE debe poder completar la aceptación exitosamente"
    );

    // 11. Exactamente cuatro actividades INVITAR, cada una apuntando a una de las cuatro invitaciones
    const actividadesCuatro = await prisma.actividad.findMany({
      where: {
        organizacionId: orgAlfaId,
        entidad: "invitacion_cliente",
        accion: "INVITAR",
      },
    });
    const actividadesFiltradas = actividadesCuatro.filter((act) =>
      act.descripcion?.includes(correoCuatro)
    );
    assert.equal(
      actividadesFiltradas.length,
      4,
      "Deben existir exactamente cuatro actividades INVITAR registradas"
    );

    const idsPersistidos = new Set(todasInvitacionesCuatro.map((inv) => inv.id));
    for (const act of actividadesFiltradas) {
      assert.ok(
        idsPersistidos.has(act.entidadId),
        "Cada actividad debe apuntar a una de las cuatro invitaciones persistidas (sin huérfanas)"
      );
    }

    // -----------------------------------------------------------------
    // Caso 28: Dos aceptaciones concurrentes con hook interno antes de CAS
    // -----------------------------------------------------------------
    limitadorAceptacionGlobalIp.reiniciar();
    limitadorAceptacionEspecifico.reiniciar();

    const resInvConcurrente = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenProp}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        correo: "concurrente.barrera@example.test",
        rol: "TITULAR",
      }),
    });
    const datosConcurrente = (await resInvConcurrente.json()) as any;
    const tokenConcurrente = datosConcurrente.enlaceInvitacion.split("/invitacion/")[1];

    const barreraInternaAceptar = crearBarreraConcurrencia(2, 5000);
    hooksPruebas.registrar("antes_aceptar_invitacion", async () => {
      await barreraInternaAceptar.esperar();
    });

    let resConc1: any;
    let resConc2: any;
    try {
      [resConc1, resConc2] = await Promise.all([
        fetch(`${urlApi}/api/invitaciones/${tokenConcurrente}/aceptar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: "Conc1", contrasena: "Password123!" }),
        }),
        fetch(`${urlApi}/api/invitaciones/${tokenConcurrente}/aceptar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: "Conc2", contrasena: "Password123!" }),
        }),
      ]);
    } finally {
      hooksPruebas.limpiar();
    }

    const estadosC6 = [resConc1.status, resConc2.status].sort();
    assert.deepEqual(estadosC6, [200, 409], "Una llamada debe ser 200 y la otra 409");

    const usuarioConcurrente = await prisma.usuario.findUnique({
      where: { correo: "concurrente.barrera@example.test" },
      include: { accesosCliente: true },
    });
    assert.equal(usuarioConcurrente?.accesosCliente.length, 1);

    // -----------------------------------------------------------------
    // Caso 29: Prueba aislada de los 4 limitadores (N ok, N+1 429 con Retry-After y X-RateLimit-Id)
    // -----------------------------------------------------------------
    // 1. Consulta Global por IP (N = 60)
    limitadorConsultaGlobalIp.reiniciar();
    limitadorConsultaEspecifico.reiniciar();
    limitadorAceptacionGlobalIp.reiniciar();
    limitadorAceptacionEspecifico.reiniciar();
    try {
      const resInvConsulta = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenProp}`, "Content-Type": "application/json" },
        body: JSON.stringify({ correo: "consulta.global@example.test", rol: "TITULAR" }),
      });
      const datosInvConsulta = (await resInvConsulta.json()) as any;
      const tokenConsulta = datosInvConsulta.enlaceInvitacion.split("/invitacion/")[1];

      // Para aislar el límite global (60) del específico (30), usamos tokens aleatorios inexistentes:
      // Cada token es único, por lo que el específico no llega a 30, pero el global por IP suma hasta 60.
      for (let i = 1; i <= 60; i++) {
        const tokenAleatorio = `tok_global_cons_${i}_${Date.now()}`;
        const r = await fetch(`${urlApi}/api/invitaciones/${tokenAleatorio}`);
        assert.notEqual(r.status, 429, `Consulta global intento ${i} no debe ser 429`);
      }
      const rExcesoConsGlobal = await fetch(`${urlApi}/api/invitaciones/tok_global_cons_exceso`);
      assert.equal(rExcesoConsGlobal.status, 429, "Consulta global intento 61 (N+1) debe ser 429");
      assert.ok(rExcesoConsGlobal.headers.get("Retry-After"));
      assert.equal(rExcesoConsGlobal.headers.get("X-RateLimit-Id"), "consulta-global-ip");
    } finally {
      limitadorConsultaGlobalIp.reiniciar();
      limitadorConsultaEspecifico.reiniciar();
    }

    // 2. Consulta Específica por IP + hash (N = 30)
    limitadorConsultaGlobalIp.reiniciar();
    limitadorConsultaEspecifico.reiniciar();
    try {
      const tokenEspec = `tok_cons_especifico_${Date.now()}`;
      for (let i = 1; i <= 30; i++) {
        const r = await fetch(`${urlApi}/api/invitaciones/${tokenEspec}`);
        assert.notEqual(r.status, 429, `Consulta específica intento ${i} no debe ser 429`);
      }
      const rExcesoConsEspec = await fetch(`${urlApi}/api/invitaciones/${tokenEspec}`);
      assert.equal(rExcesoConsEspec.status, 429, "Consulta específica intento 31 (N+1) debe ser 429");
      assert.ok(rExcesoConsEspec.headers.get("Retry-After"));
      assert.equal(rExcesoConsEspec.headers.get("X-RateLimit-Id"), "consulta-especifico-token");
    } finally {
      limitadorConsultaGlobalIp.reiniciar();
      limitadorConsultaEspecifico.reiniciar();
    }

    // 3. Aceptación Global por IP (N = 15)
    limitadorAceptacionGlobalIp.reiniciar();
    limitadorAceptacionEspecifico.reiniciar();
    try {
      for (let i = 1; i <= 15; i++) {
        const tokenRotado = `tok_acept_global_${i}_${Date.now()}`;
        const r = await fetch(`${urlApi}/api/invitaciones/${tokenRotado}/aceptar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contrasena: "WrongPass123!" }),
        });
        assert.notEqual(r.status, 429, `Aceptación global intento ${i} no debe ser 429`);
      }
      const rExcesoAceptGlobal = await fetch(`${urlApi}/api/invitaciones/tok_acept_global_exceso/aceptar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contrasena: "WrongPass123!" }),
      });
      assert.equal(rExcesoAceptGlobal.status, 429, "Aceptación global intento 16 (N+1) debe ser 429");
      assert.ok(rExcesoAceptGlobal.headers.get("Retry-After"));
      assert.equal(rExcesoAceptGlobal.headers.get("X-RateLimit-Id"), "aceptacion-global-ip");
    } finally {
      limitadorAceptacionGlobalIp.reiniciar();
      limitadorAceptacionEspecifico.reiniciar();
    }

    // 4. Aceptación Específica por IP + hash (N = 5)
    limitadorAceptacionGlobalIp.reiniciar();
    limitadorAceptacionEspecifico.reiniciar();
    try {
      const tokenAceptEspec = `tok_acept_espec_${Date.now()}`;
      for (let i = 1; i <= 5; i++) {
        const r = await fetch(`${urlApi}/api/invitaciones/${tokenAceptEspec}/aceptar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contrasena: "WrongPass123!" }),
        });
        assert.notEqual(r.status, 429, `Aceptación específica intento ${i} no debe ser 429`);
      }
      const rExcesoAceptEspec = await fetch(`${urlApi}/api/invitaciones/${tokenAceptEspec}/aceptar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contrasena: "WrongPass123!" }),
      });
      assert.equal(rExcesoAceptEspec.status, 429, "Aceptación específica intento 6 (N+1) debe ser 429");
      assert.ok(rExcesoAceptEspec.headers.get("Retry-After"));
      assert.equal(rExcesoAceptEspec.headers.get("X-RateLimit-Id"), "aceptacion-especifico-token");
    } finally {
      limitadorAceptacionGlobalIp.reiniciar();
      limitadorAceptacionEspecifico.reiniciar();
    }

    // -----------------------------------------------------------------
    // Caso 30: Comportamiento de proxy y aislamiento real entre IP A e IP B sobre la APLICACIÓN REAL
    // -----------------------------------------------------------------
    // Asegurar que los cuatro limitadores inician limpios
    limitadorConsultaGlobalIp.reiniciar();
    limitadorConsultaEspecifico.reiniciar();
    limitadorAceptacionGlobalIp.reiniciar();
    limitadorAceptacionEspecifico.reiniciar();

    const trustProxyOriginal = aplicacion.get("trust proxy");

    try {
      // ===============================================================
      // FASE 1: trust proxy = false (comportamiento por defecto)
      // Comprobar que en la aplicación real X-Forwarded-For se ignora por completo
      // ===============================================================
      aplicacion.set("trust proxy", false);

      // 1. req.ip sobre la aplicación real proviene del socket TCP y no del encabezado falsificado
      const resIpDesactivadoReal = await fetch(`${urlApi}/__prueba_ip__`, {
        headers: { "X-Forwarded-For": "203.0.113.195" },
      });
      assert.equal(resIpDesactivadoReal.status, 200);
      const datosIpDesactivadoReal = (await resIpDesactivadoReal.json()) as any;
      assert.notEqual(
        datosIpDesactivadoReal.ip,
        "203.0.113.195",
        "Con trust proxy = false en la app real, req.ip NO debe tomar la dirección falsificada del encabezado"
      );
      assert.equal(
        datosIpDesactivadoReal.ip,
        datosIpDesactivadoReal.remoteAddress,
        "req.ip en la app real debe provenir estrictamente de la conexión TCP socket"
      );

      // 2. Con trust proxy = false, falsificar X-Forwarded-For en cada petición no permite evadir el límite global
      limitadorAceptacionGlobalIp.reiniciar();
      try {
        for (let i = 1; i <= 15; i++) {
          await fetch(`${urlApi}/api/invitaciones/tok_evadir_falso_${i}/aceptar`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": `198.51.100.${i}`, // Intentar falsificar IPs diferentes en cada petición
            },
            body: JSON.stringify({ contrasena: "WrongPass123!" }),
          });
        }
        // La solicitud 16 debe ser bloqueada con 429 porque la IP real del socket TCP no cambia
        const rIntento16 = await fetch(`${urlApi}/api/invitaciones/tok_evadir_falso_16/aceptar`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": "198.51.100.99",
          },
          body: JSON.stringify({ contrasena: "WrongPass123!" }),
        });
        assert.equal(
          rIntento16.status,
          429,
          "Falsificar X-Forwarded-For no permite evadir el límite de tasa cuando trust proxy = false"
        );
      } finally {
        limitadorAceptacionGlobalIp.reiniciar();
      }

      // ===============================================================
      // FASE 2: trust proxy = 1 sobre la APLICACIÓN REAL
      // Comprobar req.ip confiable y aislamiento real IP A vs IP B
      // ===============================================================
      aplicacion.set("trust proxy", 1);

      // 1. Comprobar que bajo trust proxy = 1 en la app real, req.ip toma el cliente del encabezado
      const resIpConfiadoReal = await fetch(`${urlApi}/__prueba_ip__`, {
        headers: { "X-Forwarded-For": "198.51.100.42, 203.0.113.195" },
      });
      assert.equal(resIpConfiadoReal.status, 200);
      const datosIpConfiadoReal = (await resIpConfiadoReal.json()) as any;
      assert.equal(
        datosIpConfiadoReal.ip,
        "203.0.113.195",
        "Con trust proxy = 1 en la app real, req.ip debe tomar el cliente a la izquierda del último salto confiable"
      );

      // Reiniciar los 4 limitadores antes de las pruebas de aislamiento
      limitadorConsultaGlobalIp.reiniciar();
      limitadorConsultaEspecifico.reiniciar();
      limitadorAceptacionGlobalIp.reiniciar();
      limitadorAceptacionEspecifico.reiniciar();

      const ipA = "198.51.100.10";
      const ipB = "198.51.100.20";

      // ---------------------------------------------------------------
      // Escenario 1: Consulta Global por IP sobre la aplicación real
      // ---------------------------------------------------------------
      limitadorConsultaGlobalIp.reiniciar();
      limitadorConsultaEspecifico.reiniciar();
      try {
        // 1. Saturar el límite global de consulta desde IP A rotando tokens (N = 60)
        for (let i = 1; i <= 60; i++) {
          const res = await fetch(`${urlApi}/api/invitaciones/tok_rot_cons_real_${i}`, {
            headers: { "X-Forwarded-For": ipA },
          });
          assert.equal(res.status, 404, `Consulta IP A intento ${i} debe ser 404 (no 429)`);
        }

        // 2. Exactamente la solicitud N+1 (61) de IP A recibe 429
        const resIpA61 = await fetch(`${urlApi}/api/invitaciones/tok_rot_cons_real_61`, {
          headers: { "X-Forwarded-For": ipA },
        });
        assert.equal(resIpA61.status, 429, "Solicitud 61 de IP A debe recibir 429");
        assert.ok(resIpA61.headers.get("Retry-After"), "Debe incluir cabecera Retry-After");
        assert.equal(resIpA61.headers.get("X-RateLimit-Id"), "consulta-global-ip");

        // 3. Enviar una solicitud desde IP B: continúa permitida
        const resIpB = await fetch(`${urlApi}/api/invitaciones/tok_rot_cons_real_61`, {
          headers: { "X-Forwarded-For": ipB },
        });
        assert.equal(resIpB.status, 404, "IP B no debe recibir 429 tras saturar IP A (recibe 404)");
      } finally {
        limitadorConsultaGlobalIp.reiniciar();
        limitadorConsultaEspecifico.reiniciar();
      }

      // ---------------------------------------------------------------
      // Escenario 2: Aceptación Global por IP sobre la aplicación real
      // ---------------------------------------------------------------
      limitadorAceptacionGlobalIp.reiniciar();
      limitadorAceptacionEspecifico.reiniciar();
      try {
        // Conteo inicial de usuarios, accesos y actividades para verificar que saturar no crea efectos
        const usuariosAntes = await prisma.usuario.count();
        const accesosAntes = await prisma.accesoCliente.count();
        const actividadesAntes = await prisma.actividad.count({ where: { accion: "ACEPTAR" } });

        // 1. Saturar el límite global de aceptación desde IP A rotando tokens (N = 15)
        for (let i = 1; i <= 15; i++) {
          const res = await fetch(`${urlApi}/api/invitaciones/tok_rot_acept_real_${i}/aceptar`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": ipA,
            },
            body: JSON.stringify({ contrasena: "WrongPassword123!" }),
          });
          assert.equal(res.status, 404, `Aceptación IP A intento ${i} debe ser 404 (no 429)`);
        }

        // 2. Exactamente la solicitud N+1 (16) de IP A recibe 429
        const resIpA16 = await fetch(`${urlApi}/api/invitaciones/tok_rot_acept_real_16/aceptar`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": ipA,
          },
          body: JSON.stringify({ contrasena: "WrongPassword123!" }),
        });
        assert.equal(resIpA16.status, 429, "Solicitud 16 de IP A debe recibir 429");
        assert.ok(resIpA16.headers.get("Retry-After"), "Debe incluir cabecera Retry-After");
        assert.equal(resIpA16.headers.get("X-RateLimit-Id"), "aceptacion-global-ip");

        // 3. Enviar una solicitud desde IP B: continúa permitida
        const resIpBAcept = await fetch(`${urlApi}/api/invitaciones/tok_rot_acept_real_16/aceptar`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": ipB,
          },
          body: JSON.stringify({ contrasena: "WrongPassword123!" }),
        });
        assert.equal(resIpBAcept.status, 404, "IP B no debe recibir 429 tras saturar IP A");

        // 4. Verificar que las solicitudes de aceptación utilizadas para saturar NO crearon Usuario, AccesoCliente ni actividad ACEPTAR
        const usuariosDespues = await prisma.usuario.count();
        const accesosDespues = await prisma.accesoCliente.count();
        const actividadesDespues = await prisma.actividad.count({ where: { accion: "ACEPTAR" } });

        assert.equal(usuariosDespues, usuariosAntes, "Las solicitudes para saturar NO deben crear usuarios");
        assert.equal(accesosDespues, accesosAntes, "Las solicitudes para saturar NO deben crear AccesoCliente");
        assert.equal(actividadesDespues, actividadesAntes, "Las solicitudes para saturar NO deben crear actividad ACEPTAR");
      } finally {
        limitadorAceptacionGlobalIp.reiniciar();
        limitadorAceptacionEspecifico.reiniciar();
      }

      // ---------------------------------------------------------------
      // Escenario 3: Específicos sobre la aplicación real (Token A vs Token B e IP A vs IP B)
      // ---------------------------------------------------------------
      limitadorConsultaGlobalIp.reiniciar();
      limitadorConsultaEspecifico.reiniciar();
      limitadorAceptacionGlobalIp.reiniciar();
      limitadorAceptacionEspecifico.reiniciar();

      try {
        const tokenA = "token_aislado_real_especifico_aaa";
        const tokenB = "token_aislado_real_especifico_bbb";
        const hashA = hashTokenInvitacion(tokenA);

        // --- Consulta Específica (N = 30) ---
        // 1. Saturar token A desde IP A (30 solicitudes permitidas)
        for (let i = 1; i <= 30; i++) {
          const res = await fetch(`${urlApi}/api/invitaciones/${tokenA}`, {
            headers: { "X-Forwarded-For": ipA },
          });
          assert.equal(res.status, 404, `Consulta token A IP A intento ${i} debe ser 404`);
        }
        // Solicitud 31 de token A desde IP A recibe 429 del específico
        const resConsTokA31 = await fetch(`${urlApi}/api/invitaciones/${tokenA}`, {
          headers: { "X-Forwarded-For": ipA },
        });
        assert.equal(resConsTokA31.status, 429, "Token A desde IP A debe recibir 429 en intento 31");
        assert.equal(resConsTokA31.headers.get("X-RateLimit-Id"), "consulta-especifico-token");

        // 2. Comprobar que token B desde IP A continúa permitido (no saturado)
        const resConsTokB = await fetch(`${urlApi}/api/invitaciones/${tokenB}`, {
          headers: { "X-Forwarded-For": ipA },
        });
        assert.equal(resConsTokB.status, 404, "Token B desde IP A debe continuar permitido (404)");

        // 3. Comprobar que token A desde IP B continúa permitido (no saturado)
        const resConsTokAIpB = await fetch(`${urlApi}/api/invitaciones/${tokenA}`, {
          headers: { "X-Forwarded-For": ipB },
        });
        assert.equal(resConsTokAIpB.status, 404, "Token A desde IP B debe continuar permitido (404)");

        // Verificar que el limitador específico almacena la clave usando el hash y nunca el token original
        const claveReqConsPrueba = { ip: ipA, params: { token: tokenA } };
        const claveGeneradaCons = generarClaveIpTokenHash(claveReqConsPrueba);
        assert.ok(claveGeneradaCons.includes(hashA), "La clave debe contener el hash SHA-256");
        assert.ok(!claveGeneradaCons.includes(tokenA), "La clave NUNCA debe contener el token plano");

        // --- Aceptación Específica (N = 5) ---
        limitadorAceptacionGlobalIp.reiniciar();
        limitadorAceptacionEspecifico.reiniciar();

        const usuariosAntesEspec = await prisma.usuario.count();
        const accesosAntesEspec = await prisma.accesoCliente.count();
        const actividadesAntesEspec = await prisma.actividad.count({ where: { accion: "ACEPTAR" } });

        // 1. Saturar token A desde IP A en aceptación (5 solicitudes permitidas)
        for (let i = 1; i <= 5; i++) {
          const res = await fetch(`${urlApi}/api/invitaciones/${tokenA}/aceptar`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": ipA,
            },
            body: JSON.stringify({ contrasena: "WrongPassword123!" }),
          });
          assert.equal(res.status, 404, `Aceptación token A IP A intento ${i} debe ser 404`);
        }
        // Solicitud 6 de token A desde IP A recibe 429
        const resAceptTokA6 = await fetch(`${urlApi}/api/invitaciones/${tokenA}/aceptar`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": ipA,
          },
          body: JSON.stringify({ contrasena: "WrongPassword123!" }),
        });
        assert.equal(resAceptTokA6.status, 429, "Token A desde IP A debe recibir 429 en intento 6");
        assert.equal(resAceptTokA6.headers.get("X-RateLimit-Id"), "aceptacion-especifico-token");

        // 2. Comprobar que token B desde IP A continúa permitido
        const resAceptTokB = await fetch(`${urlApi}/api/invitaciones/${tokenB}/aceptar`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": ipA,
          },
          body: JSON.stringify({ contrasena: "WrongPassword123!" }),
        });
        assert.equal(resAceptTokB.status, 404, "Token B desde IP A en aceptación debe continuar permitido (404)");

        // 3. Comprobar que token A desde IP B continúa permitido
        const resAceptTokAIpB = await fetch(`${urlApi}/api/invitaciones/${tokenA}/aceptar`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": ipB,
          },
          body: JSON.stringify({ contrasena: "WrongPassword123!" }),
        });
        assert.equal(resAceptTokAIpB.status, 404, "Token A desde IP B en aceptación debe continuar permitido (404)");

        // Verificar que no se crearon registros durante la saturación específica
        const usuariosDespuesEspec = await prisma.usuario.count();
        const accesosDespuesEspec = await prisma.accesoCliente.count();
        const actividadesDespuesEspec = await prisma.actividad.count({ where: { accion: "ACEPTAR" } });

        assert.equal(usuariosDespuesEspec, usuariosAntesEspec);
        assert.equal(accesosDespuesEspec, accesosAntesEspec);
        assert.equal(actividadesDespuesEspec, actividadesAntesEspec);

        // Verificar que el limitador específico de aceptación usa hash y no token plano
        const claveGeneradaAcept = generarClaveIpTokenHash({ ip: ipA, params: { token: tokenA } });
        assert.ok(claveGeneradaAcept.includes(hashA));
        assert.ok(!claveGeneradaAcept.includes(tokenA));
      } finally {
        limitadorConsultaGlobalIp.reiniciar();
        limitadorConsultaEspecifico.reiniciar();
        limitadorAceptacionGlobalIp.reiniciar();
        limitadorAceptacionEspecifico.reiniciar();
      }
    } finally {
      // Restaurar trust proxy original y reiniciar todos los limitadores en finally
      aplicacion.set("trust proxy", trustProxyOriginal);
      limitadorConsultaGlobalIp.reiniciar();
      limitadorConsultaEspecifico.reiniciar();
      limitadorAceptacionGlobalIp.reiniciar();
      limitadorAceptacionEspecifico.reiniciar();
    }

    // -----------------------------------------------------------------
    // Caso 31: Verificación de control y ciclo de vida de Hooks de prueba y Barreras
    // -----------------------------------------------------------------
    // A. Habilitación exclusiva según NODE_ENV:
    const nodeEnvOriginal = process.env.NODE_ENV;
    try {
      // 1. NODE_ENV=test -> habilitados
      process.env.NODE_ENV = "test";
      assert.equal(estanHooksHabilitados(), true);
      let hookEjecutado = false;
      hooksPruebas.limpiar();
      hooksPruebas.registrar("hook_test", () => {
        hookEjecutado = true;
      });
      await hooksPruebas.ejecutar("hook_test");
      assert.equal(hookEjecutado, true, "En NODE_ENV=test los hooks registrados deben ejecutarse");

      // 2. NODE_ENV=development -> deshabilitados
      process.env.NODE_ENV = "development";
      assert.equal(estanHooksHabilitados(), false);
      hookEjecutado = false;
      hooksPruebas.limpiar();
      hooksPruebas.registrar("hook_dev", () => {
        hookEjecutado = true;
      });
      await hooksPruebas.ejecutar("hook_dev");
      assert.equal(hookEjecutado, false, "En NODE_ENV=development los hooks NO se registran ni ejecutan");

      // 3. NODE_ENV=production -> deshabilitados
      process.env.NODE_ENV = "production";
      assert.equal(estanHooksHabilitados(), false);
      hookEjecutado = false;
      hooksPruebas.limpiar();
      hooksPruebas.registrar("hook_prod", () => {
        hookEjecutado = true;
      });
      await hooksPruebas.ejecutar("hook_prod");
      assert.equal(hookEjecutado, false, "En NODE_ENV=production los hooks NO se registran ni ejecutan");

      // 4. Sin NODE_ENV -> deshabilitados
      delete process.env.NODE_ENV;
      assert.equal(estanHooksHabilitados(), false);
      hookEjecutado = false;
      hooksPruebas.limpiar();
      hooksPruebas.registrar("hook_sin_env", () => {
        hookEjecutado = true;
      });
      await hooksPruebas.ejecutar("hook_sin_env");
      assert.equal(hookEjecutado, false, "Sin NODE_ENV los hooks permanecen deshabilitados");
    } finally {
      process.env.NODE_ENV = nodeEnvOriginal;
      hooksPruebas.limpiar();
    }

    // B. Barrera con timeout seguro y reinicio:
    // 1. Libera exactamente al alcanzar la capacidad
    const barreraNormal = crearBarreraConcurrencia(2, 1000);
    let barreraDesbloqueada = false;
    const p1 = barreraNormal.esperar();
    const p2 = barreraNormal.esperar().then(() => {
      barreraDesbloqueada = true;
    });
    await Promise.all([p1, p2]);
    assert.equal(barreraDesbloqueada, true, "La barrera debe liberar al alcanzar la capacidad");

    // 2. Si falta un participante, rechaza a todos los que esperan por timeout
    const barreraTimeout = crearBarreraConcurrencia(2, 50); // 50ms corto
    let errorCapturadoBarrera: any = null;
    try {
      await barreraTimeout.esperar();
    } catch (err: any) {
      errorCapturadoBarrera = err;
    }
    assert.ok(errorCapturadoBarrera, "Debe rechazar con error tras vencer timeoutMs");
    assert.ok(
      String(errorCapturadoBarrera).includes("BARRERA_TIMEOUT"),
      "El error debe identificar BARRERA_TIMEOUT"
    );

    // 3. Después del timeout o reiniciar() puede reutilizarse de forma segura
    const barreraReutilizable = crearBarreraConcurrencia(2, 1000);
    const pEsperaReinicio = barreraReutilizable.esperar();
    barreraReutilizable.reiniciar("Reinicio forzado seguro");
    let errorReinicioCapturado: any = null;
    try {
      await pEsperaReinicio;
    } catch (err: any) {
      errorReinicioCapturado = err;
    }
    assert.ok(errorReinicioCapturado, "Participante esperando debe ser rechazado al reiniciar");
    assert.ok(String(errorReinicioCapturado).includes("Reinicio forzado seguro"));

    // 4. Reutilización tras reinicio
    let liberadaTrasReinicio = false;
    const pR1 = barreraReutilizable.esperar();
    const pR2 = barreraReutilizable.esperar().then(() => {
      liberadaTrasReinicio = true;
    });
    await Promise.all([pR1, pR2]);
    assert.equal(liberadaTrasReinicio, true, "La barrera reiniciada puede reutilizarse exitosamente");

    // -----------------------------------------------------------------
    // Caso 32: Contrato estricto de VENCIMIENTO_INVITACION_HORAS, CONFIAR_PROXY y req.ip real
    // -----------------------------------------------------------------
    // A. Contrato de VENCIMIENTO_INVITACION_HORAS:
    // 1. Valores permitidos:
    assert.equal(parsearVencimientoInvitacionHoras(undefined), 168);
    assert.equal(parsearVencimientoInvitacionHoras(null), 168);
    assert.equal(parsearVencimientoInvitacionHoras(""), 168);
    assert.equal(parsearVencimientoInvitacionHoras("1"), 1);
    assert.equal(parsearVencimientoInvitacionHoras("168"), 168);
    assert.equal(parsearVencimientoInvitacionHoras("720"), 720);

    // 2. Valores inválidos rechazados con error claro:
    const vencimientosInvalidos = ["0", "-1", "1.5", "721", "168horas", "treintadias", "abc"];
    for (const inv of vencimientosInvalidos) {
      assert.throws(
        () => parsearVencimientoInvitacionHoras(inv),
        /\[SEGURIDAD\]/,
        `El vencimiento '${inv}' debe ser rechazado estrictamente`
      );
    }

    // B. Parser estricto de CONFIAR_PROXY:
    assert.equal(parsearConfiarProxy(undefined), false);
    assert.equal(parsearConfiarProxy(null), false);
    assert.equal(parsearConfiarProxy(""), false);
    assert.equal(parsearConfiarProxy("false"), false);
    assert.equal(parsearConfiarProxy("0"), false);
    assert.equal(parsearConfiarProxy("1"), 1);
    assert.equal(parsearConfiarProxy("3"), 3);
    assert.equal(parsearConfiarProxy("10"), 10);

    const proxiesInvalidos = ["true", "1junk", "-1", "0.5", "11", "999", "loopback", "untrusted"];
    for (const invalido of proxiesInvalidos) {
      assert.throws(
        () => parsearConfiarProxy(invalido),
        /\[SEGURIDAD\]/,
        `El valor de proxy '${invalido}' debe ser rechazado`
      );
    }

    // C. Pruebas reales de req.ip y X-Forwarded-For mediante endpoint exclusivo /__prueba_ip__ en la APLICACIÓN REAL:
    // Guardar configuración original y asegurar restauración en bloque finally
    const trustProxyCaso32Original = aplicacion.get("trust proxy");

    try {
      // 1. trust proxy = false sobre la APLICACIÓN REAL:
      // Enviar X-Forwarded-For falsificado debe ser ignorado y req.ip debe provenir del socket
      aplicacion.set("trust proxy", false);

      const resIpDesactivado = await fetch(`${urlApi}/__prueba_ip__`, {
        headers: { "X-Forwarded-For": "203.0.113.195" },
      });
      assert.equal(resIpDesactivado.status, 200);
      const datosIpDesactivado = (await resIpDesactivado.json()) as any;
      assert.notEqual(
        datosIpDesactivado.ip,
        "203.0.113.195",
        "Con trust proxy = false, req.ip NO debe tomar la dirección falsificada del encabezado"
      );
      assert.equal(
        datosIpDesactivado.ip,
        datosIpDesactivado.remoteAddress,
        "req.ip debe provenir estrictamente de la conexión TCP socket"
      );

      // 2. Con trust proxy = false, dos encabezados X-Forwarded-For distintos no permiten evadir el rate limit
      limitadorAceptacionGlobalIp.reiniciar();
      try {
        for (let i = 1; i <= 15; i++) {
          await fetch(`${urlApi}/api/invitaciones/tok_evadir_${i}/aceptar`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": `198.51.100.${i}`, // Intentar falsificar IPs diferentes en cada petición
            },
            body: JSON.stringify({ contrasena: "WrongPass123!" }),
          });
        }
        // La solicitud 16 debe ser bloqueada con 429 porque la IP real del socket TCP no cambia
        const rIntento16 = await fetch(`${urlApi}/api/invitaciones/tok_evadir_16/aceptar`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": "198.51.100.99",
          },
          body: JSON.stringify({ contrasena: "WrongPass123!" }),
        });
        assert.equal(
          rIntento16.status,
          429,
          "Falsificar X-Forwarded-For no permite evadir el límite de tasa cuando trust proxy está desactivado"
        );
      } finally {
        limitadorAceptacionGlobalIp.reiniciar();
      }

      // 3. trust proxy = 1 sobre la APLICACIÓN REAL:
      aplicacion.set("trust proxy", 1);
      const resConfiadoRealApp = await fetch(`${urlApi}/__prueba_ip__`, {
        headers: { "X-Forwarded-For": "198.51.100.42, 203.0.113.195" },
      });
      assert.equal(resConfiadoRealApp.status, 200);
      const datosConfiadoRealApp = (await resConfiadoRealApp.json()) as any;
      assert.equal(
        datosConfiadoRealApp.ip,
        "203.0.113.195",
        "Con trust proxy = 1 en la app real, req.ip toma el cliente del salto confiable"
      );

      // 4. Instancia aislada adicional de servidor Express para verificar trust proxy = 1 de forma independiente
      const appPruebaProxy = (await import("express")).default();
      appPruebaProxy.set("trust proxy", 1);
      appPruebaProxy.get("/test-ip-proxy", (req, res) => {
        res.json({ ip: req.ip });
      });
      const srvProxy = createServer(appPruebaProxy);
      let urlProxyTest = "";
      await new Promise<void>((resolve) => {
        srvProxy.listen(0, () => {
          const addr = srvProxy.address();
          if (typeof addr === "object" && addr) {
            urlProxyTest = `http://localhost:${addr.port}`;
          }
          resolve();
        });
      });
      try {
        const resConfiado = await fetch(`${urlProxyTest}/test-ip-proxy`, {
          headers: { "X-Forwarded-For": "198.51.100.42, 203.0.113.195" },
        });
        const datosConfiado = (await resConfiado.json()) as any;
        assert.equal(datosConfiado.ip, "203.0.113.195");
      } finally {
        await new Promise<void>((resolve) => srvProxy.close(() => resolve()));
      }
    } finally {
      // Restaurar siempre la configuración original y reiniciar los limitadores
      aplicacion.set("trust proxy", trustProxyCaso32Original);
      limitadorConsultaGlobalIp.reiniciar();
      limitadorConsultaEspecifico.reiniciar();
      limitadorAceptacionGlobalIp.reiniciar();
      limitadorAceptacionEspecifico.reiniciar();
    }

    // -----------------------------------------------------------------
    // Caso 33: Sanitización de Morgan: logs no contienen token en URL ni Referer
    // -----------------------------------------------------------------
    const tokenCentinela = "token_centinela_super_secreto_9988776655";
    const hashCentinela = hashTokenInvitacion(tokenCentinela);

    const logsCapturados: string[] = [];
    const stdoutOriginalWrite = process.stdout.write.bind(process.stdout);

    try {
      // Capturar salida de stdout donde Morgan escribe
      (process.stdout.write as any) = (chunk: any, ...args: any[]) => {
        const str = typeof chunk === "string" ? chunk : chunk.toString();
        logsCapturados.push(str);
        return true;
      };

      // Realizar solicitud con token centinela en URL y en cabecera Referer
      await fetch(`${urlApi}/api/invitaciones/${tokenCentinela}`, {
        headers: {
          Referer: `https://dominio.test/invitacion/${tokenCentinela}`,
        },
      });

      // Esperar un ciclo para que Morgan procese el evento on-finish
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      // Restaurar stdout garantizado en bloque finally
      process.stdout.write = stdoutOriginalWrite;
    }

    const logCompleto = logsCapturados.join("\n");
    assert.ok(
      logCompleto.includes("[REDACTADO]"),
      "El registro de log debe contener la etiqueta [REDACTADO]"
    );
    assert.ok(
      !logCompleto.includes(tokenCentinela),
      "El registro de log NUNCA debe contener el token centinela en texto plano"
    );
    assert.ok(
      !logCompleto.includes(hashCentinela),
      "El registro de log NUNCA debe contener el hash SHA-256 del token"
    );

    // -----------------------------------------------------------------
    // Caso 34: Autenticación exitosa mediante inicio-sesion de la issue #3 con el acceso creado
    // -----------------------------------------------------------------
    const resLoginNuevoCliente = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "flamante.cliente@example.test",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resLoginNuevoCliente.status, 200);
    const datosLoginNuevo = (await resLoginNuevoCliente.json()) as any;
    assert.equal(datosLoginNuevo.contexto.tipoAcceso, "CLIENTE");
    assert.equal(datosLoginNuevo.contexto.clienteId, clienteAlfa.id);

    // -----------------------------------------------------------------
    // Caso 35: Ramas deterministas de manejo de error P2002 (Casos A, B, C y D)
    // -----------------------------------------------------------------
    // --- Caso A.1: Colisión de token_hash en creación con secuencia controlada de tokens ---
    // Encolamos dos tokens: tokenColisionA1 (colisiona en intento 1) y tokenExitoA1 (tiene éxito en intento 2)
    const tokenColisionA1 = "token_secuencia_colision_a1_1234567890";
    const tokenExitoA1 = "token_secuencia_exito_a1_1234567890";
    const hashColisionA1 = hashTokenInvitacion(tokenColisionA1);
    const hashExitoA1 = hashTokenInvitacion(tokenExitoA1);

    hooksPruebas.limpiar();
    hooksPruebas.encolarTokens([tokenColisionA1, tokenExitoA1]);

    let intentosInyeccionA1 = 0;
    hooksPruebas.registrarInyectorFallo("en_transaccion_crear_invitacion", () => {
      intentosInyeccionA1++;
      if (intentosInyeccionA1 === 1) {
        return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on token_hash", {
          code: "P2002",
          clientVersion: "6.16.1",
          meta: { target: ["token_hash"] },
        });
      }
      return null;
    });

    try {
      const resCasoA1 = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenProp}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          correo: "colision.secuencia.a1@example.test",
          rol: "TITULAR",
        }),
      });
      assert.equal(resCasoA1.status, 201, "Colisión de token_hash debe reintentar y devolver 201");
      const datosCasoA1 = (await resCasoA1.json()) as any;
      assert.ok(datosCasoA1.invitacion.id);
      assert.equal(intentosInyeccionA1, 2, "Debe haber ocurrido exactamente un reintento");

      // Comprobar que el segundo token fue utilizado y el primero no quedó asociado a la nueva invitación
      const invCreadaA1 = await prisma.invitacionCliente.findUnique({
        where: { id: datosCasoA1.invitacion.id },
      });
      assert.equal(invCreadaA1?.tokenHash, hashExitoA1, "La invitación creada debe usar el segundo token");
      assert.notEqual(invCreadaA1?.tokenHash, hashColisionA1, "El primer token colisionado no debe quedar asociado");

      // Verificar que solo se persistió exactamente una invitación y una actividad confirmada
      const invsCasoA1 = await prisma.invitacionCliente.findMany({
        where: { clienteId: clienteAlfa.id, correo: "colision.secuencia.a1@example.test" },
      });
      assert.equal(invsCasoA1.length, 1);
      const actsCasoA1 = await prisma.actividad.findMany({
        where: { entidadId: datosCasoA1.invitacion.id, accion: "INVITAR" },
      });
      assert.equal(actsCasoA1.length, 1);
    } finally {
      hooksPruebas.limpiar();
    }

    // --- Caso A.2: Agotamiento de 5 colisiones de token_hash en creación ---
    hooksPruebas.limpiar();
    let intentosAgotamientoA = 0;
    hooksPruebas.registrarInyectorFallo("en_transaccion_crear_invitacion", () => {
      intentosAgotamientoA++;
      return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on token_hash", {
        code: "P2002",
        clientVersion: "6.16.1",
        meta: { target: ["token_hash"] },
      });
    });

    try {
      const resCasoA2 = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenProp}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          correo: "colision.agotada.a2@example.test",
          rol: "TITULAR",
        }),
      });
      assert.equal(resCasoA2.status, 409, "Agotar las 5 generaciones de token_hash debe devolver conflicto 409 controlado");
      assert.equal(intentosAgotamientoA, 5, "Debe haber alcanzado exactamente 5 intentos antes de responder 409");
      const datosCasoA2 = (await resCasoA2.json()) as any;
      assert.ok(datosCasoA2.error.includes("No fue posible generar un token único"));

      // Verificar que no quedaron invitaciones ni actividades
      const invsCasoA2 = await prisma.invitacionCliente.findMany({
        where: { clienteId: clienteAlfa.id, correo: "colision.agotada.a2@example.test" },
      });
      assert.equal(invsCasoA2.length, 0);
    } finally {
      hooksPruebas.limpiar();
    }

    // --- Caso B.1: Conflicto del índice parcial en creación con recuperación exitosa en segundo intento ---
    hooksPruebas.limpiar();
    let intentosRecuperacionB = 0;
    hooksPruebas.registrarInyectorFallo("en_transaccion_crear_invitacion", () => {
      intentosRecuperacionB++;
      if (intentosRecuperacionB === 1) {
        return new Prisma.PrismaClientKnownRequestError(
          "Unique constraint failed on invitaciones_cliente_cliente_id_correo_pendiente_key",
          {
            code: "P2002",
            clientVersion: "6.16.1",
            meta: { target: ["invitaciones_cliente_cliente_id_correo_pendiente_key"] },
          }
        );
      }
      return null; // Segundo intento exitoso
    });

    try {
      const resCasoB1 = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenProp}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          correo: "recuperacion.parcial.b1@example.test",
          rol: "TITULAR",
        }),
      });
      assert.equal(resCasoB1.status, 201, "Debe recuperarse tras colisión parcial y responder 201");
      const datosCasoB1 = (await resCasoB1.json()) as any;
      assert.ok(datosCasoB1.invitacion.id);
      assert.equal(intentosRecuperacionB, 2, "Debe haber requerido 2 intentos");

      // Verificar exactamente una invitación PENDIENTE y una actividad INVITAR
      const invsCasoB1 = await prisma.invitacionCliente.findMany({
        where: { clienteId: clienteAlfa.id, correo: "recuperacion.parcial.b1@example.test", estado: "PENDIENTE" },
      });
      assert.equal(invsCasoB1.length, 1, "Debe quedar exactamente una invitación PENDIENTE");

      const actsCasoB1 = await prisma.actividad.findMany({
        where: { entidadId: datosCasoB1.invitacion.id, accion: "INVITAR" },
      });
      assert.equal(actsCasoB1.length, 1, "Debe registrarse exactamente una actividad INVITAR");
    } finally {
      hooksPruebas.limpiar();
    }

    // --- Caso B.2: Conflicto del índice parcial pendiente en creación con agotamiento (5 intentos -> 409) ---
    let intentosInyeccionB2 = 0;
    hooksPruebas.limpiar();
    hooksPruebas.registrarInyectorFallo("en_transaccion_crear_invitacion", () => {
      intentosInyeccionB2++;
      return new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed on invitaciones_cliente_cliente_id_correo_pendiente_key",
        {
          code: "P2002",
          clientVersion: "6.16.1",
          meta: { target: ["invitaciones_cliente_cliente_id_correo_pendiente_key"] },
        }
      );
    });

    try {
      const resCasoB2 = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenProp}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          correo: "conflicto.pendiente.b2@example.test",
          rol: "TITULAR",
        }),
      });
      assert.equal(resCasoB2.status, 409, "Conflicto en índice parcial pendiente debe responder HTTP 409 controlado");
      assert.equal(intentosInyeccionB2, 5, "Debe agotar los 5 reintentos con backoff");

      const invsCasoB2 = await prisma.invitacionCliente.findMany({
        where: { clienteId: clienteAlfa.id, correo: "conflicto.pendiente.b2@example.test" },
      });
      assert.equal(invsCasoB2.length, 0, "No deben quedar invitaciones de transacciones revertidas");
    } finally {
      hooksPruebas.limpiar();
    }

    // --- Caso C: P2002 no reconocido en creación (otra restricción ajena) ---
    hooksPruebas.limpiar();
    let intentosCasoC = 0;
    hooksPruebas.registrarInyectorFallo("en_transaccion_crear_invitacion", () => {
      intentosCasoC++;
      return new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed on other_unrelated_constraint_key",
        {
          code: "P2002",
          clientVersion: "6.16.1",
          meta: { target: ["otra_restriccion_ajena_key"] },
        }
      );
    });

    try {
      const resCasoC = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenProp}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          correo: "otra.restriccion.c@example.test",
          rol: "TITULAR",
        }),
      });
      assert.equal(resCasoC.status, 500, "P2002 ajeno debe responder 500");
      assert.equal(intentosCasoC, 1, "P2002 ajeno NO debe entrar en bucle de reintentos");

      const datosCasoC = (await resCasoC.json()) as any;
      // Verificar cuerpo externo genérico sin detalles de Prisma, constraint, SQL, token ni hash
      assert.equal(datosCasoC.error, "Ocurrió un error inesperado", "Debe devolver cuerpo externo genérico");
      const textoRespuestaC = JSON.stringify(datosCasoC);
      assert.ok(!textoRespuestaC.includes("P2002"));
      assert.ok(!textoRespuestaC.includes("Prisma"));
      assert.ok(!textoRespuestaC.includes("otra_restriccion_ajena_key"));
      assert.ok(!textoRespuestaC.includes("constraint"));

      const invsCasoC = await prisma.invitacionCliente.findMany({
        where: { clienteId: clienteAlfa.id, correo: "otra.restriccion.c@example.test" },
      });
      assert.equal(invsCasoC.length, 0, "No deben quedar efectos parciales tras error 500");
    } finally {
      hooksPruebas.limpiar();
    }

    // --- Caso D: Reenvío con pruebas separadas para las 3 ramas P2002 ---
    // Preparamos una invitación expirada base para reenvío
    const tokenExpiradaBase = "token_reenvio_base_expirada_12345678";
    const hashExpiradaBase = hashTokenInvitacion(tokenExpiradaBase);
    const invExpiradaBase = await prisma.invitacionCliente.create({
      data: {
        clienteId: clienteAlfa.id,
        organizacionId: orgAlfaId,
        correo: "reenvio.tres.ramas@example.test",
        tokenHash: hashExpiradaBase,
        rol: "TITULAR",
        estado: "EXPIRADA",
        expiraEn: new Date(Date.now() - 3600000),
        invitadoPorId: usuarioPropId,
      },
    });

    // D.1: P2002 del índice parcial en reenvío
    hooksPruebas.limpiar();
    hooksPruebas.registrarInyectorFallo("en_transaccion_reenviar_invitacion", () => {
      return new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed on invitaciones_cliente_cliente_id_correo_pendiente_key",
        {
          code: "P2002",
          clientVersion: "6.16.1",
          meta: { target: ["invitaciones_cliente_cliente_id_correo_pendiente_key"] },
        }
      );
    });

    try {
      const resD1 = await fetch(
        `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${invExpiradaBase.id}/reenviar`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenProp}` },
        }
      );
      assert.equal(resD1.status, 409, "Reenvío con P2002 de índice parcial debe responder HTTP 409");
      const datosD1 = (await resD1.json()) as any;
      assert.ok(datosD1.error.includes("Ya existe una invitación pendiente activa"));
      assert.ok(!datosD1.enlaceInvitacion, "No debe entregarse enlace nuevo");

      // El token anterior conserva su validez, tokenHash y estado permanecen intactos
      const invBD_D1 = await prisma.invitacionCliente.findUnique({ where: { id: invExpiradaBase.id } });
      assert.equal(invBD_D1?.estado, "EXPIRADA");
      assert.equal(invBD_D1?.tokenHash, hashExpiradaBase);

      const actD1 = await prisma.actividad.findFirst({
        where: { entidadId: invExpiradaBase.id, accion: "REENVIAR" },
      });
      assert.equal(actD1, null, "No debe registrarse actividad REENVIAR");
    } finally {
      hooksPruebas.limpiar();
    }

    // D.2: P2002 de token_hash en reenvío (recuperación exitosa y reintento acotado)
    const tokenExpiradaD2 = "token_reenvio_d2_expirada_12345678";
    const hashExpiradaD2 = hashTokenInvitacion(tokenExpiradaD2);
    const invExpiradaD2 = await prisma.invitacionCliente.create({
      data: {
        clienteId: clienteAlfa.id,
        organizacionId: orgAlfaId,
        correo: "reenvio.d2.recuperacion@example.test",
        tokenHash: hashExpiradaD2,
        rol: "TITULAR",
        estado: "EXPIRADA",
        expiraEn: new Date(Date.now() - 3600000),
        invitadoPorId: usuarioPropId,
      },
    });

    hooksPruebas.limpiar();
    let intentosReenvioTokenHash = 0;
    hooksPruebas.registrarInyectorFallo("en_transaccion_reenviar_invitacion", () => {
      intentosReenvioTokenHash++;
      if (intentosReenvioTokenHash === 1) {
        return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on token_hash", {
          code: "P2002",
          clientVersion: "6.16.1",
          meta: { target: ["token_hash"] },
        });
      }
      return null; // Segundo intento tiene éxito
    });

    try {
      const resD2 = await fetch(
        `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${invExpiradaD2.id}/reenviar`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenProp}` },
        }
      );
      assert.equal(resD2.status, 200, "Reenvío con colisión de token_hash debe regenerar token y tener éxito (200)");
      assert.equal(intentosReenvioTokenHash, 2, "Debe haber reintentado exactamente una vez");
      const datosD2 = (await resD2.json()) as any;
      assert.ok(datosD2.enlaceInvitacion);

      const invBD_D2 = await prisma.invitacionCliente.findUnique({ where: { id: invExpiradaD2.id } });
      assert.equal(invBD_D2?.estado, "PENDIENTE");
      assert.notEqual(invBD_D2?.tokenHash, hashExpiradaD2, "El tokenHash debe haber cambiado al nuevo");
    } finally {
      hooksPruebas.limpiar();
    }

    // D.2.b: P2002 de token_hash en reenvío que agota los 5 intentos -> devuelve 409 controlado (no 500)
    const tokenExpiradaD2b = "token_reenvio_d2b_expirada_12345678";
    const hashExpiradaD2b = hashTokenInvitacion(tokenExpiradaD2b);
    const invExpiradaD2b = await prisma.invitacionCliente.create({
      data: {
        clienteId: clienteAlfa.id,
        organizacionId: orgAlfaId,
        correo: "reenvio.d2b.agotado@example.test",
        tokenHash: hashExpiradaD2b,
        rol: "TITULAR",
        estado: "EXPIRADA",
        expiraEn: new Date(Date.now() - 3600000),
        invitadoPorId: usuarioPropId,
      },
    });

    hooksPruebas.limpiar();
    let intentosReenvioAgotado = 0;
    hooksPruebas.registrarInyectorFallo("en_transaccion_reenviar_invitacion", () => {
      intentosReenvioAgotado++;
      return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on token_hash", {
        code: "P2002",
        clientVersion: "6.16.1",
        meta: { target: ["token_hash"] },
      });
    });

    try {
      const resD2b = await fetch(
        `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${invExpiradaD2b.id}/reenviar`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenProp}` },
        }
      );
      assert.equal(resD2b.status, 409, "Agotar reintentos de token_hash en reenvío debe devolver 409 controlado (no 500)");
      assert.equal(intentosReenvioAgotado, 5, "Debe agotar los 5 reintentos");
      const datosD2b = (await resD2b.json()) as any;
      assert.ok(!datosD2b.enlaceInvitacion);

      // Estado y tokenHash anteriores permanecen intactos
      const invBD_D2b = await prisma.invitacionCliente.findUnique({ where: { id: invExpiradaD2b.id } });
      assert.equal(invBD_D2b?.estado, "EXPIRADA");
      assert.equal(invBD_D2b?.tokenHash, hashExpiradaD2b);
    } finally {
      hooksPruebas.limpiar();
    }

    // D.3: P2002 ajeno en reenvío (llega al manejador general sin filtrar detalles internos)
    const tokenExpiradaD3 = "token_reenvio_d3_expirada_12345678";
    const hashExpiradaD3 = hashTokenInvitacion(tokenExpiradaD3);
    const invExpiradaD3 = await prisma.invitacionCliente.create({
      data: {
        clienteId: clienteAlfa.id,
        organizacionId: orgAlfaId,
        correo: "reenvio.d3.ajeno@example.test",
        tokenHash: hashExpiradaD3,
        rol: "TITULAR",
        estado: "EXPIRADA",
        expiraEn: new Date(Date.now() - 3600000),
        invitadoPorId: usuarioPropId,
      },
    });

    hooksPruebas.limpiar();
    let intentosD3 = 0;
    hooksPruebas.registrarInyectorFallo("en_transaccion_reenviar_invitacion", () => {
      intentosD3++;
      return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on other_key", {
        code: "P2002",
        clientVersion: "6.16.1",
        meta: { target: ["otra_restriccion_reenvio_key"] },
      });
    });

    try {
      const resD3 = await fetch(
        `${urlApi}/api/clientes/${clienteAlfa.id}/invitaciones/${invExpiradaD3.id}/reenviar`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${tokenProp}` },
        }
      );
      assert.equal(resD3.status, 500, "P2002 ajeno en reenvío debe devolver 500");
      assert.equal(intentosD3, 1, "P2002 ajeno no debe reintentar");
      const datosD3 = (await resD3.json()) as any;
      assert.equal(datosD3.error, "Ocurrió un error inesperado", "Debe devolver cuerpo genérico sin detalles");
      assert.ok(!JSON.stringify(datosD3).includes("otra_restriccion_reenvio_key"));
      assert.ok(!datosD3.enlaceInvitacion);

      // Estado y tokenHash anteriores permanecen intactos
      const invBD_D3 = await prisma.invitacionCliente.findUnique({ where: { id: invExpiradaD3.id } });
      assert.equal(invBD_D3?.estado, "EXPIRADA");
      assert.equal(invBD_D3?.tokenHash, hashExpiradaD3);

      const actD3 = await prisma.actividad.findFirst({
        where: { entidadId: invExpiradaD3.id, accion: "REENVIAR" },
      });
      assert.equal(actD3, null, "No debe registrarse actividad REENVIAR");
    } finally {
      hooksPruebas.limpiar();
    }
    const nuevos = await ejecutarBloqueos({
      urlApi, clienteId: clienteAlfa.id, organizacionId: orgAlfaId, usuarioId: usuarioPropId,
      tokenProp, tokenBeta, tokenCliente: tokenClienteRol,
    });
    console.log(`[casos-invitaciones] Suite completada: 35 casos existentes + ${nuevos} nuevos = ${35 + nuevos} casos.`);
  } finally {
    // Limpieza de limitadores para no contaminar ejecuciones
    limitadorConsultaGlobalIp.reiniciar();
    limitadorConsultaEspecifico.reiniciar();
    limitadorAceptacionGlobalIp.reiniciar();
    limitadorAceptacionEspecifico.reiniciar();

    if (servidor) {
      await new Promise<void>((resolve) => {
        (servidor as ReturnType<typeof createServer>).close(() => resolve());
      });
    }
    await prisma.$disconnect();
  }
}

ejecutarCasos().catch((err) => {
  console.error("Error en casos de invitaciones:", err);
  process.exit(1);
});
