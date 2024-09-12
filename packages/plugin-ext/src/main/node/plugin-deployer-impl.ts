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

/* eslint-disable @typescript-eslint/no-explicit-any */

import { injectable, optional, multiInject, inject, named } from '@theia/core/shared/inversify';
import * as semver from 'semver';
import {
    PluginDeployerResolver, PluginDeployerFileHandler, PluginDeployerDirectoryHandler,
    PluginDeployerEntry, PluginDeployer, PluginDeployerParticipant, PluginDeployerStartContext,
    PluginDeployerResolverInit,
    PluginDeployerEntryType, PluginDeployerHandler, PluginType, UnresolvedPluginEntry, PluginIdentifiers, PluginDeployOptions
} from '../../common/plugin-protocol';
import { PluginDeployerEntryImpl } from './plugin-deployer-entry-impl';
import {
    PluginDeployerResolverContextImpl,
    PluginDeployerResolverInitImpl
} from './plugin-deployer-resolver-context-impl';
import { ProxyPluginDeployerEntry } from './plugin-deployer-proxy-entry-impl';
import { PluginDeployerFileHandlerContextImpl } from './plugin-deployer-file-handler-context-impl';
import { PluginDeployerDirectoryHandlerContextImpl } from './plugin-deployer-directory-handler-context-impl';
import { ILogger, Emitter, ContributionProvider } from '@theia/core';
import { PluginCliContribution } from './plugin-cli-contribution';
import { Measurement, Stopwatch } from '@theia/core/lib/common';

@injectable()
export class PluginDeployerImpl implements PluginDeployer {

    protected readonly onDidDeployEmitter = new Emitter<void>();
    readonly onDidDeploy = this.onDidDeployEmitter.event;

    @inject(ILogger)
    protected readonly logger: ILogger;

    @inject(PluginDeployerHandler)
    protected readonly pluginDeployerHandler: PluginDeployerHandler;

    @inject(PluginCliContribution)
    protected readonly cliContribution: PluginCliContribution;

    @inject(Stopwatch)
    protected readonly stopwatch: Stopwatch;

    /**
     * Inject all plugin resolvers found at runtime.
     */
    @optional() @multiInject(PluginDeployerResolver)
    private pluginResolvers: PluginDeployerResolver[];

    /**
     * Inject all file handler for local resolved plugins.
     */
    @optional() @multiInject(PluginDeployerFileHandler)
    private pluginDeployerFileHandlers: PluginDeployerFileHandler[];

    /**
     * Inject all directory handler for local resolved plugins.
     */
    @optional() @multiInject(PluginDeployerDirectoryHandler)
    private pluginDeployerDirectoryHandlers: PluginDeployerDirectoryHandler[];

    @inject(ContributionProvider) @named(PluginDeployerParticipant)
    protected readonly participants: ContributionProvider<PluginDeployerParticipant>;

    public start(): Promise<void> {
        this.logger.debug('Starting the deployer with the list of resolvers', this.pluginResolvers);
        return this.doStart();
    }

