// *****************************************************************************
// Copyright (C) 2017 TypeFox and others.
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

import { ResponseError } from '../message-rpc/rpc-message-encoder';
import { ApplicationError } from '../application-error';
import { Disposable } from '../disposable';
import { Emitter, Event } from '../event';
import { Channel } from '../message-rpc/channel';
import { RequestHandler, RpcProtocol } from '../message-rpc/rpc-protocol';
import { ConnectionHandler } from './handler';
import { Deferred } from '../promise-util';
import { decorate, injectable, unmanaged } from '../../../shared/inversify';

export type RpcServer<Client> = Disposable & {
    /**
     * If this server is a proxy to a remote server then
     * a client is used as a local object
     * to handle RPC messages from the remote server.
     */
    /**
     * 如果这个服务器是远程服务器的代理，
     * 则一个客户端被当作一个处理远程服务器RPC消息的本地对象
     */
    setClient(client: Client | undefined): void;
    getClient?(): Client | undefined;
};

export interface RpcConnectionEventEmitter {
    readonly onDidOpenConnection: Event<void>;
    readonly onDidCloseConnection: Event<void>;
}
export type RpcProxy<T> = T & RpcConnectionEventEmitter;

export class RpcConnectionHandler<T extends object> implements ConnectionHandler {
    constructor(
        readonly path: string,
        /**
         * 这个函数调用起来后生成处理rpc请求的本地实际对象，本地可能指的是frontend本地，也可能是backend本地，最终会设置为factory.targetf
         */
        readonly targetFactory: (proxy: RpcProxy<T>) => any,
        readonly factoryConstructor: new () => RpcProxyFactory<T> = RpcProxyFactory
    ) { }

    onConnection(channel: Channel): void {
        /**
         * 要设置处理rpc请求的target有两种方式：
         * 1、在初始化rpcProxyFactory时，传入一个target；
         * 2、调用targetFactory返回一个target，然后通过factory.target = target来设置
         */
        const factory = new this.factoryConstructor();
        // 创建一个代理对象，这个代理对象代理的是factory对象
        const proxy = factory.createProxy();
        // ========debug================
        if (this.path === '/services/plugin-ext') {
            Reflect.defineProperty(proxy, "name", {
                value: "/services/plugin-ext"
            })
        }
        // ========debug================
        // 设置要处理rpc请求的对象target
        factory.target = this.targetFactory(proxy);
        // 监听rpc连接
        factory.listen(channel);
    }
}
/**
 * Factory for creating a new {@link RpcProtocol} for a given chanel and {@link RequestHandler}.
 */
export type RpcProtocolFactory = (channel: Channel, requestHandler: RequestHandler) => RpcProtocol;

const defaultRpcProtocolFactory: RpcProtocolFactory = (channel, requestHandler) => new RpcProtocol(channel, requestHandler);

/**
 * Factory for RPC proxy objects.
 *
 * A RPC proxy exposes the programmatic interface of an object through
 * Theia's RPC protocol. This allows remote programs to call methods of this objects by
 * sending RPC requests. This takes place over a bi-directional stream,
 * where both ends can expose an object and both can call methods on each other'
 * exposed object.
 *
 * For example, assuming we have an object of the following type on one end:
 *
 *     class Foo {
 *         bar(baz: number): number { return baz + 1 }
 *     }
 *
 * which we want to expose through a RPC interface.  We would do:
 *
 *     let target = new Foo()
 *     let factory = new RpcProxyFactory<Foo>('/foo', target)
 *     factory.onConnection(connection)
 *
 * The party at the other end of the `connection`, in order to remotely call
 * methods on this object would do:
 *
 *     let factory = new RpcProxyFactory<Foo>('/foo')
 *     factory.onConnection(connection)
 *     let proxy = factory.createProxy();
 *     let result = proxy.bar(42)
 *     // result is equal to 43
 *
 * One the wire, it would look like this:
 *
 *     --> { "type":"1", "id": 1, "method": "bar", "args": [42]}
 *     <-- { "type":"3", "id": 1, "res": 43}
 *
 * Note that in the code of the caller, we didn't pass a target object to
 * RpcProxyFactory, because we don't want/need to expose an object.
 * If we had passed a target object, the other side could've called methods on
 * it.
 *
 * @param <T> - The type of the object to expose to RPC.
 */

export class RpcProxyFactory<T extends object> implements ProxyHandler<T> {

