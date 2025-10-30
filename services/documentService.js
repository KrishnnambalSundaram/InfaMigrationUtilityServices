const { marked } = require('marked');
const htmlToDocx = require('html-to-docx');

function wrapHtml(title, bodyHtml) {
  const safeTitle = title || 'IDMC Summary';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; color: #1a1a1a; line-height: 1.5; }
    h1, h2, h3, h4 { color: #0d47a1; margin-top: 1.2em; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; }
    th { background: #f5f5f5; font-weight: bold; }
    code { background: #f6f8fa; padding: 2px 4px; border-radius: 4px; font-family: Menlo, Monaco, Consolas, monospace; }
    pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow: auto; }
    ul, ol { margin: 0 0 0 22px; }
  </style>
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>`;
}

function markdownToHtml(markdown) {
  const htmlBody = marked.parse(markdown || '');
  return wrapHtml('IDMC Mapping Summary', htmlBody);
}

async function markdownToDocxBuffer(markdown, title) {
  const html = markdownToHtml(markdown);
  const buffer = await htmlToDocx(html, null, {
    table: { row: { cantSplit: true } },
    footer: true,
    pageNumber: true,
  });
  return buffer;
}

module.exports = {
  markdownToHtml,
  markdownToDocxBuffer
};


