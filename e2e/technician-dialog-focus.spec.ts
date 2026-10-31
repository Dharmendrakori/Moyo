import { expect, test, type Page } from '@playwright/test';

/**
 * BROWSER REGRESSION TEST — TECHNICIAN DIALOG FOCUS
 *
 * This exists because the defect was invisible to unit tests and to source
 * inspection: the Add Technician form was declared INSIDE its parent component, so
 * every keystroke produced a new component type, React remounted the form, and the
 * focused <input> node was destroyed (leaving focus on <body>). Only a real browser
 * can prove that typing keeps focus.
 *
 * The specs drive the real components from `/dev/technician-dialogs` (a
 * development-only harness) and intercept the admin API, so no session, account or
 * database record is involved.
 *
 * Every keystroke owner is recorded so a failure reports WHICH element had focus
 * rather than only "expected true".
 */

const expectedOwners = (id: string, count: number) =>
  Array.from({ length: count }, () => `input#${id}`);

async function activeOwner(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return 'none';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`;
  });
}

/** Types one character at a time and records the focus owner after each. */
async function typeCharacterByCharacter(page: Page, text: string): Promise<string[]> {
  const owners: string[] = [];
  for (const char of text) {
    await page.keyboard.type(char);
    owners.push(await activeOwner(page));
  }
  return owners;
}

/** Marks the current DOM node so a replacement is detectable. */
async function markNode(page: Page, selector: string): Promise<void> {
  await page.locator(selector).evaluate((el) => {
    (el as HTMLElement).dataset.nodeProbe = 'original';
  });
}

/** True when the element currently in the DOM is the one that was marked. */
async function isSameNode(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((el) => (el as HTMLElement).dataset.nodeProbe === 'original');
}

async function stubTechnicianApi(
  page: Page,
  reply: { status: number; body: unknown },
): Promise<void> {
  await page.route('**/api/admin/technicians**', async (route) => {
    await route.fulfill({
      status: reply.status,
      contentType: 'application/json',
      body: JSON.stringify(reply.body),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/technician-dialogs');
  await expect(page.getByRole('heading', { name: 'Technician dialog harness' })).toBeVisible();
});

test('typing keeps focus and the same DOM node in every Add Technician field', async ({ page }) => {
  await page.getByRole('button', { name: 'Add technician' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const fields = [
    { label: 'Name', id: 'tech-name', value: 'RAHUL' },
    { label: 'Mobile (optional)', id: 'tech-phone', value: '9876500001' },
    { label: 'Headline (optional)', id: 'tech-headline', value: 'AC SPECIALIST' },
    { label: 'Skills (optional)', id: 'tech-skills', value: 'REFRIGERATION' },
  ];

  for (const field of fields) {
    const input = page.getByLabel(field.label, { exact: true });
    await input.click();
    await markNode(page, `#${field.id}`);

    const owners = await typeCharacterByCharacter(page, field.value);

    // The record is in the assertion message, so a failure names the element that
    // stole focus and after which keystroke.
    expect(
      owners,
      `activeElement after each keystroke in "${field.label}": ${owners.join(', ')}`,
    ).toEqual(expectedOwners(field.id, field.value.length));
    expect(await input.inputValue()).toBe(field.value);
    expect(
      await isSameNode(page, `#${field.id}`),
      `the #${field.id} input node must not be replaced while typing`,
    ).toBe(true);
    await expect(dialog).toBeVisible();
  }
});

test('toggling both checkboxes keeps focus predictable and preserves the form', async ({ page }) => {
  await page.getByRole('button', { name: 'Add technician' }).click();
  await page.getByLabel('Name', { exact: true }).fill('RAHUL');

  const active = page.getByLabel('Active on the roster');
  await active.click();
  expect(await activeOwner(page)).toBe('input');
  expect(await active.isChecked()).toBe(false);

  const available = page.getByLabel('Available for assignment');
  await available.click();
  expect(await activeOwner(page)).toBe('input');
  expect(await available.isChecked()).toBe(true);

  // Typing again afterwards still lands in the field.
  const name = page.getByLabel('Name', { exact: true });
  await name.click();
  const owners = await typeCharacterByCharacter(page, ' KUMAR');
  expect(owners, `activeElement after each keystroke: ${owners.join(', ')}`).toEqual(
    expectedOwners('tech-name', 6),
  );
  expect(await name.inputValue()).toBe('RAHUL KUMAR');
  expect(await page.getByRole('dialog').isVisible()).toBe(true);
});

test('a validation failure keeps the dialog, the values and the caret', async ({ page }) => {
  await stubTechnicianApi(page, {
    status: 422,
    body: {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please correct the highlighted field',
        fields: { displayName: 'Required' },
      },
    },
  });

  await page.getByRole('button', { name: 'Add technician' }).click();
  const name = page.getByLabel('Name', { exact: true });
  await name.click();
  await page.keyboard.type('RAHUL');

  await page.getByRole('button', { name: 'Create technician' }).click();

  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Please correct the highlighted field',
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await name.inputValue()).toBe('RAHUL');
});

test('an API failure keeps the dialog and the values', async ({ page }) => {
  await stubTechnicianApi(page, {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } },
  });

  await page.getByRole('button', { name: 'Add technician' }).click();
  await page.getByLabel('Name', { exact: true }).fill('RAHUL');

  await page.getByRole('button', { name: 'Create technician' }).click();

  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Something went wrong');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.getByLabel('Name', { exact: true }).inputValue()).toBe('RAHUL');
});

test('a successful creation closes the dialog', async ({ page }) => {
  await stubTechnicianApi(page, {
    status: 201,
    body: {
      technician: { id: 'ctechnician00000000000009', displayName: 'RAHUL', account: null },
      activationPath: null,
    },
  });

  await page.getByRole('button', { name: 'Add technician' }).click();
  await page.getByLabel('Name', { exact: true }).fill('RAHUL');
  await page.getByRole('button', { name: 'Create technician' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the Edit dialog keeps focus and closes only after the server confirms', async ({ page }) => {
  await stubTechnicianApi(page, {
    status: 200,
    body: { technician: { id: 'ctechnician00000000000001' } },
  });

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const headline = page.getByLabel('Headline', { exact: true });
  await headline.click();
  // Put the caret at the end so the assertion does not depend on where in the
  // field Playwright's click landed.
  await headline.press('End');
  await markNode(page, '#edit-headline');

  const owners = await typeCharacterByCharacter(page, 'SENIOR');
  expect(owners, `activeElement after each keystroke: ${owners.join(', ')}`).toEqual(
    expectedOwners('edit-headline', 6),
  );
  expect(await headline.inputValue()).toBe('AC and refrigerationSENIOR');
  expect(await isSameNode(page, '#edit-headline')).toBe(true);

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

