import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ABANDON_EMAIL_STEPS,
  BUYER_EMAIL_STEPS,
  COMPLETED_NO_PURCHASE_EMAIL_STEPS,
  EMAIL_STEPS,
  appendEmailAttribution,
  buildEmailClickStats,
  buildEmailDeliveryStats,
  buildLeadEventStats,
  buildMetaPurchaseEventPayload,
  buildRouteAuditRow,
  buildEmailClickUrl,
  buildCheckoutBridgeUrl,
  buildBridgeContinueClickUrl,
  buildCheckoutBridgeContinueUrl,
  buildResumeUrl,
  buildRimoResumeUrl,
  isRetatrutideLead,
  classifyLeadForDashboard,
  extractAttributionFromLeadBody,
  isCompletedNoPurchaseEvent,
  mergeLeadAttribution,
  normalizeSesEvent,
  shouldConsiderAbandonLead,
  shouldConsiderBuyerLead,
  shouldConsiderCheckoutLead,
  shouldConsiderCompletedNoPurchaseLead,
  statusForLeadSubmission
} from './src/index.js';

test('lead-event stats reconcile raw submissions against new unique leads', () => {
  const stats = buildLeadEventStats([
    { source: 'go_email_capture', leadType: 'quiz_abandon', status: 'quiz_abandoned', isNewLead: true, createdAt: '2026-06-09T10:00:00Z' },
    { source: 'checkout_bridge', leadType: 'checkout_started', status: 'checkout_started', isNewLead: false, createdAt: '2026-06-09T10:05:00Z' },
    { source: 'rimo_customjs', leadType: 'rimo_customjs', status: 'completed_no_purchase', isNewLead: false, createdAt: '2026-06-10T10:00:00Z' }
  ]);

  assert.equal(stats.totalEvents, 3);
  assert.equal(stats.newUniqueLeads, 1);
  assert.equal(stats.repeatSubmissions, 2);
  assert.equal(stats.bySource.go_email_capture, 1);
  assert.equal(stats.bySource.checkout_bridge, 1);
  assert.equal(stats.bySource.rimo_customjs, 1);
  assert.equal(stats.byDay['2026-06-09'], 2);
});

test('lead attribution is extracted from Rimo page URLs', () => {
  const attribution = extractAttributionFromLeadBody({
    page: 'https://go.tidemedix.com/?utm_source=facebook&utm_medium=paid&utm_campaign=Leads-WellnessCenter-Customers&utm_content=Pill%20Pull%20Out%20Box&utm_term=WellnessCenter-Customers-Lookalike&fbclid=FB123',
    attribution: { source: 'rimo_customjs' }
  });

  assert.equal(attribution.utm_source, 'facebook');
  assert.equal(attribution.utm_medium, 'paid');
  assert.equal(attribution.utm_campaign, 'Leads-WellnessCenter-Customers');
  assert.equal(attribution.utm_content, 'Pill Pull Out Box');
  assert.equal(attribution.utm_term, 'WellnessCenter-Customers-Lookalike');
  assert.equal(attribution.fbclid, 'FB123');
  assert.equal(attribution.source, 'rimo_customjs');
});

test('lead attribution merge preserves existing UTMs when later Rimo posts omit them', () => {
  const attribution = mergeLeadAttribution(
    { utm_source: 'facebook', utm_campaign: 'Campaign A', utm_content: 'Ad A' },
    { attribution: { source: 'rimo_customjs' }, page: 'https://try.tidemedix.com/intake/mv-xtyd5b' }
  );

  assert.equal(attribution.utm_source, 'facebook');
  assert.equal(attribution.utm_campaign, 'Campaign A');
  assert.equal(attribution.utm_content, 'Ad A');
  assert.equal(attribution.source, 'rimo_customjs');
});

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

