// Minimal .xlsx reader for TimeMint's report files: returns the first sheet's cells as text. An xlsx
// is a zip of XML; node:zlib handles the compression, so no spreadsheet dependency is needed.
import { inflateRawSync } from "node:zlib";

function unzip(buf: Buffer): Map<string, Buffer> {
  // End-of-central-directory record: scan back from the end of the file.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("Not an xlsx file");

  const files = new Map<string, Buffer>();
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLength);

    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    files.set(name, method === 0 ? data : inflateRawSync(data));
    p += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Text of an <si> or <is> element; phonetic runs (<rPh>) are not part of the value. */
const textOf = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

function columnIndex(ref: string): number {
  let index = 0;
  for (const ch of ref.replace(/\d/g, "")) index = index * 26 + ch.charCodeAt(0) - 64;
  return index - 1;
}

/** The first sheet as rows of cell text; missing cells are "". Numeric cells keep their raw value. */
export function readFirstSheet(buf: Buffer): string[][] {
  const files = unzip(buf);
  const sheetName =
    files.has("xl/worksheets/sheet1.xml")
      ? "xl/worksheets/sheet1.xml"
      : [...files.keys()].filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new Error("The xlsx file has no worksheet");

  const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared = [...sharedXml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textOf(m[1] ?? ""));

  const rows: string[][] = [];
  for (const rowMatch of files.get(sheetName)!.toString("utf8").matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    for (const cell of (rowMatch[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cell[1])?.[1];
      if (!ref) continue;
      const type = /\bt="(\w+)"/.exec(cell[1])?.[1];
      const body = cell[2] ?? "";
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (raw !== undefined) value = decode(raw);

      const index = columnIndex(ref);
      while (row.length < index) row.push("");
      row[index] = value;
    }
    rows.push(row);
  }
  return rows;
}
