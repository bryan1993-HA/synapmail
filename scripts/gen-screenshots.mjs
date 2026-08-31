/**
 * gen-screenshots.mjs
 *
 * Generates README screenshots for the Synapmail GitHub repo.
 * Uses a temporary demo user with fictional data injected into the DOM.
 *
 * Requirements: Docker must be running (uses mcr.microsoft.com/playwright image)
 *
 * Usage:
 *   node scripts/gen-screenshots.mjs
 *
 * Output: docs/screenshots/{inbox,compose,settings,mobile}.png
 *
 * ⚠️  RE-RUN THIS SCRIPT whenever the UI changes visually (layout, colors,
 *    new components, redesign). Screenshots shown in the README become stale
 *    otherwise and give a bad first impression to new visitors.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../docs/screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const BASE  = process.env.APP_URL  || 'https://synapmail.bthoury.fr';
const EMAIL = process.env.APP_USER || 'demo@synapmail.test';
const PASS  = process.env.APP_PASS || 'Demo1234!';

const FAKE_EMAILS = [
  { name: 'Alice Martin',      email: 'alice.martin@example.com',   subject: 'Re: Project kickoff — Q3 planning',              preview: "Sounds great! Let me know when you want to schedule the call, I'm available Thursday morning or...", time: '10:42',    unread: true,  starred: false },
  { name: 'GitHub',            email: 'noreply@github.com',         subject: '[synapmail] New pull request: feat/dark-mode',    preview: 'thomas-dupont opened a pull request. This PR improves the dark mode contrast and fixes the...',    time: '09:17',    unread: true,  starred: false },
  { name: 'Stripe',            email: 'receipts@stripe.com',        subject: 'Your receipt from Stripe — $29.00',               preview: 'A payment of $29.00 was made on September 1, 2025. Thank you for your business.',                   time: 'Yesterday', unread: false, starred: true  },
  { name: 'Thomas Dupont',     email: 'thomas.dupont@gmail.com',    subject: 'Quick question about the API',                    preview: "Hey! I was looking at the REST API docs and had a question about authentication...",                time: 'Yesterday', unread: false, starred: false },
  { name: 'Sarah Connor',      email: 's.connor@protonmail.com',    subject: 'Welcome to the team!',                            preview: "Hi everyone, I'm so excited to be joining next week. Looking forward to meeting you all!",          time: 'Mon',       unread: false, starred: false },
  { name: 'Jean-Paul Bernard', email: 'jp.bernard@outlook.com',     subject: 'Fwd: Conference tickets confirmation',            preview: "Forwarding the confirmation for the Paris Tech Summit. We're registered for Oct 14-16.",             time: 'Mon',       unread: false, starred: false },
  { name: 'Notion',            email: 'notify@notion.so',           subject: 'Marie commented on "Product Roadmap"',            preview: 'Marie left a comment: "We should move the mobile release to Q4, the API isn\'t ready yet"',        time: 'Sun',       unread: false, starred: false },
  { name: 'Linear',            email: 'notifications@linear.app',   subject: '[SYN-142] Bug: Reading pane flickers on mobile',  preview: 'Thomas Dupont changed status to In Progress. Assigned to Alice Martin.',                          time: 'Sun',       unread: false, starred: false },
];

async function injectFakeEmailList(page, emails) {
  await page.evaluate((emails) => {
    const rows = emails.map((e, i) => `
      <div style="
        display:flex;align-items:flex-start;gap:12px;
        padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.06);
        cursor:pointer;
        background:${i === 0 ? 'rgba(59,130,246,0.15)' : 'transparent'};
      ">
        <div style="
          width:36px;height:36px;border-radius:50%;flex-shrink:0;
          background:hsl(${(e.name.charCodeAt(0) * 47) % 360},60%,40%);
          display:flex;align-items:center;justify-content:center;
          font-size:14px;font-weight:600;color:white;
        ">${e.name.charAt(0)}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
            <span style="font-size:14px;font-weight:${e.unread ? 600 : 400};color:${e.unread ? 'white' : 'rgba(255,255,255,0.7)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;">${e.name}</span>
            <span style="font-size:12px;color:rgba(255,255,255,0.4);flex-shrink:0;margin-left:8px;">${e.time}</span>
          </div>
          <div style="font-size:13px;font-weight:${e.unread ? 500 : 400};color:${e.unread ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.6)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;">${e.subject}</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e.preview}</div>
        </div>
        ${e.unread ? '<div style="width:8px;height:8px;border-radius:50%;background:#3b82f6;flex-shrink:0;margin-top:4px;"></div>' : ''}
        ${e.starred ? '<div style="color:#f59e0b;flex-shrink:0;font-size:14px;">★</div>' : ''}
      </div>
    `).join('');

    const empty = document.querySelector('[class*="flex-col"][class*="items-center"]');
    if (empty) {
      const container = document.createElement('div');
      container.style.cssText = 'display:flex;flex-direction:column;overflow-y:auto;flex:1;';
      container.innerHTML = rows;
      empty.parentElement?.replaceChild(container, empty);
    }
  }, emails);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const page = await ctx.newPage();

// Login
console.log('Logging in...');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[type="email"], input[name="email"]', EMAIL);
await page.fill('input[type="password"], input[name="password"]', PASS);
await page.click('button[type="submit"]');
await page.waitForURL(`${BASE}/mail`, { timeout: 15000 }).catch(() => {});
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);

// 1. Inbox
await injectFakeEmailList(page, FAKE_EMAILS);
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT_DIR}/inbox.png` });
console.log('✓ inbox.png');

// 2. Compose
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b =>
    /compos|nouveau/i.test(b.textContent.trim())
  );
  btn?.click();
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT_DIR}/compose.png` });
console.log('✓ compose.png');

// 3. Settings
await page.goto(`${BASE}/settings/accounts`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT_DIR}/settings.png` });
console.log('✓ settings.png');

// 4. Mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT_DIR}/mobile.png` });
console.log('✓ mobile.png');

await browser.close();
console.log('\nDone! Commit docs/screenshots/ and push.');