test('Retatrutide follow-up links resume the dedicated Retatrutide checkout funnel', () => {
  const lead = {
    id: 'lead-rt-123',
    attribution: {
      utm_campaign: 'Leads-WellnessCenter-Customers',
      utm_content: 'Ad 1 — Clinic / Provider Visual',
      tm_target: 'retatrutide_landing'
    },
    rimo: { leadKey: 'ldk_RT_TEST', lastStep: 'checkout' }
  };

  assert.equal(isRetatrutideLead(lead), true);

  const resume = buildRimoResumeUrl(lead, { RIMO_INTAKE_URL: 'https://try.tidemedix.com/intake/mv-xtyd5b' });
  const parsedResume = new URL(resume);
  assert.equal(parsedResume.origin + parsedResume.pathname, 'https://try.tidemedix.com/intake/rt-qbe927/checkout');
  assert.equal(parsedResume.searchParams.get('email'), 'ldk_RT_TEST');

  const continueUrl = buildCheckoutBridgeContinueUrl(lead, { RIMO_INTAKE_URL: 'https://try.tidemedix.com/intake/mv-xtyd5b' }, 'complete_nopurchase_15m');
  const parsedContinue = new URL(continueUrl);
  assert.equal(parsedContinue.origin + parsedContinue.pathname, 'https://try.tidemedix.com/intake/rt-qbe927/checkout');
  assert.equal(parsedContinue.searchParams.get('email'), 'ldk_RT_TEST');
  assert.equal(parsedContinue.searchParams.get('tm_target'), 'intake');
  assert.equal(parsedContinue.searchParams.get('rimo_step'), 'checkout');
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
    { step: 'abandon_20m', target: 'intake', rimoStep: 'medva-patient-notes', destination: 'https://try.tidemedix.com/intake/mv-xtyd5b/medva-patient-notes?rimo_step=medva-patient-notes&tm_target=intake', timestamp: '2026-06-04T01:00:00Z' },
    { step: 'abandon_20m', target: 'intake', destination: 'https://try.tidemedix.com/intake/mv-xtyd5b/medva-patient-notes?rimo_step=medva-patient-notes&tm_target=intake', timestamp: '2026-06-04T01:05:00Z' },
    { step: 'buyer_day0', target: 'portal', destination: 'https://try.tidemedix.com/sign-in?tm_target=portal', timestamp: '2026-06-04T01:10:00Z' }
  ]);
  assert.equal(stats.total, 3);
  assert.equal(stats.byStep.abandon_20m, 2);
  assert.equal(stats.byTarget.intake, 2);
  assert.equal(stats.byRimoStep['medva-patient-notes'], 2);
  assert.equal(stats.routeStatus.ok, 3);
  assert.equal(stats.routeStatus.bad, 0);
  assert.equal(stats.routeAudit[0].status, 'ok');
  assert.equal(stats.recent[0].step, 'buyer_day0');
});

test('route audit flags expected vs actual email destinations', () => {
  const ok = buildRouteAuditRow({
    step: 'abandon_20m',
    target: 'intake',
    rimoStep: 'medva-patient-notes',
    destination: 'https://try.tidemedix.com/intake/mv-xtyd5b/medva-patient-notes?tm_target=intake&rimo_step=medva-patient-notes'
  });
  assert.equal(ok.expectedTarget, 'intake');
  assert.equal(ok.actualTarget, 'intake');
  assert.equal(ok.expectedRimoStep, 'medva-patient-notes');
  assert.equal(ok.actualRimoStep, 'medva-patient-notes');
  assert.equal(ok.status, 'ok');

  const mismatch = buildRouteAuditRow({
    step: 'abandon_20m',
    target: 'intake',
    rimoStep: 'medva-patient-notes',
    destination: 'https://tidemedix.com/therapy/weight-loss-glp-1/?tm_target=product'
  });
  assert.equal(mismatch.expectedTarget, 'intake');
  assert.equal(mismatch.actualTarget, 'product');
  assert.equal(mismatch.status, 'bad');
  assert.equal(mismatch.statusLabel, 'Needs Review');

  const bridgeOk = buildRouteAuditRow({
    step: 'complete_nopurchase_15m',
    target: 'intake',
    rimoStep: 'medva-payment',
    destination: 'https://try.tidemedix.com/intake/mv-xtyd5b/medva-payment?tm_target=intake&rimo_step=medva-payment',
    bridgeDestination: 'https://links.tidemedix.com/checkout-bridge?id=lead-123&step=complete_nopurchase_15m'
  });
  assert.equal(bridgeOk.expectedTarget, 'bridge');
  assert.equal(bridgeOk.actualTarget, 'intake');
  assert.equal(bridgeOk.expectedRimoStep, 'medva-payment');
  assert.equal(bridgeOk.status, 'ok');

  const bridgeHostOnly = buildRouteAuditRow({
    step: 'complete_nopurchase_15m',
    target: 'bridge',
    destination: 'https://links.tidemedix.com/checkout-bridge?id=lead-123&step=complete_nopurchase_15m&tm_target=bridge'
  });
  assert.equal(bridgeHostOnly.status, 'bad');
});

