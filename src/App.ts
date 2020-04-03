import { HttpServer } from './servers/Http.server'
import { WebsocketServer } from './servers/Websocket.server'
import { WebhookServer } from './servers/Webhook.server'
import { Context } from './Context'

export class App {

  private readonly context: Context = new Context()
  private httpServer: HttpServer
  private websocketServer: WebsocketServer
  private webhookServer: WebhookServer
  constructor() {
    this.httpServer = new HttpServer(this.context)
    this.websocketServer = new WebsocketServer(this.context)
    this.webhookServer = new WebhookServer(this.context)
  }
}