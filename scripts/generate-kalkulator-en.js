const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'kalkulator.html'), 'utf8');
const replacements = [
  ['<html lang="id"', '<html lang="en"'],
  ['<title>Kalkulator Harga FOB Kopi Indonesia | Q.co</title>', '<title>FOB Coffee Price Calculator for Indonesia | Q.co</title>'],
  ['Hitung estimasi harga kopi Indonesia dari ICE C-Market ke rupiah/kg. Sesuaikan diferensial, biaya proses, kemasan, margin, dan logistik untuk memperkirakan harga FOB hingga landed.', 'Estimate Indonesian coffee prices from ICE C-Market in rupiah/kg. Adjust differential, processing, packaging, margin, and logistics costs to calculate FOB and landed prices.'],
  ['Kalkulator Harga FOB Kopi Indonesia | Q.co', 'FOB Coffee Price Calculator for Indonesia | Q.co'],
  ['Hitung estimasi harga kopi dari ICE C-Market ke rupiah/kg, lalu sesuaikan biaya dan logistik hingga FOB atau landed.', 'Estimate coffee prices from ICE C-Market in rupiah/kg, then adjust costs and logistics through FOB or landed.'],
  ['<link rel="canonical" href="https://blog.qcoid.com/kalkulator.html">', '<link rel="canonical" href="https://blog.qcoid.com/kalkulator-en.html">\n<link rel="alternate" hreflang="id" href="https://blog.qcoid.com/kalkulator.html">\n<link rel="alternate" hreflang="en" href="https://blog.qcoid.com/kalkulator-en.html">\n<link rel="alternate" hreflang="x-default" href="https://blog.qcoid.com/kalkulator.html">'],
  ['"name": "Kalkulator Harga Kopi FOB Indonesia"', '"name": "FOB Coffee Price Calculator for Indonesia"'],
  ['"keywords": ["kalkulator kopi", "harga FOB", "ICE C-Market", "rupiah", "kopi Indonesia"]', '"keywords": ["coffee price calculator", "FOB coffee price", "ICE C-Market", "Indonesian coffee"]'],
];
let output = source;
for (const [before, after] of replacements) {
  if (!output.includes(before)) throw new Error(`Expected calculator text was not found: ${before.slice(0, 80)}`);
  output = output.replaceAll(before, after);
}
output = output.replaceAll('https://blog.qcoid.com/kalkulator.html', 'https://blog.qcoid.com/kalkulator-en.html');
output = output.replace(/\s*<link rel="alternate" hreflang="[^"]+" href="[^"]+">/g, '');
output = output.replace('<link rel="canonical" href="https://blog.qcoid.com/kalkulator-en.html">', '<link rel="canonical" href="https://blog.qcoid.com/kalkulator-en.html">\n<link rel="alternate" hreflang="id" href="https://blog.qcoid.com/kalkulator.html">\n<link rel="alternate" hreflang="en" href="https://blog.qcoid.com/kalkulator-en.html">\n<link rel="alternate" hreflang="x-default" href="https://blog.qcoid.com/kalkulator.html">');
output = output.replace('<meta property="og:locale" content="id_ID">', '<meta property="og:locale" content="en_US">').replace('<meta property="og:locale:alternate" content="en_US">', '<meta property="og:locale:alternate" content="id_ID">');
fs.writeFileSync(path.join(root, 'kalkulator-en.html'), output);
console.log('Generated English calculator page.');
