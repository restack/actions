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
