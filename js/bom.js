// BOM / Excel import helpers (uses SheetJS to read .xlsx / .xls / .csv in the browser)
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

export const normHeader = h => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Column definitions. `syn` = accepted header names (normalised), in priority order.
// `partial` = substrings accepted if no exact header matched.
export const FIELDS = [
  { key: 'partNumber', label: 'Part Number', required: true,
    syn: ['partnumber', 'mpn', 'manufacturerpartnumber', 'mfrpartnumber', 'mfrpn', 'mfgpartnumber', 'mfgpn',
          'manufacturerpn', 'partno', 'mfrpartno', 'partnum', 'pn', 'pno', 'libref', 'part'],
    partial: ['partnumber', 'mpn', 'partno'] },
  { key: 'value', label: 'Value (backup only: values are read from the description)',
    syn: ['value', 'val', 'partvalue', 'comment'], partial: ['value'] },
  { key: 'package', label: 'Package / Size', required: true,
    syn: ['package', 'size', 'footprint', 'packagecase', 'casepackage', 'case', 'packagetype', 'pattern'],
    partial: ['package', 'footprint'] },
  { key: 'description', label: 'Description', required: true,
    syn: ['description', 'desc', 'partdescription', 'details'], partial: ['desc'] },
  { key: 'manufacturer', label: 'Manufacturer',
    syn: ['manufacturer', 'mfr', 'mfg', 'manufacturername', 'make', 'brand'], partial: ['manufacturer'] },
  // Where this part was bought (site or vendor name). Columns like "Supplier Part Number" are NOT a source.
  { key: 'source', label: 'Source (site / vendor)',
    syn: ['source', 'site', 'website', 'vendor', 'vendorname', 'supplier', 'suppliername', 'boughtfrom',
          'purchasedfrom', 'distributor', 'seller', 'store', 'shop'],
    partial: ['vendor', 'supplier', 'source', 'distributor'] },
  { key: 'category', label: 'Category',
    syn: ['category', 'componenttype', 'parttype', 'type', 'class'], partial: ['category'] },
  { key: 'designator', label: 'Designator (used to guess category)',
    syn: ['designator', 'designators', 'reference', 'references', 'ref', 'refdes', 'refdesignator'],
    partial: ['designator', 'reference'] },
  { key: 'project', label: 'Project (optional, overrides project name)',
    syn: ['project', 'projectname'], partial: [] },
  // Stock quantity is ONLY read from a "Stock Qty" column — never from the BOM "Qty"/"Quantity" column.
  { key: 'qty', label: 'Stock Qty', required: true,
    syn: ['stockqty', 'stockquantity', 'qtyinstock', 'stockqnty', 'stockcount', 'instock', 'stock'],
    partial: ['stock'] },
];

export async function readWorkbook(file) {
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text();
    return XLSX.read(text, { type: 'string' });
  }
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: 'array' });
}

export function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false })
    .map(r => r.map(c => String(c ?? '').trim()));
}

const ALL_SYN = new Set(FIELDS.flatMap(f => f.syn));

