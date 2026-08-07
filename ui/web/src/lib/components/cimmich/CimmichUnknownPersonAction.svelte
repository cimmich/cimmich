<script lang="ts">
  import {
    createCimmichIdentityCorrectionCommandId,
    setCimmichFaceReviewDisposition,
  } from '$lib/services/cimmich.service';

  let {
    busy = false,
    faceId,
    onChanged,
    onError,
    onSaving,
  }: {
    busy?: boolean;
    faceId: string;
    onChanged: () => void;
    onError: (message: string) => void;
    onSaving: (saving: boolean) => void;
  } = $props();

  let saving = $state(false);

  const markUnknown = async () => {
    if (busy || saving) {
      return;
    }
    saving = true;
    onSaving(true);
    onError('');
    try {
      await setCimmichFaceReviewDisposition(
        faceId,
        'unknown',
        createCimmichIdentityCorrectionCommandId('person-review-unknown'),
      );
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to mark this face as unknown');
    } finally {
      saving = false;
      onSaving(false);
    }
  };
</script>

<button
  class="min-h-10 rounded-md border border-gray-300 px-3 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-800"
  type="button"
  disabled={busy || saving}
  onclick={() => void markUnknown()}
>
  {saving ? 'Saving…' : 'Unknown person'}
</button>
