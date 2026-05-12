const CORS_ORIGINS = new Set([
  'https://go.tidemedix.com',
  'https://gotidemedix.com',
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
  { key: 'welcome',       delayMs: 0,                              subject: (n) => `Your consultation is waiting${n ? `, ${n}` : ''}`,         template: renderWelcomeEmail,     ctaTarget: 'checkout' },
  { key: 'followup_2h',   delayMs: 2 * 60 * 60 * 1000,             subject: () => 'Quick question about your consultation',                    template: renderTwoHourEmail,     ctaTarget: 'product'  },
  { key: 'followup_24h',  delayMs: 24 * 60 * 60 * 1000,            subject: () => 'Most people have this question about GLP-1 medications',    template: renderDayOneEmail,      ctaTarget: 'product'  },
  { key: 'followup_72h',  delayMs: 72 * 60 * 60 * 1000,            subject: () => 'Your physician consultation is still available',            template: renderDayThreeEmail,    ctaTarget: 'product'  },
  { key: 'followup_5d',   delayMs: 5 * 24 * 60 * 60 * 1000,        subject: () => "3 things most people don't know about prescription weight management", template: renderDayFiveEmail, ctaTarget: 'product' },
  { key: 'followup_10d',  delayMs: 10 * 24 * 60 * 60 * 1000,       subject: () => 'Last note from TideMedix',                                  template: renderDayTenEmail,      ctaTarget: 'product'  }
];

// Separate recovery sequence for people who enter email at the gate, then leave
// before submitting contact/checkout details. These emails only sell quiz
// completion and always resume at the height/current-weight step.
export const ABANDON_EMAIL_STEPS = [
  { key: 'abandon_20m',          delayMs: 20 * 60 * 1000,             subject: () => 'Finish your TideMedix assessment',             template: renderAbandonTwentyMinuteEmail, ctaTarget: 'resume' },
  { key: 'abandon_next_morning', delayMs: 12 * 60 * 60 * 1000,        subject: () => 'Your assessment is almost ready',              template: renderAbandonNextMorningEmail,  ctaTarget: 'resume' },
  { key: 'abandon_2d',           delayMs: 2 * 24 * 60 * 60 * 1000,    subject: () => 'Still want to see if you may qualify?',        template: renderAbandonTwoDayEmail,       ctaTarget: 'resume' },
  { key: 'abandon_5d',           delayMs: 5 * 24 * 60 * 60 * 1000,    subject: () => 'Last reminder to finish your assessment',      template: renderAbandonFiveDayEmail,      ctaTarget: 'resume' }
];

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return corsResponse(request, null, 204);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json(request, { ok: true, service: 'tidemedix-leads' });
      if (url.pathname === '/api/lead' && request.method === 'POST') return handleLead(request, env, ctx);
      if (url.pathname === '/api/resume' && request.method === 'GET') return handleResume(request, env);
      if (url.pathname === '/api/purchase' && request.method === 'POST') return handlePurchase(request, env);
      if (url.pathname === '/api/purchased' && request.method === 'POST') return handlePurchase(request, env);
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

async function handleLead(request, env, ctx) {
  const body = await request.json();
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
    attribution: body.attribution || existing?.attribution || {},
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

async function handlePurchase(request, env) {
  if (env.PURCHASE_WEBHOOK_SECRET) {
    const supplied = request.headers.get('x-webhook-secret') || '';
    if (supplied !== env.PURCHASE_WEBHOOK_SECRET) return json(request, { ok: false, error: 'unauthorized' }, 401);
  }

  const body = await request.json();
  const email = normalizeEmail(body.email);
  if (!email) return json(request, { ok: false, error: 'email_required' }, 400);

  const id = await env.TIDEMEDIX_LEADS.get(`email:${email}`);
  if (!id) return json(request, { ok: false, error: 'lead_not_found' }, 404);

  const lead = await getLead(env, id);
  lead.status = 'purchased';
  lead.purchasedAt = new Date().toISOString();
  lead.purchase = {
    orderId: clean(body.orderId),
    amount: Number(body.amount || lead.value || 0),
    currency: clean(body.currency || 'USD')
  };
  lead.updatedAt = lead.purchasedAt;
  await env.TIDEMEDIX_LEADS.put(`lead:${id}`, JSON.stringify(lead));
  return json(request, { ok: true });
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
      if (!shouldConsiderCheckoutLead(lead) && !shouldConsiderAbandonLead(lead)) continue;
      const checkoutTime = new Date(lead.checkoutStartedAt || lead.createdAt).getTime();
      const abandonTime = new Date(lead.abandonedAt || lead.createdAt).getTime();
      const steps = shouldConsiderAbandonLead(lead) ? ABANDON_EMAIL_STEPS : EMAIL_STEPS;
      const startTime = shouldConsiderAbandonLead(lead) ? abandonTime : checkoutTime;
      // Iterate steps after the checkout welcome (index 0 sent inline). Abandon
      // sequence has no inline send, so it starts at index 0.
      const firstStepIndex = shouldConsiderAbandonLead(lead) ? 0 : 1;
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
  return lead && lead.email && lead.status === 'checkout_started' && !lead.purchasedAt && !lead.unsubscribedAt;
}

export function shouldConsiderAbandonLead(lead) {
  return lead && lead.email && lead.status === 'quiz_abandoned' && !lead.purchasedAt && !lead.unsubscribedAt;
}

export function statusForLeadSubmission(body, existing) {
  if (existing?.status === 'purchased') return 'purchased';
  return body?.leadType === 'quiz_abandon' ? 'quiz_abandoned' : 'checkout_started';
}

async function sendStepAndRecord(env, lead, step) {
  await sendFollowup(env, lead, step);
  // Re-read latest lead to avoid clobbering concurrent updates.
  const fresh = (await getLead(env, lead.id)) || lead;
  fresh.emails = fresh.emails || {};
  fresh.emails[step.key] = new Date().toISOString();
  fresh.updatedAt = fresh.emails[step.key];
  await env.TIDEMEDIX_LEADS.put(`lead:${fresh.id}`, JSON.stringify(fresh));
}

async function sendFollowup(env, lead, step) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY secret missing');
  const productUrl = productLinkFor(lead);
  const checkoutUrl = lead.checkoutUrl || productUrl;
  const resumeUrl = buildResumeUrl(lead, env);
  const ctaUrl = step.ctaTarget === 'checkout' ? checkoutUrl : (step.ctaTarget === 'resume' ? resumeUrl : productUrl);
  const baseUrl = env.PUBLIC_BASE_URL || 'https://tidemedix-leads.tylerdefi.workers.dev';
  const unsubscribeUrl = `${baseUrl}/api/unsubscribe?id=${encodeURIComponent(lead.id)}`;
  const html = step.template(lead, ctaUrl, unsubscribeUrl);
  const subject = typeof step.subject === 'function' ? step.subject(escapeHtml(lead.firstName || '')) : step.subject;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL || 'TideMedix <care@tidemedix.com>',
      to: [lead.email],
      subject,
      html,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    })
  });
  if (!response.ok) throw new Error(`Resend failed ${response.status}: ${await response.text()}`);
}

