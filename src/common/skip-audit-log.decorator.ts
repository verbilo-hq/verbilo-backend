import { SetMetadata } from '@nestjs/common';

export const SKIP_AUDIT_LOG_KEY = 'skipAuditLog';

export const SkipAuditLog = () => SetMetadata(SKIP_AUDIT_LOG_KEY, true);

