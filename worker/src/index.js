const CORS_ORIGINS = new Set([
  'https://go.tidemedix.com',
  'https://checkout.tidemedix.com',
  'https://gotidemedix.com',
  'https://tidemedix.com',
  'http://localhost:8787',
  'http://127.0.0.1:8787'
]);

const PRODUCT_LINKS = {
  semaglutide: 'https://tidemedix.com/therapy/weight-loss-glp-1/?c3=transactionId&affId=AA0F177B',
  tirzepatide: 'https://tidemedix.com/therapy/tirzepatide/?c3=transactionId&affId=AA0F177B'
};

// Drip schedule for people who finish the quiz/contact step and begin checkout.
// The "welcome" email at index 0 is sent inline from /api/lead, not by the cron.
// Remaining steps are sent by the hourly cron based on checkoutStartedAt.
export const EMAIL_STEPS = [
  { key: 'welcome',       delayMs: 0,                              subject: (n) => `Your TideMedix intake${n ? `, ${n}` : ''}`,         template: renderWelcomeEmail,     ctaTarget: 'checkout' },
  { key: 'followup_2h',   delayMs: 2 * 60 * 60 * 1000,             subject: () => 'Your TideMedix intake',                    template: renderTwoHourEmail,     ctaTarget: 'product'  },
  { key: 'followup_24h',  delayMs: 24 * 60 * 60 * 1000,            subject: () => 'Your TideMedix information is saved',    template: renderDayOneEmail,      ctaTarget: 'product'  },
  { key: 'followup_72h',  delayMs: 72 * 60 * 60 * 1000,            subject: () => 'A note from TideMedix',            template: renderDayThreeEmail,    ctaTarget: 'product'  },
  { key: 'followup_5d',   delayMs: 5 * 24 * 60 * 60 * 1000,        subject: () => 'Your TideMedix intake is still saved', template: renderDayFiveEmail, ctaTarget: 'product' },
  { key: 'followup_10d',  delayMs: 10 * 24 * 60 * 60 * 1000,       subject: () => 'Last note from TideMedix',                                  template: renderDayTenEmail,      ctaTarget: 'product'  }
];

// Separate recovery sequence for people who submit contact info, then leave
// before completing intake/purchase. These emails resume through Rimo's intake.
export const ABANDON_EMAIL_STEPS = [
  { key: 'abandon_20m',          delayMs: 20 * 60 * 1000,             subject: () => 'Your TideMedix assessment',             template: renderAbandonTwentyMinuteEmail, ctaTarget: 'intake' },
  { key: 'abandon_next_morning', delayMs: 12 * 60 * 60 * 1000,        subject: () => 'Your TideMedix assessment is saved',              template: renderAbandonNextMorningEmail,  ctaTarget: 'intake' },
  { key: 'abandon_2d',           delayMs: 2 * 24 * 60 * 60 * 1000,    subject: () => 'A note about your TideMedix assessment',        template: renderAbandonTwoDayEmail,       ctaTarget: 'intake' },
  { key: 'abandon_5d',           delayMs: 5 * 24 * 60 * 60 * 1000,    subject: () => 'Final note from TideMedix',      template: renderAbandonFiveDayEmail,      ctaTarget: 'intake' }
];

// Post-purchase care path for completed + purchased customers. These messages
// are service-oriented: confirm the order, set review expectations, and keep
// the patient oriented toward refill/retention without making outcome claims.
export const BUYER_EMAIL_STEPS = [
  { key: 'buyer_day0', delayMs: 0,                       subject: () => 'Your TideMedix order is confirmed',       template: renderBuyerDayZeroEmail,  ctaTarget: 'portal' },
  { key: 'buyer_day1', delayMs: 24 * 60 * 60 * 1000,     subject: () => 'Your intake is being reviewed',          template: renderBuyerDayOneEmail,   ctaTarget: 'portal' },
  { key: 'buyer_day3', delayMs: 3 * 24 * 60 * 60 * 1000, subject: () => 'What to expect next from TideMedix',     template: renderBuyerDayThreeEmail, ctaTarget: 'portal' },
  { key: 'buyer_day7', delayMs: 7 * 24 * 60 * 60 * 1000, subject: () => 'Planning your next month with TideMedix', template: renderBuyerDaySevenEmail, ctaTarget: 'portal' }
];

// Completed + no purchase path: the person made it through the intake/checkout
// flow far enough to be actionable, but no paid order is recorded yet.
export const COMPLETED_NO_PURCHASE_EMAIL_STEPS = [
  { key: 'complete_nopurchase_15m', delayMs: 15 * 60 * 1000,          subject: () => 'Your TideMedix intake is saved', template: renderCompletedNoPurchaseFifteenMinuteEmail, ctaTarget: 'intake' },
  { key: 'complete_nopurchase_24h', delayMs: 24 * 60 * 60 * 1000,     subject: () => 'A note about your TideMedix intake', template: renderCompletedNoPurchaseDayOneEmail,        ctaTarget: 'intake' },
  { key: 'complete_nopurchase_3d',  delayMs: 3 * 24 * 60 * 60 * 1000, subject: () => 'Your TideMedix information is still saved',   template: renderCompletedNoPurchaseDayThreeEmail,      ctaTarget: 'intake' },
  { key: 'complete_nopurchase_7d',  delayMs: 7 * 24 * 60 * 60 * 1000, subject: () => 'Final note from TideMedix',      template: renderCompletedNoPurchaseDaySevenEmail,      ctaTarget: 'intake' }
];

const ALL_EMAIL_STEPS = [
  ...EMAIL_STEPS,
  ...ABANDON_EMAIL_STEPS,
  ...BUYER_EMAIL_STEPS,
  ...COMPLETED_NO_PURCHASE_EMAIL_STEPS
];

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return corsResponse(request, null, 204);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json(request, { ok: true, service: 'tidemedix-leads' });
      if (url.pathname === '/leads' && request.method === 'GET') return handleLeadDashboard(request, env);
      if (url.pathname === '/api/leads' && request.method === 'GET') return handleLeadDashboardApi(request, env);
      if (url.pathname === '/api/leads-summary' && request.method === 'GET') return handleLeadDashboardApi(request, env);
      if (url.pathname === '/api/test-followup' && request.method === 'POST') return handleTestFollowup(request, env);
      if (url.pathname === '/api/lead' && request.method === 'POST') return handleLead(request, env, ctx);
      if (url.pathname === '/api/rimo-client-lead' && ['GET', 'POST'].includes(request.method)) return handleRimoClientLead(request, env, ctx);
      if (url.pathname === '/api/resume' && request.method === 'GET') return handleResume(request, env);
      if (url.pathname === '/api/purchase' && request.method === 'POST') return handlePurchase(request, env, ctx);
      if (url.pathname === '/api/purchased' && request.method === 'POST') return handlePurchase(request, env, ctx);
      if (url.pathname === '/api/rimo-webhook' && request.method === 'POST') return handleRimoWebhook(request, env, ctx);
      if (url.pathname === '/api/email-click' && request.method === 'GET') return handleEmailClick(request, env);
      if (url.pathname === '/api/ses-event' && request.method === 'POST') return handleSesEvent(request, env, ctx);
      if (url.pathname === '/api/unsubscribe' && request.method === 'GET') return handleUnsubscribe(request, env);
      return json(request, { ok: false, error: 'not_found' }, 404);
    } catch (error) {
      console.error(error);
      return json(request, { ok: false, error: 'server_error' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runFollowups(env));
  }
};

