import 'server-only';

import pino from 'pino';

import {
  logErrorSafely,
  type LogContext,
  type OperationalLogger,
} from '../../modules/observability/application/log-error';

const logger = pino({
  base: undefined,
  level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'error',
  messageKey: 'message',
});

export const productionOperationalLogger: OperationalLogger = {
  error(record) {
    logger.error(record, 'application boundary failure');
  },
};

export function captureOperationalError(error: unknown, context: LogContext = {}): void {
  logErrorSafely(productionOperationalLogger, error, context);
}
