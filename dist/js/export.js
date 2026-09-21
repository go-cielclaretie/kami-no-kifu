/* Binary PDF/JPEG/PNG/ZIP export. No external PDF/ZIP CDN is required.
 * PDFs contain high-resolution JPEG pages (not editable vector text).
 */
(function (root) {
  'use strict';
  const encoder = new TextEncoder();
  const bytes = s => encoder.encode(s);
  const join = arrays => {
    const len = arrays.reduce((a, b) => a + b.length, 0), result = new Uint8Array(len);
    let offset = 0; for (const a of arrays) { result.set(a, offset); offset += a.length; }
    return result;
  };
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
    return t;
  })();
  function crc32(data) { let c = 0xffffffff; for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function safeName(name) {
    const s = String(name || 'kifu').normalize('NFC').replace(/\.sgf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[ .]+$/g, '').slice(0, 140);
    return s || 'kifu';
  }
  function pngDensity(data, dpi) {
    if (data[0] !== 137 || String.fromCharCode(...data.slice(1, 4)) !== 'PNG') throw new Error('PNGの生成に失敗しました。');
    const ppm = Math.round(dpi / .0254), payload = new Uint8Array(9), pv = new DataView(payload.buffer);
    pv.setUint32(0, ppm); pv.setUint32(4, ppm); payload[8] = 1;
    const kind = bytes('pHYs'), content = join([kind, payload]), chunk = new Uint8Array(21), cv = new DataView(chunk.buffer);
    cv.setUint32(0, 9); chunk.set(content, 4); cv.setUint32(17, crc32(content));
    const parts = [data.slice(0, 8)]; let p = 8, added = false;
    while (p + 12 <= data.length) {
      const n = new DataView(data.buffer, data.byteOffset + p, 4).getUint32(0), end = p + n + 12;
      if (end > data.length) throw new Error('PNGチャンクが破損しています。');
      const type = String.fromCharCode(...data.slice(p + 4, p + 8));
      if (type !== 'pHYs') parts.push(data.slice(p, end));
      if (type === 'IHDR' && !added) { parts.push(chunk); added = true; }
      p = end;
    }
    return join(parts);
  }
  function jpegDensity(data, dpi) {
    if (data[0] !== 255 || data[1] !== 216) throw new Error('JPEGの生成に失敗しました。');
    const out = data.slice(); let p = 2;
    while (p + 4 <= out.length && out[p] === 255) {
      const marker = out[p + 1]; if (marker === 0xda || marker === 0xd9) break;
      const len = (out[p + 2] << 8) | out[p + 3];
      if (len < 2 || p + len + 2 > out.length) break;
      if (marker === 0xe0 && len >= 16 && String.fromCharCode(...out.slice(p + 4, p + 9)) === 'JFIF\0') {
        out[p + 11] = 1; out[p + 12] = dpi >> 8; out[p + 13] = dpi & 255; out[p + 14] = dpi >> 8; out[p + 15] = dpi & 255;
        return out;
      }
      p += len + 2;
    }
    const app = new Uint8Array([255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 2, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0]);
    return join([out.slice(0, 2), app, out.slice(2)]);
  }
  function canvasBlob(canvas, mime, quality = .98) {
    return new Promise((resolve, reject) => {
      try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像を生成できません。解像度を下げてください。')), mime, quality); }
      catch (e) { reject(new Error(`画像出力に失敗しました：${e.message}`)); }
    });
  }
  async function imageData(canvas, format, dpi) {
    const blob = await canvasBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg');
    const data = new Uint8Array(await blob.arrayBuffer());
    return format === 'png' ? pngDensity(data, dpi) : jpegDensity(data, dpi);
  }
  function zip(files) {
    const local = [], central = []; let offset = 0;
    if (files.length > 65535) throw new Error('ZIPファイル数の上限を超えています。');
    const now = new Date(), time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const file of files) {
      const name = bytes(file.name), data = file.data, crc = crc32(data);
      if (data.length > 0xffffffff || offset > 0xffffffff) throw new Error('ZIP64が必要な大きさのため出力できません。');
      const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true); lv.setUint16(10, time, true); lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lh.set(name, 30);
      local.push(lh, data);
      const ch = new Uint8Array(46 + name.length), v = new DataView(ch.buffer);
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true);
      v.setUint16(12, time, true); v.setUint16(14, date, true); v.setUint32(16, crc, true); v.setUint32(20, data.length, true); v.setUint32(24, data.length, true);
      v.setUint16(28, name.length, true); v.setUint32(42, offset, true); ch.set(name, 46); central.push(ch);
      offset += lh.length + data.length;
    }
    const size = central.reduce((a, b) => a + b.length, 0), end = new Uint8Array(22), v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true); v.setUint16(8, files.length, true); v.setUint16(10, files.length, true);
    v.setUint32(12, size, true); v.setUint32(16, offset, true);
    return new Blob([...local, ...central, end], { type: 'application/zip' });
  }
  function pdfTitle(s) {
    let out = 'FEFF'; for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(4, '0'); return `<${out}>`;
  }
  class PdfWriter {
    constructor(pages, title) {
      this.parts = []; this.offset = 0; this.offsets = [0]; this.pages = pages;
      this.push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10]));
      this.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
      this.object(2, `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 3} 0 R`).join(' ')}] >>`);
      this.object(3, `<< /Title ${pdfTitle(title)} /Producer (Kifu Print Web 2.0.0) >>`);
    }
    push(data) { const d = typeof data === 'string' ? bytes(data) : data; this.parts.push(d); this.offset += d.length; }
    object(id, text) { this.offsets[id] = this.offset; this.push(`${id} 0 obj\n${text}\nendobj\n`); }
    stream(id, dict, data) { this.offsets[id] = this.offset; this.push(`${id} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`); this.push(data); this.push('\nendstream\nendobj\n'); }
    addPage(index, page, canvas, jpeg) {
      const id = 4 + index * 3, w = (page.W * 72 / 25.4).toFixed(5), h = (page.H * 72 / 25.4).toFixed(5);
      this.object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /PageImage ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
      this.stream(id + 1, `/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, jpeg);
      this.stream(id + 2, '', bytes(`q\n${w} 0 0 ${h} 0 0 cm\n/PageImage Do\nQ`));
    }
    finish() {
      const xref = this.offset, count = 4 + this.pages * 3;
      this.push(`xref\n0 ${count}\n0000000000 65535 f \n`);
      for (let i = 1; i < count; i++) this.push(`${String(this.offsets[i]).padStart(10, '0')} 00000 n \n`);
      this.push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
      return new Blob(this.parts, { type: 'application/pdf' });
    }
  }
  async function generate(plans, settings, filename, onProgress = () => {}, signal) {
    if (settings.grain === 'itame' && !(await root.KifuRender.ready())) throw new Error('板目の画像素材を読み込めません。');
    const errors = root.KifuCore.validateSettings(settings); if (errors.length) throw new Error(errors[0]);
    const name = safeName(filename), files = [], canvas = document.createElement('canvas');
    const format = settings.format, writer = format === 'pdf' ? new PdfWriter(plans.length, name) : null;
    let accumulated = 0;
    try {
      for (let i = 0; i < plans.length; i++) {
        if (signal && signal.aborted) throw new DOMException('出力を中止しました。', 'AbortError');
        onProgress(i, plans.length, `${i + 1} / ${plans.length}ページを生成中`);
        await new Promise(resolve => setTimeout(resolve, 0));
        root.KifuRender.draw(canvas, plans[i], settings, Number(settings.dpi));
        const data = await imageData(canvas, format === 'pdf' ? 'jpg' : format, Number(settings.dpi));
        accumulated += data.length;
        if (accumulated > 400 * 1024 * 1024) throw new Error('出力が400 MiBを超えました。解像度を下げるか、手数分割を減らしてください。');
        if (writer) writer.addPage(i, plans[i], canvas, data);
        else files.push({ name: `${name}${plans.length > 1 ? '_p' + String(i + 1).padStart(3, '0') : ''}.${format}`, data });
      }
      if (signal && signal.aborted) throw new DOMException('出力を中止しました。', 'AbortError');
      onProgress(plans.length, plans.length, 'ファイルをまとめています');
      if (writer) return { blob: writer.finish(), name: `${name}.pdf` };
      if (files.length === 1) return { blob: new Blob([files[0].data], { type: format === 'png' ? 'image/png' : 'image/jpeg' }), name: files[0].name };
      return { blob: zip(files), name: `${name}_${format}.zip` };
    } finally { canvas.width = 1; canvas.height = 1; }
  }
  const urls = new Set();
  function save(blob, name) {
    const url = URL.createObjectURL(blob); urls.add(url);
    const a = document.createElement('a'); a.href = url; a.download = name; a.target = '_self';
    a.style.display = 'none'; document.body.append(a); a.click(); a.remove();
    // Keep an explicit download link alive for browsers which block the automatic click.
    return { url, revoke: () => { URL.revokeObjectURL(url); urls.delete(url); } };
  }
  root.addEventListener('pagehide', () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); });
  root.KifuExport = { crc32, pngDensity, jpegDensity, zip, PdfWriter, generate, safeName, save };
})(globalThis);
