import { Request, Response, NextFunction } from 'express';
import { ServiceIdentitySchema, ActorRole, CapabilitySchema } from '@bayora/schemas';
import { generateRequestId } from '@bayora/crypto-utils';

export interface AuthenticatedRequest extends Request {
  identity?: z.infer<typeof ServiceIdentitySchema>;
  requestId: string;
  capabilities: z.infer<typeof CapabilitySchema>[];
}

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

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const serviceId = req.headers['x-service-id'] as string;
  const role = req.headers['x-service-role'] as ActorRole;

  if (!serviceId || !role) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing service identity headers',
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

  req.identity = result.data;
  req.capabilities = capabilities;
  next();
}

export function requireCapability(capability: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const hasCapability = req.capabilities.some(c => c.capability === capability);
    if (!hasCapability) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Missing required capability: ${capability}`,
          requestId: req.requestId
        },
        requestId: req.requestId
      });
    }
    next();
  };
}

export function requireRole(...roles: ActorRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.identity || !roles.includes(req.identity.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient role permissions',
          requestId: req.requestId
        },
        requestId: req.requestId
      });
    }
    next();
  };
}

export function requestIdMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  req.requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  res.setHeader('x-request-id', req.requestId);
  next();
}