"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const yaml = __importStar(require("js-yaml"));
const action_core_1 = require("@restack/action-core");
const github_app_client_1 = require("@restack/github-app-client");
class K8sManifestUpdater extends action_core_1.BaseAction {
    appClient;
    constructor(config) {
        super(config);
        this.appClient = new github_app_client_1.GitHubAppClient({
            appId: config.appId,
            privateKey: config.privateKey,
            installationId: config.installationId
        });
    }
    async run() {
        try {
            const octokit = await this.appClient.getOctokit();
            const config = this.config;
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
                const manifest = yaml.load(content);
                // Update image
                if (manifest?.spec?.template?.spec?.containers?.[0]) {
                    const oldImage = manifest.spec.template.spec.containers[0].image;
                    manifest.spec.template.spec.containers[0].image = config.image;
                    this.log(`Updating image from ${oldImage} to ${config.image}`);
                }
                const updated = yaml.dump(manifest);
                if (config.createPr) {
                    await this.createPullRequest(octokit, owner, repo, file.sha, updated);
                }
                else {
                    await this.directUpdate(octokit, owner, repo, file.sha, updated);
                }
            }
        }
        catch (error) {
            await this.handleError(error);
        }
    }
    async directUpdate(octokit, owner, repo, sha, content) {
        const config = this.config;
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
        action_core_1.core.setOutput('commit_sha', result.data.commit.sha);
        this.log(`✅ Updated manifest with commit ${result.data.commit.sha}`);
    }
    async createPullRequest(octokit, owner, repo, sha, content) {
        // Implementation for PR creation
        this.log('PR creation not yet implemented');
    }
}
// Entry point
async function main() {
    const config = {
        appId: action_core_1.core.getInput('app_id', { required: true }),
        privateKey: action_core_1.core.getInput('private_key', { required: true }),
        installationId: action_core_1.core.getInput('installation_id'),
        image: action_core_1.core.getInput('image', { required: true }),
        manifestRepo: action_core_1.core.getInput('manifest_repo', { required: true }),
        manifestPath: action_core_1.core.getInput('manifest_path') || 'k8s/deployment.yaml',
        branch: action_core_1.core.getInput('branch') || 'main',
        createPr: action_core_1.core.getBooleanInput('create_pr')
    };
    const action = new K8sManifestUpdater(config);
    await action.run();
}
main();
