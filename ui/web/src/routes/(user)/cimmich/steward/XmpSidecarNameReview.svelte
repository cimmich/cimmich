<script lang="ts">
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import {
    getCimmichPeople,
    getCimmichXmpUnresolvedNames,
    resolveCimmichXmpUnresolvedName,
    type CimmichPerson,
    type CimmichXmpNamePreview,
    type CimmichXmpUnresolvedName,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { cimmichSquareCropBackgroundStyle } from '$lib/utils/cimmich-crop';
  import { createCimmichUuid } from '$lib/utils/cimmich-uuid';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiAccountCheckOutline, mdiArchiveEyeOutline, mdiRefresh } from '@mdi/js';

  let items = $state<CimmichXmpUnresolvedName[]>([]);
  let people = $state<CimmichPerson[]>([]);
  let remainingGroupCount = $state(0);
  let selectedPersonId = $state('');
  let newPersonName = $state('');
  let selectorMode = $state<'existing' | 'new'>('existing');
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let message = $state('');
  let loadGeneration = 0;

  const active = $derived(items[0]);
  const selectedPerson = $derived(people.find((person) => person.person_id === selectedPersonId));
  const canResolve = $derived(
    Boolean(active) &&
      !busy &&
      (selectorMode === 'existing' ? Boolean(selectedPersonId) : Boolean(newPersonName.trim())),
  );

  const load = async () => {
    const generation = ++loadGeneration;
    loading = true;
    error = '';
    try {
      const [queue, directory] = await Promise.all([getCimmichXmpUnresolvedNames(24), getCimmichPeople(500)]);
      if (generation !== loadGeneration) {
        return;
      }
      items = queue.items;
      remainingGroupCount = queue.remainingGroupCount;
      people = directory.filter((person) => person.subject_kind === 'person');
      selectedPersonId = '';
      newPersonName = queue.items[0]?.normalizedName || '';
    } catch (error_) {
      if (generation === loadGeneration) {
        error = error_ instanceof Error ? error_.message : 'Cimmich could not load the imported-name queue.';
      }
    } finally {
      if (generation === loadGeneration) {
        loading = false;
      }
    }
  };

  $effect(() => {
    void cimmichVisibilityManager.version;
    void load();
  });

  const cropStyle = (preview: CimmichXmpNamePreview) => {
    if (!preview.sourceAssetId) {
      return '';
    }
    return cimmichSquareCropBackgroundStyle({
      boxH: preview.box.h,
      boxW: preview.box.w,
      boxX: preview.box.x,
      boxY: preview.box.y,
      height: preview.height ?? 0,
      padding: 2.8,
      url: getAssetMediaUrl({ id: preview.sourceAssetId, size: AssetMediaSize.Preview }),
      width: preview.width ?? 0,
    });
  };

  const advance = () => {
    items = items.slice(1);
    selectedPersonId = '';
    newPersonName = items[0]?.normalizedName || '';
    selectorMode = 'existing';
  };

  const resolveActive = async () => {
    if (!active || !canResolve) {
      return;
    }
    busy = true;
    error = '';
    message = '';
    try {
      const result = await resolveCimmichXmpUnresolvedName(active.groupId, {
        commandId: `xmp-owner-${createCimmichUuid()}`,
        ...(selectorMode === 'existing' ? { personId: selectedPersonId } : { newPersonName: newPersonName.trim() }),
      });
      message = `${result.resolvedFaceCount.toLocaleString()} faces are now attached to ${result.personName}.`;
      remainingGroupCount = Math.max(0, remainingGroupCount - 1);
      if (result.createdPerson) {
        people = [
          ...people,
          {
            aliases: result.aliasAdded ? [active.normalizedName] : [],
            display_name: result.personName,
            person_id: result.personId,
            status: 'active',
            subject_kind: 'person',
          } as CimmichPerson,
        ];
      }
      advance();
      if (items.length === 0 && remainingGroupCount > 0) {
        await load();
      }
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The imported name could not be resolved.';
    } finally {
      busy = false;
    }
  };
</script>

<section
  id="xmp-name-review"
  class="overflow-hidden rounded-4xl border border-gray-200 bg-white shadow-sm dark:border-immich-dark-gray dark:bg-immich-dark-bg"
