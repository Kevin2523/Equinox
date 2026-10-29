import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiStateService } from '../state/ui-state.service';

@Component({
  selector: 'app-portal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './portal.component.html'
})
export class PortalComponent {
  constructor(public state: UiStateService) {}
}
