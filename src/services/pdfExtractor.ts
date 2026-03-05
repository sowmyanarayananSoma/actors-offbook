/**
 * pdfExtractor.ts
 *
 * Extracts plain text from a PDF file entirely on-device using pdfjs-dist.
 * No network, no WebView, no native modules.
 *
 * Flow:
 *   1. Read the PDF file as base64 via expo-file-system.
 *   2. Decode base64 → Uint8Array.
 *   3. Feed to pdfjsLib.getDocument() with the web worker disabled.
 *   4. For each page, call getTextContent() and reconstruct reading-order
 *      lines by grouping text items that share the same y-coordinate.
 *   5. Return all pages joined with double newlines.
 *
 * Limitations:
 *   - Scanned (image-only) PDFs have no text layer and return near-empty text.
 *   - Two-column layouts may produce interleaved lines.
 *
 * Metro bundler requirements (see metro.config.js):
 *   - unstable_enablePackageExports: true  — resolves pdfjs subpath exports
 *   - canvas stubbed to emptyModule.js     — pdfjs optionally requires canvas
 */

import * as FileSystem from 'expo-file-system/legacy';
// pdfjs-dist v3 ships a CJS build (build/pdf.js) that works in React Native.
// v4+ switched to ESM-only and crashes Hermes at module init.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjsLib = require('pdfjs-dist/build/pdf');

// Disable the web worker — Worker is not available in React Native.
// pdfjs runs synchronously on the JS thread when workerSrc is empty.
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PdfTextItem {
  str: string;
  transform: number[]; // [scaleX, skewX, skewY, scaleY, translateX, translateY]
  hasEOL?: boolean;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads a PDF from the given Expo file URI and returns its full text content
 * as a plain string. Pages are separated by double newlines so the script
 * parser can detect scene breaks that fall across page boundaries.
 *
 * @throws Error with message starting "SCANNED_PDF" if no text is found.
 * @throws Error with message starting "PDF_ERROR" for other extraction failures.
 */
export async function extractTextFromPdf(uri: string): Promise<string> {
  try {
    // 1. Read PDF binary as base64 — the only reliable binary encoding in
    //    expo-file-system across iOS and Android.
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // 2. Decode base64 → binary string → Uint8Array.
    //    atob() is available globally in React Native's Hermes engine.
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // 3. Load the PDF document from the raw byte buffer.
    //    Passing { data: bytes } avoids any URL/fetch resolution.
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const doc = await loadingTask.promise;

    // 4. Extract text page by page.
    const pageTexts: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();

      // Filter out TextMarkedContent items (they have no 'str' field).
      const textItems = content.items.filter(
        (item: unknown): item is PdfTextItem =>
          typeof item === 'object' && item !== null && 'str' in item
      );

      pageTexts.push(reconstructLines(textItems));
    }

    const fullText = pageTexts.join('\n\n');

    // 5. Detect scanned PDFs: very little text means no text layer.
    if (fullText.trim().length < 50) {
      throw new Error('SCANNED_PDF');
    }

    return fullText;
  } catch (err) {
    if (err instanceof Error && err.message === 'SCANNED_PDF') throw err;
    throw new Error(`PDF_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Line reconstruction ──────────────────────────────────────────────────────

/**
 * Tolerance in PDF user units for grouping text items onto the same visual line.
 * PDF coordinates use a bottom-left origin. 2 units handles slight baseline
 * wobble from different PDF generators without merging adjacent lines.
 */
const Y_TOLERANCE = 2;

/**
 * Groups pdfjs text items into lines by y-coordinate, sorts each line
 * left-to-right by x-coordinate, and joins item strings with space insertion
 * where the gap between items indicates a word boundary.
 */
function reconstructLines(items: PdfTextItem[]): string {
  if (items.length === 0) return '';

  // Group items by snapped y-coordinate (bottom-up in PDF space).
  const lineMap = new Map<number, { y: number; items: PdfTextItem[] }>();

  for (const item of items) {
    if (!item.str) continue;
    const rawY = item.transform[5]; // y component of the text matrix
    const key = snapToGrid(rawY, Y_TOLERANCE);

    if (!lineMap.has(key)) {
      lineMap.set(key, { y: rawY, items: [] });
    }
    lineMap.get(key)!.items.push(item);
  }

  // Sort lines top-to-bottom (PDF y is bottom-up, so descending y = top-first).
  const sortedLines = Array.from(lineMap.values()).sort((a, b) => b.y - a.y);

  return sortedLines
    .map((line) => {
      // Sort items left-to-right within the line.
      const sorted = [...line.items].sort(
        (a, b) => a.transform[4] - b.transform[4]
      );
      return joinItems(sorted);
    })
    .join('\n');
}

/** Snaps a value to a grid of `tolerance` size to cluster nearby baselines. */
function snapToGrid(value: number, tolerance: number): number {
  return Math.round(value / tolerance) * tolerance;
}

/**
 * Joins text items within a single line. PDFs often encode word spacing via
 * character positioning rather than literal space characters, so we insert
 * a space when the gap between consecutive items exceeds ~1/3 of a character
 * width (estimated from the font scale factor in the transform matrix).
 */
function joinItems(items: PdfTextItem[]): string {
  if (items.length === 0) return '';

  let result = items[0].str;

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];

    const prevX = prev.transform[4];
    const prevScale = Math.abs(prev.transform[0]);
    const estimatedWidth = prev.str.length * prevScale * 0.5;
    const prevEndX = prevX + estimatedWidth;

    const currX = curr.transform[4];
    const gap = currX - prevEndX;
    const charWidth = prevScale * 0.5;

    // Insert a space if there's a meaningful gap and one isn't already present.
    if (gap > charWidth * 0.33 && !result.endsWith(' ') && !curr.str.startsWith(' ')) {
      result += ' ';
    }

    result += curr.str;
  }

  return result.trim();
}
