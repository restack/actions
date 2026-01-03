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
