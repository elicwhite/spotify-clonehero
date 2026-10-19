export type SentryEnvironment = 'production' | 'preview' | 'development';

export function getSentryEnvironment(
  vercelEnvironment: string | undefined,
): SentryEnvironment {
  if (vercelEnvironment === 'production' || vercelEnvironment === 'preview') {
    return vercelEnvironment;
  }

  return 'development';
}

export function isSentryEnabled(environment: SentryEnvironment): boolean {
  return environment !== 'development';
}
