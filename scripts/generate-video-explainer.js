/**
 * generate-video-explainer.js
 * 
 * Runs on GitHub Actions (cloud) — your laptop does NOT need to be on.
 * 
 * Flow:
 *   1. Fetches today's briefing HTML from GitHub (SculptOS repo)
 *   2. Opens NotebookLM via Playwright (headless browser)
 *   3. Creates a notebook, uploads the briefing as a source
 *   4. Triggers Video Overview in Explainer mode
 *   5. Waits for generation to complete
 *   6. Grabs the share link
 *   7. Emails the link via Resend
 * 
 * Usage:
 *   node scripts/generate-video-explainer.js apac 2026-05-05
 *   node scripts/generate-video-explainer.js sales 2026-05-04
 *   node scripts/generate-video-explainer.js leadership 2026-05-04
 * 
 * Environment variables required:
 *   RESEND_API_KEY      — API key from resend.com
 *   RECIPIENT_EMAIL     — Where to send the video link
 *   GOOGLE_SESSION_JSON — Serialised Playwright storageState (Google login)
 */

import { chromium } from 'playwright';
import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';

// ─── Config ───────────────────────────────────────────────────────────
const SCULPT_REPO = 'jaredcroxton/SculptOS';
const RAW_BASE = `https://raw.githubusercontent.com/${SCULPT_REPO}/main`;

const TAB_CONFIG = {
  apac: {
    name: 'APAC Daily Intel',
    color: '#C09A5B',
    folder: 'briefings',
    filePattern: (date) => `${date}-apac-travel-briefing.html`,
  },
  sales: {
    name: 'Sales Briefing',
    color: '#1C3559',
    folder: 'sales-briefings',
    filePattern: (date) => `${date}-sales-briefing.html`,
  },
  leadership: {
    name: 'Leadership Briefing',
    color: '#1A3D2E',
    folder: 'leadership-briefings',
    filePattern: (date) => `${date}-leadership-briefing.html`,
  },
};

const NOTEBOOKLM_URL = 'https://notebooklm.google.com/';

// ─── Main ─────────────────────────────────────────────────────────────
const [tab, date] = process.argv.slice(2);

if (!tab || !TAB_CONFIG[tab]) {
  console.error('Usage: node generate-video-explainer.js <apac|sales|leadership> <YYYY-MM-DD>');
  process.exit(1);
}

const config = TAB_CONFIG[tab];
const briefingDate = date || new Date().toISOString().split('T')[0];

