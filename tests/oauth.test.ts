import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  OAuthManager,
  OAuthConfig,
  TokenSet,
  OAuthError,
  TokenExpiredError,
  TokenRefreshError
} from '../src/auth/oauth.js';
import {
  ClaudeOAuthClient,
  ClaudeOAuthConfig
} from '../src/auth/claude.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('OAuthManager', () => {
  let manager: OAuthManager;
  let tempDir: string;

  const testConfig: OAuthConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    authorizationEndpoint: 'https://auth.example.com/authorize',
    tokenEndpoint: 'https://auth.example.com/token',
    redirectUri: 'http://localhost:9876/callback',
    scopes: ['read', 'write']
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pearl-oauth-test-'));
    manager = new OAuthManager(testConfig, tempDir);
    mockFetch.mockReset();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('OAuth URL Generation', () => {
    it('should generate a valid authorization URL', () => {
      const result = manager.generateAuthorizationUrl();
      
      expect(result.url).toContain(testConfig.authorizationEndpoint);
      expect(result.url).toContain(`client_id=${testConfig.clientId}`);
      expect(result.url).toContain('redirect_uri=');
      expect(result.url).toContain('response_type=code');
      expect(result.url).toContain('scope=read+write');
      expect(result.state).toBeTruthy();
      expect(result.codeVerifier).toBeTruthy(); // PKCE
    });

    it('should include PKCE code_challenge in authorization URL', () => {
      const result = manager.generateAuthorizationUrl();
      
      expect(result.url).toContain('code_challenge=');
      expect(result.url).toContain('code_challenge_method=S256');
    });

    it('should generate unique state for each call', () => {
      const result1 = manager.generateAuthorizationUrl();
      const result2 = manager.generateAuthorizationUrl();
      
      expect(result1.state).not.toBe(result2.state);
    });
  });

  describe('Token Exchange', () => {
    it('should exchange authorization code for tokens', async () => {
      const mockTokenResponse = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse
      });

      const { codeVerifier, state } = manager.generateAuthorizationUrl();
      const tokens = await manager.exchangeCode('test-auth-code', codeVerifier, state);

      expect(tokens.accessToken).toBe('test-access-token');
      expect(tokens.refreshToken).toBe('test-refresh-token');
      expect(tokens.tokenType).toBe('Bearer');
      expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should handle token exchange errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_description: 'Invalid code' })
      });

      const { codeVerifier, state } = manager.generateAuthorizationUrl();
      
      await expect(manager.exchangeCode('invalid-code', codeVerifier, state))
        .rejects.toThrow(OAuthError);
    });

    it('should include PKCE code_verifier in token exchange', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test',
          token_type: 'Bearer',
          expires_in: 3600
        })
      });

      const { codeVerifier, state } = manager.generateAuthorizationUrl();
      await manager.exchangeCode('test-code', codeVerifier, state);

      // Verify fetch was called with code_verifier
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchCall = mockFetch.mock.calls[0];
      const body = fetchCall[1].body;
      expect(body).toContain('code_verifier');
    });
  });

  describe('Token Refresh', () => {
    it('should refresh access token using refresh token', async () => {
      const oldTokens: TokenSet = {
        accessToken: 'old-access-token',
        refreshToken: 'test-refresh-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() - 1000 // Expired
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      });

      const newTokens = await manager.refreshTokens(oldTokens);

      expect(newTokens.accessToken).toBe('new-access-token');
      expect(newTokens.refreshToken).toBe('new-refresh-token');
      expect(newTokens.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should throw TokenRefreshError on refresh failure', async () => {
      const oldTokens: TokenSet = {
        accessToken: 'old-access-token',
        refreshToken: 'invalid-refresh-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() - 1000
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' })
      });

      await expect(manager.refreshTokens(oldTokens))
        .rejects.toThrow(TokenRefreshError);
    });

    it('should preserve refresh token if new one not provided', async () => {
      const oldTokens: TokenSet = {
        accessToken: 'old-access-token',
        refreshToken: 'test-refresh-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() - 1000
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          token_type: 'Bearer',
          expires_in: 3600
          // Note: no refresh_token in response
        })
      });

      const newTokens = await manager.refreshTokens(oldTokens);

      expect(newTokens.refreshToken).toBe('test-refresh-token');
    });
  });

  describe('Token Storage', () => {
    it('should save tokens to disk', async () => {
      const tokens: TokenSet = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 3600000
      };

      await manager.saveTokens('claude', tokens);

      const savedPath = path.join(tempDir, 'claude.json');
      const savedData = JSON.parse(await fs.readFile(savedPath, 'utf-8'));
      
      expect(savedData.accessToken).toBe(tokens.accessToken);
      expect(savedData.refreshToken).toBe(tokens.refreshToken);
    });

    it('should load tokens from disk', async () => {
      const tokens: TokenSet = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 3600000
      };

      await manager.saveTokens('claude', tokens);
      const loaded = await manager.loadTokens('claude');

      expect(loaded).not.toBeNull();
      expect(loaded!.accessToken).toBe(tokens.accessToken);
    });

    it('should return null for non-existent tokens', async () => {
      const loaded = await manager.loadTokens('nonexistent');
      expect(loaded).toBeNull();
    });

    it('should delete tokens from disk', async () => {
      const tokens: TokenSet = {
        accessToken: 'test',
        refreshToken: 'test',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 3600000
      };

      await manager.saveTokens('claude', tokens);
      await manager.deleteTokens('claude');
      
      const loaded = await manager.loadTokens('claude');
      expect(loaded).toBeNull();
    });
  });

  describe('Token Validity', () => {
    it('should identify expired tokens', () => {
      const expiredTokens: TokenSet = {
        accessToken: 'test',
        refreshToken: 'test',
        tokenType: 'Bearer',
        expiresAt: Date.now() - 1000
      };

      expect(manager.isTokenValid(expiredTokens)).toBe(false);
    });

    it('should identify valid tokens', () => {
      const validTokens: TokenSet = {
        accessToken: 'test',
        refreshToken: 'test',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 3600000
      };

      expect(manager.isTokenValid(validTokens)).toBe(true);
    });

    it('should consider tokens expiring soon as invalid (5 minute buffer)', () => {
      const soonExpiringTokens: TokenSet = {
        accessToken: 'test',
        refreshToken: 'test',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 60000 // 1 minute from now
      };

      expect(manager.isTokenValid(soonExpiringTokens)).toBe(false);
    });
  });

  describe('Get Valid Token', () => {
    it('should return valid token directly', async () => {
      const validTokens: TokenSet = {
        accessToken: 'valid-token',
        refreshToken: 'test',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 3600000
      };

      await manager.saveTokens('claude', validTokens);
      const token = await manager.getValidAccessToken('claude');

      expect(token).toBe('valid-token');
    });

    it('should refresh expired token automatically', async () => {
      const expiredTokens: TokenSet = {
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh',
        tokenType: 'Bearer',
        expiresAt: Date.now() - 1000
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      });

      await manager.saveTokens('claude', expiredTokens);
      const token = await manager.getValidAccessToken('claude');

      expect(token).toBe('new-access-token');
    });

    it('should throw TokenExpiredError when refresh fails and no tokens', async () => {
      await expect(manager.getValidAccessToken('nonexistent'))
        .rejects.toThrow(TokenExpiredError);
    });
  });
});

