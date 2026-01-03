import * as core from '@actions/core';
import { Octokit } from '@octokit/rest';
import { GitHubAppClient } from '@restack/github-app-client';
import { glob } from 'glob';
import * as fs from 'fs/promises';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { execSync } from 'child_process';
import LLMClient, { MessageFormat } from './llm-client';
import {
  buildContext,
  detectAndTruncateRepetition,
  FileAction,
  looksLikeUnifiedDiff,
  resolveRepoFilePath,
  tryParseActionResponse,
  validateYAMLNoDuplicateKeys,
} from './utils';

/**
 * Get Octokit instance from either GitHub token or GitHub App credentials
 */
async function getOctokit(inputs: {
  githubToken?: string;
  appId?: string;
  privateKey?: string;
  installationId?: string;
}): Promise<Octokit | null> {
  const { githubToken, appId, privateKey, installationId } = inputs;

  // Prefer GitHub App authentication if provided
  if (appId && privateKey) {
    core.info('Using GitHub App authentication');
    const appClient = new GitHubAppClient({
      appId,
      privateKey,
      installationId,
    });
    return await appClient.getOctokit();
  }

  // Fall back to token authentication
  if (githubToken) {
    core.info('Using GitHub token authentication');
    return new Octokit({ auth: githubToken });
  }

  return null;
}

type FilesMap = Record<string, string>;

async function collectFiles(globInput?: string): Promise<string[]> {
  if (!globInput) return [];
  // allow comma separated
  const patterns = globInput
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const matches = new Set<string>();
  for (const p of patterns) {
    const found = await glob(p, { nodir: true });
    for (const f of found) matches.add(f);
  }
  return Array.from(matches);
}

async function readFilesAsMap(paths: string[]): Promise<FilesMap> {
  const out: FilesMap = {};
  for (const p of paths) {
    try {
      const content = await fs.readFile(p, 'utf8');
      out[p] = content;
    } catch (e: unknown) {
      const err = e as Error;
      core.warning(`Failed to read file ${p}: ${err?.message ?? e}`);
    }
  }
  return out;
}

/**
 * Configure git user identity
 */
async function configureGitIdentity(git: SimpleGit, botName: string): Promise<void> {
  await git.addConfig('user.name', `${botName}[bot]`);
  await git.addConfig('user.email', `${botName}[bot]@users.noreply.github.com`);
}

/**
 * Check if a PR already exists for the given branch
 */
async function findExistingPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  head: string
): Promise<{ url: string; number: number } | null> {
  try {
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      head: `${owner}:${head}`,
      state: 'open',
    });
    if (prs.length > 0) {
      return { url: prs[0].html_url, number: prs[0].number };
    }
  } catch (e: unknown) {
    const err = e as Error;
    core.warning(`Failed to check for existing PR: ${err?.message ?? e}`);
  }
  return null;
}

type PatchFileBlock = {
  raw: string;
  filePath: string | null;
  isNewFile: boolean;
};

function stripNonDiffPrefix(patchText: string): string {
  const lines = patchText.split(/\r?\n/);
  const firstDiff = lines.findIndex((line) => line.startsWith('diff --git '));
  if (firstDiff === -1) {
    return patchText;
  }
  return lines.slice(firstDiff).join('\n');
}

function splitPatchBlocks(patchText: string): PatchFileBlock[] {
  const lines = patchText.split(/\r?\n/);
  const blocks: PatchFileBlock[] = [];
  let current: string[] = [];
  let seenDiff = false;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current.length) {
        blocks.push(buildPatchBlock(current));
      }
      current = [line];
      seenDiff = true;
      continue;
    }
    if (!seenDiff) {
      continue;
    }
    current.push(line);
  }

  if (current.length) {
    blocks.push(buildPatchBlock(current));
  }

  if (!seenDiff) {
    return [{ raw: patchText, filePath: null, isNewFile: false }];
  }

  return blocks;
}

function buildPatchBlock(lines: string[]): PatchFileBlock {
  const raw = lines.join('\n');
  const match = raw.match(/^diff --git a\/(.+?) b\/(.+)$/m);
  const filePath = match ? match[2].trim() : null;
  const isNewFile = /^new file mode /m.test(raw) || /^--- \/dev\/null$/m.test(raw);
  return { raw, filePath, isNewFile };
}

