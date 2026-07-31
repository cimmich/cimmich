import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { authenticate } from '$lib/utils/auth';
import { cimmichAssetRecoveryHref } from '$lib/utils/cimmich-asset-recovery';
import { getAssetInfoFromParam, isSharedLinkRoute } from '$lib/utils/navigation';
import type { LayoutLoad } from './$types';

const cimmichApiRoot = (env.PUBLIC_CIMMICH_API_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');

export const load = (async ({ fetch, url, params, route }) => {
  await authenticate(url, { public: isSharedLinkRoute(route.id) });
  let asset;
  try {
    asset = await getAssetInfoFromParam(params);
  } catch (error) {
    const sourceAssetId = params.assetId || '';
    const isCimmichPhotoLink =
      url.searchParams.has('cimmichOverlay') &&
      (url.searchParams.has('cimmichPersonId') || url.searchParams.has('cimmichPetId'));
    if (!sourceAssetId || !isCimmichPhotoLink) {
      throw error;
    }
    let response: Response;
    try {
      response = await fetch(`${cimmichApiRoot}/v1/assets/display?sourceAssetId=${encodeURIComponent(sourceAssetId)}`);
    } catch {
      throw error;
    }
    if (!response.ok) {
      throw error;
    }
    const display = (await response.json()) as { sourceAssetId?: string };
    const recoveryHref = cimmichAssetRecoveryHref({
      currentSourceAssetId: sourceAssetId,
      resolvedSourceAssetId: display.sourceAssetId || '',
      url,
    });
    if (!recoveryHref) {
      throw error;
    }
    redirect(307, recoveryHref);
  }

  return {
    asset,
  };
}) satisfies LayoutLoad;