    protected readonly onDidOpenConnectionEmitter = new Emitter<void>();
    protected readonly onDidCloseConnectionEmitter = new Emitter<void>();

    protected rpcDeferred: Deferred<RpcProtocol>;

    /**
     * Build a new RpcProxyFactory.
     *
     * @param target - The object to expose to RPC methods calls.  If this
     *   is omitted, the proxy won't be able to handle requests, only send them.
     */
    /**
     * 
     * target 是一个对象，将被暴露给远程过程调用（RPC）方法，这意味着通过 RPC，可以调用 target 对象上的方法。
     * 如果省略了 target 参数，代理将无法处理请求，只能发送请求。
     * 这种情况下，代理将仅作为客户端使用，而不能作为服务器端处理传入的 RPC 请求。
     */
    constructor(public target?: any, protected rpcProtocolFactory = defaultRpcProtocolFactory) {
        this.waitForConnection();
    }

    /**
     * 等待json-rpc连接
     * 实现逻辑就是创建一个deferred对象，
     * 在其他代码块中（listen方法）：当外部连接建立时，会调用deferred对象resolve方法，并将rpcProtocol对象传入
     * 此时逻辑就会走回这里，然后会触发onDidOpenConnectionEmitter事件
     */
    protected waitForConnection(): void {
        this.rpcDeferred = new Deferred<RpcProtocol>();
        this.rpcDeferred.promise.then(protocol => {
            protocol.channel.onClose(() => {
                this.onDidCloseConnectionEmitter.fire(undefined);
                // Wait for connection in case the backend reconnects
                this.waitForConnection();
            });
            this.onDidOpenConnectionEmitter.fire(undefined);
        });
    }

    /**
     * Connect a {@link Channel} to the factory by creating an {@link RpcProtocol} on top of it.
     *
     * This protocol will be used to send/receive RPC requests and
     * responses.
     */
    listen(channel: Channel): void {
        // console.log(`\x1b[1;3;30;44m%s\x1b[0m`, `\n==========>==========>在浏览器上调用RpxProxyFactory listen方法监听对应path的[channel: ${channel}]`,
        //     `[/Users/work/Third-Projects/theia/packages/core/src/common/messaging/proxy-factory.ts:180]`,
        //     `\n\n`
        // );

        // console.log(`\x1b[1;3;30;44m%s\x1b[0m`, `\n==========>==========>在浏览器上调用RpxProxyFactory rpcProtocolFactory创建用来发消息和处理消息的rpc protocol`,
        //     `[/Users/work/Third-Projects/theia/packages/core/src/common/messaging/proxy-factory.ts:185]`,
        //     `\n实际上这个步骤就是真正的监听对应path，然后接收发送消息以及使用RpxProxyFactory onRequest方法处理rpc发送来的method方法和方法参数args\n`
        // );
        /**
         * 绑定onRequest，你可以等待对端的请求到来时，触发这个方法
         */
        const protocol = this.rpcProtocolFactory(channel, (meth, args) => this.onRequest(meth, ...args));
        /**
         * 绑定onNotification，你可以等待对端的通知到来时，触发这个方法
         */
        protocol.onNotification(event => this.onNotification(event.method, ...event.args));

        // 通知deferred对象，rpc连接已经建立,并传入rpcProtocol对象
        // 这么做会触发waitForConnection方法中的promise.then方法
        this.rpcDeferred.resolve(protocol);
        // console.log(`\x1b[1;3;30;44m%s\x1b[0m`, `\n==========>==========>在浏览器上调用RpxProxyFactory this.rpcDeferred.resolve(protocol)表明rpc建立成功，并传入用来通讯的protocol`,
        //     `[/Users/work/Third-Projects/theia/packages/core/src/common/messaging/proxy-factory.ts:190]`,
        // );
    }