test('route audit sorts Needs Review rows ahead of OK rows', () => {
  const stats = buildEmailClickStats([
    { step: 'welcome', target: 'checkout', destination: 'https://try.tidemedix.com/intake/mv-xtyd5b/checkout?tm_target=checkout', timestamp: '2026-06-04T02:00:00Z' },
    { step: 'abandon_20m', target: 'intake', rimoStep: 'medva-patient-notes', destination: 'https://tidemedix.com/therapy/weight-loss-glp-1/?tm_target=product', timestamp: '2026-06-04T01:00:00Z' }
  ]);
  assert.equal(stats.routeAudit[0].status, 'bad');
  assert.equal(stats.routeAudit[0].statusLabel, 'Needs Review');
  assert.equal(stats.routeAudit[1].status, 'ok');
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
  assert.ok(COMPLETED_NO_PURCHASE_EMAIL_STEPS.every(s => s.ctaTarget === 'bridge'));

  const bridgeUrl = buildCheckoutBridgeUrl({ id: 'lead-123' }, { PUBLIC_BASE_URL: 'https://links.tidemedix.com' }, 'complete_nopurchase_15m');
  const parsedBridge = new URL(bridgeUrl);
  assert.equal(parsedBridge.origin + parsedBridge.pathname, 'https://links.tidemedix.com/checkout-bridge');
  assert.equal(parsedBridge.searchParams.get('id'), 'lead-123');
  assert.equal(parsedBridge.searchParams.get('tm_target'), 'bridge');
  assert.equal(parsedBridge.searchParams.get('utm_campaign'), 'tidemedix_complete_nopurchase_15m');

  const bridgeContinueClickUrl = buildBridgeContinueClickUrl({ id: 'lead-123' }, { PUBLIC_BASE_URL: 'https://links.tidemedix.com' }, 'complete_nopurchase_15m');
  const parsedContinueClick = new URL(bridgeContinueClickUrl);
  assert.equal(parsedContinueClick.origin + parsedContinueClick.pathname, 'https://links.tidemedix.com/api/bridge-continue');
  assert.equal(parsedContinueClick.searchParams.get('id'), 'lead-123');
  assert.equal(parsedContinueClick.searchParams.get('step'), 'complete_nopurchase_15m');

  const completed = { email: 'done@example.com', status: 'completed_no_purchase', completedNoPurchaseAt: new Date().toISOString(), rimo: { progress: 100, status: 'COMPLETED' }, emails: {} };
  const buyer = { email: 'buyer@example.com', status: 'purchased', purchasedAt: new Date().toISOString(), rimo: { progress: 100, status: 'COMPLETED' }, emails: {} };
  assert.equal(shouldConsiderCompletedNoPurchaseLead(completed), true);
  assert.equal(shouldConsiderCompletedNoPurchaseLead(buyer), false);
  assert.equal(shouldConsiderCheckoutLead(completed), false);
});

test('checkout bridge continues to saved Rimo step when leadKey is present', () => {
  const continueUrl = buildCheckoutBridgeContinueUrl({
    id: 'lead-123',
    checkoutUrl: 'https://try.tidemedix.com/intake/mv-xtyd5b/checkout?email=stale',
    rimo: { leadKey: 'ldk_TEST', lastStep: 'medvaPatientNotes' }
  }, { RIMO_INTAKE_URL: 'https://try.tidemedix.com/intake/mv-xtyd5b' }, 'complete_nopurchase_15m');

  const parsed = new URL(continueUrl);
  assert.equal(parsed.origin + parsed.pathname, 'https://try.tidemedix.com/intake/mv-xtyd5b/medva-patient-notes');
  assert.equal(parsed.searchParams.get('email'), 'ldk_TEST');
  assert.equal(parsed.searchParams.get('tm_target'), 'intake');
  assert.equal(parsed.searchParams.get('rimo_step'), 'medva-patient-notes');
  assert.equal(parsed.searchParams.get('utm_campaign'), 'tidemedix_complete_nopurchase_15m_bridge_continue');
});

