import { Octokit } from '@octokit/rest';
export interface GitHubAppConfig {
    appId: number | string;
    privateKey: string;
    installationId?: number | string;
}
export declare class GitHubAppClient {
    private config;
    private app;
    constructor(config: GitHubAppConfig);
    getOctokit(): Promise<Octokit>;
}
//# sourceMappingURL=index.d.ts.map