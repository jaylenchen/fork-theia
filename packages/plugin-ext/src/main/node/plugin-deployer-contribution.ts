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

import { BackendApplicationContribution } from '@theia/core/lib/node';
import { injectable, inject } from '@theia/core/shared/inversify';
import { PluginDeployer } from '../../common/plugin-protocol';
import { ILogger } from '@theia/core';

@injectable()
export class PluginDeployerContribution implements BackendApplicationContribution {

    static file = "/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-contribution.ts"

    @inject(ILogger)
    protected readonly logger: ILogger;

    @inject(PluginDeployer)
    protected pluginDeployer: PluginDeployer;

    initialize(): Promise<void> {
        console.log(`\x1b[1;4;35m%s\x1b[0m`, `\n###[调用BackendApplicaton8个实现了initialize方法的Contribution的initialize方法进行初始化 ]\n###[初始化BackendApplication Contribution] PluginDeployerContribution `, ` [/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-deployer-contribution.ts:34]`);

        // 这里注入的是packages/plugin-ext/src/main/node/plugin-deployer-impl.ts
        this.pluginDeployer.start().catch(error => this.logger.error('Initializing plugin deployer failed.', error));
        return Promise.resolve();
    }
}
