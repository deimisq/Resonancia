import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSafePublicUrl, isPrivateOrReservedIp } from "./netSafety.ts";
import { calculateWavDurationSeconds, concatenateWavBuffers, ensureWav, isValidWavBase64 } from "./wav.ts";

test("blocks private, loopback, metadata and mapped IPv6", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1"]) {
    assert.equal(isPrivateOrReservedIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPrivateOrReservedIp(ip), false, ip);
});

test("assertSafePublicUrl rejects unsafe URLs", async () => {
  for (const u of ["http://example.com", "https://localhost/x", "https://127.0.0.1", "https://a.internal", "https://user:p@example.com", "nope"]) {
    await assert.rejects(assertSafePublicUrl(u), u);
  }
});

test("wav helpers: wrap PCM, concatenate, measure, validate", () => {
  const pcm = Buffer.alloc(48000); // 1s @ 24kHz 16-bit mono
  const wav = ensureWav(pcm.toString("base64"), "audio/L16;codec=pcm;rate=24000");
  assert.equal(wav.mimeType, "audio/wav");
  assert.equal(calculateWavDurationSeconds(wav.base64), 1);
  assert.equal(ensureWav(wav.base64, "audio/L16").base64, wav.base64); // already WAV: untouched
  const joined = concatenateWavBuffers([Buffer.from(wav.base64, "base64"), Buffer.from(wav.base64, "base64")], 0);
  assert.equal(calculateWavDurationSeconds(joined.toString("base64")), 2);
  assert.equal(isValidWavBase64(wav.base64, 100, 1e6), true);
  assert.equal(isValidWavBase64(pcm.toString("base64"), 100, 1e6), false);
});

test("accepts long signed URLs (HF __sign tokens) but rejects absurd ones", async () => {
  const long = "https://example.com/file.wav?__sign=" + "a".repeat(900);
  await assert.doesNotReject(assertSafePublicUrl(long));
  await assert.rejects(assertSafePublicUrl("https://example.com/?" + "a".repeat(5000)));
});
