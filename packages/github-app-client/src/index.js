"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubAppClient = void 0;
const app_1 = require("@octokit/app");
class GitHubAppClient {
    config;
    app;
    constructor(config) {
        this.config = config;
        this.app = new app_1.App({
            appId: Number(config.appId),
            privateKey: config.privateKey,
        });
    }
    async getOctokit() {
        const installationId = Number(this.config.installationId);
        if (!installationId) {
            throw new Error('Installation ID is required');
        }
        return this.app.getInstallationOctokit(installationId);
    }
}
exports.GitHubAppClient = GitHubAppClient;
