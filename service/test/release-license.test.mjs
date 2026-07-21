import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(serviceRoot, "..");

test("the release tree carries AGPL-3.0 and preserves independent notices", async () => {
  const [rootLicense, upstreamLicense, notice, servicePackage] =
    await Promise.all([
      readFile(path.join(repositoryRoot, "LICENSE"), "utf8"),
      readFile(path.join(repositoryRoot, "ui", "LICENSE"), "utf8"),
      readFile(path.join(repositoryRoot, "NOTICE.md"), "utf8"),
      readFile(path.join(serviceRoot, "package.json"), "utf8").then(JSON.parse),
    ]);

  assert.equal(rootLicense, upstreamLicense);
  assert.match(rootLicense, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(rootLicense, /Version 3, 19 November 2007/);
  assert.equal(servicePackage.license, "AGPL-3.0-only");
  assert.match(notice, /demo\/cedar-house-v1/);
  assert.match(notice, /demo\/space-trip-v1/);
  assert.match(notice, /THIRD_PARTY\.md/);
});
