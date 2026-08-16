# Cimmich user guide

This is the detailed guide to what Cimmich can do and how the pieces fit
together from an archive owner's point of view. For a shorter visual
introduction, use the [product walkthrough](WALKTHROUGH.md). For installation,
updates, backups and removal, use [INSTALL.md](../INSTALL.md).

> [!IMPORTANT]
> This guide follows the **current development source**. The latest named
> public release is **Community Preview 9** for exact Immich 3.1.0. Features
> marked **Source current** were completed after Preview 9 and are not a promise
> that they exist in that release. Always install a named release rather than
> an arbitrary source snapshot.

## The product in one sentence

Cimmich is a local-first companion that keeps owner-controlled people,
identity evidence, pets, places, things, events, documents and archive-health
knowledge beside an existing Immich library without rewriting original media
or directly writing the Immich database.

The simplest mental model is:

- **Immich owns the library**: authentication, original photos and videos,
  thumbnails and its own metadata;
- **Cimmich adds the memory layer**: evidence, context, review decisions,
  presentation choices, documents and derived health information; and
- **you remain the authority**: software may propose, rank or explain, but a
  consequential identity or organisation decision needs an explicit owner
  action.

## Where to go for each job

| I want to…                                    | Open               | What happens                                                                                        |
| :-------------------------------------------- | :----------------- | :-------------------------------------------------------------------------------------------------- |
| See the shape of my memory library            | **Home**           | Featured media and bounded summaries lead into each Cimmich collection.                             |
| Browse or organise photos                     | **Library**        | The familiar Immich timeline opens with Cimmich context, filters and bulk tools.                    |
| Find, describe or correct a person            | **People**         | Browse people, review suggestions, inspect evidence and manage one Person.                          |
| Manage animals and unknown detections         | **Pets**           | Create Pet profiles, manage media and review Unknown or Ignored detections.                         |
| Describe where a memory happened              | **Places**         | Build geographic and named-location hierarchies, maps and journeys.                                 |
| Record an important object                    | **Things**         | Create vehicles, properties, devices, collectibles, equipment and other Things.                     |
| Group a trip, activity or life period         | **Events**         | Create overlapping memories, chapters, dates, participants and locations.                           |
| Keep records with the memories they explain   | **Documents**      | Import or reference documents, version them and link them to other subjects.                        |
| Find a known combination                      | **Smart Search**   | Intersect confirmed names, aliases, context and exact dates; search Documents separately.           |
| Understand duplicate or preservation evidence | **Archive Health** | Compare byte-exact copies and possible versions, with any keep recommendation beside the photos.   |
| Connect, tune or diagnose Cimmich             | **Settings**       | Manage the Immich connection, presentation profile, matching, optional providers and Guided access. |

## Navigation and viewing modes

Cimmich has two navigation profiles. They change presentation, not stored
truth.

- **Familiar companion** keeps Immich's normal navigation and adds an expanded
  Cimmich group. It is the Community Preview default.
- **Frontier workspace** gives Cimmich its own Home, Library and collection
  sidebar, with a clear switch back to Immich. It is useful when Cimmich is the
  main archive workspace.

The viewing-mode menu controls what is comfortable to show in the current
authenticated session:

- **Standard** shows Standard items;
- **Personal** adds Personal items; and
- **Private** adds Private items and may be protected by a local screen
  password.

The filter applies before protected names, covers, counts, search results,
relationships, Documents or photo media are presented. Private persists while
moving through related Cimmich and ordinary photo routes until it is exited or
locked according to the configured policy.

Private mode is not encryption, an access-control list, a second Immich account
or protection from the host administrator. It is a presentation boundary. See
the [privacy guide](../PRIVACY.md) and
[Private viewing operations](VISIBILITY_PRIVATE_OPERATIONS.md).

## First-run connection

After signing in with Immich, open **Settings → Connection and import**. Enter a
dedicated read-only Immich API key and preview the exact account, permissions,
library lanes and counts before confirming an import.

