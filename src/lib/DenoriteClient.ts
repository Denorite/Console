// Core types for the SDK
export type ServerRole = 'guest' | 'player' | 'operator' | 'system';

export interface User {
  username: string;
  role: ServerRole;
}

export interface ServerConnection {
  url: string;
  minecraftUrl?: string;
  token?: string;
  username?: string;
  isOp?: boolean;
  lastConnected: string;
}

export interface ServerInfo {
  type: 'server_info';
  commands: CommandDefinition[];
  extras: {
    apps: AppDefinition[];
  };
}

export interface AppDefinition {
  name: string;
  title: string;
  icon: string;
  permission: string;
  checksum: string;
  height?: number;
  width?: number;
}

export interface CommandDefinition {
  name: string;
  description?: string;
  permissions: ServerRole[];  // Changed to array
  path?: string[];           // Added path
  usage?: string;            // Added usage
  parameters?: CommandParameter[];
}

export interface CommandParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  description?: string;
  required?: boolean;
  default?: any;
}

export interface MessageOptions {
  timeout?: number;
}

// Event emitter for handling WebSocket events
export class EventEmitter {
  private handlers: Map<string, Set<(data: any) => void>> = new Map();

  on(event: string, handler: (data: any) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: (data: any) => void): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  emit(event: string, data: any): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }
}

