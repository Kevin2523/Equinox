import {
  PrismaClient,
  RolMiembro,
  RolCliente,
  EstadoInvitacionCliente,
  EstadoCliente,
  EstadoProyecto
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

// Validación estricta contra ejecución accidental en producción
const entorno = (process.env.ENTORNO || process.env.NODE_ENV || 'desarrollo').toLowerCase();
if (entorno === 'produccion' || entorno === 'production') {
  console.error('⛔ ERROR: Ejecución cancelada. La semilla de demostración no puede ejecutarse en entorno de producción.');
  process.exit(1);
}

if (process.env.PERMITIR_SEMILLA_DEMO !== 'true') {
  console.error(
    '⛔ ERROR: Para ejecutar la semilla de desarrollo debe establecer explícitamente la variable de entorno PERMITIR_SEMILLA_DEMO=true.'
  );
  process.exit(1);
}

const prisma = new PrismaClient();

// Identificadores fijos y deterministas para garantizar 100% idempotencia
export const SEMILLA_IDS = {
  // Organización 1: Principal de prueba
  ORG_1: '00000000-0000-4000-8000-000000000001',
  USER_PROP_1: '00000000-0000-4000-8000-000000000011',
  MIEMBRO_PROP_1: '00000000-0000-4000-8000-000000000012',
  CLIENTE_1: '00000000-0000-4000-8000-000000000021',
  USER_CLIENTE_1: '00000000-0000-4000-8000-000000000031',
  ACCESO_CLIENTE_1: '00000000-0000-4000-8000-000000000041',
  PROYECTO_1: '00000000-0000-4000-8000-000000000051',
  INVITACION_1: '00000000-0000-4000-8000-000000000061',

  // Organización 2: Secundaria de prueba (para comprobar aislamiento multitenant)
  ORG_2: '00000000-0000-4000-8000-000000000002',
  USER_PROP_2: '00000000-0000-4000-8000-000000000013',
  MIEMBRO_PROP_2: '00000000-0000-4000-8000-000000000014',
  CLIENTE_2: '00000000-0000-4000-8000-000000000022'
};

export const DEMO_CONFIG = {
  CONTRASENA_DEMO: process.env.CONTRASENA_DEMO || 'contrasena_demo_local_123',
  TOKEN_INVITACION_DEMO: process.env.TOKEN_INVITACION_DEMO || 'token_invitacion_demo_dev_123'
};

export async function ejecutarSemilla() {
  console.log('🌱 Iniciando carga de semilla de desarrollo...');

  // Hash de contraseñas de demostración (nunca en texto plano)
  const contrasenaHash = await bcrypt.hash(DEMO_CONFIG.CONTRASENA_DEMO, 10);

  // Hash del token de invitación (nunca guardar el token plano en la base de datos)
  const tokenInvitacionHash = crypto
    .createHash('sha256')
    .update(DEMO_CONFIG.TOKEN_INVITACION_DEMO)
    .digest('hex');

  // ==========================================
  // 1. ORGANIZACIÓN 1 Y SU PROPIETARIO
  // ==========================================
  const usuarioPropietario1 = await prisma.usuario.upsert({
    where: { id: SEMILLA_IDS.USER_PROP_1 },
    update: {
      correo: 'andrea.demo@example.test',
      nombre: 'Andrea',
      apellido: 'Demo',
      telefono: '+507 555-0101',
      contrasenaHash
    },
    create: {
      id: SEMILLA_IDS.USER_PROP_1,
      correo: 'andrea.demo@example.test',
      nombre: 'Andrea',
      apellido: 'Demo',
      telefono: '+507 555-0101',
      contrasenaHash
    }
  });

  const org1 = await prisma.organizacion.upsert({
    where: { id: SEMILLA_IDS.ORG_1 },
    update: {
      nombre: 'Estudio Demo Istmo',
      slug: 'estudio-demo-istmo',
      descripcion: 'Organización ficticia de demostración para desarrollo y pruebas locales',
      moneda: 'PAB',
      correoContacto: 'contacto@estudio-demo.example.test'
    },
    create: {
      id: SEMILLA_IDS.ORG_1,
      nombre: 'Estudio Demo Istmo',
      slug: 'estudio-demo-istmo',
      descripcion: 'Organización ficticia de demostración para desarrollo y pruebas locales',
      moneda: 'PAB',
      correoContacto: 'contacto@estudio-demo.example.test'
    }
  });

  await prisma.miembroOrganizacion.upsert({
    where: {
      usuarioId_organizacionId: {
        usuarioId: usuarioPropietario1.id,
        organizacionId: org1.id
      }
    },
    update: {
      rol: RolMiembro.PROPIETARIO
    },
    create: {
      id: SEMILLA_IDS.MIEMBRO_PROP_1,
      usuarioId: usuarioPropietario1.id,
      organizacionId: org1.id,
      rol: RolMiembro.PROPIETARIO
    }
  });

  // ==========================================
  // 2. CLIENTE 1 (FICHA COMERCIAL EN ORG 1)
  // ==========================================
  const cliente1 = await prisma.cliente.upsert({
    where: { id: SEMILLA_IDS.CLIENTE_1 },
    update: {
      organizacionId: org1.id,
      nombre: 'Distribuidora Ficticia S.A.',
      empresa: 'Grupo Ficticio Demo',
      correo: 'contacto@distribuidoraficticia.example.test',
      telefono: '+507 555-0102',
      estado: EstadoCliente.ACTIVO
    },
    create: {
      id: SEMILLA_IDS.CLIENTE_1,
      organizacionId: org1.id,
      nombre: 'Distribuidora Ficticia S.A.',
      empresa: 'Grupo Ficticio Demo',
      correo: 'contacto@distribuidoraficticia.example.test',
      telefono: '+507 555-0102',
      estado: EstadoCliente.ACTIVO
    }
  });

  // ==========================================
  // 3. USUARIO CLIENTE Y ACCESO_CLIENTE
  // ==========================================
  const usuarioCliente1 = await prisma.usuario.upsert({
    where: { id: SEMILLA_IDS.USER_CLIENTE_1 },
    update: {
      correo: 'carlos.cliente@example.test',
      nombre: 'Carlos',
      apellido: 'Demo',
      telefono: '+507 555-0103',
      contrasenaHash
    },
    create: {
      id: SEMILLA_IDS.USER_CLIENTE_1,
      correo: 'carlos.cliente@example.test',
      nombre: 'Carlos',
      apellido: 'Demo',
      telefono: '+507 555-0103',
      contrasenaHash
    }
  });

  await prisma.accesoCliente.upsert({
    where: {
      usuarioId_clienteId: {
        usuarioId: usuarioCliente1.id,
        clienteId: cliente1.id
      }
    },
    update: {
      organizacionId: org1.id,
      rol: RolCliente.TITULAR,
      activo: true
    },
    create: {
      id: SEMILLA_IDS.ACCESO_CLIENTE_1,
      usuarioId: usuarioCliente1.id,
      clienteId: cliente1.id,
      organizacionId: org1.id,
      rol: RolCliente.TITULAR,
      activo: true
    }
  });

  // ==========================================
  // 4. PROYECTO ASOCIADO AL CLIENTE
  // ==========================================
  await prisma.proyecto.upsert({
    where: { id: SEMILLA_IDS.PROYECTO_1 },
    update: {
      organizacionId: org1.id,
      clienteId: cliente1.id,
      creadoPorId: usuarioPropietario1.id,
      nombre: 'Portal B2B de Pedidos Demo',
      descripcion: 'Proyecto ficticio de demostración para gestión de pedidos mayoristas',
      estado: EstadoProyecto.ACTIVO,
      presupuesto: 4500.0,
      moneda: 'PAB'
    },
    create: {
      id: SEMILLA_IDS.PROYECTO_1,
      organizacionId: org1.id,
      clienteId: cliente1.id,
      creadoPorId: usuarioPropietario1.id,
      nombre: 'Portal B2B de Pedidos Demo',
      descripcion: 'Proyecto ficticio de demostración para gestión de pedidos mayoristas',
      estado: EstadoProyecto.ACTIVO,
      presupuesto: 4500.0,
      moneda: 'PAB'
    }
  });

  // ==========================================
  // 5. INVITACIÓN DE CLIENTE
  // ==========================================
  const fechaExpira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días hacia el futuro
  await prisma.invitacionCliente.upsert({
    where: { id: SEMILLA_IDS.INVITACION_1 },
    update: {
      organizacionId: org1.id,
      clienteId: cliente1.id,
      correo: 'colaborador.invitado@example.test',
      tokenHash: tokenInvitacionHash,
      rol: RolCliente.COLABORADOR,
      estado: EstadoInvitacionCliente.PENDIENTE,
      expiraEn: fechaExpira,
      invitadoPorId: usuarioPropietario1.id
    },
    create: {
      id: SEMILLA_IDS.INVITACION_1,
      organizacionId: org1.id,
      clienteId: cliente1.id,
      correo: 'colaborador.invitado@example.test',
      tokenHash: tokenInvitacionHash,
      rol: RolCliente.COLABORADOR,
      estado: EstadoInvitacionCliente.PENDIENTE,
      expiraEn: fechaExpira,
      invitadoPorId: usuarioPropietario1.id
    }
  });

  // ==========================================
  // 6. ORGANIZACIÓN 2 Y CLIENTE 2 (AISLAMIENTO MULTITENANT)
  // ==========================================
  const usuarioPropietario2 = await prisma.usuario.upsert({
    where: { id: SEMILLA_IDS.USER_PROP_2 },
    update: {
      correo: 'elena.demo@example.test',
      nombre: 'Elena',
      apellido: 'Demo',
      telefono: '+507 555-0104',
      contrasenaHash
    },
    create: {
      id: SEMILLA_IDS.USER_PROP_2,
      correo: 'elena.demo@example.test',
      nombre: 'Elena',
      apellido: 'Demo',
      telefono: '+507 555-0104',
      contrasenaHash
    }
  });

  const org2 = await prisma.organizacion.upsert({
    where: { id: SEMILLA_IDS.ORG_2 },
    update: {
      nombre: 'Soluciones Cloud Demo',
      slug: 'soluciones-cloud-demo',
      descripcion: 'Segunda organización ficticia para verificación de aislamiento multitenant',
      moneda: 'USD',
      correoContacto: 'contacto@soluciones-cloud.example.test'
    },
    create: {
      id: SEMILLA_IDS.ORG_2,
      nombre: 'Soluciones Cloud Demo',
      slug: 'soluciones-cloud-demo',
      descripcion: 'Segunda organización ficticia para verificación de aislamiento multitenant',
      moneda: 'USD',
      correoContacto: 'contacto@soluciones-cloud.example.test'
    }
  });

  await prisma.miembroOrganizacion.upsert({
    where: {
      usuarioId_organizacionId: {
        usuarioId: usuarioPropietario2.id,
        organizacionId: org2.id
      }
    },
    update: {
      rol: RolMiembro.PROPIETARIO
    },
    create: {
      id: SEMILLA_IDS.MIEMBRO_PROP_2,
      usuarioId: usuarioPropietario2.id,
      organizacionId: org2.id,
      rol: RolMiembro.PROPIETARIO
    }
  });

  await prisma.cliente.upsert({
    where: { id: SEMILLA_IDS.CLIENTE_2 },
    update: {
      organizacionId: org2.id,
      nombre: 'Logística Istmo Demo Corp',
      empresa: 'Istmo Demo Corp',
      correo: 'contacto@logisticaistmo.example.test',
      telefono: '+507 555-0105',
      estado: EstadoCliente.ACTIVO
    },
    create: {
      id: SEMILLA_IDS.CLIENTE_2,
      organizacionId: org2.id,
      nombre: 'Logística Istmo Demo Corp',
      empresa: 'Istmo Demo Corp',
      correo: 'contacto@logisticaistmo.example.test',
      telefono: '+507 555-0105',
      estado: EstadoCliente.ACTIVO
    }
  });

  console.log('✅ Semilla cargada satisfactoriamente con estructura idempotente.');
}

if (require.main === module) {
  ejecutarSemilla()
    .catch((error) => {
      console.error('❌ Error al ejecutar semilla:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
