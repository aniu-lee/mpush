import * as Http from "http"
import * as Url from "url"
import * as querystring from 'querystring';
import { Context } from "../Context";
import { Message } from "../model/Message.model";
import { ClientSocketPacket, MessageClientSocketPacket, MgsCbClientSocketPacket } from "../model/ClientSocketPacket";
import * as Utils from '../Utils'
import { MsgReplyServerSocketPacket, InfoServerSocketPacket } from "../model/ServerSocketPacket";

export class HttpServer {

  private httpServer: Http.Server
  private messageMap: Map<Message, Http.ServerResponse> = new Map()
  constructor(
    private readonly context: Context
  ) {
    this.httpServer = Http.createServer(this.httpHandle.bind(this))
    this.httpServer.listen(this.context.config.http.port)
    this.context.ebus.on('message-end', this.messageEndHandle.bind(this))
  }
  private async httpHandle(request: Http.IncomingMessage, response: Http.ServerResponse) {
    try {
      response.setHeader('content-type', 'application/json; charset=utf-8')
      this.verifyToken(request)
      if (request.method === 'GET') {
        const { sendType, target } = this.verifyUrl(<string>request.url)
        let payload: {
          text: string,
          desp: string,
          extra: TypeObject<string>
        } = {
          text: '',
          desp: '',
          extra: {}
        }
        payload = this.verifyGet(request)
        const message = new Message({
          sendType,
          target,
          from: {
            method: 'http',
            name: ''
          },
          message: payload
        })
        this.messageMap.set(message, response)
        this.context.ebus.emit('message-start', message)
        setTimeout(() => {
          this.messageEndHandle({
            message,
            status: this.context.messageManager.getMessageStatus(message.mid)
          })
        }, this.context.config.http.waitTimeout)
      } else if (request.method === 'POST') {
        const clientSocketPacket = await this.verifyPost(request)
        switch (clientSocketPacket.cmd) {
          case 'MESSAGE':
            this.runCmdMessage(clientSocketPacket, response)
            break
          case 'MESSAGE_CALLBACK':
            this.runCmdMgsCb(clientSocketPacket, response)
            break
          // case 'MESSAGE_FCM_CALLBACK':
          //   this.runCmdMgsFcmCb(clientSocketPacket, response)
          //   break
          default:
            throw new Error(`Unknow cmd: ${clientSocketPacket.cmd}`)
        }
      }
    } catch (e) {
      console.error(e)
      response.statusCode = 500
      response.end(JSON.stringify(new InfoServerSocketPacket(e.message)))
    }
  }
  private runCmdMessage(clientSocketPacket: ClientSocketPacket, response: Http.ServerResponse) {
    const packet = new MessageClientSocketPacket(clientSocketPacket)
    const message = new Message({
      sendType: packet.data.sendType,
      target: packet.data.target,
      from: {
        method: 'http',
        name: clientSocketPacket?.auth?.name || '',
      },
      message: packet.data.message
    })
    this.messageMap.set(message, response)
    this.context.ebus.emit('message-start', message)
    setTimeout(() => {
      this.messageEndHandle({
        message,
        status: this.context.messageManager.getMessageStatus(message.mid)
      })
    }, this.context.config.http.waitTimeout)
  }
  /**
   * 消息送达回调
   * @param clientSocketPacket 
   * @param response 
   */
  private runCmdMgsCb(clientSocketPacket: ClientSocketPacket, response: Http.ServerResponse) {
    if (clientSocketPacket.auth) {
      let packet = new MgsCbClientSocketPacket(clientSocketPacket)
      this.context.ebus.emit('message-client-status', {
        mid: packet.data.mid,
        name,
        status: 'ok'
      })
      response.end(JSON.stringify(new InfoServerSocketPacket("ok")))
    } else {
      response.end(JSON.stringify(new InfoServerSocketPacket("The MESSAGE_CALLBACK cmd must need auth.")))
    }
  }
  /**
   * FCM送达回调
   * @param clientSocketPacket 
   * @param response 
   */
  // private runCmdMgsFcmCb(clientSocketPacket: ClientSocketPacket, response: Http.ServerResponse) {
  //   if (clientSocketPacket.auth) {
  //     let packet = new MgsCbClientSocketPacket(clientSocketPacket)

  //     this.context.ebus.emit('message-fcm-callback', {
  //       mid: packet.data.mid,
  //       name
  //     })
  //     response.end(JSON.stringify(new InfoServerSocketPacket("ok")))
  //   } else {
  //     response.end(JSON.stringify(new InfoServerSocketPacket("The MESSAGE_CALLBACK cmd must need auth.")))
  //   }
  // }
  private messageEndHandle(payload: {
    message: Message,
    status: TypeObject<MessageStatus>
  }): void {
    try {
      const response = this.messageMap.get(payload.message)
      response?.end(JSON.stringify(new MsgReplyServerSocketPacket(payload.message.mid, payload.status)))
    } catch (e) { }
    this.messageMap.delete(payload.message)
  }
  private verifyToken(request: Http.IncomingMessage): void {
    if (this.context.config.http.verifyToken) {
      if (request.headers['authorization:'] !== this.context.config.token) {
        throw new Error(`Authorization verify error: ${request.headers['authorization']}`)
      }
    }

  }
  private verifyUrl(url: string): {
    sendType: "personal" | "group",
    target: string
  } {
    const pathname = Url.parse(url).pathname || ""
    if (/\/(.*?)\.(send|group)/.test(pathname)) {
      const args = pathname.match(/^\/(.*?)\.(.*?)$/)
      if (args) {
        return {
          sendType: args[2] === 'send' ? 'personal' : 'group',
          target: args[1]
        }
      } else {
        throw new Error(`pathname verify error: ${pathname}`)
      }
    } else {
      throw new Error(`pathname verify error: ${pathname}`)
    }
  }
  private verifyGet(request: Http.IncomingMessage): {
    text: string,
    desp: string,
    extra: TypeObject<string>
  } {
    const { query } = Url.parse(<string>request.url, true)
    let extra = {
      ...<TypeObject<string>>query
    }
    delete extra.text
    delete extra.desp
    return {
      text: String(query.text || "") || "",
      desp: String(query.desp || "") || "",
      extra
    }
  }
  private async verifyPost(request: Http.IncomingMessage): Promise<ClientSocketPacket> {
    const requestBody = await new Promise<string>((resolve, reject) => {
      let raw: string = ''
      request.on('data', (chunk) => {
        raw += chunk
      })
      request.on('end', () => {
        resolve(raw)
      })
    })
    let body = this.bodyparser(request.headers, requestBody)
    return Utils.decodeSocketData(body)
  }
  /**
   * 返回json字符串
   * @param headers 
   * @param raw 
   */
  private bodyparser(headers: Http.IncomingHttpHeaders, raw: string): string {
    let result = ""
    let contentType = headers['content-type']
    try {
      if (/www-form-urlencoded/.test(<string>contentType)) {
        result = JSON.stringify(querystring.parse(raw))
      } else if (/json/.test(<string>contentType)) {
        result = raw
      } else {
        throw new Error(`Unsupported Content Type: ${contentType}`)
      }
    } catch (e) {
      throw new Error(`Unsupported Content Type: ${contentType}`)
    }
    return result
  }
}

class HttpClient {

  constructor() {

  }
}