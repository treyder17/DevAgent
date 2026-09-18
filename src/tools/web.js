// src/tools/web.js — internet access for the agent, no API key.
//
// web_fetch  : download a URL and return readable text (HTML stripped).
// web_search : DuckDuckGo HTML endpoint, scraped — keyless, no account.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const MAX_TEXT = 12000;

/** Strip tags/scripts/styles from HTML into rough plain text. */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Fetch a URL and return readable text (or raw text for non-HTML). */
export async function fetchUrl(url, { timeoutMs = 20000 } = {}) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const type = res.headers.get('content-type') || '';
    const body = await res.text();
    let text = /html/i.test(type) ? htmlToText(body) : body.trim();
    let truncated = false;
    if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT); truncated = true; }
    return {
      ok: res.ok,
      status: res.status,
      url: res.url,
      text,
      truncated,
    };
  } catch (err) {
    return { ok: false, status: 0, url, text: '', error: err.message };
  }
}

/** Scrape DuckDuckGo's HTML endpoint. Returns [{ title, url, snippet }]. */
export async function webSearch(query, { limit = 6, timeoutMs = 20000 } = {}) {
  const endpoint = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  try {
    const res = await fetch(endpoint, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `search HTTP ${res.status}`, results: [] };
    const html = await res.text();

    const results = [];
    // Each hit: <a class="result__a" href="...">Title</a> ... snippet.
    const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRe.exec(html)) && results.length < limit) {
      let href = decodeDdg(m[1]);
      const title = htmlToText(m[2]);
      if (href && title) results.push({ title, url: href, snippet: '' });
    }

    // Snippets, matched in document order and zipped onto the results.
    const snipRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let i = 0;
    while ((m = snipRe.exec(html)) && i < results.length) {
      results[i].snippet = htmlToText(m[1]);
      i++;
    }

    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: err.message, results: [] };
  }
}

/** DuckDuckGo wraps hrefs as /l/?uddg=<encoded-real-url>. */
function decodeDdg(href) {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) { try { return decodeURIComponent(m[1]); } catch { /* keep raw */ } }
  if (href.startsWith('//')) return 'https:' + href;
  return href;
}

export const WEB_TOOLS = [
  {
    name: 'web_fetch',
    description: `Fetch a web page or file over the internet and return its readable text.
Use for reading documentation, a GitHub file, an API reference, a blog post, etc.
Give a full URL. HTML is stripped to text; long pages are truncated.`,
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch (https://...).' },
      },
      required: ['url'],
    },
  },
  {
    name: 'web_search',
    description: `Search the web (DuckDuckGo) and return the top results as title + url + snippet.
Use to find current information, docs, error messages, libraries. Follow up with web_fetch to read a result.`,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for.' },
      },
      required: ['query'],
    },
  },
];