test('checkout bridge falls back to checkout URL when Rimo leadKey is missing', () => {
  const continueUrl = buildCheckoutBridgeContinueUrl({
    id: 'lead-123',
    checkoutUrl: 'https://try.tidemedix.com/intake/mv-xtyd5b/checkout?session=abc',
    rimo: { lastStep: 'checkout' }
  }, { RIMO_INTAKE_URL: 'https://try.tidemedix.com/intake/mv-xtyd5b' }, 'complete_nopurchase_15m');

  const parsed = new URL(continueUrl);
  assert.equal(parsed.origin + parsed.pathname, 'https://try.tidemedix.com/intake/mv-xtyd5b/checkout');
  assert.equal(parsed.searchParams.get('session'), 'abc');
  assert.equal(parsed.searchParams.get('tm_target'), 'checkout');
  assert.equal(parsed.searchParams.get('rimo_step'), null);
});

test('checkout bridge normalizes stale generic Rimo intake slugs to current intake', () => {
  const continueUrl = buildCheckoutBridgeContinueUrl({
    id: 'lead-123',
    checkoutUrl: 'https://try.tidemedix.com/intake/mv-xtyd5b/checkout?session=abc',
    rimo: { lastStep: 'checkout' }
  }, { RIMO_INTAKE_URL: 'https://try.tidemedix.com/intake/wm-4ltue5' }, 'complete_nopurchase_15m');

  const parsed = new URL(continueUrl);
  assert.equal(parsed.origin + parsed.pathname, 'https://try.tidemedix.com/intake/wm-4ltue5/checkout');
  assert.equal(parsed.searchParams.get('session'), 'abc');
  assert.equal(parsed.searchParams.get('tm_target'), 'checkout');
});

test('Retatrutide checkout bridge ignores stale generic checkout URLs when leadKey is missing', () => {
  const continueUrl = buildCheckoutBridgeContinueUrl({
    id: 'lead-rt-no-key',
    checkoutUrl: 'https://try.tidemedix.com/intake/mv-xtyd5b/checkout?session=stale',
    attribution: { tm_target: 'retatrutide_landing' },
    rimo: { lastStep: 'checkout' }
  }, { RIMO_INTAKE_URL: 'https://try.tidemedix.com/intake/mv-xtyd5b' }, 'complete_nopurchase_15m');

  const parsed = new URL(continueUrl);
  assert.equal(parsed.origin + parsed.pathname, 'https://try.tidemedix.com/intake/rt-qbe927/checkout');
  assert.equal(parsed.searchParams.get('session'), null);
  assert.equal(parsed.searchParams.get('tm_target'), 'intake');
  assert.equal(parsed.searchParams.get('rimo_step'), 'checkout');
});

