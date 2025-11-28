import { BaseAction } from '@restack/action-core';
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
export declare class K8sManifestUpdater extends BaseAction {
    private appClient;
    constructor(config: Config);
    run(): Promise<void>;
    private updateLegacy;
    private directUpdate;
    private createPullRequest;
    private parsePath;
    private updateYamlPath;
    private traverseAndSet;
    private getCommitInfo;
}
export {};