// The header row is the row (within the first 25) that contains the most known column names.
export function detectHeader(rows) {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const score = rows[i].reduce((s, c) => s + (ALL_SYN.has(normHeader(c)) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

export function autoMap(headers) {
  const norm = headers.map(normHeader);
  const used = new Set();
  const map = {};
  for (const f of FIELDS) {
    let idx = -1;
    for (const s of f.syn) {
      idx = norm.findIndex((h, j) => h === s && !used.has(j));
      if (idx >= 0) break;
    }
    if (idx < 0) {
      for (const p of f.partial) {
        idx = norm.findIndex((h, j) => h.includes(p) && !used.has(j));
        if (idx >= 0) break;
      }
    }
    // Safety: never map the BOM per-board quantity column as stock.
    if (f.key === 'qty' && idx >= 0 && !norm[idx].includes('stock')) idx = -1;
    // "Supplier Part Number", "Vendor PN", "Supplier Link" etc. are not the source name.
    if (f.key === 'source' && idx >= 0 && /part|pn$|number|no$|link|url|price|cost|qty/.test(norm[idx])) idx = -1;
    if (idx >= 0) used.add(idx);
    map[f.key] = idx;
  }
  return map;
}

// "Resistor_SMD:R_0603_1608Metric" -> "0603"; "Package_SO:SOIC-8_3.9x4.9mm" -> "SOIC-8 3.9x4.9mm"
export function cleanPackage(s) {
  s = String(s ?? '').trim();
  if (!s) return '';
  if (!/[:_]/.test(s)) return s;
  const p = s.includes(':') ? s.split(':').pop() : s;
  const m = p.match(/(?:^|[^0-9])(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)(?:[^0-9]|$)/);
  if (m) return m[1];
  return p.replace(/_/g, ' ').trim();
}

export function parseQty(s) {
  const t = String(s ?? '').replace(/[, ]/g, '').trim();
  if (!/^\d+(\.0+)?$/.test(t)) return NaN;
  return parseInt(t, 10);
}

const PREFIX_CAT = [
  [/^(RN|RA)$/, 'Resistor'], [/^R$/, 'Resistor'], [/^VR$/, 'Resistor'],
  [/^C$/, 'Capacitor'], [/^FB$/, 'Ferrite Bead'], [/^L$/, 'Inductor'],
  [/^LED$/, 'LED'], [/^D$/, 'Diode'], [/^(Q|T)$/, 'Transistor'],
  [/^(U|IC)$/, 'IC'], [/^(J|P|CN|CON|X)$/, 'Connector'], [/^Y$/, 'Crystal / Oscillator'],
  [/^F$/, 'Fuse'], [/^(SW|S)$/, 'Switch'], [/^K$/, 'Relay'], [/^TP$/, 'Test Point'], [/^BT$/, 'Battery'],
];
const WORD_CAT = [
  [/ferrite|\bbead\b/i, 'Ferrite Bead'], [/resistor|\bres\b/i, 'Resistor'], [/capacitor|\bcap\b|mlcc/i, 'Capacitor'],
  [/inductor|\bind\b|\bchoke\b/i, 'Inductor'], [/\bled\b/i, 'LED'], [/mosfet|\bfet\b/i, 'MOSFET'], [/transistor|\bbjt\b/i, 'Transistor'],
  [/diode|schottky|zener|\btvs\b/i, 'Diode'], [/connector|header|\bjst\b|terminal/i, 'Connector'],
  [/crystal|oscillator|\bxtal\b/i, 'Crystal / Oscillator'], [/\bfuse\b|polyfuse/i, 'Fuse'],
  [/switch|button/i, 'Switch'], [/relay/i, 'Relay'], [/sensor/i, 'Sensor'], [/module/i, 'Module'],
  [/\bic\b|regulator|converter|\bbuck\b|\bboost\b|\bldo\b|mcu|microcontroller|op-?amp|driver|transceiver|eeprom|flash|adc|dac|pmic|charger/i, 'IC'],
];
const IC_TYPE = [
  [/buck-?boost/i, 'Buck-Boost Converter'], [/\bbuck\b|step-?down/i, 'Buck Converter'], [/\bboost\b|step-?up/i, 'Boost Converter'],
  [/\bldo\b/i, 'LDO Regulator'], [/regulator/i, 'Linear Regulator'], [/\bmcu\b|microcontroller/i, 'Microcontroller (MCU)'],
  [/op-?amp|operational/i, 'Op-Amp'], [/comparator/i, 'Comparator'], [/charger/i, 'Battery Charger'],
  [/motor driver/i, 'Motor Driver'], [/gate driver/i, 'Gate Driver'], [/led driver/i, 'LED Driver'],
  [/eeprom|flash|memory/i, 'Memory (EEPROM/Flash)'], [/\badc\b/i, 'ADC'], [/\bdac\b/i, 'DAC'],
  [/can |rs-?485|rs-?232|uart|transceiver/i, 'Interface (UART/RS-485/CAN)'], [/\busb\b/i, 'USB Interface'],
  [/ethernet|\bphy\b/i, 'Ethernet PHY'], [/load switch/i, 'Load Switch'], [/level shift|translator/i, 'Level Shifter'],
];

export const CATEGORIES = ['Resistor', 'Capacitor', 'Inductor', 'Ferrite Bead', 'Diode', 'LED', 'Transistor', 'MOSFET',
  'IC', 'Connector', 'Crystal / Oscillator', 'Fuse', 'Switch', 'Relay', 'Sensor', 'Module', 'Battery',
  'Test Point', 'Mechanical', 'Other'];

// Maps whatever a BOM's category/type column says ("Capacitors", "Chip Resistor", "CAP", "ICs", "Crystal")
// to one of our categories. Returns '' when it is not recognisable (e.g. "SMD", "Default").
export function normalizeCategory(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  const forms = [lower, lower.replace(/s$/, ''), lower.replace(/es$/, '')]; // "Capacitors", "Switches", "ICs"
  const exact = CATEGORIES.find(c => forms.includes(c.toLowerCase()));
  if (exact) return exact;
  const SHORT = { r: 'Resistor', res: 'Resistor', c: 'Capacitor', cap: 'Capacitor', l: 'Inductor', ind: 'Inductor',
    d: 'Diode', q: 'Transistor', u: 'IC', ics: 'IC', xtal: 'Crystal / Oscillator', crystal: 'Crystal / Oscillator',
    crystals: 'Crystal / Oscillator', oscillator: 'Crystal / Oscillator', j: 'Connector', conn: 'Connector', f: 'Fuse' };
  if (SHORT[lower]) return SHORT[lower];
  for (const [re, cat] of WORD_CAT) if (re.test(s)) return cat;
  return '';
}

export function guessCategory(designator, description) {
  const pre = (String(designator || '').trim().split(/[\s,;]+/)[0] || '').match(/^([A-Za-z]+)/);
  if (pre) {
    const p = pre[1].toUpperCase();
    for (const [re, cat] of PREFIX_CAT) if (re.test(p)) return cat;
  }
  const d = description || '';
  for (const [re, cat] of WORD_CAT) if (re.test(d)) return cat;
  // No designator / keyword: recognise passives by the unit in the text ("100nF", "4.7uH", "10kΩ").
  if (capacitance(d)) return 'Capacitor';
  if (inductance(d)) return 'Inductor';
  if (/Ω|[oO][hH][mM]/.test(d) && resistance(d)) return 'Resistor';
  return '';
}

// ---------------------------------------------------------------------
//  Component value — only parts whose value matters need one.
// ---------------------------------------------------------------------
export const VALUE_CATEGORIES = ['Resistor', 'Capacitor', 'Inductor', 'Ferrite Bead', 'Crystal / Oscillator', 'Fuse'];
export const needsValue = cat => VALUE_CATEGORIES.includes(normalizeCategory(cat) || String(cat || '').trim());

const fmtNum = s => {
  const f = parseFloat(String(s).replace(',', '.'));
  return isNaN(f) ? String(s) : String(+f.toPrecision(6));
};
const B = '(?:^|[^\\w.])'; // start boundary that does not split "4.7" or "0603"

// 10k, 4.7k, 4K7, 100R, 0R, 1M, 10mΩ, 120 Ohm, R010 -> "10k", "4.7k", "100Ω", "1M", "10mΩ", "0.01Ω"
export function resistance(d) {
  let m = d.match(/(\d+(?:[.,]\d+)?)\s?([kKmMG]?)\s?(?:Ω|[oO][hH][mM][sS]?\b)/);
  if (m) {
    const p = m[2] === 'K' ? 'k' : m[2];
    return p === 'm' ? fmtNum(m[1]) + 'mΩ' : p ? fmtNum(m[1]) + p : fmtNum(m[1]) + 'Ω';
  }
  m = d.match(new RegExp(B + '(\\d+(?:[.,]\\d+)?)([kKMR])(\\d*)(?![\\w.%/])'));
  if (m) {
    const v = m[3] ? `${m[1]}.${m[3]}` : m[1];
    const p = m[2] === 'K' ? 'k' : m[2];
    return p === 'R' ? fmtNum(v) + 'Ω' : fmtNum(v) + p;
  }
  m = d.match(new RegExp(B + 'R(\\d+)(?![\\w.])'));
  if (m) return fmtNum('0.' + m[1]) + 'Ω';
  return '';
}
const pfx = p => (p === 'µ' || p === 'μ' || p === 'U' ? 'u' : p.toLowerCase());
// 100nF, 0.1uF, 4.7µF, 10PF, 4n7, 2u2 -> "100nF", "0.1uF", "4.7uF", "10pF", "4.7nF", "2.2uF"
export function capacitance(d) {
  let m = d.match(/(\d+(?:[.,]\d+)?)\s?([pnuµμPNU])\s?[fF](?![a-zA-Z])/);
  if (m) return fmtNum(m[1]) + pfx(m[2]) + 'F';
  m = d.match(new RegExp(B + '(\\d+)([pnuµ])(\\d+)(?![\\w.])'));
  if (m) return fmtNum(`${m[1]}.${m[3]}`) + pfx(m[2]) + 'F';
  return '';
}
// 4.7uH, 10UH, 100nH, 1mH -> "4.7uH", "10uH", "100nH", "1mH"
export function inductance(d) {
  const m = d.match(/(\d+(?:[.,]\d+)?)\s?([nuµμmNU])\s?[hH](?![a-zA-Z])/);
  return m ? fmtNum(m[1]) + (m[2] === 'm' ? 'm' : pfx(m[2])) + 'H' : '';
}
// 16MHz, 32.768kHz, 25 MHZ -> "16MHz", "32.768kHz", "25MHz"
export function frequency(d) {
  const m = d.match(/(\d+(?:[.,]\d+)?)\s?([kKMG]?)\s?[hH][zZ]/);
  return m ? fmtNum(m[1]) + (m[2] === 'K' ? 'k' : m[2]) + 'Hz' : '';
}
// 500mA, 2A, 1.5 A -> "500mA", "2A", "1.5A"
export function current(d) {
  const m = d.match(/(\d+(?:[.,]\d+)?)\s?(m?)A(?![a-zA-Z])/);
  return m ? fmtNum(m[1]) + m[2] + 'A' : '';
}

// Reads the value out of a description, based on what kind of part it is.
export function extractValue(text, category) {
  const d = String(text || '');
  switch (normalizeCategory(category) || String(category || '').trim()) {
    case 'Resistor': return resistance(d);
    case 'Capacitor': return capacitance(d);
    case 'Inductor': return inductance(d);
    case 'Ferrite Bead': return resistance(d) || inductance(d);
    case 'Crystal / Oscillator': return frequency(d);
    case 'Fuse': return current(d);
    default: return '';
  }
}

// Value for an imported row: from the description first, then from the Value column.
// Parts that do not need a value (ICs, connectors, diodes, ...) get none.
export function deriveValue(description, valueColumn, category) {
  if (needsValue(category)) {
    return extractValue(description, category) || extractValue(valueColumn, category) || String(valueColumn || '').trim();
  }
  return category ? '' : String(valueColumn || '').trim();
}

export function guessIcType(description) {
  for (const [re, t] of IC_TYPE) if (re.test(description || '')) return t;
  return '';
}

// Turns raw sheet rows into editable import items.
export function buildItems(rows, headerIdx, map) {
  const get = (r, k) => (map[k] >= 0 ? String(r[map[k]] ?? '').trim() : '');
  const items = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const it = {
      rowNo: i + 1,
      include: true,
      partNumber: get(r, 'partNumber'),
      value: get(r, 'value'),
      package: cleanPackage(get(r, 'package')),
      description: get(r, 'description'),
      manufacturer: get(r, 'manufacturer'),
      category: get(r, 'category'),
      project: get(r, 'project'),
      qty: get(r, 'qty'),
      sourceName: get(r, 'source'),
      sourceType: 'online', // decided by the app (it knows the saved vendors)
    };
    const designator = get(r, 'designator');
    it.designator = designator;
    if (!it.partNumber && !it.value && !it.package && !it.description && !it.qty) continue; // empty row
    // Use the file's category only if we recognise it; otherwise detect from designator / description.
    it.category = normalizeCategory(it.category) || guessCategory(designator, `${it.description} ${it.value}`);
    it.icType = it.category === 'IC' ? guessIcType(it.description) : '';
    it.value = deriveValue(it.description, it.value, it.category);
    items.push(it);
  }
  return items;
}

export function missingFields(it) {
  const m = [];
  if (!String(it.partNumber).trim()) m.push('Part Number');
  if (needsValue(it.category) && !String(it.value).trim()) m.push('Value');
  if (!String(it.package).trim()) m.push('Package');
  if (!String(it.description).trim()) m.push('Description');
  const q = parseQty(it.qty);
  if (!Number.isInteger(q) || q < 0) m.push('Stock Qty');
  return m;
}

export function downloadTemplate() {
  const aoa = [
    ['Part Number', 'Value', 'Package', 'Description', 'Manufacturer', 'Category', 'Designator', 'Source', 'Stock Qty'],
    ['RC0603FR-0710KL', '10k', '0603', 'Resistor 10k 1% 1/10W', 'Yageo', 'Resistor', 'R1', 'LCSC', '100'],
    ['CL10B104KB8NNNC', '100nF', '0603', 'Capacitor MLCC 100nF 50V X7R', 'Samsung', 'Capacitor', 'C1', 'Mouser', '200'],
    ['TPS62130RGTR', '', 'QFN-16', 'Buck converter 3A 17V', 'Texas Instruments', 'IC', 'U1', 'DigiKey', '5'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 34 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BOM');
  XLSX.writeFile(wb, 'riod_inventory_import_template.xlsx');
}