// Core client class
export class DenoriteClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private messageCounter = 0;
  private pendingMessages = new Map<string, PendingMessage>();
  private messageHandlers = new Map<string, MessageHandler>();
  private commands = new Map<string, CommandDefinition>();
  private reconnectAttempts = 0;
  private currentServer = '';
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_DELAY = 2000;
  private readonly DEFAULT_MESSAGE_TIMEOUT = 30000;

  private serverConnections = new Map<string, ServerConnection>();
  private user: User | null = null;

  constructor(private options: DenoriteOptions = {}) {
    super();
    this.setupStorageSync();
  }

  // Connection management
  async connect(url: string): Promise<void> {
    if (this.socket) {
      this.disconnect();
    }

    this.currentServer = url;

    try {
      this.socket = new WebSocket(url);
      this.setupSocketHandlers();

      await this.waitForConnection();
      this.updateServerConnection(url);

      const storedConnection = this.serverConnections.get(url);
      if (storedConnection?.token) {
        await this.authenticate(storedConnection.token);
      }
    } catch (error) {
      throw new Error(`Failed to connect: ${error.message}`);
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.currentServer = '';
      this.user = null;
      this.emit('disconnected', null);
    }
  }

  // Authentication
  // Authentication via ticket
  async loginWithTicket(ticket: string): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    return new Promise((resolve, reject) => {
      const handler = (data: any) => {
        console.log('Auth response:', data);
        if (data.type === 'auth_failed') {
          this.socket?.removeEventListener('message', handler);
          reject(new Error(data.message || 'Authentication failed'));
        } else if (data.type === 'authenticated') {
          this.socket?.removeEventListener('message', handler);
          this.handleAuthResponse(data);
          resolve();
        }
      };

      this.socket.addEventListener('message', (event) => {
        handler(JSON.parse(event.data));
      });

      try {
        this.socket.send(JSON.stringify({
          eventType: 'ticket_module',
          data: { ticket },
          messageId: this.generateMessageId()
        }));
      } catch (error) {
        reject(new Error(`Failed to send ticket: ${error.message}`));
      }
    });
  }

  // Token-based authentication
  async authenticate(token: string): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    return new Promise((resolve, reject) => {
      const handler = (data: any) => {
        console.log('Auth response:', data);
        if (data.type === 'auth_failed') {
          this.socket?.removeEventListener('message', handler);
          reject(new Error(data.message || 'Authentication failed'));
        } else if (data.type === 'authenticated') {
          this.socket?.removeEventListener('message', handler);
          this.handleAuthResponse(data);
          resolve();
        }
      };

      this.socket.addEventListener('message', (event) => {
        handler(JSON.parse(event.data));
      });

      try {
        this.socket.send(JSON.stringify({
          eventType: 'auth',
          data: { token },
          messageId: this.generateMessageId()
        }));
      } catch (error) {
        reject(new Error(`Failed to send auth message: ${error.message}`));
      }
    });
  }

  logout(): void {
    if (this.currentServer) {
      const connection = this.serverConnections.get(this.currentServer);
      if (connection) {
        this.serverConnections.set(this.currentServer, {
          ...connection,
          token: undefined,
          username: undefined,
          isOp: undefined
        });
      }
    }
    this.user = null;
    this.emit('logout', null);
  }

  // Message handling
  async sendMessage<T = any>(type: string, data: any, options: MessageOptions = {}): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const messageId = this.generateMessageId();
    const timeout = options.timeout || this.DEFAULT_MESSAGE_TIMEOUT;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.cleanupPendingMessage(messageId);
        reject(new Error('Message timeout'));
      }, timeout);

      this.pendingMessages.set(messageId, { resolve, reject, timeout: timeoutId });

      this.socket!.send(JSON.stringify({
        eventType: type,
        data,
        messageId
      }));
    });
  }

  // Server management
  getServerConnection(url: string): ServerConnection | undefined {
    return this.serverConnections.get(url);
  }

  getCurrentServer(): string {
    return this.currentServer;
  }

  getRecentServers(): string[] {
    return Array.from(this.serverConnections.keys())
      .sort((a, b) => {
        const aConn = this.serverConnections.get(a)!;
        const bConn = this.serverConnections.get(b)!;
        return new Date(bConn.lastConnected).getTime() -
          new Date(aConn.lastConnected).getTime();
      })
      .slice(0, 5);
  }

  // User state
  isAuthenticated(): boolean {
    return this.user !== null;
  }

  isOperator(): boolean {
    return this.user?.role === 'operator' || this.user?.role === 'system';
  }

  getUsername(): string | undefined {
    return this.user?.username;
  }

  // Message handler registration
  registerMessageHandler(id: string, handler: (data: any) => void): void {
    this.messageHandlers.set(id, { id, handler });
  }

  unregisterMessageHandler(id: string): void {
    this.messageHandlers.delete(id);
  }

  // Private helper methods
  private generateMessageId(): string {
    this.messageCounter = (this.messageCounter + 1) % Number.MAX_SAFE_INTEGER;
    return `msg_${Date.now()}_${this.messageCounter}`;
  }

  private cleanupPendingMessage(messageId: string): void {
    const pending = this.pendingMessages.get(messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingMessages.delete(messageId);
    }
  }

  private updateServerConnection(url: string): void {
    const existing = this.serverConnections.get(url);
    const connection: ServerConnection = {
      ...(existing || {}),
      url,
      lastConnected: new Date().toISOString()
    };
    this.serverConnections.set(url, connection);
    this.syncStorage();
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.emit('connected', null);
    };

    this.socket.onclose = () => {
      if (this.options.autoReconnect && this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        this.attemptReconnect();
      } else {
        this.emit('disconnected', null);
      }
    };

    this.socket.onmessage = (event) => {
      this.handleWebSocketMessage(JSON.parse(event.data));
    };

    this.socket.onerror = (error) => {
      this.emit('error', error);
    };
  }

  // Message handling
  private handleWebSocketMessage(data: any): void {
    console.log('Received WebSocket message:', data);

    // Handle pending message responses
    const messageId = data.messageId || (data.data && data.data.messageId);
    if (messageId && this.pendingMessages.has(messageId)) {
      this.handlePendingMessage(messageId, data);
      return;
    }

    // Execute message handlers
    this.messageHandlers.forEach(handler => {
      try {
        handler.handler(data);
      } catch (error) {
        console.error(`Error in message handler ${handler.id}:`, error);
      }
    });

    // Handle server events
    switch (data.type) {
      case 'authenticated':
      case 'auth_response':
        if (data.success) {
          this.handleAuthResponse(data);
        }
        break;
      case 'auth_failed':
        if (this.currentServer) {
          const connection = this.serverConnections.get(this.currentServer);
          if (connection) {
            this.serverConnections.set(this.currentServer, {
              ...connection,
              token: undefined,
              username: undefined,
              isOp: undefined
            });
            this.syncStorage();
          }
        }
        this.emit('error', new Error(data.message || 'Authentication failed'));
        break;
      case 'server_info':
        this.handleServerInfo(data);
        break;
      case 'apps_list':
        this.emit('appsList', data.apps);
        break;
      case 'tellraw':
        this.emit('message', data.message);
        break;
      case 'error':
        this.emit('error', new Error(data.error || data.message));
        break;
      case 'command_response':
        this.emit('commandResponse', data);
        break;
      default:
        this.emit('raw', data);
    }
  }

  private handleServerInfo(data: ServerInfo): void {
    if (data?.commands) {
      data.commands.forEach(command => {
        const key = command.path ? command.path.join(' ') : command.name;
        this.commands.set(key, command);
        console.log(`Registered command: ${key}`);  // Debug log
      });
    }
    this.emit('serverInfo', data);
  }

  private handleAuthResponse(data: any): void {
    console.log('Handling auth response:', data); // Debug logging

    if (data.type === 'auth_response' || data.type === 'authenticated') {
      if (data.error) {
        this.emit('error', new Error(data.error));
        return;
      }

      const userData = data.user || data.data?.user;
      if (!userData) {
        this.emit('error', new Error('Invalid authentication response'));
        return;
      }

      this.user = userData;

      if (this.currentServer) {
        const connection = this.serverConnections.get(this.currentServer);
        if (connection) {
          this.serverConnections.set(this.currentServer, {
            ...connection,
            token: data.token || data.data?.token,
            username: userData.username,
            isOp: userData.role === 'operator' || userData.role === 'system',
            minecraftUrl: data.minecraftUrl || data.data?.minecraftUrl
          });
          this.syncStorage();
        }
      }

      this.emit('authenticated', this.user);
    }
  }

  // Command management
  getAvailableCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  getCommand(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  async executeCommand(commandStr: string, parameters?: Record<string, any>): Promise<any> {
    const command = Array.from(this.commands.values()).find(cmd => {
      if (!cmd.path) {
        return cmd.name === commandStr;
      }
      return cmd.path.join(' ') === commandStr;
    });

    if (!command) {
      throw new Error(`Command '${commandStr}' not found`);
    }

    // Check permissions - now handles array of permissions
    if (!command.permissions.includes('guest') && !this.isAuthenticated()) {
      throw new Error('Authentication required for this command');
    }

    if (command.permissions.includes('operator') && !this.isOperator()) {
      throw new Error('Operator privileges required for this command');
    }

    try {
      const response = await this.sendMessage(commandStr.replace(/ /g,"_"), {
        command: commandStr,
        args: parameters || {}  // Send as 'args' not 'parameters'
      });
      return response;
    } catch (error) {
      throw new Error(`Failed to execute command '${commandStr}': ${error.message}`);
    }
  }

  private validateCommandParameters(command: CommandDefinition, parameters: Record<string, any> = {}): void {
    if (!command.parameters) return;

    for (const param of command.parameters) {
      if (param.required && !(param.name in parameters)) {
        throw new Error(`Required parameter '${param.name}' missing for command '${command.name}'`);
      }

      if (param.name in parameters) {
        const value = parameters[param.name];
        const valueType = typeof value;

        if (valueType !== param.type && !(param.type === 'object' && valueType === 'object')) {
          throw new Error(
            `Invalid type for parameter '${param.name}' in command '${command.name}'. Expected ${param.type}, got ${valueType}`
          );
        }
      }
    }
  }

  private handlePendingMessage(messageId: string, data: any): void {
    const pending = this.pendingMessages.get(messageId)!;
    this.cleanupPendingMessage(messageId);

    if (data.error) {
      pending.reject(new Error(data.error));
    } else if (!data.success) {
      pending.reject(new Error('Request failed'));
    } else {
      pending.resolve(data.data || data);
    }
  }

  private async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++;
    await new Promise(resolve => setTimeout(resolve, this.RECONNECT_DELAY));
    this.connect(this.currentServer);
  }

  private async waitForConnection(): Promise<void> {
    if (!this.socket) throw new Error('No socket instance');

    if (this.socket.readyState === WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      this.socket!.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });

      this.socket!.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Connection failed'));
      }, { once: true });
    });
  }

  // Storage synchronization
  private setupStorageSync(): void {
    if (this.options.storage) {
      const stored = this.options.storage.getItem('denorite_connections');
      if (stored) {
        try {
          const connections = JSON.parse(stored);
          Object.entries(connections).forEach(([url, connection]) => {
            this.serverConnections.set(url, connection as ServerConnection);
          });
        } catch (error) {
          console.error('Failed to load stored connections:', error);
        }
      }
    }
  }

  private syncStorage(): void {
    if (this.options.storage) {
      const connections = Object.fromEntries(this.serverConnections.entries());
      this.options.storage.setItem('denorite_connections', JSON.stringify(connections));
    }
  }
}

// SDK configuration options
export interface DenoriteOptions {
  autoReconnect?: boolean;
  storage?: Storage;
}

// Message types
interface PendingMessage {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: NodeJS.Timeout;
}

interface MessageHandler {
  id: string;
  handler: (data: any) => void;
}
