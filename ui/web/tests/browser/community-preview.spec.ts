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

const authenticate = async (page: Page) => {
  await page.goto('/cimmich/home', { waitUntil: 'networkidle' });
  if (!page.url().includes('/auth/login')) {
    return;
  }
  await page.getByLabel('Email').fill(readCredential('CIMMICH_DEMO_ADMIN_EMAIL'));
  await page.getByLabel('Password').fill(readCredential('CIMMICH_DEMO_ADMIN_PASSWORD'));
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/cimmich\/home|\/photos/u);
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
  const modes = page.getByRole('navigation', { name: 'Organise by' });
  await expect(modes.getByRole('link', { name: 'Timeline' })).toHaveAttribute('href', '/photos?organise=1');
  await expect(modes.getByRole('link', { name: 'Folders' })).toHaveAttribute('href', '/folders?organise=1');
  await expect(modes.getByRole('link', { name: 'Tags' })).toHaveAttribute('href', '/tags?organise=1');
  await expect(modes.getByRole('link', { name: 'Albums' })).toHaveAttribute('href', '/albums?organise=1');
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
  await page.getByRole('button', { name: 'View next asset' }).click();
  await expect.poll(() => page.url()).not.toBe(firstUrl);
  await page.getByRole('button', { name: 'Go back' }).click();
  await expect(page).toHaveURL(/\/photos/u);
});
