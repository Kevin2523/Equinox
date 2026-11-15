import assert from "node:assert/strict";
import test from "node:test";
import { detectarArchivo, claveLocalValida } from "../src/almacenamiento/archivos.js";

test("rechaza traversal y extensiones ejecutables, sin confiar en MIME declarado", () => {
  assert.equal(claveLocalValida("../secreto.pdf"), false);
  assert.equal(claveLocalValida("archivo.pdf"), false);
  assert.throws(() => detectarArchivo("script.js", "text/plain", Buffer.from("console.log(1)")));
  assert.throws(() => detectarArchivo("imagen.png", "image/png", Buffer.from("<svg onload=alert(1)>")));
});

test("reconoce contenido PNG real y limita el tamaño", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000000000000000000049454e4400000000", "hex");
  assert.equal(detectarArchivo("imagen.png", "image/png", png).mime, "image/png");
  assert.equal(detectarArchivo("imagen.png", "", png).mime, "image/png");
  assert.throws(() => detectarArchivo("imagen.png", "text/plain", png));
  assert.throws(() => detectarArchivo("imagen.png", "image/png", Buffer.alloc(8 * 1024 * 1024 + 1)));
});
