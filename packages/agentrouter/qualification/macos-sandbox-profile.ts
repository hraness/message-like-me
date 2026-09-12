/** Experimental fixture only. This is not a production qualification or launch option. */
export function syntheticMacSandbox(input: { executable: string; scratch: readonly string[]; port: number }): string {
  if (process.platform !== "darwin" || !Number.isSafeInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error("INVALID_SYNTHETIC_SANDBOX");
  const literal = (path: string) => {
    if (!path.startsWith("/") || /[\x00-\x1f"\\]/u.test(path)) throw new Error("INVALID_SYNTHETIC_SANDBOX_PATH");
    return `"${path}"`;
  };
  return `(version 1)
(deny default)
(allow process-exec (literal ${literal(input.executable)}))
(allow file-read* (literal ${literal(input.executable)})
  (subpath "/System/Library") (subpath "/usr/lib") (subpath "/Library/Apple/System/Library")
  (subpath "/System/Cryptexes/OS")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS")
  (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
(allow file-write* (literal "/dev/null"))
(allow file-read-data file-write-data (literal "/dev/fd/0") (literal "/dev/fd/1") (literal "/dev/fd/2"))
(allow file-map-executable (literal ${literal(input.executable)})
  (subpath "/System/Library") (subpath "/usr/lib") (subpath "/System/Cryptexes/OS") (subpath "/System/Volumes/Preboot/Cryptexes/OS"))
(allow file-read* (literal "/") (path-ancestors "/System/Cryptexes/OS") (path-ancestors "/System/Volumes/Preboot/Cryptexes/OS"))
${input.scratch.map(path => `(allow file-read* file-write* (subpath ${literal(path)}))`).join("\n")}
(allow sysctl-read)
(allow process-info* (target self))
(allow signal (target self))
(allow network-outbound (remote tcp "localhost:${input.port}"))
`;
}