Cimmich imports a neutral inventory into its own database. It does not copy
original media into the source tree, rewrite sidecars or use the Immich
database as its own storage. If the scope is wrong, stop at the preview and fix
the key or selected lanes first.

The complete supported setup is in [INSTALL.md](../INSTALL.md). The in-product
screen is for connecting and refreshing an already installed companion; it is
not a substitute for backups or the operator lifecycle.

## Home

Home is an orientation surface, not an analytics dashboard. It loads the cover
media and bounded counts it displays rather than fetching every collection.

Use its cards to enter People, Pets, Places, Things, Events and Documents. A
featured Event can act as a visual front door into a story. Home cover settings
can use chosen photos or a bounded rotating set, with movement reduced when the
browser requests reduced motion.

If the library connection is incomplete, Home links directly to setup instead
of pretending that an empty archive is ready.

## Library and the photo viewer

**Library** opens the normal photo timeline with Cimmich's organisation context.
The source photograph remains Immich-owned; Cimmich adds controls and evidence
around it.

### Browse and narrow the library

Depending on the current surface, you can narrow media by Cimmich People,
Pets, Places, Things, Events, Tags and Labels, as well as ordinary media type,
favourite, album and timeline/archive state. Selecting several Cimmich tags is
an **intersection**: the result must carry every selected tag.

Bulk Organise previews its target set before writing. It can:

- apply Cimmich-owned Labels without writing source sidecars;
- preview folder-derived album names, edit them and refuse title collisions;
- create album membership in bounded, replay-safe batches; and
- undo only the changes made by that operation.

It never moves original files.

### Inspect one photo

Opening a photo from Cimmich preserves the collection context so previous/next
buttons, pointer controls and Left/Right arrow keys move through that projected
set. The Cimmich overlay can show accepted and proposed Face, Head, Body,
Presence, Pet and context evidence.

From the detail tools you can:

- inspect the exact region under review rather than relying on a full-photo
  label;
- rename or reassign a Face, create a new Person, mark it Unknown or mark it
  Not a face;
- classify a selected observation as **Face**, **Head** or **Body**;
- add or remove whole-photo Presence knowledge;
- correct saved rotation, capture date or Place in Cimmich's projection and
  undo the correction; and
- run bounded optional Local AI review on that photo or a small selection.

These actions write Cimmich truth and decisions, not source pixels or Immich's
database.

### File location and duplicate badges — Source current

Ordinary Cimmich photo cards and the viewer can show two distinct badges:

- **Exact copy** means complete-file SHA-256 evidence proves byte-for-byte
  equality; and
- **Possible version** means the files appear to be the same image or a related
  version, but byte evidence does not justify an exact-copy claim.

Selecting a badge opens the relevant photo-specific group in Archive Health so
you can see why it was classified that way. Each compared file shows its
containing folder. A bracketed count reports how many other photos in that
folder are flagged anywhere in the loaded duplicate review; selecting it shows
those groups. Selecting the path opens the browser-accessible folder with
Cimmich context intact. **Show in folder** also opens the browser-accessible folder
context; **Copy full path** copies the source path when the signed-in surface is
allowed to expose it. A web browser does not claim that it opened Finder or
another native file manager unless a real host mapping exists.

### Photo checks

Photo-detail review covers orientation, dates and locations. It belongs with
the Library/photo workflow, while identity checks belong with People. A review
item is an invitation to inspect, not proof that the photo is wrong.

## People

People is both a directory and a review workspace. It is built around a strict
distinction between an identified Person and the evidence that explains where
that Person appears.

### Browse the directory

The top-level views are:

- **People** — current named identities;
- **Suggestions** — People with matching work waiting;
- **Possible people** — recurring unnamed groups worth investigating; and
- **Needs attention** — identities deliberately marked for sorting or review.

You can search, sort by name or photo count, set a minimum photo count, filter
by relationship category and combine exact visibility, Tag, Label, Place,
Event and Thing filters. **Holding** is a child of Needs sorting: it records
that attention is needed, but does not lock the Person or disable matching.

### Understand one Person

A Person page provides several jobs without flattening them into one gallery:

