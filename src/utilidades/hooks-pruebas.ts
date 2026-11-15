type HookTransicion = () => Promise<void> | void;
type InyectorFallo = () => Error | null | Promise<Error | null>;

export function estanHooksHabilitados(): boolean {
  // Condición positiva y centralizada: exclusivamente NODE_ENV === "test"
  return process.env.NODE_ENV === "test";
}

class GestorHooksPruebas {
  private hooks = new Map<string, HookTransicion>();
  private inyectores = new Map<string, InyectorFallo>();
  private relojControlado: Date | null = null;
  private colaTokens: string[] = [];

  registrar(punto: string, hook: HookTransicion) {
    if (!estanHooksHabilitados()) {
      return;
    }
    this.hooks.set(punto, hook);
  }

  registrarInyectorFallo(punto: string, inyector: InyectorFallo) {
    if (!estanHooksHabilitados()) {
      return;
    }
    this.inyectores.set(punto, inyector);
  }

  fijarReloj(fecha: Date | null) {
    if (!estanHooksHabilitados()) {
      return;
    }
    this.relojControlado = fecha;
  }

  obtenerAhora(): Date {
    if (estanHooksHabilitados() && this.relojControlado) {
      return new Date(this.relojControlado.getTime());
    }
    return new Date();
  }

  encolarTokens(tokens: string[]) {
    if (!estanHooksHabilitados()) {
      return;
    }
    this.colaTokens.push(...tokens);
  }

  obtenerSiguienteToken(): string | null {
    if (estanHooksHabilitados() && this.colaTokens.length > 0) {
      return this.colaTokens.shift() || null;
    }
    return null;
  }

  async ejecutar(punto: string) {
    if (!estanHooksHabilitados()) {
      return;
    }
    const inyector = this.inyectores.get(punto);
    if (inyector) {
      const err = await inyector();
      if (err) {
        throw err;
      }
    }
    const hook = this.hooks.get(punto);
    if (hook) {
      await hook();
    }
  }

  limpiar() {
    this.hooks.clear();
    this.inyectores.clear();
    this.relojControlado = null;
    this.colaTokens = [];
  }
}

export const hooksPruebas = new GestorHooksPruebas();

/**
 * Barrera determinista para pruebas de concurrencia con timeout seguro:
 * Espera a que N operaciones hayan alcanzado exactamente el punto crítico
 * antes de liberarlas todas simultáneamente.
 * Si transcurre timeoutMs sin alcanzar la capacidad, rechaza a todos los
 * participantes pendientes, limpia recursos y no deja temporizadores activos.
 */
export function crearBarreraConcurrencia(
  capacidad: number,
  timeoutMs: number = 3000
): {
  esperar(): Promise<void>;
  reiniciar(motivo?: string): void;
} {
  let contador = 0;
  let liberadores: Array<{ resolver: () => void; rechazar: (err: Error) => void }> = [];
  let timer: NodeJS.Timeout | null = null;

  const limpiarTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const dispararTimeout = () => {
    const pendientes = liberadores;
    contador = 0;
    liberadores = [];
    limpiarTimer();
    const error = new Error(
      `[BARRERA_TIMEOUT] Se superó el tiempo de espera de ${timeoutMs}ms en la barrera de concurrencia (${pendientes.length}/${capacidad} participantes llegaron).`
    );
    for (const { rechazar } of pendientes) {
      rechazar(error);
    }
  };

  return {
    async esperar(): Promise<void> {
      contador++;
      if (contador >= capacidad) {
        limpiarTimer();
        const pendientes = liberadores;
        liberadores = [];
        contador = 0;
        for (const { resolver } of pendientes) {
          resolver();
        }
        return;
      }

      if (!timer && timeoutMs > 0) {
        timer = setTimeout(dispararTimeout, timeoutMs);
        if (typeof timer.unref === "function") {
          timer.unref();
        }
      }

      return new Promise<void>((resolve, reject) => {
        liberadores.push({ resolver: resolve, rechazar: reject });
      });
    },
    reiniciar(motivo?: string) {
      limpiarTimer();
      const pendientes = liberadores;
      contador = 0;
      liberadores = [];
      const error = new Error(
        motivo || "[BARRERA_REINICIO] La barrera fue reiniciada antes de completarse."
      );
      for (const { rechazar } of pendientes) {
        rechazar(error);
      }
    },
  };
}
