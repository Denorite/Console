<script lang="ts">
  import { onMount } from 'svelte';
  import { denoriteStore } from '../lib/denorite';
  import type { CommandDefinition } from '../lib/DenoriteClient';

  const store = denoriteStore.getStore();

  let inputElement: HTMLInputElement;
  let resultsRef: HTMLDivElement;
  let showSuggestions = false;
  let selectedSuggestionIndex = 0;

  type ColoredSegment = {
    text: string;
    color?: string;
  };

  type ColoredLine = {
    type: 'colored-line';
    segments: ColoredSegment[];
  };

  type ConsoleLine = string | ColoredLine;

  // State management
  let consoleInput = '';
  let consoleHistory: ConsoleLine[] = [];
  let commandHistory: string[] = [];
  let historyIndex = -1;
  let lastConnectedServer: string | null = null;
  let loading = false;

  // Command state
  let commandState = {
    mode: 'command',
    parts: [],
    arguments: [],
    currentCommand: null as CommandDefinition | null,
    currentArgIndex: -1
  };

  // Colors
  const COLORS = {
    CORK_BROWN: '#CD853F',
    GLASS_BLUE: '#ADD8E6',
    POTION_PINK: '#FFB6C1',
    POTION_BRIGHT: '#FF69B4',
    POTION_DIM: '#DDA0DD',
    HIGHLIGHT: '#FFFFFF'
  };

  // Built-in commands
  const BUILT_IN_COMMANDS = {
    clear: () => {
      consoleHistory = [];
      return 'Console cleared';
    },
    help: () => formatHelp(),
    servers: () => listServers(),
    connect: (url: string) => handleConnect(url),
    disconnect: () => {
      denoriteStore.disconnect();
      return 'Disconnected from server';
    },
    login: (token: string) => handleLogin(token),
    logout: () => {
      denoriteStore.logout();
      return 'Logged out';
    }
  };

  function getColorForChar(char: string, lineIndex: number): string | undefined {
    // Cork area detection (top 3 lines where 'o' appears)
    const isInCorkArea = lineIndex < 4 && char === 'o';

    switch(char) {
            // Cork - only at the top
      case 'o':
        return isInCorkArea ? COLORS.CORK_BROWN : COLORS.GLASS_BLUE;
            // Glass outline and details
      case 'c':
      case ':':
      case ';':
        return COLORS.GLASS_BLUE;
            // Potion liquid - brighter parts
      case 'X':
      case 'K':
      case 'N':
      case 'W':
        return COLORS.POTION_BRIGHT;
            // Shadows and depth
      case 'd':
      case 'O':
        return COLORS.POTION_DIM;
            // Highlights and sparkles
      case '.':
      case '\'':
        return COLORS.HIGHLIGHT;
      default:
        return undefined;
    }
  }

  function displayPotionArt() {
    const potionArtRaw = [
      "                                  ",
      "                           .......",
      "                          :ooooool;;;.",
      "                      .,,,odddddddlll:'''",
      "                      cXXX0OOOOOOOOOO0000.",
      "                      :KKKxooooooolllx000.",
      "                      ;000l;;;;;;;,,,o000.",
      "                      .'''oxxx::::ccc;'''",
      "                          d000ccccooo'",
      "                          d000;;;:ooo'",
      "                          d000;;;:ooo'",
      "                      ;000l:::;;;;;;;:ccc",
      "                      cXXXl;;;;;;;;;;cooo.",
      "                  .XXXOdddO000dddo;;;:ccclooo",
      "               .. ,XXXOdddOOOOdddo:::cllloooo",
      "               XXXKdddk000occcOOOOOOO0XXXxdddooo:",
      "               XXXKdddk000dlllOOOOOOOKXXXOxxxooo:",
      "               XXXKdddk000OOOOXXXXXXXXXXXXXXXooo:",
      "               XXX0dddk0000000XXXXNNNXXXXXXXXooo:",
      "               000OdddxOOOKXXXXXXXWWWNXXXXXXXooo:",
      "               xxxxxxxO000XXXXNNNNWWWNNNNK000ooo:",
      "               ooodOOO0XXXXXXXWWWWWWWWWWW0OOOooo:",
      "               ...'dddk000XNNNWWWWWWWX000xddd....",
      "                  .oooxOOOXWWWWWWWWWWKOOOdooo",
      "                   ...,ddddxxxxxxxxxxdddd....",
      "                      'oooooooooooooooooo.",
      "                                          ",
      " Denorite v1.1.1 — type help for commands."
    ];

    // Convert each line into colored segments
    const coloredLines = potionArtRaw.map((line, lineIndex) => {
      const segments: ColoredSegment[] = [];
      let currentColor: string | undefined = undefined;
      let currentText = '';

      // Process each character
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const color = getColorForChar(char, lineIndex);

        // If color changes or we're at the end of the line, create a new segment
        if (color !== currentColor || i === line.length - 1) {
          if (currentText) {
            segments.push({
              text: currentText,
              color: currentColor
            });
          }
          currentText = char;
          currentColor = color;
        } else {
          currentText += char;
        }
      }

      // Add the last segment if there's any remaining text
      if (currentText) {
        segments.push({
          text: currentText,
          color: currentColor
        });
      }

      return {
        type: 'colored-line' as const,
        segments
      };
    });

    // Add the version text with highlight color
    coloredLines[coloredLines.length - 1] = {
      type: 'colored-line',
      segments: [{
        text: " Denorite v1.1.1 — type help for commands.",
        color: COLORS.HIGHLIGHT
      }]
    };

    consoleHistory = [...consoleHistory, '', ...coloredLines, ''];
  }

  function listServers(): string {
    const servers = denoriteStore.getAvailableServers();
    if (servers.length === 0) {
      return 'No recent servers found';
    }
    return 'Available servers:\n' + servers.map(s => `  ${s}`).join('\n');
  }

  async function attemptReconnect() {
    const servers = denoriteStore.getAvailableServers();
    if (servers.length > 0) {
      const lastServer = servers[0];
      try {
        consoleHistory = [...consoleHistory, `Attempting to reconnect to ${lastServer}...`];
        await handleConnect(lastServer);
        lastConnectedServer = lastServer;
      } catch (error) {
        consoleHistory = [...consoleHistory, `Reconnection failed: ${error.message}`];
      }
    }
  }

  async function handleConnect(url: string): Promise<string> {
    try {
      await denoriteStore.connect(url);
      if ($store.serverInfo) {
        displayServerInfo($store.serverInfo);
      }
      return `Connected to ${url}`;
    } catch (error) {
      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  async function handleLogin(ticket: string): Promise<string> {
    if (!$store.isConnected) {
      throw new Error('Not connected to any server');
    }
    try {
      await denoriteStore.loginWithTicket(ticket);
      if ($store.serverInfo) {
        displayServerInfo($store.serverInfo);
      }
      return 'Successfully authenticated';
    } catch (error) {
      throw error;
    }
  }

  function convertParamType(value: string, type: string): any {
    switch (type) {
      case 'number':
        const num = Number(value);
        if (isNaN(num)) throw new Error('Invalid number parameter');
        return num;
      case 'boolean':
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
        throw new Error('Invalid boolean parameter');
      case 'object':
        try {
          return JSON.parse(value);
        } catch {
          throw new Error('Invalid JSON object parameter');
        }
      default:
        return value;
    }
  }

  function formatHelp(): string {
    let help = 'Available Commands:\n\n';
    help += 'Built-in Commands:\n';
    help += '  clear           - Clear console\n';
    help += '  help            - Show this help message\n';
    help += '  servers         - List available servers\n';
    help += '  connect <url>   - Connect to a server\n';
    help += '  disconnect      - Disconnect from current server\n';
    help += '  login <token>   - Authenticate with token\n';
    help += '  logout          - Log out from current session\n\n';

    if ($store.isConnected && $store.serverInfo?.commands) {
      help += 'Server Commands:\n';
      const commandGroups = new Map<string, any[]>();

      $store.serverInfo.commands.forEach(cmd => {
        const rootCmd = cmd.path?.[0] || cmd.name;
        if (!commandGroups.has(rootCmd)) {
          commandGroups.set(rootCmd, []);
        }
        commandGroups.get(rootCmd)!.push(cmd);
      });

      commandGroups.forEach((cmds, rootCmd) => {
        const rootCmdDef = cmds.find(c => !c.path || c.path.length === 1);
        if (rootCmdDef) {
          help += `  ${rootCmdDef.name}${rootCmdDef.usage ? ' ' + rootCmdDef.usage : ''}`.padEnd(30) +
                  `- ${rootCmdDef.description || 'No description'}\n`;
        }

        cmds.filter(c => c.path && c.path.length > 1).forEach(subcmd => {
          const subName = subcmd.path!.join(' ');
          help += `    ${subName}${subcmd.usage ? ' ' + subcmd.usage : ''}`.padEnd(30) +
                  `- ${subcmd.description || 'No description'}\n`;
        });
        help += '\n';
      });
    }

    return help;
  }

  $: filteredSuggestions = getFilteredSuggestions(consoleInput, $store.serverInfo?.commands || []);

  function getFilteredSuggestions(input: string, commands: CommandDefinition[]) {
    if (commandState.mode === 'argument') {
      const currentArg = commandState.arguments[commandState.currentArgIndex];
      if (!currentArg) return [];

      switch (currentArg.type) {
        case 'player':
          return ['player1', 'player2', 'player3'].filter(name =>
                  name.toLowerCase().includes(input.toLowerCase())
          );
        default:
          return [];
      }
    }

    const searchStr = input.toLowerCase();
    return commands
            .filter(cmd => {
              const cmdPath = cmd.path?.join(' ').toLowerCase() || cmd.name.toLowerCase();
              return cmdPath.includes(searchStr);
            })
            .map(cmd => ({
              ...cmd,
              displayText: cmd.path?.join(' ') || cmd.name,
              type: 'command'
            }));
  }

  async function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Tab':
        event.preventDefault();
        handleTabComplete(event.shiftKey);
        break;
      case 'Enter':
        event.preventDefault();
        await handleEnter();
        break;
      case 'Escape':
        event.preventDefault();
        handleEscape();
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          navigateHistory(-1);
        } else {
          navigateSuggestions(-1);
        }
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          navigateHistory(1);
        } else {
          navigateSuggestions(1);
        }
        break;
      case 'Backspace':
        if (!consoleInput) {
          event.preventDefault();
          handleBackspace();
        }
        break;
    }
  }

  function handleTabComplete(reverse: boolean) {
    if (filteredSuggestions.length === 0) return;

    if (reverse) {
      selectedSuggestionIndex = (selectedSuggestionIndex - 1 + filteredSuggestions.length) % filteredSuggestions.length;
    } else {
      selectedSuggestionIndex = (selectedSuggestionIndex + 1) % filteredSuggestions.length;
    }

    const suggestion = filteredSuggestions[selectedSuggestionIndex];
    if (suggestion) {
      if (commandState.mode === 'argument') {
        handleArgumentValue(suggestion);
      } else {
        handleCommandSuggestion(suggestion);
      }
    }
  }

  async function handleEnter() {
    if (!consoleInput.trim()) return;

    const currentPrompt = `${$store.username || 'guest'}@${getPromptHostname()}> `;
    consoleHistory = [...consoleHistory, currentPrompt + consoleInput];

    try {
      if (showSuggestions && filteredSuggestions.length > 0) {
        const suggestion = filteredSuggestions[selectedSuggestionIndex];
        if (suggestion) {
          if (commandState.mode === 'argument') {
            handleArgumentValue(suggestion);
          } else {
            await handleCommandSuggestion(suggestion);
          }
          return;
        }
      }
      const result = await parseAndExecuteCommand(consoleInput);
      if (result) {
        consoleHistory = [...consoleHistory, result];
      }

      // Add to command history
      commandHistory = [...commandHistory, consoleInput];
      historyIndex = commandHistory.length;

      // Reset input and suggestions
      consoleInput = '';
      showSuggestions = false;
      selectedSuggestionIndex = 0;

    } catch (error) {
      consoleHistory = [...consoleHistory, `Error: ${error.message}`];
    }

    scrollToBottom();
  }

  function handleEscape() {
    showSuggestions = false;
    selectedSuggestionIndex = 0;

    if (commandState.mode === 'argument') {
      resetCommandState();
      consoleInput = '';
    }
  }

  function handleBackspace() {
    if (commandState.mode === 'argument' && commandState.currentArgIndex > 0) {
      // Go back to previous argument
      commandState.currentArgIndex--;
      consoleInput = commandState.arguments[commandState.currentArgIndex]?.value || '';
      showSuggestions = true;
    } else if (commandState.parts.length > 0) {
      // Remove last command part
      commandState.parts.pop();
      resetCommandState();
      consoleInput = '';
      showSuggestions = true;
    }
  }

  function navigateHistory(direction: number) {
    if (commandHistory.length === 0) return;

    historyIndex = Math.max(0, Math.min(commandHistory.length - 1, historyIndex + direction));
    consoleInput = commandHistory[historyIndex] || '';

    // Move cursor to end of input
    setTimeout(() => {
      if (inputElement) {
        inputElement.setSelectionRange(consoleInput.length, consoleInput.length);
      }
    }, 0);
  }

  function navigateSuggestions(direction: number) {
    const length = filteredSuggestions.length;
    if (length === 0) return;

    selectedSuggestionIndex = (selectedSuggestionIndex + direction + length) % length;

    // Ensure the selected suggestion is visible in the suggestions list
    const suggestionsList = document.querySelector('.suggestions-list');
    const selectedItem = suggestionsList?.children[selectedSuggestionIndex] as HTMLElement;

    if (suggestionsList && selectedItem) {
      const listRect = suggestionsList.getBoundingClientRect();
      const itemRect = selectedItem.getBoundingClientRect();

      if (itemRect.bottom > listRect.bottom) {
        selectedItem.scrollIntoView(false);
      } else if (itemRect.top < listRect.top) {
        selectedItem.scrollIntoView(true);
      }
    }
  }

  async function handleCommandSuggestion(suggestion: any) {
    if (!suggestion) return;

    const command = $store.serverInfo?.commands.find(cmd =>
            (cmd.path?.join(' ') || cmd.name) === suggestion.displayText
    );

    if (!command) return;

    if (command.parameters?.length) {
      // Setup for argument input
      commandState = {
        mode: 'argument',
        parts: command.path || [command.name],
        arguments: command.parameters.map(p => ({ ...p, value: '' })),
        currentCommand: command,
        currentArgIndex: 0
      };
      consoleInput = '';
      showSuggestions = true;
      selectedSuggestionIndex = 0;
    } else {
      // Execute command directly if no arguments needed
      showSuggestions = false;
      await executeCommand(command);
    }
  }

  function handleArgumentValue(value: string) {
    if (!commandState.currentCommand) return;

    const currentArg = commandState.arguments[commandState.currentArgIndex];
    if (!currentArg) return;

    // Update current argument value
    currentArg.value = value;

    // Move to next argument if available
    if (commandState.currentArgIndex < commandState.arguments.length - 1) {
      commandState.currentArgIndex++;
      consoleInput = '';
      showSuggestions = true;
      selectedSuggestionIndex = 0;
    } else {
      // Execute command if this was the last argument
      showSuggestions = false;
      executeCommand(commandState.currentCommand);
    }
  }

  function getPromptHostname(): string {
    if (!$store.isConnected) {
      return 'disconnected';
    }
    try {
      return $store.serverInfo?.serverUrl || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  function scrollToBottom() {
    setTimeout(() => {
      if (resultsRef) {
        resultsRef.scrollTop = resultsRef.scrollHeight;
      }
    }, 0);
  }

  function resetCommandState() {
    commandState = {
      mode: 'command',
      parts: [],
      arguments: [],
      currentCommand: null,
      currentArgIndex: -1
    };
    consoleInput = '';
    showSuggestions = false;
    selectedSuggestionIndex = 0;
  }

  async function executeCommand(command: CommandDefinition) {
    loading = true;
    try {
      const args = commandState.arguments.reduce((acc, arg) => {
        acc[arg.name] = arg.value || '';
        return acc;
      }, {} as Record<string, any>);

      const currentPrompt = `${$store.username || 'guest'}@${getPromptHostname()}> `;
      const commandStr = command.path?.join(' ') || command.name;
      consoleHistory = [...consoleHistory, `${currentPrompt}${commandStr}`];

      const result = await denoriteStore.executeCommand(commandStr, args);

      if (result) {
        consoleHistory = [...consoleHistory, formatCommandResult(result)];
      }

      commandHistory = [...commandHistory, commandStr];
      historyIndex = commandHistory.length;

      resetCommandState();

    } catch (error) {
      consoleHistory = [...consoleHistory, `Error: ${error.message}`];
    } finally {
      loading = false;
      scrollToBottom();
    }
  }

  function formatCommandResult(result: any): string {
    if (typeof result === 'string') return result;
    return JSON.stringify(result, null, 2);
  }

  function displayServerInfo(info: any) {
    const serverInfoText = [
      {
        type: 'colored-line',
        segments: [{ text: '', color: undefined }]
      },
      {
        type: 'colored-line',
        segments: [{ text: '=== Server Information ===', color: COLORS.GLASS_BLUE }]
      },
      {
        type: 'colored-line',
        segments: [
          { text: 'Server Name: ', color: COLORS.CORK_BROWN },
          { text: info.serverName, color: COLORS.HIGHLIGHT }
        ]
      },
      {
        type: 'colored-line',
        segments: [
          { text: 'Description: ', color: COLORS.CORK_BROWN },
          { text: info.serverDescription, color: COLORS.HIGHLIGHT }
        ]
      },
      {
        type: 'colored-line',
        segments: [
          { text: 'Minecraft Version: ', color: COLORS.CORK_BROWN },
          { text: info.minecraftVersion, color: COLORS.HIGHLIGHT }
        ]
      },
      {
        type: 'colored-line',
        segments: [
          { text: 'URL: ', color: COLORS.CORK_BROWN },
          { text: info.serverUrl, color: COLORS.HIGHLIGHT }
        ]
      },
      {
        type: 'colored-line',
        segments: [
          { text: 'Available Commands: ', color: COLORS.CORK_BROWN },
          { text: `${info.commands?.length || 0}`, color: COLORS.HIGHLIGHT }
        ]
      },
      {
        type: 'colored-line',
        segments: [{ text: '========================', color: COLORS.GLASS_BLUE }]
      },
      {
        type: 'colored-line',
        segments: [{ text: '', color: undefined }]
      }
    ];

    consoleHistory = [...consoleHistory, ...serverInfoText];
  }

  async function parseAndExecuteCommand(input: string): Promise<string> {
    const parts = input.trim().split(/\s+/);

    // Check built-in commands first
    if (parts[0] in BUILT_IN_COMMANDS) {
      return await BUILT_IN_COMMANDS[parts[0]](...parts.slice(1));
    }

    // Check server commands if connected
    if ($store.isConnected && $store.serverInfo?.commands) {
      // Debug command search
      console.log('Looking for command:', input);
      console.log('Available commands:', $store.serverInfo.commands);

      // Find exact matching command
      const command = $store.serverInfo.commands.find(cmd => {
        const cmdStr = cmd.path ? cmd.path.join(' ') : cmd.name;
        console.log('Comparing with:', cmdStr);
        return cmdStr === input;
      });

      if (command) {
        if (!$store.isAuthenticated && command.permission !== 'guest') {
          throw new Error('Authentication required for this command');
        }

        if (command.permission === 'operator' && !$store.isOperator) {
          throw new Error('Operator privileges required for this command');
        }

        try {
          const result = await denoriteStore.executeCommand(input, {});
          return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        } catch (error) {
          console.error('Command execution error:', error);
          throw error;
        }
      }
    }

    throw new Error(`Unknown command: ${input}`);
  }

  onMount(() => {
    displayPotionArt();
    attemptReconnect();
    inputElement?.focus();
  });

  $: if ($store.isConnected && $store.serverInfo && !lastConnectedServer) {
    lastConnectedServer = $store.serverInfo.serverUrl;
    displayServerInfo($store.serverInfo);
  }

  $: prompt = `${$store.username || 'guest'}@${getPromptHostname()}> `;
</script>

<div class="console">
  <div class="console-output" role="log" bind:this={resultsRef}>
    {#each consoleHistory as line}
      {#if typeof line === 'string'}
        <div class="console-line">{line}</div>
      {:else}
        <div class="console-line">
          {#each line.segments as segment}
            <span style:color={segment.color}>{segment.text}</span>
          {/each}
        </div>
      {/if}
    {/each}
    <div class="console-input-line">
      <span class="prompt">{prompt}</span>
      <input
              bind:this={inputElement}
              bind:value={consoleInput}
              on:keydown={handleKeydown}
              on:focus={() => showSuggestions = true}
              on:blur={() => setTimeout(() => showSuggestions = false, 200)}
              spellcheck="false"
              autocomplete="off"
      />
    </div>
  </div>

  {#if showSuggestions && filteredSuggestions.length > 0}
    <div class="suggestions-list">
      {#each filteredSuggestions as suggestion, index}
        <div
                class="suggestion-item"
                class:selected={index === selectedSuggestionIndex}
                on:click={() => handleCommandSuggestion(suggestion)}
                on:mouseenter={() => selectedSuggestionIndex = index}
        >
          <span class="suggestion-text">
            {suggestion.displayText}
          </span>
          {#if suggestion.parameters?.length}
            <span class="suggestion-args">
              &lt;{suggestion.parameters.map(p => p.name).join('> <')}&gt;
            </span>
          {/if}
          {#if suggestion.description}
            <span class="suggestion-description">
              {suggestion.description}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if loading}
    <div class="loading-indicator">Processing command...</div>
  {/if}
</div>

<style>
  .console {
    background-color: #1e1e1e;
    color: #ffffff;
    font-family: 'Monocraft', monospace;
    padding: 1rem;
    border-radius: 4px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .console-output {
    flex-grow: 1;
    white-space: pre-wrap;
    padding-bottom: 2rem;
  }

  .console-line {
    line-height: 1.4;
    margin: 2px 0;
  }

  .console-line.section-header {
    color: #ADD8E6;
    font-weight: bold;
  }

  .console-line.error {
    color: #ff6b6b;
  }

  .console-input-line {
    display: flex;
    align-items: center;
    position: sticky;
    bottom: 0;
    background-color: #1e1e1e;
    padding: 8px 0;
  }

  .prompt {
    color: #4CAF50;
    margin-right: 8px;
  }

  input {
    background: transparent;
    border: none;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    flex-grow: 1;
    outline: none;
    padding: 0;
  }

  .suggestions-list {
    position: fixed;
    bottom: 32px;
    left: 1rem;
    right: 1rem;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    max-height: 200px;
    overflow-y: auto;
    z-index: 1000;
    box-shadow: 0 -4px 10px rgba(0, 0, 0, 0.1);
  }

  .suggestion-item {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .suggestion-item:hover,
  .suggestion-item.selected {
    background: #3a3a3a;
  }

  .suggestion-text {
    color: #ADD8E6;
    flex-grow: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .suggestion-args {
    color: #DDA0DD;
    font-size: 0.9em;
  }

  .suggestion-item:hover .suggestion-args {
    color: #FF69B4;
  }

  .suggestion-description {
    color: #CD853F;
    font-size: 0.9em;
    margin-left: auto;
  }

  .loading-indicator {
    position: absolute;
    bottom: 16px;
    right: 16px;
    background: rgba(0, 0, 0, 0.8);
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 0.9em;
    color: #DDA0DD;
  }

  /* Scrollbar styling */
  .console-output::-webkit-scrollbar {
    width: 10px;
  }

  .console-output::-webkit-scrollbar-track {
    background: #1e1e1e;
  }

  .console-output::-webkit-scrollbar-thumb {
    background: #3a3a3a;
    border-radius: 5px;
  }

  .console-output::-webkit-scrollbar-thumb:hover {
    background: #4a4a4a;
  }

  :global(body) {
    margin: 0;
    background-color: #1e1e1e;
  }
</style>