function productLinkFor(lead) {
  const plan = normalizePlan(lead?.plan);
  return PRODUCT_LINKS[plan] || PRODUCT_LINKS.semaglutide;
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
    <p>Still want to see if prescription weight management may be appropriate for you?</p>
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
    <p>You started your TideMedix consultation, but didn't finish. Your answers and treatment selection are saved — you can pick up where you left off.</p>
    <p>The next step is a quick checkout. From there, a US-licensed physician reviews your consultation and decides whether prescription treatment is appropriate for you.</p>
    ${ctaButton(ctaUrl, 'Continue your consultation')}
    <p>No phone calls. No insurance runaround. If approved, your medication ships free in two days.</p>
  `, unsubscribeUrl);
}

function renderTwoHourEmail(lead, ctaUrl, unsubscribeUrl) {
  const name = lead.firstName ? ` ${escapeHtml(lead.firstName)}` : '';
  return emailShell(`
    <p>Hi${name},</p>
    <p>Quick question — was anything unclear about the consultation?</p>
    <p>Most people who pause are wondering one of two things: how the physician review works, or what happens if they're not approved. Both answers are simple.</p>
    <p>A US-licensed physician reviews your consultation within 24 hours. If treatment is appropriate, you're prescribed a plan. If not, you're not charged for medication.</p>
    ${ctaButton(ctaUrl, 'See how TideMedix works')}
  `, unsubscribeUrl);
}

function renderDayOneEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>One thing most people ask before starting:</p>
    <p><strong>"Is this the same kind of medication my doctor would prescribe?"</strong></p>
    <p>Yes. TideMedix offers GLP-1 medications that are prescribed by US-licensed physicians, the same class of medication used in clinical practice for prescription weight management. The difference is process: an online consultation, a physician review, and direct delivery — without the appointments, copays, and waitlists.</p>
    <p>Your selection is still saved.</p>
    ${ctaButton(ctaUrl, 'Learn more')}
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
    <p>Three things most people don't know about prescription weight management:</p>
    <p><strong>1. A physician decides, not a form.</strong> Your consultation is reviewed by a US-licensed physician. If GLP-1 treatment isn't appropriate for you, you're not prescribed it.</p>
    <p><strong>2. The plan is ongoing, not one-time.</strong> Treatment is structured as a monthly plan with physician oversight, not a single shipment.</p>
    <p><strong>3. You can stop any time.</strong> No long contracts. You're in control of your plan from the dashboard.</p>
    <p>If that lines up with what you're looking for, your consultation is still here:</p>
    ${ctaButton(ctaUrl, 'See your plan')}
  `, unsubscribeUrl);
}

