import * as tl from "azure-pipelines-task-lib/task";
import * as util from "util";

const matchPatternForImageName = new RegExp(/\:\/\/(.+?)\@/);
const matchPatternForDigest = new RegExp(/\@sha256\:(.+)/);
const matchPatternForFileArgument = new RegExp(/-f\s|-filename\s/);
const matchPatternForServerUrl = new RegExp(/https\:\/\/(.+)/);
const orgUrl = tl.getVariable('System.TeamFoundationCollectionUri');
const build = "build";
const hostType = tl.getVariable("System.HostType").toLowerCase();
const isBuild = hostType === build;
const deploymentTypes: string[] = ["deployment", "replicaset", "daemonset", "pod", "statefulset"];

// ToDo: Add UTs for public methods
export function getDeploymentMetadata(deploymentObject: any, allPods: any, deploymentStrategy: string, clusterInfo: any, manifestFilePaths?: string[]): any {
    let imageIds: string[] = [];
    let kind: string = deploymentObject.kind;
    try {
        if (isPodEntity(kind)) {
            imageIds = getImageIdsForPod(deploymentObject);
        }
        else {
            let containers = deploymentObject.spec.template.spec.containers;
            if (containers && containers.length > 0) {
                containers.forEach(container => {
                    // Filter all pods using the container names in this deployment,
                    // and get the imageIds from pod status
                    imageIds = getImageIdsForPodsInDeployment(container.name, allPods.items);
                });
            }
        }
    }
    catch (e) {
        // Don't fail the task if the image ID extraction fails
        console.log("Image Ids extraction failed with exception: " + e);
    }

    let name: string = deploymentObject.metadata && deploymentObject.metadata.name ? deploymentObject.metadata.name : "";
    let relatedUrls = [getPipelineUrl()];
    let clusterUrl = getServerUrl(clusterInfo);
    if (clusterUrl) {
        relatedUrls.push(clusterUrl);
    }

    if (manifestFilePaths) {
        relatedUrls.push(...manifestFilePaths);
    }
    else {
        let manifestPaths = getManifestFilePaths();
        if (manifestPaths.length > 0) {
            relatedUrls.push(...manifestPaths);
        }
    }

    const metadataDetails = {
        "Name": name,
        "Description": getDescription(),
        "RelatedUrl": relatedUrls,
        "ResourceUri": imageIds,
        "UserEmail": getUserEmail(),
        "Config": deploymentStrategy,
        "Address": getEnvironmentResourceAddress() || clusterUrl,
        "Platform": getPlatform()
    };

    return metadataDetails;
}

export function getImageIdsForPodsInDeployment(containerName: string, pods: any[]): string[] {
    // The image name in parent.spec.template.spec.containers and in pod.status.containerStatuses is not a constant, example it is redis in former, and redis:latest in latter
    // Hence filtering the pods on the basis of container name which is a constant
    let imageIds: string[] = [];
    pods.forEach(pod => {
        const podStatus = pod.status;
        podStatus.containerStatuses.forEach(status => {
            if (status.name.toLowerCase() === containerName.toLowerCase()) {
                if (status.imageID) {
                    imageIds.push(getImageResourceUrl(status.imageID));
                }
            }
        });
    });

    return imageIds;
}

export function getImageIdsForPod(pod: any): string[] {
    let imageIds: string[] = [];
    const podStatus = pod.status;
    podStatus.containerStatuses.forEach(status => {
        if (status.imageID) {
            imageIds.push(getImageResourceUrl(status.imageID));
        }
    });

    return imageIds;
}

export function getImageResourceUrl(imageId: string): string {
    const sha256Text = "@sha256:";
    const separator = "://";
    let indexOfSeparator = imageId.indexOf(separator);
    let image = indexOfSeparator >= 0 ? imageId.substr(indexOfSeparator + separator.length) : imageId;
    const digest = getImageResourceUrlParameter(imageId, matchPatternForDigest);

    let match = image.match(/^(?:([^\/]+)\/)?(?:([^\/]+)\/)?([^@:\/]+)(?:[@:](.+))?$/);
    if (!match) {
        return "";
    }

    let registry = match[1];
    let imgNamespace = match[2];
    let repository = match[3];

    if (!imgNamespace && registry && !/[:.]/.test(registry)) {
        imgNamespace = registry;
        registry = "docker.io";
    }

    if (!imgNamespace && !registry) {
        registry = "docker.io";
        imgNamespace = "library";
    }

    registry = registry ? registry + "/" : "";
    imgNamespace = imgNamespace ? imgNamespace + "/" : "";

    return util.format("https://%s%s%s%s%s", registry, imgNamespace, repository, sha256Text, digest);
}

export function getImageResourceUrlParameter(imageId: string, matchPattern: RegExp): string {
    const imageMatch = imageId.match(matchPattern);
    if (imageMatch && imageMatch.length >= 1) {
        return imageMatch[1];
    }

    return "";
}

function getUserEmail(): string {
    const build = "build";
    const buildReason = "schedule";
    const hostType = tl.getVariable("System.HostType").toLowerCase();
    let userEmail: string = "";
    if (hostType === build && tl.getVariable("Build.Reason").toLowerCase() !== buildReason) {
        userEmail = tl.getVariable("Build.RequestedForEmail");
    }
    else {
        userEmail = tl.getVariable("Release.RequestedForEmail");
    }

    return userEmail;
}

function getDescription(): string {
    // Todo: Should we have a particular description with deployment details?
    const release = "release";
    const hostType = tl.getVariable("System.HostType").toLowerCase();
    const description: string = hostType === release ? tl.getVariable("Release.ReleaseDescription") : "";
    return description;
}

function getEnvironmentResourceAddress(): string {
    const environmentResourceName = tl.getVariable("Environment.ResourceName");
    const environmentResourceId = tl.getVariable("Environment.ResourceId");
    if (!environmentResourceName && !environmentResourceId) {
        return "";
    }

    return util.format("%s/%s", environmentResourceName, environmentResourceId);
}

function getPipelineUrl(): string {
    let pipelineUrl = "";
    if (isBuild) {
        pipelineUrl = orgUrl + tl.getVariable("System.TeamProject") + "/_build/results?buildId=" + tl.getVariable("Build.BuildId");
    }
    else {
        pipelineUrl = orgUrl + tl.getVariable("System.TeamProject") + "/_releaseProgress?releaseId=" + tl.getVariable("Release.ReleaseId");
    }

    return pipelineUrl;
}

function getServerUrl(clusterInfo: any): string {
    let serverUrl: string = "";
    let serverUrlMatch = clusterInfo.match(matchPatternForServerUrl);
    if (serverUrlMatch && serverUrlMatch.length >= 1) {
        serverUrl = serverUrlMatch[0];
    }

    return serverUrl;
}

function getManifestFilePaths(): string[] {
    let manifestFilePaths: string[] = [];
    const commandArguments = tl.getInput("arguments", false);
    const filePathMatch: string[] = commandArguments.split(matchPatternForFileArgument);
    if (filePathMatch && filePathMatch.length >= 0) {
        filePathMatch.forEach(manifestPath => {
            if (!!manifestPath) {
                manifestFilePaths.push(manifestPath.trim())
            }
        });
    }

    return manifestFilePaths;
}

function getPlatform(): string {
    let platform: string = "Custom";
    const connectionType = tl.getInput("connectionType");
    if (connectionType === "Azure Resource Manager") {
        platform = "AKS";
    }

    return platform;
}

export function IsJsonString(str) {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

export function getPublishDeploymentRequestUrl(): string {
    return orgUrl + tl.getVariable("System.TeamProject") + "/_apis/deployment/deploymentdetails?api-version=5.2-preview.1";
}

export function isDeploymentEntity(kind: string): boolean {
    return deploymentTypes.some((type: string) => {
        return kind.toLowerCase() === type;
    });
}

export function isPodEntity(kind: string): boolean {
    if (!kind) {
        tl.warning("ResourceKindNotDefined");
        return false;
    }

    return kind.toLowerCase() === "pod";
}