test('Retatrutide checkout bridge keeps the saved rt-qbe927 page when present', () => {
  const continueUrl = buildCheckoutBridgeContinueUrl({
    id: 'lead-rt-saved-page',
    checkoutUrl: 'https://try.tidemedix.com/intake/rt-qbe927/gender?email=ldk_SAVED',
    attribution: { tm_target: 'retatrutide_landing' },
    rimo: { lastStep: 'checkout' }
  }, { RIMO_INTAKE_URL: 'https://try.tidemedix.com/intake/mv-xtyd5b' }, 'complete_nopurchase_15m');

  const parsed = new URL(continueUrl);
  assert.equal(parsed.origin + parsed.pathname, 'https://try.tidemedix.com/intake/rt-qbe927/gender');
  assert.equal(parsed.searchParams.get('email'), 'ldk_SAVED');
  assert.equal(parsed.searchParams.get('tm_target'), 'intake');
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

test('Worker CAPI only sends Purchase events and does not server-send InitiateCheckout', () => {
  const source = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
  assert.match(source, /event_name:\s*'Purchase'/);
  assert.doesNotMatch(source, /event_name:\s*['"]InitiateCheckout['"]/);
  assert.doesNotMatch(source, /eventName:\s*['"]InitiateCheckout['"]/);
  assert.doesNotMatch(source, /sendMeta(?:[A-Za-z0-9_]*)InitiateCheckout/);
});

test('Meta Purchase CAPI payload hashes customer data and preserves value/currency', async () => {
  const request = new Request('https://links.tidemedix.com/api/purchase', {
    headers: {
      'cf-connecting-ip': '203.0.113.10',
      'user-agent': 'node-test-agent'
    }
  });
  const payload = await buildMetaPurchaseEventPayload({
    id: 'lead-123',
    email: 'Buyer@Example.com ',
    phone: '(941) 555-1212',
    firstName: 'Jane',
    lastName: 'Buyer',
    checkoutUrl: 'https://try.tidemedix.com/intake/mv-xtyd5b/checkout',
    value: 149,
    purchase: { orderId: 'order-789', amount: 149, currency: 'USD' },
    attribution: { fbclid: 'FBCLID123' }
  }, request, {});

  const event = payload.data[0];
  assert.equal(event.event_name, 'Purchase');
  assert.equal(event.event_id, 'order-789');
  assert.equal(event.action_source, 'website');
  assert.equal(event.event_source_url, 'https://try.tidemedix.com/intake/mv-xtyd5b/checkout');
  assert.equal(event.custom_data.currency, 'USD');
  assert.equal(event.custom_data.value, 149);
  assert.equal(event.user_data.em[0], '6a6c26195c3682faa816966af789717c3bfa834eee6c599d667d2b3429c27cfd');
  assert.equal(event.user_data.client_ip_address, '203.0.113.10');
  assert.equal(event.user_data.client_user_agent, 'node-test-agent');
  assert.match(event.user_data.fbc, /^fb\.1\.\d+\.FBCLID123$/);
});

test('Meta Purchase CAPI payload reads Rimo charge cents from data.object', async () => {
  const payload = await buildMetaPurchaseEventPayload({
    id: 'lead-rimo',
    email: 'buyer@example.com',
    purchase: { orderId: 'charge-123', currency: 'USD' },
    checkoutUrl: 'https://try.tidemedix.com/intake/mv-xtyd5b/checkout'
  }, null, {
    type: 'charge.captured',
    data: {
      object: {
        amount: 78500,
        capturedAmount: 78500,
        invoice: { total: 78500 },
        customer: { email: 'buyer@example.com' }
      }
    }
  });

  const event = payload.data[0];
  assert.equal(event.event_id, 'charge-123');
  assert.equal(event.custom_data.currency, 'USD');
  assert.equal(event.custom_data.value, 785);
});

test('purchase webhooks only enqueue buyer email and Meta CAPI when the purchase is newly marked', () => {
  const source = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
  assert.match(source, /if \(result\.marked\) \{\s*enqueueBuyerDayZero\(env, result\.lead, ctx\);\s*enqueueMetaPurchaseEvent\(env, result\.lead, request, body, ctx\);\s*\}/s);
  assert.match(source, /if \(purchaseResult\?\.marked\) \{\s*enqueueBuyerDayZero\(env, purchaseResult\?\.lead, ctx\);\s*enqueueMetaPurchaseEvent\(env, purchaseResult\?\.lead, request, payload, ctx\);\s*\}/s);
  assert.match(source, /duplicate: Boolean\(result\.duplicate\)/);
});

test('repeat purchase webhooks are detected after Meta has already accepted the buyer event', () => {
  const source = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
  assert.match(source, /const alreadyPurchased = Boolean\(lead\.purchasedAt \|\| lead\.status === 'purchased'\);/);
  assert.match(source, /const alreadySentToMeta = Boolean\(lead\.meta\?\.purchase\?\.ok\);/);
  assert.match(source, /return \{ email, leadId: id, marked: false, duplicate: true, lead \};/);
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
