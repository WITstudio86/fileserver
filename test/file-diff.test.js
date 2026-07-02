const { describe, it } = require('node:test');
const assert = require('node:assert');
const { computeFileDiff } = require('../public/js/file-diff');

describe('computeFileDiff', () => {
  it('should detect added files', () => {
    const oldFiles = [
      { name: 'a.txt', size: 100, lastModified: 1000 },
    ];
    const newFiles = [
      { name: 'a.txt', size: 100, lastModified: 1000 },
      { name: 'b.txt', size: 200, lastModified: 2000 },
    ];

    const result = computeFileDiff(oldFiles, newFiles);

    assert.deepStrictEqual(result.added, [{ name: 'b.txt', size: 200, lastModified: 2000 }]);
    assert.deepStrictEqual(result.removed, []);
    assert.deepStrictEqual(result.modified, []);
  });

  it('should detect removed files', () => {
    const oldFiles = [
      { name: 'a.txt', size: 100, lastModified: 1000 },
      { name: 'b.txt', size: 200, lastModified: 2000 },
    ];
    const newFiles = [
      { name: 'a.txt', size: 100, lastModified: 1000 },
    ];

    const result = computeFileDiff(oldFiles, newFiles);

    assert.deepStrictEqual(result.added, []);
    assert.deepStrictEqual(result.removed, [{ name: 'b.txt', size: 200, lastModified: 2000 }]);
    assert.deepStrictEqual(result.modified, []);
  });

  it('should detect modified files (size changed)', () => {
    const oldFiles = [
      { name: 'a.txt', size: 100, lastModified: 1000 },
    ];
    const newFiles = [
      { name: 'a.txt', size: 150, lastModified: 1000 },
    ];

    const result = computeFileDiff(oldFiles, newFiles);

    assert.deepStrictEqual(result.added, []);
    assert.deepStrictEqual(result.removed, []);
    assert.deepStrictEqual(result.modified, [{ name: 'a.txt', size: 150, lastModified: 1000 }]);
  });

  it('should detect modified files (lastModified changed)', () => {
    const oldFiles = [
      { name: 'a.txt', size: 100, lastModified: 1000 },
    ];
    const newFiles = [
      { name: 'a.txt', size: 100, lastModified: 2000 },
    ];

    const result = computeFileDiff(oldFiles, newFiles);

    assert.deepStrictEqual(result.added, []);
    assert.deepStrictEqual(result.removed, []);
    assert.deepStrictEqual(result.modified, [{ name: 'a.txt', size: 100, lastModified: 2000 }]);
  });

  it('should return empty diff when files unchanged', () => {
    const oldFiles = [
      { name: 'a.txt', size: 100, lastModified: 1000 },
    ];
    const newFiles = [
      { name: 'a.txt', size: 100, lastModified: 1000 },
    ];

    const result = computeFileDiff(oldFiles, newFiles);

    assert.deepStrictEqual(result, { added: [], removed: [], modified: [] });
  });

  it('should handle empty old list (all new)', () => {
    const oldFiles = [];
    const newFiles = [
      { name: 'a.txt', size: 100, lastModified: 1000 },
    ];

    const result = computeFileDiff(oldFiles, newFiles);

    assert.deepStrictEqual(result.added, [{ name: 'a.txt', size: 100, lastModified: 1000 }]);
    assert.deepStrictEqual(result.removed, []);
    assert.deepStrictEqual(result.modified, []);
  });

  it('should handle empty new list (all removed)', () => {
    const oldFiles = [
      { name: 'a.txt', size: 100, lastModified: 1000 },
    ];
    const newFiles = [];

    const result = computeFileDiff(oldFiles, newFiles);

    assert.deepStrictEqual(result.added, []);
    assert.deepStrictEqual(result.removed, [{ name: 'a.txt', size: 100, lastModified: 1000 }]);
    assert.deepStrictEqual(result.modified, []);
  });
});
