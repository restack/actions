import { buildContext, looksLikeUnifiedDiff, resolveRepoFilePath, tryParseActionResponse } from './utils';

describe('Utility Functions', () => {
  describe('looksLikeUnifiedDiff', () => {
    it('should detect diff --git format', () => {
      const diff = `diff --git a/file.ts b/file.ts
index 1234567..abcdefg 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;`;
      expect(looksLikeUnifiedDiff(diff)).toBe(true);
    });

    it('should detect @@ hunk headers', () => {
      const diff = `@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;`;
      expect(looksLikeUnifiedDiff(diff)).toBe(true);
    });

    it('should detect +++ and --- markers', () => {
      const diff = `--- a/file.ts
+++ b/file.ts
 const x = 1;`;
      expect(looksLikeUnifiedDiff(diff)).toBe(true);
    });

    it('should return false for regular text', () => {
      expect(looksLikeUnifiedDiff('Just some regular text')).toBe(false);
      expect(looksLikeUnifiedDiff('{ "analysis": "something" }')).toBe(false);
    });

    it('should return false for empty/null input', () => {
      expect(looksLikeUnifiedDiff('')).toBe(false);
      expect(looksLikeUnifiedDiff(null)).toBe(false);
    });
  });

  describe('tryParseActionResponse', () => {
    it('should parse valid JSON action response', () => {
      const response = JSON.stringify({
        analysis: 'This is the analysis',
        actions: [
          { type: 'create', path: 'file.ts', content: 'const x = 1;' },
        ],
        commit_message: 'feat: add file',
      });

      const result = tryParseActionResponse(response);
      expect(result).not.toBeNull();
      expect(result?.analysis).toBe('This is the analysis');
      expect(result?.actions).toHaveLength(1);
      expect(result?.actions?.[0].type).toBe('create');
    });

    it('should parse JSON from markdown code blocks', () => {
      const response = `Here's the response:

\`\`\`json
{
  "analysis": "Found issue",
  "actions": [
    { "type": "modify", "path": "src/index.ts", "content": "fixed code" }
  ]
}
\`\`\`

Hope this helps!`;

      const result = tryParseActionResponse(response);
      expect(result).not.toBeNull();
      expect(result?.analysis).toBe('Found issue');
      expect(result?.actions).toHaveLength(1);
    });

    it('should parse JSON with analysis only', () => {
      const response = JSON.stringify({
        analysis: 'No changes needed',
      });

      const result = tryParseActionResponse(response);
      expect(result).not.toBeNull();
      expect(result?.analysis).toBe('No changes needed');
    });

    it('should return null for invalid JSON', () => {
      expect(tryParseActionResponse('not json')).toBeNull();
      expect(tryParseActionResponse('{ invalid }')).toBeNull();
    });

    it('should return null for JSON without expected fields', () => {
      const response = JSON.stringify({ foo: 'bar', baz: 123 });
      expect(tryParseActionResponse(response)).toBeNull();
    });

    it('should return null for empty input', () => {
      expect(tryParseActionResponse('')).toBeNull();
      expect(tryParseActionResponse(null)).toBeNull();
    });
  });

  describe('buildContext', () => {
    it('should include repository', () => {
      const result = buildContext({ repo: 'owner/repo' });
      expect(result).toContain('Repository: owner/repo');
    });

    it('should include issue context', () => {
      const result = buildContext({
        repo: 'owner/repo',
        issueNumber: 42,
        issueTitle: 'Bug fix needed',
        issueBody: 'Please fix this bug',
      });

      expect(result).toContain('Issue #42: Bug fix needed');
      expect(result).toContain('Issue Description:\nPlease fix this bug');
    });

    it('should include PR context', () => {
      const result = buildContext({
        repo: 'owner/repo',
        prNumber: 123,
        prTitle: 'Add feature',
        prBody: 'This PR adds a feature',
      });

      expect(result).toContain('PR #123: Add feature');
      expect(result).toContain('PR Description:\nThis PR adds a feature');
    });

    it('should include comment body', () => {
      const result = buildContext({
        repo: 'owner/repo',
        commentBody: '@bot please help',
      });

      expect(result).toContain('Current Comment/Request:\n@bot please help');
    });

    it('should handle missing optional fields', () => {
      const result = buildContext({
        repo: 'owner/repo',
        issueNumber: 42,
      });

      expect(result).toContain('Issue #42: No title');
      expect(result).not.toContain('Issue Description');
    });
  });

  describe('resolveRepoFilePath', () => {
    const repoRoot = '/home/runner/work/repo';

    it('should resolve a relative path inside the repo', () => {
      const result = resolveRepoFilePath(repoRoot, 'src/index.ts');
      expect(result).not.toBeNull();
      expect(result?.relativePath).toBe('src/index.ts');
      expect(result?.resolvedPath).toBe('/home/runner/work/repo/src/index.ts');
    });

    it('should reject empty or whitespace-only paths', () => {
      expect(resolveRepoFilePath(repoRoot, '')).toBeNull();
      expect(resolveRepoFilePath(repoRoot, '   ')).toBeNull();
    });

    it('should reject paths outside the repo', () => {
      expect(resolveRepoFilePath(repoRoot, '../secrets.txt')).toBeNull();
      expect(resolveRepoFilePath(repoRoot, '/etc/passwd')).toBeNull();
    });
  });
});
