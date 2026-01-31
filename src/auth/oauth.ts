/**
 * OAuth Manager for Pearl
 * Handles OAuth 2.0 flows with PKCE support for secure token management
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * OAuth configuration for a provider
 */
export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * Token set returned from OAuth flow
 */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: number; // Unix timestamp in milliseconds
  scope?: string;
}

/**
 * Authorization URL result with PKCE components
 */
export interface AuthorizationUrlResult {
  url: string;
  state: string;
  codeVerifier: string;
}

/**
 * Base OAuth error
 */
export class OAuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

/**
 * Token expired and cannot be refreshed
 */
export class TokenExpiredError extends OAuthError {
  constructor(message: string = 'Token expired and no valid tokens available') {
    super(message, 'TOKEN_EXPIRED');
    this.name = 'TokenExpiredError';
  }
}

/**
 * Token refresh failed
 */
export class TokenRefreshError extends OAuthError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'TOKEN_REFRESH_FAILED', details);
    this.name = 'TokenRefreshError';
  }
}

/**
 * OAuth Manager handles OAuth 2.0 authorization code flow with PKCE
 */
export class OAuthManager {
  private config: OAuthConfig;
  private tokenStoragePath: string;
  private pendingStates: Map<string, string> = new Map(); // state -> codeVerifier

  // Buffer time before token expiry (5 minutes)
  private static readonly EXPIRY_BUFFER_MS = 5 * 60 * 1000;

  constructor(config: OAuthConfig, tokenStoragePath: string) {
    this.config = config;
    this.tokenStoragePath = tokenStoragePath;
  }

  /**
   * Generate a secure random string for state/verifier
   */
  private generateSecureRandom(length: number = 32): string {
    return crypto.randomBytes(length).toString('base64url');
  }

  /**
   * Generate PKCE code challenge from verifier using SHA256
   */
  private generateCodeChallenge(verifier: string): string {
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return hash.toString('base64url');
  }

  /**
   * Generate the authorization URL for the OAuth flow
   * Returns URL, state token, and PKCE code verifier
   */
  generateAuthorizationUrl(): AuthorizationUrlResult {
    const state = this.generateSecureRandom();
    const codeVerifier = this.generateSecureRandom(64);
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    // Store state -> codeVerifier mapping for later verification
    this.pendingStates.set(state, codeVerifier);

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    const url = `${this.config.authorizationEndpoint}?${params.toString()}`;

    return { url, state, codeVerifier };
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string, codeVerifier: string, state: string): Promise<TokenSet> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      code_verifier: codeVerifier
    });

    if (this.config.clientSecret) {
      params.append('client_secret', this.config.clientSecret);
    }

    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
      throw new OAuthError(
        (errorData.error_description as string) || (errorData.error as string) || 'Token exchange failed',
        (errorData.error as string) || 'EXCHANGE_FAILED',
        errorData
      );
    }

    const data = await response.json() as Record<string, unknown>;
    
    // Clear the pending state
    this.pendingStates.delete(state);

    return this.parseTokenResponse(data);
  }

  /**
   * Refresh tokens using refresh token
   */
  async refreshTokens(tokens: TokenSet): Promise<TokenSet> {
    if (!tokens.refreshToken) {
      throw new TokenRefreshError('No refresh token available');
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: this.config.clientId
    });

    if (this.config.clientSecret) {
      params.append('client_secret', this.config.clientSecret);
    }

    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
      throw new TokenRefreshError(
        (errorData.error_description as string) || (errorData.error as string) || 'Token refresh failed',
        errorData
      );
    }

    const data = await response.json() as Record<string, unknown>;
    const newTokens = this.parseTokenResponse(data);

    // Preserve old refresh token if new one not provided
    if (!newTokens.refreshToken && tokens.refreshToken) {
      newTokens.refreshToken = tokens.refreshToken;
    }

    return newTokens;
  }

  /**
   * Parse OAuth token response into TokenSet
   */
  private parseTokenResponse(data: Record<string, unknown>): TokenSet {
    const expiresIn = (data.expires_in as number) || 3600;
    const expiresAt = Date.now() + (expiresIn * 1000);

    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string | undefined,
      tokenType: (data.token_type as string) || 'Bearer',
      expiresAt,
      scope: data.scope as string | undefined
    };
  }

  /**
   * Check if a token is currently valid (not expired)
   */
  isTokenValid(tokens: TokenSet): boolean {
    const now = Date.now();
    return tokens.expiresAt > (now + OAuthManager.EXPIRY_BUFFER_MS);
  }

  /**
   * Save tokens to disk
   */
  async saveTokens(provider: string, tokens: TokenSet): Promise<void> {
    await fs.mkdir(this.tokenStoragePath, { recursive: true });
    const filePath = path.join(this.tokenStoragePath, `${provider}.json`);
    await fs.writeFile(filePath, JSON.stringify(tokens, null, 2), 'utf-8');
  }

  /**
   * Load tokens from disk
   */
  async loadTokens(provider: string): Promise<TokenSet | null> {
    const filePath = path.join(this.tokenStoragePath, `${provider}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as TokenSet;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete tokens from disk
   */
  async deleteTokens(provider: string): Promise<void> {
    const filePath = path.join(this.tokenStoragePath, `${provider}.json`);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  async getValidAccessToken(provider: string): Promise<string> {
    const tokens = await this.loadTokens(provider);
    
    if (!tokens) {
      throw new TokenExpiredError('No tokens found');
    }

    if (this.isTokenValid(tokens)) {
      return tokens.accessToken;
    }

    // Token expired, try to refresh
    if (!tokens.refreshToken) {
      throw new TokenExpiredError('Token expired and no refresh token available');
    }

    try {
      const newTokens = await this.refreshTokens(tokens);
      await this.saveTokens(provider, newTokens);
      return newTokens.accessToken;
    } catch {
      throw new TokenExpiredError('Token expired and refresh failed');
    }
  }
}
