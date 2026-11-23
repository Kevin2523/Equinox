import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { prisma } from "../src/prisma.js";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const urlFrontend = "http://localhost:4200";
const urlApi = "http://localhost:3000";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CDPClient {
  ws: WebSocket;
  msgId = 0;
  callbacks = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
  }

  async connect(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data.toString());
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id)!;
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(new Error(msg.error.message));
          else cb.resolve(msg.result);
        }
      };
    });
  }

  send(method: string, params: any = {}): Promise<any> {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

async function captureScreenshot(cdp: CDPClient, outPath: string) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(outPath, Buffer.from(result.data, "base64"));
  console.log(`[Screenshot guardado] -> ${outPath}`);
}

async function runVisualQA() {
  console.log("=== INICIANDO VISUAL QA AUTOMATIZADO (CHROME CDP) ===");

  const idUnico = Date.now().toString(36);
  const correoFreelancer = `qa.foto.${idUnico}@prueba.test`;
  const contrasena = "PasswordSeguro123!";
  const evidenciaDir = path.resolve(process.cwd(), "docs/evidencias");
  if (!fs.existsSync(evidenciaDir)) fs.mkdirSync(evidenciaDir, { recursive: true });

  let orgId = "";
  let usuarioId = "";
  let chromeProc: any = null;

  try {
    // 1. REGISTRAR ORGANIZACIÓN FOTOGRAFÍA
    console.log("1. Creando usuario y estudio de fotografía para QA...");
    const resReg = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: correoFreelancer,
        contrasena,
        nombre: "Sofía",
        apellido: "Mora",
        nombreEstudio: `Sofía Mora Fotografía ${idUnico}`,
        slug: `sofia-mora-${idUnico}`,
        tipoFreelance: "FOTOGRAFIA",
      }),
    });
    const regData = (await resReg.json()) as any;
    orgId = regData.organizacion.id;
    usuarioId = regData.usuario.id;
    const token = regData.token;
    console.log(`   [OK] Cuenta de prueba lista: ${correoFreelancer}`);

    // Crear un cliente existente para que la lista no esté vacía
    const resCli = await fetch(`${urlApi}/api/clientes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        nombre: "Lucas Castillo",
      }),
    });
    const cliData = (await resCli.json()) as any;
    console.log(`   [OK] Cliente inicial creado sin correo: ${cliData.nombre} (${cliData.id})`);

    // 2. INICIAR CHROME EN MODO HEADLESS CON DEBUGGING PORT
    const userDataDir = path.resolve(process.cwd(), ".tmp_chrome_qa");
    chromeProc = spawn(chromePath, [
      "--headless=new",
      "--remote-debugging-port=9222",
      `--user-data-dir=${userDataDir}`,
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ]);

    console.log("2. Esperando a que Chrome inicie...");
    let wsUrl = "";
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const resList = await fetch("http://localhost:9222/json/list");
        if (resList.ok) {
          const targets = (await resList.json()) as any[];
          if (targets.length > 0 && targets[0].webSocketDebuggerUrl) {
            wsUrl = targets[0].webSocketDebuggerUrl;
            break;
          }
        }
      } catch {}
    }

    if (!wsUrl) throw new Error("No se pudo conectar al puerto de debugging de Chrome");
    console.log("   [OK] Conectado a Chrome CDP");

    const cdp = new CDPClient(wsUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Runtime.enable");

    // =========================================================================
    // VISUAL QA: DESKTOP VIEWPORT (1280x800)
    // =========================================================================
    console.log("3. Configurando Viewport Desktop (1280x800)...");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // Navegar y autenticar inyectando la sesión en sessionStorage
    await cdp.send("Page.navigate", { url: `${urlFrontend}/login` });
    await sleep(1500);

    // Inyectar token en sessionStorage y navegar a /clientes
    await cdp.send("Runtime.evaluate", {
      expression: `
        sessionStorage.setItem('equinox_sesion_token', ${JSON.stringify(token)});
        window.location.href = '/clientes';
      `,
    });
    await sleep(2500);

    // Capturar vista general de clientes en fotografía
    await captureScreenshot(cdp, path.join(evidenciaDir, "01_desktop_clientes_fotografia.png"));

    // ABRIR MODAL: NUEVO CLIENTE EN FOTOGRAFÍA
    console.log("4. Abriendo modal 'Nuevo cliente' en fotografía...");
    await cdp.send("Runtime.evaluate", {
      expression: `
        document.querySelector('.btn-new-client').click();
      `,
    });
    await sleep(800);

    // Capturar screenshot del formulario rápido (con Nombre obligatorio, Email/Teléfono opcionales, campos ocultos, y CTAs)
    await captureScreenshot(cdp, path.join(evidenciaDir, "02_desktop_modal_nuevo_cliente_rapido.png"));

    // Llenar formulario rápido y hacer clic en "Crear cliente y sesión"
    console.log("5. Creando cliente y verificando apertura inmediata de Crear sesión...");
    await cdp.send("Runtime.evaluate", {
      expression: `
        const inputNombre = document.getElementById('cliente-nombre');
        inputNombre.value = 'Camila Valdés';
        inputNombre.dispatchEvent(new Event('input', { bubbles: true }));
        const btnCrearSesion = document.querySelector('.btn-modal-primary-session');
        btnCrearSesion.click();
      `,
    });
    await sleep(1800);

    // Capturar screenshot mostrando la creación de sesión abierta de inmediato para el nuevo cliente
    await captureScreenshot(cdp, path.join(evidenciaDir, "03_desktop_apertura_crear_sesion_inmediata.png"));

    // Cerrar modal de sesión
    await cdp.send("Runtime.evaluate", {
      expression: `
        const btnCerrar = document.querySelector('.modal-card .modal-close');
        if (btnCerrar) btnCerrar.click();
      `,
    });
    await sleep(600);

    // ABRIR MODAL DE INVITACIÓN AL PORTAL EN CLIENTE SIN CORREO
    console.log("6. Abriendo modal de invitación para cliente sin correo...");
    await cdp.send("Runtime.evaluate", {
      expression: `
        const btnInvitar = document.querySelector('.btn-inspector-invite');
        if (btnInvitar) btnInvitar.click();
      `,
    });
    await sleep(800);

    // Capturar screenshot del aviso de cliente sin correo y persistencia automática
    await captureScreenshot(cdp, path.join(evidenciaDir, "04_desktop_modal_invitacion_sin_correo.png"));

    // Cerrar modal de invitación
    await cdp.send("Runtime.evaluate", {
      expression: `
        const btnCerrarInv = document.querySelector('.modal-card .modal-close');
        if (btnCerrarInv) btnCerrarInv.click();
      `,
    });
    await sleep(500);

    // ABRIR EDITAR CLIENTE (para comprobar que Empresa, Dirección, Estado y Notas SÍ aparecen en edición)
    console.log("7. Abriendo modal de 'Editar cliente' para comprobar campos completos...");
    await cdp.send("Runtime.evaluate", {
      expression: `
        const btnEditar = document.querySelector('.btn-inspector-edit');
        if (btnEditar) btnEditar.click();
      `,
    });
    await sleep(800);

    await captureScreenshot(cdp, path.join(evidenciaDir, "05_desktop_modal_editar_cliente_completo.png"));

    // Cerrar modal de edición
    await cdp.send("Runtime.evaluate", {
      expression: `
        const btnCerrarEdit = document.querySelector('.modal-card .modal-close');
        if (btnCerrarEdit) btnCerrarEdit.click();
      `,
    });
    await sleep(500);

    // =========================================================================
    // VISUAL QA: MOBILE VIEWPORT (375x812 - iPhone)
    // =========================================================================
    console.log("8. Configurando Viewport Móvil (375x812)...");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(1000);

    // Capturar vista móvil de clientes
    await captureScreenshot(cdp, path.join(evidenciaDir, "06_mobile_clientes_fotografia.png"));

    // Abrir modal nuevo cliente en móvil
    await cdp.send("Runtime.evaluate", {
      expression: `
        document.querySelector('.btn-new-client').click();
      `,
    });
    await sleep(800);

    // Capturar modal nuevo cliente en móvil
    await captureScreenshot(cdp, path.join(evidenciaDir, "07_mobile_modal_nuevo_cliente.png"));

    cdp.close();
    console.log("=== VISUAL QA FINALIZADO CON ÉXITO ===");
  } finally {
    if (chromeProc) {
      chromeProc.kill();
    }
    const userDataDir = path.resolve(process.cwd(), ".tmp_chrome_qa");
    try {
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}

    // Limpiar base de datos
    console.log("-> Limpiando datos de QA...");
    try {
      if (orgId) {
        await prisma.fotoSesion.deleteMany({ where: { sesion: { organizacionId: orgId } } });
        await prisma.sesionFotografica.deleteMany({ where: { organizacionId: orgId } });
        await prisma.invitacionCliente.deleteMany({ where: { organizacionId: orgId } });
        await prisma.accesoCliente.deleteMany({ where: { organizacionId: orgId } });
        await prisma.actividad.deleteMany({ where: { organizacionId: orgId } });
        await prisma.cliente.deleteMany({ where: { organizacionId: orgId } });
        await prisma.miembroOrganizacion.deleteMany({ where: { organizacionId: orgId } });
        await prisma.sesion.deleteMany({ where: { usuarioId } });
        await prisma.usuario.deleteMany({ where: { id: usuarioId } });
        await prisma.organizacion.deleteMany({ where: { id: orgId } });
      }
      console.log("   [OK] Base de datos limpia");
    } catch (e: any) {
      console.warn("   [WARN] Error limpiando:", e.message);
    }
  }
}

runVisualQA().catch((e) => {
  console.error("Error en Visual QA:", e);
  process.exit(1);
});
