import { cache } from 'react';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, parseLocale } from './locales';

export const getRequestLocale = cache(async () => parseLocale((await cookies()).get(LOCALE_COOKIE)?.value));
