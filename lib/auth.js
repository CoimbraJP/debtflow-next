import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'fallback-dev-secret-troque-em-producao'
);

const COOKIE_NAME = 'df_session';
const MAX_AGE     = 60 * 60 * 24 * 7; // 7 dias

// Cada tenant tem sua própria senha (env vars distintas)
const TENANTS = [
  { envKey: 'ADMIN_PASSWORD_MIGUEL', tenant: 'miguel' },
  { envKey: 'ADMIN_PASSWORD_LOJA',   tenant: 'loja'   },
];

/** Retorna o tenant correspondente à senha, ou null se inválida */
export function resolveTenant(password) {
  for (const { envKey, tenant } of TENANTS) {
    const stored = process.env[envKey];
    if (stored && password === stored) return tenant;
  }
  return null;
}

/** Cria JWT com role + tenant embutido */
export async function createSessionToken(tenant) {
  return await new SignJWT({ role: 'admin', tenant })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(SECRET);
}

export async function verifySessionToken(token) {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload; // { role, tenant, iat, exp }
  } catch {
    return null;
  }
}

export function sessionCookieOptions(token) {
  return {
    name:     COOKIE_NAME,
    value:    token,
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   MAX_AGE,
    path:     '/',
  };
}

export function clearCookieOptions() {
  return {
    name:     COOKIE_NAME,
    value:    '',
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   0,
    path:     '/',
  };
}
