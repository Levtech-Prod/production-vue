Roboto, subset to Latin / Latin-1 Supplement / Latin Extended-A / Latin
Extended-B plus general punctuation and currency symbols (built with
fonttools' pyftsubset).

Loaded at runtime by frontend/src/views/products/detail/bom/bomPdf.ts for the
BOM PDF export: jsPDF's built-in fonts are cp1252-only and cannot render
Hungarian ő / ű or Romanian ș / ț.

Roboto is Copyright the Roboto Project Authors, licensed under the
Apache License 2.0: http://www.apache.org/licenses/LICENSE-2.0
