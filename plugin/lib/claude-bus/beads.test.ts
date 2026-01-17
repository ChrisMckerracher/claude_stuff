/**
 * Tests for beads CLI client wrapper
 *
 * These tests verify the beads client functions work correctly with the bd CLI.
 * Some tests create real beads and must be run with a valid beads database.
 */

import { execSync } from 'child_process';
import {
  BeadInfo,
  validateBead,
  beadSetInProgress,
  beadMarkBlocked,
  beadClose,
  getBeadInfo,
} from './beads';

describe('beads client', () => {
  describe('validateBead', () => {
    it('should return valid for existing bead', () => {
      // Use the task we're implementing as a known-good bead
      const result = validateBead('claude_stuff-5ah.3');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid for non-existent bead', () => {
      const result = validateBead('nonexistent-bead-xyz-123');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
    });

    it('should return invalid for empty bead id', () => {
      const result = validateBead('');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getBeadInfo', () => {
    it('should return bead info for existing bead', () => {
      const info = getBeadInfo('claude_stuff-5ah.3');
      expect(info).not.toBeNull();
      expect(info!.id).toBe('claude_stuff-5ah.3');
      expect(info!.title).toBe('beads CLI client wrapper');
      expect(typeof info!.status).toBe('string');
      expect(typeof info!.priority).toBe('number');
    });

    it('should return null for non-existent bead', () => {
      const info = getBeadInfo('nonexistent-bead-xyz-123');
      expect(info).toBeNull();
    });

    it('should return null for empty bead id', () => {
      const info = getBeadInfo('');
      expect(info).toBeNull();
    });
  });

  describe('state transitions (integration test)', () => {
    let testBeadId: string;

    beforeAll(() => {
      // Create a test bead for state transition testing
      try {
        const output = execSync(
          'bd create --title "Test bead for beads.ts" --type task --json',
          { encoding: 'utf-8' }
        );
        const parsed = JSON.parse(output);
        testBeadId = parsed.id;
      } catch (error) {
        // Skip if we can't create beads
        testBeadId = '';
      }
    });

    afterAll(() => {
      // Clean up the test bead if it exists
      if (testBeadId) {
        try {
          execSync(`bd close ${testBeadId} --reason "Test cleanup" --force`, {
            encoding: 'utf-8',
          });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should transition bead to in_progress', () => {
      if (!testBeadId) {
        console.log('Skipping: could not create test bead');
        return;
      }

      // Set in progress
      expect(() => beadSetInProgress(testBeadId)).not.toThrow();

      // Verify status changed
      const info = getBeadInfo(testBeadId);
      expect(info).not.toBeNull();
      expect(info!.status).toBe('in_progress');
    });

    it('should mark bead as blocked', () => {
      if (!testBeadId) {
        console.log('Skipping: could not create test bead');
        return;
      }

      // Mark blocked
      expect(() =>
        beadMarkBlocked(testBeadId, 'Waiting for dependency')
      ).not.toThrow();

      // Verify status changed
      const info = getBeadInfo(testBeadId);
      expect(info).not.toBeNull();
      expect(info!.status).toBe('blocked');
    });

    it('should close bead with reason', () => {
      if (!testBeadId) {
        console.log('Skipping: could not create test bead');
        return;
      }

      // First set back to in_progress (can't close from blocked)
      beadSetInProgress(testBeadId);

      // Close the bead
      expect(() =>
        beadClose(testBeadId, 'Test completed successfully')
      ).not.toThrow();

      // Verify status changed
      const info = getBeadInfo(testBeadId);
      expect(info).not.toBeNull();
      expect(info!.status).toBe('closed');

      // Clear testBeadId so afterAll doesn't try to close again
      testBeadId = '';
    });
  });

  describe('error handling', () => {
    it('should throw on beadSetInProgress with invalid id', () => {
      expect(() => beadSetInProgress('nonexistent-bead-xyz-123')).toThrow();
    });

    it('should throw on beadMarkBlocked with invalid id', () => {
      expect(() =>
        beadMarkBlocked('nonexistent-bead-xyz-123', 'reason')
      ).toThrow();
    });

    it('should throw on beadClose with invalid id', () => {
      expect(() => beadClose('nonexistent-bead-xyz-123', 'reason')).toThrow();
    });
  });
});
