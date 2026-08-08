import { nanoid } from 'nanoid';
import {
  ComparisonTableBlockSchema,
  MindMapBlockSchema,
  type A2UIBlock,
} from '../../packages/protocol/src/a2ui';

const MIN_MIND_MAP_BRANCHES = 5;
const MAX_MIND_MAP_BRANCHES = 10;

export interface ExplanationPresentation {
  content: string;
  blocks: A2UIBlock[];
}

function plainText(value: string) {
  return value
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim();
}

function precedingHeading(lines: string[], index: number, fallback: string) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const heading = /^#{1,6}\s+(.+)$/.exec(lines[cursor]);
    if (heading) return plainText(heading[1]);
  }
  return fallback;
}

function splitBranch(value: string) {
  const cleaned = plainText(value);
  const separator = /\s+(?:—|–|-|:|：)\s+/.exec(cleaned);
  if (!separator?.index) return { label: cleaned.slice(0, 300) };
  return {
    label: cleaned.slice(0, separator.index).slice(0, 300),
    description: cleaned.slice(separator.index + separator[0].length).slice(0, 1_000) || undefined,
  };
}

function extractMindMap(lines: string[], topic: string) {
  let best: { start: number; end: number; items: string[] } | undefined;
  for (let index = 0; index < lines.length;) {
    if (!/^\s*[-*+]\s+\S/.test(lines[index])) {
      index += 1;
      continue;
    }
    const start = index;
    const items: string[] = [];
    while (index < lines.length) {
      const item = /^\s*[-*+]\s+(.+)$/.exec(lines[index]);
      if (!item) break;
      items.push(item[1]);
      index += 1;
    }
    if (items.length >= MIN_MIND_MAP_BRANCHES && (!best || items.length > best.items.length)) {
      best = { start, end: index, items };
    }
  }
  if (!best) return undefined;

  const title = precedingHeading(lines, best.start, topic || 'Key ideas') || 'Key ideas';
  const rootLabel = title || topic || 'Key ideas';
  const parsed = MindMapBlockSchema.safeParse({
    version: 1,
    id: `mind-map-${nanoid()}`,
    type: 'mind_map',
    title,
    layout: 'tree',
    fallbackText: `${rootLabel}: ${best.items.join('; ')}`,
    root: {
      id: `mind-root-${nanoid()}`,
      label: rootLabel,
      kind: 'topic',
      children: best.items.slice(0, MAX_MIND_MAP_BRANCHES).map((item) => ({
        id: `mind-branch-${nanoid()}`,
        ...splitBranch(item),
        kind: /风险|risk|warning|注意/i.test(item) ? 'risk' : 'idea',
        children: [],
      })),
    },
  });
  return parsed.success ? { block: parsed.data, start: best.start, end: best.end } : undefined;
}

function tableCells(line: string) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => plainText(cell));
}

function extractComparison(lines: string[], topic: string) {
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!lines[index].includes('|') || !/^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) continue;
    const usesChinese = /[\u3400-\u9fff]/.test(lines.slice(index, index + 4).join(''));
    const columns = tableCells(lines[index]).map((column, columnIndex) => (
      column || (columnIndex === 0
        ? usesChinese ? '维度' : 'Dimension'
        : usesChinese ? `第 ${columnIndex + 1} 列` : `Column ${columnIndex + 1}`)
    ));
    const rows: string[][] = [];
    let end = index + 2;
    while (end < lines.length && lines[end].includes('|') && lines[end].trim()) {
      const cells = tableCells(lines[end]);
      if (cells.length === columns.length) rows.push(cells);
      end += 1;
    }
    if (columns.length < 2 || columns.length > 8 || rows.length < 2) continue;
    const title = precedingHeading(lines, index, topic || 'Comparison') || 'Comparison';
    const parsed = ComparisonTableBlockSchema.safeParse({
      version: 1,
      id: `comparison-${nanoid()}`,
      type: 'comparison_table',
      title,
      fallbackText: `${title}: ${rows.map((row) => row.join(', ')).join('; ')}`,
      columns,
      rows: rows.slice(0, 30).map((cells) => ({ id: `comparison-row-${nanoid()}`, cells, emphasis: false })),
    });
    if (!parsed.success) continue;
    return {
      start: index,
      end,
      block: parsed.data,
    };
  }
  return undefined;
}

export function deriveExplanationPresentation(content: string, topic: string): ExplanationPresentation {
  const lines = content.split(/\r?\n/);
  const mindMap = extractMindMap(lines, topic);
  const comparison = extractComparison(lines, topic);
  const extractions = [mindMap, comparison]
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.start - a.start);
  const blocks = extractions.map((item) => item.block).reverse();

  for (const extraction of extractions) {
    lines.splice(extraction.start, extraction.end - extraction.start, '_Structured view below._');
  }
  return { content: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), blocks };
}
