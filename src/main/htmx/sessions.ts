// View sessions: one per open HTMX view tab. Each session carries an
// unguessable one-time boot token (consumed by the first document request)
// and a cookie token that authenticates every later request. Tokens are
// compared in constant time and never logged or persisted.

import { randomBytes, timingSafeEqual, createHash } from 'crypto';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface ViewSession {
  id: string;
  /** Workspace-relative posix path of the .nhtml file. */
  viewPath: string;
  /** Absolute workspace root this session is bound to. */
  root: string;
  name: string;
  theme: 'light' | 'dark';
  caps: ReadonlySet<string>;
  readPolicy: RegExp[];
  writePolicy: RegExp[];
  /** One-time token authenticating the initial document request; null once used. */
  bootToken: string | null;
  cookieToken: string;
  expiresAt: number;
  bucket: { tokens: number; last: number };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

function token(): string {
  return randomBytes(32).toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb); // hash first so lengths always match
}

export class SessionManager {
  private sessions = new Map<string, ViewSession>();

  create(init: Pick<ViewSession, 'viewPath' | 'root' | 'name' | 'theme' | 'caps' | 'readPolicy' | 'writePolicy'>): ViewSession {
    const session: ViewSession = {
      ...init,
      id: token(),
      bootToken: token(),
      cookieToken: token(),
      expiresAt: Date.now() + SESSION_TTL_MS,
      bucket: { tokens: 30, last: Date.now() },
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Validate the one-time document boot token; consumes it on success. */
  consumeBoot(id: string, boot: unknown): ViewSession | null {
    const s = this.sessions.get(id);
    if (!s || !s.bootToken || typeof boot !== 'string' || Date.now() > s.expiresAt) return null;
    if (!safeEqual(s.bootToken, boot)) return null;
    s.bootToken = null;
    return s;
  }

  /** Re-arm the boot token so an existing session's document can be reloaded. */
  rearmBoot(id: string): string | null {
    const s = this.sessions.get(id);
    if (!s || Date.now() > s.expiresAt) return null;
    s.bootToken = token();
    return s.bootToken;
  }

  /** Validate a cookie value of the form `${id}:${cookieToken}`. */
  byCookie(cookieValue: unknown): ViewSession | null {
    if (typeof cookieValue !== 'string') return null;
    const sep = cookieValue.indexOf(':');
    if (sep <= 0) return null;
    const s = this.sessions.get(cookieValue.slice(0, sep));
    if (!s || Date.now() > s.expiresAt) return null;
    if (!safeEqual(s.cookieToken, cookieValue.slice(sep + 1))) return null;
    return s;
  }

  get(id: string): ViewSession | null {
    const s = this.sessions.get(id);
    return s && Date.now() <= s.expiresAt ? s : null;
  }

  revoke(id: string): void {
    this.sessions.delete(id);
  }

  revokeAll(): void {
    this.sessions.clear();
  }

  findByPath(root: string, viewPath: string): ViewSession | null {
    for (const s of this.sessions.values()) {
      if (s.root === root && s.viewPath === viewPath && Date.now() <= s.expiresAt) return s;
    }
    return null;
  }

  /** Simple per-session token bucket: ~15 requests/second, burst of 30. */
  allowRequest(s: ViewSession): boolean {
    const now = Date.now();
    s.bucket.tokens = Math.min(30, s.bucket.tokens + ((now - s.bucket.last) / 1000) * 15);
    s.bucket.last = now;
    if (s.bucket.tokens < 1) return false;
    s.bucket.tokens -= 1;
    return true;
  }
}
