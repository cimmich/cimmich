<script lang="ts">
  import type { PersonPhotoView } from './person-photo-gallery';
  import { mdiFaceRecognition, mdiImageOutline } from '@mdi/js';
  import { Icon } from '@immich/ui';

  interface Props {
    onchange: (view: PersonPhotoView) => void;
    view: PersonPhotoView;
  }

  let { onchange, view }: Props = $props();
</script>

<div class="flex items-center border-r border-gray-200 dark:border-gray-700" role="group" aria-label="Thumbnail view">
  <button
    class={`inline-flex min-h-10 items-center gap-1.5 px-3 text-sm font-semibold transition hover:bg-gray-100 hover:text-gray-950 dark:hover:bg-gray-800 dark:hover:text-white ${view === 'photo' ? 'bg-primary/10 text-primary dark:bg-primary/15' : 'text-gray-500 dark:text-gray-400'}`}
    type="button"
    aria-pressed={view === 'photo'}
    onclick={() => onchange('photo')}
  >
    <Icon icon={mdiImageOutline} size="18" />
    Photo
  </button>
  <button
    class={`inline-flex min-h-10 items-center gap-1.5 px-3 text-sm font-semibold transition hover:bg-gray-100 hover:text-gray-950 dark:hover:bg-gray-800 dark:hover:text-white ${view === 'face' ? 'bg-primary/10 text-primary dark:bg-primary/15' : 'text-gray-500 dark:text-gray-400'}`}
    type="button"
    aria-pressed={view === 'face'}
    onclick={() => onchange('face')}
  >
    <Icon icon={mdiFaceRecognition} size="18" />
    Face
  </button>
</div>
