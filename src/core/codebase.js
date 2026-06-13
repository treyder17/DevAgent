// src/core/codebase.js — scans the project and builds a context map

import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, relative, extname } from 'path';

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.cpp', '.h', '.hpp', '.cs',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.env.example',
  '.md', '.mdx', '.txt', '.rst',
  '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.sql', '.graphql', '.gql',
  '.vue', '.svelte', '.astro',
  '.tf', '.hcl', '.dockerfile',
  'Dockerfile', 'Makefile', '.gitignore', '.editorconfig',
]);

const ALWAYS_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.pytest_cache', 'venv', '.venv', 'env',
  '.DS_Store', 'Thumbs.db', '.idea', '.vscode', '.vs',
  'coverage', '.nyc_output', '.turbo', '.cache',
]);

export class CodebaseIndex {
  constructor(rootDir, options = {}) {
    this.rootDir = rootDir;
    this.maxFileSizeKb = options.maxFileSizeKb ?? 100;
    this.maxFiles = options.maxFiles ?? 2000;
    this.extraIgnore = new Set(options.ignorePatterns ?? []);
    this.files = new Map(); // path → { size, ext, lines }
    this.fileCount = 0;
    this._gitignorePatterns = [];
    this._loadGitignore();
  }

  _loadGitignore() {
    const gitignorePath = join(this.rootDir, '.gitignore');
    if (existsSync(gitignorePath)) {
      const lines = readFileSync(gitignorePath, 'utf8').split('\n');
      this._gitignorePatterns = lines
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
    }
  }

  _shouldIgnore(name, fullPath) {
    if (ALWAYS_IGNORE.has(name)) return true;
    if (this.extraIgnore.has(name)) return true;
    for (const pat of this._gitignorePatterns) {
      if (name === pat || name.startsWith(pat.replace(/\/$/, ''))) return true;
    }
    return false;
  }

  _isTextFile(name) {
    const ext = extname(name).toLowerCase();
    return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(name);
  }

  async build() {
    this.files.clear();
    this._walk(this.rootDir, 0);
    this.fileCount = this.files.size;
  }

  _walk(dir, depth) {
    if (this.files.size >= this.maxFiles) return;
    if (depth > 20) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (this.files.size >= this.maxFiles) break;
      if (this._shouldIgnore(entry.name, join(dir, entry.name))) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        this._walk(fullPath, depth + 1);
      } else if (entry.isFile() && this._isTextFile(entry.name)) {
        try {
          const stat = statSync(fullPath);
          const sizeKb = stat.size / 1024;
          if (sizeKb > this.maxFileSizeKb) continue;

          const relPath = relative(this.rootDir, fullPath);
          this.files.set(relPath, {
            size: stat.size,
            ext: extname(entry.name).toLowerCase(),
            lines: null, // lazy-loaded
          });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  /** Read a specific file's content */
  readFile(relPath) {
    const fullPath = join(this.rootDir, relPath);
    try {
      return readFileSync(fullPath, 'utf8');
    } catch {
      return null;
    }
  }

  /** Build the system context block sent to Claude */
  buildSystemContext(options = {}) {
    const { maxChars = 80000 } = options;
    const lines = [];

    lines.push('## Codebase Map');
    lines.push(`Root: ${this.rootDir}`);
    lines.push(`Files indexed: ${this.files.size}`);
    lines.push('');

    // Group by directory
    const tree = {};
    for (const [path] of this.files) {
      const parts = path.split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
      if (!tree[dir]) tree[dir] = [];
      tree[dir].push(parts[parts.length - 1]);
    }

    lines.push('### File Tree');
    for (const [dir, files] of Object.entries(tree).sort()) {
      lines.push(`${dir}/`);
      for (const f of files.sort()) {
        lines.push(`  ${f}`);
      }
    }

    lines.push('');
    lines.push('### Key File Contents');
    lines.push('(High-priority files are shown in full; others on request)');
    lines.push('');

    // Include important files: entry points, config, readme
    const priority = [
      'README.md', 'readme.md',
      'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod',
      'tsconfig.json', '.eslintrc.json', '.eslintrc.js',
      'Makefile', 'Dockerfile',
    ];

    let charCount = lines.join('\n').length;

    for (const name of priority) {
      if (charCount >= maxChars) break;
      if (this.files.has(name)) {
        const content = this.readFile(name);
        if (content) {
          const block = `\n--- ${name} ---\n${content}\n`;
          if (charCount + block.length < maxChars) {
            lines.push(block);
            charCount += block.length;
          }
        }
      }
    }

    // Include source files up to budget
    const sourceExts = new Set(['.js', '.ts', '.py', '.go', '.rs', '.rb']);
    const sourceFiles = [...this.files.entries()]
      .filter(([p]) => sourceExts.has(extname(p).toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [relPath] of sourceFiles) {
      if (charCount >= maxChars) break;
      if (priority.includes(relPath)) continue;
      const content = this.readFile(relPath);
      if (content) {
        const block = `\n--- ${relPath} ---\n${content}\n`;
        if (charCount + block.length < maxChars) {
          lines.push(block);
          charCount += block.length;
        }
      }
    }

    return lines.join('\n');
  }

  summary() {
    const exts = {};
    for (const [, info] of this.files) {
      exts[info.ext || 'other'] = (exts[info.ext || 'other'] || 0) + 1;
    }
    const extList = Object.entries(exts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([e, n]) => `${e || 'other'}(${n})`)
      .join(', ');
    return `Codebase: ${this.fileCount} files | ${extList}`;
  }
}
