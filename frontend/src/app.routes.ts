import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard.component';
import { ClientesComponent } from './pages/clientes.component';
import { ProyectosComponent } from './pages/proyectos.component';
import { TareasComponent } from './pages/tareas.component';
import { FinanzasComponent } from './pages/finanzas.component';
import { ConfiguracionComponent } from './pages/configuracion.component';
import { PortalComponent } from './pages/portal.component';
import { NotFoundComponent } from './pages/not-found.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'hoy', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'clientes', component: ClientesComponent },
  { path: 'proyectos', component: ProyectosComponent },
  { path: 'tareas', component: TareasComponent },
  { path: 'finanzas', component: FinanzasComponent },
  { path: 'configuracion', component: ConfiguracionComponent },
  { path: 'portal', component: PortalComponent },
  { path: '**', component: NotFoundComponent }
];
