const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://blog.qcoid.com';
const articlesDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'articles.json'), 'utf8'));
const published = (articlesDoc.articles || []).filter(article => article.status === 'Published');
const outputDir = path.join(ROOT, 'artikel');
fs.mkdirSync(outputDir, { recursive: true });

function slugify(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' dan ').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 70) || 'artikel-kopi';
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function plainText(value) {
  return String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}
function dateIso(article) {
  if (article.datePublished && !Number.isNaN(Date.parse(article.datePublished))) return new Date(article.datePublished).toISOString();
  const raw = String(article.date || '');
  const match = raw.match(/^(\d{1,2})\s+([\p{L}]+)\s+(\d{4})$/u) || raw.match(/^([\p{L}]+)\s+(\d{1,2}),?\s+(\d{4})$/u);
  if (!match) return '';
  const months = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember','january','february','march','april','may','june','july','august','september','october','november','december'];
  const monthName = (raw.match(/[\p{L}]+/u) || [''])[0].toLowerCase();
  const index = months.indexOf(monthName) % 12;
  const day = Number(raw.match(/\d{1,2}/)?.[0]);
  const year = Number(raw.match(/\d{4}/)?.[0]);
  if (!day || !year || index < 0) return '';
  return new Date(Date.UTC(year, index, day, 8)).toISOString();
}
function articlePath(article, language) {
  return `/artikel/${slugify(article.title_id)}-${language}-${article.id}.html`;
}
function homeArticleCard(article) {
  const title = escapeHtml(article.title_id || 'Artikel kopi');
  const description = escapeHtml(article.desc_id || 'Artikel tentang kopi Indonesia.');
  const category = escapeHtml(article.category || 'Kopi Indonesia');
  const date = escapeHtml(article.date || '');
  let imageUrl = article.image || 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&h=375&fit=crop';
  try { if (!['https:', 'http:'].includes(new URL(imageUrl).protocol)) imageUrl = ''; } catch (_) { imageUrl = ''; }
  const image = escapeHtml(imageUrl);
  const url = SITE + articlePath(article, 'id');
  const readingTime = article.readTime ? `${escapeHtml(article.readTime)} menit baca · ` : '';
  return `<article class="card group"><a href="${url}" class="aspect-[16/10] overflow-hidden rounded-t-2xl block">${image ? `<img src="${image}" alt="${title}" class="w-full h-full object-cover" loading="lazy">` : ''}</a><div class="p-6"><div class="flex items-center gap-3 mb-3"><span class="tag">${category}</span><span class="text-xs text-coffee-400">${date}</span></div><h3 class="font-serif text-xl font-bold text-coffee-900 mb-2"><a href="${url}" class="text-inherit no-underline">${title}</a></h3><p class="text-coffee-600 text-sm line-clamp-3 mb-4">${description}</p><div class="text-sm text-coffee-500">${readingTime}Baca artikel</div></div></article>`;
}
function articlePage(article, language) {
  const english = language === 'en';
  const title = english ? article.title_en : article.title_id;
  const description = english ? article.desc_en : article.desc_id;
  const content = english ? (article.content_en || article.content_id) : (article.content_id || article.content_en);
  const url = SITE + articlePath(article, language);
  const alternateId = SITE + articlePath(article, 'id');
  const alternateEn = SITE + articlePath(article, 'en');
  const image = article.image || 'https://i.imgur.com/vgcEMB2.png';
  const publishedAt = dateIso(article);
  const modifiedAt = article.dateModified && !Number.isNaN(Date.parse(article.dateModified)) ? new Date(article.dateModified).toISOString() : publishedAt;
  const body = plainText(content).slice(0, 5000);
  const schema = {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: title,
    description: description || plainText(content).slice(0, 160), image,
    ...(publishedAt ? { datePublished: publishedAt } : {}), ...(modifiedAt ? { dateModified: modifiedAt } : {}),
    inLanguage: english ? 'en' : 'id', author: { '@type': 'Person', name: 'Ganjar Satyanagara', url: SITE + '/' },
    publisher: { '@type': 'Organization', name: 'Q Coffee Outlook', url: SITE + '/', logo: { '@type': 'ImageObject', url: 'https://i.imgur.com/vgcEMB2.png' } },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url }, articleBody: body,
    keywords: [article.category, 'kopi Indonesia', 'coffee'].filter(Boolean)
  };
  return `<!doctype html>
<html lang="${english ? 'en' : 'id'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} | Q.co</title>
<meta name="description" content="${escapeHtml(description || plainText(content).slice(0, 155))}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="id" href="${alternateId}"><link rel="alternate" hreflang="en" href="${alternateEn}"><link rel="alternate" hreflang="x-default" href="${alternateId}">
<meta property="og:type" content="article"><meta property="og:site_name" content="Q Coffee Outlook"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description || plainText(content).slice(0, 155))}"><meta property="og:url" content="${url}"><meta property="og:image" content="${escapeHtml(image)}"><meta property="og:locale" content="${english ? 'en_US' : 'id_ID'}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description || plainText(content).slice(0, 155))}"><meta name="twitter:image" content="${escapeHtml(image)}">
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
<style>body{margin:0;background:#fdfbf7;color:#302820;font:17px/1.8 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:820px;margin:0 auto;padding:28px 22px 64px}nav{margin-bottom:30px;font-size:14px}a{color:#6f4e37}article{background:#fff;padding:clamp(20px,5vw,52px);border:1px solid #e8e1d8;border-radius:14px}article img{max-width:100%;height:auto}article h1,article h2,article h3{font-family:Georgia,serif;line-height:1.3;color:#382719}article h1{font-size:clamp(30px,5vw,46px)}article table{display:block;overflow:auto;max-width:100%;border-collapse:collapse}footer{margin-top:28px;color:#70675d;font-size:13px}</style>
</head><body><main><nav><a href="${SITE}/">${english ? '← Back to Q.co Blog' : '← Kembali ke Blog Q.co'}</a> · <a href="${english ? alternateId : alternateEn}">${english ? 'Baca dalam Bahasa Indonesia' : 'Read in English'}</a></nav><article>${content || `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>`}</article><footer>Ganjar Satyanagara · Q Coffee Outlook</footer></main></body></html>`;
}

