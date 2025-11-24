import { K8sManifestUpdater } from './index';
import { parseDocument } from 'yaml';

// Mock dependencies
jest.mock('@restack/action-core', () => ({
  BaseAction: class {
    constructor() { }
    log() { }
    handleError() { }
  },
  core: {
    getInput: () => '',
    getBooleanInput: () => false,
    setOutput: () => { }
  }
}));

jest.mock('@restack/github-app-client', () => ({
  GitHubAppClient: class {
    constructor() { }
    getOctokit() {
      return {
        repos: {
          getContent: jest.fn().mockResolvedValue({ data: {} })
        }
      };
    }
  }
}));

describe('K8sManifestUpdater', () => {
  it('should update nested YAML in helm chart values', () => {
    const manifest = `
apps:
  # Install InfisicalSecret for GitHub Auth
  - name: arc-runners-raw
    namespace: arc-runners

  # Install gha-runner-scale-set chart
  - name: gha-runner-scale-set
    namespace: arc-runners
    helm:
      releaseName: homelab-gh
      values: |
        template:
          spec:
            containers:
              - name: runner
                image: harbor.home.lab/restack/actions-runner:latest
                imagePullPolicy: Always
`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updater = new K8sManifestUpdater({} as any);
    const doc = parseDocument(manifest);

    // Access private method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = (updater as any).updateYamlPath(
      doc,
      'apps[name=gha-runner-scale-set].helm.values',
      'harbor.home.lab/restack/actions-runner:v2',
      'template.spec.containers[name=runner].image'
    );

    expect(updated).toBe(true);

    const newManifest = doc.toString();
    console.log(newManifest);

    // Verify update
    expect(newManifest).toContain('image: harbor.home.lab/restack/actions-runner:v2');

    // Verify comments preserved
    expect(newManifest).toContain('# Install InfisicalSecret for GitHub Auth');
    expect(newManifest).toContain('# Install gha-runner-scale-set chart');
  });

  it('should update landing deployment image in raw chart values', () => {
    const manifest = `
apps:
  - name: landing
    namespace: landing
    project: dev
    syncWave: "0"
    source:
      repoURL: https://bedag.github.io/helm-charts
      chart: raw
      targetRevision: 2.0.2
      helm:
        releaseName: landing
        values: |
          resources:
            - apiVersion: apps/v1
              kind: Deployment
              metadata:
                name: landing
                namespace: landing
              spec:
                replicas: 1
                selector:
                  matchLabels:
                    app: landing
                template:
                  metadata:
                    labels:
                      app: landing
                  spec:
                    containers:
                      - name: landing
                        image: harbor.home.lab/restack/www:latest
                        imagePullPolicy: Always
`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updater = new K8sManifestUpdater({} as any);
    const doc = parseDocument(manifest);

    // Access private method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = (updater as any).updateYamlPath(
      doc,
      'apps[name=landing].source.helm.values',
      'harbor.home.lab/restack/www:main-TEST',
      'resources[kind=Deployment].spec.template.spec.containers[name=landing].image'
    );

    expect(updated).toBe(true);

    const newManifest = doc.toString();
    expect(newManifest).toContain('image: harbor.home.lab/restack/www:main-TEST');
  });
});
