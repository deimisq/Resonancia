import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveTitle } from "./title.ts";

test("deriveTitle: first sentence, no tags, bounded", () => {
  assert.equal(deriveTitle("Hola mundo. Segunda frase."), "Hola mundo.".replace(/\.$/, ""));
  assert.equal(deriveTitle("<breath> Hola, ¿qué tal? Bien."), "Hola, ¿qué tal?");
  assert.equal(deriveTitle("\n\n  Primera línea\nSegunda línea"), "Primera línea");
  assert.equal(deriveTitle("<laugh>"), "");
  const long = deriveTitle("palabra ".repeat(30));
  assert.ok(long.length <= 81 && long.endsWith("…") && !long.includes("palabra…palabra"));
  assert.equal(deriveTitle("a".repeat(200)).length, 81); // single huge word: hard cut
});
