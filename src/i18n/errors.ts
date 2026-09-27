import { describeError } from '../../shared/app-errors';
import type { Locale } from './locales';
import { hasMessage, translate, type MessageParams } from './messages';

export interface ErrorDetails { errorCode?: string; errorParams?: MessageParams }

export function formatError(locale: Locale, cause: unknown, details?: ErrorDetails | null): string {
  const error = describeError(cause);
  const code = details?.errorCode ?? error.errorCode;
  const params = details?.errorParams ?? error.errorParams;
  if (code) {
    const key = hasMessage(code) ? code : `errors.${code}`;
    if (hasMessage(key)) return translate(locale, key, params);
  }
  return error.message || translate(locale, 'common.operationFailed');
}
