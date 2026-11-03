import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiStateService } from '../state/ui-state.service';
import { DialogFocusDirective } from './dialog-focus.directive';

@Component({
  selector: 'app-global-modals',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogFocusDirective],
  templateUrl: './global-modals.component.html'
})
export class GlobalModalsComponent {
  constructor(public state: UiStateService) {}
}
