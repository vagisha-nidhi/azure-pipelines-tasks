'use strict';

import * as tl from 'azure-pipelines-task-lib/task';
import { IExecSyncResult } from 'azure-pipelines-task-lib/toolrunner';
import * as utils from './utility';
import * as KubernetesConstants from './kubernetesconstants';
import { Kubectl, Resource } from './kubectl-object-model';

export async function checkManifestStability(kubectl: Kubectl, resources: Resource[]): Promise<IExecSyncResult[]> {
    const rolloutStatusResults = [];
    const numberOfResources = resources.length;
    for (let i = 0; i< numberOfResources; i++) {
        const resource = resources[i];
        if (KubernetesConstants.workloadTypesWithRolloutStatus.indexOf(resource.type.toLowerCase()) >= 0) {
            rolloutStatusResults.push(kubectl.checkRolloutStatus(resource.type, resource.name));
        }
        if (utils.isEqual(resource.type, KubernetesConstants.KubernetesWorkload.pod, true)) {
            try {
                await checkPodStatus(kubectl, resource.name);
            } catch (ex) {
                tl.warning(tl.loc('CouldNotDeterminePodStatus', JSON.stringify(ex)));
            }
        }
    }
    
    return rolloutStatusResults;
}

export async function checkPodStatus(kubectl: Kubectl, podName: string): Promise<void> {
    const sleepTimeout = 10 * 1000; // 10 seconds
    const iterations = 60; // 60 * 10 seconds timeout = 10 minutes max timeout
    let podStatus;
    for (let i = 0; i < iterations; i++) {
        await sleep(sleepTimeout);
        tl.debug(`Polling for pod status: ${podName}`);
        podStatus = getPodStatus(kubectl, podName);
        if (podStatus.phase && podStatus.phase !== 'Pending' && podStatus.phase !== 'Unknown') {
            break;
        }
    }
    podStatus = getPodStatus(kubectl, podName);
    switch (podStatus.phase) {
        case 'Succeeded':
        case 'Running':
            if (isPodReady(podStatus)) {
                console.log(`pod/${podName} is successfully rolled out`);
            }
            break;
        case 'Pending':
            if (!isPodReady(podStatus)) {
                tl.warning(`pod/${podName} rollout status check timedout`);
            }
            break;
        case 'Failed':
            tl.error(`pod/${podName} rollout failed`);
            break;
        default:
            tl.warning(`pod/${podName} rollout status: ${podStatus.phase}`);
    }
}

function getPodStatus(kubectl: Kubectl, podName: string): any {
    const podResult = kubectl.getResource('pod', podName);
    utils.checkForErrors([podResult]);
    const podStatus = JSON.parse(podResult.stdout).status;
    tl.debug(`Pod Status: ${JSON.stringify(podStatus)}`);
    return podStatus;
}

function isPodReady(podStatus: any): boolean {
    let allContainersAreReady = true;
    podStatus.containerStatuses.forEach(container => {
        if (container.ready === false) {
            console.log(`'${container.name}' status: ${JSON.stringify(container.state)}`);
            allContainersAreReady = false;
        }
    });
    if (!allContainersAreReady) {
        tl.warning(tl.loc('AllContainersNotInReadyState'));
    }
    return allContainersAreReady;
}

function sleep(timeout: number) {
    return new Promise(resolve => setTimeout(resolve, timeout));
}