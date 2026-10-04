const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'kalkulator.html'), 'utf8');
const replacements = [
  ['<html lang="id"', '<html lang="en"'],
  ['<title>Kalkulator Harga FOB Kopi Indonesia | Q.co</title>', '<title>FOB Coffee Price Calculator for Indonesia | Q.co</title>'],
  ['Kalkulator ini membantu memperkirakan harga kopi Indonesia <strong class="text-white">dari kebun sampai FOB</strong> dengan acuan C-Market. Angka acuan diperbarui melalui feed berkala; periksa waktu pembaruan dan sesuaikan parameter dengan kondisi transaksi Anda: Differential, Premium, Grade, Margin, biaya proses, kemasan, logistik, dokumen ekspor, dan pallet.', 'Estimate Indonesian coffee prices <strong class="text-white">from farm gate to FOB</strong> using C-Market benchmarks. Reference data is updated through a scheduled feed; check its update time and adjust the inputs to your transaction: differential, premium, grade, margin, processing, packaging, logistics, export documents, and pallets.'],
  ['Hasilnya adalah <strong class="text-white">estimasi untuk pembanding</strong>, bukan penawaran atau jaminan harga. Kalkulator mendukung mode <strong class="text-white">Komersial</strong> dan <strong class="text-white">Specialty</strong>; differential dan premium per grade dapat disesuaikan.', 'The result is <strong class="text-white">an estimate for comparison</strong>, not an offer or price guarantee. The calculator supports <strong class="text-white">Commercial</strong> and <strong class="text-white">Specialty</strong> modes; differentials and grade premiums can be adjusted.'],
  ['Data acuan C-Market berkala', 'Scheduled C-Market reference data'],

  ['Harga acuan berkala dan estimasi FOB — interaktif', 'Scheduled price references and FOB estimates — interactive'],
  ['Data acuan dimuat dari feed berkala; periksa tanggal pembaruan sebelum memakai angka.', 'Reference data loads from a scheduled feed; check its update date before using the figures.'],
  ['title="Perbarui kurs dari feed"', 'title="Refresh exchange rate from the data feed"'],
  ['Cara membaca angka dan batas estimasi', 'How to read the figures and estimate limitations'],
  ['Acuan Arabika C-Market dan indikator Robusta ICO berasal dari feed berkala; tanggal pembaruan ditampilkan pada kalkulator. Nilai yang tampak sebelum feed selesai dimuat adalah angka awal untuk simulasi, bukan kutipan harga terkini. Kurs, diferensial, premium, rasio cherry, biaya, dan margin dapat diubah sesuai transaksi.', 'Arabica C-Market references and the ICO Robusta indicator come from a scheduled data feed; the calculator shows the update date. Figures displayed before the feed finishes loading are starter values for simulation, not current price quotes. Exchange rate, differential, premium, cherry ratio, costs, and margin can be adjusted to match a transaction.'],
  ['Perkiraan dasar Arabika: (C-Market dalam sen per pon ÷ 100 ÷ 0,453592) = USD/kg. Estimasi FOB menambahkan diferensial dan premium, biaya proses, kemasan, dokumen, logistik, serta biaya pallet per kg; margin diterapkan sesuai input. Estimasi landed menambahkan komponen pengiriman dan biaya pelabuhan yang ditampilkan pada rincian kalkulasi.', 'Basic Arabica estimate: (C-Market in cents per pound ÷ 100 ÷ 0.453592) = USD/kg. The FOB estimate adds differential and premium, processing, packaging, documentation, logistics, and pallet cost per kg; the entered margin is then applied. The landed estimate adds shipping and port cost components shown in the calculation details.'],
  ['<strong class="text-white">Batas penggunaan:</strong> hasil adalah alat pembanding, bukan harga transaksi, penawaran, atau jaminan laba. Harga aktual bergantung pada mutu dan kondisi lot, negosiasi buyer, volume, pelabuhan, tarif logistik, kurs, serta ketentuan yang berlaku. Periksa sumber data, tanggal acuan, dan rincian biaya sebelum mengambil keputusan.', '<strong class="text-white">Use limitations:</strong> the result is a comparison tool, not a transaction price, offer, or profit guarantee. Actual prices depend on lot quality and condition, buyer negotiations, volume, ports, logistics rates, exchange rates, and applicable terms. Check the data source, reference date, and cost breakdown before making decisions.'],
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
