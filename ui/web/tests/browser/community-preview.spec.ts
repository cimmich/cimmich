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

test('Organise preserves all four familiar library modes', async ({ page }) => {
  await page.getByRole('link', { name: 'Organise', exact: true }).click();
  for (const [name, pathname] of [
    ['Timeline', '/photos'],
    ['Folders', '/folders'],
    ['Tags', '/tags'],
    ['Albums', '/albums'],
  ] as const) {
    await page.getByRole('navigation', { name: 'Organise by' }).getByRole('link', { name }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(pathname);
    await expect.poll(() => new URL(page.url()).searchParams.get('organise')).toBe('1');
    await expect(page.locator('main')).toBeVisible();
    if (name !== 'Albums') {
      await page.getByRole('link', { name: 'Organise', exact: true }).click();
    }
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
    await page.goto(`/photos/${targetAssetId}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/photos/${targetAssetId}`);
    const peopleAction = page.getByTestId('cimmich-people-view');
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
