import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard.component';
import { ClientesComponent } from './pages/clientes.component';
import { ProyectosComponent } from './pages/proyectos.component';
import { TareasComponent } from './pages/tareas.component';
import { FinanzasComponent } from './pages/finanzas.component';
import { ConfiguracionComponent } from './pages/configuracion.component';
import { PortalComponent } from './pages/portal.component';
import { NotFoundComponent } from './pages/not-found.component';
import { FreelancerShellComponent } from './shells/freelancer-shell.component';
import { ClientShellComponent } from './shells/client-shell.component';
import { ClientHomeComponent } from './pages/client-home.component';
import { InvitacionComponent } from './pages/invitacion.component';
import { LoginComponent } from './pages/login.component';
import { RegistroComponent } from './pages/registro.component';
import { RecuperacionComponent } from './pages/recuperacion.component';
import { LogoutComponent } from './pages/logout.component';
import { guardAdminGlobal, guardCliente, guardNoFotografia, guardOrganizacion, guardPublico, guardPublicoAdmin } from './auth/auth.guards';
import { AdminShellComponent } from './pages/admin/admin-shell.component';
import { AdminAccesoComponent } from './pages/admin/admin-acceso.component';
import { AdminProhibidoComponent } from './pages/admin/admin-prohibido.component';
import { AdminResumenComponent } from './pages/admin/admin-resumen.component';
import { AdminOrganizacionesComponent } from './pages/admin/admin-organizaciones.component';
import { AdminUsuariosComponent } from './pages/admin/admin-usuarios.component';
import { AdminSuscripcionesComponent } from './pages/admin/admin-suscripciones.component';
import { AdminAuditoriaComponent } from './pages/admin/admin-auditoria.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'inicio-sesion' },
  { path: 'hoy', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'inicio-sesion', component: LoginComponent, canActivate: [guardPublico] },
  { path: 'registro', component: RegistroComponent, canActivate: [guardPublico] },
  { path: 'recuperar-contrasena', component: RecuperacionComponent },
  { path: 'recuperar-contrasena/:token', component: RecuperacionComponent },
  { path: 'cerrar-sesion', component: LogoutComponent },
  { path: 'invitacion/:token', component: InvitacionComponent },
  { path: '', component: FreelancerShellComponent, canActivate: [guardOrganizacion], children: [
    { path: 'dashboard', component: DashboardComponent, canActivate: [guardNoFotografia] },
    { path: 'clientes', component: ClientesComponent },
    { path: 'proyectos', component: ProyectosComponent, canActivate: [guardNoFotografia] },
    { path: 'tareas', component: TareasComponent, canActivate: [guardNoFotografia] },
    { path: 'finanzas', component: FinanzasComponent },
    { path: 'configuracion', component: ConfiguracionComponent },
    { path: 'vista-previa-portal', component: PortalComponent }
  ] },
  { path: '', component: ClientShellComponent, canActivate: [guardCliente], children: [
    { path: 'portal', component: ClientHomeComponent }
  ] },
  { path: 'admin/acceso', component: AdminAccesoComponent, canActivate: [guardPublicoAdmin] },
  { path: 'admin/sin-acceso', component: AdminProhibidoComponent },
  { path: 'admin', component: AdminShellComponent, canActivate: [guardAdminGlobal], children: [
    { path: '', pathMatch: 'full', redirectTo: 'resumen' },
    { path: 'resumen', component: AdminResumenComponent },
    { path: 'organizaciones', component: AdminOrganizacionesComponent },
    { path: 'usuarios', component: AdminUsuariosComponent },
    { path: 'suscripciones', component: AdminSuscripcionesComponent },
    { path: 'auditoria', component: AdminAuditoriaComponent }
  ] },
  { path: '**', component: NotFoundComponent }
];
