'use strict';
// Browser-DOM unit tests. In-memory esbuild output only: no app/dist build and
// no installed-package changes. Browser is optional on hosts without one.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { build } = require('esbuild');
const { pickPreviewKind, textPreviewFormat } = require('../../app/shared/preview-kind');
let browser, page, unavailable;
const requests = [];

before(async () => {
  const executablePath = [process.env.MYAGENT_TEST_BROWSER, chromium.executablePath(),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && fs.existsSync(p));
  if (!executablePath) { unavailable = 'No local Chromium for DOM security units'; return; }
  const compiled = await build({ entryPoints: [path.resolve(__dirname, '../../app/renderer/src/preview-renderer.js')],
    bundle: true, write: false, format: 'iife', globalName: 'PreviewModule', platform: 'browser', logLevel: 'silent' });
  browser = await chromium.launch({ executablePath, headless: true });
  page = await browser.newPage();
  await page.route('**/*', (route) => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<main id="host"></main>');
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  await page.evaluate(() => {
    window.meta = (text) => {
      const bytes = new TextEncoder().encode(text); let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { size: bytes.length, base64: btoa(binary) };
    };
    window.preview = PreviewModule.createPreviewController(document.querySelector('#host'), async () => meta(window.fixture || ''));
  });
});
after(async () => { await browser?.close(); });
function ready(t) { if (unavailable) { t.skip(unavailable); return false; } return true; }

test('T50 preview types preserve text hooks and reject active/legacy formats', () => {
  assert.equal(pickPreviewKind('README.md'), 'text');
  assert.equal(textPreviewFormat('a.HTM'), 'html');
  assert.equal(textPreviewFormat('a.markdown'), 'markdown');
  for (const name of ['a.svg', 'a.doc', 'a.ppt', 'a.exe', 'd.with.dot/noext']) assert.equal(pickPreviewKind(name), 'unsupported');
});

test('T50 HTML sandbox removes activity, network, navigation and dangerous CSS', async (t) => {
  if (!ready(t)) return;
  const result = await page.evaluate(async () => {
    window.fixture = `<style>p{color:rgb(1,2,3)}@import 'https://invalid.test/css';div{background:url(https://invalid.test/css-image)}</style>
      <script>parent.__pwned=1</script><meta http-equiv="refresh" content="0;url=https://invalid.test/nav"><base href="https://invalid.test/">
      <p style="color:red;background-image:url(https://invalid.test/x)">safe</p><img src="https://invalid.test/image" onerror="parent.__pwned=2">
      <img src="data:image/svg+xml;base64,PHN2Zy8+"><svg onload="parent.__pwned=3"></svg>
      <a href="https://invalid.test/nav" ping="https://invalid.test/ping" target="_top" download>go</a>
      <iframe src="https://invalid.test/frame"></iframe><form action="https://invalid.test/post"><button>send</button></form>
      <img alt="local" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==">`;
    const state = await preview.load('unsafe.html');
    const frame = document.querySelector('#host iframe');
    return { state, sandbox: frame.getAttribute('sandbox'), html: frame.srcdoc, pwned: window.__pwned };
  });
  assert.equal(result.state.ok, true);
  assert.equal(result.sandbox, '');
  assert.match(result.html, /default-src 'none'/);
  assert.match(result.html, /script-src 'none'/);
  assert.match(result.html, /color:red/);
  assert.match(result.html, /data:image\/png/);
  assert.doesNotMatch(result.html, /https:\/\/invalid|<script|<form|<svg|<iframe|onerror|href=|download|image\/svg/);
  assert.equal(result.pwned, undefined);
  await page.waitForTimeout(50);
  assert.deepEqual(requests, []);
});

test('T50 Markdown rich rendering and source mode are both safe', async (t) => {
  if (!ready(t)) return;
  const result = await page.evaluate(async () => {
    window.fixture = '# Heading\n**bold**\n[x](javascript:alert(1))\n![remote](https://invalid.test/image)\n<script>alert(1)</script>';
    const rendered = await preview.load('README.md');
    const html = document.querySelector('#host iframe').srcdoc;
    const source = await preview.load('README.md', { source: true });
    return { rendered, source, html, text: document.querySelector('#host').textContent, frames: document.querySelectorAll('#host iframe').length };
  });
  assert.equal(result.rendered.ok, true);
  assert.match(result.html, /<h1>Heading<\/h1>/);
  assert.match(result.html, /<strong>bold<\/strong>/);
  assert.doesNotMatch(result.html, /javascript:|https:\/\/invalid|<script/);
  assert.equal(result.source.ok, true);
  assert.match(result.text, /# Heading/);
  assert.match(result.text, /<script>/);
  assert.equal(result.frames, 0);
  assert.deepEqual(requests, []);
});

test('T50 limits and unsupported/invalid responses fail truthfully', async (t) => {
  if (!ready(t)) return;
  const result = await page.evaluate(async () => {
    window.fixture = 'x'.repeat(200001);
    const truncated = await preview.load('large.txt', { source: true });
    const length = document.querySelector('#host pre').textContent.length;
    const unsupported = await preview.load('unsafe.svg');
    const bad = PreviewModule.createPreviewController(document.querySelector('#host'), async () => ({ size: 26 * 1024 * 1024, base64: '' }));
    const oversized = await bad.load('huge.pdf'); bad.destroy();
    const mismatch = PreviewModule.createPreviewController(document.querySelector('#host'), async () => ({ size: 10, base64: 'YQ==' }));
    const invalid = await mismatch.load('broken.txt'); mismatch.destroy();
    return { truncated, length, unsupported, oversized, invalid };
  });
  assert.equal(result.length, 200000);
  assert.match(result.truncated.warning, /200000/);
  assert.equal(result.unsupported.ok, false);
  assert.equal(result.oversized.ok, false);
  assert.match(result.oversized.warning, /25 MiB/);
  assert.equal(result.invalid.ok, false);
});

test('T50 OOXML DOCX sanitizes before library rendering and preserves paragraph styling', async (t) => {
  if (!ready(t)) return;
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Safe document</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://invalid.test/docx" TargetMode="External"/></Relationships>');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const result = await page.evaluate(async (base64) => {
    const controller = PreviewModule.createPreviewController(document.querySelector('#host'), async () => ({ size: atob(base64).length, base64 }));
    const state = await controller.load('sample.docx');
    const html = document.querySelector('#host iframe')?.srcdoc;
    controller.destroy(); return { state, html };
  }, bytes.toString('base64'));
  assert.equal(result.state.ok, true, result.state.error);
  assert.match(result.state.warning, /外部资源/);
  assert.match(result.html, /Safe document/);
  assert.match(result.html, /font-weight/);
  assert.doesNotMatch(result.html, /https:\/\/invalid/);
  assert.deepEqual(requests, []);
});