const latestArticleDate = published.map(dateIso).filter(Boolean).sort().at(-1) || '';
const urls = [
  { loc: SITE + '/', lastmod: latestArticleDate },
  { loc: SITE + '/kalkulator.html', lastmod: '2026-10-03' },
  { loc: SITE + '/kalkulator-en.html', lastmod: '2026-10-03' }
];
for (const article of published) {
  for (const language of ['id', 'en']) {
    const content = language === 'en' ? article.content_en : article.content_id;
    if (!content) continue;
    const relative = articlePath(article, language);
    fs.writeFileSync(path.join(ROOT, relative), articlePage(article, language));
    const publishedAt = dateIso(article);
    urls.push({ loc: SITE + relative, lastmod: publishedAt ? publishedAt.slice(0, 10) : '' });
  }
}
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(item => `  <url><loc>${item.loc}</loc>${item.lastmod ? `<lastmod>${item.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);

// Keep the homepage article index readable from the initial HTML response.
// The interactive UI may still replace these cards after articles.json loads.
const homepagePath = path.join(ROOT, 'index.html');
let homepage = fs.readFileSync(homepagePath, 'utf8');
const cards = published.map(homeArticleCard).join('\n');
const staticCards = `<!-- STATIC_ARTICLE_CARDS -->\n<style>#articles-grid .skeleton-card[data-skeleton]{display:none!important}</style>\n${cards}\n<!-- /STATIC_ARTICLE_CARDS -->`;
if (homepage.includes('<!-- /STATIC_ARTICLE_CARDS -->')) homepage = homepage.replace(/<!-- STATIC_ARTICLE_CARDS -->[\s\S]*?<!-- \/STATIC_ARTICLE_CARDS -->/, staticCards);
else homepage = homepage.replace('<!-- STATIC_ARTICLE_CARDS -->', staticCards);
homepage = homepage.replace(/(<div[^>]*id="stat-articles"[^>]*>)[\s\S]*?(<\/div>)/, `$1${published.length}$2`);
const articleListSchema = {
  '@context': 'https://schema.org', '@type': 'ItemList', name: 'Artikel kopi terbaru',
  itemListElement: published.map((article, index) => ({ '@type': 'ListItem', position: index + 1, url: SITE + articlePath(article, 'id'), name: article.title_id, description: article.desc_id || '' }))
};
const schemaTag = `<script type="application/ld+json">${JSON.stringify(articleListSchema).replace(/</g, '\\u003c')}</script>`;
if (homepage.includes('<!-- STATIC_ARTICLE_LIST_SCHEMA -->')) homepage = homepage.replace('<!-- STATIC_ARTICLE_LIST_SCHEMA -->', schemaTag);
else if (!homepage.includes('"@type":"ItemList"')) homepage = homepage.replace('</head>', `${schemaTag}\n</head>`);
fs.writeFileSync(homepagePath, homepage);
console.log(`Generated ${published.length} article records and ${urls.length - 3} localized article pages.`);