- **Photos** — all currently visible accepted appearances, with Face, Body and
  Needs-check filters, ordinary selection actions and Year/Month/Week/Day
  grouping in current source;
- **Story** — the Person's owner-written profile and visual narrative;
- **Identity** — coverage, identity evidence, appearance evidence, review
  checks and display-photo choices;
- **With** — accepted same-photo People plus explicit and shared-context
  connections;
- **Places** — linked location context;
- **Signals** — descriptive supporting information; and
- **Maintenance** — names, category, subject type, merge and split operations.

Recorded/display name editing is owner-controlled. It can preserve former names
as aliases, refuses ambiguous collisions and does not rename unrelated Immich
records.

### Face, Head, Body and Presence

These are different claims:

| Evidence     | What it says                                                                                          | Matching authority                                     |
| :----------- | :---------------------------------------------------------------------------------------------------- | :----------------------------------------------------- |
| **Face**     | A usable face region represents this Person.                                                          | May support Cimmich matching when explicitly eligible. |
| **Head**     | The head is visible, but the observation should not be treated as a usable Face.                      | Excluded from face matching.                           |
| **Body**     | A body or appearance region represents this Person.                                                   | Does not become face-matching evidence.                |
| **Presence** | The owner knows the Person belongs to the photo without claiming visible Face, Head or Body geometry. | Does not train face or body matching.                  |

Identity Overview reports mutually exclusive operational coverage: Face
visible, Appearance only (Head or Body), and Presence only. It also shows a
year-by-year visual timeline, context coverage and frequent accepted
co-appearances. These are descriptive counts, not an identity-confidence or
archive-completeness score.

### Review matching work

Inside **Identity → Checks** the queues are separate:

- **New matches** are unaccepted observations that may be this Person;
- **Multiple in one photo** exposes competing regions from the same photo so
  the exact target can be compared; and
- **Possible mistags** combines two useful warnings: another Person appears to
  be a stronger fit, or this accepted Face is an obvious outlier against this
  Person's own confirmed Face set.

Possible mistags can still be the right Person but the wrong evidence type. Use
**Head** or **Body** for those cases. Other actions include confirming the
current Person, choosing another Person, searching the full Person list,
marking Unknown, marking Not a face and dismissing a review lead. Bulk actions
are bounded and show progress; a bulk choice still records the individual
decisions.

Matching scores and nearest examples explain why an item reached review. They
do not override the photo, the region or the owner's decision.

### Refresh matches — Source current

**Refresh matches** rechecks the normal pool for that Person using the current
qualified matching information. Before starting heavier work, it asks whether
that Person actually has either of the two extra review populations:

- observations already marked as **that Person's Heads**; and
- observations currently sitting in **that Person's Possible mistags** lane.

Only those Person-scoped items are added to the existing refresh pile. The
refresh does not scan every Head or every mistag in the archive, and it does
not accept a result automatically. A result that now matches returns to the
normal sorting pile for that Person.

### Split and Smart Split — Source current

Use **Split** when one Person record contains more than one real identity. You
can select shown Faces and move up to the displayed batch limit into an
existing or new Person.

**Smart Split** proposes only clearly separated Face-match groups from the
current compatible embedding lineage. Ambiguous, isolated or unsupported Faces
remain in **Unclear**. Recommendations never move a Face by themselves; inspect
a group, select the intended Faces and execute the move explicitly.

Use **Merge** when two Person records are the same real person. Preview the
effect first. Merge and supported unmerge operations are Cimmich decisions and
do not merge source files.

### Presentation photos

Identity Display lets the owner choose and frame a Face photo, Body photo and
Hero photo. A presentation choice changes how the Person is shown, not who is
accepted in the source photo. Current source may use unassigned Body geometry
that contains the Person's accepted Face for a Body presentation; that remains
display-only and does not invent a Body identity tag.

## Pets

Pets use stable owner-managed profiles rather than treating every detector
observation as a named animal.

### Pet profiles

Create a Pet with a display name and optional species, species label, breed,
aliases and description. The editable species choices are Dog, Cat, Bird,
Rabbit, Fish, Reptile, Small mammal and Other. Detector evidence remains
separate from the owner's desired recorded species.

