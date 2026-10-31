#!/usr/bin/env node
/**
 * Renders the InstaFlow AI documentation set into one printable HTML file that
 * Chrome's headless --print-to-pdf turns into INSTAFlow_AI_Project_Handover_Manual.pdf.
 *
 * Why a script instead of hand-written HTML: the PDF must mirror the Markdown
 * docs, so a single source (the .md files) has to be the truth. Re-run this after
 * editing any doc; the PDF then cannot drift from the Markdown.
 *
 * Markdown support is deliberately small — headings, tables, fenced code, lists,
 * blockquotes, rules and inline bold/italic/code/links — because those are the
 * only constructs the docs use, and a full markdown dependency is not worth the
 * supply-chain cost for a documentation build.
 *
 * Usage:
 *   node scripts/build-handover-manual.mjs            # writes the HTML next to the project root
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const OUT_HTML = path.join(root, 'INSTAFlow_AI_Project_Handover_Manual.html');

// Order = the order the manual is read in.
const SOURCES = [
  { file: 'README.md', title: 'Product Overview' },
  { file: 'docs/ARCHITECTURE.md', title: 'System Architecture' },
  { file: 'docs/AI_SYSTEM.md', title: 'AI System' },
  { file: 'docs/META_INSTAGRAM.md', title: 'Meta / Instagram Integration' },
  { file: 'docs/DATABASE.md', title: 'Data & Storage' },
  { file: 'docs/API.md', title: 'API Reference' },
  { file: 'docs/SECURITY.md', title: 'Security' },
  { file: 'docs/ENVIRONMENT.md', title: 'Environment Variables' },
  { file: 'docs/DEPLOYMENT.md', title: 'Deployment' },
  { file: 'docs/PROJECT_STRUCTURE.md', title: 'Project Structure' },
  { file: 'docs/TESTING.md', title: 'Testing' },
  { file: 'docs/KNOWN_ISSUES.md', title: 'Known Issues' },
  { file: 'docs/HANDOVER.md', title: 'Developer Handover' },
  { file: 'docs/AI_CODING_AGENT_PROMPT.md', title: 'AI Coding Agent Handover Prompt' },
  { file: 'CHANGELOG.md', title: 'Changelog' },
  { file: 'docs/DOCUMENTATION_AUDIT.md', title: 'Documentation Audit' },
];

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const slugify = (s) =>
  'h-' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Inline: `code`, **bold**, *italic*, [label](url) → label (URLs are dead in print). */
function inline(text) {
  const parts = String(text).split(/(`[^`]+`)/g);
  return parts
    .map((chunk) => {
      if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 2) {
        return `<code>${esc(chunk.slice(1, -1))}</code>`;
      }
      let out = esc(chunk);
      out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
      out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      return out;
    })
    .join('');
}

function render(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  const toc = [];

  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSepRow = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^\s*```/.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      html.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html.push('<hr>');
      i += 1;
      continue;
    }

    // headings
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = slugify(text);
      if (level === 2) toc.push({ level: 2, text, id });
      html.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i += 1;
      continue;
    }

    // table
    if (isTableRow(line) && i + 1 < lines.length && isSepRow(lines[i + 1])) {
      const header = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        i += 1;
      }
      html.push('<table><thead><tr>' + header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
      for (const r of rows) {
        html.push('<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
      }
      html.push('</tbody></table>');
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      html.push(`<blockquote>${buf.map((b) => inline(b)).join('<br>')}</blockquote>`);
      continue;
    }

    // list (unordered / ordered), supports one level of nesting by indent
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        const indent = /^\s{2,}/.test(lines[i]);
        items.push({ raw, indent });
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      let body = '';
      let nested = false;
      for (const it of items) {
        if (it.indent && !nested) {
          body += `<ul class="tight">`;
          nested = true;
        } else if (!it.indent && nested) {
          body += `</ul>`;
          nested = false;
        }
        body += `<li>${inline(it.raw)}</li>`;
      }
      if (nested) body += `</ul>`;
      html.push(`<${tag}>${body}</${tag}>`);
      continue;
    }

    // blank
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // paragraph (join continuation lines)
    const para = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !isTableRow(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*(-{3,})\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    html.push(`<p>${inline(para.join(' '))}</p>`);
  }

  return { html: html.join('\n'), toc };
}

const sections = [];
const tocAll = [];

for (const src of SOURCES) {
  const full = path.join(root, src.file);
  const md = fs.readFileSync(full, 'utf8');
  const { html, toc } = render(md);
  // Drop the doc's own first H1 (every doc repeats its title) and use our own.
  const withoutH1 = html.replace(/^<h1[^>]*>.*?<\/h1>\n?/, '');
  sections.push(
    `<section class="doc">\n<h1 class="doc-title">${esc(src.title)}</h1>\n` +
      `<p class="doc-src">Source: ${esc(src.file)}</p>\n${withoutH1}\n</section>`
  );
  tocAll.push({ title: src.title, items: toc });
}

const tocHtml = tocAll
  .map(
    (d, idx) =>
      `<li class="toc-doc"><span class="toc-num">${idx + 1}</span> ${esc(d.title)}` +
      (d.items.length
        ? `<ul class="toc-sub">${d.items.map((it) => `<li>${esc(it.text)}</li>`).join('')}</ul>`
        : '') +
      '</li>'
  )
  .join('\n');

