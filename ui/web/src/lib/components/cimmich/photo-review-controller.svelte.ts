import {
  cimmichPhotoReviewContextLabel,
  loadCimmichPhotoReviewContexts,
  rotateCimmichPhotoReviewContext,
  type CimmichPhotoReviewContext,
  undoCimmichPhotoReviewRotation,
} from './photo-review-context';

export class CimmichPhotoReviewController {
  contexts = $state<Record<string, CimmichPhotoReviewContext>>({});
  savingId = $state('');

  constructor(private readonly onError: (message: string) => void) {}

  context(assetId: string) {
    return this.contexts[assetId];
  }

  label(item: { assetId: string; captureTime?: string | null }) {
    return cimmichPhotoReviewContextLabel(this.context(item.assetId), item.captureTime);
  }

  async load(assetIds: string[]) {
    try {
      this.contexts = await loadCimmichPhotoReviewContexts(assetIds, this.contexts);
    } catch {
      // Identity review remains usable if optional context cannot be projected.
    }
  }

  async rotate(assetId: string, direction: 'left' | 'right') {
    await this.update(assetId, () => rotateCimmichPhotoReviewContext(assetId, direction, this.contexts));
  }

  async undo(assetId: string, decisionId: string) {
    await this.update(assetId, () => undoCimmichPhotoReviewRotation(decisionId, this.contexts));
  }

  private async update(assetId: string, operation: () => Promise<Record<string, CimmichPhotoReviewContext>>) {
    if (this.savingId) {
      return;
    }
    this.savingId = assetId;
    try {
      this.contexts = await operation();
    } catch (error) {
      this.onError(error instanceof Error ? error.message : 'The photo correction could not be saved');
    } finally {
      this.savingId = '';
    }
  }
}
