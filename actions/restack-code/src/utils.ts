import * as path from 'path';

export interface FileAction {
  type: 'create' | 'modify' | 'delete';
  path: string;
  content?: string;
}

export interface LLMActionResponse {
  analysis?: string;
  actions?: FileAction[];
  commit_message?: string;
  pr_title?: string;
  pr_body?: string;
}

export function looksLikeUnifiedDiff(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.includes('diff --git') || text.startsWith('@@') || /^(\+{3} |[-]{3} )/m.test(text);
}

export function tryParseActionResponse(text: string | null | undefined): LLMActionResponse | null {
  if (!text) return null;

  let jsonStr = text.trim();

  // Strategy 1: Extract from markdown code blocks
  if (jsonStr.includes('```')) {
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      jsonStr = match[1].trim();
    }
  }

  // Strategy 2: Find JSON object boundaries (first { to last })
  if (!jsonStr.startsWith('{')) {
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
  }

  // Strategy 3: Fix common LLM JSON issues
  // Remove trailing commas before } or ]
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

  // Strategy 3.5: Fix invalid backslash escapes in content fields
  // LLMs sometimes generate invalid escape sequences like \ followed by space or at EOL
  // This fixes common issues like: "value"\ or "value"\
  jsonStr = jsonStr.replace(
    /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
    (match, content) => {
      // Remove backslash before spaces and other invalid characters
      // Keep only valid escapes: \n \t \r \" \\
      const fixed = content.replace(/\\(?![ntr"\\])/g, '');
      return `"content":"${fixed}"`;
    }
  );

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && (parsed.actions || parsed.analysis)) {
      return parsed as LLMActionResponse;
    }
  } catch (e) {
    // Log parsing error for debugging
    const error = e as Error;
    const errorMsg = error?.message ?? String(e);

    // Try to identify the error position
    const posMatch = errorMsg.match(/position\s+(\d+)/i);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      const context = jsonStr.slice(Math.max(0, pos - 50), pos + 50);
      console.error(`JSON parse error at position ${pos}: ${errorMsg}`);
      console.error(`Context around error: ...${context}...`);
    } else {
      console.error(`JSON parse error: ${errorMsg}`);
    }

    // Strategy 4: Try to repair truncated JSON (missing closing braces)
    // This happens when LLM hits token limit
    let repaired = jsonStr;
    const openBraces = (repaired.match(/{/g) || []).length;
    let closeBraces = (repaired.match(/}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    let closeBrackets = (repaired.match(/]/g) || []).length;

    // Close unclosed brackets and braces
    while (openBrackets > closeBrackets) {
      repaired += ']';
      closeBrackets++;
    }
    while (openBraces > closeBraces) {
      repaired += '}';
      closeBraces++;
    }

    if (repaired !== jsonStr) {
      try {
        const parsed = JSON.parse(repaired);
        if (parsed && (parsed.actions || parsed.analysis)) {
          console.info('Successfully parsed JSON after adding missing braces/brackets');
          return parsed as LLMActionResponse;
        }
      } catch {
        // Repair attempt failed, that's ok
      }
    }
  }

  return null;
}

export function buildContext(inputs: {
  issueNumber?: number;
  issueTitle?: string;
  issueBody?: string;
  prNumber?: number;
  prTitle?: string;
  prBody?: string;
  commentBody?: string;
  repo: string;
  eventName?: string;
  reviewCommentPath?: string;
  reviewCommentLine?: string;
}): string {
  const parts: string[] = [];

  parts.push(`Repository: ${inputs.repo}`);

  if (inputs.issueNumber) {
    parts.push(`\nIssue #${inputs.issueNumber}: ${inputs.issueTitle || 'No title'}`);
    if (inputs.issueBody) {
      parts.push(`\nIssue Description:\n${inputs.issueBody}`);
    }
  }

  if (inputs.prNumber) {
    parts.push(`\nPR #${inputs.prNumber}: ${inputs.prTitle || 'No title'}`);
    if (inputs.prBody) {
      parts.push(`\nPR Description:\n${inputs.prBody}`);
    }
  }

  if (inputs.commentBody) {
    // For PR review comments, include file/line context
    if (inputs.eventName === 'pull_request_review_comment' && inputs.reviewCommentPath) {
      let reviewContext = `\nReview Comment on ${inputs.reviewCommentPath}`;
      if (inputs.reviewCommentLine) {
        reviewContext += ` (line ${inputs.reviewCommentLine})`;
      }
      reviewContext += `:\n${inputs.commentBody}`;
      parts.push(reviewContext);
    } else {
      parts.push(`\nCurrent Comment/Request:\n${inputs.commentBody}`);
    }
  }

  return parts.join('\n');
}

export function resolveRepoFilePath(
  repoRoot: string,
  actionPath: string
): { resolvedPath: string; relativePath: string } | null {
  if (!actionPath) return null;

  const trimmed = actionPath.trim();
  if (!trimmed) return null;

  const resolvedPath = path.resolve(repoRoot, trimmed);
  const relativePath = path.relative(repoRoot, resolvedPath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return { resolvedPath, relativePath };
}

/**
 * Validate YAML content for duplicate keys
 * Returns error message if duplicates found, null if valid
 */
export function validateYAMLNoDuplicateKeys(content: string): string | null {
  const lines = content.split('\n');
  const keysByLevel: Map<number, Set<string>> = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    // Match YAML key (with indentation)
    const match = line.match(/^(\s*)([a-zA-Z0-9_-]+):/);
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const key = match[2];

    // Clear deeper levels when we go back to shallower indentation
    for (const [level] of keysByLevel) {
      if (level > indent) {
        keysByLevel.delete(level);
      }
    }

    // Check for duplicate at this level
    if (!keysByLevel.has(indent)) {
      keysByLevel.set(indent, new Set());
    }

    const keysAtLevel = keysByLevel.get(indent)!;
    if (keysAtLevel.has(key)) {
      return `Duplicate YAML key '${key}' found at line ${i + 1} (indent ${indent})`;
    }

    keysAtLevel.add(key);
  }

  return null;
}

/**
 * Detect and truncate repetitive content in LLM output
 * This handles the common LLM "repetition loop" problem where the model
 * generates the same content pattern multiple times
 *
 * @param content The content to check
 * @param minPatternLength Minimum length of pattern to detect (default: 50)
 * @param maxRepetitions Maximum allowed repetitions before truncation (default: 2)
 * @returns Object with cleaned content and whether truncation occurred
 */
export function detectAndTruncateRepetition(
  content: string,
  minPatternLength: number = 50,
  maxRepetitions: number = 2
): { content: string; truncated: boolean; pattern?: string } {
  // Strategy 1: Detect exact repeated blocks
  // Look for patterns that repeat more than maxRepetitions times
  for (let patternLen = minPatternLength; patternLen <= Math.min(500, content.length / 3); patternLen += 10) {
    for (let start = 0; start < content.length - patternLen * (maxRepetitions + 1); start++) {
      const pattern = content.slice(start, start + patternLen);

      // Skip patterns that are mostly whitespace
      if (pattern.replace(/\s/g, '').length < patternLen * 0.3) {
        continue;
      }

      // Count occurrences of this pattern
      let count = 0;
      let pos = start;
      while ((pos = content.indexOf(pattern, pos)) !== -1) {
        count++;
        pos += patternLen;
      }

      if (count > maxRepetitions) {
        // Found repetition! Truncate after the first occurrence
        const firstEnd = start + patternLen;
        const truncated = content.slice(0, firstEnd);

        // Try to find a clean break point (end of YAML block)
        const cleanBreak = truncated.lastIndexOf('\n\n');
        if (cleanBreak > truncated.length * 0.7) {
          return {
            content: truncated.slice(0, cleanBreak),
            truncated: true,
            pattern: pattern.slice(0, 100) + '...'
          };
        }

        return {
          content: truncated,
          truncated: true,
          pattern: pattern.slice(0, 100) + '...'
        };
      }
    }
  }

  // Strategy 2: Detect YAML key repetition patterns
  // Look for the same top-level key appearing multiple times
  const yamlKeyPattern = /^(\s{2,})([a-zA-Z][a-zA-Z0-9_-]*):/gm;
  const keyOccurrences: Map<string, number[]> = new Map();

  let match;
  while ((match = yamlKeyPattern.exec(content)) !== null) {
    const indent = match[1].length;
    const key = match[2];
    const fullKey = `${indent}:${key}`;

    if (!keyOccurrences.has(fullKey)) {
      keyOccurrences.set(fullKey, []);
    }
    keyOccurrences.get(fullKey)!.push(match.index);
  }

  // Check for keys that appear too many times at the same indent level
  for (const [fullKey, positions] of keyOccurrences) {
    if (positions.length > maxRepetitions + 1) {
      // Truncate at the position after maxRepetitions occurrences
      const truncateAt = positions[maxRepetitions];
      const truncated = content.slice(0, truncateAt);

      // Find clean break
      const cleanBreak = truncated.lastIndexOf('\n');
      if (cleanBreak > 0) {
        return {
          content: truncated.slice(0, cleanBreak),
          truncated: true,
          pattern: `YAML key '${fullKey.split(':')[1]}' repeated ${positions.length} times`
        };
      }
    }
  }

  return { content, truncated: false };
}

/**
 * Clean YAML content by removing duplicate sections
 * Specifically handles the case where LLM generates duplicate YAML blocks
 */
export function cleanYAMLDuplicateSections(content: string): string {
  const lines = content.split('\n');
  const seenSections: Map<string, number> = new Map();
  const result: string[] = [];

  let currentSection = '';
  let currentSectionStart = 0;
  let currentIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section headers (top-level keys with specific indent)
    const keyMatch = line.match(/^(\s*)([a-zA-Z][a-zA-Z0-9_-]*):/);

    if (keyMatch) {
      const indent = keyMatch[1].length;
      const key = keyMatch[2];

      // If this is a top-level or near-top-level key
      if (indent <= 10) {
        // Save previous section if it exists
        if (currentSection && currentSectionStart < i) {
          const sectionKey = `${currentIndent}:${currentSection}`;

          if (!seenSections.has(sectionKey)) {
            seenSections.set(sectionKey, i);
            result.push(...lines.slice(currentSectionStart, i));
          }
          // Skip duplicate sections
        }

        currentSection = key;
        currentSectionStart = i;
        currentIndent = indent;
      }
    }
  }

  // Don't forget the last section
  if (currentSectionStart < lines.length) {
    const sectionKey = `${currentIndent}:${currentSection}`;
    if (!seenSections.has(sectionKey)) {
      result.push(...lines.slice(currentSectionStart));
    }
  }

  return result.join('\n');
}
