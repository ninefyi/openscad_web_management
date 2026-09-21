export interface ComplexityEstimate {
  booleanOps: number;
  textCalls: number;
  hasExpensiveLoop: boolean;
  fn: number | null;
  isComplex: boolean;
}

const BOOLEAN_OP_RE = /\b(difference|union|intersection)\s*\(/g;
const TEXT_CALL_RE = /\btext\s*\(/g;
const EXPENSIVE_CALL_RE = /\b(text|difference|union|intersection)\s*\(/;
const FOR_RE = /\bfor\s*\(/g;
const MODULE_HEADER_RE = /\bmodule\s+([A-Za-z_]\w*)\s*\(/g;
const FN_RE = /^\s*\$fn\s*=\s*(\d+)/m;

/** Scans forward from `openParenIndex` (pointing just past an opening `(`)
 * and returns the index just past its matching `)`. */
function matchParen(source: string, openParenIndex: number): number {
  let depth = 1;
  let i = openParenIndex;
  while (i < source.length && depth > 0) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") depth--;
    i++;
  }
  return i;
}

/** Given an index just past a statement's header (e.g. a `for (...)` or
 * `module NAME(...)`), returns that statement's body: everything inside a
 * `{ }` block, or — for OpenSCAD's braceless single-statement form like
 * `for (i = [0:9]) cube(1);` — everything up to the terminating `;`. */
function extractBody(source: string, from: number): string {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] === "{") {
    let depth = 1;
    let j = i + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") depth--;
      j++;
    }
    return source.slice(i, j);
  }
  let depth = 0;
  let j = i;
  while (j < source.length) {
    const c = source[j];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) {
      j++;
      break;
    }
    j++;
  }
  return source.slice(i, j);
}

function extractModuleBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  MODULE_HEADER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MODULE_HEADER_RE.exec(source))) {
    const name = m[1];
    const afterParams = matchParen(source, MODULE_HEADER_RE.lastIndex);
    bodies.set(name, extractBody(source, afterParams));
  }
  return bodies;
}

function extractForLoopBodies(source: string): string[] {
  const bodies: string[] = [];
  FOR_RE.lastIndex = 0;
  while (FOR_RE.exec(source)) {
    const afterHeader = matchParen(source, FOR_RE.lastIndex);
    bodies.push(extractBody(source, afterHeader));
  }
  return bodies;
}

function callsModule(body: string, moduleName: string): boolean {
  return new RegExp(`\\b${moduleName}\\s*\\(`).test(body);
}

/** A module counts as "expensive" if its own body has a direct text()/
 * boolean-op call, or it calls another expensive module — computed as a
 * fixed point so the flag propagates through any depth of call chains
 * (e.g. a for-loop calling A, which calls B, which calls text()). */
function findExpensiveModules(moduleBodies: Map<string, string>): Set<string> {
  const expensive = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, body] of moduleBodies) {
      if (expensive.has(name)) continue;
      const directlyExpensive = EXPENSIVE_CALL_RE.test(body);
      const callsExpensive = [...expensive].some((other) => callsModule(body, other));
      if (directlyExpensive || callsExpensive) {
        expensive.add(name);
        changed = true;
      }
    }
  }
  return expensive;
}

/**
 * A cheap, static, source-text estimate of how expensive a Render is likely
 * to be — not a real cost model, just enough to tell a non-technical user
 * "this one's genuinely complex" instead of leaving them staring at a
 * spinner with no idea if it's stuck.
 *
 * The tricky part is loops: a template can call text() once inside a
 * module and invoke that module 40+ times via a `for` loop (exactly what
 * made the Thai roller template slow) — the source only spells `text(`
 * out once, so raw occurrence-counting alone would call that "simple".
 * Conversely, a loop that merely computes a few corner coordinates for a
 * hull() is cheap even though a difference() exists elsewhere in the same
 * file — co-occurrence in the same source isn't enough either. So this
 * builds a small module call-graph and checks whether each `for` loop's
 * body actually *reaches* an expensive call, directly or through however
 * many module calls deep.
 */
export function estimateComplexity(source: string): ComplexityEstimate {
  const booleanOps = (source.match(BOOLEAN_OP_RE) ?? []).length;
  const textCalls = (source.match(TEXT_CALL_RE) ?? []).length;
  const fnMatch = source.match(FN_RE);
  const fn = fnMatch ? Number(fnMatch[1]) : null;

  const moduleBodies = extractModuleBodies(source);
  const expensiveModules = findExpensiveModules(moduleBodies);
  const loopBodies = extractForLoopBodies(source);
  const hasExpensiveLoop = loopBodies.some(
    (body) =>
      EXPENSIVE_CALL_RE.test(body) ||
      [...expensiveModules].some((name) => callsModule(body, name)),
  );

  const isComplex =
    hasExpensiveLoop ||
    textCalls >= 5 ||
    booleanOps >= 8 ||
    (fn !== null && fn >= 100 && (textCalls > 0 || booleanOps > 0));

  return { booleanOps, textCalls, hasExpensiveLoop, fn, isComplex };
}

export function complexityMessage(estimate: ComplexityEstimate): string | null {
  if (!estimate.isComplex) return null;

  if (estimate.hasExpensiveLoop) {
    return "Complex design — this repeats shapes in a loop, so renders may take a while.";
  }

  const parts: string[] = [];
  if (estimate.textCalls > 0) {
    parts.push(`${estimate.textCalls} engraved shape${estimate.textCalls === 1 ? "" : "s"}`);
  }
  if (estimate.booleanOps > 0) {
    parts.push(`${estimate.booleanOps} combined shapes`);
  }
  if (estimate.fn !== null && estimate.fn >= 100) {
    parts.push(`a high facet count ($fn=${estimate.fn})`);
  }
  const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `Complex design${detail} — this render may take a while.`;
}