describe('ClaudeOAuthClient', () => {
  let client: ClaudeOAuthClient;
  let tempDir: string;

  const testConfig: ClaudeOAuthConfig = {
    clientId: 'claude-client-id',
    clientSecret: 'claude-client-secret'
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pearl-claude-oauth-test-'));
    client = new ClaudeOAuthClient(testConfig, tempDir);
    mockFetch.mockReset();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Configuration', () => {
    it('should use correct Claude OAuth endpoints', () => {
      const authUrl = client.getAuthorizationUrl();
      
      expect(authUrl.url).toContain('https://claude.ai/oauth/authorize');
    });

    it('should request appropriate scopes for Claude Max', () => {
      const authUrl = client.getAuthorizationUrl();
      
      // Should include scopes for API access
      expect(authUrl.url).toContain('scope=');
    });
  });

  describe('Request with OAuth Token', () => {
    it('should make authenticated request to Claude API', async () => {
      // Setup valid tokens
      const validTokens: TokenSet = {
        accessToken: 'claude-access-token',
        refreshToken: 'claude-refresh-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 3600000
      };

      await client.saveTokens(validTokens);

      // Mock the Claude API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          content: [{ type: 'text', text: 'Hello!' }],
          model: 'claude-3-sonnet-20240229',
          usage: { input_tokens: 10, output_tokens: 5 }
        })
      });

      const response = await client.makeAuthenticatedRequest('/v1/messages', {
        method: 'POST',
        body: JSON.stringify({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Hello' }]
        })
      });

      expect(response.id).toBe('msg_123');
      
      // Verify Authorization header was set
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].headers['Authorization']).toBe('Bearer claude-access-token');
    });

    it('should refresh token and retry on 401', async () => {
      // Setup expired tokens
      const expiredTokens: TokenSet = {
        accessToken: 'expired-access-token',
        refreshToken: 'valid-refresh-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 3600000 // Not expired by time, but will get 401
      };

      await client.saveTokens(expiredTokens);

      // First call returns 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'invalid_token' })
      });

      // Token refresh call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      });

      // Retry with new token succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          content: [{ type: 'text', text: 'Success!' }]
        })
      });

      const response = await client.makeAuthenticatedRequest('/v1/messages', {
        method: 'POST',
        body: JSON.stringify({ model: 'claude-3-sonnet', messages: [] })
      });

      expect(response.id).toBe('msg_123');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Fallback to API on OAuth Failure', () => {
    it('should indicate when OAuth is unavailable', async () => {
      // No tokens saved
      const isAvailable = await client.isOAuthAvailable();
      expect(isAvailable).toBe(false);
    });

    it('should indicate when OAuth is available', async () => {
      const validTokens: TokenSet = {
        accessToken: 'test',
        refreshToken: 'test',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 3600000
      };

      await client.saveTokens(validTokens);
      
      const isAvailable = await client.isOAuthAvailable();
      expect(isAvailable).toBe(true);
    });

    it('should throw OAuthError when tokens cannot be refreshed', async () => {
      const expiredTokens: TokenSet = {
        accessToken: 'expired',
        refreshToken: 'invalid-refresh',
        tokenType: 'Bearer',
        expiresAt: Date.now() - 1000
      };

      await client.saveTokens(expiredTokens);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' })
      });

      await expect(client.getAccessToken())
        .rejects.toThrow();
    });
  });

  describe('Token Management', () => {
    it('should logout and clear tokens', async () => {
      const tokens: TokenSet = {
        accessToken: 'test',
        refreshToken: 'test',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 3600000
      };

      await client.saveTokens(tokens);
      await client.logout();

      const isAvailable = await client.isOAuthAvailable();
      expect(isAvailable).toBe(false);
    });
  });
});

