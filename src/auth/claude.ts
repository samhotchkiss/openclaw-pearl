/**
 * Claude OAuth Client for Pearl
 * Handles OAuth authentication with Claude Max subscriptions
 */

import {
  OAuthManager,
  OAuthConfig,
  TokenSet,
  OAuthError,
  TokenExpiredError,
  TokenRefreshError
} from './oauth.js';
import * as path from 'path';
import * as os from 'os';

/**
 * Claude-specific OAuth configuration
 */
export interface ClaudeOAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string[];
}

/**
 * Claude OAuth endpoints
 */
const CLAUDE_OAUTH_ENDPOINTS = {
  authorization: 'https://claude.ai/oauth/authorize',
  token: 'https://claude.ai/oauth/token',
  api: 'https://api.anthropic.com'
};

/**
 * Default scopes for Claude Max API access
 */
const DEFAULT_CLAUDE_SCOPES = [
  'user:read',
  'messages:write',
  'messages:read'
];

/**
 * Provider name for token storage
 */
const CLAUDE_PROVIDER = 'claude';

/**
 * Claude OAuth Client
 * Specialized client for authenticating with Claude Max subscriptions
 */
export class ClaudeOAuthClient {
  private manager: OAuthManager;
  private config: ClaudeOAuthConfig;

  constructor(config: ClaudeOAuthConfig, tokenStoragePath?: string) {
    this.config = config;
    
    const storagePath = tokenStoragePath || 
      path.join(os.homedir(), '.pearl', 'auth');

    const oauthConfig: OAuthConfig = {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authorizationEndpoint: CLAUDE_OAUTH_ENDPOINTS.authorization,
      tokenEndpoint: CLAUDE_OAUTH_ENDPOINTS.token,
      redirectUri: config.redirectUri || 'http://localhost:9876/callback',
      scopes: config.scopes || DEFAULT_CLAUDE_SCOPES
    };

    this.manager = new OAuthManager(oauthConfig, storagePath);
  }

  /**
   * Get the authorization URL to start OAuth flow
   */
  getAuthorizationUrl(): { url: string; state: string; codeVerifier: string } {
    return this.manager.generateAuthorizationUrl();
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string, codeVerifier: string, state: string): Promise<TokenSet> {
    const tokens = await this.manager.exchangeCode(code, codeVerifier, state);
    await this.saveTokens(tokens);
    return tokens;
  }

  /**
   * Save tokens to storage
   */
  async saveTokens(tokens: TokenSet): Promise<void> {
    await this.manager.saveTokens(CLAUDE_PROVIDER, tokens);
  }

  /**
   * Load tokens from storage
   */
  async loadTokens(): Promise<TokenSet | null> {
    return this.manager.loadTokens(CLAUDE_PROVIDER);
  }

  /**
   * Delete stored tokens (logout)
   */
  async logout(): Promise<void> {
    await this.manager.deleteTokens(CLAUDE_PROVIDER);
  }

  /**
   * Check if OAuth is available (tokens exist and are valid or refreshable)
   */
  async isOAuthAvailable(): Promise<boolean> {
    const tokens = await this.loadTokens();
    
    if (!tokens) {
      return false;
    }

    // If token is valid, OAuth is available
    if (this.manager.isTokenValid(tokens)) {
      return true;
    }

    // If we have a refresh token, we might be able to refresh
    return !!tokens.refreshToken;
  }

  /**
   * Get a valid access token
   */
  async getAccessToken(): Promise<string> {
    return this.manager.getValidAccessToken(CLAUDE_PROVIDER);
  }

  /**
   * Make an authenticated request to Claude API
   * Automatically handles token refresh on 401
   */
  async makeAuthenticatedRequest<T>(
    endpoint: string,
    options: RequestInit
  ): Promise<T> {
    let accessToken: string;
    
    try {
      accessToken = await this.getAccessToken();
    } catch (error) {
      throw new OAuthError(
        'Failed to get access token',
        'NO_TOKEN',
        { originalError: error instanceof Error ? error.message : String(error) }
      );
    }

    const url = `${CLAUDE_OAUTH_ENDPOINTS.api}${endpoint}`;
    
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    };

    const response = await fetch(url, {
      ...options,
      headers
    });

    // If 401, try to refresh token and retry once
    if (response.status === 401) {
      const tokens = await this.loadTokens();
      
      if (tokens?.refreshToken) {
        try {
          const newTokens = await this.manager.refreshTokens(tokens);
          await this.saveTokens(newTokens);
          
          // Retry with new token
          headers['Authorization'] = `Bearer ${newTokens.accessToken}`;
          
          const retryResponse = await fetch(url, {
            ...options,
            headers
          });

          if (!retryResponse.ok) {
            const errorData = await retryResponse.json().catch(() => ({})) as Record<string, unknown>;
            const errorObj = errorData.error as Record<string, unknown> | undefined;
            throw new OAuthError(
              (errorObj?.message as string) || 'Request failed after token refresh',
              'REQUEST_FAILED',
              errorData
            );
          }

          return retryResponse.json() as Promise<T>;
        } catch (refreshError) {
          throw new TokenRefreshError(
            'Token refresh failed during request retry',
            { originalError: refreshError instanceof Error ? refreshError.message : String(refreshError) }
          );
        }
      }

      throw new TokenExpiredError('Access token expired and cannot be refreshed');
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
      const errorObj = errorData.error as Record<string, unknown> | undefined;
      throw new OAuthError(
        (errorObj?.message as string) || `Request failed with status ${response.status}`,
        'REQUEST_FAILED',
        errorData
      );
    }

    return response.json() as Promise<T>;
  }
}

// Re-export types for convenience
export { TokenSet, OAuthError, TokenExpiredError, TokenRefreshError } from './oauth.js';
