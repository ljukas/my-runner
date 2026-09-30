/** Reads a `runbro-export/1` file (src/domain/run-export.ts) back into its header and CSV sections. */
export interface Section {
  columns: string[];
  rows: Record<string, string>[];
}

export interface Export {
  header: {
    schema: number;
    exportedAt: string;
    run: Record<string, string | number | null>;
    device: Record<string, string | number | boolean | null>;
    counts: Record<string, number>;
    dropped: number;
  };
  sections: Record<string, Section>;
  trailerTotal: number | null;
}

/** Mirrors `csv()` in src/domain/run-export.ts: quote only when needed, `"` doubled inside. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

export function parseExport(text: string, path: string): Export {
  const lines = text.split('\n');
  if (!lines[0]?.startsWith('# runbro-export/')) throw new Error(`${path}: missing magic line`);
  const header = JSON.parse(lines[1] ?? '') as Export['header'];

  const sections: Record<string, Section> = {};
  let current: Section | null = null;
  let trailerTotal: number | null = null;

  for (const line of lines.slice(2)) {
    if (line.startsWith('## ')) {
      current = { columns: [], rows: [] };
      sections[line.slice(3).trim()] = current;
      continue;
    }
    if (line.startsWith('# end')) {
      trailerTotal = Number(line.slice(5).trim());
      continue;
    }
    if (!line.trim() || !current) continue;
    if (current.columns.length === 0) {
      current.columns = splitCsv(line);
      continue;
    }
    const values = splitCsv(line);
    current.rows.push(Object.fromEntries(current.columns.map((c, i) => [c, values[i] ?? ''])));
  }
  return { header, sections, trailerTotal };
}