function extractNewFileContent(block: PatchFileBlock): { content: string; truncated: boolean } {
  const lines = block.raw.split(/\r?\n/);
  const contentLines: string[] = [];
  let hasNoNewline = false;

  for (const line of lines) {
    if (
      line.startsWith('diff --git ') ||
      line.startsWith('new file mode ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('@@')
    ) {
      continue;
    }
    if (line === '\\ No newline at end of file') {
      hasNoNewline = true;
      continue;
    }
    if (line.startsWith('+')) {
      contentLines.push(line.slice(1));
    }
  }

  let content = contentLines.join('\n');
  if (!hasNoNewline && contentLines.length > 0) {
    content += '\n';
  }

  // Detect and truncate repetitive content in extracted file content
  let truncated = false;
  if (block.filePath && (block.filePath.endsWith('.yaml') || block.filePath.endsWith('.yml'))) {
    const repetitionCheck = detectAndTruncateRepetition(content, 30, 2);
    if (repetitionCheck.truncated) {
      core.warning(`Detected repetitive content in diff for ${block.filePath}: ${repetitionCheck.pattern}`);
      content = repetitionCheck.content;
      truncated = true;
    }
  }

  return { content, truncated };
}

async function applyNewFileBlocksForExistingFiles(
  patchText: string,
  repoRoot: string,
  git: SimpleGit
): Promise<{ remainingPatch: string; appliedFiles: string[]; truncatedFiles: string[] }> {
  const blocks = splitPatchBlocks(patchText);
  const kept: string[] = [];
  const appliedFiles: string[] = [];
  const truncatedFiles: string[] = [];

  for (const block of blocks) {
    if (!block.filePath || !block.isNewFile) {
      kept.push(block.raw);
      continue;
    }

    const absolutePath = path.join(repoRoot, block.filePath);
    let exists = false;
    try {
      await fs.access(absolutePath);
      exists = true;
    } catch {
      exists = false;
    }

    // For new files (not existing), also extract and apply with repetition detection
    const { content, truncated } = extractNewFileContent(block);

    if (truncated) {
      truncatedFiles.push(block.filePath);
    }

    if (!exists) {
      // For new files, write directly instead of using git apply (to apply repetition fix)
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
      await git.add(block.filePath);
      appliedFiles.push(block.filePath);
      continue;
    }

    // For existing files, also write directly
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
    await git.add(block.filePath);
    appliedFiles.push(block.filePath);
  }

  return { remainingPatch: kept.join('\n'), appliedFiles, truncatedFiles };
}

/**
 * Execute file actions from LLM response
 */
async function executeFileActions(
  actions: FileAction[],
  git: SimpleGit,
  repoRoot: string
): Promise<number> {
  let changesCount = 0;

  for (const action of actions) {
    const safePath = resolveRepoFilePath(repoRoot, action.path);
    if (!safePath) {
      core.warning(`Skipping ${action.type} for invalid path: ${action.path}`);
      continue;
    }

    const { resolvedPath, relativePath } = safePath;

    switch (action.type) {
      case 'delete':
        try {
          await fs.access(resolvedPath);
          await git.rm(relativePath);
          core.info(`Deleted: ${relativePath}`);
          changesCount++;
        } catch {
          core.warning(`File to delete not found: ${relativePath}`);
        }
        break;

      case 'create':
      case 'modify': {
        if (!action.content) {
          core.warning(`No content provided for ${action.type} action on ${relativePath}`);
          continue;
        }

        let contentToWrite = action.content;

        // For YAML files, detect and handle repetition issues
        if (relativePath.endsWith('.yaml') || relativePath.endsWith('.yml')) {
          // First, detect and truncate repetitive content (LLM repetition loop)
          const repetitionCheck = detectAndTruncateRepetition(contentToWrite, 50, 2);
          if (repetitionCheck.truncated) {
            core.warning(`Detected repetitive content in ${relativePath}: ${repetitionCheck.pattern}`);
            core.warning('Content was truncated to remove repetition. This indicates an LLM issue.');
            contentToWrite = repetitionCheck.content;
          }

          // Then validate for duplicate YAML keys
          const validationError = validateYAMLNoDuplicateKeys(contentToWrite);
          if (validationError) {
            core.warning(`YAML validation failed for ${relativePath}: ${validationError}`);
            core.warning('Skipping file due to duplicate keys. LLM must fix this issue.');
            continue;
          }
        }

        try {
          const dir = path.dirname(resolvedPath);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(resolvedPath, contentToWrite, 'utf8');
          await git.add(relativePath);
          core.info(`${action.type === 'create' ? 'Created' : 'Modified'}: ${relativePath}`);
          changesCount++;
        } catch (e: unknown) {
          const err = e as Error;
          core.warning(`Failed to ${action.type} ${relativePath}: ${err?.message ?? e}`);
        }
        break;
      }
    }
  }

  return changesCount;
}

/**
 * Post a comment on an issue or PR
 */
async function postComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  try {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    core.info(`Posted comment on issue/PR #${issueNumber}`);
  } catch (e: unknown) {
    const err = e as Error;
    core.warning(`Failed to post comment: ${err?.message ?? e}`);
  }
}