function renderDayTenEmail(lead, ctaUrl, unsubscribeUrl) {
  return emailShell(`
    <p>This is the last note we'll send.</p>
    <p>If TideMedix isn't the right fit right now, that's reasonable — prescription weight management should feel clear before you move forward, not rushed.</p>
    <p>If you'd still like to finish, the door is open:</p>
    ${ctaButton(ctaUrl, 'Return to TideMedix')}
    <p>After this, we'll stop emailing about this consultation. Take care.</p>
  `, unsubscribeUrl);
}

function ctaButton(url, label) {
  return `<p><a href="${escapeAttr(url)}">${escapeHtml(label)}</a></p>`;
}

function emailShell(body, unsubscribeUrl) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:20px;background:#ffffff;color:#222222;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:1.5">
${body}
<p>&mdash; TideMedix Care Team</p>
<p style="font-size:12px;color:#777777;margin-top:32px">
LegitScript Certified. US-Licensed Physicians.<br>
You're receiving this because you started a consultation at TideMedix.
<a href="${escapeAttr(unsubscribeUrl)}" style="color:#777777">Unsubscribe</a>.
</p>
</body>
</html>`;
}

// ---------- Helpers ----------

async function getLead(env, id) {
  const raw = await env.TIDEMEDIX_LEADS.get(`lead:${id}`);
  return raw ? JSON.parse(raw) : null;
}

function json(request, data, status = 200) {
  return corsResponse(request, JSON.stringify(data), status, { 'content-type': 'application/json; charset=utf-8' });
}

function corsResponse(request, body, status = 200, extraHeaders = {}) {
  const origin = request.headers.get('origin') || '';
  const allowOrigin = CORS_ORIGINS.has(origin) ? origin : 'https://go.tidemedix.com';
  return new Response(body, {
    status,
    headers: {
      'access-control-allow-origin': allowOrigin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-webhook-secret',
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
function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }
