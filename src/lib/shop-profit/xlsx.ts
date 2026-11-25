/**
 * Minimal, dependency-free .xlsx writer.
 *
 * The repo intentionally has no spreadsheet dependency, and this product must
 * not ship a binary artefact in a public repository. Building the workbook from
 * deterministic source at request time means the free download and the paid
 * operator download are always in sync with `calc.ts`.
 *
 * Only the OOXML features this workbook needs are implemented: inline strings,
 * numbers, formulas, a fixed style table, frozen header rows, auto-filter,
 * merged cells, column widths and list validation. Files are stored
 * uncompressed (method 0) so they stay readable by Excel and Google Sheets while
 * keeping the writer small and auditable.
 */

import { Buffer } from "node:buffer";

export type XlsxCellValue = string | number | boolean | null | undefined;

export type XlsxCell = {
  value?: XlsxCellValue;
  formula?: string;
  style?: number;
};

export type XlsxRow = {
  cells: Array<XlsxCell | XlsxCellValue>;
  height?: number;
};

export type XlsxDataValidation = {
  sqref: string;
  values: readonly string[];
  allowBlank?: boolean;
  showError?: boolean;
};

export type XlsxSheet = {
  name: string;
  rows: readonly XlsxRow[];
  columnWidths?: readonly number[];
  freezeRows?: number;
  autoFilter?: string;
  merges?: readonly string[];
  dataValidations?: readonly XlsxDataValidation[];
};

type WorkbookOptions = {
  title: string;
  creator?: string;
  createdAt?: Date;
};

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;"
};

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character] ?? character);
}

function columnName(index: number) {
  let current = index + 1;
  let name = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function isPlainCell(cell: XlsxCell | XlsxCellValue): cell is XlsxCell {
  return (
    typeof cell === "object" &&
    cell !== null &&
    ("formula" in cell || "value" in cell || "style" in cell)
  );
}

function renderCell(
  cell: XlsxCell | XlsxCellValue,
  columnIndex: number,
  rowNumber: number
): string {
  const normalised: XlsxCell = isPlainCell(cell) ? cell : { value: cell };
  const reference = `${columnName(columnIndex)}${rowNumber}`;
  const style = normalised.style === undefined ? "" : ` s="${normalised.style}"`;

  if (normalised.formula !== undefined) {
    return `<c r="${reference}"${style}><f>${escapeXml(normalised.formula)}</f></c>`;
  }

  const value = normalised.value;
  if (value === null || value === undefined) {
    return `<c r="${reference}"${style}/>`;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return `<c r="${reference}"${style}/>`;
    return `<c r="${reference}"${style}><v>${value}</v></c>`;
  }

  if (typeof value === "boolean") {
    return `<c r="${reference}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  }

  return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(
    value
  )}</t></is></c>`;
}

function renderSheet(sheet: XlsxSheet, index: number) {
  let maxColumn = 0;
  let maxRow = 0;

  for (const [rowIndex, row] of sheet.rows.entries()) {
    if (row.cells.length > 0) maxRow = Math.max(maxRow, rowIndex + 1);
    maxColumn = Math.max(maxColumn, row.cells.length);
  }

  const dimension = `A1:${columnName(Math.max(maxColumn - 1, 0))}${Math.max(maxRow, 1)}`;

  const rowsXml = sheet.rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row.cells.map((cell, columnIndex) => renderCell(cell, columnIndex, rowNumber));
      const hasContent = cells.some((cell) => cell.length > 0);
      if (!hasContent && row.height === undefined) return "";
      const height = row.height === undefined ? "" : ` ht="${row.height}" customHeight="1"`;
      return `<row r="${rowNumber}"${height}>${cells.join("")}</row>`;
    })
    .filter(Boolean)
    .join("");

  const columnsXml =
    sheet.columnWidths && sheet.columnWidths.length > 0
      ? `<cols>${sheet.columnWidths
          .map(
            (width, columnIndex) =>
              `<col min="${columnIndex + 1}" max="${columnIndex + 1}" width="${width}" customWidth="1"/>`
          )
          .join("")}</cols>`
      : "";

  const freezeRows = sheet.freezeRows ?? 0;
  const sheetViews =
    freezeRows > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeRows}" topLeftCell="A${
          freezeRows + 1
        }" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${
          freezeRows + 1
        }" sqref="A${freezeRows + 1}"/></sheetView></sheetViews>`
      : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;

  const autoFilter = sheet.autoFilter
    ? `<autoFilter ref="${escapeXml(sheet.autoFilter)}"/>`
    : "";

  const merges =
    sheet.merges && sheet.merges.length > 0
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
          .map((range) => `<mergeCell ref="${escapeXml(range)}"/>`)
          .join("")}</mergeCells>`
      : "";

  const dataValidations =
    sheet.dataValidations && sheet.dataValidations.length > 0
      ? `<dataValidations count="${sheet.dataValidations.length}">${sheet.dataValidations
          .map((validation) => {
            const list = `"${validation.values.join(",")}"`;
            return `<dataValidation type="list" allowBlank="${
              validation.allowBlank === false ? 0 : 1
            }" showErrorMessage="${validation.showError === true ? 1 : 0}" sqref="${escapeXml(
              validation.sqref
            )}"><formula1>${escapeXml(list)}</formula1></dataValidation>`;
          })
          .join("")}</dataValidations>`
      : "";

  return {
    name: sheet.name,
    fileName: `sheet${index + 1}.xml`,
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="${dimension}"/>${sheetViews}<sheetFormatPr defaultRowHeight="18"/>${columnsXml}<sheetData>${rowsXml}</sheetData>${autoFilter}${merges}${dataValidations}<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`
  };
}

