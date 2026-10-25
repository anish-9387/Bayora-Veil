import { query } from '../db/client.js';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ServiceIdentitySchema, ActorRole, CapabilitySchema } from '@bayora/schemas';
import { generateRequestId } from '@bayora/crypto-utils';
import { authenticate } from '../security/accounts.js';
import { principals, DEMO_TENANT } from '../security/context.js';

const CAPABILITY_MAP: Record<string, z.infer<typeof CapabilitySchema>[]> = {
  red: [
    { capability: 'red.submit_payload', resource: 'payload', action: 'create' },
    { capability: 'red.read_own_payload', resource: 'payload', action: 'read' },
    { capability: 'red.commit_payload', resource: 'commitment', action: 'create' }
  ],
  blue: [
    { capability: 'blue.read_sanitized_observation', resource: 'observation', action: 'read' },
    { capability: 'blue.apply_defense', resource: 'defense', action: 'execute' },
    { capability: 'blue.read_own_rules', resource: 'defense_rule', action: 'read' }
  ],
  target: [
    { capability: 'target.execute_case', resource: 'case', action: 'execute' },
    { capability: 'target.read_context', resource: 'context', action: 'read' }
  ],
  auditor: [
    { capability: 'auditor.read_closed_run_evidence', resource: 'evidence', action: 'read' },
    { capability: 'auditor.verify_manifest', resource: 'manifest', action: 'verify' },
    { capability: 'auditor.read_audit_log', resource: 'audit', action: 'read' }
  ],
  orchestrator: [
    { capability: 'orchestrator.create_run', resource: 'run', action: 'create' },
    { capability: 'orchestrator.transition_run', resource: 'run', action: 'update' },
    { capability: 'orchestrator.read_all', resource: '*', action: 'read' }
  ],
  'observation-firewall': [
    { capability: 'firewall.release_observation', resource: 'observation', action: 'create' },
    { capability: 'firewall.filter_evidence', resource: 'evidence', action: 'read' }
  ],
  'audit-service': [
    { capability: 'audit.append_event', resource: 'audit_event', action: 'create' },
    { capability: 'audit.build_manifest', resource: 'manifest', action: 'create' },
    { capability: 'audit.sign_manifest', resource: 'manifest', action: 'sign' }
  ]
};

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
  const demo = process.env.AUTH_MODE === 'demo' && process.env.NODE_ENV !== 'production';
  const account = demo ? null : await authenticate((req.headers.authorization || '').replace(/^Bearer /, ''));
  const serviceId = demo ? req.headers['x-service-id'] as string : account?.id;
  const role = (demo ? req.headers['x-service-role'] : account?.role) as ActorRole;

  if (!serviceId || !role) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        requestId: req.requestId
      },
      requestId: req.requestId
    });
  }

  const capabilities = CAPABILITY_MAP[role] || [];

  const identity = {
    serviceId,
    role,
    capabilities
  };

  const result = ServiceIdentitySchema.safeParse(identity);
  if (!result.success) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_IDENTITY',
        message: 'Invalid service identity',
        requestId: req.requestId
      },
      requestId: req.requestId
    });
  }

  req.identity = { ...result.data, tenantId: account?.tenant_id || DEMO_TENANT, userId: account?.id || '44444444-4444-4444-4444-444444444444' };
  req.capabilities = capabilities;
  principals.run({ tenantId: req.identity.tenantId, userId: req.identity.userId, role }, next);
  } catch (error) { next(error); }
}

export function requireCapability(capability: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const hasCapability = req.capabilities.some(c => c.capability === capability);
    if (!hasCapability) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
          requestId: req.requestId
        },
        requestId: req.requestId
      });
    }
    next();
  };
}

export function requireRole(roles: ActorRole | ActorRole[]) {
  const roleArray = Array.isArray(roles) ? roles : [roles];
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.identity || !roleArray.includes(req.identity.role as ActorRole)) {
      const runId = z.string().uuid().safeParse(req.params.id);
      void query('INSERT INTO access_denials (run_id, actor, route, tenant_id) VALUES ($1, $2, $3, $4)',
        [runId.success ? runId.data : null, req.identity?.role || 'unknown', req.path.split('?')[0], req.identity?.tenantId || null])
        .then(() => res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied', requestId: req.requestId }, requestId: req.requestId }))
        .catch(next);
      return;

    }
    next();
  };
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  req.requestId = generateRequestId();
  res.setHeader('x-request-id', req.requestId);
  next();
}
