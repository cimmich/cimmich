import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig } from "../src/runtime-config.mjs";

test("runtime configuration accepts exact local origins and an absolute document store", () => {
  const config = loadRuntimeConfig({
    CIMMICH_ALLOWED_ORIGINS:
      "http://127.0.0.1:3000,https://photos.example.test",
    CIMMICH_DOCUMENT_STORE_ROOT: "/var/lib/cimmich/documents",
    DATABASE_URL: "postgres://cimmich:secret@postgres:5432/cimmich",
    HOST: "0.0.0.0",
    PORT: "3101",
  });
  assert.equal(config.port, 3101);
  assert.deepEqual(
    [...config.allowedOrigins],
    ["http://127.0.0.1:3000", "https://photos.example.test"],
  );
  assert.equal(config.guidedEnabled, false);
  assert.equal(config.guidedAccessToken, "");
  assert.equal(config.guidedAuthority, "read");
  assert.equal(config.guidedImmichPublicUrl, "");
  assert.equal(config.guidedPublicUrl, "");
  assert.equal(config.guidedUiPublicUrl, "");
  assert.equal(config.guidedVisibilityCeiling, "standard");
  assert.equal(config.allTrustedShortlistEnabled, false);
  assert.equal(config.allTrustedShortlistPackId, "");
  assert.equal(config.allTrustedShortlistEvaluationReceiptDigest, "");
  assert.equal(config.runtimeMode, "production");
});

test("all-trusted shortlist is explicit and requires durable evaluation binding", () => {
  const config = loadRuntimeConfig({
    CIMMICH_ALL_TRUSTED_SHORTLIST_ENABLED: "true",
    CIMMICH_ALL_TRUSTED_SHORTLIST_EVALUATION_RECEIPT_DIGEST: "a".repeat(64),
    CIMMICH_ALL_TRUSTED_SHORTLIST_PACK_ID: "sourcepack-lab-reviewed-v1",
    CIMMICH_RUNTIME_MODE: "isolated_lab",
  });
  assert.equal(config.allTrustedShortlistEnabled, true);
  assert.equal(config.allTrustedShortlistPackId, "sourcepack-lab-reviewed-v1");
  assert.equal(
    config.allTrustedShortlistEvaluationReceiptDigest,
    "a".repeat(64),
  );
});

test("runtime configuration enables Guided only with a dedicated local token", () => {
  const config = loadRuntimeConfig({
    CIMMICH_GUIDED_ACCESS_TOKEN: "guided-access-token-0123456789abcdef",
    CIMMICH_GUIDED_AUTHORITY: "operate",
    CIMMICH_GUIDED_ENABLED: "true",
    CIMMICH_GUIDED_IMMICH_PUBLIC_URL: "http://127.0.0.1:2283/api",
    CIMMICH_GUIDED_PUBLIC_URL: "http://127.0.0.1:3301",
    CIMMICH_GUIDED_UI_PUBLIC_URL: "http://127.0.0.1:3303",
    CIMMICH_GUIDED_VISIBILITY_CEILING: "private",
  });
  assert.equal(config.guidedEnabled, true);
  assert.equal(
    config.guidedAccessToken,
    "guided-access-token-0123456789abcdef",
  );
  assert.equal(config.guidedAuthority, "operate");
  assert.equal(config.guidedImmichPublicUrl, "http://127.0.0.1:2283/api");
  assert.equal(config.guidedVisibilityCeiling, "private");
});

test("runtime configuration fails closed on ambiguous network and storage values", () => {
  for (const environment of [
    { PORT: "3101oops" },
    { PORT: "0" },
    { CIMMICH_ALLOWED_ORIGINS: "https://photos.example.test/path" },
    { CIMMICH_ALLOWED_ORIGINS: "https://user:secret@photos.example.test" },
    { CIMMICH_ALLOWED_ORIGINS: "http://127.0.0.1:3000,http://127.0.0.1:3000" },
    { CIMMICH_DOCUMENT_STORE_ROOT: "relative/documents" },
    { CIMMICH_DOCUMENT_MAX_FILE_BYTES: "0" },
    {
      CIMMICH_DOCUMENT_MAX_FILE_BYTES: "2048",
      CIMMICH_DOCUMENT_MAX_STORE_BYTES: "1024",
    },
    { CIMMICH_GUIDED_ENABLED: "yes" },
    { CIMMICH_GUIDED_ENABLED: "true" },
    { CIMMICH_GUIDED_ACCESS_TOKEN: "short", CIMMICH_GUIDED_ENABLED: "true" },
    { CIMMICH_GUIDED_AUTHORITY: "admin" },
    { CIMMICH_GUIDED_VISIBILITY_CEILING: "all" },
    {
      CIMMICH_GUIDED_IMMICH_PUBLIC_URL: "https://user:secret@example.test/api",
    },
    { CIMMICH_GUIDED_IMMICH_PUBLIC_URL: "https://example.test/not-api" },
    { CIMMICH_GUIDED_PUBLIC_URL: "https://example.test/path" },
    { CIMMICH_ALL_TRUSTED_SHORTLIST_ENABLED: "yes" },
    { CIMMICH_ALL_TRUSTED_SHORTLIST_ENABLED: "true" },
    {
      CIMMICH_ALL_TRUSTED_SHORTLIST_ENABLED: "true",
      CIMMICH_ALL_TRUSTED_SHORTLIST_EVALUATION_RECEIPT_DIGEST: "a".repeat(64),
      CIMMICH_ALL_TRUSTED_SHORTLIST_PACK_ID: "sourcepack-lab-reviewed-v1",
      CIMMICH_RUNTIME_MODE: "production",
    },
    {
      CIMMICH_ALL_TRUSTED_SHORTLIST_ENABLED: "true",
      CIMMICH_ALL_TRUSTED_SHORTLIST_PACK_ID: "sourcepack-lab-reviewed-v1",
      CIMMICH_ALL_TRUSTED_SHORTLIST_EVALUATION_RECEIPT_DIGEST: "not-a-digest",
    },
    { DATABASE_URL: "sqlite:///tmp/cimmich.db" },
    { CIMMICH_RUNTIME_MODE: "preview" },
  ]) {
    assert.throws(
      () => loadRuntimeConfig(environment),
      (error) => error.code === "CIMMICH_CONFIG_INVALID",
    );
  }
});
