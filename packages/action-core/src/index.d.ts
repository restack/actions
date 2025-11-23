import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';
export interface ActionConfig {
    token?: string;
    [key: string]: any;
}
export declare abstract class BaseAction {
    protected config: ActionConfig;
    protected octokit: Octokit;
    protected context: import("@actions/github/lib/context").Context;
    constructor(config: ActionConfig);
    abstract run(): Promise<void>;
    protected handleError(error: unknown): Promise<void>;
    protected log(message: string): void;
}
export { core, github };
//# sourceMappingURL=index.d.ts.map