A Pet profile brings together confirmed photos, review suggestions,
connections, Documents and owner-selected Face/Hero presentation media. You
can search, sort, edit, change presentation crops, attach/detach media and undo
supported decisions.

### Unknown and Ignored review — Source current

The Pets directory has three sibling views:

- **Pets** — named profiles;
- **Unknown** — unassigned animal observations needing a decision; and
- **Ignored** — observations deliberately put aside, where they remain visible
  and reversible.

For one or several selected Unknown items:

- **Assign** moves them to an existing compatible Pet or creates a new Pet;
- **Ignore** puts them in the Ignored view without declaring the detector
  wrong; and
- **False Match** rejects the animal detection.

Ignored items can be **Restored** to Unknown or marked **False Match**. New-Pet
assignment includes the editable recorded species instead of silently copying
the detector's guess. Bulk review is bounded and retry-safe.

Per-Pet matching suggestions remain proposals. **Confirm** or **Reject** is an
owner action, and supported decisions offer Undo.

## Places

Places answer both “where on Earth?” and “what named place inside that
geography?”

- **Geography** can represent points, areas, routes and unlocated regions.
- **Locations** can represent a home, venue, room or other place meaningful to
  the archive.
- Parent/child hierarchy supports countries, regions, towns, properties and
  subdivisions without forcing one flat list.

A Place can include Photos, Journey, Map, Plan, Connections and Documents.
Depending on its type you can add subdivisions, inspect child roll-ups, attach
or detach photos, build route stops, set an explicit cover and record geometry.
GPS-nearby photos can be offered as suggestions; proximity is evidence for
review, not an automatic Place tag.

Address lookup is an optional disclosed online path. Only the typed query is
sent to the configured service; library media and identity evidence are not.
The response preserves map attribution and distinguishes an exact address from
a broad result.

Archive hides a Place reversibly. Delete is a separate permanent logical
tombstone with an explicit choice about retained Cimmich asset tags; neither
action deletes source media.

## Things

Things record important objects such as vehicles, properties, devices,
collectibles and equipment. A Thing can have aliases, descriptions, an
explicit cover, Photos, Connections and Documents.

Use a Thing when the object itself is part of the memory record. Object
detections or region proposals remain evidence until reviewed; they do not
silently create named Things or relationships.

## Events

Events model overlapping memories rather than forcing every photo into one
folder. Types include trip, event, activity and life period. Dates can be exact,
month, year, approximate or unknown; recurring activities can record a
recurrence.

An Event can contain chapters or moments, link People, Pets, Places and Things,
attach photos in different roles and keep related Documents. The same photo may
belong to several Events when that matches real life.

Event dates and parent hierarchy help navigation and search. They do not alter
the photo's original capture time unless the owner separately records a photo
date correction.

## Documents

Documents are stable Cimmich records, not loose attachments and not an office
editor. You can:

- import a local file into Cimmich's separate content-addressed Document store;
- reference a visible photo or video already owned by Immich;
- set a title, type, issue date, expiry date and visibility tier;
- link one Document to People, Pets, Places, Things or Events with a typed
  relationship;
- link an existing Document from a subject page;
- edit metadata without replacing its bytes;
- create a new version while retaining the earlier edition; and
- preview safe formats, open in a new tab or download.

All Documents provides deterministic search over confirmed title, filename,
kind, dates and links. Basic Cimmich does not pretend to understand unextracted
document text. Imported Documents need both database and Document-store backup;
a database dump alone is incomplete.

See the [Document contract](DOCUMENT_V1.md) for quotas, supported types,
lifecycle and security behavior.

## Smart Search

Smart Search has two lenses:

- **Photos** searches confirmed Person and Pet names/aliases, Place/Thing/Event
  names and descriptions, plus exact ISO day, month or year selectors; and
- **All documents** searches confirmed Document metadata and links.

Photo selectors are intersected. A query such as “Maya at Bluewater in 2024”
returns media satisfying the recognized combination. The response explains the
selectors it used and lists unresolved terms rather than pretending that an
unsupported phrase was understood.

