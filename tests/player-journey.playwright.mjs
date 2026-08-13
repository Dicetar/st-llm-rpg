import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.RPG_PLAYER_JOURNEY_URL ?? 'http://127.0.0.1:18102';
const systemChrome = [
  process.env.RPG_PLAYER_JOURNEY_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(candidate => candidate && existsSync(candidate));
const browser = await chromium.launch({
  headless: true,
  ...(systemChrome ? { executablePath: systemChrome } : {}),
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  await page.getByLabel('New Campaign title').fill('Journey Campaign');
  await page.getByRole('button', { name: 'Create Campaign' }).click();
  await page.getByRole('heading', { name: 'Journey Campaign' }).waitFor();
  const campaignNav = page.getByRole('navigation', { name: 'Campaign sections' });

  await campaignNav.getByRole('link', { name: /^Actors/ }).click();
  await page.getByPlaceholder('Actor name').fill('Mara');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: /Mara/ }).click();
  await page.getByLabel('Summary').fill('A careful archivist with a silver key.');
  await page.getByRole('button', { name: 'Save Actor' }).click();
  await page.getByText(/Saved update_actor as revision/).waitFor();

  await campaignNav.getByRole('link', { name: /^Current Scene/ }).click();
  await page.getByLabel('Name').fill('Moonlit Archive');
  await page.getByLabel('Summary').fill('Dusty shelves surround a locked wardrobe.');
  await page.getByRole('group', { name: 'Present Actors' }).getByLabel('Mara').check();
  await page.getByRole('button', { name: 'Start Scene' }).click();
  await page.getByText(/Saved set_current_scene as revision/).waitFor();
  await page.getByText('Advance Scene', { exact: true }).click();
  await page.getByLabel('Closing summary').fill('Mara opens the archive and keeps the key.');
  await page.getByLabel('Name').last().fill('Hidden Gallery');
  await page.getByLabel('Opening situation').fill('A secret gallery waits beyond the archive.');
  await page.getByRole('button', { name: 'Close current and open next' }).click();
  await page.getByText(/Saved advance_scene as revision/).waitFor();
  await page.getByText(/1 immutable/).waitFor();

  await page.getByLabel('Link a saved SillyTavern chat').selectOption({ index: 1 });
  const linkedResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && response.url().includes(`/api/campaigns/`)
    && response.url().endsWith('/chat-bindings')
  ));
  await page.getByRole('button', { name: 'Link chat' }).click();
  assert.equal((await linkedResponse).status(), 201);

  const sourceCampaignId = new URL(page.url()).pathname.split('/')[2];
  const sourceCurrent = await (await page.request.get(`${baseUrl}/api/campaigns/${sourceCampaignId}`)).json();
  const stale = await page.request.post(`${baseUrl}/api/campaigns/${sourceCampaignId}/operations`, {
    data: {
      requestId: 'browser-stale-operation',
      expectedRevision: sourceCurrent.campaign.revision - 1,
      operation: { kind: 'create_item', item: { name: 'Stale Item' } },
    },
  });
  assert.equal(stale.status(), 409);
  assert.equal((await stale.json()).code, 'CAMPAIGN_REVISION_CONFLICT');

  await campaignNav.getByRole('link', { name: /^Narrator Context/ }).click();
  await page.getByRole('button', { name: 'Save model profile' }).click();
  await page.getByText(/Narrator model profile local-narrator saved/).waitFor();
  await page.getByRole('button', { name: 'Build Context Plan' }).click();
  await page.getByRole('heading', { name: 'Context Plan' }).waitFor();

  await page.request.put(`${baseUrl}/api/story-sync/worker-profile`, {
    data: { modelId: 'journey-worker', requestedOutputTokens: 1200 },
  });
  const bindings = await (await page.request.get(`${baseUrl}/api/campaigns/${sourceCampaignId}/chat-bindings`)).json();
  const started = await page.request.post(`${baseUrl}/api/story-sync/jobs`, {
    data: {
      requestId: 'browser-story-sync',
      bindingId: bindings[0].id,
      profileId: 'worker-default',
      locator: {
        version: 1,
        hostId: 'desktop-host',
        chat: { kind: 'character', ownerId: 'Narrator.png', chatId: 'Journey Chat' },
      },
      messages: [
        { index: 0, role: 'player', name: 'Mara', content: 'I unlock the archive.' },
        { index: 1, role: 'narrator', name: 'Narrator', content: 'The Moonlit Archive opens.' },
      ],
    },
  });
  assert.equal(started.status(), 202);
  const jobId = (await started.json()).jobId;
  let job;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    job = await (await page.request.get(`${baseUrl}/api/story-sync/jobs/${jobId}`)).json();
    if (job.status === 'ready-for-review' || job.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(job.status, 'ready-for-review');
  await campaignNav.getByRole('link', { name: /^Story Updates$/ }).click();
  await page.getByText('The archive was opened').waitFor();
  await page.getByRole('button', { name: 'Accept' }).click();
  await page.getByText(/Suggestion marked accept/).waitFor();
  await page.getByRole('button', { name: 'Apply 1 and finish' }).click();
  await page.getByText(/1 accepted change applied/).waitFor();
  await page.getByRole('button', { name: 'Load latest Campaign' }).click();

  await campaignNav.getByRole('link', { name: /^Session Home$/ }).click();
  const exportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Campaign JSON' }).click();
  const download = await exportDownload;
  assert.match(download.suggestedFilename(), /Journey-Campaign\.campaign\.json/);
  await page.getByLabel('Source revision').fill('2');
  await page.getByLabel('New Campaign title').last().fill('Journey Branch');
  await page.getByRole('button', { name: 'Create branch' }).click();
  await page.getByRole('heading', { name: 'Journey Branch' }).waitFor();
  await page.getByText(/Branched from Journey Campaign at revision 2/).waitFor();

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Archive Campaign' }).click();
  await page.getByText(/This Campaign is archived/).waitFor();
  await page.getByRole('button', { name: 'Restore Campaign' }).click();
  await page.getByText(/Saved set_campaign_archived as revision/).waitFor();

  const mobile = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await mobile.goto(page.url(), { waitUntil: 'networkidle' });
  const bodyWidth = await mobile.evaluate(() => document.body.scrollWidth);
  assert.ok(bodyWidth <= 360, `360px Workspace overflowed to ${bodyWidth}px`);
  await mobile.getByRole('heading', { name: 'Journey Branch' }).waitFor();
  await mobile.close();
} finally {
  await fetch(`${baseUrl}/api/operations/shutdown`, {
    method: 'POST',
    headers: { 'x-wayfinder-run-id': 'player-journey-run' },
  }).catch(() => undefined);
  await new Promise(resolve => setTimeout(resolve, 100));
  await browser.close();
}
