import { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';

export interface AuthUser {
  userId: string;
  role: 'ADMIN' | 'BRANCH_MANAGER' | 'OPS_MANAGER' | 'PLANNER';
  authorizedBranches: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Development and testing credentials mapping
const DEV_TOKENS: Record<string, AuthUser> = {
  'admin-token': {
    userId: 'admin-corp-01',
    role: 'ADMIN',
    authorizedBranches: ['*']
  },
  'khi-manager-token': {
    userId: 'mgr-clifton-01',
    role: 'BRANCH_MANAGER',
    authorizedBranches: ['BR-KHI-01']
  },
  'lhr-manager-token': {
    userId: 'mgr-gulberg-01',
    role: 'BRANCH_MANAGER',
    authorizedBranches: ['BR-LHR-01']
  },
  'isb-manager-token': {
    userId: 'mgr-f7-01',
    role: 'BRANCH_MANAGER',
    authorizedBranches: ['BR-ISB-01']
  },
  'qa-lead-token': {
    userId: 'qa-lead-user',
    role: 'OPS_MANAGER',
    authorizedBranches: ['*']
  }
};

import { verifyJwt } from './jwt.js';

/**
 * Authentication middleware enforcing verified identity, JWT signatures, and roles.
 * Client-supplied headers like 'x-user-id' or 'x-user-branches' are NEVER trusted in production.
 */
export function authenticateUser(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  let token: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  // 1. If token is provided, attempt JWT verification first
  if (token) {
    if (token.includes('.')) {
      const jwtResult = verifyJwt(token);
      if (jwtResult.valid && jwtResult.user) {
        req.user = jwtResult.user;
        return next();
      }
      return res.status(401).json({
        error: `Unauthorized: ${jwtResult.error || 'Invalid JWT token'}`,
        auth_status: 'INVALID_TOKEN'
      });
    }

    // 2. In non-production, allow DEV_TOKENS for testing and development convenience
    if (config.nodeEnv !== 'production') {
      if (DEV_TOKENS[token]) {
        req.user = DEV_TOKENS[token];
        return next();
      }
    } else {
      // In production, reject development token names explicitly
      return res.status(401).json({
        error: 'Unauthorized: Production requires a cryptographically signed JWT token',
        auth_status: 'DEV_TOKENS_FORBIDDEN_IN_PROD'
      });
    }
  }

  // 3. In non-production, support test identity headers or default dev session
  if (config.nodeEnv !== 'production') {
    const testUserId = req.headers['x-user-id'] as string;
    const testUserBranches = req.headers['x-user-branches'] as string;

    if (testUserId) {
      req.user = {
        userId: testUserId,
        role: testUserId.includes('admin') ? 'ADMIN' : 'OPS_MANAGER',
        authorizedBranches: testUserBranches 
          ? testUserBranches.split(',').map(b => b.trim()) 
          : ['*']
      };
      return next();
    }

    // Default development fallback session
    req.user = {
      userId: 'dev-ops-manager',
      role: 'OPS_MANAGER',
      authorizedBranches: ['BR-KHI-01', 'BR-LHR-01', 'BR-ISB-01', '*']
    };
    return next();
  }

  // 4. Strict production requirement
  return res.status(401).json({
    error: 'Unauthorized: Valid Authorization Bearer JWT required for API access',
    auth_status: 'MISSING_OR_INVALID_TOKEN'
  });
}

/**
 * Role-based authorization middleware enforcing least-privilege access.
 */
export function requireRole(...allowedRoles: Array<'ADMIN' | 'BRANCH_MANAGER' | 'OPS_MANAGER' | 'PLANNER'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }
    if (allowedRoles.includes(req.user.role) || req.user.role === 'ADMIN') {
      return next();
    }
    return res.status(403).json({
      error: `Forbidden: User role '${req.user.role}' lacks permission for this action`,
      required_roles: allowedRoles
    });
  };
}

/**
 * Verifies that the authenticated user possesses access rights to the target branch.
 */
export function verifyBranchAccess(user: AuthUser | undefined, targetBranchId: string): boolean {
  if (!user) return false;
  if (user.authorizedBranches.includes('*') || user.role === 'ADMIN') return true;
  return user.authorizedBranches.includes(targetBranchId);
}