Basic Smart Search is deterministic, local and model-free. Optional semantic
or machine-assisted interpretation must remain a separate, disclosed layer and
cannot silently change confirmed Cimmich truth.

## Archive Health

Archive Health is an evidence and preservation workspace. It is deliberately
not a delete button.

### Exact copies

Exact groups require complete-file SHA-256 equality. They show copy paths,
sizes and relevant organisation details. Even exact bytes can have different
copy-local Immich People or Tags, so inspect what would be lost before removing
anything outside Cimmich.

### Possible duplicates

Similarity groups are classified as:

- **Different files** — complete hashes prove the files are not exact copies;
- **Exact copies** — complete hashes agree inside a similarity group; or
- **Needs verification** — at least one file lacks enough byte proof.

The comparison explains dimensions, file size, dates, metadata and Cimmich
evidence. A probable version can be a resize, edit, export or merely a strong
visual lead. Similarity alone is never deletion authority.

When evidence supports a preferred preservation candidate, it is marked on the
photo and explained in the same group. Ambiguous or byte-incomplete groups say
that no safe recommendation exists. Recommendations never change files.

### Backup proof

Archive Health distinguishes byte-verified media, independently protected
items and items still needing destination proof. Another file on the same disk
is not an independent backup.

## Settings, matching and optional providers

Settings separates ordinary product setup from optional machinery:

- **Connection and import** manages the read-only Immich relationship and
  inventory refresh;
- **Experience and viewing** controls Familiar/Frontier presentation, viewing
  defaults and Private behavior;
- **Enhanced matching** manages Cimmich's optional matcher component;
- **Face matching** runs governed recognition, SourcePack compilation,
  evaluation, review, activation and rollback;
- **Body evidence** configures optional body-observation production;
- **Local AI** enables bounded photo review/enhancement experiments; and
- **Guided access** exposes a separately authenticated, capability-bounded
  machine interface when deliberately enabled.

A provider produces observations. A SourcePack binds compatible provider,
vector, evidence and policy versions into an immutable reviewed matching input.
Activation requires evaluation; later accepted corrections create successor
work rather than mutating old evidence in place.

If the UI says the calibrated matcher is not ready, inspect provider, current
SourcePack and evaluation status instead of repeatedly starting the same run.
Matching remains useful only when its evidence lineage is compatible and its
review gate passed.

## What Cimmich will not do silently

Cimmich does not silently:

- modify original media bytes or source sidecars;
- write directly to the Immich database;
- accept a Person or Pet identity from a score;
- turn Body or Presence into Face-training evidence;
- merge or split identities from a recommendation alone;
- turn visual similarity into a duplicate-deletion instruction;
- expose higher-visibility names or media through a lower viewing mode;
- upload a library to a model provider as part of Core operation; or
- delete Immich when Cimmich is disabled or removed through the supported
  operator.

## When something looks wrong

1. Confirm the viewing mode; a lower mode can correctly hide media, names and
   counts.
2. Open the exact photo or evidence group rather than judging only a thumbnail
   label.
3. Check whether the item is a proposal, an accepted association or merely a
   presentation choice.
4. Use the visible retry or refresh control once. Repeatedly recreating the
   stack is rarely the right recovery path.
5. Run `./tools/companion.sh doctor` for a redacted operator report.
6. Use [INSTALL.md](../INSTALL.md) for lifecycle problems and
   [FAQ.md](FAQ.md) for common product boundaries.

When reporting a problem, use synthetic media where possible. Do not publish
real photographs, face crops, embeddings, credentials, source paths or private
library details.

## Related guides

- [Visual product walkthrough](WALKTHROUGH.md)
- [Installation and operations](../INSTALL.md)
- [Privacy guide](../PRIVACY.md)
- [Product architecture](PRODUCT_ARCHITECTURE.md)
- [Local AI review](LOCAL_AI_REVIEW.md)
- [Community Preview journeys](COMMUNITY_PREVIEW_JOURNEYS.md)
- [Frequently asked questions](FAQ.md)
