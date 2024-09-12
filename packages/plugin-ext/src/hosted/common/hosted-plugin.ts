// *****************************************************************************
// Copyright (C) 2018 Red Hat, Inc. and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// some code copied and modified from https://github.com/microsoft/vscode/blob/da5fb7d5b865aa522abc7e82c10b746834b98639/src/vs/workbench/api/node/extHostExtensionService.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

import debounce = require('@theia/core/shared/lodash.debounce');
import { injectable, inject, interfaces, named, postConstruct } from '@theia/core/shared/inversify';
import { PluginMetadata, HostedPluginServer, DeployedPlugin, PluginServer, PluginIdentifiers } from '../../common/plugin-protocol';
import { AbstractPluginManagerExt, ConfigStorage } from '../../common/plugin-api-rpc';
import {
    Disposable, DisposableCollection, Emitter,
    ILogger, ContributionProvider,
    RpcProxy
} from '@theia/core';
import { MainPluginApiProvider } from '../../common/plugin-ext-api-contribution';
import { PluginPathsService } from '../../main/common/plugin-paths-protocol';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { environment } from '@theia/core/shared/@theia/application-package/lib/environment';
import { Measurement, Stopwatch } from '@theia/core/lib/common';

export type PluginHost = 'frontend' | string;

export const ALL_ACTIVATION_EVENT = '*';

export function isConnectionScopedBackendPlugin(plugin: DeployedPlugin): boolean {
    const entryPoint = plugin.metadata.model.entryPoint;

    // A plugin doesn't have to have any entry-point if it doesn't need the activation handler,
    // in which case it's assumed to be a backend plugin.
    return !entryPoint.headless || !!entryPoint.backend;
}

@injectable()
export abstract class AbstractHostedPluginSupport<PM extends AbstractPluginManagerExt<any>, HPS extends HostedPluginServer | RpcProxy<HostedPluginServer>> {

    protected container: interfaces.Container;

    @inject(ILogger)
    protected readonly logger: ILogger;

    @inject(HostedPluginServer)
    protected readonly server: HPS;

    @inject(ContributionProvider)
    @named(MainPluginApiProvider)
    protected readonly mainPluginApiProviders: ContributionProvider<MainPluginApiProvider>;

    @inject(PluginServer)
    protected readonly pluginServer: PluginServer;

    @inject(PluginPathsService)
    protected readonly pluginPathsService: PluginPathsService;

    @inject(EnvVariablesServer)
    protected readonly envServer: EnvVariablesServer;

    @inject(Stopwatch)
    protected readonly stopwatch: Stopwatch;

    protected theiaReadyPromise: Promise<unknown>;

    protected readonly managers = new Map<string, PM>();

    protected readonly contributions = new Map<PluginIdentifiers.UnversionedId, PluginContributions>();

    protected readonly activationEvents = new Set<string>();

    protected readonly onDidChangePluginsEmitter = new Emitter<void>();
    readonly onDidChangePlugins = this.onDidChangePluginsEmitter.event;

    protected readonly deferredWillStart = new Deferred<void>();
    /**
     * Resolves when the initial plugins are loaded and about to be started.
     */
    get willStart(): Promise<void> {
        return this.deferredWillStart.promise;
    }

    protected readonly deferredDidStart = new Deferred<void>();
    /**
     * Resolves when the initial plugins are started.
     */
    get didStart(): Promise<void> {
        return this.deferredDidStart.promise;
    }

    constructor(protected readonly clientId: string) { }

    @postConstruct()
    protected init(): void {
        this.theiaReadyPromise = this.createTheiaReadyPromise();
    }

    protected abstract createTheiaReadyPromise(): Promise<unknown>;

    get plugins(): PluginMetadata[] {
        const plugins: PluginMetadata[] = [];
        this.contributions.forEach(contributions => plugins.push(contributions.plugin.metadata));
        return plugins;
    }

    getPlugin(id: PluginIdentifiers.UnversionedId): DeployedPlugin | undefined {
        const contributions = this.contributions.get(id);
        return contributions && contributions.plugin;
    }

    /** do not call it, except from the plugin frontend contribution */
    onStart(container: interfaces.Container): void {
        this.container = container;
        this.load();
        this.afterStart();
    }

