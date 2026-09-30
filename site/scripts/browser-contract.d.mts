import type { Browser, LaunchOptions } from 'playwright-core';

export interface BrowserCase { width: number; theme: string; path: string }
export interface BrowserProof { executable: string; browserVersion: string; args: string[] }
export interface BuildInputs { head: string; tree: string; status: string; lock: string; manifest: string }

export function pinnedBrowserExecutable(pinned: string, override?: string): Promise<string>;
export function pinnedChromiumVersion(): string;
export function pinnedChromiumDefinition(): { defaultArgs: string[]; expectedVersion: string };
export function ownedChromiumLaunchOptions(executablePath: string, defaultArgs: readonly string[], args?: readonly string[]): LaunchOptions & {
  executablePath: string; headless: true; args: string[]; ignoreDefaultArgs: string[];
};
export function verifyOwnedChromium(browser: Pick<Browser, 'version' | 'newBrowserCDPSession'>, executablePath: string, expectedVersion: string): Promise<BrowserProof>;
export const browserLaunchArgs: string[];
export function browserCases(): BrowserCase[];
export function browserMediaFeatures(theme: string, transparency?: string): { name: string; value: string }[];
export function isSyntheticBadge(request: { url: string; method: string; resourceType: string }): boolean;
export function isSyntheticConsentRegion(request: {
  url: string; method: string; resourceType: string; cookie?: string; authorization?: string; body?: unknown;
}): boolean;
export function isPreviewPolicyBlock(request: {
  url: string; method: string; resourceType: string; error: string; mainFrame: boolean;
}, policy: { path: string; origin: string; verifiedCsp: boolean; authoredAssets: readonly string[] }): boolean;
export function assertBuildJoin(before: BuildInputs, after: BuildInputs, exitCode: number): void;
export function assertServerExit(exit: { code: number | null; signal: string | null; stopRequested: boolean; forced: boolean }): void;
export function routeTasks(errors: string[]): {
  readonly size: number;
  run<T>(operation: () => T | Promise<T>): Promise<T | void>;
  drain(): Promise<void>;
};
export function finishBrowserCase(operations: {
  primary: unknown;
  settle: () => Promise<unknown>;
  close: () => Promise<unknown>;
  drain: () => Promise<unknown>;
  check: () => unknown;
}): Promise<void>;
export function browserEnvironment(source: Readonly<Record<string, string | undefined>>, home: string): Record<string, string>;
export function deadline<T>(promise: Promise<T>, label: string, milliseconds?: number): Promise<T>;
export function browserOwner<T>(operations: {
  launch: () => Promise<T>; close: (browser: T) => Promise<void>; stopServer: () => Promise<void>;
}): { start(): Promise<T>; stop(): Promise<void> };
export function assertPresentation(value: Record<string, unknown>, sample: BrowserCase): void;
