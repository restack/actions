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
export declare function looksLikeUnifiedDiff(text: string | null | undefined): boolean;
export declare function tryParseActionResponse(text: string | null | undefined): LLMActionResponse | null;
export declare function buildContext(inputs: {
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
}): string;
export declare function resolveRepoFilePath(repoRoot: string, actionPath: string): {
    resolvedPath: string;
    relativePath: string;
} | null;
/**
 * Validate YAML content for duplicate keys
 * Returns error message if duplicates found, null if valid
 */
export declare function validateYAMLNoDuplicateKeys(content: string): string | null;
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
export declare function detectAndTruncateRepetition(content: string, minPatternLength?: number, maxRepetitions?: number): {
    content: string;
    truncated: boolean;
    pattern?: string;
};
/**
 * Clean YAML content by removing duplicate sections
 * Specifically handles the case where LLM generates duplicate YAML blocks
 */
export declare function cleanYAMLDuplicateSections(content: string): string;
