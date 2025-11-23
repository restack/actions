import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';

export interface GitHubAppConfig {
  appId: number | string;
  privateKey: string;
  installationId?: number | string;
}

export class GitHubAppClient {
  private app: App;

  constructor(private config: GitHubAppConfig) {
    this.app = new App({
      appId: Number(config.appId),
      privateKey: config.privateKey,
      Octokit: Octokit,
    });
  }

  async getOctokit(): Promise<Octokit> {
    const installationId = Number(this.config.installationId);
    if (!installationId) {
      throw new Error('Installation ID is required');
    }
    return this.app.getInstallationOctokit(installationId) as unknown as Octokit;
  }
}
