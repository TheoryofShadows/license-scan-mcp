/**
 * Dependency license scanner — advisory only, not legal advice.
 * Uses lockfile/metadata when present; optionally queries npm registry
 * license field (metadata only — does not download tarballs).
 */
import fs from "node:fs/promises";
import path from "node:path";

const ADVISORY =
  "ADVISORY ONLY — not legal advice. License detection from package metadata and the public npm registry license field. Verify critical deps yourself.";


/**
 * @param {string} license
 * @returns {{ flag: 'ok'|'copyleft'|'unknown'|'permissive', detail: string }}
 */
export function classifyLicense(license) {
  if (license == null || license === "" || license === "UNKNOWN" || license === "UNLICENSED") {
    return { flag: "unknown", detail: String(license || "missing") };
  }
  const s = typeof license === "string" ? license : JSON.stringify(license);
  if (/\bagpl\b/i.test(s)) {
    return { flag: "copyleft", detail: `AGPL-family: ${s}` };
  }
  if (/\blgpl\b/i.test(s)) {
    return { flag: "copyleft", detail: `LGPL-family: ${s}` };
  }
  if (/\bgpl\b/i.test(s)) {
    return { flag: "copyleft", detail: `GPL-family: ${s}` };
  }
  if (/mit|apache|bsd|isc|0bsd|unlicense|cc0|mpl/i.test(s)) {
    return { flag: "permissive", detail: s };
  }
  return { flag: "ok", detail: s };
}

/**
 * Collect dependency names from package.json
 * @param {object} pkg
 * @param {{ includeDev?: boolean, includePeer?: boolean, includeOptional?: boolean }} opts
 */
export function collectDepNames(pkg, opts = {}) {
  const names = new Set();
  const add = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const n of Object.keys(obj)) names.add(n);
  };
  add(pkg.dependencies);
  if (opts.includeDev !== false) add(pkg.devDependencies);
  if (opts.includePeer) add(pkg.peerDependencies);
  if (opts.includeOptional) add(pkg.optionalDependencies);
  return [...names].sort();
}

/**
 * Try to read license from package-lock v2/v3 packages map or yarn/pnpm loosely.
 * @param {string} projectDir
 * @param {string[]} names
 */
