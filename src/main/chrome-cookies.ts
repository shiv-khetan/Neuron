// Import Chrome's cookies into an Electron session so the in-app browser is
// "already logged in like Chrome". Windows only.
//
// ponytail: handles the standard v10/v11 (AES-256-GCM) cookie encryption.
// Chrome's newer app-bound encryption (v20) needs elevation and is skipped —
// reported in `skipped`. Upgrade path: add the app-bound key path if needed.
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Session } from 'electron';

// sql.js is a UMD/WASM module; require keeps it out of the type system.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const initSqlJs = require('sql.js');

interface ImportResult { success: boolean; imported?: number; skipped?: number; error?: string }

function chromeUserData(): string {
  return path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
}

// Decrypt the DPAPI-protected master key via PowerShell (no native module).
function dpapiUnprotect(buffer: Buffer): Buffer {
  const b64 = buffer.toString('base64');
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String('${b64}'); $k=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'); [Convert]::ToBase64String($k)`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf-8' });
  return Buffer.from(out.trim(), 'base64');
}

function getAesKey(userData: string): Buffer {
  const localState = JSON.parse(fs.readFileSync(path.join(userData, 'Local State'), 'utf-8'));
  const encoded = localState?.os_crypt?.encrypted_key;
  if (!encoded) throw new Error('Could not find os_crypt key in Chrome Local State.');
  const encryptedKey = Buffer.from(encoded, 'base64').subarray(5); // drop the "DPAPI" prefix
  return dpapiUnprotect(encryptedKey);
}

function decryptValue(encrypted: Buffer, aesKey: Buffer): string | null {
  const prefix = encrypted.subarray(0, 3).toString('latin1');
  if (prefix !== 'v10' && prefix !== 'v11') return null; // app-bound (v20) or legacy DPAPI — skip
  const nonce = encrypted.subarray(3, 15);
  const tag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(15, encrypted.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce);
  decipher.setAuthTag(tag);
  let plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  // Chrome ≥ v104 prepends a 32-byte SHA-256 of the domain to the plaintext.
  if (plain.length > 32 && !isPrintable(plain.subarray(0, 1))) plain = plain.subarray(32);
  return plain.toString('utf-8');
}

function isPrintable(b: Buffer): boolean {
  const c = b[0];
  return c >= 0x20 && c < 0x7f;
}

// Chrome stores expiry as microseconds since 1601-01-01; Electron wants seconds since epoch.
function chromeTimeToUnix(expiresUtc: number): number | undefined {
  if (!expiresUtc) return undefined;
  return Math.floor(expiresUtc / 1_000_000 - 11_644_473_600);
}

export async function importChromeCookies(session: Session, domain?: string): Promise<ImportResult> {
  if (process.platform !== 'win32') return { success: false, error: 'Chrome cookie import is currently Windows-only.' };
  const userData = chromeUserData();
  const cookiesDb = path.join(userData, 'Default', 'Network', 'Cookies');
  if (!fs.existsSync(cookiesDb)) return { success: false, error: 'Chrome cookies database not found. Is Chrome installed (default profile)?' };

  let aesKey: Buffer;
  try {
    aesKey = getAesKey(userData);
  } catch (err) {
    return { success: false, error: `Could not unlock Chrome key: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Copy the DB first — Chrome keeps the live file locked.
  const tmp = path.join(os.tmpdir(), `neuron-cookies-${Date.now()}.db`);
  try {
    fs.copyFileSync(cookiesDb, tmp);
    const SQL = await initSqlJs({ locateFile: (f: string) => path.join(path.dirname(require.resolve('sql.js')), f) });
    const db = new SQL.Database(fs.readFileSync(tmp));
    const res = db.exec('SELECT host_key, name, encrypted_value, path, is_secure, is_httponly, expires_utc FROM cookies');
    db.close();
    if (!res.length) return { success: true, imported: 0, skipped: 0 };

    const rows = res[0].values as unknown[][];
    let imported = 0;
    let skipped = 0;
    for (const [hostKey, name, encValue, cookiePath, isSecure, isHttpOnly, expiresUtc] of rows as [string, string, Uint8Array, string, number, number, number][]) {
      if (domain && !String(hostKey).includes(domain)) continue;
      let value: string | null = null;
      try {
        value = decryptValue(Buffer.from(encValue), aesKey);
      } catch {
        value = null;
      }
      if (value === null) { skipped++; continue; }
      const host = String(hostKey).replace(/^\./, '');
      const secure = !!isSecure;
      try {
        await session.cookies.set({
          url: `${secure ? 'https' : 'http'}://${host}${cookiePath || '/'}`,
          name: String(name),
          value,
          domain: String(hostKey),
          path: cookiePath || '/',
          secure,
          httpOnly: !!isHttpOnly,
          expirationDate: chromeTimeToUnix(Number(expiresUtc)),
        });
        imported++;
      } catch {
        skipped++;
      }
    }
    return { success: true, imported, skipped };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
  }
}
