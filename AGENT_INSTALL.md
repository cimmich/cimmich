# Install and set up Cimmich with an AI assistant

This is the simplest supported installation path for a capable local assistant
such as Codex. The assistant may inspect commands, operate Docker and use a
local signed-in browser when available. The owner remains responsible for
authentication, secrets and the final import decision.

## Give this folder to the assistant

Use this prompt:

> Install and set up Cimmich from this extracted release folder. Follow
> `AGENT_INSTALL.md` exactly. Keep me in control of every secret and consequential
> choice. Complete the safe work you can, pause only when I must sign in, enter a
> secret locally or approve the exact import preview, then verify the finished
> installation.

## Non-negotiable boundaries

The assistant must:

- read this file and `INSTALL.md` before changing state;
- never ask for an API key, password or token in chat;
- never put a secret in command arguments, environment variables, logs or shell
  history;
- never use `sudo`;
- never modify, stop, restart, reset or remove Immich containers, its database
  or source media;
- never run a Cimmich remove, reset, restore or destructive lifecycle command;
- never import until the owner has seen and approved the exact preview;
- never install a model, enable Enhanced matching or activate a reference
  library unless the owner separately asks for it.

If a secret is required, the owner enters it directly into the local hidden
terminal prompt or Cimmich's write-only browser field. The assistant does not
read, repeat or store it.

## Agent workflow

### 1. Prove the release folder and computer are ready

From this folder, run:

```sh
./tools/install.sh --check
```

Explain any failed prerequisite in plain language. Do not work around a failure
with elevated privileges or by changing Immich. Continue only when the command
reports Docker and the installer ready.

### 2. Run the interactive installer

Run:

```sh
./tools/install.sh
```

Keep the command attached to an interactive terminal. Let the owner answer its
Immich-address, Private-view and final confirmation prompts. If a hidden Private
password prompt appears, the owner types it directly.

The installation is complete only when the installer reports healthy API,
database and web services and emits:

```json
{"schemaVersion":"cimmich.agent-install-handoff.v1","state":"installed","webUrl":"http://127.0.0.1:3413","nextAction":"signed_in_setup"}
```

If startup stops after configuration, inspect with
`./tools/install.sh --status`, explain the reported cause and use
`./tools/install.sh --resume` only after that cause is fixed.

### 3. Hand authentication to the owner

Open the emitted `webUrl` in a local browser. Ask the owner to:

1. sign in with their normal Immich account;
2. create a dedicated least-privilege Immich API key as described in
   `INSTALL.md`; and
3. paste it directly into Cimmich's write-only field.

The assistant must not inspect the key field, browser storage, request headers
or local credential files.

### 4. Verify the connection and preview

After the owner submits the key, the assistant may continue through the signed-in
interface or through Guided V2 if the owner has separately created an appropriate
Guided credential.

Verify:

- the expected Immich account and server;
- the supported Immich version;
- read-only asset, Face and Person permissions;
- the selected media and visibility lanes;
- the previewed media, People and unnamed Face-group counts; and
- that Locked remains excluded unless Cimmich explicitly proves an elevated
  interactive session.

Summarize the preview in plain language. Stop and ask the owner to approve that
exact scope. Do not treat a vague earlier request to “set everything up” as
approval to import an unknown library scope.

### 5. Import and prove the result

After explicit preview approval, start the import. Follow the resumable status
until it completes or reports a specific blocked state.

Then verify:

- Cimmich Core reports the imported media ready;
- Immich remains healthy;
- Cimmich still states that it is read-only toward Immich;
- unresolved imported identity groups appear in Review;
- technical import exceptions remain receipt history rather than automatic
  identity decisions; and
- no model, Enhanced component or SourcePack became active.

Report the final counts, any held Review work and the exact next optional action.
Installation and Core setup are complete at this point.

## Guided handoff

Guided V2 starts after Cimmich is running. Its bootstrap publishes the exact
connection, preview, import, resume, identity-resolution and verification
operations available to an authenticated client. It does not grant ambient
filesystem or Docker authority and therefore cannot perform step 1 or step 2.

Together, this runbook and Guided form one agent-led journey:

```text
release folder → installer → owner authentication → preview approval
→ Guided import/resume → verified Core
```

Optional recognition and matching are a separate owner decision after Core is
working.