async function handleLeadDashboard(request, env) {
  const auth = authorizeLeadDashboard(request, env);
  if (!auth.ok) return new Response(renderLeadLoginPage(auth.error), { status: auth.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  return new Response(renderLeadDashboardPage(), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function handleLeadDashboardApi(request, env) {
  const auth = authorizeLeadDashboard(request, env);
  if (!auth.ok) return json(request, { ok: false, error: auth.error }, auth.status);

  const url = new URL(request.url);
  const view = clean(url.searchParams.get('view') || 'summary');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
  const leads = await listStoredLeads(env, 1000);
  const clicks = await listStoredEmailClicks(env, 500);
  const summary = buildLeadViews(leads);
  const emailClickStats = buildEmailClickStats(clicks);

  if (view && view !== 'summary') {
    const rows = summary.views[view] || [];
    return json(request, { ok: true, view, count: rows.length, leads: rows.slice(0, limit), generatedAt: summary.generatedAt });
  }

  return json(request, {
    ok: true,
    generatedAt: summary.generatedAt,
    totalLeads: summary.totalLeads,
    counts: summary.counts,
    emailClickStats,
    emailDeliveryStats: buildEmailDeliveryStats(leads),
    views: Object.fromEntries(Object.entries(summary.views).map(([key, rows]) => [key, rows.slice(0, limit)]))
  });
}

async function handleSesEvent(request, env, ctx) {
  const configured = clean(env.SES_EVENT_TOKEN || '');
  if (!configured) return json(request, { ok: false, error: 'ses_event_token_not_configured' }, 503);

  const url = new URL(request.url);
  const supplied = clean(url.searchParams.get('token') || request.headers.get('x-ses-event-token') || '').replace(/^Bearer\s+/i, '');
  if (!supplied || !safeEqual(supplied, configured)) return json(request, { ok: false, error: 'unauthorized' }, 401);

  const envelope = await request.json().catch(() => null);
  if (!envelope || typeof envelope !== 'object') return json(request, { ok: false, error: 'invalid_json' }, 400);

  // AWS SNS requires a one-time subscription confirmation. Confirming here is
  // safe because this endpoint is token-protected and does not touch lead state.
  if (envelope.Type === 'SubscriptionConfirmation' && envelope.SubscribeURL) {
    ctx?.waitUntil?.(fetch(envelope.SubscribeURL).catch(err => console.error('sns_subscription_confirmation_failed', err)));
    return json(request, { ok: true, type: 'SubscriptionConfirmation' });
  }

  if (envelope.Type !== 'Notification') return json(request, { ok: true, ignored: true, type: clean(envelope.Type || 'unknown') });

  let message;
  try {
    message = typeof envelope.Message === 'string' ? JSON.parse(envelope.Message) : envelope.Message;
  } catch (_) {
    return json(request, { ok: false, error: 'invalid_sns_message' }, 400);
  }
  const normalized = normalizeSesEvent(message, envelope);
  if (!normalized.messageId) return json(request, { ok: false, error: 'missing_message_id' }, 400);

  const updated = await recordSesEvent(env, normalized);
  return json(request, { ok: true, eventType: normalized.eventType, messageId: normalized.messageId, leadId: updated.leadId || '', step: updated.step || '', updated: updated.updated });
}

function authorizeLeadDashboard(request, env) {
  const configured = clean(env.LEADS_DASHBOARD_TOKEN || env.ADMIN_TOKEN || '');
  if (!configured) return { ok: false, status: 503, error: 'dashboard_token_not_configured' };
  const url = new URL(request.url);
  const queryToken = clean(url.searchParams.get('token') || '').replace(/^Bearer\s+/i, '');
  const bearerToken = clean((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  const headerToken = clean(request.headers.get('x-dashboard-token') || '');
  const supplied = queryToken || bearerToken || headerToken;
  if (!supplied || !safeEqual(supplied, configured)) return { ok: false, status: 401, error: 'unauthorized' };
  return { ok: true, status: 200 };
}

async function handleTestFollowup(request, env) {
  const auth = authorizeLeadDashboard(request, env);
  if (!auth.ok) return json(request, { ok: false, error: auth.error }, auth.status);

  const body = await request.json().catch(() => ({}));
  const email = clean(body.email || '');
  const stepKey = clean(body.step || 'complete_nopurchase_15m');
  if (!email || !email.includes('@')) return json(request, { ok: false, error: 'valid_email_required' }, 400);

  const step = ALL_EMAIL_STEPS.find(s => s.key === stepKey);
  if (!step) return json(request, { ok: false, error: 'unknown_step' }, 400);

  const now = new Date().toISOString();
  const lead = {
    id: `test-${crypto.randomUUID()}`,
    email,
    firstName: clean(body.firstName || 'Tyler'),
    status: 'completed_no_purchase',
    completedNoPurchaseAt: now,
    createdAt: now,
    updatedAt: now,
    rimo: { progress: 100, status: 'COMPLETED', lastStep: 'checkout' },
    emails: {}
  };
  await env.TIDEMEDIX_LEADS.put(`lead:${lead.id}`, JSON.stringify(lead), { expirationTtl: 7 * 24 * 60 * 60 });

  const testStep = {
    ...step,
    subject: (name) => `[TEST] ${typeof step.subject === 'function' ? step.subject(name) : step.subject}`
  };
  await sendFollowup(env, lead, testStep);

  return json(request, {
    ok: true,
    email,
    step: stepKey,
    leadId: lead.id,
    clickUrl: buildEmailClickUrl(lead, step, env),
    expectedDestination: trackedDestinationForStep(lead, step, env, stepKey)
  });
}

async function listStoredLeads(env, max = 1000) {
  const leads = [];
  let cursor;
  do {
    const page = await env.TIDEMEDIX_LEADS.list({ prefix: 'lead:', cursor, limit: 100 });
    cursor = page.cursor;
    for (const key of page.keys) {
      const id = key.name.replace(/^lead:/, '');
      const lead = await getLead(env, id);
      if (lead?.email) leads.push(sanitizeLeadForDashboard(lead));
      if (leads.length >= max) return sortLeads(leads);
    }
  } while (cursor);
  return sortLeads(leads);
}

async function listStoredEmailClicks(env, max = 500) {
  const clicks = [];
  let cursor;
  do {
    const page = await env.TIDEMEDIX_LEADS.list({ prefix: 'click:', cursor, limit: 100 });
    cursor = page.cursor;
    for (const key of page.keys) {
      const raw = await env.TIDEMEDIX_LEADS.get(key.name);
      if (!raw) continue;
      try {
        const event = JSON.parse(raw);
        clicks.push(sanitizeEmailClickForDashboard(event));
      } catch (_) {}
      if (clicks.length >= max) return sortEmailClicks(clicks);
    }
  } while (cursor);
  return sortEmailClicks(clicks);
}

function sanitizeEmailClickForDashboard(event) {
  return {
    id: clean(event.id || ''),
    leadId: clean(event.leadId || ''),
    step: clean(event.step || 'unknown'),
    target: clean(event.target || 'unknown'),
    rimoStep: clean(event.rimoStep || ''),
    destination: clean(event.destination || ''),
    timestamp: clean(event.timestamp || '')
  };
}

function sortEmailClicks(clicks) {
  return clicks.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
}

export function buildEmailClickStats(clicks = []) {
  const byStep = {};
  const byRimoStep = {};
  const byTarget = {};
  const audited = sortRouteAuditRows(sortEmailClicks(clicks).map(buildRouteAuditRow));
  const routeStatus = { ok: 0, warn: 0, bad: 0 };

  for (const click of clicks) {
    const step = clean(click.step || 'unknown') || 'unknown';
    const target = clean(click.target || 'unknown') || 'unknown';
    const rimoStep = clean(click.rimoStep || '') || rimoStepFromDestination(click.destination) || '';
    byStep[step] = (byStep[step] || 0) + 1;
    byTarget[target] = (byTarget[target] || 0) + 1;
    if (rimoStep) byRimoStep[rimoStep] = (byRimoStep[rimoStep] || 0) + 1;
  }

  for (const row of audited) {
    routeStatus[row.status] = (routeStatus[row.status] || 0) + 1;
  }

  return {
    total: clicks.length,
    byStep: sortCountMap(byStep),
    byTarget: sortCountMap(byTarget),
    byRimoStep: sortCountMap(byRimoStep),
    routeStatus,
    routeAudit: audited.slice(0, 25),
    recent: sortEmailClicks(clicks).slice(0, 25)
  };
}

export function buildRouteAuditRow(click = {}) {
  const stepKey = clean(click.step || 'unknown') || 'unknown';
  const expectedStep = ALL_EMAIL_STEPS.find(s => s.key === stepKey);
  const expectedTarget = clean(expectedStep?.ctaTarget || 'unknown') || 'unknown';
  const actualTarget = targetFromDestination(click.destination) || clean(click.target || '') || 'unknown';
  const expectedRimoStep = expectedTarget === 'intake'
    ? (clean(click.rimoStep || '') || rimoStepParamFromDestination(click.destination) || rimoStepFromDestination(click.destination) || '')
    : '';
  const actualRimoStep = expectedTarget === 'intake' ? (rimoStepFromDestination(click.destination) || '') : '';
  const targetMatches = expectedTarget === actualTarget;
  const rimoMatches = expectedTarget !== 'intake' || !expectedRimoStep || expectedRimoStep === actualRimoStep;
  const missing = actualTarget === 'unknown' || (expectedTarget === 'intake' && !actualRimoStep);
  const status = !targetMatches ? 'bad' : (rimoMatches ? 'ok' : (missing ? 'warn' : 'bad'));

  return {
    id: clean(click.id || ''),
    leadId: clean(click.leadId || ''),
    step: stepKey,
    label: labelEmailStep(stepKey),
    expectedTarget,
    actualTarget,
    expectedRimoStep,
    expectedRimoStepLabel: labelRimoStep(expectedRimoStep),
    actualRimoStep,
    actualRimoStepLabel: labelRimoStep(actualRimoStep),
    status,
    statusLabel: status === 'ok' ? 'Route OK' : (status === 'warn' ? 'Check' : 'Needs Review'),
    destination: clean(click.destination || ''),
    timestamp: clean(click.timestamp || '')
  };
}

export function buildEmailDeliveryStats(leads = []) {
  const totals = { sent: 0, delivered: 0, bounced: 0, complained: 0, rejected: 0, failed: 0, unknown: 0 };
  const byStep = {};
  const recent = [];

  for (const lead of leads) {
    const events = lead.emailEvents || {};
    for (const [step, event] of Object.entries(events)) {
      const status = normalizeDeliveryStatus(event?.status || event?.eventType || 'unknown');
      totals[status] = (totals[status] || 0) + 1;
      byStep[step] = byStep[step] || { sent: 0, delivered: 0, bounced: 0, complained: 0, rejected: 0, failed: 0, unknown: 0 };
      byStep[step][status] = (byStep[step][status] || 0) + 1;
      recent.push({
        leadId: clean(lead.id || ''),
        email: clean(lead.email || ''),
        step,
        status,
        messageId: clean(event?.messageId || ''),
        timestamp: clean(event?.lastEventAt || event?.deliveredAt || event?.bouncedAt || event?.complainedAt || event?.rejectedAt || event?.sentAt || '')
      });
    }
  }

  recent.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  const delivered = Number(totals.delivered || 0);
  const terminalFailures = Number(totals.bounced || 0) + Number(totals.complained || 0) + Number(totals.rejected || 0) + Number(totals.failed || 0);
  const terminal = delivered + terminalFailures;

  return {
    totals,
    byStep: Object.fromEntries(Object.entries(byStep).sort((a, b) => a[0].localeCompare(b[0]))),
    deliveryRate: terminal ? delivered / terminal : null,
    recent: recent.slice(0, 25)
  };
}

function normalizeDeliveryStatus(value) {
  const s = clean(value || '').toLowerCase();
  if (s.includes('delivery') || s === 'delivered') return 'delivered';
  if (s.includes('bounce')) return 'bounced';
  if (s.includes('complaint')) return 'complained';
  if (s.includes('reject')) return 'rejected';
  if (s.includes('failure') || s.includes('failed')) return 'failed';
  if (s.includes('send') || s === 'sent') return 'sent';
  return 'unknown';
}

function rimoStepParamFromDestination(destination) {
  try {
    const url = new URL(destination || '');
    return clean(url.searchParams.get('rimo_step') || '');
  } catch (_) {
    return '';
  }
}

function targetFromDestination(destination) {
  try {
    const url = new URL(destination || '');
    return clean(url.searchParams.get('tm_target') || '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  } catch (_) {
    return '';
  }
}

function rimoStepFromDestination(destination) {
  try {
    const url = new URL(destination || '');
    const fromParam = clean(url.searchParams.get('rimo_step') || '');
    if (fromParam) return fromParam;
    const parts = url.pathname.split('/').map(p => clean(p)).filter(Boolean);
    const intakeIndex = parts.findIndex(p => p === 'intake');
    if (intakeIndex >= 0 && parts[intakeIndex + 2]) return rimoStepSlug(parts[intakeIndex + 2]);
    return '';
  } catch (_) {
    return '';
  }
}

function labelEmailStep(stepKey) {
  const labels = {
    welcome: 'Welcome',
    followup_2h: 'Follow-up: 2h',
    followup_24h: 'Follow-up: 24h',
    followup_72h: 'Follow-up: 72h',
    followup_5d: 'Follow-up: 5d',
    followup_10d: 'Follow-up: 10d',
    abandon_20m: 'Abandoner: 20m',
    abandon_next_morning: 'Abandoner: Next Morning',
    abandon_2d: 'Abandoner: 2d',
    abandon_5d: 'Abandoner: 5d',
    buyer_day0: 'Buyer: Day 0',
    buyer_day1: 'Buyer: Day 1',
    buyer_day3: 'Buyer: Day 3',
    buyer_day7: 'Buyer: Day 7',
    complete_nopurchase_15m: 'Completed No Purchase: 15m',
    complete_nopurchase_24h: 'Completed No Purchase: 24h',
    complete_nopurchase_3d: 'Completed No Purchase: 3d',
    complete_nopurchase_7d: 'Completed No Purchase: 7d'
  };
  return labels[stepKey] || clean(stepKey || 'Unknown').replace(/_/g, ' ');
}

function sortCountMap(map) {
  return Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function sortRouteAuditRows(rows = []) {
  const priority = { bad: 0, warn: 1, ok: 2 };
  return rows.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
}

function labelRimoStep(value) {
  const raw = clean(value || '');
  if (!raw) return '';
  const slug = rimoStepSlug(raw);
  const labels = {
    checkout: 'Checkout',
    'height-weight': 'Height + Weight',
    'medva-patient-notes': 'Patient Notes',
    'medva-create-account': 'Create Account',
    'medva-details-programs': 'Program Details',
    'medva-details-program': 'Program Details',
    'medva-demographics': 'Demographics',
    'medva-medical-history': 'Medical History',
    'medva-shipping': 'Shipping',
    'medva-payment': 'Payment'
  };
  if (labels[slug]) return labels[slug];
  return slug.split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function sortLeads(leads) {
  return leads.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
}

function sanitizeLeadForDashboard(lead) {
  const dashboard = classifyLeadForDashboard(lead, new Date());
  const attribution = lead.attribution || {};
  return {
    id: lead.id,
    email: lead.email,
    firstName: lead.firstName || '',
    lastName: lead.lastName || '',
    phone: lead.phone || '',
    status: lead.status || '',
    leadStage: dashboard.stage,
    priority: dashboard.priority,
    reason: dashboard.reason,
    plan: lead.plan || '',
    value: Number(lead.value || lead.purchase?.amount || 0),
    checkoutUrl: lead.checkoutUrl || '',
    resumeUrl: buildResumeUrl(lead),
    lastStep: lead.rimo?.lastStep || '',
    lastStepLabel: labelRimoStep(lead.rimo?.lastStep || ''),
    progress: Number(lead.rimo?.progress || 0),
    rimoStatus: lead.rimo?.status || '',
    rimoLeadId: lead.rimo?.leadId || '',
    rimoResponseToken: lead.rimo?.responseToken || '',
    restoreId: lead.rimo?.restoreId || lead.rimo?.responseToken || '',
    disqualified: Boolean(lead.rimo?.disqualified || lead.status === 'disqualified'),
    disqualificationReason: lead.rimo?.disqualificationReason || '',
    createdAt: lead.createdAt || '',
    updatedAt: lead.updatedAt || '',
    checkoutStartedAt: lead.checkoutStartedAt || '',
    abandonedAt: lead.abandonedAt || '',
    purchasedAt: lead.purchasedAt || '',
    unsubscribedAt: lead.unsubscribedAt || '',
    emails: lead.emails || {},
    emailEvents: lead.emailEvents || {},
    clicks: lead.clicks || {},
    attribution,
    utm_source: attribution.utm_source || '',
    utm_medium: attribution.utm_medium || '',
    utm_campaign: attribution.utm_campaign || '',
    utm_content: attribution.utm_content || '',
    utm_term: attribution.utm_term || '',
    fbclid: attribution.fbclid || ''
  };
}

const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'clickid', 'affId'];

export function extractAttributionFromLeadBody(body = {}) {
  const nested = (body.attribution && typeof body.attribution === 'object') ? body.attribution : {};
  const attribution = { ...nested };

  for (const key of ATTRIBUTION_KEYS) {
    if (!attribution[key] && body[key]) attribution[key] = clean(body[key]);
  }

  for (const rawUrl of [body.page, body.url, body.checkoutUrl, body.referrer, body.referrerUrl]) {
    if (!rawUrl) continue;
    try {
      const parsed = new URL(rawUrl);
      for (const key of ATTRIBUTION_KEYS) {
        const value = parsed.searchParams.get(key);
        if (value && !attribution[key]) attribution[key] = clean(value);
      }
    } catch (_) {}
  }

  return Object.fromEntries(Object.entries(attribution).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

export function mergeLeadAttribution(existingAttribution = {}, body = {}) {
  const extracted = extractAttributionFromLeadBody(body);
  return {
    ...(existingAttribution || {}),
    ...extracted
  };
}

export function classifyLeadForDashboard(lead, now = new Date()) {
  const status = clean(lead?.status || '').toLowerCase();
  const rimoStatus = clean(lead?.rimo?.status || '').toLowerCase();
  const lastStep = clean(lead?.rimo?.lastStep || '').toLowerCase();
  const progress = Number(lead?.rimo?.progress || 0);
  const purchased = Boolean(lead?.purchasedAt || status === 'purchased');
  const disqualified = Boolean(lead?.rimo?.disqualified || status === 'disqualified' || /disqual/.test(rimoStatus));
  const unsubscribed = Boolean(lead?.unsubscribedAt);
  const updatedAt = new Date(lead?.updatedAt || lead?.createdAt || now).getTime();
  const checkoutAt = new Date(lead?.checkoutStartedAt || lead?.updatedAt || lead?.createdAt || now).getTime();
  const ageMs = Math.max(0, now.getTime() - Math.min(updatedAt || now.getTime(), checkoutAt || now.getTime()));
  const checkoutLike = /checkout|payment|patient|notes|createaccount|account/.test(lastStep) || status === 'checkout_started' || Boolean(lead?.checkoutUrl);
  const completedNoPurchase = isCompletedNoPurchaseLead(lead);

  if (purchased) return { stage: 'buyer', priority: 0, reason: 'Purchased' };
  if (disqualified) return { stage: 'disqualified', priority: 4, reason: lead?.rimo?.disqualificationReason || 'Disqualified in Rimo' };
  if (unsubscribed) return { stage: 'unsubscribed', priority: 5, reason: 'Unsubscribed' };
  if (completedNoPurchase) return { stage: 'completed_no_purchase', priority: 1, reason: 'Completed intake but no purchase recorded' };
  if (checkoutLike && progress >= 75) return { stage: 'hot_lead', priority: 1, reason: `${progress}% complete${lead?.rimo?.lastStep ? ` · ${lead.rimo.lastStep}` : ''}` };
  if (checkoutLike) return { stage: 'checkout_abandoned', priority: 2, reason: lead?.rimo?.lastStep ? `Stopped at ${lead.rimo.lastStep}` : 'Checkout started' };
  if (status === 'quiz_abandoned') return { stage: 'form_started', priority: 3, reason: 'Started assessment but did not finish' };
  if (ageMs >= 60 * 60 * 1000) return { stage: 'needs_follow_up', priority: 3, reason: 'No purchase after 1+ hour' };
  return { stage: 'new_lead', priority: 3, reason: 'New lead' };
}

function buildLeadViews(leads) {
  const today = new Date().toISOString().slice(0, 10);
  const views = {
    hot_leads: [],
    completed_no_purchase: [],
    checkout_abandoners: [],
    new_leads_today: [],
    buyers: [],
    needs_follow_up: [],
    disqualified: [],
    all: leads
  };

  for (const lead of leads) {
    if (lead.leadStage === 'hot_lead') views.hot_leads.push(lead);
    if (lead.leadStage === 'completed_no_purchase') views.completed_no_purchase.push(lead);
    if (lead.leadStage === 'checkout_abandoned' || lead.leadStage === 'hot_lead') views.checkout_abandoners.push(lead);
    if ((lead.createdAt || lead.updatedAt || '').slice(0, 10) === today) views.new_leads_today.push(lead);
    if (lead.leadStage === 'buyer') views.buyers.push(lead);
    if (!lead.purchasedAt && !lead.unsubscribedAt && ['completed_no_purchase', 'hot_lead', 'checkout_abandoned', 'form_started', 'needs_follow_up'].includes(lead.leadStage)) views.needs_follow_up.push(lead);
    if (lead.leadStage === 'disqualified') views.disqualified.push(lead);
  }

  for (const key of Object.keys(views)) views[key] = sortLeads(views[key]);
  return {
    generatedAt: new Date().toISOString(),
    totalLeads: leads.length,
    counts: Object.fromEntries(Object.entries(views).map(([key, rows]) => [key, rows.length])),
    views
  };
}

function renderLeadLoginPage(error) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>TideMedix Leads</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#07161a;color:#eaf7f6;padding:32px;max-width:720px;margin:auto}input,button{font:inherit;padding:12px;border-radius:10px;border:1px solid #2d555c}button{background:#43d3c4;color:#041013;font-weight:700;cursor:pointer}.card{background:#0d252b;border:1px solid #1f454c;border-radius:18px;padding:24px}</style></head><body><div class="card"><h1>TideMedix Lead Dashboard</h1><p>Status: ${escapeHtml(error || 'token required')}.</p><form onsubmit="event.preventDefault(); const t=document.querySelector('#token').value.trim(); if(t) location.href='/leads?token='+encodeURIComponent(t);"><input id="token" type="password" placeholder="Dashboard token" autofocus> <button>Open</button></form></div></body></html>`;
}

function renderLeadDashboardPage() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TideMedix Leads</title>
<style>
:root{color-scheme:dark;--bg:#061417;--panel:#0d252b;--line:#1f454c;--muted:#8bb5b8;--text:#eaf7f6;--accent:#43d3c4;--hot:#ffca66;--bad:#ff7b7b;--good:#61d394}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#061417,#10262a);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:1280px;margin:0 auto;padding:28px}h1{margin:0 0 6px;font-size:28px}p{color:var(--muted)}.top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.grid{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:12px;margin:22px 0}.card{background:rgba(13,37,43,.92);border:1px solid var(--line);border-radius:18px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.18)}.metric{cursor:pointer}.metric.active{outline:2px solid var(--accent)}.metric b{display:block;font-size:30px}.metric span{color:var(--muted);font-size:13px}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 18px}.tabs button{background:#0d252b;color:var(--text);border:1px solid var(--line);border-radius:999px;padding:10px 14px;cursor:pointer}.tabs button.active{background:var(--accent);color:#041013;font-weight:800}.table{overflow:auto}.row,.head{display:grid;grid-template-columns:1.35fr .9fr .75fr .65fr .9fr .9fr .8fr;gap:10px;align-items:center;min-width:980px;padding:12px 10px;border-bottom:1px solid rgba(255,255,255,.07)}.head{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}.name{font-weight:750}.sub{color:var(--muted);font-size:12px;margin-top:2px}.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:4px 8px;font-size:12px;color:var(--muted)}.hot{color:var(--hot)}.good{color:var(--good)}.bad{color:var(--bad)}a{color:var(--accent)}.bar{height:8px;background:#16373d;border-radius:999px;overflow:hidden}.bar i{display:block;height:100%;background:var(--accent)}.small{font-size:12px;color:var(--muted)}@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}.top{display:block}}
</style></head><body><main><div class="top"><div><h1>TideMedix Lead Cockpit</h1><p>Rimo funnel events, buyers, abandoners, and follow-up priority from the TideMedix Worker.</p></div><div class="small" id="stamp">Loading…</div></div><section class="grid" id="metrics"></section><section class="card" id="clickStats"></section><section class="card"><div class="tabs" id="tabs"></div><div class="table"><div class="head"><div>Lead</div><div>Stage</div><div>Progress</div><div>Value</div><div>Last Step</div><div>Updated</div><div>Actions</div></div><div id="rows"></div></div></section></main>
<script>
const token=new URL(location.href).searchParams.get('token')||localStorage.tidemedixLeadToken||''; if(token) localStorage.tidemedixLeadToken=token;
const labels={hot_leads:'Hot Leads',completed_no_purchase:'Completed No Purchase',checkout_abandoners:'Checkout Abandoners',new_leads_today:'New Today',buyers:'Buyers',needs_follow_up:'Needs Follow-up',disqualified:'Disqualified',all:'All Leads'};
let data=null, current='hot_leads';
function esc(s){return String(s||'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function ago(s){if(!s)return ''; const ms=Date.now()-new Date(s).getTime(); const h=Math.floor(ms/36e5); if(h<1)return Math.max(0,Math.floor(ms/6e4))+'m ago'; if(h<48)return h+'h ago'; return Math.floor(h/24)+'d ago'}
function mapRows(m){const e=Object.entries(m||{}); return e.length?e.map(([k,v])=>'<span class="pill">'+esc(k)+': '+v+'</span>').join(' '):'<span class="small">No clicks yet</span>'}
function routeStatusPills(m){const ok=Number(m&&m.ok||0), warn=Number(m&&m.warn||0), bad=Number(m&&m.bad||0); return '<span class="pill good">OK: '+ok+'</span> <span class="pill hot">Check: '+warn+'</span> <span class="pill bad">Needs Review: '+bad+'</span>'}
function auditStatusClass(s){return s==='ok'?'good':(s==='bad'?'bad':'hot')}
function stepLabel(c){return c.label||c.step||'unknown'}
function routeAuditRows(rows){return (rows||[]).slice(0,10).map(c=>'<div class="row" style="grid-template-columns:1.2fr .65fr .65fr .9fr .9fr .75fr .65fr;min-width:1040px"><div><div class="name">'+esc(stepLabel(c))+'</div><div class="sub">'+esc(c.step)+'</div></div><div>'+esc(c.expectedTarget||'—')+'</div><div>'+esc(c.actualTarget||'—')+'</div><div>'+esc(c.expectedRimoStepLabel||c.expectedRimoStep||'—')+'</div><div>'+esc(c.actualRimoStepLabel||c.actualRimoStep||'—')+'</div><div><span class="pill '+auditStatusClass(c.status)+'">'+esc(c.statusLabel||c.status)+'</span></div><div>'+ago(c.timestamp)+'</div></div>').join('')}
function renderClickStats(){const s=data.emailClickStats||{total:0,byStep:{},byTarget:{},byRimoStep:{},routeStatus:{},routeAudit:[]}; const d=data.emailDeliveryStats||{totals:{},deliveryRate:null,recent:[]}; const pct=d.deliveryRate==null?'pending':Math.round(d.deliveryRate*1000)/10+'%'; document.getElementById('clickStats').innerHTML='<h2 style="margin:0 0 8px;font-size:18px">Email Delivery + Route Audit</h2><p style="margin-top:0">SES confirms provider delivery. Route audit surfaces Needs Review first, then Checks, then OK routes. Needs Review means the email expected one destination but the clicked link tracked a different target.</p><div class="grid" style="grid-template-columns:repeat(4,minmax(160px,1fr));margin:12px 0"><div><div class="small">Delivery status</div>'+mapRows(d.totals)+'</div><div><div class="small">Delivery rate</div><span class="pill">'+pct+'</span></div><div><div class="small">Route audit</div>'+routeStatusPills(s.routeStatus)+'</div><div><div class="small">Clicks by Rimo step</div>'+mapRows(s.byRimoStep)+'</div></div><div class="grid" style="grid-template-columns:repeat(2,minmax(220px,1fr));margin:12px 0"><div><div class="small">Clicks by email</div>'+mapRows(s.byStep)+'</div><div><div class="small">Recent delivery events</div>'+((d.recent||[]).slice(0,6).map(e=>'<span class="pill">'+esc(e.step)+': '+esc(e.status)+'</span>').join(' ')||'<span class="small">No SES events yet</span>')+'</div></div><div class="table"><div class="head" style="grid-template-columns:1.2fr .65fr .65fr .9fr .9fr .75fr .65fr;min-width:1040px"><div>Email Step</div><div>Expected Target</div><div>Actual Target</div><div>Expected Rimo Step</div><div>Actual Rimo Step</div><div>Status</div><div>Clicked</div></div>'+routeAuditRows(s.routeAudit)+'</div>'}
function render(){document.getElementById('stamp').textContent='Updated '+new Date(data.generatedAt).toLocaleString()+' · '+data.totalLeads+' total';
 const metricKeys=['hot_leads','completed_no_purchase','checkout_abandoners','buyers','needs_follow_up'];
 document.getElementById('metrics').innerHTML=metricKeys.map(k=>\`<div class="card metric \${current===k?'active':''}" onclick="show('\${k}')"><b>\${data.counts[k]||0}</b><span>\${labels[k]}</span></div>\`).join('');
 renderClickStats();
 const tabs=['hot_leads','completed_no_purchase','checkout_abandoners','needs_follow_up','buyers','new_leads_today','disqualified','all'];
 document.getElementById('tabs').innerHTML=tabs.map(k=>\`<button class="\${current===k?'active':''}" onclick="show('\${k}')">\${labels[k]} (\${data.counts[k]||0})</button>\`).join('');
 const rows=data.views[current]||[];
 document.getElementById('rows').innerHTML=rows.length?rows.map(l=>{const cls=l.leadStage==='buyer'?'good':(l.leadStage==='disqualified'?'bad':(l.leadStage==='hot_lead'?'hot':'')); const pct=Math.max(0,Math.min(100,Number(l.progress||0))); const action=(l.checkoutUrl?'<a href="'+esc(l.checkoutUrl)+'" target="_blank">checkout</a> · ':'')+'<a href="'+esc(l.resumeUrl)+'" target="_blank">resume</a>'; return '<div class="row"><div><div class="name">'+esc([l.firstName,l.lastName].filter(Boolean).join(' ')||l.email)+'</div><div class="sub">'+esc(l.email)+(l.phone?' · '+esc(l.phone):'')+'</div></div><div><span class="pill '+cls+'">'+esc(l.leadStage)+'</span><div class="sub">'+esc(l.reason)+'</div></div><div><div class="bar"><i style="width:'+pct+'%"></i></div><div class="sub">'+(pct||'—')+'%</div></div><div>$'+Number(l.value||0).toFixed(0)+'</div><div>'+esc(l.lastStepLabel||l.lastStep||l.rimoStatus||'—')+'</div><div>'+ago(l.updatedAt)+'<div class="sub">'+esc((l.updatedAt||'').slice(0,10))+'</div></div><div>'+action+'</div></div>'}).join(''):'<p style="padding:18px">No leads in this view yet.</p>';
}
function show(k){current=k; render()}
fetch('/api/leads-summary?limit=250&token='+encodeURIComponent(token),{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.ok) throw new Error(j.error); data=j; render()}).catch(e=>{document.body.innerHTML='<main><div class="card"><h1>Dashboard locked</h1><p>'+esc(e.message)+'</p><p><a href="/leads">Enter token</a></p></div></main>'})
</script></body></html>`;
}

async function handleLead(request, env, ctx) {
  const body = await request.json();
  return saveLeadFromBody(request, env, ctx, body);
}

async function handleRimoClientLead(request, env, ctx) {
  const url = new URL(request.url);
  let body = Object.fromEntries(url.searchParams.entries());

  if (request.method === 'POST') {
    const contentType = request.headers.get('content-type') || '';
    try {
      if (contentType.includes('application/json')) {
        body = { ...body, ...(await request.json()) };
      } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
        body = { ...body, ...Object.fromEntries((await request.formData()).entries()) };
      } else {
        const raw = await request.text();
        if (raw) body = { ...body, raw };
      }
    } catch (_) {
      return json(request, { ok: false, error: 'invalid_body' }, 400);
    }
  }

  body.attribution = {
    ...(body.attribution || {}),
    source: 'rimo_customjs',
    page: cleanUrl(body.page || body.url || ''),
    sessionId: clean(body.sessionId || body.session_id || ''),
    offeringId: clean(body.offeringId || body.offering_id || ''),
    offeringCode: clean(body.offeringCode || body.offering_code || ''),
    treatmentId: clean(body.treatmentId || body.treatment_id || ''),
    billingPlanId: clean(body.billingPlanId || body.billing_plan_id || '')
  };
  body.leadType = body.leadType || 'rimo_customjs';
  body.checkoutUrl = body.checkoutUrl || body.page || body.url || '';

  const email = normalizeEmail(body.email);
  if (!email || !email.includes('@')) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await env.TIDEMEDIX_LEADS.put(`rimo_client_attempt:${now}:${id}`, JSON.stringify({
      id,
      receivedAt: now,
      page: cleanUrl(body.page || body.url || ''),
      source: clean(body.source || body.attribution?.source || 'rimo_customjs'),
      hasEmail: false,
      fields: Object.keys(body).sort().slice(0, 100),
      body: Object.fromEntries(Object.entries(body).map(([key, value]) => [key, typeof value === 'object' ? value : clean(value)]))
    }));
    return json(request, { ok: false, error: 'valid_email_required', debugStored: true }, 400);
  }

  return saveLeadFromBody(request, env, ctx, body);
}

async function saveLeadFromBody(request, env, ctx, body) {
  const now = new Date().toISOString();
  const email = normalizeEmail(body.email);
  if (!email || !email.includes('@')) return json(request, { ok: false, error: 'valid_email_required' }, 400);

  const existingId = await env.TIDEMEDIX_LEADS.get(`email:${email}`);
  const id = existingId || crypto.randomUUID();
  const existing = existingId ? await getLead(env, existingId) : null;

  const lead = {
    ...(existing || {}),
    id,
    email,
    firstName: clean(body.firstName),
    lastName: clean(body.lastName),
    phone: clean(body.phone),
    state: clean(body.state),
    plan: normalizePlan(body.plan),
    value: Number(body.value || (body.plan === 'tirzepatide' ? 249 : 149)),
    checkoutUrl: cleanUrl(body.checkoutUrl),
    attribution: mergeLeadAttribution(existing?.attribution || {}, body),
    quiz: body.quiz || existing?.quiz || {},
    status: statusForLeadSubmission(body, existing),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    checkoutStartedAt: body.leadType === 'quiz_abandon' ? (existing?.checkoutStartedAt || null) : (existing?.checkoutStartedAt || now),
    abandonedAt: body.leadType === 'quiz_abandon' ? (existing?.abandonedAt || now) : (existing?.abandonedAt || null),
    purchasedAt: existing?.purchasedAt || null,
    unsubscribedAt: existing?.unsubscribedAt || null,
    emails: existing?.emails || {}
  };

  await env.TIDEMEDIX_LEADS.put(`lead:${id}`, JSON.stringify(lead));
  await env.TIDEMEDIX_LEADS.put(`email:${email}`, id);

  // Send immediate checkout-started welcome email (don't block response). Skip
  // quiz abandoners; they get the separate recovery sequence from cron.
  if (lead.status === 'checkout_started' && !lead.emails.welcome && !lead.purchasedAt && !lead.unsubscribedAt) {
    ctx.waitUntil(sendStepAndRecord(env, lead, EMAIL_STEPS[0]).catch(err => console.error('welcome_send_failed', err)));
  }

  return json(request, { ok: true, id, resumeUrl: buildResumeUrl(lead, env) });
}

async function handleResume(request, env) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!id) return json(request, { ok: false, error: 'id_required' }, 400);
  const lead = await getLead(env, id);
  if (!lead || !lead.email) return json(request, { ok: false, error: 'not_found' }, 404);
  return json(request, {
    ok: true,
    id: lead.id,
    email: lead.email,
    status: lead.status,
    quiz: lead.quiz || {},
    resumeStep: 'height_weight'
  });
}

async function handlePurchase(request, env, ctx) {
  if (env.PURCHASE_WEBHOOK_SECRET) {
    const supplied = request.headers.get('x-webhook-secret') || '';
    if (supplied !== env.PURCHASE_WEBHOOK_SECRET) return json(request, { ok: false, error: 'unauthorized' }, 401);
  }

  const body = await request.json();
  const result = await markPurchaseFromPayload(env, body, new Date().toISOString());
  if (!result.email) return json(request, { ok: false, error: 'email_required' }, 400);
  if (!result.leadId) return json(request, { ok: false, error: 'lead_not_found' }, 404);
  enqueueBuyerDayZero(env, result.lead, ctx);
  return json(request, { ok: true });
}

async function handleRimoWebhook(request, env, ctx) {
  const now = new Date().toISOString();
  const rawBody = await request.text();
  const secret = env.RIMO_WEBHOOK_SECRET || env.PURCHASE_WEBHOOK_SECRET || '';
  if (!secret) return json(request, { ok: false, error: 'webhook_secret_not_configured' }, 503);
  const verified = await verifyWebhookSignature(request, rawBody, secret);
  if (!verified) return json(request, { ok: false, error: 'invalid_signature' }, 401);

  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (_) {
    return json(request, { ok: false, error: 'invalid_json' }, 400);
  }

  const eventType = eventTypeFromPayload(payload, request);
  const eventId = clean(payload.id || payload.event_id || payload.eventId || payload.webhook_id || payload.webhookId || crypto.randomUUID());
  const storageKey = `rimo_event:${now}:${eventId}`;
  await env.TIDEMEDIX_LEADS.put(storageKey, JSON.stringify({
    id: eventId,
    eventType,
    receivedAt: now,
    headers: safeWebhookHeaders(request),
    payload
  }));

  let leadResult = null;
  const email = emailFromPayload(payload);
  if (email) {
    leadResult = await upsertLeadFromRimoPayload(env, payload, eventType, now);
  }

  let purchaseResult = null;
  if (isPurchaseEvent(eventType, payload)) {
    purchaseResult = await markPurchaseFromPayload(env, payload, now);
    enqueueBuyerDayZero(env, purchaseResult?.lead, ctx);
  }

  return json(request, {
    ok: true,
    received: true,
    eventType,
    eventId,
    email: email || null,
    leadId: purchaseResult?.leadId || leadResult?.leadId || null,
    purchaseMarked: Boolean(purchaseResult?.marked)
  });
}

async function handleEmailClick(request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  const stepKey = url.searchParams.get('step') || '';
  const fallbackUrl = buildResumeUrl({ id }, env);
  if (!id || !stepKey) return redirect(fallbackUrl);

  const lead = await getLead(env, id);
  if (!lead || !lead.email) return redirect(fallbackUrl);

  const step = ALL_EMAIL_STEPS.find(s => s.key === stepKey);
  const destination = trackedDestinationForStep(lead, step, env, stepKey);
  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const rimoStep = step?.ctaTarget === 'intake' ? rimoStepSlug(lead?.rimo?.lastStep || '') : '';
  const clickEvent = {
    id: eventId,
    leadId: lead.id,
    step: stepKey,
    target: step?.ctaTarget || 'fallback',
    rimoStep,
    destination,
    timestamp: now,
    userAgent: clean(request.headers.get('user-agent')),
    ipHash: await sha256Hex(request.headers.get('cf-connecting-ip') || '')
  };

  await env.TIDEMEDIX_LEADS.put(`click:${lead.id}:${Date.now()}:${eventId}`, JSON.stringify(clickEvent));
  lead.clicks = lead.clicks || {};
  lead.clicks[stepKey] = now;
  lead.updatedAt = now;
  await env.TIDEMEDIX_LEADS.put(`lead:${lead.id}`, JSON.stringify(lead));

  return redirect(destination);
}

async function handleUnsubscribe(request, env) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return new Response('Missing unsubscribe id', { status: 400 });
  const lead = await getLead(env, id);
  if (!lead) return new Response('Already unsubscribed or not found.', { status: 200 });
  lead.unsubscribedAt = new Date().toISOString();
  lead.updatedAt = lead.unsubscribedAt;
  await env.TIDEMEDIX_LEADS.put(`lead:${id}`, JSON.stringify(lead));
  return new Response('You have been unsubscribed from TideMedix follow-up emails.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function runFollowups(env) {
  const now = Date.now();
  let cursor;
  do {
    const page = await env.TIDEMEDIX_LEADS.list({ prefix: 'lead:', cursor, limit: 100 });
    cursor = page.cursor;
    for (const key of page.keys) {
      const lead = await getLead(env, key.name.replace(/^lead:/, ''));
      if (!shouldConsiderCheckoutLead(lead) && !shouldConsiderAbandonLead(lead) && !shouldConsiderBuyerLead(lead) && !shouldConsiderCompletedNoPurchaseLead(lead)) continue;
      const checkoutTime = new Date(lead.checkoutStartedAt || lead.createdAt).getTime();
      const abandonTime = new Date(lead.abandonedAt || lead.createdAt).getTime();
      const buyerTime = new Date(lead.purchasedAt || lead.createdAt).getTime();
      const completedTime = new Date(lead.completedNoPurchaseAt || lead.rimo?.lastEventAt || lead.checkoutStartedAt || lead.updatedAt || lead.createdAt).getTime();
      const buyerLead = shouldConsiderBuyerLead(lead);
      const completedNoPurchaseLead = shouldConsiderCompletedNoPurchaseLead(lead);
      const abandonLead = shouldConsiderAbandonLead(lead);
      const steps = buyerLead ? BUYER_EMAIL_STEPS : (completedNoPurchaseLead ? COMPLETED_NO_PURCHASE_EMAIL_STEPS : (abandonLead ? ABANDON_EMAIL_STEPS : EMAIL_STEPS));
      const startTime = buyerLead ? buyerTime : (completedNoPurchaseLead ? completedTime : (abandonLead ? abandonTime : checkoutTime));
      // Iterate steps after the checkout welcome (index 0 sent inline). Abandon,
      // buyer, and completed-no-purchase sequences start at index 0.
      const firstStepIndex = buyerLead || completedNoPurchaseLead || abandonLead ? 0 : 1;
      for (let i = firstStepIndex; i < steps.length; i++) {
        const step = steps[i];
        if (lead.emails?.[step.key]) continue;
        if (now - startTime < step.delayMs) continue;
        try {
          await sendStepAndRecord(env, lead, step);
        } catch (err) {
          console.error('drip_send_failed', step.key, lead.email, err);
        }
        break; // one email max per cron run per lead
      }
    }
  } while (cursor);
}

export function shouldConsiderCheckoutLead(lead) {
  return lead && lead.email && lead.status === 'checkout_started' && !shouldConsiderAbandonLead(lead) && !lead.purchasedAt && !lead.unsubscribedAt;
}

export function shouldConsiderAbandonLead(lead) {
  if (!lead || !lead.email || lead.purchasedAt || lead.unsubscribedAt || isCompletedNoPurchaseLead(lead)) return false;
  if (lead.status === 'quiz_abandoned') return true;
  return lead.status === 'checkout_started';
}

export function shouldConsiderBuyerLead(lead) {
  return lead && lead.email && lead.status === 'purchased' && Boolean(lead.purchasedAt) && !lead.unsubscribedAt;
}

export function shouldConsiderCompletedNoPurchaseLead(lead) {
  return Boolean(lead && lead.email && !lead.purchasedAt && !lead.unsubscribedAt && isCompletedNoPurchaseLead(lead));
}

export function isCompletedNoPurchaseLead(lead) {
  const status = clean(lead?.status || '').toLowerCase();
  const rimoStatus = clean(lead?.rimo?.status || '').toLowerCase();
  const eventType = clean(lead?.rimo?.lastEventType || '').toLowerCase();
  const lastStep = clean(lead?.rimo?.lastStep || '').toLowerCase();
  const progress = Number(lead?.rimo?.progress || 0);
  if (lead?.purchasedAt || status === 'purchased' || lead?.unsubscribedAt) return false;
  if (status === 'completed_no_purchase') return true;
  if (progress >= 100) return true;
  if (/(complete|completed|submitted|finished)/.test(rimoStatus) && !/paid|purchase|order/.test(eventType)) return true;
  if (/(assessment|intake|teleform|form|checkout).*(complete|completed|submitted|finished)/.test(eventType)) return true;
  return /review|submit|submitted|complete|completed|confirmation/.test(lastStep) && progress >= 90;
}

export function statusForLeadSubmission(body, existing) {
  if (existing?.status === 'purchased') return 'purchased';
  return body?.leadType === 'quiz_abandon' ? 'quiz_abandoned' : 'checkout_started';
}

function enqueueBuyerDayZero(env, lead, ctx) {
  if (!lead || !shouldConsiderBuyerLead(lead) || lead.emails?.buyer_day0 || !ctx?.waitUntil) return;
  ctx.waitUntil(sendStepAndRecord(env, lead, BUYER_EMAIL_STEPS[0]).catch(err => console.error('buyer_day0_send_failed', err)));
}

export function normalizeSesEvent(message = {}, envelope = {}) {
  const mail = message.mail || {};
  const tags = mail.tags || message.tags || {};
  const tagValue = (name) => {
    const value = tags[name] || tags[name.replace(/_/g, '-')] || tags[name.replace(/_/g, '')];
    return Array.isArray(value) ? clean(value[0] || '') : clean(value || '');
  };
  const eventType = clean(message.eventType || message.notificationType || message.event_type || 'unknown');
  const messageId = clean(mail.messageId || mail.messageID || message.mail?.messageId || message.messageId || '');
  const eventPayload = message.delivery || message.bounce || message.complaint || message.reject || message.send || message.renderingFailure || {};
  const timestamp = clean(eventPayload.timestamp || mail.timestamp || message.timestamp || envelope.Timestamp || new Date().toISOString());
  return {
    eventType,
    status: normalizeDeliveryStatus(eventType),
    messageId,
    leadId: tagValue('lead_id'),
    step: tagValue('step'),
    timestamp,
    diagnosticCode: clean(eventPayload.diagnosticCode || eventPayload.errorMessage || eventPayload.reason || eventPayload.bounceType || eventPayload.bounceSubType || ''),
    raw: message
  };
}

async function recordSesEvent(env, event) {
  const messageKey = `ses_msg:${event.messageId}`;
  const mappingRaw = await env.TIDEMEDIX_LEADS.get(messageKey);
  let mapping = {};
  if (mappingRaw) {
    try { mapping = JSON.parse(mappingRaw); } catch (_) {}
  }

  const leadId = clean(event.leadId || mapping.leadId || '');
  const step = clean(event.step || mapping.step || '');
  const record = {
    ...event,
    leadId,
    step,
    recordedAt: new Date().toISOString(),
    raw: undefined
  };
  await env.TIDEMEDIX_LEADS.put(`ses_event:${event.messageId}:${event.timestamp}:${crypto.randomUUID()}`, JSON.stringify(record), { expirationTtl: 120 * 24 * 60 * 60 });
  if (leadId && step) await env.TIDEMEDIX_LEADS.put(messageKey, JSON.stringify({ ...mapping, leadId, step, messageId: event.messageId, updatedAt: record.recordedAt }), { expirationTtl: 120 * 24 * 60 * 60 });

  if (!leadId || !step) return { updated: false, leadId, step };
  const lead = await getLead(env, leadId);
  if (!lead) return { updated: false, leadId, step };

  lead.emailEvents = lead.emailEvents || {};
  const prior = lead.emailEvents[step] || {};
  const status = normalizeDeliveryStatus(event.status || event.eventType);
  lead.emailEvents[step] = {
    ...prior,
    messageId: event.messageId,
    status,
    eventType: event.eventType,
    lastEventAt: event.timestamp,
    ...(event.diagnosticCode ? { diagnosticCode: event.diagnosticCode } : {})
  };
  if (status === 'sent') lead.emailEvents[step].sentAt = event.timestamp;
  if (status === 'delivered') lead.emailEvents[step].deliveredAt = event.timestamp;
  if (status === 'bounced') lead.emailEvents[step].bouncedAt = event.timestamp;
  if (status === 'complained') lead.emailEvents[step].complainedAt = event.timestamp;
  if (status === 'rejected') lead.emailEvents[step].rejectedAt = event.timestamp;
  if (status === 'failed') lead.emailEvents[step].failedAt = event.timestamp;
  lead.updatedAt = new Date().toISOString();
  await env.TIDEMEDIX_LEADS.put(`lead:${lead.id}`, JSON.stringify(lead));
  return { updated: true, leadId, step };
}

async function sendStepAndRecord(env, lead, step) {
  const messageId = await sendFollowup(env, lead, step);
  // Re-read latest lead to avoid clobbering concurrent updates.
  const fresh = (await getLead(env, lead.id)) || lead;
  const sentAt = new Date().toISOString();
  fresh.emails = fresh.emails || {};
  fresh.emailEvents = fresh.emailEvents || {};
  fresh.emails[step.key] = sentAt;
  fresh.emailEvents[step.key] = {
    ...(fresh.emailEvents[step.key] || {}),
    sentAt,
    lastEventAt: sentAt,
    status: 'sent',
    eventType: 'Send',
    ...(messageId ? { messageId } : {})
  };
  fresh.updatedAt = fresh.emails[step.key];
  await env.TIDEMEDIX_LEADS.put(`lead:${fresh.id}`, JSON.stringify(fresh));
  if (messageId) await env.TIDEMEDIX_LEADS.put(`ses_msg:${messageId}`, JSON.stringify({ leadId: fresh.id, step: step.key, sentAt }), { expirationTtl: 120 * 24 * 60 * 60 });
}

async function sendFollowup(env, lead, step) {
  const baseUrl = env.PUBLIC_BASE_URL || 'https://tidemedix-leads.tylerdefi.workers.dev';
  const unsubscribeUrl = `${baseUrl}/api/unsubscribe?id=${encodeURIComponent(lead.id)}`;
  const ctaUrl = buildEmailClickUrl(lead, step, env);
  const html = step.template(lead, ctaUrl, unsubscribeUrl);
  const subject = typeof step.subject === 'function' ? step.subject(escapeHtml(lead.firstName || '')) : step.subject;

  return sendWithAwsSes(env, {
    from: env.FROM_EMAIL || 'TideMedix <care@tidemedix.com>',
    to: lead.email,
    replyTo: env.REPLY_TO_EMAIL || 'care@tidemedix.com',
    subject,
    html,
    text: emailHtmlToText(html),
    configurationSetName: clean(env.AWS_SES_CONFIGURATION_SET || ''),
    tags: [
      { Name: 'lead_id', Value: sanitizeSesTagValue(lead.id || '') },
      { Name: 'step', Value: sanitizeSesTagValue(step.key || 'unknown') },
      { Name: 'source', Value: 'tidemedix_worker' }
    ],
    headers: [
      { Name: 'List-Unsubscribe', Value: `<${unsubscribeUrl}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }
    ]
  });
}

async function sendWithAwsSes(env, message) {
  const accessKeyId = env.AWS_SES_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SES_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY;
  const region = env.AWS_SES_REGION || env.AWS_REGION || 'us-east-1';
  if (!accessKeyId || !secretAccessKey) throw new Error('AWS SES credentials missing');

  const host = `email.${region}.amazonaws.com`;
  const endpoint = `https://${host}/v2/email/outbound-emails`;
  const body = JSON.stringify({
    FromEmailAddress: message.from,
    ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
    ...(message.configurationSetName ? { ConfigurationSetName: message.configurationSetName } : {}),
    ...(Array.isArray(message.tags) && message.tags.length ? { EmailTags: message.tags.filter(t => t?.Name && t?.Value) } : {}),
    Destination: { ToAddresses: [message.to] },
    Content: {
      Simple: {
        ...(Array.isArray(message.headers) && message.headers.length ? { Headers: message.headers } : {}),
        Subject: { Data: message.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: message.html, Charset: 'UTF-8' },
          Text: { Data: message.text, Charset: 'UTF-8' }
        }
      }
    }
  });

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonicalRequest = ['POST', '/v2/email/outbound-emails', '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');
  const signingKey = await getAwsSigningKey(secretAccessKey, dateStamp, region, 'ses');
  const signature = await hmacHex(signingKey, stringToSign);
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-amz-date': amzDate,
      authorization
    },
    body
  });
  if (!response.ok) throw new Error(`AWS SES failed ${response.status}: ${await response.text()}`);
  const result = await response.json().catch(() => ({}));
  return clean(result.MessageId || result.messageId || '');
}

function sanitizeSesTagValue(value) {
  return clean(value || 'unknown').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 256) || 'unknown';
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

async function hmacRaw(key, value) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

async function hmacHex(key, value) {
  return bytesToHex(await hmacRaw(key, value));
}

async function getAwsSigningKey(secretAccessKey, dateStamp, region, service) {
  const encoder = new TextEncoder();
  const kDate = await hmacRaw(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, 'aws4_request');
}

function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function productLinkFor(lead) {
  const plan = normalizePlan(lead?.plan);
  return PRODUCT_LINKS[plan] || PRODUCT_LINKS.semaglutide;
}

function portalLinkFor(env = {}) {
  return env.CUSTOMER_PORTAL_URL || env.RIMO_PATIENT_PORTAL_URL || env.PATIENT_PORTAL_URL || 'https://try.tidemedix.com/sign-in?returnTo=%2F';
}

function funnelLinkFor(env = {}) {
  return env.TRY_FUNNEL_URL || 'https://try.tidemedix.com/';
}

function intakeLinkFor(env = {}) {
  return env.RIMO_INTAKE_URL || env.INTAKE_URL || 'https://try.tidemedix.com/intake/mv-xtyd5b';
}

export function buildRimoResumeUrl(lead, env = {}) {
  const base = intakeLinkFor(env).replace(/\/$/, '');
  const rimo = lead?.rimo || {};
  const leadKey = clean(rimo.leadKey || lead?.leadKey || '');
  const stepSlug = rimoStepSlug(rimo.lastStep || '');
  const raw = stepSlug ? `${base}/${stepSlug}` : base;
  const url = new URL(raw);
  // Rimo's restoreTeleform client recognizes leadKey when supplied as the
  // email query param. Without it, a return click starts a fresh intake.
  if (leadKey) url.searchParams.set('email', leadKey);
  return url.toString();
}

function rimoStepSlug(step) {
  const s = clean(step);
  if (!s) return '';
  const explicit = {
    medvaAreYouReady: 'medva-are-you-ready',
    medvaWeightLossPace: 'medva-weight-loss-pace',
    medvaCreateAccount: 'medva-create-account',
    medvaDetailsPrograms: 'medva-details-programs',
    medvaDetailsMedMatch: 'medva-details-med-match',
    medvaDetailsNeeds: 'medva-details-needs',
    medvaMedicalReview: 'medva-medical-review',
    medvaPatientNotes: 'medva-patient-notes'
  };
  if (explicit[s]) return explicit[s];
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

export function buildEmailClickUrl(lead, step, env = {}) {
  const baseUrl = String(env.PUBLIC_BASE_URL || 'https://tidemedix-leads.tylerdefi.workers.dev').replace(/\/$/, '');
  const id = encodeURIComponent(lead?.id || '');
  const stepKey = encodeURIComponent(step?.key || 'unknown');
  return `${baseUrl}/api/email-click?id=${id}&step=${stepKey}`;
}

function trackedDestinationForStep(lead, step, env, stepKey) {
  const productUrl = productLinkFor(lead);
  const checkoutUrl = lead.checkoutUrl || productUrl;
  const resumeUrl = buildResumeUrl(lead, env);
  const funnelUrl = funnelLinkFor(env);
  const intakeUrl = buildRimoResumeUrl(lead, env);
  const target = step?.ctaTarget || 'product';
  const raw = target === 'checkout' ? checkoutUrl : (target === 'resume' ? resumeUrl : (target === 'portal' ? portalLinkFor(env) : (target === 'funnel' ? funnelUrl : (target === 'intake' ? intakeUrl : productUrl))));
  const rimoStep = target === 'intake' ? rimoStepSlug(lead?.rimo?.lastStep || '') : '';
  return appendEmailAttribution(raw, stepKey, { target, rimoStep });
}

export function appendEmailAttribution(rawUrl, stepKey, meta = {}) {
  const fallback = 'https://go.tidemedix.com/';
  let url;
  try {
    url = new URL(rawUrl || fallback);
  } catch (_) {
    url = new URL(fallback);
  }
  const target = clean(meta.target || 'unknown').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const rimoStep = clean(meta.rimoStep || '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  url.searchParams.set('utm_source', 'email');
  url.searchParams.set('utm_medium', 'followup');
  url.searchParams.set('utm_campaign', `tidemedix_${stepKey || 'unknown'}`);
  url.searchParams.set('utm_content', rimoStep ? `${target}__${rimoStep}` : target);
  url.searchParams.set('src', `email_${stepKey || 'unknown'}`);
  url.searchParams.set('tm_target', target);
  if (rimoStep) url.searchParams.set('rimo_step', rimoStep);
  return url.toString();
}

export function buildResumeUrl(lead, env = {}) {
  const site = String(env.SITE_URL || env.PUBLIC_SITE_URL || env.FUNNEL_URL || 'https://go.tidemedix.com').replace(/\/$/, '');
  const id = encodeURIComponent(lead?.id || '');
  return `${site}/?resume=height_weight${id ? `&lead=${id}` : ''}`;
}

function normalizePlan(value) {
  const s = String(value || '').toLowerCase().trim();
  if (s === 'tirzepatide') return 'tirzepatide';
  return 'semaglutide';
}

// ---------- Email templates ----------

function renderAbandonTwentyMinuteEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>You started your TideMedix assessment, but it looks like you didn't finish the health profile.</p>
    <p>The next question is your height and current weight. It should take less than a minute to continue.</p>
    ${ctaButton(ctaUrl, 'Continue your assessment')}
  `, unsubscribeUrl);
}

function renderAbandonNextMorningEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>Your TideMedix assessment is almost ready.</p>
    <p>We saved your place. Finish the height and weight step so the screening can continue toward your treatment options.</p>
    ${ctaButton(ctaUrl, 'Continue where you left off')}
  `, unsubscribeUrl);
}

function renderAbandonTwoDayEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>Your TideMedix assessment is still saved.</p>
    <p>You only need to finish the remaining assessment questions. Your next step is height and current weight.</p>
    ${ctaButton(ctaUrl, 'Finish the assessment')}
  `, unsubscribeUrl);
}

function renderAbandonFiveDayEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>This is the last reminder about your unfinished TideMedix assessment.</p>
    <p>If now isn't the right time, no problem. If you'd still like to continue, your assessment will reopen at the height and current weight question.</p>
    ${ctaButton(ctaUrl, 'Complete your assessment')}
  `, unsubscribeUrl);
}

function renderWelcomeEmail(lead, ctaUrl, unsubscribeUrl) {
  const name = lead.firstName ? ` ${escapeHtml(lead.firstName)}` : '';
  return emailShell(`
    <p>Hi${name},</p>
    <p>You started your TideMedix intake, but did not finish. Your answers are saved, so you can pick up where you left off.</p>
    <p>The next step is to return to the secure intake page. From there, your information can continue through the review process.</p>
    ${ctaButton(ctaUrl, 'Continue your consultation')}
    <p>If you have a question first, reply to this email and the care team can help.</p>
  `, unsubscribeUrl);
}

function renderTwoHourEmail(lead, ctaUrl, unsubscribeUrl) {
  const name = lead.firstName ? ` ${escapeHtml(lead.firstName)}` : '';
  return emailShell(`
    <p>Hi${name},</p>
    <p>Quick note — your TideMedix intake is still saved.</p>
    <p>If anything was unclear, you can reply to this email and the care team can help.</p>
    <p>You can return to the secure intake page when you are ready.</p>
    ${ctaButton(ctaUrl, 'See how TideMedix works')}
  `, unsubscribeUrl);
}

function renderDayOneEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>Your TideMedix information is saved.</p>
    <p>If you want to continue, return to the secure intake page below. If you have a question first, reply here and the care team can help.</p>
    ${ctaButton(ctaUrl, 'Return to TideMedix')}
  `, unsubscribeUrl);
}

function renderDayThreeEmail(lead, ctaUrl, unsubscribeUrl) {
  const name = lead.firstName ? ` ${escapeHtml(lead.firstName)}` : '';
  return emailShell(`
    <p>Hi${name},</p>
    <p>Your physician consultation is still available.</p>
    <p>Nothing has expired. Your saved answers are still there, and the same plan you selected is still in stock at the same price.</p>
    <p>If you'd like to continue, here's where to pick up:</p>
    ${ctaButton(ctaUrl, 'Continue with TideMedix')}
    <p>If you have a question first, reply to this email — it goes to a real person on our care team.</p>
  `, unsubscribeUrl);
}

function renderDayFiveEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>Your TideMedix intake is still saved.</p>
    <p>If you want to continue, you can return to the secure page below. If not, no action is needed.</p>
    ${ctaButton(ctaUrl, 'Return to TideMedix')}
  `, unsubscribeUrl);
}

function renderDayTenEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>This is the last note we'll send.</p>
    <p>If TideMedix is not the right fit right now, no problem.</p>
    <p>If you'd still like to finish, the door is open:</p>
    ${ctaButton(ctaUrl, 'Return to TideMedix')}
    <p>After this, we'll stop emailing about this consultation. Take care.</p>
  `, unsubscribeUrl);
}

function renderBuyerDayZeroEmail(lead, ctaUrl, unsubscribeUrl) {
  const name = lead.firstName ? ` ${escapeHtml(lead.firstName)}` : '';
  return emailShell(`
    <p>Hi${name},</p>
    <p>Your TideMedix order is confirmed. We received your intake and it is now in the review queue.</p>
    <p>What happens next:</p>
    <ul>
      <li>Your intake is reviewed for completeness.</li>
      <li>A US-licensed physician reviews your consultation and determines whether treatment is appropriate.</li>
      <li>If approved, fulfillment and shipping updates are sent to the email/phone number you provided.</li>
    </ul>
    <p>You can use your patient portal to check your account, messages, treatment details, and order updates as they become available.</p>
    <p>If the clinical team needs anything else, they will reach out before moving forward.</p>
    ${ctaButton(ctaUrl, 'Access your Patient Portal')}
  `, unsubscribeUrl);
}

function renderBuyerDayOneEmail(lead, ctaUrl, unsubscribeUrl) {
  const name = lead.firstName ? ` ${escapeHtml(lead.firstName)}` : '';
  return emailShell(`
    <p>Hi${name},</p>
    <p>Your intake is being reviewed.</p>
    <p>At this stage, the most important thing is accuracy. If anything is missing or needs clarification, the care team will contact you before the order moves forward.</p>
    <p>No extra appointment is needed unless the reviewing provider requests more information.</p>
    <p>Your portal is the best place to return for account access and order updates.</p>
    ${ctaButton(ctaUrl, 'Open your Patient Portal')}
  `, unsubscribeUrl);
}

function renderBuyerDayThreeEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>A quick expectation-setting note from TideMedix.</p>
    <p>The right sequence is: intake, provider review, approval if appropriate, then fulfillment and shipping.</p>
    <p>If your order is approved and shipped, follow the instructions provided and contact the care team with any questions.</p>
    <p>Use your patient portal to keep track of updates and account details.</p>
    ${ctaButton(ctaUrl, 'Go to your Patient Portal')}
  `, unsubscribeUrl);
}

function renderBuyerDaySevenEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>As you get into your first month, keep an eye on your TideMedix updates.</p>
    <p>Ongoing treatment works best when the refill path is handled before you run out, and when any questions are raised early instead of waiting until the last minute.</p>
    <p>If you need help with your order, refill timing, or account details, reply to this email and the care team can point you in the right direction.</p>
    <p>Your patient portal is the first place to check for account and order updates.</p>
    ${ctaButton(ctaUrl, 'Access your Patient Portal')}
  `, unsubscribeUrl);
}

function renderCompletedNoPurchaseFifteenMinuteEmail(lead, ctaUrl, unsubscribeUrl) {
  const name = lead.firstName ? ` ${escapeHtml(lead.firstName)}` : '';
  return emailShell(`
    <p>Hi${name},</p>
    <p>Your TideMedix intake is complete, but we do not see a completed order yet.</p>
    <p>The final step is checkout. Once that is complete, your intake can move toward physician review.</p>
    ${ctaButton(ctaUrl, 'Complete checkout')}
  `, unsubscribeUrl);
}

function renderCompletedNoPurchaseDayOneEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>Your consultation information is saved.</p>
    <p>Right now, it is not in the physician review path because checkout has not been completed. If you still want the TideMedix team to review your intake, finish the final checkout step here:</p>
    ${ctaButton(ctaUrl, 'Finish the final step')}
    <p>If something looked wrong or confusing, reply to this email and the care team can help.</p>
  `, unsubscribeUrl);
}

function renderCompletedNoPurchaseDayThreeEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>Still want your TideMedix intake reviewed?</p>
    <p>You already did the longer part. The remaining step is confirming checkout so the clinical review process can begin if appropriate.</p>
    ${ctaButton(ctaUrl, 'Return to checkout')}
  `, unsubscribeUrl);
}

function renderCompletedNoPurchaseDaySevenEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>This is the last reminder about the TideMedix intake you completed.</p>
    <p>If you still want to move forward, use the link below to complete checkout. If not, no problem — we will stop sending reminders about this intake.</p>
    ${ctaButton(ctaUrl, 'Complete checkout')}
  `, unsubscribeUrl);
}