async function main() {
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  ${config.name} — Video Explainer`);
  console.log(`  Date: ${briefingDate}`);
  console.log(`══════════════════════════════════════════════\n`);

  // ── Step 1: Fetch the briefing HTML ──
  console.log('[1/6] Fetching briefing HTML...');
  const briefingUrl = `${RAW_BASE}/${config.folder}/${config.filePattern(briefingDate)}`;
  const briefingRes = await fetch(briefingUrl);

  if (!briefingRes.ok) {
    console.error(`  ✗ Briefing not found at: ${briefingUrl}`);
    console.error(`  Status: ${briefingRes.status}`);
    process.exit(1);
  }

  const briefingHtml = await briefingRes.text();
  console.log(`  ✓ Fetched briefing (${(briefingHtml.length / 1024).toFixed(1)} KB)`);

  // ── Step 2: Launch browser with Google session ──
  console.log('[2/6] Launching browser...');

  let storageState;
  if (process.env.GOOGLE_SESSION_JSON) {
    // Running in CI — session is an env var
    storageState = JSON.parse(process.env.GOOGLE_SESSION_JSON);
  } else if (fs.existsSync('./google-session.json')) {
    // Running locally — session is a file
    storageState = JSON.parse(fs.readFileSync('./google-session.json', 'utf8'));
  } else {
    console.error('  ✗ No Google session found.');
    console.error('    Run: node scripts/save-google-session.js');
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  // Increase default timeout for CI
  page.setDefaultTimeout(60_000);

  try {
    // ── Step 3: Navigate to NotebookLM and create notebook ──
    console.log('[3/6] Opening NotebookLM...');
    await page.goto(NOTEBOOKLM_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Take a debug screenshot
    await page.screenshot({ path: `/tmp/nlm-01-home.png` });

    // Click "New notebook" — try multiple selectors since UI may vary
    const newNotebookSelectors = [
      '[aria-label="New notebook"]',
      'button:has-text("New notebook")',
      '[data-testid="new-notebook"]',
      'text=New notebook',
      'text=Create new',
    ];

    let clicked = false;
    for (const sel of newNotebookSelectors) {
      try {
        await page.click(sel, { timeout: 5000 });
        clicked = true;
        console.log(`  ✓ Created new notebook (selector: ${sel})`);
        break;
      } catch { /* try next selector */ }
    }

    if (!clicked) {
      console.error('  ✗ Could not find "New notebook" button');
      await page.screenshot({ path: `/tmp/nlm-error-new.png` });
      process.exit(1);
    }

    await page.waitForTimeout(3000);

    // ── Step 4: Add briefing as source ──
    // The NotebookLM UI auto-opens a "Create Audio and Video Overviews" dialog
    // when a new notebook is created. It shows: Upload files / Websites / Drive / Copied text
    console.log('[4/6] Uploading briefing as source...');

    await page.screenshot({ path: `/tmp/nlm-02-dialog.png` });

    // The source dialog should already be visible. Click "Copied text" directly.
    const copiedTextSelectors = [
      'button:has-text("Copied text")',
      'text=Copied text',
      'button:has-text("Paste text")',
      'text=Paste text',
    ];

    clicked = false;
    for (const sel of copiedTextSelectors) {
      try {
        await page.click(sel, { timeout: 8000 });
        clicked = true;
        console.log(`  ✓ Clicked "Copied text" (selector: ${sel})`);
        break;
      } catch { /* try next */ }
    }

    // If the auto-dialog didn't appear, try clicking "+ Add sources" in the sidebar
    if (!clicked) {
      console.log('  ⚠ Auto-dialog not found, trying sidebar...');
      const sidebarSourceSelectors = [
        'text=Add sources',
        'button:has-text("Add sources")',
        '[aria-label="Add sources"]',
        'text=Add source',
        'button:has-text("Add source")',
      ];

      for (const sel of sidebarSourceSelectors) {
        try {
          await page.click(sel, { timeout: 5000 });
          console.log(`  ✓ Opened source panel (selector: ${sel})`);
          await page.waitForTimeout(2000);
          // Now click "Copied text" in the dialog
          for (const cs of copiedTextSelectors) {
            try {
              await page.click(cs, { timeout: 5000 });
              clicked = true;
              break;
            } catch { /* try next */ }
          }
          if (clicked) break;
        } catch { /* try next */ }
      }
    }

    if (!clicked) {
      console.error('  ✗ Could not find "Copied text" button');
      await page.screenshot({ path: `/tmp/nlm-error-source.png` });
      process.exit(1);
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: `/tmp/nlm-02b-paste-form.png` });

    // Fill in the title if there's a title field
    const titleInput = await page.$('input[placeholder*="title"], input[placeholder*="Title"], input[placeholder*="Source name"], input[aria-label*="title"], input[aria-label*="name"]');
    if (titleInput) {
      await titleInput.fill(`${config.name} — ${briefingDate}`);
      console.log('  ✓ Title set');
    }

    // Paste the briefing content into the text area
    const textArea = await page.$('textarea, [contenteditable="true"], [role="textbox"]');
    if (textArea) {
      await textArea.fill(briefingHtml);
      console.log('  ✓ Briefing content pasted');
    } else {
      console.error('  ✗ Could not find text input for source content');
      await page.screenshot({ path: `/tmp/nlm-error-paste.png` });
      process.exit(1);
    }

    await page.screenshot({ path: `/tmp/nlm-02c-filled.png` });

    // Click "Insert" / "Add" / "Save"
    const insertSelectors = [
      'button:has-text("Insert")',
      'button:has-text("Add")',
      'button:has-text("Save")',
      'button:has-text("Submit")',
      'button:has-text("Done")',
    ];

    for (const sel of insertSelectors) {
      try {
        await page.click(sel, { timeout: 3000 });
        console.log(`  ✓ Source submitted (selector: ${sel})`);
        break;
      } catch { /* try next */ }
    }

    await page.waitForTimeout(5000);
    await page.screenshot({ path: `/tmp/nlm-02d-source-added.png` });
    console.log('  ✓ Source added');

    // ── Step 5: Generate Video Overview (Explainer mode) ──
    console.log('[5/6] Generating video explainer...');

    // Open Studio panel
    const studioSelectors = [
      'text=Studio',
      '[aria-label="Studio"]',
      'button:has-text("Studio")',
    ];

    for (const sel of studioSelectors) {
      try {
        await page.click(sel, { timeout: 5000 });
        break;
      } catch { /* try next */ }
    }

    await page.waitForTimeout(2000);

    // Click "Video Overview"
    const videoSelectors = [
      'text=Video Overview',
      'text=Video overview',
      'button:has-text("Video")',
    ];

    for (const sel of videoSelectors) {
      try {
        await page.click(sel, { timeout: 5000 });
        break;
      } catch { /* try next */ }
    }

    await page.waitForTimeout(2000);

    // Select "Explainer" mode if available
    const explainerSelectors = [
      'text=Explainer',
      'button:has-text("Explainer")',
      '[data-testid="explainer"]',
    ];

    for (const sel of explainerSelectors) {
      try {
        await page.click(sel, { timeout: 3000 });
        break;
      } catch { /* try next */ }
    }

    await page.waitForTimeout(1000);

    // Set focus/instructions if the field exists
    const focusInput = await page.$('[placeholder*="focus"], [placeholder*="instructions"], textarea[aria-label*="focus"]');
    if (focusInput) {
      await focusInput.fill(
        `Summarise the key takeaways from today's ${config.name}. ` +
        `Focus on actionable insights for an Accor Plus sales director ` +
        `selling hotel memberships across India, Thailand, Indonesia, ` +
        `Philippines, Vietnam, Australia, and New Zealand. ` +
        `Highlight the most critical market moves and competitor activity.`
      );
    }

    // Click "Generate"
    const generateSelectors = [
      'button:has-text("Generate")',
      'button:has-text("Create")',
      '[aria-label="Generate"]',
    ];

    for (const sel of generateSelectors) {
      try {
        await page.click(sel, { timeout: 5000 });
        console.log('  ✓ Video generation triggered');
        break;
      } catch { /* try next */ }
    }

    await page.screenshot({ path: `/tmp/nlm-03-generating.png` });

    // Wait for video to complete (can take 2-10 minutes)
    console.log('  ⏳ Waiting for video generation (this can take up to 10 minutes)...');

    const completionSelectors = [
      '[aria-label="Play"]',
      '[aria-label="Download"]',
      'button:has-text("Play")',
      '[data-testid="video-player"]',
      'video',
    ];

    let videoReady = false;
    const maxWait = 600_000; // 10 minutes
    const pollInterval = 15_000; // Check every 15 seconds
    const startTime = Date.now();

    while (!videoReady && (Date.now() - startTime) < maxWait) {
      for (const sel of completionSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: pollInterval });
          videoReady = true;
          break;
        } catch { /* keep waiting */ }
      }

      if (!videoReady) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`  ⏳ Still generating... (${elapsed}s elapsed)`);
      }
    }

    if (!videoReady) {
      console.error('  ✗ Video generation timed out after 10 minutes');
      await page.screenshot({ path: `/tmp/nlm-error-timeout.png` });
      process.exit(1);
    }

    console.log('  ✓ Video generation complete!');
    await page.screenshot({ path: `/tmp/nlm-04-complete.png` });

    // ── Step 6: Get the share link ──
    console.log('[6/6] Getting share link...');

    // Grab the notebook URL as fallback (the video is embedded in the notebook)
    const notebookUrl = page.url();

    // Try to get a direct share link
    let shareLink = notebookUrl;
    const shareSelectors = [
      '[aria-label="Share"]',
      'button:has-text("Share")',
      '[aria-label="More options"]',
    ];

    for (const sel of shareSelectors) {
      try {
        await page.click(sel, { timeout: 5000 });
        await page.waitForTimeout(1500);

        // Try "Copy link"
        const copyLink = await page.$('text=Copy link');
        if (copyLink) {
          await copyLink.click();
          await page.waitForTimeout(500);
          // Read from clipboard
          shareLink = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
          if (shareLink) {
            console.log(`  ✓ Share link obtained`);
            break;
          }
        }

        // Close any dialog that opened
        await page.keyboard.press('Escape');
      } catch { /* try next */ }
    }

    // If clipboard didn't work, use notebook URL
    if (!shareLink || shareLink === notebookUrl) {
      shareLink = notebookUrl;
      console.log(`  ✓ Using notebook URL as link`);
    }

    await browser.close();

    // ── Step 7: Email the link ──
    console.log('\n📧 Sending email...');
    await sendEmail(tab, briefingDate, shareLink);
    console.log('  ✓ Email sent!');

    console.log(`\n══════════════════════════════════════════════`);
    console.log(`  ✓ Done! Video explainer link emailed.`);
    console.log(`══════════════════════════════════════════════\n`);

  } catch (err) {
    console.error('\n✗ Error:', err.message);
    await page.screenshot({ path: `/tmp/nlm-error-crash.png` }).catch(() => {});
    await browser.close();
    process.exit(1);
  }
}

