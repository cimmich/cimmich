export const cimmichTimeoutDiagnostic = (
  path: string,
  method: string,
  timeoutMs: number,
): [string, { code: string; details: { method: string; path: string; timeoutMs: number }; status: number }] => [
  `Cimmich service did not respond in time (${method} ${path} after ${(timeoutMs / 1000).toLocaleString()}s)`,
  { code: 'CIMMICH_TIMEOUT', details: { method, path, timeoutMs }, status: 0 },
];

export const cimmichUnavailableDiagnostic = (): [string, { code: string; status: number }] => [
  'Cimmich service is unavailable',
  { code: 'CIMMICH_UNAVAILABLE', status: 0 },
];