export async function licensesFromLockfile(projectDir, names) {
  /** @type {Record<string, string>} */
  const found = {};
  const tryFiles = [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
  ];
  let lockKind = null;
  let lockRaw = null;
  for (const f of tryFiles) {
    try {
      lockRaw = await fs.readFile(path.join(projectDir, f), "utf8");
      lockKind = f;
      break;
    } catch {
      /* continue */
    }
  }
  if (!lockRaw) return { lockKind: null, found };

  if (lockKind === "package-lock.json" || lockKind === "npm-shrinkwrap.json") {
    let lock;
    try {
      lock = JSON.parse(lockRaw);
    } catch {
      return { lockKind, found };
    }
    // npm v7+ packages map
    if (lock.packages && typeof lock.packages === "object") {
      for (const [key, meta] of Object.entries(lock.packages)) {
        if (!meta || typeof meta !== "object") continue;
        const name =
          meta.name ||
          (key.startsWith("node_modules/")
            ? key.replace(/^node_modules\//, "").replace(/\/node_modules\//g, "/")
            : null);
        if (!name || !names.includes(name)) continue;
        if (meta.license) found[name] = String(meta.license);
      }
    }
    // npm v1 dependencies tree — no license usually
    if (lock.dependencies && typeof lock.dependencies === "object") {
      for (const name of names) {
        if (found[name]) continue;
        const entry = lock.dependencies[name];
        if (entry?.license) found[name] = String(entry.license);
      }
    }
  } else if (lockKind === "yarn.lock") {
    // Yarn classic/berry rarely embeds license; skip heavy parse — leave for registry
  } else if (lockKind === "pnpm-lock.yaml") {
    // pnpm lock does not usually include license strings
  }
  return { lockKind, found };
}

/**
 * Fetch license field from npm registry (metadata only).
 * @param {string} name
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function fetchNpmLicense(name, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace(/%40/g, "@")}`;
  // scoped packages: @scope/pkg → registry.npmjs.org/@scope%2fpkg
  const encoded =
    name.startsWith("@")
      ? `https://registry.npmjs.org/${name.replace("/", "%2f")}`
      : `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(encoded, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "license-scan-mcp/0.1 (+https://github.com/TheoryofShadows/license-scan-mcp)",
      },
    });
    if (!res.ok) {
      return { name, license: null, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const latest = data["dist-tags"]?.latest;
    const ver = latest && data.versions?.[latest];
    const license =
      ver?.license ??
      data.license ??
      (typeof data.versions === "object"
        ? Object.values(data.versions).at(-1)?.license
        : null);
    const licenseStr =
      license == null
        ? null
        : typeof license === "string"
          ? license
          : license.type || JSON.stringify(license);
    return { name, license: licenseStr, version: latest || null };
  } catch (err) {
    return {
      name,
      license: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ projectDir: string, includeDev?: boolean, fetchMissing?: boolean, maxFetch?: number }} input
 */
export async function scanLicenses(input) {
  const projectDir = path.resolve(String(input.projectDir));
  const pkgPath = path.join(projectDir, "package.json");
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
  const names = collectDepNames(pkg, {
    includeDev: input.includeDev !== false,
    includePeer: Boolean(input.includePeer),
    includeOptional: Boolean(input.includeOptional),
  });
  const { lockKind, found } = await licensesFromLockfile(projectDir, names);

  /** @type {Record<string, { license: string|null, source: string, classification: ReturnType<typeof classifyLicense>, error?: string }>} */
  const results = {};
  const missing = [];

  for (const name of names) {
    if (found[name]) {
      results[name] = {
        license: found[name],
        source: lockKind || "lockfile",
        classification: classifyLicense(found[name]),
      };
    } else {
      missing.push(name);
    }
  }

  const fetchMissing = input.fetchMissing !== false;
  const maxFetch = Math.min(Math.max(input.maxFetch ?? 80, 0), 200);
  let fetched = 0;
  if (fetchMissing) {
    for (const name of missing) {
      if (fetched >= maxFetch) {
        results[name] = {
          license: null,
          source: "none",
          classification: classifyLicense(null),
          error: "maxFetch reached; not queried",
        };
        continue;
      }
      const r = await fetchNpmLicense(name);
      fetched++;
      results[name] = {
        license: r.license,
        source: r.license ? "npm-registry" : "none",
        classification: classifyLicense(r.license),
        ...(r.error ? { error: r.error } : {}),
        ...(r.version ? { version: r.version } : {}),
      };
    }
  } else {
    for (const name of missing) {
      results[name] = {
        license: null,
        source: "none",
        classification: classifyLicense(null),
      };
    }
  }

  const flags = { copyleft: [], unknown: [], permissive: [], ok: [] };
  for (const [name, meta] of Object.entries(results)) {
    flags[meta.classification.flag].push(name);
  }

  return {
    projectDir,
    packageName: pkg.name,
    lockfile: lockKind,
    dependencyCount: names.length,
    registryFetches: fetched,
    flags: {
      copyleft: flags.copyleft.sort(),
      unknown: flags.unknown.sort(),
      permissive: flags.permissive.sort(),
      other: flags.ok.sort(),
    },
    packages: results,
    disclaimer: ADVISORY,
  };
}

/**
 * Flag only GPL/AGPL/unknown for quick commercial awareness.
 * @param {{ projectDir: string, includeDev?: boolean, fetchMissing?: boolean }} input
 */
export async function flagRiskyLicenses(input) {
  const full = await scanLicenses(input);
  const risky = [];
  for (const [name, meta] of Object.entries(full.packages)) {
    if (meta.classification.flag === "copyleft" || meta.classification.flag === "unknown") {
      risky.push({
        name,
        license: meta.license,
        flag: meta.classification.flag,
        detail: meta.classification.detail,
        source: meta.source,
      });
    }
  }
  risky.sort((a, b) => a.flag.localeCompare(b.flag) || a.name.localeCompare(b.name));
  return {
    projectDir: full.projectDir,
    riskyCount: risky.length,
    risky,
    disclaimer: ADVISORY,
  };
}
