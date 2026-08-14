import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

/**
 * Module loader for the test runner.
 *
 * The app is built by Next, which resolves the "@/" alias and extensionless
 * imports for us. Running the same sources directly under Node needs both
 * resolved by hand — this keeps the tests exercising the real files rather
 * than a separately compiled copy that could drift from them.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, next) {
  let spec = specifier;

  // `server-only` is a build-time assertion for the bundler: importing it
  // outside a server component is meant to fail loudly. Under Node there is
  // no such distinction to enforce, and the modules it guards are exactly the
  // ones worth testing, so it resolves to nothing here.
  if (spec === "server-only") {
    return { shortCircuit: true, url: pathToFileURL(path.join(ROOT, "tests/empty.mjs")).href };
  }

  if (spec.startsWith("@/")) {
    spec = pathToFileURL(path.join(ROOT, spec.slice(2))).href;
  }

  const isPathLike = spec.startsWith(".") || spec.startsWith("file:");
  if (isPathLike && !/\.[cm]?[jt]sx?$/.test(spec)) {
    const parentDir = context.parentURL
      ? path.dirname(fileURLToPath(context.parentURL))
      : ROOT;
    const base = spec.startsWith("file:") ? fileURLToPath(spec) : path.resolve(parentDir, spec);

    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(candidate)) {
        return next(pathToFileURL(candidate).href, context);
      }
    }
  }

  return next(spec, context);
}
