import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { ejecutarRotacionMfaPendiente } from "../src/cli/rotar-mfa-pendiente.js";
import {
  cifrarSecretoMfa,
  descifrarSecretoMfa,
  generarCodigoTotpParaPaso,
  calcularPasoTotp,
  verificarCodigoTotp,
} from "../src/utilidades/mfa.js";

async function iniciarServidorPrueba(): Promise<{ urlBase: string; cerrar: () => Promise<void> }> {
  const servidor = createServer(aplicacion);
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const dir = servidor.address() as AddressInfo;
  return {
    urlBase: `http://127.0.0.1:${dir.port}/api`,
    cerrar: () => new Promise<void>((resolve, reject) => servidor.close((e) => (e ? reject(e) : resolve()))),
  };
}

export async function ejecutarCasosMfaEnrolamientoQr(): Promise<void> {
  const { urlBase, cerrar } = await iniciarServidorPrueba();

  try {
    const correoAdmin = "admin-mfa-fixture@equinox.test";
    const contrasenaAdmin = "ClaveFixtureAdmin#2026!";
    const hash = await bcrypt.hash(contrasenaAdmin, 10);

    // Secreto ficticio exclusivo para fixture de prueba
    const secretoAnteriorFicticio = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    const secretoCifradoInicial = cifrarSecretoMfa(secretoAnteriorFicticio);

    const admin = await prisma.usuario.create({
      data: {
        correo: correoAdmin,
        contrasenaHash: hash,
        nombre: "Admin",
        apellido: "Fixture",
        rolPlataforma: "ADMIN_GLOBAL",
        mfaHabilitado: false,
        mfaPendienteSecretoCifrado: secretoCifradoInicial,
      },
    });

    // 1. Rotar secreto pendiente cuando mfaHabilitado=false
    const resRotacion = await ejecutarRotacionMfaPendiente(prisma, {
      correo: correoAdmin,
      confirmar: true,
    });
    assert.equal(resRotacion.rotado, true);
    assert.equal(resRotacion.usuarioId, admin.id);

    const adminPostRotacion = await prisma.usuario.findUniqueOrThrow({
      where: { id: admin.id },
      select: { mfaHabilitado: true, mfaPendienteSecretoCifrado: true },
    });
    assert.equal(adminPostRotacion.mfaHabilitado, false);
    assert.ok(adminPostRotacion.mfaPendienteSecretoCifrado);
    assert.notEqual(adminPostRotacion.mfaPendienteSecretoCifrado, secretoCifradoInicial);

    const secretoNuevo = descifrarSecretoMfa(adminPostRotacion.mfaPendienteSecretoCifrado);
    assert.notEqual(secretoNuevo, secretoAnteriorFicticio);

    // Verificar que un TOTP generado con el secreto anterior ya NO es válido contra el nuevo secreto pendiente
    const pasoActual = calcularPasoTotp();
    const codigoViejo = generarCodigoTotpParaPaso(secretoAnteriorFicticio, pasoActual);
    const verifViejo = verificarCodigoTotp(secretoNuevo, codigoViejo);
    assert.equal(verifViejo.valido, false, "El código TOTP del secreto anterior debe ser rechazado");

    // 2. Flujo HTTP: inicio-sesion -> iniciar-configuracion -> confirmar-configuracion
    const resLogin = await fetch(`${urlBase}/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: correoAdmin,
        contrasena: contrasenaAdmin,
        seleccion: { tipoAcceso: "ADMIN_GLOBAL" },
      }),
    });
    assert.equal(resLogin.status, 200);
    const loginJson = (await resLogin.json()) as any;
    assert.equal(loginJson.mfaRequerido, true);
    assert.equal(loginJson.estadoMfa, "CONFIGURAR");
    assert.ok(loginJson.tokenDesafioMfa);

    const resSetup = await fetch(`${urlBase}/autenticacion/admin/mfa/iniciar-configuracion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenDesafioMfa: loginJson.tokenDesafioMfa }),
    });
    assert.equal(resSetup.status, 200);
    const setupJson = (await resSetup.json()) as any;
    assert.equal(setupJson.emisor, "Equinox");
    assert.equal(setupJson.cuenta, correoAdmin);
    assert.ok(typeof setupJson.otpauthUrl === "string" && setupJson.otpauthUrl.startsWith("otpauth://totp/"));

    const parsedOtpauth = new URL(setupJson.otpauthUrl);
    assert.equal(parsedOtpauth.protocol, "otpauth:");
    assert.equal(parsedOtpauth.searchParams.get("secret"), setupJson.secretoBase32);
    assert.equal(parsedOtpauth.searchParams.get("issuer"), "Equinox");
    assert.equal(parsedOtpauth.searchParams.get("digits"), "6");
    assert.equal(parsedOtpauth.searchParams.get("period"), "30");

    // Intentar confirmar con código del secreto anterior debe fallar con 401
    const resConfirmViejo = await fetch(`${urlBase}/autenticacion/admin/mfa/confirmar-configuracion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenDesafioMfa: loginJson.tokenDesafioMfa,
        codigoTotp: codigoViejo,
      }),
    });
    assert.equal(resConfirmViejo.status, 401);

    // Confirmar con código TOTP válido de 6 dígitos del nuevo secreto
    const codigoValido = generarCodigoTotpParaPaso(setupJson.secretoBase32, calcularPasoTotp());
    const resConfirm = await fetch(`${urlBase}/autenticacion/admin/mfa/confirmar-configuracion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenDesafioMfa: loginJson.tokenDesafioMfa,
        codigoTotp: codigoValido,
      }),
    });
    assert.equal(resConfirm.status, 200);
    const confirmJson = (await resConfirm.json()) as any;
    assert.ok(confirmJson.token);
    assert.equal(confirmJson.usuario.mfaHabilitado, true);
    assert.ok(Array.isArray(confirmJson.codigosRecuperacion) && confirmJson.codigosRecuperacion.length === 8);

    // 3. Si MFA ya está habilitado, rotar-mfa-pendiente debe rechazar sin alterar MFA activo
    await assert.rejects(
      () => ejecutarRotacionMfaPendiente(prisma, { correo: correoAdmin, confirmar: true }),
      /ya está habilitado/i
    );

    const adminFinal = await prisma.usuario.findUniqueOrThrow({
      where: { id: admin.id },
      select: { mfaHabilitado: true, mfaPendienteSecretoCifrado: true },
    });
    assert.equal(adminFinal.mfaHabilitado, true);
    assert.equal(adminFinal.mfaPendienteSecretoCifrado, null);

    console.log("[mfa-enrolamiento-qr] Todos los casos pasaron correctamente.");
  } finally {
    await cerrar();
  }
}
