import { parseDocument, Document, YAMLSeq, isMap, isSeq } from 'yaml';
import { BaseAction, core } from '@restack/action-core';
import { GitHubAppClient } from '@restack/github-app-client';

interface Config {
  appId: string;
  privateKey: string;
  installationId?: string;
  image: string;
  yamlPath?: string;
  nestedYamlPath?: string;
  containerName?: string;
  manifestRepo: string;
  manifestPath: string;
  branch: string;
  createPr: boolean;
}

export class K8sManifestUpdater extends BaseAction {
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
        // Parse YAML preserving comments
        const content = Buffer.from(file.content, 'base64').toString();
        const doc = parseDocument(content);

        let updated = false;

        if (config.yamlPath) {
          updated = this.updateYamlPath(doc, config.yamlPath, config.image, config.nestedYamlPath);
        } else {
          // Legacy behavior
          updated = this.updateLegacy(doc, config.image, config.containerName);
        }

        if (!updated) {
          this.log('No changes made to manifest');
          return;
        }

        const updatedContent = doc.toString();

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

  private updateLegacy(doc: Document, image: string, containerName?: string): boolean {
    const containers = doc.getIn(['spec', 'template', 'spec', 'containers']) as YAMLSeq;

    if (containers && isSeq(containers)) {
      if (containerName) {
        for (const item of containers.items) {
          if (isMap(item) && item.get('name') === containerName) {
            const oldImage = item.get('image');
            item.set('image', image);
            this.log(`Updating image for container '${containerName}' from ${oldImage} to ${image}`);
            return true;
          }
        }
        this.log(`Container '${containerName}' not found in manifest`);
      } else if (containers.items.length > 0) {
        const first = containers.items[0];
        if (isMap(first)) {
          const oldImage = first.get('image');
          first.set('image', image);
          this.log(`Updating image for first container from ${oldImage} to ${image}`);
          return true;
        }
      }
    }
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async directUpdate(octokit: any, owner: string, repo: string, sha: string, content: string) {
    const config = this.config as Config;
    const { scope, imageTag, imageName } = this.getCommitInfo();

    const message = scope
      ? `ci(${scope}): update ${imageName} to ${imageTag}`
      : `ci: update ${imageName} to ${imageTag}`;

    const result = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: config.manifestPath,
      message,
      content: Buffer.from(content).toString('base64'),
      sha,
      branch: config.branch
    });

    core.setOutput('commit_sha', result.data.commit.sha);
    this.log(`✅ Updated manifest with commit ${result.data.commit.sha}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async createPullRequest(octokit: any, owner: string, repo: string, sha: string, content: string) {
    const config = this.config as Config;
    const { scope, imageTag, imageName } = this.getCommitInfo();

    const message = scope
      ? `ci(${scope}): update ${imageName} to ${imageTag}`
      : `ci: update ${imageName} to ${imageTag}`;

    const branchName = scope
      ? `update-${scope}-${imageTag}`
      : `update-image-${Date.now()}`;

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
      message,
      content: Buffer.from(content).toString('base64'),
      sha,
      branch: branchName
    });

    // Create PR
    const pr = await octokit.pulls.create({
      owner,
      repo,
      title: `chore: update image to ${imageTag}`,
      body: `Automated update of container image to \`${config.image}\``,
      head: branchName,
      base: config.branch
    });

    core.setOutput('pr_url', pr.data.html_url);
    this.log(`✅ Created PR: ${pr.data.html_url}`);
  }

  private parsePath(path: string): PathPart[] {
    // Split by dot, but ignore dots in brackets (not implemented for simplicity yet)
    return path.split('.').map(p => {
      const match = p.match(/^(\w+)\[(\w+)=(.+)\]$/);
      if (match) {
        return { key: match[1], selector: { key: match[2], value: match[3] } };
      }
      return { key: p };
    });
  }

  private updateYamlPath(doc: Document, path: string, newValue: string, nestedPath?: string): boolean {
    const parts = this.parsePath(path);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.traverseAndSet(doc.contents as any, parts, newValue, nestedPath);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private traverseAndSet(node: any, parts: PathPart[], newValue: string, nestedPath?: string): boolean {
    if (parts.length === 0) return false;
    const part = parts[0];
    const isLast = parts.length === 1;

    if (isMap(node)) {
      // 1. Get the value for the key
      let value = node.get(part.key);

      // 2. If there is a selector, we expect 'value' to be a Seq
      if (part.selector) {
        if (isSeq(value)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const found = value.items.find((item: any) =>
            isMap(item) && item.get(part.selector!.key) === part.selector!.value
          );
          if (found) {
            value = found;
          } else {
            this.log(`Could not find item in array for key '${part.key}' with selector '${part.selector.key}=${part.selector.value}'`);
            return false;
          }
        } else {
          this.log(`Expected a sequence for key '${part.key}' but found ${typeof value}`);
          return false;
        }
      }

      // 3. If this is the last part
      if (isLast) {
        if (nestedPath) {
          // Value should be a string (Helm values)
          if (typeof value === 'string') {
            const nestedDoc = parseDocument(value);
            const nestedUpdated = this.updateYamlPath(nestedDoc, nestedPath, newValue);
            if (nestedUpdated) {
              node.set(part.key, nestedDoc.toString());
              this.log(`Updated nested path '${nestedPath}' within '${part.key}' to '${newValue}'`);
              return true;
            }
          }
          this.log(`Expected a string value for key '${part.key}' to parse nested YAML, but found ${typeof value}`);
          return false;
        } else {
          // Direct update
          const oldValue = node.get(part.key);
          node.set(part.key, newValue);
          this.log(`Updated '${part.key}' from '${oldValue}' to '${newValue}'`);
          return true;
        }
      }

      // 4. Recurse
      return this.traverseAndSet(value, parts.slice(1), newValue, nestedPath);
    }

    this.log(`Expected a map for path part '${part.key}' but found ${typeof node}`);
    return false;
  }

  private getCommitInfo(): { scope: string; imageTag: string; imageName: string } {
    const config = this.config as Config;

    const imageParts = config.image.split(':');
    const imageTag = imageParts.pop() || 'latest';
    const imagePath = imageParts.join(':');
    const imageName = imagePath.split('/').pop() || 'unknown';

    let scope = '';
    if (config.yamlPath) {
      const match = config.yamlPath.match(/\[name=([^\]]+)\]/);
      if (match) scope = match[1];
    }

    if (!scope && config.containerName) {
      scope = config.containerName;
    }

    if (!scope) {
      scope = config.manifestPath.split('/').pop()?.replace('.yaml', '') || '';
    }

    return { scope, imageTag, imageName };
  }
}

interface PathPart {
  key: string;
  selector?: {
    key: string;
    value: string;
  };
}

// Entry point
new K8sManifestUpdater({
  appId: core.getInput('app_id'),
  privateKey: core.getInput('private_key'),
  installationId: core.getInput('installation_id'),
  image: core.getInput('image'),
  yamlPath: core.getInput('yaml_path'),
  nestedYamlPath: core.getInput('nested_yaml_path'),
  containerName: core.getInput('container_name'),
  manifestRepo: core.getInput('manifest_repo'),
  manifestPath: core.getInput('manifest_path') || 'k8s/deployment.yaml',
  branch: core.getInput('branch') || 'main',
  createPr: core.getBooleanInput('create_pr')
}).run();
