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

  if (jsonStr.includes('```')) {
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      jsonStr = match[1].trim();
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && (parsed.actions || parsed.analysis)) {
      return parsed as LLMActionResponse;
    }
  } catch {
    // Not valid JSON, return null
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
    parts.push(`\nCurrent Comment/Request:\n${inputs.commentBody}`);
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