function ctaButton(url, label) {
  return `<p><a href="${escapeAttr(url)}">${escapeHtml(label)}</a></p>`;
}

function emailShell(body, unsubscribeUrl) {
  return `<!doctype html>
<html>
<body>
${body}
<p>— TideMedix Care Team</p>
<p>LegitScript Certified. US-Licensed Physicians.</p>
<p>You're receiving this because you started a consultation at TideMedix. <a href="${escapeAttr(unsubscribeUrl)}">Unsubscribe</a>.</p>
</body>
</html>`;
}

function emailHtmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href, label) => `${label.replace(/<[^>]*>/g, '')}: ${href}`)
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- Helpers ----------

async function getLead(env, id) {
  const raw = await env.TIDEMEDIX_LEADS.get(`lead:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function upsertLeadFromRimoPayload(env, payload, eventType, now) {
  const email = emailFromPayload(payload);
  if (!email) return { email: '', leadId: null };

  const existingId = await env.TIDEMEDIX_LEADS.get(`email:${email}`);
  const id = existingId || crypto.randomUUID();
  const existing = existingId ? await getLead(env, existingId) : null;
  const object = payload.data?.object || {};
  const teleformResponse = primaryTeleformResponse(object);
  const responses = object.responses || teleformResponse.responses || {};
  const firstName = firstTruthy(payload.firstName, payload.first_name, payload.customer?.firstName, payload.customer?.first_name, payload.patient?.firstName, payload.patient?.first_name, object.firstName, object.first_name, object.lead?.firstName, object.lead?.first_name, responses.accountInfo?.firstName, responses.accountInfo?.first_name, existing?.firstName);
  const lastName = firstTruthy(payload.lastName, payload.last_name, payload.customer?.lastName, payload.customer?.last_name, payload.patient?.lastName, payload.patient?.last_name, object.lastName, object.last_name, object.lead?.lastName, object.lead?.last_name, responses.accountInfo?.lastName, responses.accountInfo?.last_name, existing?.lastName);
  const phone = firstTruthy(payload.phone, payload.phoneNumber, payload.customer?.phone, payload.patient?.phone, payload.shipping_address?.phone, object.phone, object.phoneNumber, object.lead?.phone, object.lead?.phoneNumber, responses.accountInfo?.phoneNumber, responses.accountInfo?.phone, existing?.phone);
  const order = payload.order || payload.data?.order || payload.checkout || payload.data?.checkout || payload;
  const amount = amountFromPayload(payload);
  const lead = {
    ...(existing || {}),
    id,
    email,
    firstName: clean(firstName),
    lastName: clean(lastName),
    phone: clean(phone),
    state: clean(firstTruthy(payload.state, payload.customer?.state, payload.patient?.state, payload.shipping_address?.state, existing?.state)),
    plan: normalizePlan(firstTruthy(payload.plan, payload.product, payload.product_name, order?.product, order?.product_name, existing?.plan)),
    value: Number(amount || existing?.value || 0),
    checkoutUrl: cleanUrl(firstTruthy(payload.checkoutUrl, payload.checkout_url, payload.checkout?.url, existing?.checkoutUrl)),
    attribution: { ...(existing?.attribution || {}), ...(payload.attribution || {}), ...(payload.utm || {}) },
    rimo: {
      ...(existing?.rimo || {}),
      lastEventType: eventType,
      lastEventAt: now,
      customerId: clean(firstTruthy(payload.customer_id, payload.customerId, payload.customer?.id, payload.patient_id, payload.patient?.id, object.customerId, object.customer?.id, existing?.rimo?.customerId)),
      orderId: clean(firstTruthy(payload.order_id, payload.orderId, order?.id, existing?.rimo?.orderId)),
      leadId: clean(firstTruthy(payload.lead_id, payload.leadId, object.leadId, object.lead?.id, teleformResponse.leadId, object.id, existing?.rimo?.leadId)),
      leadKey: clean(firstTruthy(payload.leadKey, payload.lead_key, object.leadKey, object.lead_key, object.lead?.leadKey, teleformResponse.leadKey, teleformResponse.lead_key, existing?.rimo?.leadKey)),
      responseToken: clean(firstTruthy(payload.responseToken, payload.response_token, object.responseToken, object.response_token, teleformResponse.responseToken, teleformResponse.response_token, existing?.rimo?.responseToken)),
      restoreId: clean(firstTruthy(payload.restoreId, payload.restore_id, payload.restoreToken, object.restoreId, object.restore_id, object.responseToken, teleformResponse.restoreId, teleformResponse.responseToken, existing?.rimo?.restoreId)),
      status: clean(firstTruthy(payload.status, teleformResponse.status, object.status, existing?.rimo?.status)),
      lastStep: clean(firstTruthy(payload.currentStep, payload.current_step, payload.lastStep, payload.last_step, object.currentStep, object.current_step, object.lastStep, teleformResponse.currentStep, teleformResponse.current_step, teleformResponse.lastStep, existing?.rimo?.lastStep)),
      progress: progressFromRimo(firstTruthy(payload.progress, payload.progressPercent, object.progress, object.progressPercent, teleformResponse.progress, teleformResponse.progressPercent, object.screenMetrics?.progress, object.screenMetrics?.percentComplete, object.currentSession?.progress, teleformResponse.screenMetrics?.progress, teleformResponse.screenMetrics?.percentComplete, existing?.rimo?.progress, 0), firstTruthy(payload.currentStep, payload.current_step, payload.lastStep, payload.last_step, object.currentStep, object.current_step, object.lastStep, teleformResponse.currentStep, teleformResponse.current_step, teleformResponse.lastStep), firstTruthy(payload.status, teleformResponse.status, object.status)),
      disqualified: Boolean(firstTruthy(payload.disqualified, object.disqualified, teleformResponse.disqualified, existing?.rimo?.disqualified, false)),
      disqualificationReason: clean(firstTruthy(payload.disqualificationReason, object.disqualificationReason, teleformResponse.disqualificationReason, existing?.rimo?.disqualificationReason))
    },
    status: isPurchaseEvent(eventType, payload) ? 'purchased' : ((object.disqualified || teleformResponse.disqualified) ? 'disqualified' : (isCompletedNoPurchaseEvent(eventType, payload) ? 'completed_no_purchase' : (existing?.status || statusFromRimoEvent(eventType)))),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    checkoutStartedAt: existing?.checkoutStartedAt || (isCheckoutEvent(eventType) ? now : null),
    abandonedAt: existing?.abandonedAt || null,
    completedNoPurchaseAt: existing?.completedNoPurchaseAt || (isCompletedNoPurchaseEvent(eventType, payload) && !isPurchaseEvent(eventType, payload) ? now : null),
    purchasedAt: existing?.purchasedAt || (isPurchaseEvent(eventType, payload) ? now : null),
    unsubscribedAt: existing?.unsubscribedAt || null,
    emails: existing?.emails || {}
  };

  await env.TIDEMEDIX_LEADS.put(`lead:${id}`, JSON.stringify(lead));
  await env.TIDEMEDIX_LEADS.put(`email:${email}`, id);
  return { email, leadId: id, lead };
}

async function markPurchaseFromPayload(env, payload, now) {
  const email = emailFromPayload(payload);
  if (!email) return { email: '', leadId: null, marked: false };
  const id = await env.TIDEMEDIX_LEADS.get(`email:${email}`);
  if (!id) return { email, leadId: null, marked: false };

  const lead = await getLead(env, id);
  if (!lead) return { email, leadId: null, marked: false };
  const order = payload.order || payload.data?.order || payload.checkout || payload.data?.checkout || payload;
  lead.status = 'purchased';
  lead.purchasedAt = lead.purchasedAt || now;
  lead.purchase = {
    ...(lead.purchase || {}),
    orderId: clean(firstTruthy(payload.orderId, payload.order_id, order?.id, order?.order_id, order?.orderId, lead.purchase?.orderId)),
    amount: Number(amountFromPayload(payload) || lead.value || lead.purchase?.amount || 0),
    currency: clean(firstTruthy(payload.currency, order?.currency, lead.purchase?.currency, 'USD'))
  };
  lead.rimo = {
    ...(lead.rimo || {}),
    lastEventType: eventTypeFromPayload(payload),
    lastEventAt: now,
    orderId: lead.purchase.orderId || lead.rimo?.orderId || ''
  };
  lead.updatedAt = now;
  await env.TIDEMEDIX_LEADS.put(`lead:${id}`, JSON.stringify(lead));
  return { email, leadId: id, marked: true, lead };
}

function eventTypeFromPayload(payload, request = null) {
  return clean(
    payload.event ||
    payload.type ||
    payload.event_type ||
    payload.eventType ||
    payload.topic ||
    payload.name ||
    payload.action ||
    request?.headers?.get('x-rimo-event') ||
    'unknown'
  ).toLowerCase();
}

function emailFromPayload(payload) {
  const object = payload.data?.object || {};
  const responses = object.responses || object.teleformResponses?.[0]?.responses || {};
  return normalizeEmail(firstTruthy(
    payload.email,
    payload.customer_email,
    payload.customerEmail,
    payload.patient_email,
    payload.patientEmail,
    payload.customer?.email,
    payload.patient?.email,
    payload.order?.email,
    payload.checkout?.email,
    payload.data?.email,
    payload.data?.customer?.email,
    payload.data?.patient?.email,
    payload.data?.order?.email,
    payload.data?.checkout?.email,
    object.email,
    object.lead?.email,
    object.customer?.email,
    object.patient?.email,
    responses.accountInfo?.email,
    responses.patientInfo?.email
  ));
}

function amountFromPayload(payload) {
  const order = payload.order || payload.data?.order || payload.checkout || payload.data?.checkout || payload;
  const value = firstTruthy(payload.amount, payload.total, payload.total_amount, payload.order_amount, order?.amount, order?.total, order?.total_amount, order?.subtotal, order?.value);
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function progressFromRimo(rawProgress, step, status) {
  const direct = Number(rawProgress);
  if (Number.isFinite(direct) && direct > 0) return Math.max(0, Math.min(100, direct));
  const normalizedStatus = clean(status).toLowerCase();
  if (/complete|completed|submitted/.test(normalizedStatus)) return 100;
  const s = clean(step).toLowerCase();
  if (!s) return 0;
  if (/checkout|payment/.test(s)) return 92;
  if (/patient.*note|medva.*note|note/.test(s)) return 77;
  if (/create.*account|account/.test(s)) return 85;
  if (/bmi|height|weight/.test(s)) return 55;
  if (/medical|health|history|screen/.test(s)) return 65;
  return 40;
}

function statusFromRimoEvent(eventType) {
  if (isPurchaseEvent(eventType, {})) return 'purchased';
  if (isCompletedNoPurchaseEvent(eventType, {})) return 'completed_no_purchase';
  if (isCheckoutEvent(eventType)) return 'checkout_started';
  if (/lead|customer|patient|contact|form|assessment|quiz/.test(eventType)) return 'checkout_started';
  return 'rimo_event_received';
}

function isCheckoutEvent(eventType) {
  return /checkout.*(start|create|begin)|initiate.*checkout|cart|payment.*start/.test(eventType);
}

export function isCompletedNoPurchaseEvent(eventType, payload = {}) {
  const object = payload.data?.object || {};
  const teleformResponse = primaryTeleformResponse(object);
  const status = clean(firstTruthy(payload.status, teleformResponse.status, object.status, payload.checkout?.status)).toLowerCase();
  const progress = progressFromRimo(
    firstTruthy(payload.progress, payload.progressPercent, object.progress, object.progressPercent, teleformResponse.progress, teleformResponse.progressPercent, object.screenMetrics?.progress, object.screenMetrics?.percentComplete, teleformResponse.screenMetrics?.progress, teleformResponse.screenMetrics?.percentComplete, 0),
    firstTruthy(payload.currentStep, payload.current_step, payload.lastStep, object.currentStep, object.lastStep, teleformResponse.currentStep, teleformResponse.lastStep),
    status
  );
  if (isPurchaseEvent(eventType, payload)) return false;
  return /(assessment|intake|teleform|form|checkout).*(complete|completed|submitted|finished)|complete.*(assessment|intake|teleform|form|checkout)/.test(eventType)
    || (/(complete|completed|submitted|finished)/.test(status) && progress >= 90)
    || progress >= 100;
}

function primaryTeleformResponse(object = {}) {
  return object.teleformResponses?.[0] || object.teleformResponse || (/teleform_response/.test(clean(object.object || object.type || '')) || object.teleformId || object.responseToken ? object : {});
}

function isPurchaseEvent(eventType, payload = {}) {
  const status = clean(payload.status || payload.order?.status || payload.data?.order?.status || payload.checkout?.status).toLowerCase();
  return /purchase|order.*(paid|complete|created|success)|payment.*(paid|success|complete)|subscription.*(created|active)/.test(eventType) || /paid|complete|completed|success|active/.test(status);
}

async function verifyWebhookSignature(request, rawBody, secret) {
  const candidates = [
    request.headers.get('x-rimo-signature'),
    request.headers.get('x-webhook-signature'),
    request.headers.get('x-signature'),
    request.headers.get('signature'),
    request.headers.get('x-hub-signature-256')
  ].filter(Boolean);
  if (!candidates.length) {
    const supplied = request.headers.get('x-webhook-secret') || request.headers.get('x-rimo-secret') || '';
    return supplied && safeEqual(supplied, secret);
  }

  const timestamp = request.headers.get('x-rimo-timestamp') || '';
  const signedPayloads = [
    rawBody,
    timestamp ? `${timestamp}.${rawBody}` : '',
    timestamp ? `${timestamp}${rawBody}` : ''
  ].filter(Boolean);
  const expected = [];
  for (const payload of signedPayloads) {
    const hex = await hmacSha256Hex(secret, payload);
    const base64 = await hmacSha256Base64(secret, payload);
    expected.push(hex, `sha256=${hex}`, base64, `sha256=${base64}`);
  }
  return candidates.some(candidate => {
    const value = String(candidate).trim();
    return expected.some(signature => safeEqual(value, signature));
  });
}

async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Base64(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  let binary = '';
  for (const byte of new Uint8Array(sig)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function safeWebhookHeaders(request) {
  const keep = ['x-rimo-event', 'x-rimo-webhook-id', 'x-rimo-store-id', 'x-rimo-timestamp', 'x-rimo-delivery-attempt', 'x-rimo-signature', 'x-webhook-signature', 'x-signature', 'signature', 'x-hub-signature-256', 'user-agent'];
  const headers = {};
  for (const name of keep) {
    const value = request.headers.get(name);
    if (value) headers[name] = name.includes('signature') ? '[present]' : clean(value);
  }
  return headers;
}

function firstTruthy(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function safeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function json(request, data, status = 200) {
  return corsResponse(request, JSON.stringify(data), status, { 'content-type': 'application/json; charset=utf-8' });
}

function redirect(url, status = 302) {
  return new Response(null, { status, headers: { location: url } });
}

function corsResponse(request, body, status = 200, extraHeaders = {}) {
  const origin = request.headers.get('origin') || '';
  const allowOrigin = CORS_ORIGINS.has(origin) ? origin : 'https://go.tidemedix.com';
  return new Response(body, {
    status,
    headers: {
      'access-control-allow-origin': allowOrigin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-webhook-secret,x-rimo-secret,x-rimo-signature,x-webhook-signature,x-signature,signature,x-hub-signature-256',
      'vary': 'Origin',
      ...extraHeaders
    }
  });
}

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function clean(value) { return String(value || '').trim().slice(0, 500); }
function cleanUrl(value) {
  const s = String(value || '').trim();
  return /^https:\/\//.test(s) ? s.slice(0, 3000) : '';
}
async function sha256Hex(value) {
  const data = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value || ''));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hash));
}
function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }
