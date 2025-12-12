import { K8sManifestUpdater } from './index';
import { parseDocument } from 'yaml';

type UpdaterConfig = {
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
};

type PrivateUpdater = {
  updateYamlPath: (
    doc: ReturnType<typeof parseDocument>,
    path: string,
    newValue: string,
    nestedPath?: string
  ) => boolean;
  directUpdate: (
    octokit: {
      repos: {
        createOrUpdateFileContents: jest.Mock<Promise<{ data: { commit: { sha: string } } }>, [unknown]>;
      };
    },
    owner: string,
    repo: string,
    sha: string,
    content: string
  ) => Promise<void>;
};

const createUpdater = (overrides: Partial<UpdaterConfig> = {}): PrivateUpdater => {
  const baseConfig: UpdaterConfig = {
    appId: '1',
    privateKey: 'key',
    image: 'image:tag',
    manifestRepo: 'owner/repo',
    manifestPath: 'manifest.yaml',
    branch: 'main',
    createPr: false
  };

  return new K8sManifestUpdater({ ...baseConfig, ...overrides }) as unknown as PrivateUpdater;
};

// Mock dependencies
jest.mock('@restack/action-core', () => ({
  BaseAction: class {
    protected config: unknown;
    constructor(config: unknown) {
      this.config = config;
    }
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
    const updater = createUpdater();
    const doc = parseDocument(manifest);

    // Access private method
    const updated = updater.updateYamlPath(
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

    const updater = createUpdater();
    const doc = parseDocument(manifest);

    // Access private method
    const updated = updater.updateYamlPath(
      doc,
      'apps[name=landing].source.helm.values',
      'harbor.home.lab/restack/www:main-TEST',
      'resources[kind=Deployment].spec.template.spec.containers[name=landing].image'
    );

    expect(updated).toBe(true);

    const newManifest = doc.toString();
    expect(newManifest).toContain('image: harbor.home.lab/restack/www:main-TEST');
  });

  it('should mark commit message as image update when nested yaml path is provided', async () => {
    const updater = createUpdater({
      image: 'restack/deepfx:main-a6d6193',
      yamlPath: 'apps[name=deepfx].source.helm.values',
      nestedYamlPath: 'apps[name=deepfx].image.tag',
      manifestPath: 'platform/stacks/05-workloads/overlays/home/deepfx.yaml'
    });

    const mockOctokit = {
      repos: {
        createOrUpdateFileContents: jest.fn().mockResolvedValue({ data: { commit: { sha: 'sha' } } })
      }
    };

    await updater.directUpdate(mockOctokit, 'owner', 'repo', 'file-sha', 'content');

    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'ci(deepfx): update image deepfx to main-a6d6193'
      })
    );
  });

  it('should mark commit message as helm update when targetRevision is updated', async () => {
    const updater = createUpdater({
      image: 'main-a6d6193',
      yamlPath: 'apps[name=deepfx].source.targetRevision',
      manifestPath: 'platform/stacks/05-workloads/overlays/home/deepfx.yaml'
    });

    const mockOctokit = {
      repos: {
        createOrUpdateFileContents: jest.fn().mockResolvedValue({ data: { commit: { sha: 'sha' } } })
      }
    };

    await updater.directUpdate(mockOctokit, 'owner', 'repo', 'file-sha', 'content');

    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'ci(deepfx): update helm to main-a6d6193'
      })
    );
  });
});