describe('OAuth Integration', () => {
  describe('Full OAuth Flow', () => {
    it('should complete full OAuth flow: auth URL -> code exchange -> token storage', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pearl-oauth-flow-test-'));
      
      try {
        const config: OAuthConfig = {
          clientId: 'test-client',
          clientSecret: 'test-secret',
          authorizationEndpoint: 'https://auth.example.com/authorize',
          tokenEndpoint: 'https://auth.example.com/token',
          redirectUri: 'http://localhost:9876/callback',
          scopes: ['api']
        };

        const manager = new OAuthManager(config, tempDir);

        // Step 1: Generate auth URL
        const { url, state, codeVerifier } = manager.generateAuthorizationUrl();
        expect(url).toBeTruthy();
        expect(state).toBeTruthy();
        expect(codeVerifier).toBeTruthy();

        // Step 2: Exchange code (simulated callback)
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'access-123',
            refresh_token: 'refresh-456',
            token_type: 'Bearer',
            expires_in: 3600
          })
        });

        const tokens = await manager.exchangeCode('auth-code-from-callback', codeVerifier, state);
        expect(tokens.accessToken).toBe('access-123');

        // Step 3: Save tokens
        await manager.saveTokens('test-provider', tokens);

        // Step 4: Retrieve and use tokens
        const loaded = await manager.loadTokens('test-provider');
        expect(loaded!.accessToken).toBe('access-123');

        // Step 5: Get valid token (should return without refresh since not expired)
        const validToken = await manager.getValidAccessToken('test-provider');
        expect(validToken).toBe('access-123');

      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
