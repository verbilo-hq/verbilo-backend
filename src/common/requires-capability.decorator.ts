import { SetMetadata } from '@nestjs/common';
import { type Capability } from './capabilities';

export const REQUIRES_CAPABILITY_KEY = 'requires_capability';

/**
 * Mark a controller method as requiring a specific capability. The
 * `CapabilityGuard` reads this and 403s if the actor's role doesn't
 * have it. Scope checks are the service's responsibility (it has the
 * loaded target entity), with helpers in `scope.ts`.
 */
export const RequiresCapability = (capability: Capability) =>
  SetMetadata(REQUIRES_CAPABILITY_KEY, capability);
