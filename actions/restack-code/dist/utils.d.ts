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
