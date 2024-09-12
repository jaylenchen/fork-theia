// *****************************************************************************
// Copyright (C) 2017 Ericsson and others.
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

import { ContainerModule, Container } from 'inversify';
import { ILoggerServer, loggerPath, ConsoleLogger } from '../common/logger-protocol';
import { ILogger, Logger, LoggerFactory, setRootLogger, LoggerName, rootLoggerName } from '../common/logger';
import { LoggerWatcher } from '../common/logger-watcher';
import { WebSocketConnectionProvider } from './messaging';
import { FrontendApplicationContribution } from './frontend-application-contribution';
import { EncodingError } from '../common/message-rpc/rpc-message-encoder';

export const loggerFrontendModule = new ContainerModule(bind => {
    bind(FrontendApplicationContribution).toDynamicValue(ctx => {
        class MyLogger {

            static file = "packages/core/src/browser/logger-frontend-module.ts"

            initialize(): void {
                setRootLogger(ctx.container.get<ILogger>(ILogger));
            }
        }

        return new MyLogger()
    });

    bind(LoggerName).toConstantValue(rootLoggerName);
    bind(ILogger).to(Logger).inSingletonScope().whenTargetIsDefault();
    bind(LoggerWatcher).toSelf().inSingletonScope();
    bind(ILoggerServer).toDynamicValue(ctx => {
        const loggerWatcher = ctx.container.get(LoggerWatcher);
        const connection = ctx.container.get(WebSocketConnectionProvider);
        /**
         * 获取到connection后创建proxy，在内部会调用factory创建proxy
         * 同时，在创建proxy之前，会根据path创建channel
         * 在创建完channel后，会调用handler将path和channel传入，实际上调用是(_, channel) => factory.listen(channel, true)
         * 
         * 而factory listen的主要实现是：
         * 侦听指定的path，调用自身的onRequest方法和onNotify方法
         * 
         * 至于loggerWatcher.getLoggerClient()所获取到的是loggerClient，它会被作为创建factory实例的target参数传入
         * 有啥用呢？个人理解是后端也会发消息给前端，那么前端也需要给后端一个远程调用对象，这个对象就是loggerClient
         * 使用方式我猜应该是跟前端调用后端rpc代理一样，只是这里是后端调用前端rpc代理
         * 
         */
        const target = connection.createProxy<ILoggerServer>(loggerPath, loggerWatcher.getLoggerClient());
        function get<K extends keyof ILoggerServer>(_: ILoggerServer, property: K): ILoggerServer[K] | ILoggerServer['log'] {
            if (property === 'log') {
                return (name, logLevel, message, params) => {
                    ConsoleLogger.log(name, logLevel, message, params);
                    return target.log(name, logLevel, message, params).catch(err => {
                        if (err instanceof EncodingError) {
                            // In case of an EncodingError no RPC call is sent to the backend `ILoggerServer`. Nevertheless, we want to continue normally.
                            return;
                        }
                        throw err;
                    });
                };
            }
            return target[property];
        }
        return new Proxy(target, { get });
    }).inSingletonScope();
    bind(LoggerFactory).toFactory(ctx =>
        (name: string) => {
            const child = new Container({ defaultScope: 'Singleton' });
            child.parent = ctx.container;
            child.bind(ILogger).to(Logger).inTransientScope();
            child.bind(LoggerName).toConstantValue(name);
            return child.get(ILogger);
        }
    );
});
