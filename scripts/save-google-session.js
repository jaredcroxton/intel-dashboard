/**
 * save-google-session.js
 * 
 * Run this ONCE on your laptop to log into Google and save the session.
 * Uses your ACTUAL Chrome browser (not Playwright's Chromium) so Google
 * doesn't block the sign-in.
 * 
 * Usage:
 *   node scripts/save-google-session.js
 */

import { chromium } from 'playwright';
import fs from 'fs';
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Google Session Capture for NotebookLM Automation           ║
║                                                              ║
║  Your real Chrome browser will open. Log into Google.        ║
║  Once NotebookLM loads, come back here and press Enter.      ║
╚══════════════════════════════════════════════════════════════╝
`);

  // Use the system Chrome browser, not Playwright's Chromium
  // Google trusts real Chrome and won't block sign-in
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',  // <-- Uses your actual Chrome install
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    viewport: null,
  });

  // Remove the webdriver flag that Google uses to detect automation
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await page.goto('https://notebooklm.google.com/');

  console.log('🌐 Chrome opened — log into Google now.\n');
  console.log('   Once you see the NotebookLM dashboard loaded,');
  console.log('   come back to this terminal.\n');

  await ask('✅ Press Enter when you are logged in and see NotebookLM... ');

  // Save session state
  const storageState = await context.storageState();
  const sessionPath = './google-session.json';
  fs.writeFileSync(sessionPath, JSON.stringify(storageState, null, 2));

  await browser.close();
  rl.close();

  console.log(`\n✓ Session saved to ${sessionPath}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Copy the contents of google-session.json`);
  console.log(`  2. Go to: https://github.com/jaredcroxton/intel-dashboard/settings/secrets/actions`);
  console.log(`  3. Create a new secret called: GOOGLE_SESSION_JSON`);
  console.log(`  4. Paste the JSON contents as the value`);
  console.log(`\n⚠️  Session cookies expire after ~2 weeks.`);
  console.log(`   Re-run this script and update the secret when they expire.\n`);
}

main();
