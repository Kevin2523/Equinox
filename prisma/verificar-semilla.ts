import {
  Prisma,
  PrismaClient,
  RolMiembro,
  RolCliente,
  EstadoInvitacionCliente,
  EstadoProyecto
} from '@prisma/client';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { SEMILLA_IDS, DEMO_CONFIG } from './seed';

dotenv.config();

const prisma = new PrismaClient();

const UUID_TEST_ACCESO = 'ffffffff-ffff-4fff-8fff-ffffffffff01';
const UUID_TEST_INVITACION = 'ffffffff-ffff-4fff-8fff-ffffffffff02';

async function verificarSemilla() {
  console.log('🔍 Iniciando verificación exhaustiva de semilla y restricciones de base de datos...\n');
  let pruebasPasadas = 0;
  let pruebasTotales = 0;

  function registrarPrueba(nombre: string, condicion: boolean, detalle?: string) {
    pruebasTotales++;
    if (condicion) {
      pruebasPasadas++;
      console.log(`  ✅ [PASÓ] ${nombre}`);
      if (detalle) console.log(`     └─ ${detalle}`);
    } else {
      console.error(`  ❌ [FALLÓ] ${nombre}`);
      if (detalle) console.error(`     └─ ${detalle}`);
      throw new Error(`Fallo en prueba: ${nombre}`);
    }
  }

  // ========================================================
  // 1. EL PROPIETARIO PERTENECE A SU ORGANIZACIÓN
  // ========================================================
  console.log('1. Verificando pertenencia y rol del propietario...');
  const propietario = await prisma.usuario.findUnique({
    where: { id: SEMILLA_IDS.USER_PROP_1 },
    include: { membresias: { include: { organizacion: true } } }
  });

  const membresiaProp = propietario?.membresias.find(
    (m) => m.organizacionId === SEMILLA_IDS.ORG_1
  );

  registrarPrueba(
    'El propietario existe y tiene membresía PROPIETARIO en su organización',
    propietario !== null &&
      membresiaProp !== undefined &&
      membresiaProp.rol === RolMiembro.PROPIETARIO &&
      membresiaProp.organizacion.slug === 'estudio-demo-istmo',
    `Usuario: ${propietario?.correo}, Org: ${membresiaProp?.organizacion.nombre}, Rol: ${membresiaProp?.rol}`
  );

  // ========================================================
  // 2. LA CUENTA DEL CLIENTE ESTÁ VINCULADA MEDIANTE ACCESO_CLIENTE
  // ========================================================
  console.log('\n2. Verificando vinculación de cuenta del cliente (AccesoCliente)...');
  const accesoCliente = await prisma.accesoCliente.findUnique({
    where: {
      usuarioId_clienteId: {
        usuarioId: SEMILLA_IDS.USER_CLIENTE_1,
        clienteId: SEMILLA_IDS.CLIENTE_1
      }
    },
    include: {
      usuario: true,
      cliente: true,
      organizacion: true
    }
  });

  registrarPrueba(
    'AccesoCliente vincula usuario, ficha cliente y organización con rol TITULAR activo',
    accesoCliente !== null &&
      accesoCliente.organizacionId === SEMILLA_IDS.ORG_1 &&
      accesoCliente.rol === RolCliente.TITULAR &&
      accesoCliente.activo === true,
    `Usuario: ${accesoCliente?.usuario.correo} -> Cliente: ${accesoCliente?.cliente.nombre} (${accesoCliente?.rol})`
  );

  // ========================================================
  // 3. EL PROYECTO PERTENECE AL CLIENTE Y ORGANIZACIÓN CORRECTOS
  // ========================================================
  console.log('\n3. Verificando proyecto asignado al cliente...');
  const proyecto = await prisma.proyecto.findUnique({
    where: { id: SEMILLA_IDS.PROYECTO_1 },
    include: { cliente: true, organizacion: true, creadoPor: true }
  });

  registrarPrueba(
    'El proyecto pertenece al cliente y organización correctos',
    proyecto !== null &&
      proyecto.clienteId === SEMILLA_IDS.CLIENTE_1 &&
      proyecto.organizacionId === SEMILLA_IDS.ORG_1 &&
      proyecto.creadoPorId === SEMILLA_IDS.USER_PROP_1 &&
      proyecto.estado === EstadoProyecto.ACTIVO,
    `Proyecto: "${proyecto?.nombre}", Cliente: "${proyecto?.cliente.nombre}", Presupuesto: ${proyecto?.presupuesto} ${proyecto?.moneda}`
  );

  // ========================================================
  // 4. LA INVITACIÓN CONTIENE ESTADO, EXPIRACIÓN Y TOKEN HASH
  // ========================================================
  console.log('\n4. Verificando invitación de cliente...');
  const invitacion = await prisma.invitacionCliente.findUnique({
    where: { id: SEMILLA_IDS.INVITACION_1 }
  });

  const hashEsperado = crypto
    .createHash('sha256')
    .update(DEMO_CONFIG.TOKEN_INVITACION_DEMO)
    .digest('hex');

  registrarPrueba(
    'La invitación tiene estado PENDIENTE, expiración a futuro y tokenHash válido',
    invitacion !== null &&
      invitacion.estado === EstadoInvitacionCliente.PENDIENTE &&
      invitacion.expiraEn.getTime() > Date.now() &&
      invitacion.tokenHash === hashEsperado &&
      invitacion.rol === RolCliente.COLABORADOR,
    `Correo: ${invitacion?.correo}, Estado: ${invitacion?.estado}, Expira: ${invitacion?.expiraEn.toISOString()}`
  );

  // ========================================================
  // 5. EL TOKEN ORIGINAL NO ESTÁ ALMACENADO EN TEXTO PLANO
  // ========================================================
  console.log('\n5. Verificando que el token original no esté almacenado en PostgreSQL...');
  // Consulta parametrizada segura mediante tagged template $queryRaw
  const invitacionesConTokenPlano = await prisma.$queryRaw<any[]>`
    SELECT id, token_hash FROM invitaciones_cliente WHERE token_hash = ${DEMO_CONFIG.TOKEN_INVITACION_DEMO}
  `;

  registrarPrueba(
    'El token original en texto plano NO está almacenado en PostgreSQL',
    invitacionesConTokenPlano.length === 0 &&
      invitacion?.tokenHash !== DEMO_CONFIG.TOKEN_INVITACION_DEMO &&
      invitacion?.tokenHash === hashEsperado,
    `Token en BD (SHA-256): "${invitacion?.tokenHash.slice(0, 16)}..." [token plano no almacenado ni expuesto]`
  );

  // ========================================================
  // 6. CONVIVENCIA CON DATOS EXISTENTES E IDEMPOTENCIA
  // ========================================================
  console.log('\n6. Verificando existencia unívoca e idempotencia de los registros de la semilla...');

  // Contar exclusivamente registros identificados mediante SEMILLA_IDS
  const [
    usuarioProp1Count,
    usuarioCliente1Count,
    usuarioProp2Count,
    org1Count,
    org2Count,
    miembroProp1Count,
    miembroProp2Count,
    cliente1Count,
    cliente2Count,
    acceso1Count,
    proyecto1Count,
    invitacion1Count
  ] = await Promise.all([
    prisma.usuario.count({ where: { id: SEMILLA_IDS.USER_PROP_1 } }),
    prisma.usuario.count({ where: { id: SEMILLA_IDS.USER_CLIENTE_1 } }),
    prisma.usuario.count({ where: { id: SEMILLA_IDS.USER_PROP_2 } }),
    prisma.organizacion.count({ where: { id: SEMILLA_IDS.ORG_1 } }),
    prisma.organizacion.count({ where: { id: SEMILLA_IDS.ORG_2 } }),
    prisma.miembroOrganizacion.count({ where: { id: SEMILLA_IDS.MIEMBRO_PROP_1 } }),
    prisma.miembroOrganizacion.count({ where: { id: SEMILLA_IDS.MIEMBRO_PROP_2 } }),
    prisma.cliente.count({ where: { id: SEMILLA_IDS.CLIENTE_1 } }),
    prisma.cliente.count({ where: { id: SEMILLA_IDS.CLIENTE_2 } }),
    prisma.accesoCliente.count({ where: { id: SEMILLA_IDS.ACCESO_CLIENTE_1 } }),
    prisma.proyecto.count({ where: { id: SEMILLA_IDS.PROYECTO_1 } }),
    prisma.invitacionCliente.count({ where: { id: SEMILLA_IDS.INVITACION_1 } })
  ]);

  const todosSemillaIdsExistenUnicamente =
    usuarioProp1Count === 1 &&
    usuarioCliente1Count === 1 &&
    usuarioProp2Count === 1 &&
    org1Count === 1 &&
    org2Count === 1 &&
    miembroProp1Count === 1 &&
    miembroProp2Count === 1 &&
    cliente1Count === 1 &&
    cliente2Count === 1 &&
    acceso1Count === 1 &&
    proyecto1Count === 1 &&
    invitacion1Count === 1;

  registrarPrueba(
    'Existe exactamente un registro por cada UUID esperado de la semilla (idempotencia aislada)',
    todosSemillaIdsExistenUnicamente,
    `Todos los 12 registros clave de la semilla existen exactamente una vez (sin duplicados)`
  );

  // Verificar que no existen duplicados en las relaciones únicas de la semilla
  const [
    duplicadosMembresia1,
    duplicadosMembresia2,
    duplicadosAcceso1,
    duplicadosOrgSlug1,
    duplicadosOrgSlug2,
    duplicadosInvitacionToken
  ] = await Promise.all([
    prisma.miembroOrganizacion.count({
      where: { usuarioId: SEMILLA_IDS.USER_PROP_1, organizacionId: SEMILLA_IDS.ORG_1 }
    }),
    prisma.miembroOrganizacion.count({
      where: { usuarioId: SEMILLA_IDS.USER_PROP_2, organizacionId: SEMILLA_IDS.ORG_2 }
    }),
    prisma.accesoCliente.count({
      where: { usuarioId: SEMILLA_IDS.USER_CLIENTE_1, clienteId: SEMILLA_IDS.CLIENTE_1 }
    }),
    prisma.organizacion.count({ where: { slug: 'estudio-demo-istmo' } }),
    prisma.organizacion.count({ where: { slug: 'soluciones-cloud-demo' } }),
    prisma.invitacionCliente.count({ where: { tokenHash: hashEsperado } })
  ]);

  const relacionesUnicasSinDuplicados =
    duplicadosMembresia1 === 1 &&
    duplicadosMembresia2 === 1 &&
    duplicadosAcceso1 === 1 &&
    duplicadosOrgSlug1 === 1 &&
    duplicadosOrgSlug2 === 1 &&
    duplicadosInvitacionToken === 1;

  registrarPrueba(
    'No existen duplicados en las relaciones únicas de negocio de la semilla',
    relacionesUnicasSinDuplicados,
    'Membresías: 1/1, Accesos: 1/1, Slugs Org: 1/1, Invitación Hash: 1/1'
  );

  // ========================================================
  // 7. PRUEBA DE AISLAMIENTO MULTITENANT (VIOLACIÓN ESPECÍFICA P2003 Y LIMPIEZA)
  // ========================================================
  console.log('\n7. Verificando aislamiento multitenant y claves foráneas compuestas...');

  // Intento de asociación cruzada: Cliente 1 (de Org 1) vinculado a Org 2 en AccesoCliente
  let cruceRechazadoAcceso = false;
  let errorCapturadoAcceso: string = '';

  try {
    await prisma.accesoCliente.create({
      data: {
        id: UUID_TEST_ACCESO,
        usuarioId: SEMILLA_IDS.USER_PROP_2,
        clienteId: SEMILLA_IDS.CLIENTE_1, // Pertenece a ORG_1
        organizacionId: SEMILLA_IDS.ORG_2, // Pretendemos asignarlo a ORG_2
        rol: RolCliente.TITULAR
      }
    });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      cruceRechazadoAcceso = true;
      errorCapturadoAcceso = `PrismaClientKnownRequestError (code: ${error.code})`;
    } else {
      console.error('Error no esperado en prueba de AccesoCliente cruzado:', error);
      throw new Error(`Se esperaba estrictamente PrismaClientKnownRequestError con code P2003`);
    }
  } finally {
    // Limpieza garantizada incluso si la restricción de base de datos hubiera fallado
    await prisma.accesoCliente.deleteMany({
      where: { id: UUID_TEST_ACCESO }
    });
  }

  registrarPrueba(
    'PostgreSQL rechaza AccesoCliente cruzado específicamente con PrismaClientKnownRequestError (P2003)',
    cruceRechazadoAcceso === true,
    `Error validado específicamente: ${errorCapturadoAcceso}`
  );

  // Intento de invitación cruzada: Cliente 1 (de Org 1) vinculado a Org 2 en InvitacionCliente
  let cruceRechazadoInvitacion = false;
  let errorCapturadoInvitacion: string = '';

  try {
    await prisma.invitacionCliente.create({
      data: {
        id: UUID_TEST_INVITACION,
        organizacionId: SEMILLA_IDS.ORG_2, // ORG_2
        clienteId: SEMILLA_IDS.CLIENTE_1, // Pertenece a ORG_1
        correo: 'intruso@example.test',
        tokenHash: 'hash_invalido_de_prueba_aislamiento_multitenant_00000000000000000000',
        expiraEn: new Date(Date.now() + 86400000),
        invitadoPorId: SEMILLA_IDS.USER_PROP_2
      }
    });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      cruceRechazadoInvitacion = true;
      errorCapturadoInvitacion = `PrismaClientKnownRequestError (code: ${error.code})`;
    } else {
      console.error('Error no esperado en prueba de InvitacionCliente cruzada:', error);
      throw new Error(`Se esperaba estrictamente PrismaClientKnownRequestError con code P2003`);
    }
  } finally {
    // Limpieza garantizada
    await prisma.invitacionCliente.deleteMany({
      where: { id: UUID_TEST_INVITACION }
    });
  }

  registrarPrueba(
    'PostgreSQL rechaza InvitacionCliente cruzada específicamente con PrismaClientKnownRequestError (P2003)',
    cruceRechazadoInvitacion === true,
    `Error validado específicamente: ${errorCapturadoInvitacion}`
  );

  // Confirmar que no quedaron registros espurios
  const accesosInvalidos = await prisma.accesoCliente.findMany({
    where: { id: UUID_TEST_ACCESO }
  });
  const invitacionesInvalidas = await prisma.invitacionCliente.findMany({
    where: { id: UUID_TEST_INVITACION }
  });

  registrarPrueba(
    'La base de datos permanece limpia sin registros huérfanos ni UUIDs de prueba (try/finally)',
    accesosInvalidos.length === 0 && invitacionesInvalidas.length === 0,
    'Verificado: 0 registros espurios en accesos_cliente e invitaciones_cliente'
  );

  console.log(`\n🎉 RESULTADO: Todas las ${pruebasPasadas}/${pruebasTotales} comprobaciones superadas exitosamente.\n`);
}

verificarSemilla()
  .catch((error) => {
    console.error('❌ Error en verificación:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
