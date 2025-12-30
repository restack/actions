export type MessageFormat = 'auto' | 'chat' | 'raw';
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface LLMClientOptions {
    llmUrl: string;
    apiKey?: string;
    model?: string;
    maxTokens?: number;
    timeoutMs?: number;
    temperature?: number;
    format?: MessageFormat;
}
/**
 * Lightweight LLM client designed to be flexible with local LLM endpoints.
 * Supports both raw prompt format and OpenAI-compatible chat format.
 *
 * Response parsing attempts several common shapes:
 *  - { output: "text..." }
 *  - { choices: [{ text }] } (OpenAI-style completions)
 *  - { choices: [{ message: { content } }] } (chat style)
 *  - { result: "..." }
 */
export declare class LLMClient {
    private axios;
    private opts;
    constructor(opts: LLMClientOptions);
    /**
     * Determine the message format based on URL or explicit setting
     */
    private getMessageFormat;
    /**
     * Send a prompt to the LLM with optional file context
     */
    sendPrompt(prompt: string, files?: Record<string, string>): Promise<string>;
    /**
     * Send a multi-turn conversation (chat format only)
     */
    sendMessages(messages: ChatMessage[]): Promise<string>;
    /**
     * Extract text from various LLM response formats
     */
    extractTextFromResponse(data: unknown): string;
}
export default LLMClient;
