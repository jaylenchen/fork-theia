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

import { injectable, inject, named } from '@theia/core/shared/inversify';
import { ContributionProvider } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { TaskRunnerContribution, TaskRunnerRegistry } from './task-runner';

@injectable()
export class TaskBackendApplicationContribution implements BackendApplicationContribution {

    static file = "/Users/work/Third-Projects/theia/packages/task/src/node/task-backend-application-contribution.ts"

    @inject(ContributionProvider) @named(TaskRunnerContribution)
    protected readonly contributionProvider: ContributionProvider<TaskRunnerContribution>;

    @inject(TaskRunnerRegistry)
    protected readonly taskRunnerRegistry: TaskRunnerRegistry;

    onStart(): void {
        console.log(`\x1b[1;4;35m%s\x1b[0m`, `\n###[调用BackendApplication Contribution onStart启动] TaskBackendApplicationContribution `, ` [/Users/work/Third-Projects/theia/packages/task/src/node/task-backend-application-contribution.ts:34]`);
        const contributions = this.contributionProvider.getContributions()

        console.log(`\x1b[1;3;30;43m%s\x1b[0m`, `\n TaskRunnerContribution有${contributions.length}个 `, ` [/Users/work/Third-Projects/theia/packages/task/src/node/task-backend-application-contribution.ts:37]\n`);
        console.table(contributions.map(c => {
            return {
                "registerRunner name": c.registerRunner.name
            }
        }))

        contributions.forEach(contrib =>
            contrib.registerRunner(this.taskRunnerRegistry)
        );
    }
}
