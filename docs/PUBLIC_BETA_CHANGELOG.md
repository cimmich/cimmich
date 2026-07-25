# Cimmich Public Beta changelog

This changelog records maintained-product work after the immutable
`v1.0.0-build-week` submission. It does not revise or expand what was submitted
for OpenAI Build Week.

## v1.0.1-beta.6 — People review, real matching operations and Pets

This is a substantial public-beta update focused on making the product's
identity machinery understandable and operable by an archive owner.

### People and identity review

- People opens on the People directory rather than Suggestions.
- Category filtering is single-choice; People and workflow controls are
  visually separated.
- Sorting is explicit: photo count or name, with direction and active-state
  indicators.
- Person profiles use a dossier-style Details view and a clearer Identity
  workspace split into confirmed Face evidence, Head/Body/Presence appearance,
  Display photos and Review.
- Display Face, Body and Hero images are selected and reframed in place. Saved
  framing is reused by profile and directory consumers.
- New-match review shows only the unresolved face, supports bulk selection and
  offers explicit confirm or reassignment. `Not <name>` opens a bounded
  replacement picker instead of silently discarding the face.
- Possible mistags can be confirmed, marked as non-matching Head evidence or
  reassigned to a closest or typed Person.
- The People Suggestions page separates suggestions for known People from
  recurring unnamed-face groups. Possible People are ordered by recurrence and
  retain time/location context without being presented as already tagged.

### Matching machinery and maintenance

- Full-library identity audits are durable, resumable and provenance-bound.
  Untagged candidates and accepted identities worth checking remain separate
  review queues.
- Same-photo derivatives cannot masquerade as independent reference evidence.
- SourcePack rebuilds expose safety and coverage results; a worse successor is
  held inactive rather than replacing the known pack.
- Imported `Name 2`-style metadata retains its source locator as unresolved
  owner work instead of being silently converted to Presence. Saving the
  owner's Face, Head, Body or Presence correction resolves that locator
  atomically.
- Maintenance now reports the actual provider, processing and SourcePack state
  and keeps model output separate from identity authority.

### Pets

- Pet Display Face, Body and Hero framing now uses the same saved crop in
  editors, cards and profile heroes.
- Optional PetFace and MiewID adapters are supplied as weight-free,
  user-configured provider examples. Their model weights and licences remain
  the operator's responsibility.
- Pet matching is species- and vector-space-bound, review-only and allowed to
  abstain.
- The Pets index has a global Unknown Pets workspace. It shows the exact
  detector region and lets the owner assign a known same-species Pet or reject
  only the incorrect species observation. A model proposal never creates Pet
  identity evidence by itself.

### Installation and safety

- Guided installation, agent-led setup and maintenance wording are clearer for
  operators who are not Docker or model experts.
- The Build Week tag, release, assets and evaluation route remain unchanged.
- Cimmich still writes only its separate database; it does not directly write
  Immich's database or original media.
- No model weights, private archive data, active private SourcePack or claimed
  representative biometric-accuracy result are included.

## Earlier public-beta patches

- `v1.0.1-beta.5`: beginner install bundle and guided setup documentation.
- `v1.0.1-beta.4`: one-time historical embedding repair.
- `v1.0.1-beta.3`: truthful face-processing progress.
- `v1.0.1-beta.2`: restored public-beta face processing.
- `v1.0.1-beta.1`: first maintained Public Beta after Build Week.
