import type { TimeBucketAssetResponseDto } from '@immich/sdk';
import { visibilityRequest } from '$lib/services/cimmich.service';

type PresentationClient = (sourceAssetIds: string[]) => Promise<{ sourceAssetIds: string[] }>;

const getCimmichPresentableAssetIds = (sourceAssetIds: string[]) =>
  visibilityRequest<{ sourceAssetIds: string[] }>('/v1/visibility/assets/viewable', {
    body: JSON.stringify({ sourceAssetIds }),
    method: 'POST',
  });

const chunks = <T>(values: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};

export class CimmichAssetPresentationManager {
  #cache = new Map<string, boolean>();
  #client: PresentationClient;
  #queue: Promise<void> = Promise.resolve();
  #version = -1;

  constructor(client?: PresentationClient) {
    this.#client = client ?? ((sourceAssetIds) => getCimmichPresentableAssetIds(sourceAssetIds));
  }

  async presentableIds(sourceAssetIds: string[], version: number): Promise<Set<string>> {
    const requested = [...new Set(sourceAssetIds.filter(Boolean))];
    if (requested.length === 0) {
      return new Set();
    }

    const run = this.#queue
      .catch(() => {})
      .then(async () => {
        if (this.#version !== version) {
          this.#cache.clear();
          this.#version = version;
        }
        const unresolved = requested.filter((sourceAssetId) => !this.#cache.has(sourceAssetId));
        for (const batch of chunks(unresolved, 500)) {
          const response = await this.#client(batch);
          if (this.#version !== version) {
            return;
          }
          const visible = new Set(response.sourceAssetIds);
          for (const sourceAssetId of batch) {
            this.#cache.set(sourceAssetId, visible.has(sourceAssetId));
          }
        }
      });
    this.#queue = run;
    await run;

    if (this.#version !== version) {
      return new Set();
    }
    return new Set(requested.filter((sourceAssetId) => this.#cache.get(sourceAssetId) === true));
  }
}

export const filterTimeBucketAssets = (
  bucket: TimeBucketAssetResponseDto,
  presentableIds: ReadonlySet<string>,
): TimeBucketAssetResponseDto => {
  const includedIndexes = bucket.id.flatMap((id, index) => (presentableIds.has(id) ? [index] : []));
  return Object.fromEntries(
    Object.entries(bucket).map(([key, value]) => [
      key,
      Array.isArray(value) && value.length === bucket.id.length ? includedIndexes.map((index) => value[index]) : value,
    ]),
  ) as TimeBucketAssetResponseDto;
};

export const cimmichAssetPresentationManager = new CimmichAssetPresentationManager();