const CUSTOM_NUMBER_FORMATS = [
  { id: 164, code: '#,##0" đ"' },
  { id: 165, code: "0.0%" },
  { id: 166, code: "dd/mm/yyyy" },
  { id: 167, code: '0.0"%"' }
] as const;

type Xf = {
  fontId?: number;
  fillId?: number;
  borderId?: number;
  numFmtId?: number;
  horizontal?: "left" | "right" | "center";
  vertical?: "top" | "center";
  wrapText?: boolean;
};

const CELL_XFS: readonly Xf[] = [
  {},
  { fontId: 1, vertical: "center" },
  { fontId: 2, fillId: 2, borderId: 1, horizontal: "center", wrapText: true },
  { fillId: 3, borderId: 1, numFmtId: 164, horizontal: "right" },
  { fillId: 3, borderId: 1, numFmtId: 3, horizontal: "right" },
  { fontId: 4, fillId: 5, borderId: 1, numFmtId: 164, horizontal: "right" },
  { fontId: 4, fillId: 5, borderId: 1, numFmtId: 165, horizontal: "right" },
  { fontId: 3, wrapText: true, vertical: "top" },
  { fillId: 6, borderId: 1, wrapText: true, vertical: "top" },
  { fontId: 4 },
  { borderId: 1, wrapText: true, vertical: "top" },
  { fillId: 3, borderId: 1, numFmtId: 166, horizontal: "center" },
  { borderId: 1, wrapText: true, horizontal: "center", vertical: "center" },
  { fontId: 4, fillId: 4, borderId: 1, numFmtId: 164, horizontal: "right" },
  { fillId: 3, borderId: 1, numFmtId: 167, horizontal: "right" },
  { borderId: 1, wrapText: true, vertical: "center" },
  { fontId: 2, fillId: 2, borderId: 1, wrapText: true, vertical: "center" },
  { fillId: 6, borderId: 1, numFmtId: 164, horizontal: "right" },
  { fillId: 6, borderId: 1, numFmtId: 165, horizontal: "right" },
  { fontId: 5, fillId: 4, vertical: "center" },
  { borderId: 1, horizontal: "center", vertical: "center" },
  { fillId: 3, borderId: 1, horizontal: "left" },
  { wrapText: true, vertical: "top" },
  { fontId: 4, fillId: 4, borderId: 1, wrapText: true, vertical: "center" },
  { fontId: 4, borderId: 1, numFmtId: 164, horizontal: "right" },
  { fontId: 4, borderId: 1, numFmtId: 165, horizontal: "right" }
];

