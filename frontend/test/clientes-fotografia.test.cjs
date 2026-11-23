const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Plantilla clientes.component.html: formulario rápido de fotografía y preservación en edición/detalle', () => {
  const htmlPath = path.resolve(__dirname, '../src/pages/clientes.component.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // 1. Debe haber campos obligatorios y opcionales para fotografía
  assert.ok(html.includes("esFotografia && !editandoId ? 'Nombre del cliente *' : 'Nombre del contacto *'"),
    'El nombre del cliente debe cambiar su etiqueta a Nombre del cliente * en alta de fotografía');
  assert.ok(html.includes('(opcional)</span>'),
    'Correo y teléfono deben tener indicador (opcional) en alta de fotografía');

  // 2. Debe ocultar Empresa, Dirección, Sitio web, Estado y Notas en alta de fotografía, pero conservarlos al editar o en otras modalidades
  assert.ok(html.includes('*ngIf="!esFotografia || editandoId"'),
    'Los campos Empresa, Dirección, Sitio web, Estado y Notas internas deben condicionarse con !esFotografia || editandoId');

  // 3. CTA directo para Crear cliente y sesión y opción para solo guardar
  assert.ok(html.includes('Crear cliente y sesión'),
    'Debe existir CTA Crear cliente y sesión al guardar en fotografía');
  assert.ok(html.includes('Solo guardar cliente'),
    'Debe existir opción Solo guardar cliente');

  // 4. Botón Editar en cabecera de cliente en fotografía
  assert.ok(html.includes('(click)="editar(sel)"'),
    'Debe existir botón Editar en la cabecera del cliente seleccionado en fotografía');

  // 5. Advertencia clara si invita al portal sin correo
  assert.ok(html.includes('invitation-notice-missing-email'),
    'Debe existir aviso específico cuando el cliente no tiene correo registrado al invitar al portal');
  assert.ok(html.includes('Se guardará en la ficha'),
    'Debe indicar claramente que el correo se guardará en la ficha al invitar al portal');
});

test('Lógica ClientesComponent: guardar rápido, abrir sesión y persistir correo al invitar', async () => {
  const tsPath = path.resolve(__dirname, '../src/pages/clientes.component.ts');
  const tsContent = fs.readFileSync(tsPath, 'utf8');

  // 1. ViewChild de SesionesFotograficasComponent
  assert.ok(tsContent.includes('@ViewChild(SesionesFotograficasComponent) sesionesComponent?: SesionesFotograficasComponent;'),
    'Debe tener @ViewChild para invocar abrirCrearSesion() del componente de sesiones');

  // 2. Método guardar soporta abrir sesión
  assert.ok(tsContent.includes('guardar(form: NgForm, crearSesion = false)'),
    'Método guardar debe aceptar parámetro opcional crearSesion');

  // 3. Estado automático 'ACTIVO' en alta de fotografía
  assert.ok(tsContent.includes("estado: esAltaFotografia ? 'ACTIVO' : this.formulario.estado"),
    'En alta de fotografía el estado debe ser ACTIVO automáticamente');

  // 4. Si crearSesion es true, invoca abrirCrearSesion()
  assert.ok(tsContent.includes('this.sesionesComponent.abrirCrearSesion();'),
    'Debe invocar abrirCrearSesion en el componente hijo');

  // 5. Persistencia de correo al invitar si el cliente no tenía correo
  assert.ok(tsContent.includes('await this.api.editarCliente(cliente.id, { correo: correoNormalizado });'),
    'Debe persistir el correo en el cliente vía api.editarCliente antes de crear la invitación');
});
