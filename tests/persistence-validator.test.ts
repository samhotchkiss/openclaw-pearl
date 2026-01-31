import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PersistenceValidator,
  type PersistenceValidatorConfig,
  type PersistenceCheckResult,
  type MemoryChecker,
  type MemoryCreator,
} from '../src/validation/persistence.js';

/**
 * Mock memory checker that returns configurable results
 */
function createMockMemoryChecker(hasMemory: boolean = false): MemoryChecker {
  return {
    async checkRecentMemory(_agentId: string, _keywords: string[]): Promise<boolean> {
      return hasMemory;
    },
  };
}

/**
 * Mock memory creator that tracks created memories
 */
function createMockMemoryCreator(): MemoryCreator & { createdMemories: Array<{ agentId: string; content: string }> } {
  const creator = {
    createdMemories: [] as Array<{ agentId: string; content: string }>,
    async createMemory(agentId: string, content: string): Promise<void> {
      creator.createdMemories.push({ agentId, content });
    },
  };
  return creator;
}

describe('PersistenceValidator', () => {
  describe('construction', () => {
    it('creates with default config', () => {
      const validator = new PersistenceValidator();
      expect(validator).toBeDefined();
    });

    it('creates with custom config', () => {
      const validator = new PersistenceValidator({
        enabled: true,
        onFalseClaim: 'warn',
      });
      expect(validator).toBeDefined();
    });
  });

  describe('detectPersistenceClaim()', () => {
    let validator: PersistenceValidator;

    beforeEach(() => {
      validator = new PersistenceValidator();
    });

    it('detects "I\'ll remember" claim', () => {
      const result = validator.detectPersistenceClaim(
        "I'll remember that you prefer dark mode"
      );
      expect(result.hasClaim).toBe(true);
      expect(result.claimedContent).toContain('dark mode');
    });

    it('detects "I will remember" claim', () => {
      const result = validator.detectPersistenceClaim(
        'I will remember your preference for TypeScript'
      );
      expect(result.hasClaim).toBe(true);
      expect(result.claimedContent).toContain('TypeScript');
    });

    it('detects "noted" claim', () => {
      const result = validator.detectPersistenceClaim(
        'Noted! Your birthday is March 15th.'
      );
      expect(result.hasClaim).toBe(true);
      expect(result.claimedContent).toContain('birthday');
    });

    it('detects "logged" claim', () => {
      const result = validator.detectPersistenceClaim(
        "I've logged this preference for future reference."
      );
      expect(result.hasClaim).toBe(true);
    });

    it('detects "saved" claim', () => {
      const result = validator.detectPersistenceClaim(
        'Saved to memory! Your favorite color is blue.'
      );
      expect(result.hasClaim).toBe(true);
      expect(result.claimedContent).toContain('blue');
    });

    it('detects "recorded" claim', () => {
      const result = validator.detectPersistenceClaim(
        "I've recorded that you live in Santa Fe."
      );
      expect(result.hasClaim).toBe(true);
      expect(result.claimedContent).toContain('Santa Fe');
    });

    it('detects "for future reference" claim', () => {
      const result = validator.detectPersistenceClaim(
        "I'll keep that in mind for future reference - you prefer morning meetings."
      );
      expect(result.hasClaim).toBe(true);
      expect(result.claimedContent).toContain('morning meetings');
    });

    it('detects "keep that in mind" claim', () => {
      const result = validator.detectPersistenceClaim(
        "I'll keep that in mind about your allergy to peanuts."
      );
      expect(result.hasClaim).toBe(true);
      expect(result.claimedContent).toContain('peanuts');
    });

    it('detects "keep this in mind" claim', () => {
      const result = validator.detectPersistenceClaim(
        "I'll keep this in mind - you want responses under 200 words."
      );
      expect(result.hasClaim).toBe(true);
    });

    it('detects "storing" claim', () => {
      const result = validator.detectPersistenceClaim(
        "I'm storing your timezone preference as America/Denver."
      );
      expect(result.hasClaim).toBe(true);
      expect(result.claimedContent).toContain('timezone');
    });

    it('no false positive on normal response', () => {
      const result = validator.detectPersistenceClaim(
        'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.'
      );
      expect(result.hasClaim).toBe(false);
    });

    it('no false positive on memory-related discussion', () => {
      const result = validator.detectPersistenceClaim(
        'RAM (random-access memory) is a form of computer memory that can be read and changed.'
      );
      expect(result.hasClaim).toBe(false);
    });

    it('no false positive on past tense discussion', () => {
      const result = validator.detectPersistenceClaim(
        'In the past, I noted that this approach worked well.'
      );
      expect(result.hasClaim).toBe(false);
    });

    it('no false positive on questions about remembering', () => {
      const result = validator.detectPersistenceClaim(
        'Would you like me to remember this for later?'
      );
      expect(result.hasClaim).toBe(false);
    });

    it('no false positive on explaining memory capabilities', () => {
      const result = validator.detectPersistenceClaim(
        "I don't have the ability to save things to memory between sessions."
      );
      expect(result.hasClaim).toBe(false);
    });

    it('extracts keywords from claimed content', () => {
      const result = validator.detectPersistenceClaim(
        "I'll remember that your son Noah is 8 years old and loves soccer."
      );
      expect(result.hasClaim).toBe(true);
      expect(result.keywords).toBeDefined();
      expect(result.keywords?.length).toBeGreaterThan(0);
      // Should extract meaningful keywords
      expect(result.keywords?.some(k => k.toLowerCase().includes('noah') || k.toLowerCase().includes('soccer'))).toBe(true);
    });
  });

  describe('validate()', () => {
    it('returns valid when memory was actually created', async () => {
      const checker = createMockMemoryChecker(true); // Memory exists
      const validator = new PersistenceValidator({ enabled: true }, checker);

      const result = await validator.validate(
        'agent-1',
        "I'll remember that you prefer dark mode"
      );

      expect(result.isValid).toBe(true);
      expect(result.hasClaim).toBe(true);
      expect(result.memoryVerified).toBe(true);
    });

    it('returns invalid when memory was not created', async () => {
      const checker = createMockMemoryChecker(false); // No memory
      const validator = new PersistenceValidator({ enabled: true }, checker);

      const result = await validator.validate(
        'agent-1',
        "I'll remember that you prefer dark mode"
      );

      expect(result.isValid).toBe(false);
      expect(result.hasClaim).toBe(true);
      expect(result.memoryVerified).toBe(false);
    });

    it('returns valid when no persistence claim detected', async () => {
      const checker = createMockMemoryChecker(false);
      const validator = new PersistenceValidator({ enabled: true }, checker);

      const result = await validator.validate(
        'agent-1',
        'TypeScript is a programming language.'
      );

      expect(result.isValid).toBe(true);
      expect(result.hasClaim).toBe(false);
    });

    it('skips validation when disabled', async () => {
      const checker = createMockMemoryChecker(false);
      const validator = new PersistenceValidator({ enabled: false }, checker);

      const result = await validator.validate(
        'agent-1',
        "I'll remember that you prefer dark mode"
      );

      expect(result.isValid).toBe(true);
      expect(result.skipped).toBe(true);
    });
  });

  describe('auto-fix mode', () => {
    it('creates missing memory when onFalseClaim is auto_fix', async () => {
      const checker = createMockMemoryChecker(false); // No memory exists
      const creator = createMockMemoryCreator();
      const validator = new PersistenceValidator(
        { enabled: true, onFalseClaim: 'auto_fix' },
        checker,
        creator
      );

      const result = await validator.validate(
        'agent-1',
        "I'll remember that you prefer dark mode"
      );

      expect(result.isValid).toBe(false);
      expect(result.autoFixed).toBe(true);
      expect(creator.createdMemories).toHaveLength(1);
      expect(creator.createdMemories[0].agentId).toBe('agent-1');
      expect(creator.createdMemories[0].content).toContain('dark mode');
    });

    it('does not create memory when one already exists', async () => {
      const checker = createMockMemoryChecker(true); // Memory exists
      const creator = createMockMemoryCreator();
      const validator = new PersistenceValidator(
        { enabled: true, onFalseClaim: 'auto_fix' },
        checker,
        creator
      );

      await validator.validate(
        'agent-1',
        "I'll remember that you prefer dark mode"
      );

      expect(creator.createdMemories).toHaveLength(0);
    });
  });

  describe('warn mode', () => {
    it('returns warning message when onFalseClaim is warn', async () => {
      const checker = createMockMemoryChecker(false);
      const validator = new PersistenceValidator(
        { enabled: true, onFalseClaim: 'warn' },
        checker
      );

      const result = await validator.validate(
        'agent-1',
        "I'll remember that you prefer dark mode"
      );

      expect(result.isValid).toBe(false);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('claimed');
    });

    it('provides warning that can be appended to response', async () => {
      const checker = createMockMemoryChecker(false);
      const validator = new PersistenceValidator(
        { enabled: true, onFalseClaim: 'warn' },
        checker
      );

      const result = await validator.validate(
        'agent-1',
        "I'll remember that you prefer dark mode"
      );

      expect(result.warning).toMatch(/⚠️|warning|note/i);
    });
  });

  describe('log_only mode', () => {
    it('only logs when onFalseClaim is log_only', async () => {
      const checker = createMockMemoryChecker(false);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const validator = new PersistenceValidator(
        { enabled: true, onFalseClaim: 'log_only' },
        checker
      );

      const result = await validator.validate(
        'agent-1',
        "I'll remember that you prefer dark mode"
      );

      expect(result.isValid).toBe(false);
      expect(result.logged).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('does not auto-fix or warn in log_only mode', async () => {
      const checker = createMockMemoryChecker(false);
      const creator = createMockMemoryCreator();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const validator = new PersistenceValidator(
        { enabled: true, onFalseClaim: 'log_only' },
        checker,
        creator
      );

      const result = await validator.validate(
        'agent-1',
        "I'll remember that you prefer dark mode"
      );

      expect(result.autoFixed).toBeUndefined();
      expect(result.warning).toBeUndefined();
      expect(creator.createdMemories).toHaveLength(0);

      vi.restoreAllMocks();
    });
  });

  describe('edge cases', () => {
    let validator: PersistenceValidator;
    let checker: MemoryChecker;

    beforeEach(() => {
      checker = createMockMemoryChecker(false);
      validator = new PersistenceValidator({ enabled: true }, checker);
    });

    it('handles empty response', async () => {
      const result = await validator.validate('agent-1', '');
      expect(result.isValid).toBe(true);
      expect(result.hasClaim).toBe(false);
    });

    it('handles very long responses', async () => {
      const longText = 'This is a normal sentence. '.repeat(1000) + "I'll remember that.";
      const result = await validator.validate('agent-1', longText);
      expect(result.hasClaim).toBe(true);
    });

    it('handles multiple claims in one response', () => {
      const detectResult = validator.detectPersistenceClaim(
        "I'll remember your preference for dark mode. Also noted that you like TypeScript."
      );
      expect(detectResult.hasClaim).toBe(true);
      // Should extract info from both claims
      expect(detectResult.claimedContent).toBeTruthy();
    });

    it('is case insensitive', () => {
      const cases = [
        "I'LL REMEMBER that",
        "i'll remember that",
        "I'll Remember That",
        "NOTED!",
        "Noted.",
      ];

      for (const text of cases) {
        const result = validator.detectPersistenceClaim(text);
        expect(result.hasClaim).toBe(true);
      }
    });

    it('handles Unicode and special characters', () => {
      const result = validator.detectPersistenceClaim(
        "I'll remember that your name is José María 🎉"
      );
      expect(result.hasClaim).toBe(true);
      expect(result.claimedContent).toContain('José');
    });
  });

  describe('getConfig()', () => {
    it('returns current configuration', () => {
      const config: PersistenceValidatorConfig = {
        enabled: true,
        onFalseClaim: 'warn',
      };
      const validator = new PersistenceValidator(config);
      
      const returned = validator.getConfig();
      expect(returned.enabled).toBe(true);
      expect(returned.onFalseClaim).toBe('warn');
    });
  });
});
