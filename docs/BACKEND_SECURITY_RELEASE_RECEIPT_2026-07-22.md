# Cimmich Backend Security Release Receipt — 2026-07-22

Status: **security/backend integration-ready at schema 75**. No live, main,
private, or public-demo runtime was changed by this audit.

## Closed findings

- Dependency policy now pins GitHub Actions by immutable commit and audits the
  service, web workspace, and every provider requirements file. The current
  npm and pnpm graphs report zero known advisories; all directly pinned Python
  provider requirements report zero known advisories.
- Immich and Photon response bodies are streamed under hard byte caps and
  timeouts before allocation. Stable path-free errors replace upstream bodies.
- Database credentials are rejected on the Document lifecycle command line and
  synthetic database operations pass credentials through the environment.
- Companion backup/restore now verifies checksums, manifest/project/schema
  identity, semantic counts, archive path/type safety, credential shape, and a
  migrated isolated restore before replacing owner state. Seven adversarial
  restore cases leave the running database and counts unchanged.
- Runtime images are pinned, API containers drop capabilities and set
  no-new-privileges, the UI runs unprivileged, and browser responses add the
  bounded security headers supported by this local product shape.
- Fresh Immich onboarding now proves the exact read-only permission set and
  truthfully previews a named Person plus an unnamed Face cluster. The named
  Person imports once; the unnamed cluster is held for explicit owner
  resolution without a blank Person or inferred identity.
- Local `.env` files, provider bytecode, model weights, credentials, and runtime
  state are excluded from product build contexts. Generated provider bytecode
  found during the audit was removed.

## Changed paths

- `.github/workflows/ci.yml`
- `SECURITY.md`
- `docs/DOCUMENT_LIFECYCLE_COMPATIBILITY_V1.md`
- `ops/stock-immich-v3.0.3.compose.yml`
- `providers/perceptual-dhash/requirements.txt`
- `service/acceptance/bootstrap-stock-immich.mjs`
- `service/bin/document-lifecycle.mjs`
- `service/src/address-geocoding.mjs`
- `service/src/immich-companion.mjs`
- `service/src/immich-onboarding.mjs`
- `service/test/address-geocoding.test.mjs`
- `service/test/immich-companion.test.mjs`
- `service/test/immich-onboarding.test.mjs`
- `service/test/security-hardening.test.mjs`
- `tools/background-lab.compose.yml`
- `tools/cimmich_gateway.conf.template`
- `tools/cimmich_ui.Dockerfile`
- `tools/companion.compose.yml`
- `tools/companion.sh`
- `tools/companion_acceptance.sh`
- `tools/public_demo.compose.yml`
- `tools/public_demo.sh`
- `tools/public_demo_nginx.conf`
- `tools/run_synthetic_acceptance.sh`
- `ui/pnpm-lock.yaml`
- `ui/pnpm-workspace.yaml`

## Same-checkout proof

- Focused security/onboarding/operator tests: **51/51**.
- Full service tests: **594/594**.
- Web: format, ESLint, Svelte (**0 errors, 0 warnings**), TypeScript, and
  production build passed. Full Vitest is **764 passed / 1 failed / 2 skipped**;
  the failure is one unrelated stale
  Context-layout source assertion in
  `ui/web/src/lib/components/cimmich/context-profile-layout.spec.ts`; this
  security batch did not change the UI source or test.
- Dependency audit: npm **0**, pnpm **0**, directly pinned Python provider
  packages **0 known vulnerabilities**.
- Migration runner: **PASS**, schema 75 fresh/concurrent/checksum/resume/
  legacy-restore/new-write enforcement.
- Full synthetic acceptance: **PASS**, schema 75, including onboarding,
  Guided, provider/operator, Enhanced lifecycle and rollback, restart, and
  backup/restore.
- Fresh stock Immich 3.0.3 companion lifecycle: **PASS** — exact read-only
  connection, named import, unnamed owner hold, replay, stop/restart,
  backup/restore, seven hostile restore cases, disable/remove, zero residue.
- Public-demo disposable operator lifecycle: **PASS** — pristine start,
  stop/start/restart state preservation, volume continuity, schema 74→75
  restore, malformed/newer/wrong-project/corrupt/count-drift rejection,
  explicit reset/destroy, process/log/inspect secret scan, zero residue.
- Guided catalogue: **95** canonical operations.
- Migration digests:
  - 0074: `0f16d9b7ca499690650bc5fe7f96ef615c62e783584c13ae127bd4574e893d32`
  - 0075: `37187ca60c06d16b96978c6f9dfb8d6bd07a573f435eda3137a84fcb07282e85`

## Accepted residual boundaries

- Cimmich's direct API remains a loopback, single-owner surface; attribution
  headers are not remote authentication. Remote or multi-user exposure still
  requires a trusted TLS/authentication proxy and deployment-specific access
  controls.
- Online address search intentionally discloses the bounded typed query to the
  configured Photon service; queries are not persisted or logged by Cimmich.
- Optional local provider processes and owner-supplied model artifacts remain a
  trust boundary. Models are not bundled and subprocess isolation is not an OS
  sandbox.
- Advisory scans establish no _known_ dependency vulnerabilities at audit time;
  they are not a proof that vulnerabilities cannot exist.
- This receipt claims no representative matcher accuracy, automatic identity,
  training, or automatic activation authority.

## Freeze disposition

The backend/security delta is complete and may be frozen. A repository-wide
release freeze should wait for the UI owner to reconcile the single stale
Context-layout test assertion noted above; no backend/security change is needed
for that failure.
