<script lang="ts">
  import type { BulkPhotoSorterActionKind } from './bulk-photo-sorter';

  interface Props {
    onchange: (event: Event) => void;
    value: BulkPhotoSorterActionKind;
  }

  let { onchange, value }: Props = $props();
</script>

<label class="grid gap-1.5 text-sm font-medium"
  >Action
  <select class="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/15" {value} {onchange}>
    <optgroup label="Cimmich labels and collections"
      ><option value="label-add">Add Cimmich label</option><option value="label-remove">Remove Cimmich label</option
      ><option value="tag-add">Add Cimmich tag</option><option value="tag-remove">Remove Cimmich tag</option><option
        value="album-add">Add to collection</option
      ><option value="folders-to-albums">Create collections from folders</option></optgroup
    >
    <optgroup label="Cimmich library"
      ><option value="favorite">Favourite</option><option value="unfavorite">Remove favourite</option><option
        value="archive">Archive</option
      ><option value="unarchive">Unarchive</option></optgroup
    ><optgroup label="Photo details"
      ><option value="rotate-left">Rotate left</option><option value="rotate-right">Rotate right</option></optgroup
    >
    <optgroup label="Cimmich privacy"
      ><option value="visibility-standard">Set visibility to Standard</option><option value="visibility-personal"
        >Set visibility to Personal</option
      ><option value="visibility-private">Set visibility to Private</option></optgroup
    >
    <optgroup label="Cimmich context"
      ><option value="place-attach">Attach to Place</option><option value="event-attach">Attach to Event</option
      ></optgroup
    >
  </select>
</label>
