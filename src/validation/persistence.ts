/**
 * Persistence Validator
 * Scans agent responses for claims of remembering/logging and verifies
 * that the memory was actually saved.
 */

export interface PersistenceValidatorConfig {
  /** Enable/disable validation */
  enabled: boolean;
  /** Action to take when a false claim is detected */
  onFalseClaim: 'auto_fix' | 'warn' | 'log_only';
}

export interface PersistenceClaimDetection {
  /** Whether a persistence claim was detected */
  hasClaim: boolean;
  /** The content that was claimed to be saved */
  claimedContent?: string;
  /** Keywords extracted from the claim */
  keywords?: string[];
  /** The pattern that matched */
  matchedPattern?: string;
}

export interface PersistenceCheckResult {
  /** Whether the response passed validation */
  isValid: boolean;
  /** Whether a persistence claim was detected */
  hasClaim: boolean;
  /** Whether the memory was verified to exist */
  memoryVerified?: boolean;
  /** Whether validation was skipped (disabled) */
  skipped?: boolean;
  /** Whether auto-fix was applied */
  autoFixed?: boolean;
  /** Warning message to append (warn mode) */
  warning?: string;
  /** Whether the false claim was logged */
  logged?: boolean;
  /** The detected claim details */
  claim?: PersistenceClaimDetection;
}

/**
 * Interface for checking if a memory exists
 */
export interface MemoryChecker {
  checkRecentMemory(agentId: string, keywords: string[]): Promise<boolean>;
}

/**
 * Interface for creating a memory
 */
export interface MemoryCreator {
  createMemory(agentId: string, content: string): Promise<void>;
}

/**
 * Patterns that indicate a persistence claim
 * Each pattern is a tuple of [regex, description]
 */
