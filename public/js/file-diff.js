// File diff utility — compares two file metadata arrays
// Works in both Node.js (via module.exports) and browser (via window)

(function () {
  /**
   * Compare old and new file lists, return the diff.
   * Each file object: { name: string, size: number, lastModified: number }
   * @param {Array<{name: string, size: number, lastModified: number}>} oldFiles
   * @param {Array<{name: string, size: number, lastModified: number}>} newFiles
   * @returns {{ added: Array, removed: Array, modified: Array }}
   */
  function computeFileDiff(oldFiles, newFiles) {
    const oldMap = new Map(oldFiles.map((f) => [f.name, f]));
    const newMap = new Map(newFiles.map((f) => [f.name, f]));

    const added = [];
    const removed = [];
    const modified = [];

    // Find added and modified
    for (const [name, newFile] of newMap) {
      const oldFile = oldMap.get(name);
      if (!oldFile) {
        added.push(newFile);
      } else if (oldFile.size !== newFile.size || oldFile.lastModified !== newFile.lastModified) {
        modified.push(newFile);
      }
    }

    // Find removed
    for (const [name, oldFile] of oldMap) {
      if (!newMap.has(name)) {
        removed.push(oldFile);
      }
    }

    return { added, removed, modified };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { computeFileDiff };
  } else {
    window.computeFileDiff = computeFileDiff;
  }
})();
