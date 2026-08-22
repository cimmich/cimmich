# Cimmich user guide

This is the detailed repository reference for what Cimmich can do and how the
pieces fit together from an archive owner's point of view. For a friendly
visual introduction with exact tasks, open the
[Cimmich Guide](https://benjihagenhart.com/cimmich/guide/). For installation,
updates, backups and removal, use [INSTALL.md](../INSTALL.md).

> [!IMPORTANT]
> This guide follows the **Community Preview 21 candidate**, schema 156/patch 1,
> for exact Immich 3.1.0. Community Preview 18 remains immutable at schema 142.
> Always
> install a named release rather than an arbitrary source snapshot.

## The product in one sentence

Cimmich is a local-first memory layer whose matcher improves from confirmed and
corrected Face evidence, while keeping People, Pets, Places, Things, Events,
Documents and archive-health knowledge beside Immich.

The simplest mental model is:

- **Immich owns the library**: authentication, original photos and videos,
  thumbnails and its own metadata;
- **Cimmich adds the memory layer**: evidence, context, review decisions,
  presentation choices, documents and derived health information; and
- **you remain the authority**: software may propose, rank or explain, but a
  consequential identity or organisation decision needs an explicit owner
  action.

## Where to go for each job

| I want to…                                    | Open               | What happens                                                                                             |
| :-------------------------------------------- | :----------------- | :------------------------------------------------------------------------------------------------------- |
| See the shape of my memory library            | **Home**           | Featured media and bounded summaries lead into each Cimmich collection.                                  |
| Browse or organise photos                     | **Library**        | The familiar Immich timeline opens with Cimmich context, filters and bulk tools.                         |
| Follow connections across the archive         | **Discover (Experimental)** | Opt in to the mid-build memory web, then see which People appear together and which photos, Events, Places or Things explain each connection. |
| Find, describe or correct a person            | **People**         | Browse people, review suggestions, inspect evidence and manage one Person.                               |
| Manage animals and unknown detections         | **Pets**           | Create Pet profiles, manage media and review Unknown or Ignored detections.                              |
| Describe where a memory happened              | **Places**         | Build geographic and named-location hierarchies, maps and journeys.                                      |
| Record an important object                    | **Things**         | Create vehicles, properties, devices, collectibles, equipment and other Things.                          |
| Group a trip, activity or life period         | **Events**         | Create overlapping memories, chapters, dates, participants and locations.                                |
| Keep records with the memories they explain   | **Documents**      | Import or reference documents, version them and link them to other subjects.                             |
| Find a known combination                      | **Smart Search**   | Intersect confirmed names, aliases, context and exact dates; search Documents separately.                |
| Understand duplicate or preservation evidence | **Archive Health** | Compare exact copies, possible duplicates, folders, likely rotation candidates or an independent backup. |
| Connect, tune or diagnose Cimmich             | **Settings**       | Manage the Immich connection, presentation profile, matching, optional providers and Guided access.      |

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

## Discover (Experimental)

**Discover** and the related Person memory webs are useful but still mid-build,
so Community Preview 21 keeps them off by default. Open **Settings → Cimmich
experience** and choose **Show Discover** to opt in. The choice is local to that
browser and reversible; hiding Discover clears the current web projection but
does not delete any recorded relationship facts. A direct Discover URL shows
the same honest enable prompt instead of silently opting in.

Once enabled, Discover opens directly onto the current bounded web. Switch between Overview, People &
bonds, Places and Recorded lenses; search or filter memory types; choose
Compact, Balanced or Roomy spacing; then pan, zoom, fit or drag individual
memories into a useful arrangement. Labels appear progressively as you zoom or
inspect local context. **Lines** controls topology and **Relationships** adds
collision-aware recorded Person labels along their lines.

Select a memory to inspect its evidence, focus on its immediate neighbourhood,
or trace the shortest visible path to another memory. **Insights** opens useful
calculated starting points and strongest visible connections only when wanted;
the same on-demand rail keeps selected connections and path steps readable
without permanently shrinking the canvas.

The web joins visible People, Pets, Places, Events and Things. Solid lines are
recorded relationships or hierarchy; dashed lines are accepted shared-photo
evidence. Shared photos remain evidence of connection, not a manufactured
relationship claim. Circular nodes represent People, Pets, Places and Things;
discrete Events use diamonds, while time-spanning Life periods use labelled
outlines around their members. The outline replaces participant spokes so the
period reads as shared context rather than another point. Discover reads one
privacy-projected graph and creates no new durable truth.

### Describe a Person's connections

Open a Person and choose **Connections**. Select **Describe connection** on a
Person or Place card to record what the connection means. Person choices include
Partner, Boyfriend, Girlfriend, Best friend, Friend, Enemy, Co-worker and Family.
Every Person label, including one you create, offers **Former** as a modifier
with optional From/To dates. You can create and reuse other modifiers such as
**Childhood** or **School**, and apply several to one fact. Place choices include Works/Worked here, Lives/Lived
here, Studies/Studied here, Born here and Visited. Place connections retain
their Current/Past choice. A connection may include a private note. **Create
your own** adds a reusable directional label when the built-in catalogue does
not fit. A connection can carry more than one fact.

When describing a connection between two People, **Linked context** can name an
existing Place, Event, Life period, Trip, Activity or Thing where or during
which that relationship applied. Search and select **Cedar House**, for
example, to record **Housemate (Former) @ Cedar House**. The context is not a
modifier: it is the shared hub that can connect several People and remains
independently unlinkable without removing the Housemate fact. The context page
then shows both People and Discover can group the reviewed relationships around
that hub. Cimmich does not infer a Person-to-Place fact from this link.

Recorded facts appear on the Person and feed Discover. Cimmich may also show a
**Possible connection to confirm** when existing facts form a useful lead. For
example, if two People are recorded as co-workers and one has a recorded past
workplace, Cimmich can offer that workplace to the other Person. The card names
the facts behind the lead. **Confirm** records it; **Dismiss** hides that exact
lead. Until Confirm is chosen, it is not relationship truth and does not enter
the graph as a recorded fact.

Switch Connections from **List** to **Web** to arrange, pan and zoom the
Person's local memory graph. **People** is the default view: only People are
points, so a Place or Life period cannot masquerade as another Person. Separate
view buttons appear for the context types that actually exist — Life periods,
Events, Trips, Activities, Places and Things. In a context view People remain
points while the selected context type becomes a labelled enclosure around its
visible members. Contexts with the same members nest rather than drawing over
one another. A persistent **In this web** rail contains only the types relevant
to the active view and keeps its members available as direct jump targets.
These views filter the same visibility-projected graph used by full Discover;
they do not create a second Person-only source of truth. The full exact labels
remain available in the connection rail either way.

Inside the expanded **People** section, choose **Add several** to author a
shared Home, Employer or Group. Create a new hub or select an existing one,
choose several People, then assign each Person's role, Current/Former state,
optional dates and reusable modifiers. The review step submits the complete set
once. Cimmich records every reviewed row in one transaction, or records none if
any row is invalid.

## First-run connection

After signing in with Immich, open **Settings → Library connection**, then
choose **Connect your existing Immich library**. Enter a dedicated read-only
Immich API key and preview the exact account, permissions, library lanes and
counts before confirming an import.

Cimmich imports a neutral inventory into its own database. It does not copy
original media into the source tree, rewrite sidecars or use the Immich
database as its own storage. If the scope is wrong, stop at the preview and fix
the key or selected lanes first.

The complete tested setup path is in [INSTALL.md](../INSTALL.md). The in-product
screen is for connecting and refreshing an already installed companion; it is
not a substitute for backups or the operator lifecycle.

### Optional Immich features Cimmich can reuse

These are not Cimmich matching or import prerequisites. Immich **Smart Search**
can supply visual-search, similar-photo and bounded Rotation review leads;
**Duplicate Detection** can supply native possible-duplicate groups to Archive
Health; and **OCR** can supply text for summaries, Documents and search. Enable
only the capabilities you want Cimmich to reuse. Immich Facial Recognition can
remain off because Cimmich handles identity separately; enable it only if you
also want Immich's People matching.

For an existing library, open Immich **Administration → Jobs** and run
**Missing** in this order: **Smart Search → Duplicate Detection → OCR**. Wait
for each queue to reach zero before starting the next one. This is an Immich
dependency: Smart Search must finish first because Immich Duplicate Detection
consumes its image embeddings. If the two were started together, run
**Duplicate Detection → Missing** again after Smart Search finishes. Use
**All** only after changing the relevant Immich model or processing
configuration. New assets enter Immich's enabled processing queues
automatically. None of these jobs prepares Cimmich face matching.

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

The photo viewer uses one top bar. Privacy is the first control at the left;
its dropdown distinguishes **what you can currently see** from the saved
visibility of **this photo**, so the two scopes are available without two
competing lock icons. People, Context, Summary, duplicate evidence, file location and
optional Local AI use matching icon controls centred in the space before the
ordinary Share, Zoom, Download, Info and other Immich actions. Icon tooltips
appear promptly rather than making the owner wait to identify an unfamiliar
control.

From the detail tools you can:

- inspect the exact region under review rather than relying on a full-photo
  label;
- rename or reassign a Face, create a new Person, mark it Unknown or mark it
  Not a face;
- classify a selected observation as **Face**, **Head** or **Body**;
- add or remove whole-photo Presence knowledge;
- correct saved rotation, capture date or Place in Cimmich's projection and
  undo the correction; and
- open **Summary** for an instant Standard view or configured Smart/Enhanced
  local analysis;
- run bounded optional Local AI review on that photo or a small selection.

These actions write Cimmich truth and decisions, not source pixels or Immich's
database.

Standard Summary uses current People, Context, date, place and OCR without a
model, and describes the photograph rather than reporting review work. Face and
Body review counts remain in the relevant People/QC controls. Smart favours a
fast local visual pass plus review-only QC leads. Its stored facts are composed
with current names, Context, place and date into natural prose; repeated labels
and low-value classifier categories are suppressed without rerunning Smart.
Enhanced is the heavier initial interpretation. It keeps the model's useful
relationships while resolving current Person and named-object truth inside the
prose and weaving Place, Event and date naturally. Both model tiers retain
structured facts, so later names and Context update without another visual run.
On a Mac Local AI worker, Smart selects Apple Vision by default and downloads
no model. Self-hosters can replace it with a compatible local model; Cimmich
shows which provider produced each result and applies the same validation to
all of them.
The editable **Custom** option remains separate and can never be overwritten by
a generated summary. Use Standard, Smart or Enhanced as a starting point, edit
the imported text and save when ready. Beneath every option, the separate
**OCR** section shows Immich's existing extracted text in reading order without
starting another scan. See [Photo summaries](SUMMARIES.md).

### File location and duplicate badges

Ordinary Cimmich photo cards and the viewer can show two distinct badges:

- **Exact copy** means complete-file SHA-256 evidence proves byte-for-byte
  equality; and
- **Possible version** means the files appear to be the same image or a related
  version, but byte evidence does not justify an exact-copy claim.

Selecting a badge opens the relevant photo-specific group in Archive Health so
you can see why it was classified that way. Each compared file shows its
containing folder. A bracketed count reports how many other photos in that
folder are flagged anywhere in the loaded duplicate review; selecting it shows
those groups. **Open folder** explains that a browser cannot open the native
file manager on the remote library host, then offers **Open folder view** to show the
containing directory in Cimmich or **Close** to remain on the photo. **Copy full
path** copies the source path when the signed-in surface is allowed to expose
it. Cimmich never claims that Finder or another native file manager opened
unless a real host mapping exists.

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

- **People** - current named identities;
- **Suggestions** - People with matching work waiting;
- **Possible people** - recurring unnamed groups worth investigating; and
- **Needs attention** - identities deliberately marked for sorting or review.

You can search, sort by name or photo count, set a minimum photo count, filter
by relationship category and combine exact visibility, Tag, Label, Place,
Event and Thing filters. **Holding** is a child of Needs sorting: it records
that attention is needed, but does not lock the Person or disable matching.

### Understand one Person

A Person page provides several jobs without flattening them into one gallery:

- **Photos** - all currently visible accepted appearances, with Face, Body and
  Needs-check filters, ordinary selection actions and Year/Month/Week/Day
  grouping in current source;
- **Identity** - coverage, identity evidence, appearance evidence, review
  checks and display-photo choices;
- **Details** - names, aliases and the owner-written profile, including your
  own reusable relationship labels created in **At a glance**;
- **Connections** - linked People, Events, Places and Things. **Add to** sits in
  the main Person tab bar and can choose an existing context or create and
  connect a new Event, Life period, Trip, Activity, Place or Thing without
  leaving the Person. Each connection type heading is a disclosure control, so
  long sections can be independently opened or closed. **Connect people
  through…** creates or selects a shared Home, Employer or Group and records
  several People's reviewed roles in one atomic confirmation; and
- **Documents** - records connected to the Person.

To describe a Person-to-Person connection, choose a built-in label such as
Partner, Boyfriend, Girlfriend, Best friend or Co-worker, or create your own.
Add **Former** when that relationship belongs in the past. Cimmich then
records and displays the historical form, such as **Partner (Former)** or
**Housemate (Former)**, with optional from/to dates. **Former** is a state, so
there is no separate **Ex** label. Other reusable modifiers stay attached to
their relationship in brackets—for example, **Friend (Childhood)** or
**Friend (Childhood, School)**—without creating a new relationship type. The
middle dot separates distinct facts, such as **Friend (Childhood) · Housemate
(Former)**. Person-to-Place connections retain their
Current/Past choice for meanings such as Works here and Worked here.

Use the **Add** control inside Places to connect a Place that is not already on
the Person. The existing-Place and relationship fields are searchable: start
typing a Place such as a home or employer, choose the intended result, then
choose meanings such as Lives here, Worked here or Visited. This records a
Person-to-Place connection fact; it does not make the Person an Event
participant.

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

### Refresh matches

**Refresh matches** rebuilds that Person's Core matching set from current
confirmed Face evidence, then searches again using the current calibrated
matching policy. New possibilities return as review work; Refresh never accepts
an identity automatically.

Before starting heavier work, Refresh asks whether that Person actually has
either of the two extra review populations:

- observations already marked as **that Person's Heads**; and
- observations currently sitting in **that Person's Possible mistags** lane.

Only those Person-scoped items are added to the existing refresh pile. The
refresh does not scan every Head or every mistag in the archive, and it does
not accept a result automatically. A result that now matches returns to the
normal sorting pile for that Person.

### Split and Smart Split

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

### Unknown and Ignored review

The Pets directory has three sibling views:

- **Pets** - named profiles;
- **Unknown** - unassigned animal observations needing a decision; and
- **Ignored** - observations deliberately put aside, where they remain visible
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
After choosing a cover, use **Frame cover** on the hero to drag the photo and
zoom it against the final wide banner before saving. The framing belongs to the
Place record; it does not crop or edit the underlying Immich or source photo.
**Add media** can select from human-readable source **Folders**, existing Immich
**Albums**, recent visible **Library** media and, for a located Place, **Nearby**
GPS media. Folder and Album selection is explicit and bounded; trashed, offline
or privacy-hidden items are excluded before selection. Opening a Folder or
Album shows its visible images without selecting any of them. Choose individual
images, or deliberately use **Select all visible**; nothing is attached until
the final Add media confirmation.
**Add media → Nearby** offers 100 m, 500 m, 2 km, 10 km and 50 km views. Results
inside the chosen distance come first; when that would leave the picker sparse,
the closest visible GPS-tagged photos beyond the limit remain available and are
labelled with their distance. Proximity is evidence for review, not an
automatic Place tag.

After selecting photos already assigned directly to a Place, **Organise → Move
to another Place** searches for a destination, attaches the selection there and
removes its current Place assignment. That Cimmich operation leaves GPS
unchanged. **Photo details → Update GPS from Place** is a separate explicit
operation: choose a searchable Place with point geometry to write its
coordinates to the selected Immich assets. It changes Immich metadata, not the
source files.

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
explicit cover, Photos, Connections and Documents. **Frame cover** pans and
zooms the selected photo for the wide hero without editing the media itself.

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
be part of several memories. Event, Trip, Activity and Life-period heroes use
the same **Frame cover** editor, so a portrait or square source can be positioned
and zoomed for the wide banner without changing the original photo.
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

Smart Search has three separate lenses:

- **Recorded facts** searches confirmed Person and Pet names/aliases,
  Place/Thing/Event names and descriptions, plus exact ISO day, month or year
  selectors;
- **Visual search** asks Immich to rank photos by a natural-language scene
  description or by similarity to an open photo; and
- **Documents** searches confirmed Document metadata and links.

Photo selectors are intersected. A query such as “Maya at Bluewater in 2024”
returns media satisfying the recognized combination. The response explains the
selectors it used and lists unresolved terms rather than pretending that an
unsupported phrase was understood.

Recorded facts is deterministic, local and model-free. Visual search is a
separate, disclosed Immich layer. It pages 24 ranked leads at a time, filters
them through the current Cimmich viewing scope and never presents its order as
a fact or stable score. From an open image, **Find visually similar** opens the
same lens using that photo as the reference. Neither path changes confirmed
Cimmich truth.

## Archive Health

Archive Health is an evidence and preservation workspace. It is deliberately
not a delete button.

Its title, Exact copies, Possible duplicates, Folder check, Rotation review,
Missing files, Backup check and Refresh controls share the normal page header. There is no
second Archive Health toolbar taking space above the results.

### Exact copies

Exact groups require complete-file SHA-256 equality. Every copy shows its
source folder and full file path, with direct actions to open that
folder or compare it with the rest of the archive. Results appear before those
paths finish loading, and only the visible page is enriched. Even exact bytes
can have different copy-local Immich People or Tags, so inspect what would be
lost before removing anything outside Cimmich.

### Possible duplicates

Immich's native possible-duplicate groups require completed Smart Search
embeddings followed by Duplicate Detection. If Smart Search is disabled or the
historical library has not been backfilled, those groups will be absent.
Cimmich can still prove byte-exact copies from SHA-256 and may surface bounded
visual-signature leads, but those are not a substitute for Immich's complete
library-wide duplicate pass.

Similarity groups are classified as:

- **Different files** - complete hashes prove the files are not exact copies;
- **Exact copies** - complete hashes agree inside a similarity group; or
- **Needs verification** - at least one file lacks enough byte proof.

The comparison explains dimensions, file size, dates, metadata and Cimmich
evidence. A probable version can be a resize, edit, export or merely a strong
visual lead. Similarity alone is never deletion authority.

When evidence supports a preferred preservation candidate, it is marked on the
photo and explained in the same group. Ambiguous or byte-incomplete groups say
that no safe recommendation exists. Recommendations never change files.

### Folder check

Folder check is one of the checks in Archive Health, beside Exact copies,
Possible duplicates, Rotation review and Backup check. Paste an archive folder path there, or
choose **Browse folders** and use **Check this folder** from any folder. Existing
duplicate-folder links open Archive Health with Folder check already selected.

The shared Archive Health command bar stays in place while the selected check
changes. Each check loads its own evidence only when selected. Moving into
Folder check reuses the current duplicate index instead of reloading the whole
Archive Health page.

It inventories every direct file in the folder, then splits each current
duplicate group into **This folder** and **Elsewhere**. Other folders are ranked
by the number of source-folder photos they share, so large overlaps can be
inspected first. **Only here** means no current exact or visual-duplicate lead
exists elsewhere; it is an evidence state, not proof that no unseen or
unprocessed copy exists. Pairs retain exact/different/incomplete byte
classification and the specific size, dimensions, date or metadata differences
already available to Archive Health.

### Rotation review

Rotation review is a demand-loaded candidate queue. It currently flags images
that Immich's visual index ranks as resembling sideways or 90 degree rotated
photos. These are useful ranked leads, not proof that an image needs rotation.

Rotation review is an explicit queue of Immich's 500 strongest matches for the
sideways-photo query. The first 24 unresolved candidates load only after
Rotation review is selected.
If a ranked page contains only completed reviews, Cimmich advances through
another bounded page until it finds unresolved work or reaches the end. The
same Smart Search response supplies the visible cards and their Immich metadata,
exposing the source folder, capture date, dimensions and recorded EXIF
orientation. The first usable batch appears before Cimmich counts that bounded
500-item queue in the background. The queue header then shows the exact
unresolved backlog and reviewed total within that queue. One bounded Smart
Search replaces an open-ended walk through the library; source evidence and
Cimmich decisions are checked in batches of 100. The Archive Health tab does
not repeat the visible 24-card count as a misleading backlog estimate.

Use the photo's magnify control to open the same full-photo inspection view used
by Photo Review. It always opens at 100% fit, with the complete photo contained
inside the available window instead of centring and cropping around the review
target. Optional zoom levels from 150% to 400% resize the already loaded image
in the browser. Drag, scroll or use the arrow keys only after zooming; **Fit
photo to window** restores the complete context without another media request.
The adjacent photo controls rotate left or right and change a local draft;
the opposite rotate button reverses the draft without an overlapping Undo
control on the image. These controls are not repeated in the card body. They do
not write while you are still inspecting. Choose **Save** after changing
an orientation, or **Confirm** to record that the current orientation is
correct. **Save / Confirm all (X)** applies only to the pending candidates
currently loaded on the page. A completed card leaves this active queue
immediately and remains absent after reload. Completing the last visible card
automatically loads the next unresolved bounded batch. **Load 24 more
candidates** remains available while unresolved cards are visible.

Saved decisions are reversible Cimmich presentation corrections, including an
explicit confirmation that no rotation is needed. Undo remains available from
Photo details after confirmation. The source file and Immich metadata are
unchanged. Magnify or open the complete photo before deciding because visual
similarity does not determine whether a photo needs correction or which
direction is correct. Cards place the ranking reason beneath the photo and keep
EXIF and proposed rotation together for faster scanning.

### Missing files

Missing files manages Cimmich records that are no longer in the active Immich
source. Opening the view automatically refreshes the normal timeline, archive
and hidden lanes. Disabled predecessor sources are excluded. An asset in Immich
trash is shown immediately as **In Immich trash**. An asset absent from a
successful complete refresh of the current source is shown as **Not found in
current Immich**. Both are immediately eligible for **Remove from Cimmich**;
there is no second-check ceremony.

An unavailable Immich service, disconnected source folder, Immich offline flag
or failed refresh cannot qualify a record for removal. Exact inline checks on
Person photo cards follow the same rule: only an Immich trash response or a
definitive missing database row changes Cimmich state. Locked media remains an
explicit import boundary and is not silently classified by this check.

Removal is a two-click, explicit Cimmich command. Select individual records for
mixed review, or use **Remove all … from Cimmich** on the trash summary to
retire every currently counted Immich-trash link without loading or selecting
each page. The bulk command is locked to the displayed count and refuses if the
trash set changes before confirmation. It retires only the affected Immich
bindings. If an underlying Cimmich asset has another active or unresolved
source binding, that asset remains. Source media and the Immich database are
never written by this action.

### Backup check

Backup check has two modes: **Photos** and **Database**.

#### Photos

Archive Health distinguishes byte-verified media, independently protected
items and items still needing destination proof. Another file on the same disk
is not an independent backup.

An operator may also attach a configured independent destination read-only and
run a backup scan. Cimmich hashes complete destination files and reports exact
content matches, same-filename files whose content or embedded metadata changed,
archive content without an exact destination match, and destination files not
represented by archive bytes or filenames. Size changes are shown separately;
exact files still match if their backup path changed.

The scanner cannot browse arbitrary server paths. A destination must be mounted
under `/backup`, registered with a stable storage-domain identity different from
the archive disk and remain read-only. Scan state is operational and lasts only
for the current API session; it does not change media or create preservation
authority by itself.

#### Database

Database protection covers Cimmich's own PostgreSQL records, including People,
review decisions, settings and generated work. It does not replace the Photos
backup or the separate Document-store backup.

Select one or more configured independent locations, choose Manual, Daily or
Weekly, choose how many verified copies to keep, and save the schedule. **Back
up now** creates a PostgreSQL custom-format dump at every selected location.
Each completed card shows creation time, size, schema version, last full check
and an abbreviated SHA-256. **Check latest** re-reads the complete dump,
compares its recorded size and SHA-256, and asks PostgreSQL to read the restore
catalogue. This can take time for a large database, but it runs without blocking
the rest of Cimmich.

Locations are configured by the deployment and must be on a distinct storage
failure domain. The browser cannot enter an arbitrary server path. An
unavailable location remains visible and scheduled work waits until the
location is usable again.

## Settings, matching and optional providers

Settings separates ordinary product setup from optional machinery:

- **Connection and import** manages the read-only Immich relationship and
  inventory refresh;
- **Experience and viewing** controls Familiar/Frontier presentation, viewing
  defaults and Private behavior;
- **Enhanced matching** manages the optional Cimmich component for
  provider-backed candidate ranking;
- **Face matching** runs governed recognition, SourcePack compilation,
  evaluation, review, activation and rollback;
- **Body evidence** configures optional body-observation production;
- **Local AI** enables bounded photo review/enhancement experiments; and
- **Guided access** exposes a separately authenticated, capability-bounded
  machine interface when deliberately enabled.

Local AI is visibly labelled **Alpha · Experimental build** wherever its photo
review dialog opens. It is off by default in public builds and appears only
after a deployment deliberately enables the experimental capability. Opting in
does not change the public default or give Local AI authority to write identity
truth.

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
5. Export the installer-managed state root, then run a redacted operator report:

   ```sh
   export CIMMICH_COMPANION_STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/cimmich-companion"
   ./tools/companion.sh doctor
   ```

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
- [Photo summaries](SUMMARIES.md)
- [Community Preview journeys](COMMUNITY_PREVIEW_JOURNEYS.md)
- [Frequently asked questions](FAQ.md)
