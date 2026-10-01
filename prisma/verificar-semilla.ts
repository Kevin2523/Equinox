import {
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
      membresiaProp.organizacion.slug === 'mena-studios',
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
  const invitacionesConTokenPlano = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, token_hash FROM invitaciones_cliente WHERE token_hash = $1`,
    DEMO_CONFIG.TOKEN_INVITACION_DEMO
  );

  registrarPrueba(
    'El token original en texto plano NO está almacenado en PostgreSQL',
    invitacionesConTokenPlano.length === 0 && invitacion?.tokenHash !== DEMO_CONFIG.TOKEN_INVITACION_DEMO,
    `Token plano: "${DEMO_CONFIG.TOKEN_INVITACION_DEMO}", Token en BD (SHA-256): "${invitacion?.tokenHash.slice(0, 16)}..."`
  );

  // ========================================================
  // 6. CONTEO DE REGISTROS DE LA SEMILLA
  // ========================================================
  console.log('\n6. Verificando cantidades exactas de registros...');
  const conteoUsuarios = await prisma.usuario.count();
  const conteoOrganizaciones = await prisma.organizacion.count();
  const conteoClientes = await prisma.cliente.count();
  const conteoAccesos = await prisma.accesoCliente.count();
  const conteoProyectos = await prisma.proyecto.count();
  const conteoInvitaciones = await prisma.invitacionCliente.count();

  registrarPrueba(
    'Cantidades exactas esperadas en la base de datos (idempotencia)',
    conteoUsuarios === 3 &&
      conteoOrganizaciones === 2 &&
      conteoClientes === 2 &&
      conteoAccesos === 1 &&
      conteoProyectos === 1 &&
      conteoInvitaciones === 1,
    `Usuarios: ${conteoUsuarios}, Organizaciones: ${conteoOrganizaciones}, Clientes: ${conteoClientes}, Accesos: ${conteoAccesos}, Proyectos: ${conteoProyectos}, Invitaciones: ${conteoInvitaciones}`
  );

  // ========================================================
  // 7. PRUEBA DE AISLAMIENTO MULTITENANT (VIOLACIÓN DE CLAVE FORÁNEA COMPUESTA)
  // ========================================================
  console.log('\n7. Verificando aislamiento multitenant y claves foráneas compuestas...');

  // Intento de asociación cruzada: Cliente 1 (de Org 1) vinculado a Org 2 en AccesoCliente
  let cruceRechazadoAcceso = false;
  let codigoErrorAcceso = '';

  try {
    await prisma.accesoCliente.create({
      data: {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffff01',
        usuarioId: SEMILLA_IDS.USER_PROP_2,
        clienteId: SEMILLA_IDS.CLIENTE_1, // Pertenece a ORG_1
        organizacionId: SEMILLA_IDS.ORG_2, // Pretendemos asignarlo a ORG_2
        rol: RolCliente.TITULAR
      }
    });
  } catch (error: any) {
    cruceRechazadoAcceso = true;
    codigoErrorAcceso = error.code || error.message;
  }

  registrarPrueba(
    'PostgreSQL rechaza AccesoCliente con clienteId de Org 1 y organizacionId de Org 2 (FK compuesta)',
    cruceRechazadoAcceso === true,
    `Operación rechazada con éxito por la BD. Código/Detalle: ${codigoErrorAcceso}`
  );

  // Intento de invitación cruzada: Cliente 1 (de Org 1) vinculado a Org 2 en InvitacionCliente
  let cruceRechazadoInvitacion = false;
  let codigoErrorInvitacion = '';

  try {
    await prisma.invitacionCliente.create({
      data: {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffff02',
        organizacionId: SEMILLA_IDS.ORG_2, // ORG_2
        clienteId: SEMILLA_IDS.CLIENTE_1, // Pertenece a ORG_1
        correo: 'intruso@ejemplo.com',
        tokenHash: 'hash_invalido_de_prueba_aislamiento_multitenant_00000000000000000000',
        expiraEn: new Date(Date.now() + 86400000),
        invitadoPorId: SEMILLA_IDS.USER_PROP_2
      }
    });
  } catch (error: any) {
    cruceRechazadoInvitacion = true;
    codigoErrorInvitacion = error.code || error.message;
  }

  registrarPrueba(
    'PostgreSQL rechaza InvitacionCliente con clienteId de Org 1 y organizacionId de Org 2 (FK compuesta)',
    cruceRechazadoInvitacion === true,
    `Operación rechazada con éxito por la BD. Código/Detalle: ${codigoErrorInvitacion}`
  );

  // Confirmar que no quedaron registros espurios
  const accesosInvalidos = await prisma.accesoCliente.findMany({
    where: { id: 'ffffffff-ffff-4fff-8fff-ffffffffff01' }
  });
  const invitacionesInvalidas = await prisma.invitacionCliente.findMany({
    where: { id: 'ffffffff-ffff-4fff-8fff-ffffffffff02' }
  });

  registrarPrueba(
    'La base de datos permanece limpia sin registros huérfanos ni inválidos',
    accesosInvalidos.length === 0 && invitacionesInvalidas.length === 0,
    'No se encontraron registros de las pruebas de violación de restricciones'
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
