import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiStateService } from '../state/ui-state.service';

@Component({
  selector: 'app-project-inspector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './project-inspector.component.html'
})
export class ProjectInspectorComponent {
  constructor(public state: UiStateService) {}
}
