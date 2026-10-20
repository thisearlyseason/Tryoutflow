import { mkdirSync, writeFileSync } from 'node:fs';
import { renderBrandedEmail, escapeEmailHtml } from '../src/infrastructure/email/brand-template.ts';
const out = process.env.TRYOUTFLOW_EMAIL_PREVIEW_DIR ?? 'output/email-previews';
mkdirSync(out, { recursive: true });
const button = (label, href = '{{ .ConfirmationURL }}') =>
  `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#0057ff;color:#ffffff;padding:14px 22px;border-radius:6px;font-weight:bold;text-decoration:none">${label}</a></p>`;
const ignored =
  '<p style="font-size:14px;color:#5b6b80">If you did not request this, you can safely ignore this email.</p>';
const security =
  '<p>If you made this change, no further action is needed. If you did not, reset your password and contact TryoutFlow support at <a href="mailto:gamedaysportstech@gmail.com">gamedaysportstech@gmail.com</a>.</p>';
const templates = [
  [
    'confirmation',
    'confirm-sign-up',
    'Confirm your TryoutFlow email',
    `<p>Welcome to TryoutFlow. Confirm your email to get your workspace ready for your next tryout.</p>${button('Confirm email')}${ignored}`,
  ],
  [
    'invite',
    'invite-user',
    "You're invited to TryoutFlow",
    `<p>You have been invited to join TryoutFlow. Accept your invitation to create your account and get started.</p>${button('Accept invitation')}${ignored}`,
  ],
  [
    'magic_link',
    'magic-link-or-otp',
    'Your TryoutFlow sign-in link',
    `<p>Use the button below to securely sign in to TryoutFlow. This link can only be used once.</p>${button('Sign in to TryoutFlow')}<p>If you requested a sign-in code, enter <strong>{{ .Token }}</strong> in the app.</p>${ignored}`,
  ],
  [
    'email_change',
    'change-email-address',
    'Confirm your TryoutFlow email change',
    `<p>You requested an email address change for your TryoutFlow account. Confirm the change to continue.</p>${button('Confirm email change')}${ignored}`,
  ],
  [
    'recovery',
    'reset-password',
    'Reset your TryoutFlow password',
    `<p>We received a request to reset your TryoutFlow password. Choose a new password using the secure link below.</p>${button('Reset password')}<p style="font-size:14px;color:#5b6b80">If you did not request this, you can ignore this email. Your password will stay the same.</p>`,
  ],
  [
    'reauthentication',
    'reauthentication',
    'Your TryoutFlow verification code',
    `<p>Enter this code in TryoutFlow to confirm it is you and continue.</p><p style="font-size:32px;letter-spacing:6px;background:#eef2f7;padding:20px;text-align:center;font-weight:bold">{{ .Token }}</p><p>Keep this code private. TryoutFlow will never ask you to share it by email.</p>${ignored}`,
  ],
  [
    'password_changed_notification',
    'password-changed',
    'Your TryoutFlow password was changed',
    `<p>The password for your TryoutFlow account was changed.</p>${security}`,
  ],
  [
    'email_changed_notification',
    'email-address-changed',
    'Your TryoutFlow email was changed',
    `<p>The email address for your TryoutFlow account was changed from <strong>{{ .OldEmail }}</strong> to <strong>{{ .Email }}</strong>.</p>${security}`,
  ],
  [
    'phone_changed_notification',
    'phone-number-changed',
    'Your TryoutFlow phone number was changed',
    `<p>The phone number for your TryoutFlow account was changed from <strong>{{ .OldPhone }}</strong> to <strong>{{ .Phone }}</strong>.</p>${security}`,
  ],
  [
    'identity_linked_notification',
    'sign-in-method-linked',
    'A sign-in method was added to TryoutFlow',
    `<p>A <strong>{{ .Provider }}</strong> sign-in method was linked to your TryoutFlow account.</p>${security}`,
  ],
  [
    'identity_unlinked_notification',
    'sign-in-method-removed',
    'A sign-in method was removed from TryoutFlow',
    `<p>The <strong>{{ .Provider }}</strong> sign-in method was removed from your TryoutFlow account.</p>${security}`,
  ],
  [
    'mfa_factor_enrolled_notification',
    'mfa-method-added',
    'A verification method was added to TryoutFlow',
    `<p>A <strong>{{ .FactorType }}</strong> verification method was added to your TryoutFlow account.</p>${security}`,
  ],
  [
    'mfa_factor_unenrolled_notification',
    'mfa-method-removed',
    'A verification method was removed from TryoutFlow',
    `<p>A <strong>{{ .FactorType }}</strong> verification method was removed from your TryoutFlow account.</p>${security}`,
  ],
].map(([key, slug, subject, html]) => ({
  key,
  slug,
  subject,
  html: renderBrandedEmail({ subject, text: '', html }),
}));
for (const t of templates) {
  writeFileSync(`supabase/templates/${t.key}.html`, t.html);
  writeFileSync(
    `${out}/${t.key}.html`,
    t.html
      .replaceAll('{{ .ConfirmationURL }}', 'https://www.tryout.agency/sign-in')
      .replaceAll('{{ .Token }}', '123456'),
  );
}
writeFileSync(`${out}/templates.json`, JSON.stringify(templates, null, 2));
writeFileSync(
  `${out}/index.html`,
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>TryoutFlow email previews</title><body style="font-family:Arial;background:#f5f7fb;padding:24px"><h1>TryoutFlow email previews</h1><p>Preview only. No emails are sent.</p>${templates.map((t) => `<section><h2>${escapeEmailHtml(t.subject)}</h2><a href="${t.key}.html">Open preview</a><label>Source ${t.key}<textarea id="${t.key}" data-slug="${t.slug}" data-subject="${escapeEmailHtml(t.subject)}" style="display:block;width:100%;height:60px">${escapeEmailHtml(t.html)}</textarea></label></section>`).join('')}</body></html>`,
);
console.log(`Generated ${templates.length} authentication email templates and previews.`);
