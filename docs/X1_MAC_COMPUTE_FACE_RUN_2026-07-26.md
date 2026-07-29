# X1 archive / Mac Buffalo-L recognition run — 2026-07-26

## Outcome

The Mac is now a proved, bounded compute worker for existing Cimmich Face
observations while X1 remains the only database and media authority.

The source-available backlog completed with:

- 2,433 X1-projected photos processed;
- 8,960 existing Face observations attempted;
- 2,449 chunks completed and recognized;
- 4,118 new 512-dimensional Buffalo-L embeddings committed;
- zero source-media writes;
- zero automatic identity authority;
- zero failed or nonterminal recognition jobs.

After the run, X1 held 32,705 active embeddings in the inherited
`private_insightface_buffalo_l` / `cimmich-target-centric-v2` recognition
space with configuration digest
`037d1dac67ec15e70c8751e4edb08d38e3f5dbb1d76b1b2803f48d811e559299`.

## Authority boundary

- Original media stayed on X1 and was read through the least-privilege,
  read-only Immich API.
- Cimmich database writes went directly to the X1 PostgreSQL authority through
  an SSH tunnel.
- Model artifacts and inference ran on the Mac.
- Media bytes were transferred in memory. No source path was sent to the
  provider and no external network access was permitted.
- Each provider result ran twice and had to replay exactly before commit.
- Recognition did not create or modify identity claims.

## Upgrades landed

- Existing-Face recognition now resolves the configured Immich source before
  joining an asset projection. This prevents a hash-reused asset with multiple
  active source projections from becoming ambiguous.
- The one-shot operator now drains older pending recognition work through a
  bounded loop until its own pipeline is terminal. This makes interrupted
  serial runs recoverable without hiding job history.
- A resumable backlog operator groups work by asset, chunks at 32 Faces, skips
  both exact-space embeddings and prior terminal abstentions, stops on the first
  error, and derives restart state from X1 rather than a Mac-only cursor.

The attempted four-worker optimization was rejected: workers claim a global
queue while each launcher has an asset-scoped companion, so parallel launchers
can claim one another's jobs. Database binding guards prevented crossed writes,
but the production backlog operator remains deliberately serial.

## Quality finding

4,118 of 8,960 attempted observations produced embeddings. The remaining
4,842 were terminal abstentions because the supplied box did not yield an
unambiguous target face under the target-centric crop policy.

This run improves recognition coverage for Faces that already exist. It does
not prove archive-wide Face detection. Buffalo-L also abstained on the earlier
extreme wide-shot replay, so broad new-Face discovery remains held pending a
higher-recall detection design and review cohort.

## Residual gap

There are 116 valid Face observations across 25 legacy assets with neither an
active exact-space embedding nor a prior terminal exact-space pipeline. None
of those assets has an active `x1-archive-immich` projection, so the worker
correctly excluded them. The source-available backlog is exactly zero.

## Proof

- Provider unit tests: 5 passed.
- Full service suite: 678 passed, 1 intentional skip.
- X1 reconciliation:
  - source-available backlog: `0 Faces / 0 assets`;
  - active exact-space embeddings: `32,705`;
  - exact-space failed jobs: `0`;
  - exact-space nonterminal jobs: `0`;
  - identity claims created during the run window: `0`.