// ─── Email ────────────────────────────────────────────────────────────
async function sendEmail(tab, date, videoLink) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const config = TAB_CONFIG[tab];
  const recipient = process.env.RECIPIENT_EMAIL;

  if (!recipient) {
    console.error('  ✗ RECIPIENT_EMAIL not set');
    process.exit(1);
  }

  const dateFormatted = new Date(date + 'T00:00:00Z').toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  await resend.emails.send({
    from: 'Intel Dashboard <onboarding@resend.dev>',  // Change to your verified domain
    to: [recipient],
    subject: `${config.name} — Video Ready · ${date}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f8f6f0; font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6f0; padding:2rem 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        
        <!-- Gold accent bar -->
        <tr><td style="height:4px; background: linear-gradient(90deg, ${config.color} 0%, ${lighten(config.color)} 50%, ${config.color} 100%);"></td></tr>
        
        <!-- Content -->
        <tr><td style="padding: 2.5rem 2.5rem 2rem;">
          
          <!-- Eyebrow -->
          <p style="margin:0 0 1.5rem; font-size:0.7rem; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:${config.color};">
            ${config.name} · Video Explainer
          </p>
          
          <!-- Date -->
          <h1 style="margin:0 0 0.75rem; font-family: Georgia, 'Times New Roman', serif; font-size:1.6rem; font-weight:700; color:#111018; letter-spacing:-0.02em; line-height:1.2;">
            ${dateFormatted}
          </h1>
          
          <!-- Description -->
          <p style="margin:0 0 2rem; font-size:0.92rem; color:#3a3948; line-height:1.65;">
            Your video explainer is ready. Tap below to watch — covers today's key intel in a few minutes.
          </p>
          
          <!-- CTA Button -->
          <a href="${videoLink}" 
             style="display:inline-block; background:#111018; color:${config.color}; 
                    font-family: Georgia, serif; font-weight:700; font-size:0.95rem;
                    padding:0.9rem 2.2rem; border-radius:999px; text-decoration:none;
                    letter-spacing:-0.01em;">
            ▶ &thinsp; Watch Video Explainer
          </a>
          
          <!-- Dashboard link -->
          <p style="margin:1.75rem 0 0;">
            <a href="https://intel-dashboard.vercel.app/#${tab}" 
               style="color:${config.color}; font-size:0.82rem; font-weight:500; text-decoration:none;">
              Open full dashboard →
            </a>
          </p>
          
        </td></tr>
        
        <!-- Footer -->
        <tr><td style="padding:1.25rem 2.5rem; border-top:1px solid #e8e3d8;">
          <p style="margin:0; color:#a5a4b5; font-size:0.72rem;">
            APAC Daily Intel · Powered by performOS · 7am Brisbane
          </p>
        </td></tr>
        
      </table>
    </td></tr>
  </table>
</body>
</html>
    `,
  });
}

function lighten(hex) {
  // Simple hex lightener for gradient effect
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.min(255, r + 40);
  const lg = Math.min(255, g + 40);
  const lb = Math.min(255, b + 40);
  return `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`;
}

main();
