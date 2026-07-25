export type PermissionsApi = {
  contains: (details: { origins?: string[] }) => Promise<boolean>;
  request: (details: { origins?: string[] }) => Promise<boolean>;
};

export function resolvePermissionsApi(): PermissionsApi | null;

export function ensureHostPermission(
  serviceUrl: unknown,
  permissionsApi?: PermissionsApi | null,
): Promise<boolean>;
