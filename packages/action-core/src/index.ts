import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';

export interface ActionConfig {
  token?: string;
  [key: string]: any;
}

export abstract class BaseAction {
  protected octokit!: Octokit;
  protected context = github.context;

  constructor(protected config: ActionConfig) {
    const token = config.token || process.env.GITHUB_TOKEN;
    if (token) {
      this.octokit = new Octokit({ auth: token });
    }
  }

  abstract run(): Promise<void>;

  protected async handleError(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }

  protected log(message: string): void {
    core.info(message);
  }
}

export { core, github };
