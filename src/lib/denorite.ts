
import { writable, get } from 'svelte/store';
import type { Writable } from 'svelte/store';
import { DenoriteClient, type ServerInfo } from './DenoriteClient';

interface DenoriteState {
  isConnected: boolean;
  isAuthenticated: boolean;
  isOperator: boolean;
  username: string | null;
  serverInfo: ServerInfo | null;
}

class DenoriteStore {
  private client: DenoriteClient;
  private store: Writable<DenoriteState>;

  constructor() {
    this.client = new DenoriteClient({
      autoReconnect: true,
      storage: localStorage
    });

    this.store = writable<DenoriteState>({
      isConnected: false,
      isAuthenticated: false,
      isOperator: false,
      username: null,
      serverInfo: null
    });

    // Set up event handlers
    this.client.on('authenticated', (user) => {
      this.store.update(state => ({
        ...state,
        isAuthenticated: true,
        isOperator: this.client.isOperator(),
        username: user.username
      }));
    });

    this.client.on('disconnected', () => {
      this.store.update(state => ({
        ...state,
        isConnected: false,
        isAuthenticated: false,
        isOperator: false,
        username: null,
        serverInfo: null
      }));
    });

    this.client.on('error', (error) => {
      console.error('DenoriteClient error:', error);
    });
  }

  async connect(url: string): Promise<void> {
    try {
      // First connect
      await this.client.connect(url);

      // Wait for initial server info
      await new Promise<void>((resolve, reject) => {
        const handler = (info: any) => {
          this.store.update(state => ({
            ...state,
            serverInfo: info
          }));
          this.client.unregisterMessageHandler('server_info_handler');
          resolve();
        };

        this.client.registerMessageHandler('server_info_handler', handler);

        // Shorter timeout for initial connection
        setTimeout(() => {
          this.client.unregisterMessageHandler('server_info_handler');
          reject(new Error('Did not receive server info'));
        }, 2000);
      });

      // Update connection state
      this.store.update(state => ({
        ...state,
        isConnected: true
      }));

      // Register handler for second server info after auth
      this.client.registerMessageHandler('post_auth_info', (info: any) => {
        this.store.update(state => ({
          ...state,
          serverInfo: info
        }));
      });

    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    }
  }

  async loginWithTicket(ticket: string): Promise<void> {
    try {
      await this.client.loginWithTicket(ticket);
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  disconnect(): void {
    this.client.disconnect();
  }

  logout(): void {
    this.client.logout();
  }

  async executeCommand(command: string, parameters?: Record<string, any>): Promise<any> {
    const state = get(this.store);
    if (!state.isConnected) {
      throw new Error('Not connected to server');
    }

    try {
      const result = await this.client.executeCommand(command, parameters);
      return result;
    } catch (error) {
      console.error('Command execution error:', error);
      throw error;
    }
  }

  getStore() {
    return {
      subscribe: this.store.subscribe,
      isConnected: () => get(this.store).isConnected,
      isAuthenticated: () => get(this.store).isAuthenticated,
      isOperator: () => get(this.store).isOperator,
      username: () => get(this.store).username,
      serverInfo: () => get(this.store).serverInfo
    };
  }

  getAvailableServers(): string[] {
    return this.client.getRecentServers();
  }
}

// Export a singleton instance
export const denoriteStore = new DenoriteStore();
