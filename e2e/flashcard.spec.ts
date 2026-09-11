// The Flashcard MDX component.
//
// The property worth testing is not that it renders — it is that the answer is
// genuinely absent until it is asked for. A card whose answer sits in the DOM
// behind `display: none` is a paragraph with extra steps: it is one find-in-page
// away, and the reader who wanted to test themselves has already failed to.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openNote } from './fixtures';

const ANSWER = 'Committed to the repository as plain files';

test.beforeEach(async ({ workspace }) => {
  writeFileSync(
    join(workspace, 'cards.mdx'),
    [
      '# Study',
      '',
      '<Flashcard front="Where do Neuron notes live?">',
      ANSWER,
      '</Flashcard>',
      '',
    ].join('\n'),
  );
});

test('the prompt shows and the answer does not, until it is asked for', async ({ page }) => {
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, 'cards.mdx');

  await expect(page.getByText('Where do Neuron notes live?')).toBeVisible();

  // Absent from the document, not merely hidden.
  await expect(page.getByText(ANSWER)).toHaveCount(0);

  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByText(ANSWER)).toBeVisible();
});

test('a card with no answer says so rather than revealing an empty panel', async ({ page, workspace }) => {
  writeFileSync(
    join(workspace, 'empty-card.mdx'),
    '# Study\n\n<Flashcard front="A question nobody answered"></Flashcard>\n',
  );
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, 'empty-card.mdx');

  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByText('This card has no answer yet.')).toBeVisible();
});

test('the answer stays hidden in the live editor too', async ({ page }) => {
  // The editing view is the easiest place to leak this: the raw source contains
  // the answer, so a card left as plain text would show it permanently.
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, 'cards.mdx');
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  await expect(page.locator('.cm-live-editor')).toBeVisible();

  await expect(page.getByText('Where do Neuron notes live?')).toBeVisible();
  await expect(page.getByText(ANSWER)).toHaveCount(0);

  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByText(ANSWER)).toBeVisible();
});
