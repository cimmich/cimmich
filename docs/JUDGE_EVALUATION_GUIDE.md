# Judge evaluation guide

This is the shortest path through Cimmich for a human judge or an automated
reviewer. It is intentionally an index, not another product narrative.

## What to open first

1. Read the root [README](../README.md) for the problem, product boundaries and
   five-minute journey.
2. Follow [Try Cimmich](../README.md#try-cimmich) for the isolated synthetic
   demo. It does not require a private photo library.
3. Read the [Build Week evidence index](BUILD_WEEK_EVIDENCE.md) for what existed
   before the event, what was built during it and where each claim is proved.
4. Read [release readiness](RELEASE_READINESS.md) for the exact tested boundary
   and held claims.
5. Read [privacy](PRIVACY_BOUNDARY.md) only if you need the data-flow and trust
   model in detail.

## The product in one minute

Cimmich is an unofficial, open-source, local-first companion for Immich. It
keeps a memory library complete without forcing weak observations into face
matching. A person can be present through distinct Face, Head, Body or Presence
truth; only suitable Face evidence can participate in matching, and only the
archive owner can accept identity.

Core is useful without a model. Enhanced matching is included but
owner-disabled until configured. Evidence providers and Guided clients are
optional and separate. Cimmich stores its state in its own PostgreSQL database
and has no direct write path to the Immich database or source media.

## Fastest working-product test

From a clean checkout:

```sh
curl -fLO https://github.com/cimmich/cimmich/releases/download/v1.0.0-build-week/cimmich-cedar-house-v1.tar.gz
expected_sha256=937b5859635af6f1b775dcbab1e28411b2e6f4a6182b72e003e3ccdda455347f
if command -v sha256sum >/dev/null 2>&1; then
  actual_sha256=$(sha256sum cimmich-cedar-house-v1.tar.gz | awk '{print $1}')
else
  actual_sha256=$(shasum -a 256 cimmich-cedar-house-v1.tar.gz | awk '{print $1}')
fi
test "$actual_sha256" = "$expected_sha256"
tar -xzf cimmich-cedar-house-v1.tar.gz
export CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT="$PWD/cedar-house-v1"
./tools/public_demo.sh up
./tools/public_demo.sh status
```

Expected pristine semantic state:

```text
51:9:12:5:4:0
```

That tuple means 51 assets, 9 Person/Pet subjects, 12 context entities, 5
Documents, 4 active manual typed tags and 0 active SourcePacks. The operator
prints the loopback URLs and keeps generated credentials in mode-`0600` local
state rather than documentation or logs.

Use `./tools/public_demo.sh down` to remove containers while preserving the
demo state. Use the exact confirmation-scoped reset or destroy command described
in the Cedar House guide only when you intend to remove state.

## Product journey to inspect

- Open People and follow the Cedar House cast across Face, Head, Body and
  Presence evidence. To put all four on Maya, complete the additive Space Trip
  Guided journey; that result is deliberately not pre-seeded.
- Open one photo and switch between People and Context without changing the
  underlying image.
- Move through a related Pet, Place, Thing, Event and Document.
- Use Smart Search across names, aliases, dates and context.
- Compare Standard, Personal and Private presentation.
- Open Models & Guided and confirm that optional machinery is separate from
  owner truth and that automatic identity is absent.
- Inspect decision history and Undo for a consequential owner action.

The Cedar House bootstrap seeds curated Cimmich truth separately from Immich's
own face-cluster labels. The first-run inheritance preview may therefore show
unnamed upstream Immich groups even while Cimmich People are already populated;
those groups are an optional import exercise, not missing Cedar House identity.

## How the submission maps to the judging criteria

| Criterion                    | Inspect                                                                                                            |
| :--------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| Technological Implementation | Migration-led data plane, typed evidence, replay/conflict/Undo, visibility-first queries, lifecycle operators      |
| Design                       | Photo-led People/Pet/context journeys, progressive machinery, cumulative viewing modes and responsive UI           |
| Potential Impact             | Complete memory records without polluting matching, local ownership, optional providers and a reusable demo pack   |
| Quality of the Idea          | Face/Head/Body/Presence authority split, owner-only identity and one product that remains useful without AI models |

## Build Week and Codex

Cimmich began from a disclosed private Immich-derived research seed. The public
[Build Week changelog](BUILD_WEEK_CHANGELOG.md) separates that inherited work
from the service, product, operators, Guided contract, synthetic archive and
proof program built during the event.

Codex powered by GPT-5.6 Sol was used for product challenge, architecture,
implementation, testing, browser operation, defect routing and release work.
It also operated Cimmich through Guided V2 to add and organise the six-image
Space Trip extension from the published machine-readable contract. GPT-5.6 is
not a required runtime dependency and receives no automatic identity authority.

## Exact released boundary

```yaml
releaseTag: v1.0.0-build-week
supportedImmich: 3.0.3
schema: 75
patchLevel: 1
serviceTests: 595/595
webTests: 768 passed / 2 skipped
visibilitySurfaces: 17/17
publicDemoAssets: 57
activeSourcePacks: 0
automaticIdentityAuthority: none
```

The two extra synthetic scenes in the keeper recording runtime are film-only;
they are not silently added to the 57-asset public download. The demo proves
product behavior, not representative biometric accuracy, fairness or suitability
for another person's archive.
