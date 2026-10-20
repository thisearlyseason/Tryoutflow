export const emailBrand = {
  name: 'TryoutFlow',
  origin: 'https://www.tryout.agency',
  logo: 'https://www.tryout.agency/brand/tryoutflow-logo.png',
};

export function escapeEmailHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

/** Plain text remains authoritative; make HTTPS action links usable in HTML mail. */
export function emailTextHtml(text: string): string {
  return text
    .split(/(https:\/\/[^\s<>"']+)/gu)
    .map((part) => {
      if (!part.startsWith('https://')) return escapeEmailHtml(part).replace(/\n/gu, '<br>');
      const link = part.replace(/[.,;:!?]+$/u, '');
      const punctuation = part.slice(link.length);
      const escaped = escapeEmailHtml(link);
      return `<a href="${escaped}" style="color:#0057ff;word-break:break-word">${escaped}</a>${escapeEmailHtml(punctuation)}`;
    })
    .join('');
}

/** Wrap trusted, already-escaped message HTML without changing approved message content. */
export function renderBrandedEmail(input: {
  subject: string;
  text: string;
  html?: string;
}): string {
  const title = escapeEmailHtml(input.subject);
  const content = input.html ?? `<p style="margin:0">${emailTextHtml(input.text)}</p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f7fb;color:#101d32;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dce3ed;border-radius:12px;overflow:hidden">
<tr><td style="padding:24px 28px;background:#0b1b30;border-bottom:4px solid #0057ff">
<a href="${emailBrand.origin}" style="color:#ffffff;text-decoration:none"><img src="${emailBrand.logo}" alt="TryoutFlow" width="80" height="80" style="display:block;border:0;margin-bottom:12px"><span style="font-size:24px;font-weight:700;color:#ffffff">TryoutFlow</span></a>
<p style="margin:6px 0 0;color:#c6d4e8;font-size:14px">Every athlete. Every evaluation. One clear next step.</p></td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.65;overflow-wrap:anywhere;word-break:break-word">
<h1 style="margin:0 0 20px;color:#101d32;font-size:25px;line-height:1.25">${title}</h1>
${content}
</td></tr>
<tr><td style="padding:20px 28px;background:#eef2f7;border-top:1px solid #dce3ed;color:#5b6b80;font-size:13px;line-height:1.6">
<p style="margin:0 0 6px">Sent through TryoutFlow. For questions about a tryout or team decision, contact your organization.</p>
<p style="margin:0 0 6px">Operated by GameDay Technologies. <a href="mailto:gamedaysportstech@gmail.com" style="color:#0057ff">Contact support</a></p>
<a href="${emailBrand.origin}" style="color:#0057ff">TryoutFlow</a> &nbsp;·&nbsp; <a href="${emailBrand.origin}/privacy" style="color:#0057ff">Privacy</a>
</td></tr></table></td></tr></table></body></html>`;
}
