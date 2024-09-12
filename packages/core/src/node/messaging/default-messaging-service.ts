// *****************************************************************************
// Copyright (C) 2018 TypeFox and others.
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

import { injectable, inject, named, interfaces, Container } from 'inversify';
import { ContributionProvider, ConnectionHandler, bindContributionProvider, servicesPath } from '../../common';
import { MessagingService } from './messaging-service';
import { ConnectionContainerModule } from './connection-container-module';
import Route = require('route-parser');
import { Channel, ChannelMultiplexer } from '../../common/message-rpc/channel';
import { FrontendConnectionService } from './frontend-connection-service';
import { BackendApplicationContribution } from '../backend-application';

export const MessagingContainer = Symbol('MessagingContainer');
export const MainChannel = Symbol('MainChannel');

@injectable()
export class DefaultMessagingService implements MessagingService, BackendApplicationContribution {
    static file = "/Users/work/Third-Projects/theia/packages/core/src/node/messaging/default-messaging-service.ts"

    @inject(MessagingContainer)
    protected readonly container: interfaces.Container;

    @inject(FrontendConnectionService)
    protected readonly frontendConnectionService: FrontendConnectionService;

    @inject(ContributionProvider) @named(ConnectionContainerModule)
    protected readonly connectionModules: ContributionProvider<interfaces.ContainerModule>;

    @inject(ContributionProvider) @named(MessagingService.Contribution)
    protected readonly contributions: ContributionProvider<MessagingService.Contribution>;

    protected readonly channelHandlers = new ConnectionHandlers<Channel>();

    initialize(): void {
        console.log(`\x1b[1;4;35m%s\x1b[0m`, `\n###[调用BackendApplicaton8个实现了initialize方法的Contribution的initialize方法进行初始化 ]\n###[初始化BackendApplication Contribution] DefaultMessagingService `, ` [/Users/work/Third-Projects/theia/packages/core/src/node/messaging/default-messaging-service.ts:48]`);

        this.registerConnectionHandler(servicesPath, (_, socket) => this.handleConnection(socket));
        const contributions = this.contributions.getContributions();

        // =======================debug start=======================
        console.log(`\x1b[1;4;30;42m%s\x1b[0m`, `\n######[初始化BackendApplication Contribution]\n######[调用${contributions.length}个DefaultMessagingService Contribution的configure方法配置DefaultMessagingService] `, ` [/Users/work/Third-Projects/theia/packages/core/src/node/messaging/default-messaging-service.ts:48]`);
        console.table(contributions.map(contribution => {
            const Contribution = contribution.constructor as any
            return {
                "MessagingService Contribution": Contribution.name,
                File: Contribution.file,
            }
        }))
        // =======================debug end=======================


        for (const contribution of contributions) {
            contribution.configure(this);
        }
    }

    registerConnectionHandler(path: string, callback: (params: MessagingService.PathParams, mainChannel: Channel) => void): void {
        this.frontendConnectionService.registerConnectionHandler(path, callback);
    }

    registerChannelHandler(spec: string, callback: (params: MessagingService.PathParams, channel: Channel) => void): void {
        this.channelHandlers.push(spec, (params, channel) => callback(params, channel));
    }

    protected handleConnection(channel: Channel): void {
        const multiplexer = new ChannelMultiplexer(channel);
        const channelHandlers = this.getConnectionChannelHandlers(channel);
        multiplexer.onDidOpenChannel(event => {
            if (channelHandlers.route(event.id, event.channel)) {
                console.debug(`Opening channel for service path '${event.id}'.`);
                event.channel.onClose(() => console.info(`Closing channel on service path '${event.id}'.`));
            }
        });
    }

    protected createMainChannelContainer(socket: Channel): Container {
        const connectionContainer: Container = this.container.createChild() as Container;
        connectionContainer.bind(MainChannel).toConstantValue(socket);
        return connectionContainer;
    }

    protected getConnectionChannelHandlers(socket: Channel): ConnectionHandlers<Channel> {
        const connectionContainer = this.createMainChannelContainer(socket);
        bindContributionProvider(connectionContainer, ConnectionHandler);
        connectionContainer.load(...this.connectionModules.getContributions());
        const connectionChannelHandlers = new ConnectionHandlers<Channel>(this.channelHandlers);
        const connectionHandlers = connectionContainer.getNamed<ContributionProvider<ConnectionHandler>>(ContributionProvider, ConnectionHandler);
        const handlers = connectionHandlers.getContributions(true)

        console.log(`\x1b[1;3;30;43m%s\x1b[0m`, `\n 当前有${handlers.length}个rpc handler `, ` [/Users/work/Third-Projects/theia/packages/core/src/node/messaging/default-messaging-service.ts:100]\n`,
            `\nconnectionHandler.onConnection(channel)实际上内部调用了factory.listen(channel);
            \n继续追踪又看到了内部调用了const protocol = this.rpcProtocolFactory(channel, (meth, args) => this.onRequest(meth, ...args));
            \n`
        );
        console.table(handlers.map(handler => {
            return {
                rpcPath: handler.path,
                rpcHandler: handler.onConnection.name,
            }
        }))

        for (const connectionHandler of handlers) {
            connectionChannelHandlers.push(connectionHandler.path, (_, channel) => {
                connectionHandler.onConnection(channel);
            });
        }
        return connectionChannelHandlers;
    }

}

export class ConnectionHandlers<T> {
    protected readonly handlers: ((path: string, connection: T) => string | false)[] = [];

    constructor(
        protected readonly parent?: ConnectionHandlers<T>
    ) { }

    push(spec: string, callback: (params: MessagingService.PathParams, connection: T) => void): void {
        const route = new Route(spec);
        const handler = (path: string, channel: T): string | false => {
            const params = route.match(path);
            if (!params) {
                return false;
            }
            callback(params, channel);
            return route.reverse(params);
        };
        this.handlers.push(handler);
    }

    route(path: string, connection: T): string | false {
        for (const handler of this.handlers) {
            try {
                const result = handler(path, connection);
                if (result) {
                    return result;
                }
            } catch (e) {
                console.error(e);
            }
        }
        if (this.parent) {
            return this.parent.route(path, connection);
        }
        return false;
    }
}