    public async initResolvers(): Promise<Array<void>> {
        console.log(`\x1b[1;4;30;42m%s\x1b[0m`, `\n######[初始化PluginDeployerContribution阶段]\n######[调用PluginDeployerImpl initResolvers初始化所有插件解析器] `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:84]`);
        // call init on each resolver
        const pluginDeployerResolverInit: PluginDeployerResolverInit = new PluginDeployerResolverInitImpl();
        const promises = this.pluginResolvers.map(async pluginResolver => {
            if (pluginResolver.init) {
                pluginResolver.init(pluginDeployerResolverInit);
            }
        });
        return Promise.all(promises);
    }

    protected async doStart(): Promise<void> {

        // init resolvers
        // 初始化所有插件解析器（vscode、theia有几种解析器）
        await this.initResolvers();

        // check THEIA_DEFAULT_PLUGINS or THEIA_PLUGINS env var
        const defaultPluginsValue = process.env.THEIA_DEFAULT_PLUGINS || undefined;
        const pluginsValue = process.env.THEIA_PLUGINS || undefined;
        // check the `--plugins` CLI option
        // 拿到插件目录，比如这里就是整个根目录中的plugins目录
        // 这个插件目录可以在命令后启动后端app的时候，通过--plugins参数指定，比如：yarn theia start --plugins=/Users/work/Third-Projects/theia/plugins
        const defaultPluginsValueViaCli = this.cliContribution.localDir();

        this.logger.debug('Found the list of default plugins ID on env:', defaultPluginsValue);
        this.logger.debug('Found the list of plugins ID on env:', pluginsValue);
        this.logger.debug('Found the list of default plugins ID from CLI:', defaultPluginsValueViaCli);

        // transform it to array
        const defaultPluginIdList = defaultPluginsValue ? defaultPluginsValue.split(',') : [];
        const pluginIdList = pluginsValue ? pluginsValue.split(',') : [];
        const systemEntries = defaultPluginIdList.concat(pluginIdList).concat(defaultPluginsValueViaCli ? defaultPluginsValueViaCli.split(',') : []);

        const userEntries: string[] = [];
        const context: PluginDeployerStartContext = { userEntries, systemEntries };

        // =====================获取各种插件解析器读取的插件目录入口=========================
        const contributions = this.participants.getContributions()

        console.log(`\x1b[1;4;30;42m%s\x1b[0m`, `\n######[初始化PluginDeployerContribution阶段]\n######[初始化PluginDeployerParticipant${contributions.filter(c => c.onWillStart).length}个实现了onWillStart方法的Contribution] `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:121]`);
        console.table(contributions.filter(c => c.onWillStart).map(contribution => {
            const Contribution = contribution.constructor as any
            return {
                "PluginDeployerParticipant Contribution": Contribution.name,
                File: Contribution.file,
            }
        }))

        for (const contribution of contributions) {
            if (contribution.onWillStart) {
                await contribution.onWillStart(context);
            }
        }
        // =====================解析插件=========================

        const deployPlugins = this.measure('deployPlugins');
        // *****用户插件目录******/
        /**
         * {
                id: "local-dir:/Users/work/.theia/plugins",
                type: 1,
            }
         */
        /**
         *  {
                id: "local-dir:/Users/work/.theia/deployedPlugins",
                type: 1,
            }
         */

        const unresolvedUserEntries = context.userEntries.map(id => ({
            id,
            type: PluginType.User
        }));

        // *****系统插件目录******/
        /**
         * {
                id: "local-dir:../../plugins",
                type: 0,
            }
         */
        const unresolvedSystemEntries = context.systemEntries.map(id => ({
            id,
            type: PluginType.System
        }));
        const resolvePlugins = this.measure('resolvePlugins');

        // 利用图的bfs解析所有插件入口。往往我们给定一个插件，但是这个插件又依赖其他插件，所以我们需要解析所有插件及其依赖插件
        // 只有这样才能真正的部署所有插件
        const plugins = await this.resolvePlugins([...unresolvedUserEntries, ...unresolvedSystemEntries]);
        resolvePlugins.log('Resolve plugins list');

        // =====================部署插件=========================
        console.log(`\x1b[1;3;30;43m%s\x1b[0m`, `\n 当前有${plugins.length}个待部署的插件 `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:147]\n`);
        console.table(plugins.map(p => {
            return {
                id: p.id(),
                type: p.type === PluginType.System ? 'System' : 'User',
                path: p.path()
            }
        }))

        // 部署所有插件
        await this.deployPlugins(plugins);
        deployPlugins.log('Deploy plugins list');

    }

    async uninstall(pluginId: PluginIdentifiers.VersionedId): Promise<void> {
        await this.pluginDeployerHandler.uninstallPlugin(pluginId);
    }

    async undeploy(pluginId: PluginIdentifiers.VersionedId): Promise<void> {
        if (await this.pluginDeployerHandler.undeployPlugin(pluginId)) {
            this.onDidDeployEmitter.fire();
        }
    }

    async deploy(plugin: UnresolvedPluginEntry, options?: PluginDeployOptions): Promise<number> {
        console.log(`\x1b[1;3;30;44m%s\x1b[0m`, `\n#########PluginDeployerImpl使用deploy方法处理插件部署`,
            `[/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:180]`,
            `\nPluginDeployerImpl deploy其实又包装下plugin后转发给PluginDeployerImpl deployMultipleEntries处理plugin的部署\n`
        );
        const deploy = this.measure('deploy');
        const numDeployedPlugins = await this.deployMultipleEntries([plugin], options);
        deploy.log(`Deploy plugin ${plugin.id}`);
        return numDeployedPlugins;
    }

    protected async deployMultipleEntries(plugins: UnresolvedPluginEntry[], options?: PluginDeployOptions): Promise<number> {
        const pluginsToDeploy = await this.resolvePlugins(plugins, options);

        return this.deployPlugins(pluginsToDeploy);
    }

    /**
     * Resolves plugins for the given type.
     *
     * Only call it a single time before triggering a single deploy to prevent re-resolving of extension dependencies, i.e.
     * ```ts
     * const deployer: PluginDeployer;
     * deployer.deployPlugins(await deployer.resolvePlugins(allPluginEntries));
     * ```
     */
    async resolvePlugins(plugins: UnresolvedPluginEntry[], options?: PluginDeployOptions): Promise<PluginDeployerEntry[]> {
        console.log(`\x1b[1;4;30;42m%s\x1b[0m`, `\n######[调用PluginDeployerImpl resolvePlugins方法解析所有插件] `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:205]`);
        console.log("\x1b[38;5;213m######利用图的bfs算法去解析处理所有插件及其依赖插件，示意图如下： \x1b[0m")
        console.log("\x1b[38;5;213m######    A\x1b[0m");
        console.log("\x1b[38;5;213m######   / \\\x1b[0m");
        console.log("\x1b[38;5;213m######  B   C\x1b[0m");
        console.log("\x1b[38;5;213m######   \\ / \\\x1b[0m");
        console.log("\x1b[38;5;213m######    D   E\x1b[0m");

        const visited = new Set<string>();
        const hasBeenVisited = (id: string) => visited.has(id) || (visited.add(id), false);
        const pluginsToDeploy = new Map<PluginIdentifiers.VersionedId, PluginDeployerEntry>();
        const unversionedIdsHandled = new Map<PluginIdentifiers.UnversionedId, string[]>();

        const queue: UnresolvedPluginEntry[] = [...plugins];
        while (queue.length) {
            const pendingDependencies: Array<{
                dependencies: Map<string, string>
                type: PluginType
            }> = [];
            await Promise.all(queue.map(async entry => {
                if (hasBeenVisited(entry.id)) {
                    return;
                }
                const type = entry.type ?? PluginType.System;
                try {
                    const pluginDeployerEntries = await this.resolveAndHandle(entry.id, type, options);
                    for (const deployerEntry of pluginDeployerEntries) {
                        const pluginData = await this.pluginDeployerHandler.getPluginDependencies(deployerEntry);
                        const versionedId = pluginData && PluginIdentifiers.componentsToVersionedId(pluginData.metadata.model);
                        const unversionedId = versionedId && PluginIdentifiers.componentsToUnversionedId(pluginData.metadata.model);
                        if (unversionedId && !pluginsToDeploy.has(versionedId)) {
                            pluginsToDeploy.set(versionedId, deployerEntry);
                            if (pluginData.mapping) {
                                pendingDependencies.push({ dependencies: pluginData.mapping, type });
                            }
                            const otherVersions = unversionedIdsHandled.get(unversionedId) ?? [];
                            otherVersions.push(pluginData.metadata.model.version);
                            if (otherVersions.length === 1) {
                                unversionedIdsHandled.set(unversionedId, otherVersions);
                            } else {
                                this.findBestVersion(unversionedId, otherVersions, pluginsToDeploy);
                            }
                        }
                    }
                } catch (e) {
                    console.error(`Failed to resolve plugins from '${entry.id}'`, e);
                }
            }));
            queue.length = 0;
            for (const { dependencies, type } of pendingDependencies) {
                for (const [dependency, deployableDependency] of dependencies) {
                    if (!unversionedIdsHandled.has(dependency as PluginIdentifiers.UnversionedId)) {
                        queue.push({
                            id: deployableDependency,
                            type
                        });
                    }
                }
            }
        }
        return [...pluginsToDeploy.values()];
    }

    protected async resolveAndHandle(id: string, type: PluginType, options?: PluginDeployOptions): Promise<PluginDeployerEntry[]> {
        console.log(`\x1b[1;4;30;42m%s\x1b[0m`, `\n######[初始化PluginDeployerContribution阶段]\n######[调用PluginDeployerImpl resolveAndHandle方法解析插件入口] `, id, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:255]`);

        let entries = await this.resolvePlugin(id, type, options);
        if (type === PluginType.User) {
            await this.applyFileHandlers(entries);
        } else {
            const filteredEntries: PluginDeployerEntry[] = [];
            for (const entry of entries) {
                if (await entry.isFile()) {
                    this.logger.warn(`Only user plugins will be handled by file handlers, please unpack the plugin '${entry.id()}' manually.`);
                } else {
                    filteredEntries.push(entry);
                }
            }
            entries = filteredEntries;
        }
        await this.applyDirectoryFileHandlers(entries);
        return entries;
    }

    protected findBestVersion(unversionedId: PluginIdentifiers.UnversionedId, versions: string[], knownPlugins: Map<PluginIdentifiers.VersionedId, PluginDeployerEntry>): void {
        // If left better, return negative. Then best is index 0.
        versions.map(version => ({ version, plugin: knownPlugins.get(PluginIdentifiers.idAndVersionToVersionedId({ version, id: unversionedId })) }))
            .sort((left, right) => {
                const leftPlugin = left.plugin;
                const rightPlugin = right.plugin;
                if (!leftPlugin && !rightPlugin) {
                    return 0;
                }
                if (!rightPlugin) {
                    return -1;
                }
                if (!leftPlugin) {
                    return 1;
                }
                if (leftPlugin.type === PluginType.System && rightPlugin.type === PluginType.User) {
                    return -1;
                }
                if (leftPlugin.type === PluginType.User && rightPlugin.type === PluginType.System) {
                    return 1;
                }
                if (semver.gtr(left.version, right.version)) {
                    return -1;
                }
                return 1;
            }).forEach((versionedEntry, index) => {
                if (index !== 0) {
                    // Mark as not accepted to prevent deployment of all but the winner.
                    versionedEntry.plugin?.accept();
                }
            });
    }

    /**
     * deploy all plugins that have been accepted
     */
    async deployPlugins(pluginsToDeploy: PluginDeployerEntry[]): Promise<number> {
        // const acceptedPlugins = pluginsToDeploy.filter(pluginDeployerEntry => pluginDeployerEntry.isAccepted());
        const acceptedFrontendPlugins = pluginsToDeploy.filter(pluginDeployerEntry => pluginDeployerEntry.isAccepted(PluginDeployerEntryType.FRONTEND));
        const acceptedBackendPlugins = pluginsToDeploy.filter(pluginDeployerEntry => pluginDeployerEntry.isAccepted(PluginDeployerEntryType.BACKEND));
        const acceptedHeadlessPlugins = pluginsToDeploy.filter(pluginDeployerEntry => pluginDeployerEntry.isAccepted(PluginDeployerEntryType.HEADLESS));
        /**
            * acceptedFrontendPlugins
            * ┌───────┬───────────────────────────────────────┬──────────┬──────────────────────────────────────────────────────────────────────────────────────────┐
            * │ Index │ ID                                    │ Type     │ Path                                                                                     │
            * ├───────┼───────────────────────────────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
            * │ 0     │ 'vscode.configuration-editing'        │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.configuration-editing/extension'        │
            * │ 1     │ 'vscode.css-language-features'        │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.css-language-features/extension'        │
            * │ 2     │ 'vscode.emmet'                        │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.emmet/extension'                        │
            * │ 3     │ 'vscode.git-base'                     │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.git-base/extension'                     │
            * │ 4     │ 'vscode.html-language-features'       │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.html-language-features/extension'       │
            * │ 5     │ 'vscode.ipynb'                        │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.ipynb/extension'                        │
            * │ 6     │ 'vscode.json-language-features'       │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.json-language-features/extension'       │
            * │ 7     │ 'vscode.markdown-language-features'   │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.markdown-language-features/extension'   │
            * │ 8     │ 'vscode.markdown-math'                │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.markdown-math/extension'                │
            * │ 9     │ 'vscode.media-preview'                │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.media-preview/extension'                │
            * │ 10    │ 'vscode.merge-conflict'               │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.merge-conflict/extension'               │
            * │ 11    │ 'vscode.npm'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.npm/extension'                          │
            * │ 12    │ 'vscode.references-view'              │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.references-view/extension'              │
            * │ 13    │ 'vscode.search-result'                │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.search-result/extension'                │
            * │ 14    │ 'vscode.simple-browser'               │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.simple-browser/extension'               │
            * │ 15    │ 'vscode.typescript-language-features' │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.typescript-language-features/extension' │
            * └───────┴───────────────────────────────────────┴──────────┴──────────────────────────────────────────────────────────────────────────────────────────┘
        */
        // =======================debug acceptedFrontendPlugins start==============================
        console.log(`\x1b[1;3;30;43m%s\x1b[0m`, `\n 等待部署的前端插件集合（总共${acceptedFrontendPlugins.length}个） `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:357]\n`);
        console.table(acceptedFrontendPlugins.map(p => {
            return {
                id: p.id(),
                type: p.type === PluginType.System ? 'System' : 'User',
                path: p.path()
            }
        }))
        // =======================debug acceptedFrontendPlugins end==============================

        /**
        * acceptedBackendPlugins
        * ┌───────┬────────────────────────────────────────┬──────────┬───────────────────────────────────────────────────────────────────────────────────────────┬─────────────┐
        * │ Index │ ID                                     │ Type     │ Path                                                                                      │ HasFrontend │
        * ├───────┼────────────────────────────────────────┼──────────┼───────────────────────────────────────────────────────────────────────────────────────────┼─────────────┤
        * │ 0     │ 'vscode.configuration-editing'         │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.configuration-editing/extension'         │ '是'        │
        * │ 1     │ 'vscode.css-language-features'         │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.css-language-features/extension'         │ '是'        │
        * │ 2     │ 'vscode.emmet'                         │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.emmet/extension'                         │ '是'        │
        * │ 3     │ 'vscode.git-base'                      │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.git-base/extension'                      │ '是'        │
        * │ 4     │ 'vscode.html-language-features'        │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.html-language-features/extension'        │ '是'        │
        * │ 5     │ 'vscode.ipynb'                         │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.ipynb/extension'                         │ '是'        │
        * │ 6     │ 'vscode.json-language-features'        │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.json-language-features/extension'        │ '是'        │
        * │ 7     │ 'vscode.markdown-language-features'    │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.markdown-language-features/extension'    │ '是'        │
        * │ 8     │ 'vscode.markdown-math'                 │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.markdown-math/extension'                 │ '是'        │
        * │ 9     │ 'vscode.media-preview'                 │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.media-preview/extension'                 │ '是'        │
        * │ 10    │ 'vscode.merge-conflict'                │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.merge-conflict/extension'                │ '是'        │
        * │ 11    │ 'vscode.npm'                           │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.npm/extension'                           │ '是'        │
        * │ 12    │ 'vscode.references-view'               │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.references-view/extension'               │ '是'        │
        * │ 13    │ 'vscode.search-result'                 │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.search-result/extension'                 │ '是'        │
        * │ 14    │ 'vscode.simple-browser'                │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.simple-browser/extension'                │ '是'        │
        * │ 15    │ 'vscode.typescript-language-features'  │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.typescript-language-features/extension'  │ '是'        │
        * │ 16    │ 'EditorConfig.EditorConfig'            │ 'System' │ '/Users/work/Third-Projects/theia/plugins/EditorConfig.EditorConfig/extension'            │ '否'        │
        * │ 17    │ 'eclipse-theia.builtin-extension-pack' │ 'System' │ '/Users/work/Third-Projects/theia/plugins/eclipse-theia.builtin-extension-pack/extension' │ '否'        │
        * │ 18    │ 'ms-vscode.js-debug'                   │ 'System' │ '/Users/work/Third-Projects/theia/plugins/ms-vscode.js-debug/extension'                   │ '否'        │
        * │ 19    │ 'vscode.bat'                           │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.bat/extension'                           │ '否'        │
        * │ 20    │ 'vscode.builtin-notebook-renderers'    │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.builtin-notebook-renderers/extension'    │ '否'        │
        * │ 21    │ 'vscode.clojure'                       │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.clojure/extension'                       │ '否'        │
        * │ 22    │ 'vscode.coffeescript'                  │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.coffeescript/extension'                  │ '否'        │
        * │ 23    │ 'vscode.cpp'                           │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.cpp/extension'                           │ '否'        │
        * │ 24    │ 'vscode.csharp'                        │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.csharp/extension'                        │ '否'        │
        * │ 25    │ 'vscode.css'                           │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.css/extension'                           │ '否'        │
        * │ 26    │ 'vscode.dart'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.dart/extension'                          │ '否'        │
        * │ 27    │ 'vscode.debug-auto-launch'             │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.debug-auto-launch/extension'             │ '否'        │
        * │ 28    │ 'vscode.debug-server-ready'            │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.debug-server-ready/extension'            │ '否'        │
        * │ 29    │ 'vscode.diff'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.diff/extension'                          │ '否'        │
        * │ 30    │ 'vscode.docker'                        │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.docker/extension'                        │ '否'        │
        * │ 31    │ 'vscode.fsharp'                        │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.fsharp/extension'                        │ '否'        │
        * │ 32    │ 'vscode.git'                           │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.git/extension'                           │ '否'        │
        * │ 33    │ 'vscode.go'                            │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.go/extension'                            │ '否'        │
        * │ 34    │ 'vscode.groovy'                        │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.groovy/extension'                        │ '否'        │
        * │ 35    │ 'vscode.grunt'                         │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.grunt/extension'                         │ '否'        │
        * │ 36    │ 'vscode.gulp'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.gulp/extension'                          │ '否'        │
        * │ 37    │ 'vscode.handlebars'                    │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.handlebars/extension'                    │ '否'        │
        * │ 38    │ 'vscode.hlsl'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.hlsl/extension'                          │ '否'        │
        * │ 39    │ 'vscode.html'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.html/extension'                          │ '否'        │
        * │ 40    │ 'vscode.ini'                           │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.ini/extension'                           │ '否'        │
        * │ 41    │ 'vscode.jake'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.jake/extension'                          │ '否'        │
        * │ 42    │ 'vscode.java'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.java/extension'                          │ '否'        │
        * │ 43    │ 'vscode.javascript'                    │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.javascript/extension'                    │ '否'        │
        * │ 44    │ 'vscode.json'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.json/extension'                          │ '否'        │
        * │ 45    │ 'vscode.julia'                         │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.julia/extension'                         │ '否'        │
        * │ 46    │ 'vscode.latex'                         │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.latex/extension'                         │ '否'        │
        * │ 47    │ 'vscode.less'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.less/extension'                          │ '否'        │
        * │ 48    │ 'vscode.log'                           │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.log/extension'                           │ '否'        │
        * │ 49    │ 'vscode.lua'                           │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.lua/extension'                           │ '否'        │
        * │ 50    │ 'vscode.make'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.make/extension'                          │ '否'        │
        * │ 51    │ 'vscode.markdown'                      │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.markdown/extension'                      │ '否'        │
        * │ 52    │ 'vscode.objective-c'                   │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.objective-c/extension'                   │ '否'        │
        * │ 53    │ 'vscode.perl'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.perl/extension'                          │ '否'        │
        * │ 54    │ 'vscode.php'                           │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.php/extension'                           │ '否'        │
        * │ 55    │ 'vscode.php-language-features'         │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.php-language-features/extension'         │ '否'        │
        * │ 56    │ 'vscode.powershell'                    │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.powershell/extension'                    │ '否'        │
        * │ 57    │ 'vscode.pug'                           │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.pug/extension'                           │ '否'        │
        * │ 58    │ 'vscode.python'                        │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.python/extension'                        │ '否'        │
        * │ 59    │ 'vscode.r'                             │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.r/extension'                             │ '否'        │
        * │ 60    │ 'vscode.razor'                         │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.razor/extension'                         │ '否'        │
        * │ 61    │ 'vscode.restructuredtext'              │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.restructuredtext/extension'              │ '否'        │
        * │ 62    │ 'vscode.ruby'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.ruby/extension'                          │ '否'        │
        * │ 63    │ 'vscode.rust'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.rust/extension'                          │ '否'        │
        * │ 64    │ 'vscode.scss'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.scss/extension'                          │ '否'        │
        * │ 65    │ 'vscode.shaderlab'                     │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.shaderlab/extension'                     │ '否'        │
        * │ 66    │ 'vscode.shellscript'                   │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.shellscript/extension'                   │ '否'        │
        * │ 67    │ 'vscode.sql'                           │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.sql/extension'                           │ '否'        │
        * │ 68    │ 'vscode.swift'                         │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.swift/extension'                         │ '否'        │
        * │ 69    │ 'vscode.theme-abyss'                   │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.theme-abyss/extension'                   │ '否'        │
        * │ 70    │ 'vscode.theme-defaults'                │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.theme-defaults/extension'                │ '否'        │
        * │ 71    │ 'vscode.theme-kimbie-dark'             │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.theme-kimbie-dark/extension'             │ '否'        │
        * │ 72    │ 'vscode.theme-monokai'                 │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.theme-monokai/extension'                 │ '否'        │
        * │ 73    │ 'vscode.theme-monokai-dimmed'          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.theme-monokai-dimmed/extension'          │ '否'        │
        * │ 74    │ 'vscode.theme-quietlight'              │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.theme-quietlight/extension'              │ '否'        │
        * │ 75    │ 'vscode.theme-red'                     │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.theme-red/extension'                     │ '否'        │
        * │ 76    │ 'vscode.theme-solarized-dark'          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.theme-solarized-dark/extension'          │ '否'        │
        * │ 77    │ 'vscode.theme-solarized-light'         │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.theme-solarized-light/extension'         │ '否'        │
        * │ 78    │ 'vscode.theme-tomorrow-night-blue'     │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.theme-tomorrow-night-blue/extension'     │ '否'        │
        * │ 79    │ 'vscode.tunnel-forwarding'             │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.tunnel-forwarding/extension'             │ '否'        │
        * │ 80    │ 'vscode.typescript'                    │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.typescript/extension'                    │ '否'        │
        * │ 81    │ 'vscode.vb'                            │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.vb/extension'                            │ '否'        │
        * │ 82    │ 'vscode.vscode-theme-seti'             │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.vscode-theme-seti/extension'             │ '否'        │
        * │ 83    │ 'vscode.xml'                           │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.xml/extension'                           │ '否'        │
        * │ 84    │ 'vscode.yaml'                          │ 'System' │ '/Users/work/Third-Projects/theia/plugins/vscode.yaml/extension'                          │ '否'        │
        * └───────┴────────────────────────────────────────┴──────────┴───────────────────────────────────────────────────────────────────────────────────────────┴─────────────┘
        */
        // =======================debug acceptedBackendPlugins start==============================
        console.log(`\x1b[1;3;30;43m%s\x1b[0m`, `\n 等待部署的后端插件集合（总共${acceptedBackendPlugins.length}个） `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:367]\n`);
        const sortedBackendPlugins = acceptedBackendPlugins.sort((a, b) => {
            const aIndex = acceptedFrontendPlugins.findIndex(p => p.id() === a.id());
            const bIndex = acceptedFrontendPlugins.findIndex(p => p.id() === b.id());
            if (aIndex !== -1 && bIndex === -1) return -1;
            if (aIndex === -1 && bIndex !== -1) return 1;
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            return 0;
        });

        console.table(sortedBackendPlugins.map(p => {
            return {
                id: p.id(),
                type: p.type === PluginType.System ? 'System' : 'User',
                path: p.path(),
                hasFrontend: acceptedFrontendPlugins.some(fp => fp.id() === p.id()) ? '是' : '否'
            }
        }))
        // =======================debug acceptedBackendPlugins end==============================

        // =======================debug acceptedHeadlessPlugins start==============================
        console.log(`\x1b[1;3;30;43m%s\x1b[0m`, `\n 等待部署的无头插件集合（总共${acceptedHeadlessPlugins.length}个） `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:378]\n`);
        console.table(acceptedHeadlessPlugins.map(p => {
            return {
                id: p.id(),
                type: p.type === PluginType.System ? 'System' : 'User',
                path: p.path()
            }
        }))
        // =======================debug acceptedHeadlessPlugins end==============================
        // this.logger.debug('the accepted plugins are', acceptedPlugins);
        // this.logger.debug('the acceptedFrontendPlugins plugins are', acceptedFrontendPlugins);
        // this.logger.debug('the acceptedBackendPlugins plugins are', acceptedBackendPlugins);
        // this.logger.debug('the acceptedHeadlessPlugins plugins are', acceptedHeadlessPlugins);
        // acceptedPlugins.forEach(plugin => {
        //     this.logger.debug('will deploy plugin', plugin.id(), 'with changes', JSON.stringify(plugin.getChanges()), 'and this plugin has been resolved by', plugin.resolvedBy());
        // });
        // ==================================================debug deploy plugins start==================================================
        console.log(`\x1b[1;4;30;42m%s\x1b[0m`, `\n######[调用PluginDeployerImpl deployPlugins方法部署所有插件] `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:336]`);

        // =======accepted plugins=========
        // console.log(`\x1b[1;3;30;43m%s\x1b[0m`, `\n accepted plugins有${acceptedPlugins.length}个 `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:338]\n`);
        // console.table(acceptedPlugins.map((plugin) => ({
        //     id: plugin.id(),
        //     path: plugin.path(),
        // })))

        // ==================================================debug deploy plugins end==================================================

        // local path to launch
        // const pluginPaths = [...acceptedBackendPlugins, ...acceptedHeadlessPlugins].map(pluginEntry => pluginEntry.path());
        // this.logger.debug('local path to deploy on remote instance', pluginPaths);

        const deployments = [];
        // start the backend plugins
        // 注入的pluginDeployerHandler位于packages/plugin-ext/src/hosted/node/hosted-plugin-deployer-handler.ts
        deployments.push(await this.pluginDeployerHandler.deployBackendPlugins(acceptedBackendPlugins));
        // headless plugins are deployed like backend plugins
        deployments.push(await this.pluginDeployerHandler.deployBackendPlugins(acceptedHeadlessPlugins));
        deployments.push(await this.pluginDeployerHandler.deployFrontendPlugins(acceptedFrontendPlugins));
        this.onDidDeployEmitter.fire(undefined);
        return deployments.reduce<number>((accumulated, current) => accumulated += current ?? 0, 0);
    }

    /**
     * If there are some single files, try to see if we can work on these files (like unpacking it, etc)
     */
    public async applyFileHandlers(pluginDeployerEntries: PluginDeployerEntry[]): Promise<void> {
        const waitPromises = pluginDeployerEntries.filter(pluginDeployerEntry => pluginDeployerEntry.isResolved()).flatMap(pluginDeployerEntry =>
            this.pluginDeployerFileHandlers.map(async pluginFileHandler => {
                const proxyPluginDeployerEntry = new ProxyPluginDeployerEntry(pluginFileHandler, (pluginDeployerEntry) as PluginDeployerEntryImpl);
                if (await pluginFileHandler.accept(proxyPluginDeployerEntry)) {
                    const pluginDeployerFileHandlerContext = new PluginDeployerFileHandlerContextImpl(proxyPluginDeployerEntry);
                    await pluginFileHandler.handle(pluginDeployerFileHandlerContext);
                }
            })
        );
        await Promise.all(waitPromises);
    }

    /**
     * Check for all registered directories to see if there are some plugins that can be accepted to be deployed.
     */
    public async applyDirectoryFileHandlers(pluginDeployerEntries: PluginDeployerEntry[]): Promise<void> {
        const waitPromises = pluginDeployerEntries.filter(pluginDeployerEntry => pluginDeployerEntry.isResolved()).flatMap(pluginDeployerEntry =>
            this.pluginDeployerDirectoryHandlers.map(async pluginDirectoryHandler => {
                const proxyPluginDeployerEntry = new ProxyPluginDeployerEntry(pluginDirectoryHandler, (pluginDeployerEntry) as PluginDeployerEntryImpl);
                if (await pluginDirectoryHandler.accept(proxyPluginDeployerEntry)) {
                    const pluginDeployerDirectoryHandlerContext = new PluginDeployerDirectoryHandlerContextImpl(proxyPluginDeployerEntry);
                    await pluginDirectoryHandler.handle(pluginDeployerDirectoryHandlerContext);
                }
            })
        );
        await Promise.all(waitPromises);
    }

    /**
     * Check a plugin ID see if there are some resolvers that can handle it. If there is a matching resolver, then we resolve the plugin
     */
    public async resolvePlugin(pluginId: string, type: PluginType = PluginType.System, options?: PluginDeployOptions): Promise<PluginDeployerEntry[]> {
        const pluginDeployerEntries: PluginDeployerEntry[] = [];
        const foundPluginResolver = this.pluginResolvers.find(pluginResolver => pluginResolver.accept(pluginId));

        // there is a resolver for the input
        if (foundPluginResolver) {
            console.log(`\x1b[1;4;35m%s\x1b[0m`, `\n#########[初始化PluginDeployerContribution阶段]\n#########[调用PluginDeployerImpl resolveAndHandle方法解析插件入口]\n#########[调用插件解析器${foundPluginResolver.constructor.name}处理插件入口 ${pluginId}] `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:392]`, `\n\n`);

            // create context object
            const context = new PluginDeployerResolverContextImpl(foundPluginResolver, pluginId);

            await foundPluginResolver.resolve(context, options);

            const plugins = context.getPlugins()

            console.log(`\x1b[1;3;30;43m%s\x1b[0m`, `\n Context有${plugins.length}个可用的插件 `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-impl.ts:401]\n`);
            console.table(plugins.map(p => {
                return {
                    id: p.id(),
                    type: p.type === PluginType.System ? 'System' : 'User',
                    path: p.path(),
                }
            }))
            plugins.forEach(entry => {
                entry.type = type;
                pluginDeployerEntries.push(entry);
            });
        } else {
            // log it for now
            this.logger.error('No plugin resolver found for the entry', pluginId);
            const unresolvedEntry = new PluginDeployerEntryImpl(pluginId, pluginId);
            unresolvedEntry.type = type;
            pluginDeployerEntries.push(unresolvedEntry);
        }

        return pluginDeployerEntries;
    }

    protected measure(name: string): Measurement {
        return this.stopwatch.start(name);
    }
}
