import "dotenv/config";
import { aplicacion } from "./aplicacion.js";
import { prisma } from "./prisma.js";

const puerto = Number(process.env.PUERTO || 3000);
const servidor = aplicacion.listen(puerto, () => console.log(`API de Equinox disponible en http://localhost:${puerto}`));
async function cerrar() { await prisma.$disconnect(); servidor.close(() => process.exit(0)); }
process.on("SIGINT", cerrar); process.on("SIGTERM", cerrar);
