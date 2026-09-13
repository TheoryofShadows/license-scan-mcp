import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  classifyLicense,
  collectDepNames,
  licensesFromLockfile,
  scanLicenses,
} from "../lib.js";

describe("classifyLicense", () => {
  it("flags MIT as permissive", () => {
    assert.equal(classifyLicense("MIT").flag, "permissive");
  });
  it("flags GPL as copyleft", () => {
    assert.equal(classifyLicense("GPL-3.0").flag, "copyleft");
  });
  it("flags AGPL as copyleft", () => {
    assert.equal(classifyLicense("AGPL-3.0-only").flag, "copyleft");
  });
  it("flags missing as unknown", () => {
    assert.equal(classifyLicense(null).flag, "unknown");
    assert.equal(classifyLicense("UNLICENSED").flag, "unknown");
  });
});

describe("collectDepNames", () => {
  it("collects deps", () => {
    const names = collectDepNames({
      dependencies: { a: "1" },
      devDependencies: { b: "2" },
    });
    assert.deepEqual(names, ["a", "b"]);
  });
});

describe("licensesFromLockfile + scan", () => {
  it("reads licenses from package-lock packages map", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "license-scan-"));
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "demo",
        dependencies: { leftpad: "1.0.0", "copyleft-pkg": "1.0.0" },
      }),
    );
    await fs.writeFile(
      path.join(dir, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "demo" },
          "node_modules/leftpad": { version: "1.0.0", license: "MIT" },
          "node_modules/copyleft-pkg": { version: "1.0.0", license: "GPL-3.0" },
        },
      }),
    );
    const { found, lockKind } = await licensesFromLockfile(dir, ["leftpad", "copyleft-pkg"]);
    assert.equal(lockKind, "package-lock.json");
    assert.equal(found.leftpad, "MIT");
    assert.equal(found["copyleft-pkg"], "GPL-3.0");

    const scan = await scanLicenses({ projectDir: dir, fetchMissing: false });
    assert.ok(scan.flags.copyleft.includes("copyleft-pkg"));
    assert.ok(scan.flags.permissive.includes("leftpad"));
    assert.match(scan.disclaimer, /not legal advice/i);
  });
});