const PERSISTENCE_PATTERNS: Array<[RegExp, string]> = [
  // Future tense remember/keep
  [/\bi('ll| will) remember\b/i, "I'll remember"],
  [/\bi('ll| will) keep (that|this) in mind\b/i, "I'll keep in mind"],
  
  // Affirmative saving/noting
  [/\b(noted|logged|saved|recorded|stored|storing)\b(?!\?)/i, 'noted/logged/saved'],
  
  // Future reference
  [/\bfor (future|later) reference\b/i, 'for future reference'],
  
  // Saved to memory
  [/\bsaved? to memory\b/i, 'saved to memory'],
  
  // I've stored/I'm storing
  [/\bi('ve|'m| have| am) (storing|saved|logged|recorded|noted)\b/i, "I've stored"],
];

/**
 * Patterns that should NOT be considered persistence claims (false positives)
 */
const EXCLUSION_PATTERNS: RegExp[] = [
  // Questions about remembering
  /would you (like|want) me to remember/i,
  /do you want me to (remember|save|note)/i,
  /should i (remember|save|note)/i,
  /can i (remember|note)/i,
  
  // Explaining capabilities (often disclaimers)
  /i (don't|cannot|can't|do not) have (the ability|access)/i,
  /i('m| am) (not able|unable) to (save|remember|store)/i,
  
  // Past tense discussion (not a claim of current action)
  /in the past.{0,20}(noted|remembered)/i,
  /previously.{0,20}(noted|remembered)/i,
  
  // Technical memory discussion
  /\b(RAM|random.?access memory|memory (allocation|management|leak))\b/i,
  
  // Discussing what memories are
  /(computer|system|device) memory/i,
];

/**
 * Stop words to exclude from keyword extraction
 */
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
  'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she',
  'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their',
  'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an',
  'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just',
  'don', 'should', 'now', 'll', 've', 're', 'm', 'd',
  // Additional context words
  'that', 'remember', 'noted', 'logged', 'saved', 'stored', 'recorded',
  'preference', 'memory', 'future', 'reference', 'keep', 'mind',
]);

export class PersistenceValidator {
  private config: PersistenceValidatorConfig;
  private memoryChecker?: MemoryChecker;
  private memoryCreator?: MemoryCreator;

  constructor(
    config: Partial<PersistenceValidatorConfig> = {},
    memoryChecker?: MemoryChecker,
    memoryCreator?: MemoryCreator
  ) {
    this.config = {
      enabled: config.enabled ?? true,
      onFalseClaim: config.onFalseClaim ?? 'log_only',
    };
    this.memoryChecker = memoryChecker;
    this.memoryCreator = memoryCreator;
  }

  /**
   * Get current configuration
   */
  getConfig(): PersistenceValidatorConfig {
    return { ...this.config };
  }

  /**
   * Detect if a response contains a persistence claim
   */
  detectPersistenceClaim(response: string): PersistenceClaimDetection {
    // Check exclusion patterns first
    for (const pattern of EXCLUSION_PATTERNS) {
      if (pattern.test(response)) {
        return { hasClaim: false };
      }
    }

    // Check for persistence patterns
    for (const [pattern, description] of PERSISTENCE_PATTERNS) {
      const match = response.match(pattern);
      if (match) {
        // Extract the content after the claim
        const claimedContent = this.extractClaimedContent(response, match.index || 0);
        const keywords = this.extractKeywords(claimedContent);

        return {
          hasClaim: true,
          claimedContent,
          keywords,
          matchedPattern: description,
        };
      }
    }

    return { hasClaim: false };
  }

  /**
   * Extract the content that was claimed to be saved
   */
  private extractClaimedContent(response: string, matchIndex: number): string {
    // Get text starting from the match
    const afterMatch = response.slice(matchIndex);
    
    // Find the end of the first sentence containing the claim
    const firstSentenceEnd = afterMatch.search(/[.!?](?:\s|$)/);
    
    // Check if the first sentence is very short (just the claim phrase itself)
    // If so, include the next sentence as well
    let endIndex: number;
    if (firstSentenceEnd > 0 && firstSentenceEnd < 30) {
      // Short first sentence - look for the next sentence end
      const restOfText = afterMatch.slice(firstSentenceEnd + 1);
      const nextSentenceEnd = restOfText.search(/[.!?](?:\s|$)/);
      if (nextSentenceEnd > 0) {
        endIndex = firstSentenceEnd + 1 + nextSentenceEnd + 1;
      } else {
        endIndex = Math.min(afterMatch.length, 200);
      }
    } else {
      endIndex = firstSentenceEnd > 0 ? firstSentenceEnd + 1 : Math.min(afterMatch.length, 200);
    }
    
    // Also include text before if it's part of the same sentence
    const beforeMatch = response.slice(0, matchIndex);
    const lastSentenceStart = Math.max(
      beforeMatch.lastIndexOf('.') + 1,
      beforeMatch.lastIndexOf('!') + 1,
      beforeMatch.lastIndexOf('?') + 1,
      0
    );
    
    const fullSentence = response.slice(lastSentenceStart, matchIndex + endIndex).trim();
    return fullSentence;
  }

  /**
   * Extract meaningful keywords from claimed content
   */
  private extractKeywords(content: string): string[] {
    // Tokenize and filter
    const words = content
      .toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !STOP_WORDS.has(word));

    // Also extract proper nouns (capitalized words) from original
    const properNouns = content.match(/[A-Z][a-z]{2,}/g) || [];
    
    // Combine and dedupe
    const allKeywords = [...new Set([...words, ...properNouns.map(n => n.toLowerCase())])];
    
    return allKeywords.slice(0, 10); // Limit to 10 keywords
  }

  /**
   * Validate a response for false persistence claims
   */
  async validate(
    agentId: string,
    response: string
  ): Promise<PersistenceCheckResult> {
    // Skip if disabled
    if (!this.config.enabled) {
      return {
        isValid: true,
        hasClaim: false,
        skipped: true,
      };
    }

    // Handle empty response
    if (!response || response.trim().length === 0) {
      return {
        isValid: true,
        hasClaim: false,
      };
    }

    // Detect persistence claim
    const claim = this.detectPersistenceClaim(response);
    
    if (!claim.hasClaim) {
      return {
        isValid: true,
        hasClaim: false,
      };
    }

    // Check if memory actually exists
    let memoryVerified = false;
    if (this.memoryChecker && claim.keywords && claim.keywords.length > 0) {
      memoryVerified = await this.memoryChecker.checkRecentMemory(agentId, claim.keywords);
    }

    // If memory exists, claim is valid
    if (memoryVerified) {
      return {
        isValid: true,
        hasClaim: true,
        memoryVerified: true,
        claim,
      };
    }

    // Memory doesn't exist - this is a false claim
    const result: PersistenceCheckResult = {
      isValid: false,
      hasClaim: true,
      memoryVerified: false,
      claim,
    };

    // Handle based on configured action
    switch (this.config.onFalseClaim) {
      case 'auto_fix':
        if (this.memoryCreator && claim.claimedContent) {
          await this.memoryCreator.createMemory(agentId, claim.claimedContent);
          result.autoFixed = true;
        }
        break;

      case 'warn':
        result.warning = '⚠️ Note: The agent claimed to remember this, but the memory may not have been saved.';
        break;

      case 'log_only':
        console.warn(
          `[PersistenceValidator] False persistence claim detected for agent ${agentId}: "${claim.matchedPattern}" - Content: "${claim.claimedContent?.slice(0, 100)}"`
        );
        result.logged = true;
        break;
    }

    return result;
  }
}
