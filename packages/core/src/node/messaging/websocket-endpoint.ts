// *****************************************************************************
// Copyright (C) 2023 STMicroelectronics and others.
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

import { MessagingService } from './messaging-service';
import * as http from 'http';
import * as https from 'https';
import { inject, injectable } from 'inversify';
import { Server, Socket } from 'socket.io';
import { WsRequestValidator } from '../ws-request-validators';
import { MessagingListener } from './messaging-listeners';
import { ConnectionHandlers } from './default-messaging-service';
import { BackendApplicationContribution } from '../backend-application';

@injectable()
export class WebsocketEndpoint implements BackendApplicationContribution {
    static file = "/Users/work/Third-Projects/theia/packages/core/src/node/messaging/websocket-endpoint.ts"

    @inject(WsRequestValidator)
    protected readonly wsRequestValidator: WsRequestValidator;

    @inject(MessagingListener)
    protected readonly messagingListener: MessagingListener;

    protected checkAliveTimeout = 30000; // 30 seconds
    protected maxHttpBufferSize = 1e8; // 100 MB

    protected readonly wsHandlers = new ConnectionHandlers<Socket>();

    registerConnectionHandler(spec: string, callback: (params: MessagingService.PathParams, socket: Socket) => void): void {
        this.wsHandlers.push(spec, callback);
    }

    onStart(server: http.Server | https.Server): void {
        console.log(`\x1b[1;4;35m%s\x1b[0m`, `\n###[启动BackendApplication Contribution] WebsocketEndpoint `, ` [/Users/work/Third-Projects/theia/packages/core/src/node/messaging/websocket-endpoint.ts:46]`, `\n WebsocketEndpoint onStart主要在服务器上设置 WebSocket 端点，并处理每个连接请求。通过这种方式，服务器能够接受和管理 WebSocket 连接，实现实时通信功能。\n`);

        const socketServer = new Server(server, {
            pingInterval: this.checkAliveTimeout,
            pingTimeout: this.checkAliveTimeout * 2,
            maxHttpBufferSize: this.maxHttpBufferSize
        });
        // Accept every namespace by using /.*/
        socketServer.of(/.*/).on('connection', async socket => {
            const request = socket.request;
            // Socket.io strips the `origin` header of the incoming request
            // We provide a `fix-origin` header in the `WebSocketConnectionProvider`
            request.headers.origin = request.headers['fix-origin'] as string;
            if (await this.allowConnect(socket.request)) {
                await this.handleConnection(socket);
                this.messagingListener.onDidWebSocketUpgrade(socket.request, socket);
            } else {
                socket.disconnect(true);
            }
        });
    }

    protected async allowConnect(request: http.IncomingMessage): Promise<boolean> {
        try {
            return this.wsRequestValidator.allowWsUpgrade(request);
        } catch (e) {
            return false;
        }
    }

    protected async handleConnection(socket: Socket): Promise<void> {
        const pathname = socket.nsp.name;
        if (pathname && !this.wsHandlers.route(pathname, socket)) {
            console.error('Cannot find a ws handler for the path: ' + pathname);
        }
    }
}

