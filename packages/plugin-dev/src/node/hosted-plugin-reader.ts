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

import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { HostedPluginReader as PluginReaderHosted } from '@theia/plugin-ext/lib/hosted/node/plugin-reader';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { PluginMetadata } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { PluginDeployerEntryImpl } from '@theia/plugin-ext/lib/main/node/plugin-deployer-entry-impl';
import { HostedPluginDeployerHandler } from '@theia/plugin-ext/lib/hosted/node/hosted-plugin-deployer-handler';

@injectable()
export class HostedPluginReader implements BackendApplicationContribution {
    static file = "/Users/work/Third-Projects/theia/packages/plugin-dev/src/node/hosted-plugin-reader.ts"

    @inject(PluginReaderHosted)
    protected pluginReader: PluginReaderHosted;

    private readonly hostedPlugin = new Deferred<PluginMetadata | undefined>();

    @inject(HostedPluginDeployerHandler)
    protected deployerHandler: HostedPluginDeployerHandler;

    async initialize(): Promise<void> {
        console.log(`\x1b[1;4;35m%s\x1b[0m`, `\n###[调用BackendApplicaton8个实现了initialize方法的Contribution的initialize方法进行初始化 ]\n###[初始化BackendApplication Contribution] HostedPluginReader `, ` [/Users/work/Third-Projects/theia/packages/plugin-dev/src/node/hosted-plugin-reader.ts:38]`, `\n HostedPluginReader initialize方法用来处理和部署托管插件。它首先尝试获取插件的元数据，然后根据元数据的内容决定是否部署插件的前端和/或后端部分。总的来说就是根据托管插件的元数据，动态地部署插件的前端和后端部分，以确保插件能够正确运行。\n`);

        this.pluginReader.getPluginMetadata(process.env.HOSTED_PLUGIN)
            .then(this.hostedPlugin.resolve.bind(this.hostedPlugin));

        const pluginPath = process.env.HOSTED_PLUGIN;
        if (pluginPath) {
            const hostedPlugin = new PluginDeployerEntryImpl('Hosted Plugin', pluginPath!, pluginPath);
            hostedPlugin.storeValue('isUnderDevelopment', true);
            const hostedMetadata = await this.hostedPlugin.promise;
            if (hostedMetadata!.model.entryPoint && (hostedMetadata!.model.entryPoint.backend || hostedMetadata!.model.entryPoint.headless)) {
                console.log("\x1b[38;5;214m🚀 ~ 部署后端插件...\x1b[0m");

                this.deployerHandler.deployBackendPlugins([hostedPlugin]);
            }

            if (hostedMetadata!.model.entryPoint && hostedMetadata!.model.entryPoint.frontend) {
                console.log("\x1b[38;5;214m🚀 ~ 部署前端端插件...\x1b[0m");

                this.deployerHandler.deployFrontendPlugins([hostedPlugin]);
            }
        }

    }

    async getPlugin(): Promise<PluginMetadata | undefined> {
        return this.hostedPlugin.promise;
    }
}
