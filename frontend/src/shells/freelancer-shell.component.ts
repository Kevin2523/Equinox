import { Component, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopbarComponent } from '../shared/topbar.component';
import { GlobalModalsComponent } from '../shared/global-modals.component';
import { UiStateService } from '../state/ui-state.service';

@Component({
  selector: 'app-freelancer-shell', standalone: true,
  imports: [RouterOutlet, TopbarComponent, GlobalModalsComponent],
  template: '<app-topbar></app-topbar><router-outlet></router-outlet><app-global-modals></app-global-modals>'
})
export class FreelancerShellComponent {
  constructor(private state: UiStateService) {}
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void { this.state.handleKeyboardShortcut(event); }
}
