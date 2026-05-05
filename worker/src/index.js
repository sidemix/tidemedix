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

// Drip schedule. The "welcome" email at index 0 is sent inline from /api/lead,
// not by the cron. Remaining steps are sent by the hourly cron based on delayMs
// from the lead's checkoutStartedAt.
const EMAIL_STEPS = [
  { key: 'welcome',       delayMs: 0,                              subject: (n) => `Your consultation is waiting${n ? `, ${n}` : ''}`,         template: renderWelcomeEmail,     ctaTarget: 'checkout' },
  { key: 'followup_2h',   delayMs: 2 * 60 * 60 * 1000,             subject: () => 'Quick question about your consultation',                    template: renderTwoHourEmail,     ctaTarget: 'product'  },
  { key: 'followup_24h',  delayMs: 24 * 60 * 60 * 1000,            subject: () => 'Most people have this question about GLP-1 medications',    template: renderDayOneEmail,      ctaTarget: 'product'  },
  { key: 'followup_72h',  delayMs: 72 * 60 * 60 * 1000,            subject: () => 'Your physician consultation is still available',            template: renderDayThreeEmail,    ctaTarget: 'product'  },
  { key: 'followup_5d',   delayMs: 5 * 24 * 60 * 60 * 1000,        subject: () => "3 things most people don't know about prescription weight management", template: renderDayFiveEmail, ctaTarget: 'product' },
  { key: 'followup_10d',  delayMs: 10 * 24 * 60 * 60 * 1000,       subject: () => 'Last note from TideMedix',                                  template: renderDayTenEmail,      ctaTarget: 'product'  }
];

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return corsResponse(request, null, 204);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json(request, { ok: true, service: 'tidemedix-leads' });
      if (url.pathname === '/api/lead' && request.method === 'POST') return handleLead(request, env, ctx);
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
    status: existing?.status === 'purchased' ? 'purchased' : 'checkout_started',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    checkoutStartedAt: existing?.checkoutStartedAt || now,
    purchasedAt: existing?.purchasedAt || null,
    unsubscribedAt: existing?.unsubscribedAt || null,
    emails: existing?.emails || {}
  };

  await env.TIDEMEDIX_LEADS.put(`lead:${id}`, JSON.stringify(lead));
  await env.TIDEMEDIX_LEADS.put(`email:${email}`, id);

  // Send immediate welcome email (don't block response). Skip if already sent.
  if (!lead.emails.welcome && !lead.purchasedAt && !lead.unsubscribedAt) {
    ctx.waitUntil(sendStepAndRecord(env, lead, EMAIL_STEPS[0]).catch(err => console.error('welcome_send_failed', err)));
  }

  return json(request, { ok: true, id });
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
      if (!shouldConsiderLead(lead)) continue;
      const checkoutTime = new Date(lead.checkoutStartedAt || lead.createdAt).getTime();
      // Iterate steps after the welcome (index 0 sent inline).
      for (let i = 1; i < EMAIL_STEPS.length; i++) {
        const step = EMAIL_STEPS[i];
        if (lead.emails?.[step.key]) continue;
        if (now - checkoutTime < step.delayMs) continue;
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

function shouldConsiderLead(lead) {
  return lead && lead.email && lead.status !== 'purchased' && !lead.purchasedAt && !lead.unsubscribedAt;
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
  const ctaUrl = step.ctaTarget === 'checkout' ? checkoutUrl : productUrl;
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

function normalizePlan(value) {
  const s = String(value || '').toLowerCase().trim();
  if (s === 'tirzepatide') return 'tirzepatide';
  return 'semaglutide';
}

// ---------- Email templates ----------

function renderWelcomeEmail(lead, ctaUrl, unsubscribeUrl) {
  const name = lead.firstName ? ` ${escapeHtml(lead.firstName)}` : '';
  return emailShell(`
    <p>Hi${name},</p>
    <p>You started your TideMedix consultation, but didn't finish. Your answers and treatment selection are saved — you can pick up where you left off.</p>
    <p>The next step is a quick checkout. From there, a US-licensed physician reviews your consultation and decides whether prescription treatment is appropriate for you.</p>
    ${ctaButton(ctaUrl, 'Continue your consultation')}
    <p style="color:#8ea0b5;font-size:14px">No phone calls. No insurance runaround. If approved, your medication ships free in two days.</p>
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
    <p style="color:#8ea0b5;font-size:14px">If you have a question first, reply to this email — it goes to a real person on our care team.</p>
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
    <p style="color:#8ea0b5;font-size:14px">After this, we'll stop emailing about this consultation. Take care.</p>
  `, unsubscribeUrl);
}

function ctaButton(url, label) {
  return `<p style="margin:22px 0"><a href="${escapeAttr(url)}" style="display:inline-block;background:#0d9488;color:#ffffff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.2px">${escapeHtml(label)}</a></p>`;
}

function emailShell(body, unsubscribeUrl) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#07111f;color:#e5eef7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.6">
  <div style="max-width:580px;margin:0 auto;padding:32px 24px">
    <div style="margin-bottom:18px">
      <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.3px">Tide<span style="color:#5eead4">Medix</span></span>
    </div>
    <div style="background:#0f1c2e;border:1px solid #1f334a;border-radius:14px;padding:28px 26px">
      ${body}
    </div>
    <p style="font-size:12px;color:#7a8aa0;margin:18px 0 6px;text-align:center">LegitScript Certified · US-Licensed Physicians · Free 2-Day Shipping</p>
    <p style="font-size:12px;color:#7a8aa0;margin:0;text-align:center">
      You're receiving this because you started a consultation at TideMedix.<br>
      <a style="color:#8ddbd3;text-decoration:underline" href="${escapeAttr(unsubscribeUrl)}">Unsubscribe</a>
    </p>
  </div>
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
