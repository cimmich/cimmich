import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const readCredential = (key: string) => {
  const direct = process.env[key];
  if (direct) {
    return direct;
  }
  const stateRoot = process.env.CIMMICH_E2E_STATE_ROOT;
  if (!stateRoot) {
    throw new Error(`Set ${key} or CIMMICH_E2E_STATE_ROOT for the isolated fictional demo`);
  }
  const source = readFileSync(path.join(stateRoot, 'operator.env'), 'utf8');
  const match = source.match(new RegExp(`^${key}='([^']+)'$`, 'mu'));
  if (!match?.[1]) {
    throw new Error(`The isolated demo is missing ${key}`);
  }
  return match[1];
};

const readDemoAssetId = (assetId: string) => {
  const stateRoot = process.env.CIMMICH_E2E_STATE_ROOT;
  if (!stateRoot) {
    throw new Error('Set CIMMICH_E2E_STATE_ROOT for the isolated fictional demo');
  }
  const source = JSON.parse(readFileSync(path.join(stateRoot, 'immich-map.json'), 'utf8')) as {
    assets?: Array<{ assetId?: unknown; immichAssetId?: unknown }>;
  };
  const match = source.assets?.find((asset) => asset.assetId === assetId);
  if (typeof match?.immichAssetId !== 'string') {
    throw new TypeError(`The isolated demo is missing mapped asset ${assetId}`);
  }
  return match.immichAssetId;
};

