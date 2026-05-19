import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ABANDON_EMAIL_STEPS,
  EMAIL_STEPS,
  appendEmailAttribution,
  buildEmailClickUrl,
  buildResumeUrl,
  shouldConsiderAbandonLead,
  shouldConsiderCheckoutLead,
  statusForLeadSubmission
} from './src/index.js';

test('abandoner sequence has four recovery touches to the height/current-weight resume point', () => {
  assert.deepEqual(ABANDON_EMAIL_STEPS.map(s => s.key), [
    'abandon_20m',
    'abandon_next_morning',
    'abandon_2d',
    'abandon_5d'
  ]);
  assert.equal(ABANDON_EMAIL_STEPS[0].delayMs, 20 * 60 * 1000);
  assert.equal(ABANDON_EMAIL_STEPS[1].delayMs, 12 * 60 * 60 * 1000);
  assert.equal(ABANDON_EMAIL_STEPS[2].delayMs, 2 * 24 * 60 * 60 * 1000);
  assert.equal(ABANDON_EMAIL_STEPS[3].delayMs, 5 * 24 * 60 * 60 * 1000);
  assert.ok(ABANDON_EMAIL_STEPS.every(s => s.ctaTarget === 'resume'));
});

test('resume URL returns user directly to height/current-weight step', () => {
  const url = buildResumeUrl({ id: 'lead-123' }, { SITE_URL: 'https://go.tidemedix.com' });
  assert.equal(url, 'https://go.tidemedix.com/?resume=height_weight&lead=lead-123');
});

test('quiz abandoners are separated from checkout/completed leads', () => {
  assert.equal(statusForLeadSubmission({ leadType: 'quiz_abandon' }, null), 'quiz_abandoned');
  assert.equal(statusForLeadSubmission({ leadType: 'checkout_started' }, null), 'checkout_started');
  assert.equal(statusForLeadSubmission({ leadType: 'checkout_started' }, { status: 'purchased' }), 'purchased');

  const abandon = { email: 'test@example.com', status: 'quiz_abandoned', abandonedAt: new Date().toISOString(), emails: {} };
  const checkout = { email: 'test@example.com', status: 'checkout_started', checkoutStartedAt: new Date().toISOString(), emails: {} };
  assert.equal(shouldConsiderAbandonLead(abandon), true);
  assert.equal(shouldConsiderCheckoutLead(abandon), false);
  assert.equal(shouldConsiderAbandonLead(checkout), false);
  assert.equal(shouldConsiderCheckoutLead(checkout), true);
});

test('email CTA URLs route through the click tracker and preserve destination params', () => {
  const clickUrl = buildEmailClickUrl({ id: 'lead-123' }, { key: 'followup_24h' }, { PUBLIC_BASE_URL: 'https://tidemedix-leads.tylerdefi.workers.dev/' });
  assert.equal(clickUrl, 'https://tidemedix-leads.tylerdefi.workers.dev/api/email-click?id=lead-123&step=followup_24h');

  const destination = appendEmailAttribution('https://tidemedix.com/therapy/weight-loss-glp-1/?c3=transactionId&affId=AA0F177B', 'followup_24h');
  const parsed = new URL(destination);
  assert.equal(parsed.searchParams.get('c3'), 'transactionId');
  assert.equal(parsed.searchParams.get('affId'), 'AA0F177B');
  assert.equal(parsed.searchParams.get('utm_source'), 'email');
  assert.equal(parsed.searchParams.get('utm_medium'), 'followup');
  assert.equal(parsed.searchParams.get('utm_campaign'), 'tidemedix_followup_24h');
  assert.equal(parsed.searchParams.get('src'), 'email_followup_24h');
});

test('completed checkout sequence remains the regular follow-up track', () => {
  assert.deepEqual(EMAIL_STEPS.map(s => s.key), [
    'welcome',
    'followup_2h',
    'followup_24h',
    'followup_72h',
    'followup_5d',
    'followup_10d'
  ]);
});
