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

/**
 * Authentication middleware enforcing verified identity and roles.
 * Client-supplied headers like 'x-user-id' or 'x-user-branches' are NEVER trusted in production.
 */
export function authenticateUser(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  let token: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  // 1. Verify token against recognized sessions/tokens
  if (token && DEV_TOKENS[token]) {
    req.user = DEV_TOKENS[token];
    return next();
  }

  // 2. In test or development environment, support legacy test identity headers safely
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

  // 3. Strict production requirement
  return res.status(401).json({
    error: 'Unauthorized: Valid Authorization Bearer token required for API access',
    auth_status: 'MISSING_OR_INVALID_TOKEN'
  });
}

/**
 * Verifies that the authenticated user possesses access rights to the target branch.
 */
export function verifyBranchAccess(user: AuthUser | undefined, targetBranchId: string): boolean {
  if (!user) return false;
  if (user.authorizedBranches.includes('*') || user.role === 'ADMIN') return true;
  return user.authorizedBranches.includes(targetBranchId);
}