function renderStyles() {
  const numFmts = `<numFmts count="${CUSTOM_NUMBER_FORMATS.length}">${CUSTOM_NUMBER_FORMATS.map(
    (format) => `<numFmt numFmtId="${format.id}" formatCode="${escapeXml(format.code)}"/>`
  ).join("")}</numFmts>`;

  const fonts = `<fonts count="6">
<font><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="12"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>
</fonts>`;

  const fills = `<fills count="7">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>
</fills>`;

  const borders = `<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>
</borders>`;

  const cellXfs = CELL_XFS.map((xf) => {
    const attributes = [
      `xfId="0"`,
      `numFmtId="${xf.numFmtId ?? 0}"`,
      `fontId="${xf.fontId ?? 0}"`,
      `fillId="${xf.fillId ?? 0}"`,
      `borderId="${xf.borderId ?? 0}"`,
      xf.numFmtId !== undefined ? `applyNumberFormat="1"` : "",
      xf.fontId !== undefined ? `applyFont="1"` : "",
      xf.fillId !== undefined ? `applyFill="1"` : "",
      xf.borderId !== undefined ? `applyBorder="1"` : "",
      xf.horizontal || xf.vertical || xf.wrapText ? `applyAlignment="1"` : ""
    ]
      .filter(Boolean)
      .join(" ");

    const alignment =
      xf.horizontal || xf.vertical || xf.wrapText
        ? `<alignment${xf.horizontal ? ` horizontal="${xf.horizontal}"` : ""}${
            xf.vertical ? ` vertical="${xf.vertical}"` : ""
          }${xf.wrapText ? ' wrapText="1"' : ""}/>`
        : "";

    return alignment
      ? `<xf ${attributes}>${alignment}</xf>`
      : `<xf ${attributes}/>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts}${fonts}${fills}${borders}<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${CELL_XFS.length}">${cellXfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
}

/* -------------------------------------------------------------------------- */
/* ZIP (stored entries only)                                                   */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Fixed DOS timestamp: deterministic archives for tests and reproducibility. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function buildZip(files: ReadonlyArray<{ name: string; data: Buffer }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const checksum = crc32(file.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(file.data.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, file.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(file.data.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + file.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

/* -------------------------------------------------------------------------- */
/* Workbook                                                                    */
/* -------------------------------------------------------------------------- */

export function buildXlsx(sheets: readonly XlsxSheet[], options: WorkbookOptions): Buffer {
  if (sheets.length === 0) throw new Error("A workbook needs at least one sheet.");

  const seenNames = new Set<string>();
  for (const sheet of sheets) {
    if (!sheet.name.trim()) throw new Error("Sheet names cannot be blank.");
    if (sheet.name.length > 31) throw new Error(`Sheet name too long: ${sheet.name}`);
    if (/[\\/?*[\]:]/.test(sheet.name)) throw new Error(`Invalid sheet name: ${sheet.name}`);
    const key = sheet.name.toLowerCase();
    if (seenNames.has(key)) throw new Error(`Duplicate sheet name: ${sheet.name}`);
    seenNames.add(key);
  }

  const renderedSheets = sheets.map(renderSheet);
  const createdAt = (options.createdAt ?? new Date()).toISOString();
  const creator = options.creator ?? "Affiliate ERP";

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000" activeTab="0"/></bookViews><sheets>${renderedSheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${
          index + 1
        }" r:id="rId${index + 1}"/>`
    )
    .join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;

  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${renderedSheets
    .map(
      (sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sheet.fileName}"/>`
    )
    .join("")}<Relationship Id="rId${
    renderedSheets.length + 1
  }" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${renderedSheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${
          index + 1
        }.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join(
      ""
    )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

  const coreProperties = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(
    options.title
  )}</dc:title><dc:creator>${escapeXml(
    creator
  )}</dc:creator><cp:lastModifiedBy>${escapeXml(
    creator
  )}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`;

  const appProperties = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Affiliate ERP</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>Affiliate ERP</Company><AppVersion>1.0</AppVersion></Properties>`;

  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRelationships, "utf8") },
    { name: "docProps/core.xml", data: Buffer.from(coreProperties, "utf8") },
    { name: "docProps/app.xml", data: Buffer.from(appProperties, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(workbookRelationships, "utf8")
    },
    { name: "xl/styles.xml", data: Buffer.from(renderStyles(), "utf8") },
    ...renderedSheets.map((sheet) => ({
      name: `xl/worksheets/${sheet.fileName}`,
      data: Buffer.from(sheet.xml, "utf8")
    }))
  ]);
}

/** Excel serial date for a UTC calendar date; used only for sample rows. */
export function excelDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return Math.floor((date.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000);
}
