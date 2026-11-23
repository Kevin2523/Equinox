import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-admin-prohibido',
  standalone: true,
  imports: [CommonModule],
  template: `
    <main class="prohibido-shell" role="main" aria-labelledby="titulo-403">
      <section class="prohibido-card">
        <span class="prohibido-code">ERROR 403</span>
        <h1 id="titulo-403">Acceso restringido al panel Superadmin</h1>
        <p>
          Tu sesión actual no tiene privilegios de <strong>ADMIN_GLOBAL</strong> ni verificación MFA administrativa.
          Esta zona está aislada de los espacios de trabajo de organizaciones y clientes.
        </p>
        <div class="prohibido-actions">
          <button type="button" class="btn-primary" (click)="volverEspacio()">
            Volver a mi espacio
          </button>
          <button type="button" class="btn-secondary" (click)="cambiarCuenta()" [disabled]="cambiando">
            {{ cambiando ? 'Cerrando sesión...' : 'Iniciar sesión como administrador' }}
          </button>
        </div>
      </section>
    </main>
  `,
  styles: [`
    .prohibido-shell {
      min-height: 100vh;
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .prohibido-card {
      max-width: 520px;
      width: 100%;
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 36px 32px;
      box-shadow: var(--shadow-md);
    }
    .prohibido-code {
      display: inline-block;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      color: #c2392b;
      background: var(--coral-soft);
      padding: 4px 10px;
      border-radius: 999px;
      margin-bottom: 14px;
    }
    h1 {
      font-size: 24px;
      margin: 0 0 10px;
      color: var(--navy);
    }
    p {
      font-size: 14px;
      line-height: 1.6;
      color: var(--muted);
      margin: 0 0 24px;
    }
    .prohibido-actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    @media (max-width: 768px) {
      .prohibido-actions button {
        min-height: 44px;
      }
    }
    @media (max-width: 480px) {
      .prohibido-shell {
        padding: 16px 12px;
      }
      .prohibido-card {
        padding: 24px 18px;
      }
      .prohibido-actions button {
        width: 100%;
      }
    }
  `]
})
export class AdminProhibidoComponent {
  cambiando = false;

  constructor(private auth: AuthService, private router: Router) {}

  volverEspacio(): void {
    void this.router.navigateByUrl(this.auth.rutaInicial());
  }

  async cambiarCuenta(): Promise<void> {
    if (this.cambiando) return;
    this.cambiando = true;
    try {
      await this.auth.cerrar('/admin/acceso');
    } catch {
      await this.auth.cerrarSoloLocal('/admin/acceso');
    } finally {
      this.cambiando = false;
    }
  }
}
