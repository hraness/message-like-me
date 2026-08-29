export interface ReleaseAppTokenEnvironment {
  readonly [key: string]: string | undefined;
}

export interface ReleaseAppTokenReceipt {
  readonly appId: number;
  readonly appSlug: string;
  readonly clientId: string;
  readonly expiresAt: string;
  readonly installationId: number;
  readonly repositoryId: number;
}

export const MESSAGE_LIKE_ME_REPOSITORY_ID: 1342143606;

export function parseReleaseAppConfiguration(environment: ReleaseAppTokenEnvironment): Readonly<{
  apiUrl: URL;
  appId: number;
  appSlug: string;
  clientId: string;
  installationId: number;
  privateKey: string;
  repository: "hraness/message-like-me";
  repositoryId: 1342143606;
}>;

export function createReleaseAppJwt(input: Readonly<{
  clientId: string;
  nowMilliseconds: number;
  privateKey: string;
}>): string;

export function releaseAppTokenRequestBody(): Readonly<{
  permissions: Readonly<{ contents: "write"; metadata: "read" }>;
  repository_ids: readonly [1342143606];
}>;

export function parseReleaseAppIdentity(
  value: unknown,
  configuration: ReturnType<typeof parseReleaseAppConfiguration>,
): void;

export function parseReleaseAppInstallation(
  value: unknown,
  configuration: ReturnType<typeof parseReleaseAppConfiguration>,
): void;

export function parseReleaseAppTokenResponse(value: unknown, serverDate: unknown): Readonly<{
  expiresAt: string;
  permissions: Readonly<{ contents: "write"; metadata: "read" }>;
  repositoryId: 1342143606;
  token: string;
}>;

export function withReleaseAppToken<Result>(options: Readonly<{
  environment: ReleaseAppTokenEnvironment;
  inspect(input: Readonly<{ apiUrl: URL; jwt: string }>): Promise<unknown>;
  inspectInstallation(input: Readonly<{
    apiUrl: URL;
    installationId: number;
    jwt: string;
  }>): Promise<unknown>;
  mask(token: string): void;
  mint(input: Readonly<{
    apiUrl: URL;
    body: ReturnType<typeof releaseAppTokenRequestBody>;
    installationId: number;
    jwt: string;
  }>): Promise<Readonly<{ body: unknown; serverDate: unknown }>>;
  nowMilliseconds(): number;
  revoke(input: Readonly<{ apiUrl: URL; token: string }>): Promise<void>;
}>, operation: (token: string, receipt: ReleaseAppTokenReceipt) => Promise<Result>): Promise<Result>;

export function withReleaseAppTokenFromEnvironment<Result>(
  environment: ReleaseAppTokenEnvironment,
  operation: (token: string, receipt: ReleaseAppTokenReceipt) => Promise<Result>,
): Promise<Result>;
