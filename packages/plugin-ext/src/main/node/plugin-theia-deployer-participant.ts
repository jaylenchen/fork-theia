// *****************************************************************************
// Copyright (C) 2020 TypeFox and others.
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

import { injectable, inject } from '@theia/core/shared/inversify';
import { PluginTheiaEnvironment } from '../common/plugin-theia-environment';
import { PluginDeployerParticipant, PluginDeployerStartContext } from '../../common/plugin-protocol';

@injectable()
export class PluginTheiaDeployerParticipant implements PluginDeployerParticipant {

    static file = "/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-theia-deployer-participant.ts"

    @inject(PluginTheiaEnvironment)
    protected readonly environments: PluginTheiaEnvironment;

    async onWillStart(context: PluginDeployerStartContext): Promise<void> {
        console.log(`\x1b[1;4;35m%s\x1b[0m`, `\n######[初始化PluginDeployerContribution阶段]\n######[初始化PluginDeployerParticipant几个实现了onWillStart方法的Contribution]\n######[调用PluginTheiaDeployerParticipant的onWillStart方法] `, `[/Users/work/Third-Projects/theia/packages/plugin-ext/src/main/node/plugin-theia-deployer-participant.ts:30]`);

        const pluginsDirUri = await this.environments.getPluginsDirUri();
        // local-dir:/Users/work/.theia/plugins
        const entry = pluginsDirUri.withScheme('local-dir').toString()

        context.userEntries.push(entry);
    }

}
