// Proceso aislado de la suite: configuración real de producción, sin hooks.
import { createServer } from "node:http";

async function iniciar() {
  const destino = new URL(process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(destino.hostname) || destino.pathname !== "/equinox_issue4_test") {
    throw new Error("Destino de prueba no autorizado");
  }
  if (process.env.NODE_ENV !== "production" || !process.send) throw new Error("Arnés inválido");
  const { aplicacion } = await import("../src/aplicacion.js");
  const { prisma } = await import("../src/prisma.js");
  const servidor = createServer(aplicacion);
  servidor.listen(0, "127.0.0.1", () => {
    const direccion = servidor.address();
    if (direccion && typeof direccion !== "string") process.send!({ puerto: direccion.port });
  });
  process.on("message", (mensaje) => {
    if (mensaje === "cerrar") servidor.close(() => {
      void prisma.$disconnect().then(() => process.disconnect());
    });
  });
}

iniciar().catch(() => {
  console.error("No fue posible iniciar el arnés de producción");
  process.exit(1);
});
