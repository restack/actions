import { LLMClient } from './llm-client';

type LLMClientInternal = {
  getMessageFormat: () => string;
  opts: {
    timeoutMs: number;
    temperature: number;
  };
};

function asInternal(client: LLMClient): LLMClientInternal {
  return client as unknown as LLMClientInternal;
}

describe('LLMClient', () => {
  describe('extractTextFromResponse', () => {
    let client: LLMClient;

    beforeEach(() => {
      client = new LLMClient({ llmUrl: 'http://localhost:8080/v1/chat/completions' });
    });

    it('should extract text from { output: "..." } format', () => {
      const result = client.extractTextFromResponse({ output: 'Hello world' });
      expect(result).toBe('Hello world');
    });

    it('should extract text from { result: "..." } format', () => {
      const result = client.extractTextFromResponse({ result: 'Hello world' });
      expect(result).toBe('Hello world');
    });

    it('should extract text from OpenAI completions format', () => {
      const result = client.extractTextFromResponse({
        choices: [{ text: 'First choice' }, { text: 'Second choice' }],
      });
      expect(result).toBe('First choice\nSecond choice');
    });

    it('should extract text from OpenAI chat completions format', () => {
      const result = client.extractTextFromResponse({
        choices: [
          { message: { content: 'Hello from chat' } },
          { message: { content: 'Second message' } },
        ],
      });
      expect(result).toBe('Hello from chat\nSecond message');
    });

    it('should handle array of strings', () => {
      const result = client.extractTextFromResponse(['First', 'Second', 'Third']);
      expect(result).toBe('First\nSecond\nThird');
    });

    it('should return empty string for null/undefined', () => {
      expect(client.extractTextFromResponse(null)).toBe('');
      expect(client.extractTextFromResponse(undefined)).toBe('');
    });

    it('should return string as-is', () => {
      const result = client.extractTextFromResponse('Plain string response');
      expect(result).toBe('Plain string response');
    });

    it('should JSON stringify unknown objects', () => {
      const result = client.extractTextFromResponse({ unknown: 'format', foo: 123 });
      expect(result).toBe(JSON.stringify({ unknown: 'format', foo: 123 }, null, 2));
    });
  });

  describe('message format detection', () => {
    it('should detect chat format from /chat/completions URL', () => {
      const client = new LLMClient({
        llmUrl: 'http://localhost:8080/v1/chat/completions',
      });
      const format = asInternal(client).getMessageFormat();
      expect(format).toBe('chat');
    });

    it('should detect chat format from /v1/chat URL', () => {
      const client = new LLMClient({
        llmUrl: 'http://localhost:8080/v1/chat',
      });
      const format = asInternal(client).getMessageFormat();
      expect(format).toBe('chat');
    });

    it('should default to raw format for other URLs', () => {
      const client = new LLMClient({
        llmUrl: 'http://localhost:8080/generate',
      });
      const format = asInternal(client).getMessageFormat();
      expect(format).toBe('raw');
    });

    it('should respect explicit format override', () => {
      const client = new LLMClient({
        llmUrl: 'http://localhost:8080/v1/chat/completions',
        format: 'raw',
      });
      const format = asInternal(client).getMessageFormat();
      expect(format).toBe('raw');
    });
  });

  describe('constructor defaults', () => {
    it('should set default timeout to 5 minutes', () => {
      const client = new LLMClient({ llmUrl: 'http://localhost:8080' });
      expect(asInternal(client).opts.timeoutMs).toBe(300000);
    });

    it('should set default temperature to 0.1', () => {
      const client = new LLMClient({ llmUrl: 'http://localhost:8080' });
      expect(asInternal(client).opts.temperature).toBe(0.1);
    });

    it('should allow overriding defaults', () => {
      const client = new LLMClient({
        llmUrl: 'http://localhost:8080',
        timeoutMs: 60000,
        temperature: 0.7,
      });
      expect(asInternal(client).opts.timeoutMs).toBe(60000);
      expect(asInternal(client).opts.temperature).toBe(0.7);
    });
  });
});
