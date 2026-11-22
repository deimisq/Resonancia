import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const isSafeId = (s: unknown): s is string => typeof s === "string" && ID_RE.test(s);

// Per-user key derived from a server secret; the uid is also bound as GCM AAD so files can't be swapped between users.
function vaultKey(secret: string, uid: string): Buffer {
  return crypto.createHmac("sha256", secret).update(`vault:${uid}`).digest();
}

export function encryptVault(secret: string, uid: string, data: unknown): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", vaultKey(secret, uid), iv);
  c.setAAD(Buffer.from(uid));
  const ct = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  });
}

export function decryptVault(secret: string, uid: string, raw: string): unknown {
  const { iv, tag, ct } = JSON.parse(raw) as { iv: string; tag: string; ct: string };
  const d = crypto.createDecipheriv("aes-256-gcm", vaultKey(secret, uid), Buffer.from(iv, "base64"));
  d.setAAD(Buffer.from(uid));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8"));
}

export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, content, { mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function dirBytes(dir: string): Promise<number> {
  try {
    const names = await fs.readdir(dir);
    const sizes = await Promise.all(names.map((n) => fs.stat(path.join(dir, n)).then((s) => s.size)));
    return sizes.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}

export async function fileBytes(file: string): Promise<number> {
  return fs.stat(file).then(
    (s) => s.size,
    () => 0
  );
}