const generatedOn = new Date().toISOString().slice(0, 10);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>InstaFlow AI — Project Handover Manual</title>
<style>
  @page { size: A4; margin: 18mm 15mm 18mm 15mm; }
  :root { --ink:#0f172a; --muted:#64748b; --accent:#6d28d9; --line:#e2e8f0; --bg:#f8fafc; }
  * { box-sizing: border-box; }
  body { margin:0; color:var(--ink); background:#fff;
         font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         font-size: 10.5pt; line-height: 1.55; }
  h1,h2,h3,h4 { line-height:1.25; color:#0b1220; page-break-after: avoid; }
  h1 { font-size: 19pt; margin: 0 0 2mm; }
  h2 { font-size: 14pt; margin: 8mm 0 2mm; padding-bottom: 1.2mm; border-bottom: 1.5px solid var(--line); color:var(--accent); }
  h3 { font-size: 11.5pt; margin: 5mm 0 1.5mm; }
  h4 { font-size: 10.5pt; margin: 4mm 0 1mm; color:#334155; }
  p { margin: 0 0 2.4mm; }
  ul, ol { margin: 0 0 2.6mm; padding-left: 6mm; }
  li { margin: 0.6mm 0; }
  ul.tight { margin: 0.6mm 0 0.6mm 3mm; }
  code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
         font-size: 8.8pt; background: var(--bg); border: 1px solid var(--line);
         border-radius: 3px; padding: 0.3mm 1mm; }
  pre { background: #0b1220; color:#e6edf3; border-radius: 4px; padding: 3mm 3.5mm;
        overflow-x: auto; page-break-inside: avoid; }
  pre code { background: none; border: none; color: inherit; padding: 0; font-size: 8.4pt; line-height:1.4; }
  table { width:100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 9.3pt;
          page-break-inside: auto; }
  th, td { border: 1px solid var(--line); padding: 1.3mm 2mm; text-align: left; vertical-align: top; }
  th { background: var(--bg); font-weight: 600; }
  tr { page-break-inside: avoid; }
  blockquote { margin: 2.5mm 0; padding: 2mm 3mm; background:#fffbeb; border-left: 3px solid #f59e0b;
               border-radius: 0 4px 4px 0; }
  hr { border: none; border-top: 1px solid var(--line); margin: 5mm 0; }
  .doc { page-break-before: always; }
  .doc-title { border-bottom: 3px solid var(--accent); padding-bottom: 2mm; }
  .doc-src { color: var(--muted); font-size: 8.6pt; margin: 1mm 0 4mm; }

  /* cover */
  .cover { page-break-after: always; padding-top: 26mm; }
  .cover .brand { font-size: 11pt; letter-spacing:.22em; text-transform: uppercase;
                  color: var(--accent); font-weight: 700; }
  .cover .name { font-size: 11pt; letter-spacing:.16em; text-transform:uppercase;
                 color: var(--muted); margin-top:1mm; }
  .cover h1.big { font-size: 30pt; margin: 12mm 0 3mm; letter-spacing:-0.5px; }
  .cover .sub { font-size: 13pt; color:#334155; }
  .cover .meta { margin-top: 22mm; border-top:1px solid var(--line); padding-top:4mm;
                 color: var(--muted); font-size: 10pt; }
  .cover .meta b { color: var(--ink); }
  .notice { margin-top: 10mm; background: #fff7ed; border:1px solid #fed7aa;
            border-radius: 6px; padding: 3mm 4mm; font-size: 9.6pt; }
  .notice b { color:#9a3412; }

  /* toc */
  .toc { page-break-after: always; }
  .toc h2 { border-bottom: 3px solid var(--accent); }
  .toc ol { list-style: none; padding-left: 0; counter-reset: none; }
  .toc-doc { font-weight: 600; margin: 1.6mm 0; }
  .toc-num { display:inline-block; width: 7mm; color: var(--accent); }
  .toc-sub { font-weight: 400; color: var(--muted); font-size: 9pt; padding-left: 7mm;
             margin: 0.6mm 0 1.6mm; list-style:none; }
</style>
</head>
<body>

<div class="cover">
  <div class="brand">Future Growth and Technology</div>
  <div class="name">InstaFlow AI SaaS</div>
  <h1 class="big">InstaFlow AI</h1>
  <div class="sub">Project Handover Manual — architecture, integration, operations and developer guide</div>
  <div class="meta">
    <p><b>Product:</b> InstaFlow AI — multi-tenant Instagram AI automation SaaS<br>
       <b>Domain:</b> https://www.thefgt.in<br>
       <b>Generated:</b> ${generatedOn}</p>
    <p><b>AI provider:</b> OpenRouter (primary) + Google Gemini (fallback) — <em>not DeepSeek</em><br>
       <b>Persistence:</b> JSON stores on a mounted volume (no SQL database)<br>
       <b>Hosting:</b> Railway</p>
  </div>
  <div class="notice">
    <b>No credentials in this document.</b> Every key, token, secret and password is
    represented as a placeholder such as <code>[REDACTED]</code> or
    <code>YOUR_API_KEY</code>. The manual describes the project as it exists in the
    source code; anything that could not be verified is marked
    <b>NEEDS VERIFICATION</b>.
  </div>
</div>

<div class="toc">
  <h2>Table of Contents</h2>
  <ol>${tocHtml}</ol>
</div>

${sections.join('\n')}

</body>
</html>`;

fs.writeFileSync(OUT_HTML, page, 'utf8');
console.log(`Wrote ${OUT_HTML} (${page.length} bytes, ${SOURCES.length} sections)`);
