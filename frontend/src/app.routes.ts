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
import { LoginComponent } from './pages/login.component';
import { RegistroComponent } from './pages/registro.component';
import { RecuperacionComponent } from './pages/recuperacion.component';
import { LogoutComponent } from './pages/logout.component';
import { guardCliente, guardOrganizacion, guardPublico } from './auth/auth.guards';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'inicio-sesion' },
  { path: 'hoy', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'inicio-sesion', component: LoginComponent, canActivate: [guardPublico] },
  { path: 'registro', component: RegistroComponent, canActivate: [guardPublico] },
  { path: 'recuperar-contrasena', component: RecuperacionComponent },
  { path: 'cerrar-sesion', component: LogoutComponent },
  { path: '', component: FreelancerShellComponent, canActivate: [guardOrganizacion], children: [
    { path: 'dashboard', component: DashboardComponent },
    { path: 'clientes', component: ClientesComponent },
    { path: 'proyectos', component: ProyectosComponent },
    { path: 'tareas', component: TareasComponent },
    { path: 'finanzas', component: FinanzasComponent },
    { path: 'configuracion', component: ConfiguracionComponent },
    { path: 'vista-previa-portal', component: PortalComponent }
  ] },
  { path: '', component: ClientShellComponent, canActivate: [guardCliente], children: [
    { path: 'portal', component: ClientHomeComponent }
  ] },
  { path: '**', component: NotFoundComponent }
];
