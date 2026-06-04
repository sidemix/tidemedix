import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ABANDON_EMAIL_STEPS,
  BUYER_EMAIL_STEPS,
  COMPLETED_NO_PURCHASE_EMAIL_STEPS,
  EMAIL_STEPS,
  appendEmailAttribution,
  buildEmailClickStats,
  buildEmailDeliveryStats,
  buildEmailClickUrl,
  buildResumeUrl,
  buildRimoResumeUrl,
  classifyLeadForDashboard,
  isCompletedNoPurchaseEvent,
  normalizeSesEvent,
  shouldConsiderAbandonLead,
  shouldConsiderBuyerLead,
  shouldConsiderCheckoutLead,
  shouldConsiderCompletedNoPurchaseLead,
  statusForLeadSubmission
} from './src/index.js';

test('abandoner sequence has four recovery touches back to the Rimo intake', () => {
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
  assert.ok(ABANDON_EMAIL_STEPS.every(s => s.ctaTarget === 'intake'));
});

test('resume URL returns user directly to height/current-weight step', () => {
  const url = buildResumeUrl({ id: 'lead-123' }, { SITE_URL: 'https://go.tidemedix.com' });
  assert.equal(url, 'https://go.tidemedix.com/?resume=height_weight&lead=lead-123');
});

test('Rimo resume URL returns saved intake to its latest funnel step', () => {
  const url = buildRimoResumeUrl({
    rimo: { leadKey: 'ldk_Z58BU5UYNUVVBPRPGXE3', lastStep: 'medvaPatientNotes' }
  }, { RIMO_INTAKE_URL: 'https://try.tidemedix.com/intake/mv-xtyd5b' });
  assert.equal(url, 'https://try.tidemedix.com/intake/mv-xtyd5b/medva-patient-notes?email=ldk_Z58BU5UYNUVVBPRPGXE3');
});

test('started-no-completion leads use the abandon recovery sequence', () => {
  assert.equal(statusForLeadSubmission({ leadType: 'quiz_abandon' }, null), 'quiz_abandoned');
  assert.equal(statusForLeadSubmission({ leadType: 'checkout_started' }, null), 'checkout_started');
  assert.equal(statusForLeadSubmission({ leadType: 'checkout_started' }, { status: 'purchased' }), 'purchased');

  const abandon = { email: 'test@example.com', status: 'quiz_abandoned', abandonedAt: new Date().toISOString(), emails: {} };
  const checkout = { email: 'test@example.com', status: 'checkout_started', checkoutStartedAt: new Date().toISOString(), rimo: { progress: 40, lastStep: 'medvaDetailsPrograms', status: 'NEW' }, emails: {} };
  const completed = { email: 'done@example.com', status: 'completed_no_purchase', completedNoPurchaseAt: new Date().toISOString(), rimo: { progress: 100, status: 'COMPLETED' }, emails: {} };
  assert.equal(shouldConsiderAbandonLead(abandon), true);
  assert.equal(shouldConsiderCheckoutLead(abandon), false);
  assert.equal(shouldConsiderAbandonLead(checkout), true);
  assert.equal(shouldConsiderCheckoutLead(checkout), false);
  assert.equal(shouldConsiderAbandonLead(completed), false);
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
  assert.equal(parsed.searchParams.get('utm_content'), 'unknown');
  assert.equal(parsed.searchParams.get('tm_target'), 'unknown');
  assert.equal(parsed.searchParams.get('src'), 'email_followup_24h');
});

test('email attribution can expose the target Rimo step for UTM stats', () => {
  const destination = appendEmailAttribution(
    'https://try.tidemedix.com/intake/mv-xtyd5b/medva-patient-notes?email=ldk_TEST',
    'complete_nopurchase_15m',
    { target: 'intake', rimoStep: 'medva-patient-notes' }
  );
  const parsed = new URL(destination);
  assert.equal(parsed.searchParams.get('utm_campaign'), 'tidemedix_complete_nopurchase_15m');
  assert.equal(parsed.searchParams.get('utm_content'), 'intake__medva-patient-notes');
  assert.equal(parsed.searchParams.get('tm_target'), 'intake');
  assert.equal(parsed.searchParams.get('rimo_step'), 'medva-patient-notes');
});

