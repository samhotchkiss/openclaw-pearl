/**
 * Pearl CLI Auth Commands
 * Commands for managing OAuth authentication
 */

import { Command } from 'commander';
import { ClaudeOAuthClient } from '../auth/claude.js';
import { createServer } from 'http';
import { URL } from 'url';

const DEFAULT_CALLBACK_PORT = 9876;

export const authCommand = new Command('auth')
  .description('Manage authentication for model providers');

/**
 * Claude OAuth login command
 */
authCommand
  .command('claude')
  .description('Authenticate with Claude Max subscription via OAuth')
  .option('--client-id <id>', 'OAuth client ID (or set CLAUDE_CLIENT_ID)')
  .option('--client-secret <secret>', 'OAuth client secret (or set CLAUDE_CLIENT_SECRET)')
  .option('--port <port>', 'Callback server port', String(DEFAULT_CALLBACK_PORT))
  .action(async (options) => {
    const clientId = options.clientId || process.env.CLAUDE_CLIENT_ID;
    const clientSecret = options.clientSecret || process.env.CLAUDE_CLIENT_SECRET;

    if (!clientId) {
      console.error('Error: Claude client ID required. Set CLAUDE_CLIENT_ID or use --client-id');
      process.exit(1);
    }

    const port = parseInt(options.port, 10);
    const redirectUri = `http://localhost:${port}/callback`;

    const client = new ClaudeOAuthClient({
      clientId,
      clientSecret,
      redirectUri
    });

    console.log('Starting Claude OAuth authentication...\n');

    // Generate auth URL
    const { url, state, codeVerifier } = client.getAuthorizationUrl();

    // Start local callback server
    const server = createServer(async (req, res) => {
      const reqUrl = new URL(req.url || '/', `http://localhost:${port}`);
      
      if (reqUrl.pathname === '/callback') {
        const code = reqUrl.searchParams.get('code');
        const returnedState = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ Authentication Failed</h1>
                <p>Error: ${error}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          console.error(`\nAuthentication failed: ${error}`);
          server.close();
          process.exit(1);
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ Missing Authorization Code</h1>
                <p>No authorization code was received.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          console.error('\nNo authorization code received');
          server.close();
          process.exit(1);
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ Security Error</h1>
                <p>State mismatch - possible CSRF attack.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          console.error('\nState mismatch - possible security issue');
          server.close();
          process.exit(1);
          return;
        }

        try {
          // Exchange code for tokens
          console.log('Exchanging authorization code for tokens...');
          const tokens = await client.exchangeCode(code, codeVerifier, state);
          
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>✅ Authentication Successful!</h1>
                <p>Pearl is now connected to your Claude Max subscription.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);

          console.log('\n✅ Successfully authenticated with Claude!');
          console.log(`   Token expires: ${new Date(tokens.expiresAt).toLocaleString()}`);
          console.log('\nYou can now use Claude Max through Pearl.');
          
          server.close();
          process.exit(0);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ Token Exchange Failed</h1>
                <p>${err instanceof Error ? err.message : 'Unknown error'}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          console.error('\nToken exchange failed:', err instanceof Error ? err.message : err);
          server.close();
          process.exit(1);
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(port, () => {
      console.log(`Callback server listening on http://localhost:${port}`);
      console.log('\nOpen this URL in your browser to authenticate:\n');
      console.log(`  ${url}\n`);
      console.log('Waiting for authentication...');

      // Try to open browser automatically
      const { exec } = require('child_process');
      const openCommand = process.platform === 'darwin' ? 'open' :
                         process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${openCommand} "${url}"`, (err: Error | null) => {
        if (err) {
          // Silent fail - user can copy URL manually
        }
      });
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      console.error('\nAuthentication timed out after 5 minutes.');
      server.close();
      process.exit(1);
    }, 5 * 60 * 1000);
  });

/**
 * Check auth status command
 */
authCommand
  .command('status')
  .description('Check authentication status for providers')
  .action(async () => {
    console.log('Authentication Status\n');

    // Check Claude OAuth
    const claudeClient = new ClaudeOAuthClient({
      clientId: process.env.CLAUDE_CLIENT_ID || 'unknown',
    });

    const claudeAvailable = await claudeClient.isOAuthAvailable();
    const claudeTokens = await claudeClient.loadTokens();

    if (claudeAvailable && claudeTokens) {
      const expiresAt = new Date(claudeTokens.expiresAt);
      const isExpired = expiresAt.getTime() < Date.now();
      
      console.log('Claude OAuth:');
      console.log(`  Status: ${isExpired ? '⚠️  Token expired (will refresh)' : '✅ Authenticated'}`);
      console.log(`  Expires: ${expiresAt.toLocaleString()}`);
      console.log(`  Has refresh token: ${claudeTokens.refreshToken ? 'Yes' : 'No'}`);
    } else {
      console.log('Claude OAuth:');
      console.log('  Status: ❌ Not authenticated');
      console.log('  Run: pearl auth claude');
    }

    // Check for API keys
    console.log('\nAPI Keys:');
    console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Not set'}`);
    console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Not set'}`);
  });

/**
 * Logout command
 */
authCommand
  .command('logout')
  .description('Remove stored authentication tokens')
  .option('--provider <provider>', 'Provider to logout from (claude)', 'claude')
  .action(async (options) => {
    if (options.provider === 'claude') {
      const client = new ClaudeOAuthClient({
        clientId: 'unused-for-logout'
      });

      await client.logout();
      console.log('✅ Claude OAuth tokens removed.');
    } else {
      console.error(`Unknown provider: ${options.provider}`);
      process.exit(1);
    }
  });
