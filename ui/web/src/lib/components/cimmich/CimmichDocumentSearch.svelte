<script lang="ts">
  import type { CimmichDocumentKind } from '$lib/services/cimmich.service';
  import { Icon } from '@immich/ui';
  import { mdiArchiveArrowDownOutline, mdiMagnify } from '@mdi/js';
  import { documentKindOptions } from './document-presentation';

  interface Props {
    kindFilter: CimmichDocumentKind | '';
    onArchivedChange: (showArchived: boolean) => void;
    onKindChange: (kind: CimmichDocumentKind | '') => void;
    onQueryChange: (query: string) => void;
    onSearch: () => void;
    query: string;
    showArchived: boolean;
  }

  let { kindFilter, onArchivedChange, onKindChange, onQueryChange, onSearch, query, showArchived }: Props = $props();
</script>

<form
  class="document-toolbar-search"
  role="search"
  onsubmit={(event) => {
    event.preventDefault();
    onSearch();
  }}
>
  <label class="document-search">
    <Icon icon={mdiMagnify} size="20" />
    <span class="sr-only">Search documents</span>
    <input
      value={query}
      placeholder="Search title or filename"
      maxlength="200"
      oninput={(event) => onQueryChange(event.currentTarget.value)}
    />
  </label>
  <label class="document-field compact"
    ><span class="sr-only">Document type</span><select
      value={kindFilter}
      aria-label="Document type"
      onchange={(event) => onKindChange(event.currentTarget.value as CimmichDocumentKind | '')}
    >
      <option value="">All types</option>
      {#each documentKindOptions as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
    </select></label
  >
  <button class="document-secondary-button document-search-submit" type="submit" aria-label="Search">
    <Icon icon={mdiMagnify} size="18" /><span class="sr-only">Search</span>
  </button>
  <label class:active={showArchived} class="document-archive-toggle" title="Include archived">
    <input
      class="sr-only"
      type="checkbox"
      checked={showArchived}
      onchange={(event) => onArchivedChange(event.currentTarget.checked)}
    />
    <Icon icon={mdiArchiveArrowDownOutline} size="18" /><span class="sr-only">Include archived</span>
  </label>
</form>