    /**
     * Process an incoming RPC method call.
     *
     * onRequest is called when the RPC connection received a method call
     * request.  It calls the corresponding method on [[target]].
     *
     * The return value is a Promise object that is resolved with the return
     * value of the method call, if it is successful.  The promise is rejected
     * if the called method does not exist or if it throws.
     *
     * @returns A promise of the method call completion.
     */
    protected async onRequest(method: string, ...args: any[]): Promise<any> {
        try {
            // 如果有暴露rpc对象，那么会调用这个对象的方法
            // 没有暴露rpc对象，那么会抛出异常
            // 这个target可以在构造函数中传入或者是通过factory.target来设置
            if (this.target) {
                if (method === "deploy") {
                    console.log(`\x1b[38;5;214m ###############🚀 ~ rpc proxy name 是${(this as any).name}[/Users/work/Third-Projects/theia/packages/core/src/common/messaging/proxy-factory.ts:196]\x1b[0m`);

                    // console.log(`\x1b[38; 5; 214m ###############🚀 ~等待target处理前端发过来的rpc请求...[/Users/work / Third - Projects / theia / packages / core / src / common / messaging / proxy - factory.ts: 203]\x1b[0m`);
                    // console.log(`\x1b[38; 5; 213m 此时的target是${this.target.constructor.name} \x1b[0m`);
                    console.log(`\x1b[38; 5; 213m 准备调用target的方法是${method} \x1b[0m`);
                    // console.log(`\x1b[38; 5; 213m 传递给target方法${method}的参数是${args} \x1b[0m`);
                }

                return await this.target[method](...args);
            } else {
                throw new Error(`no target was set to handle ${method} `);
            }
        } catch (error) {
            throw this.serializeError(error);
        }
    }

    /**
     * Process an incoming RPC notification.
     *
     * Same as [[onRequest]], but called on incoming notifications rather than
     * methods calls.
     */
    protected onNotification(method: string, ...args: any[]): void {
        // 如果有暴露rpc对象，那么会调用这个对象的方法
        if (this.target) {
            this.target[method](...args);
        }
    }

    /**
     * Create a Proxy exposing the interface of an object of type T.  This Proxy
     * can be used to do RPC method calls on the remote target object as
     * if it was local.
     *
     * If `T` implements `RpcServer` then a client is used as a target object for a remote target object.
     */
    /**
     * 该方法用于创建一个代理（Proxy），该代理暴露了类型为 T 的对象的接口。
     * 具体来说，这个代理可以用于对远程目标对象进行远程过程调用（RPC），就像它是本地对象一样。
     * 这意味着通过这个代理，可以像操作本地对象一样，调用类型为 T 的对象的方法和属性。
     * 如果 T 实现了 RpcServer 接口，那么客户端将被用作远程目标对象的目标对象。这意味着在这种情况下，代理不仅可以用于调用远程方法，
     * 还可以将客户端作为目标对象，处理来自远程目标对象的调用。
     * 这种双向通信机制使得代理不仅可以发送请求，还可以接收和处理请求，从而实现更复杂的交互模式。
     */
    createProxy(): RpcProxy<T> {
        // 创建一个代理对象，被代理的对象是当前对象自己，也就是rpcProxyFactory对象
        const result = new Proxy<T>(this as any, this);
        return result as RpcProxy<T>
    }

