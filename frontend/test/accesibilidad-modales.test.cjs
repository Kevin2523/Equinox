const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '../src');
const html = fs.readFileSync(path.join(src, 'shared/global-modals.component.html'), 'utf8');
const css = fs.readFileSync(path.join(src, 'app.component.css'), 'utf8');
const styles = fs.readFileSync(path.join(src, 'styles.css'), 'utf8');
const directive = fs.readFileSync(path.join(src, 'shared/dialog-focus.directive.ts'), 'utf8');

test('los cuatro diálogos globales están etiquetados y usan gestión de foco', () => {
  const dialogs = [...html.matchAll(/<(?:section|div)[^>]*role="dialog"[^>]*>/g)].map(m => m[0]);
  assert.equal(dialogs.length, 4);
  for (const dialog of dialogs) {
    assert.match(dialog, /aria-modal="true"/);
    assert.match(dialog, /aria-label="[^"]+"/);
    assert.match(dialog, /appDialogFocus/);
  }
  assert.match(directive, /event\.key !== 'Tab'/);
  assert.match(directive, /opener\.focus\(\)/);
});

test('los resultados de búsqueda son controles nativos activables con Enter y Espacio', () => {
  assert.equal([...html.matchAll(/<button type="button" class="search-result-row"/g)].length, 3);
  assert.equal([...html.matchAll(/class="search-result-row"[^>]*\(click\)="state\.selectSearchResult/g)].length, 3);
  assert.match(css, /\.search-result-row:focus-visible/);
});

function luminance(hex) {
  const rgb = hex.match(/[0-9a-f]{2}/gi).map(part => parseInt(part, 16) / 255);
  return rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, index) => sum + v * [.2126, .7152, .0722][index], 0);
}
test('textos muted y small alcanzan 4.5:1 sobre blanco', () => {
  const colors = [styles.match(/--muted:\s*(#[0-9a-f]{6})/i)?.[1],
    css.match(/\.quick-modal > small\s*\{[^}]*color:\s*(#[0-9a-f]{6})/i)?.[1],
    css.match(/\.modal-choices small\s*\{[^}]*color:\s*(#[0-9a-f]{6})/i)?.[1]];
  for (const color of colors) {
    assert.ok(color, 'falta color explícito');
    assert.ok(1.05 / (luminance(color.slice(1)) + .05) >= 4.5, `${color} incumple AA`);
  }
});
