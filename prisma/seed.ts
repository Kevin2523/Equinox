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
  // Organización 1: Principal
  ORG_1: '00000000-0000-4000-8000-000000000001',
  USER_PROP_1: '00000000-0000-4000-8000-000000000011',
  MIEMBRO_PROP_1: '00000000-0000-4000-8000-000000000012',
  CLIENTE_1: '00000000-0000-4000-8000-000000000021',
  USER_CLIENTE_1: '00000000-0000-4000-8000-000000000031',
  ACCESO_CLIENTE_1: '00000000-0000-4000-8000-000000000041',
  PROYECTO_1: '00000000-0000-4000-8000-000000000051',
  INVITACION_1: '00000000-0000-4000-8000-000000000061',

  // Organización 2: Secundaria (para comprobar aislamiento multitenant)
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
      correo: 'propietario@menastudios.com',
      nombre: 'Kevin',
      apellido: 'Mena',
      telefono: '+507 6000-0001',
      contrasenaHash
    },
    create: {
      id: SEMILLA_IDS.USER_PROP_1,
      correo: 'propietario@menastudios.com',
      nombre: 'Kevin',
      apellido: 'Mena',
      telefono: '+507 6000-0001',
      contrasenaHash
    }
  });

  const org1 = await prisma.organizacion.upsert({
    where: { id: SEMILLA_IDS.ORG_1 },
    update: {
      nombre: 'Mena Studios',
      slug: 'mena-studios',
      descripcion: 'Agencia de desarrollo web y diseño de productos digitales en Panamá',
      moneda: 'PAB',
      correoContacto: 'contacto@menastudios.com'
    },
    create: {
      id: SEMILLA_IDS.ORG_1,
      nombre: 'Mena Studios',
      slug: 'mena-studios',
      descripcion: 'Agencia de desarrollo web y diseño de productos digitales en Panamá',
      moneda: 'PAB',
      correoContacto: 'contacto@menastudios.com'
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
      nombre: 'Distribuidora del Pacífico S.A.',
      empresa: 'Grupo Pacífico',
      correo: 'contacto@pacifico.com.pa',
      telefono: '+507 200-0001',
      estado: EstadoCliente.ACTIVO
    },
    create: {
      id: SEMILLA_IDS.CLIENTE_1,
      organizacionId: org1.id,
      nombre: 'Distribuidora del Pacífico S.A.',
      empresa: 'Grupo Pacífico',
      correo: 'contacto@pacifico.com.pa',
      telefono: '+507 200-0001',
      estado: EstadoCliente.ACTIVO
    }
  });

  // ==========================================
  // 3. USUARIO CLIENTE Y ACCESO_CLIENTE
  // ==========================================
  const usuarioCliente1 = await prisma.usuario.upsert({
    where: { id: SEMILLA_IDS.USER_CLIENTE_1 },
    update: {
      correo: 'cliente.titular@pacifico.com.pa',
      nombre: 'Carlos',
      apellido: 'Rodríguez',
      telefono: '+507 6000-0002',
      contrasenaHash
    },
    create: {
      id: SEMILLA_IDS.USER_CLIENTE_1,
      correo: 'cliente.titular@pacifico.com.pa',
      nombre: 'Carlos',
      apellido: 'Rodríguez',
      telefono: '+507 6000-0002',
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
      nombre: 'Portal B2B de Pedidos',
      descripcion: 'Implementación del portal web de pedidos y catálogo comercial para mayoristas',
      estado: EstadoProyecto.ACTIVO,
      presupuesto: 4500.0,
      moneda: 'PAB'
    },
    create: {
      id: SEMILLA_IDS.PROYECTO_1,
      organizacionId: org1.id,
      clienteId: cliente1.id,
      creadoPorId: usuarioPropietario1.id,
      nombre: 'Portal B2B de Pedidos',
      descripcion: 'Implementación del portal web de pedidos y catálogo comercial para mayoristas',
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
      correo: 'colaborador@pacifico.com.pa',
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
      correo: 'colaborador@pacifico.com.pa',
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
      correo: 'propietario@balboa.com',
      nombre: 'Elena',
      apellido: 'Castillo',
      telefono: '+507 6000-0003',
      contrasenaHash
    },
    create: {
      id: SEMILLA_IDS.USER_PROP_2,
      correo: 'propietario@balboa.com',
      nombre: 'Elena',
      apellido: 'Castillo',
      telefono: '+507 6000-0003',
      contrasenaHash
    }
  });

  const org2 = await prisma.organizacion.upsert({
    where: { id: SEMILLA_IDS.ORG_2 },
    update: {
      nombre: 'Soluciones Digitales Balboa',
      slug: 'soluciones-balboa',
      descripcion: 'Consultoría tecnológica e infraestructura cloud',
      moneda: 'USD',
      correoContacto: 'contacto@balboa.com'
    },
    create: {
      id: SEMILLA_IDS.ORG_2,
      nombre: 'Soluciones Digitales Balboa',
      slug: 'soluciones-balboa',
      descripcion: 'Consultoría tecnológica e infraestructura cloud',
      moneda: 'USD',
      correoContacto: 'contacto@balboa.com'
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
      nombre: 'Logística Istmo Corp',
      empresa: 'Istmo Corp',
      correo: 'contacto@istmo.com.pa',
      telefono: '+507 200-0002',
      estado: EstadoCliente.ACTIVO
    },
    create: {
      id: SEMILLA_IDS.CLIENTE_2,
      organizacionId: org2.id,
      nombre: 'Logística Istmo Corp',
      empresa: 'Istmo Corp',
      correo: 'contacto@istmo.com.pa',
      telefono: '+507 200-0002',
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