test('T50 valid two-slide PPTX retains positioned text and raster images', async (t) => {
  if (!ready(t)) return;
  const JSZip = require('jszip');
  const zip = new JSZip();
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = (entries) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([Id, Type, Target]) => `<Relationship Id="${Id}" Type="${r}/${Type}" Target="${Target}"/>`).join('')}</Relationships>`;
  const tree = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>${[1, 2].map((i) => `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`);
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldSz cx="9144000" cy="5143500"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:defaultTextStyle/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', rels([['rId1', 'slide', 'slides/slide1.xml'], ['rId2', 'slide', 'slides/slide2.xml']]));
  zip.file('ppt/theme/theme1.xml', `<a:theme xmlns:a="${a}" name="Safe"><a:themeElements><a:clrScheme name="Safe"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1></a:clrScheme><a:fontScheme name="Safe"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Safe"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`);
  zip.file('ppt/slideMasters/slideMaster1.xml', `<p:sldMaster xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${tree}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'theme', '../theme/theme1.xml']]));
  zip.file('ppt/slideLayouts/slideLayout1.xml', `<p:sldLayout xmlns:p="${p}" xmlns:a="${a}" type="blank"><p:cSld><p:spTree>${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
  zip.file('ppt/media/image1.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==', 'base64'));
  for (const i of [1, 2]) {
    zip.file(`ppt/slides/slide${i}.xml`, `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree>${tree}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Safe text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:rPr><a:t>Slide ${i} &lt;img src=x onerror=alert(1)&gt;</a:t></a:r><a:endParaRPr/></a:p></p:txBody></p:sp><p:pic><p:nvPicPr><p:cNvPr id="3" name="Local picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="1828800" y="2743200"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    zip.file(`ppt/slides/_rels/slide${i}.xml.rels`, rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'image', '../media/image1.png']]));
  }
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const result = await page.evaluate(async (base64) => {
    const controller = PreviewModule.createPreviewController(document.querySelector('#host'), async () => ({ size: atob(base64).length, base64 }));
    const state = await controller.load('sample.pptx');
    const html = document.querySelector('#host iframe')?.srcdoc || '';
    const template = document.createElement('template'); template.innerHTML = html;
    const images = [...template.content.querySelectorAll('img')].map((img) => ({ src: img.getAttribute('src'), parent: img.parentElement.getAttribute('style') }));
    controller.destroy(); return { state, html, images };
  }, bytes.toString('base64'));
  assert.equal(result.state.ok, true, result.state.error);
  assert.match(result.html, /Slide 1/); assert.match(result.html, /Slide 2/);
  assert.match(result.html, /position:absolute/);
  // The library uses 72px/inch coordinates under a 4/3 viewport scale.
  assert.match(result.html, /left:72px;top:72px/);
  assert.match(result.html, /transform:scale\(1\.33333\)/);
  assert.match(result.html, /left:144px;top:216px/);
  assert.equal(result.images.length, 2);
  for (const image of result.images) assert.match(image.src, /^data:image\/png;base64,/);
  assert.doesNotMatch(result.html, /<img src="x"|onerror="|https:\/\/invalid/);
  assert.deepEqual(requests, []);
});

test('T50 sheets cap rows/columns/count and remove generated external links', async (t) => {
  if (!ready(t)) return;
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  for (let i = 0; i < 13; i++) {
    const sheet = { A1: { t: 's', v: 'SAFE', l: { Target: 'https://invalid.test/sheet' } }, CW2001: { t: 's', v: 'OUTSIDE' }, '!ref': 'A1:CW2001' };
    XLSX.utils.book_append_sheet(wb, sheet, `Sheet${i}`);
  }
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const result = await page.evaluate(async (base64) => {
    const controller = PreviewModule.createPreviewController(document.querySelector('#host'), async () => ({ size: atob(base64).length, base64 }));
    const state = await controller.load('sample.xlsx');
    const html = document.querySelector('#host iframe')?.srcdoc;
    controller.destroy(); return { state, html };
  }, bytes.toString('base64'));
  assert.equal(result.state.ok, true, result.state.error);
  assert.match(result.state.warning, /12/);
  assert.match(result.state.warning, /2000/);
  assert.match(result.state.warning, /100/);
  assert.match(result.html, /SAFE/);
  assert.doesNotMatch(result.html, /OUTSIDE|href=|invalid.test/);
  assert.deepEqual(requests, []);
});

test('T50 PDF raster pages render and canvases release on replacement', async (t) => {
  if (!ready(t)) return;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream'];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((value, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const result = await page.evaluate(async (base64) => {
    const controller = PreviewModule.createPreviewController(document.querySelector('#host'), async (method, { path }) => path.endsWith('.pdf') ? { size: atob(base64).length, base64 } : meta('next'));
    const state = await controller.load('sample.pdf');
    const canvas = document.querySelector('#host canvas');
    const width = canvas?.width;
    await controller.load('next.txt');
    const released = canvas?.width;
    controller.destroy(); return { state, width, released };
  }, Buffer.from(pdf).toString('base64'));
  assert.equal(result.state.ok, true, result.state.error);
  assert.ok(result.width > 0);
  assert.equal(result.released, 0);
  assert.deepEqual(requests, []);
});

test('T50 new loads clear old display and stale success/error cannot win', async (t) => {
  if (!ready(t)) return;
  const result = await page.evaluate(async () => {
    const host = document.querySelector('#host');
    const waiting = {};
    const controller = PreviewModule.createPreviewController(host, (method, { path }) => new Promise((resolve, reject) => { waiting[path] = { resolve, reject }; }));
    const old = controller.load('old.txt');
    const newer = controller.load('new.txt');
    waiting['new.txt'].resolve(meta('NEW'));
    await newer;
    waiting['old.txt'].resolve(meta('OLD'));
    const stale = await old;
    const afterStale = host.textContent;
    const failure = controller.load('bad.txt');
    const duringLoad = host.textContent;
    const current = controller.load('current.txt');
    waiting['current.txt'].resolve(meta('CURRENT')); await current;
    waiting['bad.txt'].reject(new Error('OLD FAILURE')); await failure;
    const afterFailure = host.textContent;
    controller.destroy();
    return { stale, afterStale, duringLoad, afterFailure };
  });
  assert.equal(result.stale.ok, false);
  assert.equal(result.afterStale, 'NEW');
  assert.doesNotMatch(result.duringLoad, /NEW/);
  assert.equal(result.afterFailure, 'CURRENT');
});

test('T50 destroy is terminal, cancels pending work and releases image Object URLs', async (t) => {
  if (!ready(t)) return;
  const result = await page.evaluate(async () => {
    const host = document.querySelector('#host');
    const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
    let created = 0, revoked = 0, calls = 0;
    URL.createObjectURL = (...args) => { created++; return oldCreate.apply(URL, args); };
    URL.revokeObjectURL = (...args) => { revoked++; return oldRevoke.apply(URL, args); };
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==';
    const controller = PreviewModule.createPreviewController(host, async () => { calls++; return { size: atob(png).length, base64: png }; });
    const image = await controller.load('one.png');
    controller.destroy(); controller.destroy();
    const terminal = await controller.load('two.png');
    let finish;
    const pending = PreviewModule.createPreviewController(host, () => new Promise((r) => { finish = r; }));
    const load = pending.load('late.txt'); pending.destroy(); finish(meta('LATE'));
    const stale = await load;
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
    return { image, terminal, stale, calls, created, revoked, text: host.textContent };
  });
  assert.equal(result.image.ok, true);
  assert.equal(result.terminal.ok, false);
  assert.equal(result.stale.ok, false);
  assert.equal(result.calls, 1);
  assert.equal(result.created, 1);
  assert.equal(result.revoked, 1);
  assert.equal(result.text, '');
});
