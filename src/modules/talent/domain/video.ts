/** Preserve provider access controls; link to the marked moment without proxying media. */
export function videoMoment(raw: string, start: number | null, end: number | null) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('HTTPS media URL required');
  if (start === null) return url.toString();
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) {
    url.searchParams.set('t', `${Math.floor(start)}s`);
  } else if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(url.hostname)) {
    url.hash = `t=${Math.floor(start)}s`;
  } else if (/\.(mp4|webm|ogv)$/i.test(url.pathname)) {
    url.hash = `t=${Math.floor(start)}${end !== null ? `,${Math.floor(end)}` : ''}`;
  }
  return url.toString();
}
