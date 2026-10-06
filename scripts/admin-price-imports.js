function priceImportField(label, value, key, type = "text") {
    const wrap = document.createElement("label"); wrap.className = "block text-xs text-coffee-600"; wrap.append(document.createTextNode(label));
    const input = document.createElement("input"); input.type = type; input.dataset.priceField = key; input.className = "w-full px-2 py-1 border rounded mt-1 text-sm"; input.value = value == null ? "" : String(value);
    if (type === "number") { input.step = "any"; input.min = "0"; }
    wrap.append(input); return wrap;
}
function priceImportSelect(label, value, key, options) {
    const wrap = document.createElement("label"); wrap.className = "block text-xs text-coffee-600"; wrap.append(document.createTextNode(label));
    const select = document.createElement("select"); select.dataset.priceField = key; select.className = "w-full px-2 py-1 border rounded mt-1 text-sm";
    options.forEach(([optionValue, optionLabel]) => { const option = document.createElement("option"); option.value = optionValue; option.textContent = optionLabel; option.selected = String(value || "") === optionValue; select.append(option); });
    wrap.append(select); return wrap;
}
function updatePriceSourceFields(section) {
    const kind = section.querySelector('[data-price-field="source_type"]')?.value || "url";
    const urlField = section.querySelector('[data-source-kind="url"]');
    const detailField = section.querySelector('[data-source-kind="field"]');
    if (urlField) { urlField.hidden = kind === "field"; urlField.querySelector("input").disabled = kind === "field"; }
    if (detailField) { detailField.hidden = kind !== "field"; detailField.querySelector("input").disabled = kind !== "field"; }
}
function validatePriceImportRows(card) {
    const fieldLabels = {
        source: "Nama sumber", source_url: "URL HTTPS sumber", source_detail: "Keterangan sumber lapangan", product: "Nama produk",
        type: "Jenis", form: "Bentuk", currency: "Mata uang", unit: "Satuan jumlah"
    };
    const rows = [...card.querySelectorAll("section")];
    const problems = [];
    let firstInvalid = null;
    rows.forEach((section, index) => {
        const fields = Object.fromEntries([...section.querySelectorAll("[data-price-field]")].map(input => [input.dataset.priceField, input]));
        const missing = [];
        const sourceType = fields.source_type?.value || "url";
        const requiredFields = ["source", "product", "type", "form", "currency", "unit", ...(sourceType === "field" ? ["source_detail"] : ["source_url"])];
        for (const key of requiredFields) {
            const input = fields[key];
            const value = input?.value.trim() || "";
            let valid = Boolean(value);
            if (key === "source_url" && valid) {
                try { valid = new URL(value).protocol === "https:"; } catch (_) { valid = false; }
            }
            if (!valid) {
                missing.push(fieldLabels[key]);
                if (input) {
                    input.setAttribute("aria-invalid", "true");
                    input.style.borderColor = "#b91c1c";
                    input.style.outline = "2px solid #fecaca";
                    input.addEventListener("input", () => {
                        input.removeAttribute("aria-invalid");
                        input.style.removeProperty("border-color");
                        input.style.removeProperty("outline");
                    }, { once: true });
                    firstInvalid ||= input;
                }
            }
        }
        const price = Number(fields.price?.value || 0);
        const low = Number(fields.price_min?.value || 0);
        const high = Number(fields.price_max?.value || 0);
        if (!(price > 0) && !(low > 0 && high >= low)) {
            missing.push("Harga tunggal atau rentang minimum–maksimum");
            for (const key of ["price", "price_min", "price_max"]) {
                const input = fields[key];
                if (!input) continue;
                input.setAttribute("aria-invalid", "true");
                input.style.borderColor = "#b91c1c";
                input.style.outline = "2px solid #fecaca";
                input.addEventListener("input", () => {
                    input.removeAttribute("aria-invalid");
                    input.style.removeProperty("border-color");
                    input.style.removeProperty("outline");
                }, { once: true });
                firstInvalid ||= input;
            }
        }
        if (missing.length) problems.push(`Listing ${index + 1}: ${missing.join(", ")}`);
    });
    if (problems.length) firstInvalid?.focus();
    return problems;
}
function renderPriceImport(item) {
    const card = document.createElement("article"); card.className = "content-card space-y-3";
    const header = document.createElement("div"); header.className = "flex flex-wrap items-center justify-between gap-2";
    const title = document.createElement("h4"); title.className = "font-serif text-lg font-bold text-coffee-900"; title.textContent = item.filename;
    const meta = document.createElement("span");
    const statusLabel = { pending: "Menunggu pemeriksaan", approved: "Tersimpan · disetujui", ignored: "Tersimpan · diabaikan" }[item.status] || item.status;
    const statusTone = item.status === "approved" ? "bg-green-100 text-green-800" : item.status === "ignored" ? "bg-gray-100 text-gray-700" : "bg-amber-100 text-amber-900";
    meta.className = `inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone}`; meta.textContent = `${statusLabel} · ${new Date(item.created_at).toLocaleString("id-ID")}`;
    const fileLink = document.createElement("a"); fileLink.className = "btn-secondary inline-block"; fileLink.href = `${BLOG_SYNC_API}/admin/price-list-imports/${encodeURIComponent(item.id)}/file`; fileLink.target = "_blank"; fileLink.rel = "noopener noreferrer"; fileLink.textContent = "Lihat berkas asli";
    header.append(title, meta, fileLink); card.append(header);
    const rows = Array.isArray(item.suggestions) ? item.suggestions : [];
    if (rows.length) {
        const help = document.createElement("p"); help.className = "text-xs text-coffee-500"; help.textContent = "Periksa setiap kolom dengan berkas asli. Pilih jenis sumber dengan benar: catatan langsung dari lapangan tidak memerlukan URL; isi nama pihak dan keterangan/bukti lapangannya. Untuk sumber publik, pilih tautan URL HTTPS. Rentang harga tetap rentang; jenis, bentuk, mata uang, dan satuan yang tidak terbaca harus dilengkapi sebelum setuju."; card.append(help);
        rows.forEach((row, index) => {
            const section = document.createElement("section"); section.className = "border border-coffee-100 rounded-xl p-3 space-y-2";
            const label = document.createElement("h5"); label.className = "font-bold text-coffee-800"; label.textContent = `Listing ${index + 1} · keyakinan OCR: ${row.confidence || "low"}`; section.append(label);
            const grid = document.createElement("div"); grid.className = "grid sm:grid-cols-2 lg:grid-cols-4 gap-2";
            const sourceType = priceImportSelect("Jenis sumber", row.source_type || "url", "source_type", [["url", "Tautan publik (URL)"], ["field", "Sumber langsung dari lapangan"]]);
            const sourceName = priceImportField("Nama sumber / pihak lapangan", row.source, "source");
            const sourceUrl = priceImportField("URL HTTPS sumber", row.source_url, "source_url", "url"); sourceUrl.dataset.sourceKind = "url";
            const sourceDetail = priceImportField("Keterangan sumber lapangan", row.source_detail || row.evidence, "source_detail"); sourceDetail.dataset.sourceKind = "field";
            grid.append(
                priceImportField("Nama produk", row.product, "product"), priceImportSelect("Jenis", row.type, "type", [["", "Pilih jenis"], ["Arabika", "Arabika"], ["Robusta", "Robusta"]]),
                priceImportSelect("Bentuk", row.form, "form", [["", "Pilih bentuk"], ["Biji kopi mentah", "Biji hijau / green bean"], ["Biji kopi sangrai", "Biji sangrai / roasted bean"], ["Kopi bubuk", "Kopi bubuk"]]),
                priceImportField("Proses", row.process, "process"), priceImportField("Asal", row.origin, "origin"),
                priceImportField("Harga tunggal", row.price, "price", "number"), priceImportField("Harga minimum", row.price_min, "price_min", "number"), priceImportField("Harga maksimum", row.price_max, "price_max", "number"),
                priceImportSelect("Mata uang", row.currency, "currency", [["", "Pilih mata uang"], ["IDR", "IDR · Rupiah"], ["USD", "USD"]]),
                priceImportField("Jumlah kemasan", row.amount, "amount", "number"), priceImportField("Satuan jumlah", row.unit, "unit"), priceImportField("Tanggal pada sumber", row.source_date, "source_date"),
                sourceType, sourceName, sourceUrl, sourceDetail
            );
            sourceType.querySelector("select").addEventListener("change", () => updatePriceSourceFields(section));
            updatePriceSourceFields(section);
            const evidence = document.createElement("p"); evidence.className = "text-xs text-coffee-500"; evidence.textContent = `Bukti OCR: ${row.evidence || "Tidak ada kutipan bukti yang dikenali."}`;
            section.append(grid, evidence); card.append(section);
        });
    }
    const details = document.createElement("details"); details.className = "text-sm";
    const summary = document.createElement("summary"); summary.className = "cursor-pointer font-semibold"; summary.textContent = "Teks OCR lengkap untuk pemeriksaan";
    const pre = document.createElement("pre"); pre.className = "mt-2 p-3 bg-coffee-50 rounded whitespace-pre-wrap text-xs max-h-96 overflow-auto"; pre.textContent = item.ocr_markdown || "OCR belum menghasilkan teks.";
    details.append(summary, pre); card.append(details);
    if (item.status === "pending") {
        const actions = document.createElement("div"); actions.className = "flex flex-wrap gap-2";
        const approve = document.createElement("button"); approve.type = "button"; approve.className = "btn-primary"; approve.textContent = "Setujui baris terisi"; approve.addEventListener("click", () => savePriceImportDecision(item.id, card, "approved"));
        const ignore = document.createElement("button"); ignore.type = "button"; ignore.className = "btn-secondary"; ignore.textContent = "Abaikan dokumen"; ignore.addEventListener("click", () => savePriceImportDecision(item.id, card, "ignored"));
        actions.append(approve, ignore); card.append(actions);
    }
    return card;
}
async function savePriceImportDecision(id, card, status) {
    if (status === "approved") {
        const problems = validatePriceImportRows(card);
        if (problems.length) {
            const actionStatus = document.getElementById("price-import-action-status");
            actionStatus.dataset.state = "error";
            actionStatus.className = "rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 self-center";
            actionStatus.textContent = `Belum disimpan. Lengkapi kolom yang ditandai: ${problems.join(" · ")}.`;
            return;
        }
    }
    const buttons = [...card.querySelectorAll("button")]; buttons.forEach(button => { button.disabled = true; });
    const actionStatus = document.getElementById("price-import-action-status");
    actionStatus.dataset.state = "pending";
    actionStatus.className = "rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 self-center";
    actionStatus.textContent = status === "approved" ? "Menyimpan persetujuan…" : "Menyimpan keputusan untuk mengabaikan dokumen…";
    const payload = { status };
    if (status === "approved") payload.suggestions = [...card.querySelectorAll("section")].map(section => {
        const row = {}; section.querySelectorAll("[data-price-field]").forEach(input => { const raw = input.value.trim(); row[input.dataset.priceField] = input.type === "number" ? (raw ? Number(raw) : null) : raw; }); return row;
    });
    try {
        const response = await fetch(`${BLOG_SYNC_API}/admin/price-list-imports/${encodeURIComponent(id)}`, { method: "PUT", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Server menolak penyimpanan (HTTP ${response.status}).`);
        if (data.saved !== true) throw new Error("Server belum mengonfirmasi bahwa keputusan tersimpan.");
        actionStatus.dataset.state = "success";
        actionStatus.className = "rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm font-semibold text-green-900 self-center";
        actionStatus.textContent = status === "approved"
            ? "Tersimpan: baris harga disetujui. Data akan masuk ke proses pipeline berikutnya setelah deduplikasi."
            : "Tersimpan: dokumen ditandai untuk diabaikan.";
        await loadPriceListImports();
    } catch (error) {
        actionStatus.dataset.state = "error";
        actionStatus.className = "rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 self-center";
        actionStatus.textContent = error instanceof TypeError
            ? "Belum ada konfirmasi dari server. Muat ulang antrean untuk memastikan status sebelum mencoba lagi."
            : `Gagal menyimpan: ${error.message}`;
        buttons.forEach(button => { button.disabled = false; });
    }
}
async function loadPriceListImports() {
    const list = document.getElementById("price-import-list"); if (!list || !adminSessionActive) return;
    list.replaceChildren(); const loading = document.createElement("div"); loading.className = "content-card"; loading.textContent = "Memuat antrean berkas…"; list.append(loading);
    try {
        const response = await fetchWithTimeout(`${BLOG_SYNC_API}/admin/price-list-imports`, { credentials: "include", cache: "no-store" }, 20000);
        const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Antrean unggahan belum dapat dimuat.");
        list.replaceChildren(); const imports = data.imports || [];
        if (!imports.length) { const empty = document.createElement("div"); empty.className = "content-card text-coffee-500"; empty.textContent = "Belum ada dokumen harga yang diunggah."; list.append(empty); return; }
        imports.forEach(item => list.append(renderPriceImport(item)));
    } catch (error) { list.replaceChildren(); const message = document.createElement("div"); message.className = "content-card text-red-700"; message.textContent = error.message; list.append(message); }
}
document.getElementById("price-import-form")?.addEventListener("submit", async event => {
    event.preventDefault(); const file = document.getElementById("price-import-file").files?.[0]; const status = document.getElementById("price-import-action-status"); const button = document.getElementById("price-import-submit");
    if (!file) { status.textContent = "Pilih PDF atau gambar."; return; }
    button.disabled = true; status.textContent = "Mengunggah dan menjalankan OCR. Berkas tidak akan diterbitkan otomatis…";
    try {
        const form = new FormData(); form.append("file", file);
        const response = await fetch(`${BLOG_SYNC_API}/admin/price-list-imports`, { method: "POST", credentials: "include", cache: "no-store", body: form });
        const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Unggahan/OCR gagal.");
        status.textContent = data.notice || "OCR selesai. Periksa hasil sebelum menyetujui."; event.target.reset(); await loadPriceListImports();
    } catch (error) { status.textContent = `Gagal: ${error.message}`; }
    finally { button.disabled = false; }
});