>
  <header
    class="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-6 py-5 dark:border-immich-dark-gray"
  >
    <div class="flex max-w-3xl items-start gap-3">
      <div class="mt-0.5 rounded-2xl bg-immich-primary/10 p-2.5 text-immich-primary dark:text-immich-dark-primary">
        <Icon icon={mdiArchiveEyeOutline} size="24" />
      </div>
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-immich-primary dark:text-immich-dark-primary">
          Imported archive truth
        </p>
        <h2 class="mt-1 text-xl font-semibold text-gray-900 dark:text-white">Resolve names already in the sidecars</h2>
        <p class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-300">
          One confirmation resolves every still-anonymous face carrying that source name. Cimmich never creates or
          chooses a Person until you do.
        </p>
      </div>
    </div>
    <button
      type="button"
      class="rounded-full border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50 disabled:opacity-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray"
      aria-label="Refresh imported names"
      disabled={loading || busy}
      onclick={() => void load()}
    >
      <Icon icon={mdiRefresh} size="20" />
    </button>
  </header>

  {#if loading}
    <div class="px-6 py-12 text-center text-sm text-gray-500">Loading the highest-value imported names…</div>
  {:else if active}
    <div class="grid lg:grid-cols-[1.05fr_0.95fr]">
      <div class="border-b border-gray-100 p-6 lg:border-r lg:border-b-0 dark:border-immich-dark-gray">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-300">
              {remainingGroupCount.toLocaleString()} names remain
            </p>
            <h3 class="mt-1 text-2xl font-semibold text-gray-950 dark:text-white">{active.normalizedName}</h3>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-300">
              {active.faceCount.toLocaleString()} faces across {active.assetCount.toLocaleString()} photos
            </p>
          </div>
          <span
            class="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 dark:bg-immich-dark-gray dark:text-gray-200"
          >
            Highest ROI
          </span>
        </div>

        <div class="mt-5 grid grid-cols-3 gap-2">
          {#each active.previews as preview (preview.faceId)}
            <div
              class="aspect-square overflow-hidden rounded-2xl bg-gray-100 bg-cover bg-center dark:bg-immich-dark-gray"
              style={cropStyle(preview)}
              aria-label={`Face preview for ${active.normalizedName}`}
            ></div>
          {/each}
        </div>

        {#if active.rawNameVariants.length > 1}
          <p class="mt-4 text-xs leading-5 text-gray-400">
            Source variants: {active.rawNameVariants.join(' · ')}
          </p>
        {/if}
        {#if active.conflictingIdentityCount > 0}
          <p
            class="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {active.conflictingIdentityCount} faces already have a current identity. Cimmich will continue only if they agree
            with your selected Person.
          </p>
        {/if}
      </div>

      <div class="p-6">
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Who does this archive name mean?</p>
        <div class="mt-4 grid grid-cols-2 rounded-2xl bg-gray-100 p-1 dark:bg-immich-dark-gray">
          <button
            type="button"
            class="rounded-xl px-3 py-2 text-sm font-medium transition {selectorMode === 'existing'
              ? 'bg-white text-gray-950 shadow-sm dark:bg-immich-dark-bg dark:text-white'
              : 'text-gray-500 dark:text-gray-300'}"
            onclick={() => (selectorMode = 'existing')}>Existing Person</button
          >
          <button
            type="button"
            class="rounded-xl px-3 py-2 text-sm font-medium transition {selectorMode === 'new'
              ? 'bg-white text-gray-950 shadow-sm dark:bg-immich-dark-bg dark:text-white'
              : 'text-gray-500 dark:text-gray-300'}"
            onclick={() => {
              selectorMode = 'new';
              newPersonName ||= active.normalizedName;
            }}>New Person</button
          >
        </div>

        {#if selectorMode === 'existing'}
          <label class="mt-5 block text-xs font-semibold uppercase tracking-wide text-gray-500" for="xmp-person">
            Person
          </label>
          <select
            id="xmp-person"
            class="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-immich-primary dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:text-white"
            bind:value={selectedPersonId}
          >
            <option value="">Choose a Person…</option>
            {#each people as person (person.person_id)}
              <option value={person.person_id}>{person.display_name}</option>
            {/each}
          </select>
        {:else}
          <label class="mt-5 block text-xs font-semibold uppercase tracking-wide text-gray-500" for="xmp-new-person">
            Display name
          </label>
          <input
            id="xmp-new-person"
            class="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-immich-primary dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:text-white"
            maxlength="160"
            bind:value={newPersonName}
          />
        {/if}

        <p class="mt-4 text-xs leading-5 text-gray-500 dark:text-gray-300">
          The imported label is retained as an alias when it differs from the Person’s display name. Every resulting
          identity is recorded as your decision, not as model authority.
        </p>

        <button
          type="button"
          class="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-immich-primary px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canResolve}
          onclick={() => void resolveActive()}
        >
          <Icon icon={mdiAccountCheckOutline} size="20" />
          {busy
            ? 'Saving owner decision…'
            : selectorMode === 'existing'
              ? `Attach all to ${selectedPerson?.display_name || 'this Person'}`
              : `Create ${newPersonName.trim() || 'Person'} and attach all`}
        </button>
      </div>
    </div>
  {:else}
    <div class="px-6 py-12 text-center">
      <Icon icon={mdiAccountCheckOutline} size="32" class="mx-auto text-emerald-500" />
      <h3 class="mt-3 text-lg font-semibold text-gray-900 dark:text-white">No imported names need a decision</h3>
      <p class="mt-1 text-sm text-gray-500">Every visible sidecar name is resolved or intentionally held elsewhere.</p>
    </div>
  {/if}

  {#if message || error}
    <div
      class="border-t px-6 py-3 text-sm {error
        ? 'border-red-100 bg-red-50 text-red-800 dark:border-red-950 dark:bg-red-950/30 dark:text-red-200'
        : 'border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200'}"
    >
      {error || message}
    </div>
  {/if}
</section>
