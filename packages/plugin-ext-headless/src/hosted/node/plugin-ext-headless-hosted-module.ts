// *****************************************************************************
// Copyright (C) 2024 EclipseSource and others.
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

import * as path from 'path';
import { bindContributionProvider } from '@theia/core/lib/common/contribution-provider';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { ContainerModule, interfaces } from '@theia/core/shared/inversify';
import { ExtPluginApiProvider, HostedPluginServer, PluginHostEnvironmentVariable, PluginScanner } from '@theia/plugin-ext';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/node/hosted-plugin';
import { HostedPluginProcess, HostedPluginProcessConfiguration } from '@theia/plugin-ext/lib/hosted/node/hosted-plugin-process';
import { BackendPluginHostableFilter } from '@theia/plugin-ext/lib/hosted/node/plugin-service';
import { MaybePromise } from '@theia/core';
import { HeadlessPluginContainerModule } from '../../common/headless-plugin-container';
import { HeadlessHostedPluginSupport, isHeadlessPlugin } from './headless-hosted-plugin';
import { TheiaHeadlessPluginScanner } from './scanners/scanner-theia-headless';
import { SupportedHeadlessActivationEvents } from '../../common/headless-plugin-protocol';
import { HeadlessHostedPluginServerImpl } from './headless-plugin-service';

export function bindCommonHostedBackend(bind: interfaces.Bind): void {
    bind(HostedPluginProcess).toSelf().inSingletonScope();
    bind(HostedPluginSupport).toSelf().inSingletonScope();

    bindContributionProvider(bind, Symbol.for(ExtPluginApiProvider));
    bindContributionProvider(bind, PluginHostEnvironmentVariable);
    bindContributionProvider(bind, SupportedHeadlessActivationEvents);

    bind(HeadlessHostedPluginServerImpl).toSelf().inSingletonScope();
    bind(HostedPluginServer).toService(HeadlessHostedPluginServerImpl);
    bind(HeadlessHostedPluginSupport).toSelf().inSingletonScope();
    bind(BackendPluginHostableFilter).toConstantValue(isHeadlessPlugin);

    bind(HostedPluginProcessConfiguration).toConstantValue({
        path: path.join(__dirname, 'plugin-host-headless'),
    });
}

export function bindHeadlessHosted(bind: interfaces.Bind): void {
    bind(TheiaHeadlessPluginScanner).toSelf().inSingletonScope();
    bind(PluginScanner).toService(TheiaHeadlessPluginScanner);
    bind(SupportedHeadlessActivationEvents).toConstantValue(['*', 'onStartupFinished']);

    bind(BackendApplicationContribution).toDynamicValue(({ container }) => {
        let hostedPluginSupport: HeadlessHostedPluginSupport | undefined;

        class MyHeadlessHostedPluginSupport {
            static file = "/Users/work/Third-Projects/theia/packages/plugin-ext-headless/src/hosted/node/plugin-ext-headless-hosted-module.ts"

            onStart(): MaybePromise<void> {
                console.log(`\x1b[1;4;35m%s\x1b[0m`, `\n###[调用BackendApplication Contribution onStart启动] MyHeadlessHostedPluginSupport启动 `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext-headless/src/hosted/node/plugin-ext-headless-hosted-module.ts:62]`);

                // Create a child container to isolate the Headless Plugin hosting stack
                // from all connection-scoped frontend/backend plugin hosts and
                // also to avoid leaking it into the global container scope
                const headlessPluginsContainer = container.createChild();
                const modules = container.getAll<ContainerModule>(HeadlessPluginContainerModule);

                headlessPluginsContainer.load(...modules);

                hostedPluginSupport = headlessPluginsContainer.get(HeadlessHostedPluginSupport);

                console.log("\x1b[38;5;214m ###############🚀 ~ 启动 hostedPluginSupport...[/Users/work/Third-Projects/theia/packages/plugin-ext-headless/src/hosted/node/plugin-ext-headless-hosted-module.ts:70]\x1b[0m");
                // plugin-ext-headless依赖于plugin-ext包的packages/plugin-ext/src/hosted/common/hosted-plugin.ts
                hostedPluginSupport.onStart(headlessPluginsContainer);
            }

            onStop(): void {
                hostedPluginSupport?.shutDown();
            }
        }
        return new MyHeadlessHostedPluginSupport()
    });
}