    /**
     * Get a callable object that executes a RPC method call.
     *
     * Getting a property on the Proxy object returns a callable that, when
     * called, executes a RPC call.  The name of the property defines the
     * method to be called.  The callable takes a variable number of arguments,
     * which are passed in the RPC method call.
     *
     * For example, if you have a Proxy object:
     *
     *     let fooProxyFactory = RpcProxyFactory<Foo>('/foo')
     *     let fooProxy = fooProxyFactory.createProxy()
     *
     * accessing `fooProxy.bar` will return a callable that, when called,
     * executes a RPC method call to method `bar`.  Therefore, doing
     * `fooProxy.bar()` will call the `bar` method on the remote Foo object.
     *
     * @param target - unused.
     * @param p - The property accessed on the Proxy object.
     * @param receiver - unused.
     * @returns A callable that executes the RPC call.
     */
    /**
     * 
     * @param target 首先，注释解释了该方法的主要功能：获取一个可调用对象，该对象执行 RPC 方法调用。
     * 这意味着通过代理对象，可以像调用本地方法一样，调用远程对象的方法。代理对象上的每个属性都对应一个远程方法，
     * 当访问这些属性时，会返回一个可调用对象。接下来，注释详细描述了如何使用这个代理对象。
     * 通过一个示例，注释展示了如何创建一个代理工厂并生成代理对象。
     * 例如，假设有一个代理工厂 RpcProxyFactory<Foo>('/foo')，通过调用 fooProxyFactory.createProxy() 可以创建一个代理对象 fooProxy。
     * 当访问 fooProxy.bar 时，会返回一个可调用对象，该对象在被调用时会执行对远程 Foo 对象的 bar 方法的 RPC 调用。
     * 因此，调用 fooProxy.bar() 实际上是在远程 Foo 对象上调用 bar 方法。
     * 注释解释了方法的参数和返回值。参数 target 和 receiver 未被使用，而参数 p 表示在代理对象上访问的属性。该方法返回一个可调用对象，该对象执行 RPC 调用。
     */
    get(target: T, p: PropertyKey, receiver: any): any {
        /**
         * 用户会调用对应接口的方法，由于使用的是proxy，所以会走get方法
         * 因为用户调用的是指定接口的方法，那么走get方法的话会返回的是一个函数
         * 比如：fooProxy.bar()，那么fooProxy.bar会返回一个函数，这个函数就是从这里返回的
         * 默认地，这个get方法会返回一个函数，这个函数会调用sendRequest方法，这个方法会返回一个promise
         */
        if (p === 'setClient') {
            return (client: any) => {
                this.target = client;
            };
        }
        if (p === 'getClient') {
            return () => this.target;
        }
        if (p === 'onDidOpenConnection') {
            return this.onDidOpenConnectionEmitter.event;
        }
        if (p === 'onDidCloseConnection') {
            return this.onDidCloseConnectionEmitter.event;
        }
        if (p === 'then') {
            // Prevent inversify from identifying this proxy as a promise object.
            return undefined;
        }
        const isNotify = this.isNotification(p);
        return (...args: any[]) => {
            const method = p.toString();
            const capturedError = new Error(`Request '${method}' failed`);
            return this.rpcDeferred.promise.then(rpcProtocol =>
                new Promise<void>((resolve, reject) => {
                    try {
                        if (isNotify) {
                            rpcProtocol.sendNotification(method, args);
                            resolve(undefined);
                        } else {
                            // 当用户调用指定接口的json-rpc方法时，因为是一个proxy，所以会走get方法
                            // 如果是发送rpc请求，那么会调用sendRequest方法，这个方法会返回一个promise
                            const resultPromise = rpcProtocol.sendRequest(method, args) as Promise<any>;
                            resultPromise
                                .catch((err: any) => reject(this.deserializeError(capturedError, err)))
                                .then((result: any) => resolve(result));
                        }
                    } catch (err) {
                        reject(err);
                    }
                })
            );
        };
    }

    /**
     * Return whether the given property represents a notification.
     *
     * A property leads to a notification rather than a method call if its name
     * begins with `notify` or `on`.
     *
     * @param p - The property being called on the proxy.
     * @return Whether `p` represents a notification.
     */
    protected isNotification(p: PropertyKey): boolean {
        return p.toString().startsWith('notify') || p.toString().startsWith('on');
    }

    protected serializeError(e: any): any {
        if (ApplicationError.is(e)) {
            return new ResponseError(e.code, '',
                Object.assign({ kind: 'application' }, e.toJson())
            );
        }
        return e;
    }
    protected deserializeError(capturedError: Error, e: any): any {
        if (e instanceof ResponseError) {
            const capturedStack = capturedError.stack || '';
            if (e.data && e.data.kind === 'application') {
                const { stack, data, message } = e.data;
                return ApplicationError.fromJson(e.code, {
                    message: message || capturedError.message,
                    data,
                    stack: `${capturedStack} \nCaused by: ${stack} `
                });
            }
            e.stack = capturedStack;
        }
        return e;
    }

}

/**
 * @deprecated since 1.39.0 use `RpcConnectionEventEmitter` instead
 */
export type JsonRpcConnectionEventEmitter = RpcConnectionEventEmitter;

/**
 * @deprecated since 1.39.0 use `RpcServer` instead
 */
export type JsonRpcServer<Client> = RpcServer<Client>;

/**
 * @deprecated since 1.39.0 use `RpcProxy` instead
 */
export type JsonRpcProxy<T> = RpcProxy<T>;

/**
 * @deprecated since 1.39.0 use `RpcConnectionHandler` instead
 */
export class JsonRpcConnectionHandler<T extends object> extends RpcConnectionHandler<T> {

}

/**
 * @deprecated since 1.39.0 use `RpcProxyFactory` instead
 */
export class JsonRpcProxyFactory<T extends object> extends RpcProxyFactory<T> {

}

// eslint-disable-next-line deprecation/deprecation
decorate(injectable(), JsonRpcProxyFactory);
// eslint-disable-next-line deprecation/deprecation
decorate(unmanaged(), JsonRpcProxyFactory, 0);