/**
 * Build context string from issue/PR information
 */
async function hasStagedChanges(git: SimpleGit): Promise<boolean> {
  const staged = await git.diff(['--cached', '--name-only']);
  return staged.trim().length > 0;
}

async function run(): Promise<void> {
  try {
    // Required inputs
    const llmUrl = core.getInput('llm_url', { required: true });

    // Optional inputs
    const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
    const apiKey = core.getInput('api_key') || undefined;
    const model = core.getInput('model') || undefined;
    const promptInput = core.getInput('prompt');
    const promptFile = core.getInput('prompt_file');
    const filesInput = core.getInput('files');
    const includePatch = core.getInput('include_patch') === 'true';
    const maxTokensInput = core.getInput('max_tokens');
    const maxTokens = maxTokensInput ? Number(maxTokensInput) : undefined;
    const timeoutInput = core.getInput('timeout_ms');
    const timeoutMs = timeoutInput ? Number(timeoutInput) : 300000;
    const temperatureInput = core.getInput('temperature');
    const temperature = temperatureInput ? Number(temperatureInput) : 0.1;
    const format = (core.getInput('format') || 'auto') as MessageFormat;

    // Commit/PR options
    const commit = core.getInput('commit') === 'true';
    const commitMessage = core.getInput('commit_message') || 'Apply changes suggested by restack-code';
    const createPr = core.getInput('create_pr') === 'true';
    const prTitle = core.getInput('pr_title') || 'chore: Apply LLM suggested changes';
    const prBody = core.getInput('pr_body') || 'This PR contains changes suggested by restack-code.';
    const branch = core.getInput('branch') || 'restack/llm-suggestions';
    const baseBranch = core.getInput('base_branch') || 'main';
    const botName = core.getInput('bot_name') || 'restack-code';
    const githubToken = core.getInput('github_token') || process.env.GITHUB_TOKEN;

    // GitHub App authentication inputs
    const appId = core.getInput('app_id') || undefined;
    const privateKey = core.getInput('private_key') || undefined;
    const installationId = core.getInput('installation_id') || undefined;

    // Context injection inputs
    const issueNumberInput = core.getInput('issue_number');
    const issueNumber = issueNumberInput ? Number(issueNumberInput) : undefined;
    const issueTitle = core.getInput('issue_title') || undefined;
    const issueBody = core.getInput('issue_body') || undefined;
    const prNumberInput = core.getInput('pr_number');
    const prNumber = prNumberInput ? Number(prNumberInput) : undefined;
    const prTitleInput = core.getInput('pr_title_context') || undefined;
    const prBodyInput = core.getInput('pr_body_context') || undefined;
    const commentBody = core.getInput('comment_body') || undefined;
    const postCommentOnComplete = core.getInput('post_comment') === 'true';

    // Event context inputs
    const eventName = core.getInput('event_name') || process.env.GITHUB_EVENT_NAME || '';
    const reviewCommentPath = core.getInput('review_comment_path') || undefined;
    const reviewCommentLine = core.getInput('review_comment_line') || undefined;
    const prHeadRef = core.getInput('pr_head_ref') || undefined;
    const prBaseRef = core.getInput('pr_base_ref') || undefined;

    // For pull_request_review_comment, auto-adjust settings
    const isPRReviewComment = eventName === 'pull_request_review_comment';
    if (isPRReviewComment) {
      core.info('Detected pull_request_review_comment event - will push to existing PR branch');
    }

    // Build prompt
    let prompt = promptInput || '';
    if (promptFile) {
      try {
        const resolved = path.resolve(repoRoot, promptFile);
        prompt = await fs.readFile(resolved, 'utf8');
      } catch (e: unknown) {
        const err = e as Error;
        core.setFailed(`Failed to read prompt_file ${promptFile}: ${err?.message ?? e}`);
        return;
      }
    }

    // Collect files
    const filePaths = await collectFiles(filesInput);
    const filesMap = await readFilesAsMap(filePaths);

    // Include patch context if requested
    const git = simpleGit(repoRoot);
    if (includePatch && filePaths.length > 0) {
      try {
        const diff = await git.diff(['HEAD', '--', ...filePaths]);
        if (diff) {
          filesMap['__git_diff__'] = diff;
        }
      } catch (e: unknown) {
        const err = e as Error;
        core.warning(`Failed to produce git diff: ${err?.message ?? e}`);
      }
    }

    // Create LLM client
    const client = new LLMClient({
      llmUrl,
      apiKey,
      model,
      maxTokens,
      timeoutMs,
      temperature,
      format,
    });

    // Build context header
    const repo = process.env.GITHUB_REPOSITORY || '';
    const contextHeader = buildContext({
      issueNumber,
      issueTitle,
      issueBody,
      prNumber,
      prTitle: prTitleInput,
      prBody: prBodyInput,
      commentBody,
      repo,
      eventName,
      reviewCommentPath,
      reviewCommentLine,
    });

    const filesHeader = Object.keys(filesMap).length > 0 ? `\nFiles included: ${Object.keys(filesMap).length}\n` : '';

    const finalPrompt = contextHeader + filesHeader + '\n' + prompt;

    core.info('Sending prompt to LLM...');
    const llmResponse = await client.sendPrompt(finalPrompt, filesMap);
    core.info('Received response from LLM.');
    core.setOutput('llm_response', llmResponse);

    // Initialize octokit with either GitHub App or token authentication
    const [owner, repoName] = repo.split('/');
    const octokit = await getOctokit({ githubToken, appId, privateKey, installationId });

    // Try to parse as structured JSON response first
    const actionResponse = tryParseActionResponse(llmResponse);

    if (commit) {
      // Configure git identity
      await configureGitIdentity(git, botName);

      let hasChanges = false;
      let finalCommitMessage = commitMessage;
      let finalPrTitle = prTitle;
      let finalPrBody = prBody;
      let analysis = '';

      if (actionResponse && actionResponse.actions && actionResponse.actions.length > 0) {
        // Handle structured JSON response with file actions
        core.info('Detected structured JSON response with file actions.');

        analysis = actionResponse.analysis || '';
        // Workflow-provided values take precedence over LLM-generated ones
        // This ensures consistent PR titles like "fix: Issue #123" instead of generic "fix issues"
        finalCommitMessage = commitMessage || actionResponse.commit_message || 'Apply changes suggested by restack-code';
        finalPrTitle = prTitle || actionResponse.pr_title || 'chore: Apply LLM suggested changes';
        finalPrBody = prBody || actionResponse.pr_body || 'This PR contains changes suggested by restack-code.';

        // Determine the target branch
        // For PR review comments, use the PR's head branch; otherwise use the configured branch
        const targetBranch = isPRReviewComment && prHeadRef ? prHeadRef : branch;
        const targetBaseBranch = isPRReviewComment && prBaseRef ? prBaseRef : baseBranch;

        // For PR review comments, we're already on the right branch (checked out by workflow)
        // Just need to ensure we're on the correct branch
        if (isPRReviewComment && prHeadRef) {
          core.info(`PR review comment: using existing PR branch '${prHeadRef}'`);
          try {
            // Ensure we're on the PR branch
            const currentBranch = (await git.branch()).current;
            if (currentBranch !== prHeadRef) {
              await git.fetch(['origin', prHeadRef]);
              await git.checkout(prHeadRef);
            }
          } catch (e) {
            core.warning(`Failed to checkout PR branch ${prHeadRef}: ${e}`);
          }
        } else {
          // Check for existing branch and handle accordingly
          const existingPR = octokit ? await findExistingPR(octokit, owner, repoName, targetBranch) : null;

          if (existingPR) {
            core.info(`Found existing PR: ${existingPR.url}`);
            // Fetch and checkout existing branch
            try {
              await git.fetch(['origin', targetBranch]);
              await git.checkout(targetBranch);
              await git.pull('origin', targetBranch, ['--rebase']);
            } catch {
              core.warning(`Failed to checkout existing branch, will create new`);
              await git.checkoutLocalBranch(targetBranch);
            }
          } else {
            // Create new branch, force delete if exists locally
            try {
              await git.branch(['-D', targetBranch]);
            } catch {
              // Branch doesn't exist locally, that's fine
            }
            await git.checkoutLocalBranch(targetBranch);
          }
        }

        // Execute file actions
        const changesCount = await executeFileActions(actionResponse.actions, git, repoRoot);
        hasChanges = await hasStagedChanges(git);

        if (!hasChanges && changesCount > 0) {
          core.warning('File actions were executed but produced no staged changes.');
        }

        if (hasChanges) {
          // Add issue reference to commit message (skip for PR review comments as it's already linked)
          const issueRef = issueNumber && !isPRReviewComment ? `\n\nCloses #${issueNumber}` : '';
          const fullCommitMessage = `${finalCommitMessage}${issueRef}\n\n✨ Generated by ${botName}`;

          await git.commit(fullCommitMessage);

          // Force push to handle diverged branches
          try {
            await git.push('origin', targetBranch, ['-u', '--force-with-lease']);
          } catch {
            // If force-with-lease fails, try regular force (for new branches)
            await git.push('origin', targetBranch, ['-u', '-f']);
          }

          const sha = await git.revparse(['HEAD']);
          core.setOutput('commit_sha', sha);
          core.info(`Committed changes: ${sha}`);
        }

        let prUrl = '';

        // For PR review comments, skip PR creation (we're pushing to existing PR branch)
        const shouldCreatePR = createPr && !isPRReviewComment;

        if (hasChanges && shouldCreatePR && octokit) {
          const existingPRCheck = await findExistingPR(octokit, owner, repoName, targetBranch);

          if (existingPRCheck) {
            prUrl = existingPRCheck.url;
            core.setOutput('pr_url', prUrl);
            core.info(`Updated existing PR: ${prUrl}`);
            core.setOutput('summary', 'Applied file actions and updated existing PR.');
          } else {
            try {
              const issueRef = issueNumber ? `\n\nCloses #${issueNumber}` : '';
              const pr = await octokit.pulls.create({
                owner,
                repo: repoName,
                title: finalPrTitle,
                body: `## Analysis\n\n${analysis}\n\n## Changes\n\n${finalPrBody}${issueRef}\n\n---\n✨ *Generated by ${botName}*`,
                head: targetBranch,
                base: targetBaseBranch,
              });
              prUrl = pr.data.html_url;
              core.setOutput('pr_url', prUrl);
              core.info(`PR created: ${prUrl}`);
              core.setOutput('summary', 'Applied file actions and created PR.');
            } catch (e: unknown) {
              const err = e as Error;
              core.warning(`Failed to create PR: ${err?.message ?? e}`);
              core.setOutput('summary', 'Applied file actions but failed to create PR.');
            }
          }
        } else if (hasChanges && isPRReviewComment) {
          core.setOutput('summary', 'Applied file actions and pushed to existing PR branch.');
        } else if (hasChanges) {
          core.setOutput('summary', 'Applied file actions and pushed commit.');
        } else {
          core.setOutput('summary', 'No file changes were applied.');
        }

        // Post comment on issue if requested
        if (postCommentOnComplete && octokit && issueNumber) {
          const prLine = prUrl
            ? `**PR: ${prUrl}**`
            : createPr
              ? '**PR not created**'
              : '**PR creation disabled**';
          const commentBodyText = hasChanges
            ? `## 🔍 Analysis\n\n${analysis}\n\n${prLine}\n\n---\n*Powered by ${model || 'local LLM'}*`
            : `## 🔍 Analysis\n\n${analysis}\n\nNo changes were needed or the requested files were not found.\n\n---\n*Powered by ${model || 'local LLM'}*`;

          await postComment(octokit, owner, repoName, issueNumber, commentBodyText);
        }
      } else if (looksLikeUnifiedDiff(llmResponse)) {
        // Handle unified diff response
        core.info('LLM response looks like a patch. Applying patch...');
        const tmpPatchPath = path.join(repoRoot, 'llm_suggested.patch');
        const patchText = stripNonDiffPrefix(llmResponse);

        try {
          // Handle branch creation/checkout
          const existingPR = octokit ? await findExistingPR(octokit, owner, repoName, branch) : null;

          if (existingPR) {
            try {
              await git.fetch(['origin', branch]);
              await git.checkout(branch);
              await git.pull('origin', branch, ['--rebase']);
            } catch {
              await git.checkoutLocalBranch(branch);
            }
          } else {
            try {
              await git.branch(['-D', branch]);
            } catch {
              // ignore
            }
            await git.checkoutLocalBranch(branch);
          }

          const { remainingPatch, appliedFiles, truncatedFiles } = await applyNewFileBlocksForExistingFiles(
            patchText,
            repoRoot,
            git
          );
          if (appliedFiles.length > 0) {
            core.info(`Applied files from patch: ${appliedFiles.join(', ')}`);
          }
          if (truncatedFiles.length > 0) {
            core.warning(`Truncated repetitive content in files: ${truncatedFiles.join(', ')}`);
          }

          if (remainingPatch.trim()) {
            await fs.writeFile(tmpPatchPath, remainingPatch, 'utf8');
            // Apply patch and update index
            execSync(`git apply --index ${JSON.stringify(tmpPatchPath)}`, { stdio: 'inherit' });
          } else {
            core.info('Patch contained only new-file blocks that already existed.');
          }

          const stagedAfterPatch = await hasStagedChanges(git);
          if (!stagedAfterPatch) {
            core.warning('Patch applied but no staged changes were detected.');
            core.setOutput('summary', 'No changes after applying patch.');
            return;
          }

          await git.commit(commitMessage);

          try {
            await git.push('origin', branch, ['-u', '--force-with-lease']);
          } catch {
            await git.push('origin', branch, ['-u', '-f']);
          }

          const sha = await git.revparse(['HEAD']);
          core.setOutput('commit_sha', sha);
          core.info(`Committed changes: ${sha}`);
          hasChanges = true;

          // Create PR if requested
          if (createPr && octokit) {
            const existingPRCheck = await findExistingPR(octokit, owner, repoName, branch);

            if (existingPRCheck) {
              core.setOutput('pr_url', existingPRCheck.url);
              core.info(`Updated existing PR: ${existingPRCheck.url}`);
            } else {
              try {
                const pr = await octokit.pulls.create({
                  owner,
                  repo: repoName,
                  title: prTitle,
                  body: prBody,
                  head: branch,
                  base: baseBranch,
                });
                core.setOutput('pr_url', pr.data.html_url);
                core.info(`PR created: ${pr.data.html_url}`);
              } catch (e: unknown) {
                const err = e as Error;
                core.warning(`Failed to create PR: ${err?.message ?? e}`);
              }
            }
          }

          core.setOutput('summary', 'Applied patch and pushed commit.');
        } catch (e: unknown) {
          const err = e as Error;
          core.setFailed(`Failed to apply patch or push changes: ${err?.message ?? e}`);
        } finally {
          try {
            await fs.unlink(tmpPatchPath);
          } catch {
            // ignore
          }
        }
      } else {
        core.warning('Commit requested but LLM response is neither JSON actions nor unified diff. No changes applied.');

        // Log partial response for debugging (first 500 chars)
        const truncatedResponse = llmResponse.length > 500 ? llmResponse.slice(0, 500) + '...' : llmResponse;
        core.info(`LLM response preview: ${truncatedResponse}`);

        // Check if it looks like JSON but failed to parse
        if (llmResponse.includes('"actions"') || llmResponse.includes('"analysis"')) {
          core.warning('Response contains JSON-like structure but failed to parse. Check for syntax errors in the response.');
        }

        core.setOutput('summary', 'No actionable response found from LLM.');

        // Still post analysis comment if we have one
        if (postCommentOnComplete && octokit && issueNumber) {
          // Try to extract just the analysis part if possible
          const analysisMatch = llmResponse.match(/"analysis"\s*:\s*"([^"]+)"/);
          const analysis = analysisMatch ? analysisMatch[1] : null;

          const commentBodyText = analysis
            ? `## 🔍 Analysis\n\n${analysis}\n\n⚠️ *Note: Full response could not be parsed as valid JSON. No file changes were applied.*\n\n---\n*Powered by ${model || 'local LLM'}*`
            : `## 💬 Response\n\n${llmResponse}\n\n---\n*Powered by ${model || 'local LLM'}*`;

          await postComment(octokit, owner, repoName, issueNumber, commentBodyText);
        }
      }
    } else {
      core.info('commit=false, skipping applying any changes.');
      core.setOutput('summary', 'LLM returned suggestions (not applied).');

      // Post comment with analysis if requested
      if (postCommentOnComplete && octokit && issueNumber) {
        const actionResp = tryParseActionResponse(llmResponse);
        const analysis = actionResp?.analysis || llmResponse;
        await postComment(
          octokit,
          owner,
          repoName,
          issueNumber,
          `## 🔍 Analysis\n\n${analysis}\n\n---\n*Powered by ${model || 'local LLM'}*`
        );
      }
    }
  } catch (error: unknown) {
    const err = error as Error;
    core.setFailed(err?.message ?? String(error));
  }
}

run();