test('dashboard email click stats summarize target Rimo steps', () => {
  const stats = buildEmailClickStats([
    { step: 'complete_nopurchase_15m', target: 'intake', rimoStep: 'medva-patient-notes', destination: 'https://try.tidemedix.com/intake/mv-xtyd5b/medva-patient-notes?rimo_step=medva-patient-notes', timestamp: '2026-06-04T01:00:00Z' },
    { step: 'complete_nopurchase_15m', target: 'intake', destination: 'https://try.tidemedix.com/intake/mv-xtyd5b/medva-patient-notes?rimo_step=medva-patient-notes', timestamp: '2026-06-04T01:05:00Z' },
    { step: 'buyer_day0', target: 'portal', destination: 'https://try.tidemedix.com/sign-in', timestamp: '2026-06-04T01:10:00Z' }
  ]);
  assert.equal(stats.total, 3);
  assert.equal(stats.byStep.complete_nopurchase_15m, 2);
  assert.equal(stats.byTarget.intake, 2);
  assert.equal(stats.byRimoStep['medva-patient-notes'], 2);
  assert.equal(stats.recent[0].step, 'buyer_day0');
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

test('buyer sequence covers confirmed purchase through refill planning', () => {
  assert.deepEqual(BUYER_EMAIL_STEPS.map(s => s.key), [
    'buyer_day0',
    'buyer_day1',
    'buyer_day3',
    'buyer_day7'
  ]);
  assert.equal(BUYER_EMAIL_STEPS[0].delayMs, 0);
  assert.equal(BUYER_EMAIL_STEPS[1].delayMs, 24 * 60 * 60 * 1000);
  assert.equal(BUYER_EMAIL_STEPS[2].delayMs, 3 * 24 * 60 * 60 * 1000);
  assert.equal(BUYER_EMAIL_STEPS[3].delayMs, 7 * 24 * 60 * 60 * 1000);
  assert.ok(BUYER_EMAIL_STEPS.every(s => s.ctaTarget === 'portal'));

  const buyer = { email: 'buyer@example.com', status: 'purchased', purchasedAt: new Date().toISOString(), emails: {} };
  const oldCheckout = { email: 'lead@example.com', status: 'checkout_started', checkoutStartedAt: new Date().toISOString(), emails: {} };
  assert.equal(shouldConsiderBuyerLead(buyer), true);
  assert.equal(shouldConsiderCheckoutLead(buyer), false);
  assert.equal(shouldConsiderBuyerLead(oldCheckout), false);
});



test('buyer portal fallback points to the Rimo patient sign-in', () => {
  const destination = appendEmailAttribution('https://try.tidemedix.com/sign-in?returnTo=%2F', 'buyer_day0');
  const parsed = new URL(destination);
  assert.equal(parsed.origin + parsed.pathname, 'https://try.tidemedix.com/sign-in');
  assert.equal(parsed.searchParams.get('returnTo'), '/');
  assert.equal(parsed.searchParams.get('utm_campaign'), 'tidemedix_buyer_day0');
});

test('completed-no-purchase sequence targets finished intake without a paid order', () => {
  assert.deepEqual(COMPLETED_NO_PURCHASE_EMAIL_STEPS.map(s => s.key), [
    'complete_nopurchase_15m',
    'complete_nopurchase_24h',
    'complete_nopurchase_3d',
    'complete_nopurchase_7d'
  ]);
  assert.equal(COMPLETED_NO_PURCHASE_EMAIL_STEPS[0].delayMs, 15 * 60 * 1000);
  assert.equal(COMPLETED_NO_PURCHASE_EMAIL_STEPS[1].delayMs, 24 * 60 * 60 * 1000);
  assert.equal(COMPLETED_NO_PURCHASE_EMAIL_STEPS[2].delayMs, 3 * 24 * 60 * 60 * 1000);
  assert.equal(COMPLETED_NO_PURCHASE_EMAIL_STEPS[3].delayMs, 7 * 24 * 60 * 60 * 1000);
  assert.ok(COMPLETED_NO_PURCHASE_EMAIL_STEPS.every(s => s.ctaTarget === 'intake'));

  const completed = { email: 'done@example.com', status: 'completed_no_purchase', completedNoPurchaseAt: new Date().toISOString(), rimo: { progress: 100, status: 'COMPLETED' }, emails: {} };
  const buyer = { email: 'buyer@example.com', status: 'purchased', purchasedAt: new Date().toISOString(), rimo: { progress: 100, status: 'COMPLETED' }, emails: {} };
  assert.equal(shouldConsiderCompletedNoPurchaseLead(completed), true);
  assert.equal(shouldConsiderCompletedNoPurchaseLead(buyer), false);
  assert.equal(shouldConsiderCheckoutLead(completed), false);
});

test('lead dashboard classifies high-progress Rimo checkout leads as hot', () => {
  const now = new Date('2026-06-03T14:00:00Z');
  const hot = classifyLeadForDashboard({
    email: 'test@example.com',
    status: 'checkout_started',
    updatedAt: '2026-06-03T12:00:00Z',
    rimo: { progress: 92, lastStep: 'checkout', status: 'IN_PROGRESS' }
  }, now);
  assert.equal(hot.stage, 'hot_lead');
  assert.equal(hot.priority, 1);

  const completed = classifyLeadForDashboard({ email: 'done@example.com', status: 'completed_no_purchase', rimo: { progress: 100, status: 'COMPLETED' } }, now);
  assert.equal(completed.stage, 'completed_no_purchase');

  const buyer = classifyLeadForDashboard({ email: 'buyer@example.com', status: 'purchased', purchasedAt: '2026-06-03T13:00:00Z' }, now);
  assert.equal(buyer.stage, 'buyer');

  const disqualified = classifyLeadForDashboard({ email: 'dq@example.com', rimo: { disqualified: true, disqualificationReason: 'Not eligible' } }, now);
  assert.equal(disqualified.stage, 'disqualified');
});

test('Rimo completed teleform nested on lead.updated is treated as completed no purchase', () => {
  const payload = {
    type: 'lead.updated',
    data: {
      object: {
        status: 'NEW',
        teleformResponses: [{
          status: 'COMPLETED',
          currentStep: 'medvaPatientNotes',
          completedAt: '2026-06-03T14:33:12.214Z'
        }]
      }
    }
  };

  assert.equal(isCompletedNoPurchaseEvent('lead.updated', payload), true);
});

test('SES delivery stats summarize per-step lifecycle status', () => {
  const stats = buildEmailDeliveryStats([
    {
      id: 'lead-1',
      email: 'one@example.com',
      emailEvents: {
        welcome: { status: 'delivered', messageId: 'm-1', deliveredAt: '2026-06-04T12:00:00Z' },
        followup_2h: { status: 'bounced', messageId: 'm-2', bouncedAt: '2026-06-04T13:00:00Z' }
      }
    },
    {
      id: 'lead-2',
      email: 'two@example.com',
      emailEvents: {
        welcome: { status: 'sent', messageId: 'm-3', sentAt: '2026-06-04T11:00:00Z' }
      }
    }
  ]);
  assert.equal(stats.totals.delivered, 1);
  assert.equal(stats.totals.bounced, 1);
  assert.equal(stats.totals.sent, 1);
  assert.equal(stats.byStep.welcome.delivered, 1);
  assert.equal(stats.byStep.followup_2h.bounced, 1);
  assert.equal(stats.deliveryRate, 0.5);
  assert.equal(stats.recent[0].step, 'followup_2h');
});

test('SES SNS notification normalizer extracts tags, event type, and message id', () => {
  const normalized = normalizeSesEvent({
    eventType: 'Delivery',
    mail: {
      messageId: '0100018f-test',
      timestamp: '2026-06-04T12:00:00.000Z',
      tags: {
        lead_id: ['lead-123'],
        step: ['complete_nopurchase_15m']
      }
    },
    delivery: { timestamp: '2026-06-04T12:00:12.000Z' }
  });
  assert.equal(normalized.messageId, '0100018f-test');
  assert.equal(normalized.leadId, 'lead-123');
  assert.equal(normalized.step, 'complete_nopurchase_15m');
  assert.equal(normalized.status, 'delivered');
  assert.equal(normalized.timestamp, '2026-06-04T12:00:12.000Z');
});
