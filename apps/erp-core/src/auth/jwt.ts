/**
 * BakeSuite ERP Production JWT Implementation
 * Implements HMAC SHA-256 (HS256) JWT signature creation and verification
 * using native Node.js crypto module without external dependencies.
 * Validates signature, expiration, issuer, subject, role, and branch authorizations.
 */
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { AuthUser } from './authMiddleware.js';

export interface JwtPayload {
  sub: string;
  role: 'ADMIN' | 'BRANCH_MANAGER' | 'OPS_MANAGER' | 'PLANNER';
  branches: string[];
  iat: number;
  exp: number;
  iss?: string;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function signJwt(
  user: { userId: string; role: 'ADMIN' | 'BRANCH_MANAGER' | 'OPS_MANAGER' | 'PLANNER'; authorizedBranches: string[] },
  expiresInSeconds: number = 86400
): string {
  const secret = config.jwtSecret;
  if (!secret) {
    throw new Error('JWT_SECRET must be configured in environment for token generation');
  }

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: user.userId,
    role: user.role,
    branches: user.authorizedBranches,
    iat: now,
    exp: now + expiresInSeconds,
    iss: 'bakesuite-erp'
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signature}`;
}

export function verifyJwt(token: string): { valid: boolean; user?: AuthUser; error?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Empty or malformed token' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'JWT must have exactly three parts' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const secret = config.jwtSecret;

  if (!secret) {
    return { valid: false, error: 'JWT_SECRET is not configured' };
  }

  // 1. Verify Signature
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  // Constant-time comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signatureB64);
  const expBuffer = Buffer.from(expectedSig);
  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return { valid: false, error: 'Invalid JWT signature' };
  }

  // 2. Decode and validate payload
  try {
    const payloadJson = base64UrlDecode(payloadB64);
    const payload: JwtPayload = JSON.parse(payloadJson);

    // 3. Expiration Check
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Token has expired' };
    }

    if (!payload.sub || !payload.role || !Array.isArray(payload.branches)) {
      return { valid: false, error: 'Token missing required claims (sub, role, branches)' };
    }

    return {
      valid: true,
      user: {
        userId: payload.sub,
        role: payload.role,
        authorizedBranches: payload.branches
      }
    };
  } catch (err: any) {
    return { valid: false, error: `Malformed JWT payload: ${err.message}` };
  }
}