    protected afterStart(): void {
        // Nothing to do in the abstract
    }

    protected loadQueue: Promise<void> = Promise.resolve(undefined);
    load = debounce(() => this.loadQueue = this.loadQueue.then(async () => {
        try {
            await this.runOperation(() => {
                console.log(`\x1b[1;3;30;46m%s\x1b[0m`, `\n==========>启用插件支持功能 `, ` [调用HostedPluginSupport-AbstractHostedPluginSupport-doLoad] `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/hosted/common/hosted-plugin.ts:141]`);
                return this.doLoad()
            });
        } catch (e) {
            // console.error('Failed to load plugins:', e);
        }
    }), 50, { leading: true });

    protected runOperation(operation: () => Promise<void>): Promise<void> {
        return operation();
    }

    protected async doLoad(): Promise<void> {

        try {
            const toDisconnect = new DisposableCollection(Disposable.create(() => { /* mark as connected */ }));

            await this.beforeSyncPlugins(toDisconnect);

            // process empty plugins as well in order to properly remove stale plugin widgets
            // ==============同步所有插件 start============
            // 这一步会启动plugin host进程
            console.log(`\x1b[1;3;30;46m%s\x1b[0m`, `\n==========>同步所有插件 `, ` [调用AbstractHostedPluginSupport syncPlugins] `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/hosted/common/hosted-plugin.ts:160]`, `\nAbstractHostedPluginSupport syncPlugins主要同步已加载和已部署的插件，具体逻辑就是卸载未部署的插件并初始化新部署的插件\n`);
            await this.syncPlugins();
            // ==============同步所有插件 end============

            // it has to be resolved before awaiting layout is initialized
            // otherwise clients can hang forever in the initialization phase
            this.deferredWillStart.resolve();

            await this.beforeLoadContributions(toDisconnect);

            if (toDisconnect.disposed) {
                // if disconnected then don't try to load plugin contributions
                return;
            }
            // ==============加载所有插件贡献 start============
            console.log(`\x1b[1;3;30;46m%s\x1b[0m`, `\n==========>加载获取所有插件 `, ` [调用AbstractHostedPluginSupport loadContributions] `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/hosted/common/hosted-plugin.ts:175]`, `\n\n`);
            // 实际上就是将每个plugin的contributions分类注册
            // 比如contribute的地方有command、theme等地方，意思是写的plugin是对这些地方的扩展
            // 所以你会看到contributions.command，contributions.theme等 类似这样的内容，将plugin里头这些内容一个个注册
            // 这个部分简而言之，就是将一个theia向插件暴露的可contribute的地方，一个个处理，如果有就调用相关处理逻辑，没有就跳过
            const contributionsByHost = this.loadContributions(toDisconnect);
            // ==============加载所有插件贡献 end============

            await this.afterLoadContributions(toDisconnect);

            // ==============等待Theia App（前端App或者后端App）启动完成 start=============
            console.log(`\x1b[1;3;30;46m%s\x1b[0m`, `\n==========>等待Theia App启动完成 `, ` [调用AbstractHostedPluginSupport theiaReadyPromise] `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/hosted/common/hosted-plugin.ts:174]`, `\n\n`);
            await this.theiaReadyPromise;
            // ==============等待Theia App（前端App或者后端App）启动完成 end=============

            if (toDisconnect.disposed) {
                // if disconnected then don't try to init plugin code and dynamic contributions
                return;
            }

            // ==============启动所有插件 start============
            // 启动所有需要加载的插件
            console.log(`\x1b[1;3;30;46m%s\x1b[0m`, `\n==========>启动所有插件 `, ` [调用AbstractHostedPluginSupport startPlugins] `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/hosted/common/hosted-plugin.ts:191]`, `\n\n`);
            await this.startPlugins(contributionsByHost, toDisconnect);
            // ==============启动所有插件 end============

            this.deferredDidStart.resolve();
        } catch {

        }
    }

    protected beforeSyncPlugins(toDisconnect: DisposableCollection): Promise<void> {
        // Nothing to do in the abstract
        return Promise.resolve();
    }

    protected beforeLoadContributions(toDisconnect: DisposableCollection): Promise<void> {
        // Nothing to do in the abstract
        return Promise.resolve();
    }

    protected afterLoadContributions(toDisconnect: DisposableCollection): Promise<void> {
        // Nothing to do in the abstract
        return Promise.resolve();
    }

    /**
     * Sync loaded and deployed plugins:
     * - undeployed plugins are unloaded
     * - newly deployed plugins are initialized
     */
    protected async syncPlugins(): Promise<void> {
        // 初始化变量：
        // initialized：记录初始化的插件数量。
        // waitPluginsMeasurement 和 syncPluginsMeasurement：用于测量插件同步过程的时间。
        // toUnload：一个集合，包含当前所有插件的 ID，用于跟踪需要卸载的插件。
        // didChangeInstallationStatus：标记插件安装状态是否发生变化。
        let initialized = 0;
        const waitPluginsMeasurement = this.measure('waitForDeployment');
        let syncPluginsMeasurement: Measurement | undefined;

        const toUnload = new Set(this.contributions.keys());
        let didChangeInstallationStatus = false;
        try {
            const newPluginIds: PluginIdentifiers.VersionedId[] = [];
            // 获取已部署和未安装的插件 ID：
            // - 使用 Promise.all 并行获取已部署和未安装的插件 ID。
            const [deployedPluginIds, uninstalledPluginIds] = await Promise.all([this.server.getDeployedPluginIds(), this.server.getUninstalledPluginIds()]);
            waitPluginsMeasurement.log('Waiting for backend deployment');
            syncPluginsMeasurement = this.measure('syncPlugins');

            // 处理已部署的插件：
            // - 从 toUnload 集合中删除已部署的插件 ID。
            // - 如果插件是新的，则将其添加到 newPluginIds 数组中。
            for (const versionedId of deployedPluginIds) {
                const unversionedId = PluginIdentifiers.unversionedFromVersioned(versionedId);
                toUnload.delete(unversionedId);
                if (!this.contributions.has(unversionedId)) {
                    newPluginIds.push(versionedId);
                }
            }

            // 卸载未部署的插件：
            // - 对于 toUnload 集合中的每个插件 ID，调用其 dispose 方法进行卸载。
            for (const pluginId of toUnload) {
                this.contributions.get(pluginId)?.dispose();
            }

            // 处理未安装的插件：
            // - 标记未安装的插件为 outOfSync。
            for (const versionedId of uninstalledPluginIds) {
                const plugin = this.getPlugin(PluginIdentifiers.unversionedFromVersioned(versionedId));
                if (plugin && PluginIdentifiers.componentsToVersionedId(plugin.metadata.model) === versionedId && !plugin.metadata.outOfSync) {
                    plugin.metadata.outOfSync = didChangeInstallationStatus = true;
                }
            }

            // 更新插件的 outOfSync 状态：
            // - 对于所有插件，如果插件的 outOfSync 状态已更改，则更新其状态。
            for (const contribution of this.contributions.values()) {
                if (contribution.plugin.metadata.outOfSync && !uninstalledPluginIds.includes(PluginIdentifiers.componentsToVersionedId(contribution.plugin.metadata.model))) {
                    contribution.plugin.metadata.outOfSync = false;
                    didChangeInstallationStatus = true;
                }
            }

            // 初始化新插件：
            // - 获取新插件的详细信息并进行初始化。
            // - 将新插件添加到 contributions 集合中，并增加 initialized 计数。
            if (newPluginIds.length) {
                // 对于不同端，这里的server是不同的
                // 前端是HostedPluginServer，位于packages/plugin-ext/src/hosted/node/plugin-service.ts
                // 后端是PluginServer
                const deployedPlugins = await this.server.getDeployedPlugins({ pluginIds: newPluginIds });

                const plugins: DeployedPlugin[] = [];
                for (const plugin of deployedPlugins) {
                    const accepted = this.acceptPlugin(plugin);
                    if (typeof accepted === 'object') {
                        plugins.push(accepted);
                    } else if (accepted) {
                        plugins.push(plugin);
                    }
                }

                // 将新部署的插件转换成PluginContributions添加到 contributions 集合中，并增加 initialized 计数。
                for (const plugin of plugins) {
                    const pluginId = PluginIdentifiers.componentsToUnversionedId(plugin.metadata.model);
                    const contributions = new PluginContributions(plugin);
                    this.contributions.set(pluginId, contributions);
                    contributions.push(Disposable.create(() => this.contributions.delete(pluginId)));
                    initialized++;
                }
            }
        } finally {
            // 触发插件变化事件：
            // - 如果有插件被初始化、卸载或安装状态发生变化，则触发 onDidChangePluginsEmitter 事件。
            if (initialized || toUnload.size || didChangeInstallationStatus) {
                this.onDidChangePluginsEmitter.fire(undefined);
            }

            // 记录测量结果：
            // - 如果同步过程中出现错误，则记录错误信息。
            // - 如果有插件被同步，则记录同步时间。
            if (!syncPluginsMeasurement) {
                // await didn't complete normally
                waitPluginsMeasurement.error('Backend deployment failed.');
            }
        }
        if (initialized > 0) {
            // Only log sync measurement if there are were plugins to sync.
            syncPluginsMeasurement?.log(`Sync of ${this.getPluginCount(initialized)}`);
        } else {
            syncPluginsMeasurement?.stop();
        }
    }

    /**
     * Accept a deployed plugin to load in this host, or reject it, or adapt it for loading.
     * The result may be a boolean to accept (`true`) or reject (`false`) the plugin as is,
     * or else an adaptation of the original `plugin` to load in its stead.
     */
    protected abstract acceptPlugin(plugin: DeployedPlugin): boolean | DeployedPlugin;

    /**
     * Always synchronous in order to simplify handling disconnections.
     * @throws never
     */
    protected loadContributions(toDisconnect: DisposableCollection): Map<PluginHost, PluginContributions[]> {

        let loaded = 0;
        const loadPluginsMeasurement = this.measure('loadPlugins');

        const hostContributions = new Map<PluginHost, PluginContributions[]>();
        // console.log(`[${this.clientId}] Loading plugin contributions`);
        const contribValues = this.contributions.values()
        const contribValuesAttr = []

        for (const contributions of contribValues) {
            /**
             * 
             enum State {
                INITIALIZING = 0,
                LOADING = 1,
                LOADED = 2,
                STARTING = 3,

                STARTED = 4
             }   
             */
            contribValuesAttr.push({
                ...contributions.plugin.metadata, state: (() => {
                    switch (contributions.state) {
                        case PluginContributions.State.INITIALIZING:
                            return 'INITIALIZING';
                        case PluginContributions.State.LOADING:
                            return 'LOADING';
                        case PluginContributions.State.LOADED:
                            return 'LOADED';
                        case PluginContributions.State.STARTING:
                            return 'STARTING';
                        case PluginContributions.State.STARTED:
                            return 'STARTED';
                    }
                })()
            });

            const plugin = contributions.plugin.metadata;
            const pluginId = plugin.model.id;

            if (contributions.state === PluginContributions.State.INITIALIZING) {
                contributions.state = PluginContributions.State.LOADING;
                contributions.push(Disposable.create(() => console.log(`[${pluginId}]: Unloaded plugin.`)));
                contributions.push(this.handleContributions(contributions.plugin));
                contributions.state = PluginContributions.State.LOADED;
                console.debug(`[${this.clientId}][${pluginId}]: Loaded contributions.`);
                loaded++;
            }

            if (contributions.state === PluginContributions.State.LOADED) {
                contributions.state = PluginContributions.State.STARTING;
                const host = plugin.model.entryPoint.frontend ? 'frontend' : plugin.host;

                const dynamicContributions = hostContributions.get(host) || [];
                dynamicContributions.push(contributions);
                hostContributions.set(host, dynamicContributions);
                toDisconnect.push(Disposable.create(() => {
                    contributions!.state = PluginContributions.State.LOADED;
                    console.debug(`[${this.clientId}][${pluginId}]: Disconnected.`);
                }));
            }
        }

        console.table(contribValuesAttr.map((plugin) => ({
            state: plugin.state,
            host: plugin.host,
            type: plugin.model.engine.type,
            id: plugin.model.id,
            path: plugin.model.packageUri,
            "backend entryPoint": plugin.model.entryPoint.backend ?? "",
            "frontend entryPoint": plugin.model.entryPoint.frontend ?? "",
            "headless entryPoint": plugin.model.entryPoint.headless ?? "",
        })))

        if (loaded > 0) {
            // Only log load measurement if there are were plugins to load.
            loadPluginsMeasurement?.log(`Load contributions of ${this.getPluginCount(loaded)}`);
        } else {
            loadPluginsMeasurement.stop();
        }

        return hostContributions;
    }

    protected abstract handleContributions(plugin: DeployedPlugin): Disposable;

    protected async startPlugins(contributionsByHost: Map<PluginHost, PluginContributions[]>, toDisconnect: DisposableCollection): Promise<void> {
        let started = 0;

        const [hostLogPath, hostStoragePath, hostGlobalStoragePath] = await Promise.all([
            this.pluginPathsService.getHostLogPath(),
            this.getStoragePath(),
            this.getHostGlobalStoragePath()
        ]);

        if (toDisconnect.disposed) {
            return;
        }

        const thenable: Promise<void>[] = [];
        const configStorage: ConfigStorage = {
            hostLogPath,
            hostStoragePath,
            hostGlobalStoragePath
        };


        for (const [host, hostContributions] of contributionsByHost) {
            // do not start plugins for electron browser
            if (host === 'frontend' && environment.electron.is()) {
                continue;
            }

            // 有可能manager是一个rpc proxy
            // manager的实际处理对象位于packages/plugin-ext/src/plugin/plugin-manager.ts的PluginManagerExtImpl类
            // 而这里的PluginManagerExtImpl并不是运行在主进程中的，而是运行在插件的host进程中 。debug调用栈可以看出来。
            const manager = await this.obtainManager(host, hostContributions, toDisconnect);

            if (!manager) {
                continue;
            }

            const plugins = hostContributions.map(contributions => contributions.plugin.metadata);

            thenable.push((async () => {
                try {
                    const activationEvents = [...this.activationEvents];
                    await manager.$start({ plugins, configStorage, activationEvents });
                    if (toDisconnect.disposed) {
                        return;
                    }

                    console.log(`[${this.clientId}] Starting plugins.`);
                    for (const contributions of hostContributions) {
                        started++;
                        const plugin = contributions.plugin;
                        const id = plugin.metadata.model.id;
                        contributions.state = PluginContributions.State.STARTED;
                        console.debug(`[${this.clientId}][${id}]: Started plugin.`);
                        toDisconnect.push(contributions.push(Disposable.create(() => {
                            console.debug(`[${this.clientId}][${id}]: Stopped plugin.`);
                            manager.$stop(id);
                        })));

                        this.handlePluginStarted(manager, plugin);
                    }
                } catch (e) {
                    console.error(`Failed to start plugins for '${host}' host`, e);
                }
            })());
        }

        await Promise.all(thenable);
        await this.activateByEvent('onStartupFinished');
    }

    protected abstract obtainManager(host: string, hostContributions: PluginContributions[],
        toDisconnect: DisposableCollection): Promise<PM | undefined>;

    protected abstract getStoragePath(): Promise<string | undefined>;

    protected abstract getHostGlobalStoragePath(): Promise<string>;

    async activateByEvent(activationEvent: string): Promise<void> {
        if (this.activationEvents.has(activationEvent)) {
            return;
        }
        this.activationEvents.add(activationEvent);
        await Promise.all(Array.from(this.managers.values(), manager => {
            return manager.$activateByEvent(activationEvent)
        }));
    }

    async activatePlugin(id: string): Promise<void> {
        const activation = [];
        for (const manager of this.managers.values()) {
            activation.push(manager.$activatePlugin(id));
        }
        await Promise.all(activation);
    }

    protected handlePluginStarted(manager: PM, plugin: DeployedPlugin): void {
        // Nothing to do in the abstract
    }

    protected measure(name: string): Measurement {
        return this.stopwatch.start(name, { context: this.clientId });
    }

    protected getPluginCount(plugins: number): string {
        return `${plugins} plugin${plugins === 1 ? '' : 's'}`;
    }

}

export class PluginContributions extends DisposableCollection {
    constructor(
        readonly plugin: DeployedPlugin
    ) {
        super();
    }
    state: PluginContributions.State = PluginContributions.State.INITIALIZING;
}

export namespace PluginContributions {
    export enum State {
        INITIALIZING = 0,
        LOADING = 1,
        LOADED = 2,
        STARTING = 3,
        STARTED = 4
    }
}
