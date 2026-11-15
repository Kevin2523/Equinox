import type { Request, Response } from "express";
import { hooksPruebas, estanHooksHabilitados } from "../utilidades/hooks-pruebas.js";

interface EntradaRateLimit {
  cuenta: number;
  expiraEn: number;
}

// Almacén acotado por proceso. No coordina contadores entre instancias.
export class LimitadorMemoria {
  private almacenes = new Map<string, EntradaRateLimit>();
  private intervaloLimpieza: NodeJS.Timeout | null = null;
  private capacidadPrueba: number | null = null;

  constructor(
    private readonly ventanaMs: number,
    private readonly limiteMax: number,
    private readonly mensajeError: string = "Demasiadas solicitudes. Por favor intente más tarde.",
    private readonly maxClaves: number = 5000,
    private readonly identificador?: string
  ) {
    // Evitar crecimiento ilimitado de memoria limpiando entradas expiradas periódicamente
    this.intervaloLimpieza = setInterval(() => {
      this.limpiarExpiradas();
    }, 60000);
    this.intervaloLimpieza.unref();
  }

  limpiarExpiradas(): void {
    const ahora = hooksPruebas.obtenerAhora().getTime();
    for (const [clave, entrada] of this.almacenes.entries()) {
      if (entrada.expiraEn <= ahora) {
        this.almacenes.delete(clave);
      }
    }
  }

  detener(): void {
    if (this.intervaloLimpieza) {
      clearInterval(this.intervaloLimpieza);
      this.intervaloLimpieza = null;
    }
  }

  tamano(): number {
    return this.almacenes.size;
  }

  reiniciar(): void {
    if (estanHooksHabilitados()) this.almacenes.clear();
  }

  configurarCapacidadPrueba(capacidad: number | null): void {
    if (!estanHooksHabilitados()) return;
    if (capacidad !== null && (!Number.isInteger(capacidad) || capacidad < 1 || capacidad > this.maxClaves)) {
      throw new Error("Capacidad de prueba inválida");
    }
    this.capacidadPrueba = capacidad;
  }

  private rechazar(res: Response, expiraEn: number, ahora: number) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((expiraEn - ahora) / 1000))));
    if (this.identificador && estanHooksHabilitados()) {
      res.setHeader("X-RateLimit-Id", this.identificador);
    }
    return res.status(429).json({ error: this.mensajeError });
  }

  limitar(generarClave: (req: Request) => string) {
    return (req: Request, res: Response, next: () => void) => {
      const clave = generarClave(req);
      const ahora = hooksPruebas.obtenerAhora().getTime();
      const capacidad = estanHooksHabilitados() ? this.capacidadPrueba ?? this.maxClaves : this.maxClaves;

      let entrada = this.almacenes.get(clave);

      if (!entrada || entrada.expiraEn <= ahora) {
        // Política de memoria acotada antes de insertar:
        if (this.almacenes.size >= capacidad) {
          this.limpiarExpiradas();
        }

        // Nunca expulsar contadores activos ni dejar pasar una clave sin contarla.
        if (this.almacenes.size >= capacidad) {
          let primeraExpiracion = ahora + this.ventanaMs;
          for (const vigente of this.almacenes.values()) {
            primeraExpiracion = Math.min(primeraExpiracion, vigente.expiraEn);
          }
          return this.rechazar(res, primeraExpiracion, ahora);
        }

        entrada = {
          cuenta: 1,
          expiraEn: ahora + this.ventanaMs,
        };
        this.almacenes.set(clave, entrada);
        return next();
      }

      if (entrada.cuenta >= this.limiteMax) {
        return this.rechazar(res, entrada.expiraEn, ahora);
      }
      entrada.cuenta++;
      next();
    };
  }
}
