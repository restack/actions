import * as yaml from 'js-yaml';
import { BaseAction, core } from '@restack/action-core';
import { GitHubAppClient } from '@restack/github-app-client';

interface Config {
  appId: string;
  privateKey: string;
  installationId?: string;
  image: string;
  containerName?: string;
  manifestRepo: string;
  manifestPath: string;
  branch: string;
  createPr: boolean;
}

class K8sManifestUpdater extends BaseAction {
  private appClient: GitHubAppClient;

  constructor(config: Config) {
    super(config);
    this.appClient = new GitHubAppClient({
      appId: config.appId,
      privateKey: config.privateKey,
      installationId: config.installationId
    });
  }

  async run(): Promise<void> {
    try {
      const octokit = await this.appClient.getOctokit();
      const config = this.config as Config;

      // Parse repo owner and name
      const [owner, repo] = config.manifestRepo.split('/');

      // Get current file
      this.log(`Fetching ${config.manifestPath} from ${config.manifestRepo}`);
      const { data: file } = await octokit.repos.getContent({
        owner,
        repo,
        path: config.manifestPath,
        ref: config.branch
      });

      if ('content' in file) {
        // Parse and update YAML
        const content = Buffer.from(file.content, 'base64').toString();
        const manifest = yaml.load(content) as any;

        // Update image
        let updated = false;
        const containers = manifest?.spec?.template?.spec?.containers;

        if (containers && Array.isArray(containers)) {
          if (config.containerName) {
            const container = containers.find((c: any) => c.name === config.containerName);
            if (container) {
              const oldImage = container.image;
              container.image = config.image;
              this.log(`Updating image for container '${config.containerName}' from ${oldImage} to ${config.image}`);
              updated = true;
            } else {
              this.log(`Container '${config.containerName}' not found in manifest`);
            }
          } else if (containers.length > 0) {
            const oldImage = containers[0].image;
            containers[0].image = config.image;
            this.log(`Updating image for first container from ${oldImage} to ${config.image}`);
            updated = true;
          }
        }

        if (!updated) {
          this.log('No containers found or updated');
          return;
        }

        const updatedContent = yaml.dump(manifest);

        if (config.createPr) {
          await this.createPullRequest(octokit, owner, repo, file.sha, updatedContent);
        } else {
          await this.directUpdate(octokit, owner, repo, file.sha, updatedContent);
        }
      }
    } catch (error) {
      await this.handleError(error);
    }
  }

  private async directUpdate(octokit: any, owner: string, repo: string, sha: string, content: string) {
    const config = this.config as Config;
    const imageTag = config.image.split(':').pop() || 'latest';

    const result = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: config.manifestPath,
      message: `🤖 Update image to ${imageTag}`,
      content: Buffer.from(content).toString('base64'),
      sha,
      branch: config.branch
    });

    core.setOutput('commit_sha', result.data.commit.sha);
    this.log(`✅ Updated manifest with commit ${result.data.commit.sha}`);
  }

  private async createPullRequest(octokit: any, owner: string, repo: string, sha: string, content: string) {
    const config = this.config as Config;
    const imageTag = config.image.split(':').pop() || 'latest';
    const branchName = `update-image-${Date.now()}`;

    // Create new branch
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${config.branch}`
    });

    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha
    });

    // Update file in new branch
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: config.manifestPath,
      message: `🤖 Update image to ${imageTag}`,
      content: Buffer.from(content).toString('base64'),
      sha,
      branch: branchName
    });

    // Create PR
    const pr = await octokit.pulls.create({
      owner,
      repo,
      title: `Update image to ${imageTag}`,
      body: `Automated update of container image to \`${config.image}\``,
      head: branchName,
      base: config.branch
    });

    core.setOutput('pr_url', pr.data.html_url);
    this.log(`✅ Created PR: ${pr.data.html_url}`);
  }
}

// Entry point
async function main() {
  const config: Config = {
    appId: core.getInput('app_id', { required: true }),
    privateKey: core.getInput('private_key', { required: true }),
    installationId: core.getInput('installation_id'),
    image: core.getInput('image', { required: true }),
    containerName: core.getInput('container_name'),
    manifestRepo: core.getInput('manifest_repo', { required: true }),
    manifestPath: core.getInput('manifest_path') || 'k8s/deployment.yaml',
    branch: core.getInput('branch') || 'main',
    createPr: core.getBooleanInput('create_pr')
  };

  const action = new K8sManifestUpdater(config);
  await action.run();
}

main();
