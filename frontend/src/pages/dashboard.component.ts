import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkMapComponent } from '../shared/work-map.component';
import { ProjectInspectorComponent } from '../shared/project-inspector.component';
import { UiStateService } from '../state/ui-state.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, WorkMapComponent, ProjectInspectorComponent],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent {
  constructor(public state: UiStateService) {}
}