const authenticate = async (page: Page) => {
  await page.goto('/cimmich/home', { waitUntil: 'networkidle' });
  if (!page.url().includes('/auth/login')) {
    return;
  }
  await page.getByLabel('Email').fill(readCredential('CIMMICH_DEMO_ADMIN_EMAIL'));
  await page.getByLabel('Password').fill(readCredential('CIMMICH_DEMO_ADMIN_PASSWORD'));
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/(?:cimmich|photos)(?:[/?#]|$)/u);
};

test.beforeEach(async ({ page }) => {
  await authenticate(page);
});

test('fictional demo opens on a populated Cimmich home', async ({ page }) => {
  await page.goto('/cimmich/home');
  await expect(page.getByRole('heading', { name: 'Cimmich home' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your world' })).toContainText('People');
  await expect(page.getByRole('region', { name: 'Your world' })).toContainText('Documents');
  await expect(page.getByRole('region', { name: 'Bluewater Weekend' })).toBeVisible();
});

test('viewing mode menu opens through a real pointer interaction', async ({ page }) => {
  await page.goto('/cimmich/home');
  await page.getByRole('button', { name: 'Viewing mode: Standard' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Cimmich viewing mode' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Personal' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Private' })).toBeVisible();
});

test('the familiar sidebar nests Cimmich beside ordinary library destinations', async ({ page }) => {
  const primaryNavigation = page.getByRole('navigation', { name: /primary/iu });
  await expect(primaryNavigation.getByRole('link', { name: 'Cimmich', exact: true })).toBeVisible();
  for (const [name, href, pathname, organise] of [
    ['Photos', '/photos', '/photos', false],
    ['Albums', '/albums', '/albums', false],
    ['Library', '/cimmich/library', '/photos', true],
    ['People', '/cimmich/people', '/cimmich/people', false],
    ['Settings', '/cimmich/settings', '/cimmich/settings', false],
  ] as const) {
    const destination = primaryNavigation.getByRole('link', { name, exact: true });
    await expect(destination).toHaveAttribute('href', href);
    await destination.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(pathname);
    await expect.poll(() => new URL(page.url()).searchParams.has('organise')).toBe(organise);
    await expect(page.locator('main')).toBeVisible();
  }
});

test('Cimmich tags narrow to the true intersection', async ({ page }) => {
  await page.goto('/tags?organise=1');
  await page.getByRole('checkbox', { name: /Bluewater Beach Places/u }).check();
  await page.getByRole('checkbox', { name: /Bluewater Weekend Events/u }).check();
  await expect(page.getByRole('heading', { name: 'Photos with all 2 selected tags' })).toBeVisible();
  await expect(page.getByText('8 photos · all selected tags')).toBeVisible();
});

test('photo viewer advances and returns without losing the timeline', async ({ page }) => {
  await page.goto('/photos');
  await page
    .getByRole('link', { name: /Image taken on/u })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'View next asset' })).toBeVisible();
  const firstUrl = page.url();
  const media = page.locator('#immich-asset-viewer img, #immich-asset-viewer video').first();
  await expect(media).toBeVisible();
  const firstSource = (await media.getAttribute('src')) ?? (await media.getAttribute('poster'));
  expect(firstSource).toBeTruthy();
  await page.getByRole('button', { name: 'View next asset' }).click();
  await expect.poll(() => page.url()).not.toBe(firstUrl);
  await expect
    .poll(async () => (await media.getAttribute('src')) ?? (await media.getAttribute('poster')))
    .not.toBe(firstSource);
  await expect(media).toBeVisible();
  await page.getByRole('button', { name: 'Go back' }).click();
  await expect(page).toHaveURL(/\/photos/u);
});

test('Cimmich Person viewer moves between photos by keyboard and pointer', async ({ page }) => {
  await page.goto('/cimmich/people');
  await page
    .getByRole('link', { name: /Maya Chen/u })
    .first()
    .click();
  const photoLinks = page.locator('a[href^="/photos/"][href*="cimmichPersonId"]');
  await expect(photoLinks.first()).toBeVisible();
  const photoCount = await photoLinks.count();
  const thumbnailView = page.getByRole('group', { name: 'Thumbnail view' });
  await thumbnailView.getByRole('button', { name: 'Face', exact: true }).click();
  await expect(thumbnailView.getByRole('button', { name: 'Face', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const faceCrop = page.getByRole('img', { name: /Maya Chen face in/u }).first();
  await expect(faceCrop).toBeVisible();
  await expect(faceCrop).toHaveAttribute('style', /position: absolute/u);
  expect(await photoLinks.count()).toBe(photoCount);
  await thumbnailView.getByRole('button', { name: 'Photo', exact: true }).click();
  await expect(thumbnailView.getByRole('button', { name: 'Photo', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('img', { name: /Maya Chen face in/u })).toHaveCount(0);

  const photoLink = photoLinks.first();
  await expect(photoLink).toBeVisible();
  await photoLink.click();

  const previous = page.getByRole('button', { name: 'View previous asset' });
  const next = page.getByRole('button', { name: 'View next asset' });
  await expect(next).toBeVisible();
  const firstUrl = page.url();
  const firstPhotoPath = new URL(firstUrl).pathname;

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => new URL(page.url()).pathname).not.toBe(firstPhotoPath);
  await expect(previous).toBeVisible();

  await previous.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(firstPhotoPath);
});

test('Person Overview exposes Needs attention, Merge and bulk Split without hidden setup hunting', async ({ page }) => {
  await page.goto('/cimmich/people');
  await page
    .getByRole('link', { name: /Maya Chen/u })
    .first()
    .click();
  await page.getByRole('tab', { name: /Identity/u }).click();

  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  const actions = page.getByRole('heading', { name: 'Organise this person' }).locator('..').locator('..');
  await expect(actions.getByRole('button', { name: /Needs attention/u })).toBeVisible();
  await expect(actions.getByRole('button', { name: /Merge/u })).toBeVisible();
  await actions.getByRole('button', { name: /Split/u }).click();

  await expect(page).toHaveURL(/mode=split/u);
  await expect(page.getByRole('heading', { name: /Split Maya Chen/u })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create New', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move to', exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Faces to split')).toBeVisible();

  await page.getByRole('button', { name: 'Back to overview' }).first().click();
  await expect(page.getByRole('heading', { name: 'Organise this person' })).toBeVisible();
  await page.getByRole('button', { name: /Merge/u }).click();
  await expect(page).toHaveURL(/mode=setup/u);
  await expect(page.getByRole('heading', { name: 'Merge identities' })).toBeVisible();
});

test('bulk Face editing stays inside a 320px reflow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/cimmich/home');
  await page
    .getByRole('button', { name: /Viewing mode:/u })
    .first()
    .click();
  await page.getByRole('button', { name: 'Personal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Viewing mode: Personal' }).first()).toBeVisible();
  try {
    const targetAssetId = readDemoAssetId('CHA-035');
    await page.goto(`/photos/${targetAssetId}?cimmichContext=1`);
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/photos/${targetAssetId}`);
    const peopleAction = page.getByTestId('cimmich-people-view');
    await expect(peopleAction).toBeVisible();
    if ((await peopleAction.getAttribute('aria-pressed')) !== 'true') {
      await peopleAction.click();
    }

    const bulkAction = page.getByRole('button', { name: 'Edit all Face tags' });
    await expect(bulkAction).toBeVisible();
    await bulkAction.click();
    const panel = page.getByTestId('cimmich-face-bulk-panel');
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  } finally {
    await page.goto('/cimmich/home');
    await page.getByRole('button', { name: 'Viewing mode: Personal' }).first().click();
    await page.getByRole('button', { name: 'Standard', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Viewing mode: Standard' }).first()).toBeVisible();
  }
});
