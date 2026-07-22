const TERMINAL_MARKS = new Set(["。", "！", "？", "!", "?"]);
const CLOSING_MARKS = new Set(["」", "』", "”", "’", "）", ")", "]", "】"]);

export function splitAvaBubbleSegments(content: string): string[] {
  const original = content.replace(/\r\n?/g, "\n").trim();
  if (!original) return [content];

  const sentences = attachStandaloneParentheticals(tokenize(original));
  const merged = mergeAdjacentShortSentences(sentences);
  const segments = merged.length <= 3
    ? merged
    : effectiveLength(merged[0] ?? "") <= 12
      ? [merged[0]!, ...groupEvenly(merged.slice(1), 2)]
      : groupEvenly(merged, 3);

  if (!segments.length || compact(segments.join("")) !== compact(original)) {
    return [original];
  }

  return segments;
}

function tokenize(content: string) {
  const sentences: string[] = [];
  let buffer = "";

  const flush = () => {
    const sentence = buffer.trim();
    if (sentence) sentences.push(sentence);
    buffer = "";
  };

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;

    if (character === "\n" && content[index + 1] === "\n") {
      flush();
      while (content[index + 1] === "\n") index += 1;
      continue;
    }

    buffer += character;
    if (!TERMINAL_MARKS.has(character)) continue;

    let closingIndex = index + 1;
    let consumedClosingMark = false;
    while (closingIndex < content.length && CLOSING_MARKS.has(content[closingIndex]!)) {
      buffer += content[closingIndex];
      closingIndex += 1;
      consumedClosingMark = true;
    }

    if (consumedClosingMark) {
      index = closingIndex - 1;
      const nextCharacter = content[closingIndex];
      if (nextCharacter && !/\s/.test(nextCharacter)) continue;
    }

    flush();
  }

  flush();
  return sentences;
}

function attachStandaloneParentheticals(sentences: string[]) {
  const result: string[] = [];

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index]!;
    if (!isStandaloneParenthetical(sentence)) {
      result.push(sentence);
      continue;
    }

    const next = sentences[index + 1];
    if (next) {
      result.push(`${sentence}\n${next}`);
      index += 1;
    } else if (result.length) {
      result[result.length - 1] = `${result[result.length - 1]}\n${sentence}`;
    } else {
      result.push(sentence);
    }
  }

  return result;
}

function mergeAdjacentShortSentences(sentences: string[]) {
  const result: string[] = [];

  for (const sentence of sentences) {
    const previous = result[result.length - 1];
    if (previous && effectiveLength(previous) <= 4 && effectiveLength(sentence) <= 4) {
      result[result.length - 1] = `${previous}${sentence}`;
    } else {
      result.push(sentence);
    }
  }

  return result;
}

function groupEvenly(sentences: string[], groupCount: number) {
  const groups: string[] = [];
  let offset = 0;

  for (let index = 0; index < groupCount && offset < sentences.length; index += 1) {
    const remainingItems = sentences.length - offset;
    const remainingGroups = groupCount - index;
    const size = Math.ceil(remainingItems / remainingGroups);
    groups.push(sentences.slice(offset, offset + size).join("\n"));
    offset += size;
  }

  return groups;
}

function isStandaloneParenthetical(value: string) {
  return /^(?:（[^（）]+）|\([^()]+\))[。！？!?]?$/.test(value.trim());
}

function effectiveLength(value: string) {
  return Array.from(value.replace(/[\s。！？!?，、,.~～…「」『』“”‘’（）()\[\]【】]/g, "")).length;
}

function compact(value: string) {
  return value.replace(/\s+/g, "");
}
