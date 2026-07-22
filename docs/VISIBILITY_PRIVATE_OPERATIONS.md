# Private viewing credential operations

Private viewing is Cimmich presentation protection. It is not encrypted storage,
an Immich access-control rule, a locked-folder replacement or a cryptographic
vault. Native Immich access remains Immich-owned.

**Immich provides the access security; this password only decides what is drawn
on screen.** It answers "someone is scrolling my photos next to me" and "the TV
is running a slideshow", not "keep this person out of my library". Anyone who
can sign in to Immich can already see everything, and switching to Immich shows
everything by design.

The lock is optional convenience inside an already authenticated Immich
installation. It is not Cimmich account authentication. Operators may choose
`password` with any non-empty local secret—including a one-character secret—or
`none` when changing view modes should not require a second prompt. Cimmich does
not impose password-complexity policy on this local preference.

## Owner path (default)

The signed-in owner manages this from **Settings → Private view password**: one
button to set it, reset it, or turn it off. Because it is a screen filter rather
than account security, a reset does not ask for the previous password—the caller
has already authenticated to Immich, and a forgotten filter password must not
become a permanent lockout with no recovery. Setting, resetting or removing it
ends any open Private session immediately.

That panel is owner-only. A Guided credential may present within its configured
ceiling but is refused with `VISIBILITY_CREDENTIAL_FORBIDDEN` on
`/v1/visibility/credential`.

## Production boundary

- Production startup never seeds a password from an environment variable.
- `CIMMICH_VISIBILITY_PRIVATE_LOCK_MODE=password` uses the configured scrypt
  verifier. `CIMMICH_VISIBILITY_PRIVATE_LOCK_MODE=none` makes Private available
  to an already-bound interactive Cimmich principal/device without a second
  credential. Ambient requests and Guided V1 remain Standard; Guided V2 may use
  a user-granted Personal/Private session only up to its configured visibility
  ceiling.
- `CIMMICH_VISIBILITY_TEST_MODE` is accepted only when
  `CIMMICH_RUNTIME_MODE=acceptance`; any other runtime fails startup.
- The operator command accepts a password only through standard input. It does
  not accept a password argument or password environment variable and never
  prints the supplied value.
- PostgreSQL stores a random salt and scrypt verifier. Plaintext is not stored.
- Configure, rotate and remove are audited. Rotation or removal invalidates an
  existing Private session on its next Cimmich request.
- Failed unlocks are bounded per principal, survive device-ID rotation and
  receive a typed 429 response during exponential backoff. Concurrent scrypt
  work is capped to keep failed local prompts from exhausting the service.

## Operator commands (fallback)

Use these for headless installs, scripted provisioning, or recovery when the web
UI is unavailable. The Settings panel above is the normal path.

Run from `service/` with `DATABASE_URL` set for the separate Cimmich database.
Supply the chosen local view-lock string from standard input; do not put it in
shell history. The command accepts any non-empty string.

```sh
trusted-secret-command | npm run visibility-credential -- configure --password-stdin
npm run visibility-credential -- status
trusted-secret-command | npm run visibility-credential -- rotate --password-stdin
npm run visibility-credential -- remove --confirm-remove
```

Use `--principal ID` and `--actor ID` only when the local deployment has an
explicit non-default principal/actor mapping. The default principal is
`local-primary`.

After first configuration, query `/v1/visibility/status` from the intended
principal/device and verify `privateConfigured: true` before relying on the
Private control. After removal, verify it returns false and that an old opaque
session token fails with `VISIBILITY_PRIVATE_SESSION_EXPIRED`.

For an intentionally passwordless installation, set lock mode `none` and query
status to verify `privateLockMode: "none"`. Removing a verifier is not by itself
the passwordless setting: lock mode remains an explicit operator choice.

The opaque Private token belongs only in process/module memory. It must not be
placed in localStorage, sessionStorage, cookies, URLs or logs.
