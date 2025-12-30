import axios, { AxiosInstance } from 'axios';

export type MessageFormat = 'auto' | 'chat' | 'raw';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMClientOptions {
  llmUrl: string; // full URL to POST to (e.g. http://localhost:8080/v1/generate or /v1/chat/completions)
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
export class LLMClient {
  private axios: AxiosInstance;
  private opts: LLMClientOptions;

  constructor(opts: LLMClientOptions) {
    this.opts = {
      timeoutMs: 300_000, // 5 minutes default for large local models
      temperature: 0.1,
      format: 'auto',
      ...opts,
    };
    this.axios = axios.create({
      baseURL: '', // we will use full URL per-request so leave base blank
      timeout: this.opts.timeoutMs,
      headers: this.opts.apiKey
        ? {
            Authorization: `Bearer ${this.opts.apiKey}`,
            'Content-Type': 'application/json',
          }
        : { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Determine the message format based on URL or explicit setting
   */
  private getMessageFormat(): MessageFormat {
    if (this.opts.format && this.opts.format !== 'auto') {
      return this.opts.format;
    }
    // Auto-detect based on URL
    const url = this.opts.llmUrl.toLowerCase();
    if (url.includes('/chat/completions') || url.includes('/v1/chat')) {
      return 'chat';
    }
    return 'raw';
  }

  /**
   * Send a prompt to the LLM with optional file context
   */
  async sendPrompt(prompt: string, files?: Record<string, string>): Promise<string> {
    const format = this.getMessageFormat();

    let payload: Record<string, unknown>;

    if (format === 'chat') {
      // OpenAI-compatible chat format
      const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
      payload = {
        model: this.opts.model,
        messages,
        max_tokens: this.opts.maxTokens,
        temperature: this.opts.temperature,
      };

      // Some local LLMs accept files in the payload
      if (files && Object.keys(files).length) {
        payload.files = files;
      }
    } else {
      // Raw prompt format
      payload = {
        model: this.opts.model,
        prompt,
        max_tokens: this.opts.maxTokens,
        temperature: this.opts.temperature,
      };

      if (files && Object.keys(files).length) {
        payload.files = files;
      }
    }

    try {
      const res = await this.axios.post(this.opts.llmUrl, payload);
      return this.extractTextFromResponse(res.data);
    } catch (err: unknown) {
      // Surface useful error information
      const axiosErr = err as { response?: { data?: unknown; statusText?: string }; message?: string };
      const message =
        axiosErr?.response?.data || axiosErr?.response?.statusText || axiosErr?.message || String(err);
      throw new Error(`LLM request failed: ${message}`);
    }
  }

  /**
   * Send a multi-turn conversation (chat format only)
   */
  async sendMessages(messages: ChatMessage[]): Promise<string> {
    const payload = {
      model: this.opts.model,
      messages,
      max_tokens: this.opts.maxTokens,
      temperature: this.opts.temperature,
    };

    try {
      const res = await this.axios.post(this.opts.llmUrl, payload);
      return this.extractTextFromResponse(res.data);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: unknown; statusText?: string }; message?: string };
      const message =
        axiosErr?.response?.data || axiosErr?.response?.statusText || axiosErr?.message || String(err);
      throw new Error(`LLM request failed: ${message}`);
    }
  }

  /**
   * Extract text from various LLM response formats
   */
  extractTextFromResponse(data: unknown): string {
    if (!data) return '';

    const obj = data as Record<string, unknown>;

    // common: { output: "..." }
    if (typeof obj.output === 'string') return obj.output;

    // some local LLMs return { result: "..." }
    if (typeof obj.result === 'string') return obj.result;

    // OpenAI-style completions: { choices: [{ text }] }
    if (Array.isArray(obj.choices) && obj.choices[0]) {
      const firstChoice = obj.choices[0] as Record<string, unknown>;
      if (typeof firstChoice.text === 'string') {
        return (obj.choices as Array<{ text: string }>).map((c) => c.text).join('\n');
      }

      // Chat completions: { choices: [{ message: { content } }] }
      const message = firstChoice.message as Record<string, unknown> | undefined;
      if (message && typeof message.content === 'string') {
        return (obj.choices as Array<{ message: { content: string } }>)
          .map((c) => c.message.content)
          .join('\n');
      }
    }

    // Some LLMs return an array of generations
    if (Array.isArray(data) && typeof data[0] === 'string') {
      return data.join('\n');
    }

    // Fallback: try to stringify
    if (typeof data === 'string') return data;

    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }
}

export default LLMClient;
