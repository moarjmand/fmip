import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import eslintBase from '../eslint/base.js';
import prettierConfig from '../prettier/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

type TsConfig = {
  extends?: string;
  compilerOptions?: Record<string, unknown>;
  include?: string[];
  exclude?: string[];
};

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(packageRoot, relativePath), 'utf8')) as T;
}

const presets = ['base', 'library', 'nestjs', 'nextjs'] as const;

describe('tsconfig presets', () => {
  it('exposes every preset declared in package.json exports', () => {
    const pkg = readJson<{ exports: Record<string, string> }>('package.json');

    for (const preset of presets) {
      const specifier = `./tsconfig/${preset}.json`;
      expect(pkg.exports[specifier]).toBe(specifier);
      expect(() => readJson<TsConfig>(`tsconfig/${preset}.json`)).not.toThrow();
    }
  });

  it('keeps the strictness guarantees the whole monorepo inherits', () => {
    const base = readJson<TsConfig>('tsconfig/base.json');

    expect(base.compilerOptions).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      forceConsistentCasingInFileNames: true,
      isolatedModules: true,
    });
  });

  it('derives every framework preset from the base preset', () => {
    for (const preset of presets.filter((name) => name !== 'base')) {
      expect(readJson<TsConfig>(`tsconfig/${preset}.json`).extends).toBe('./base.json');
    }
  });

  it('declares no path-relative option', () => {
    // A relative path in an extended tsconfig resolves against the file that
    // declares it, not the project extending it. A preset that sets `rootDir`
    // or `include` therefore points every consumer at packages/config, which
    // fails with TS6059 the first time a project tries to emit.
    const pathRelative = ['rootDir', 'outDir', 'baseUrl', 'paths', 'tsBuildInfoFile'] as const;

    for (const preset of presets) {
      const config = readJson<TsConfig>(`tsconfig/${preset}.json`);

      for (const option of pathRelative) {
        expect(config.compilerOptions?.[option], `${preset}.compilerOptions.${option}`).toBe(
          undefined,
        );
      }
      expect(config.include, `${preset}.include`).toBeUndefined();
      expect(config.exclude, `${preset}.exclude`).toBeUndefined();
    }
  });

  it('enables decorator metadata for NestJS only', () => {
    const nestjs = readJson<TsConfig>('tsconfig/nestjs.json');
    const nextjs = readJson<TsConfig>('tsconfig/nextjs.json');

    expect(nestjs.compilerOptions).toMatchObject({
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    });
    expect(nextjs.compilerOptions?.emitDecoratorMetadata).toBeUndefined();
  });

  it('configures the Next.js preset for a bundler that emits nothing itself', () => {
    const nextjs = readJson<TsConfig>('tsconfig/nextjs.json');

    expect(nextjs.compilerOptions).toMatchObject({
      jsx: 'preserve',
      moduleResolution: 'Bundler',
      noEmit: true,
    });
  });
});

describe('eslint base config', () => {
  it('is a non-empty flat config', () => {
    expect(Array.isArray(eslintBase)).toBe(true);
    expect(eslintBase.length).toBeGreaterThan(0);
  });

  it('ends with the Prettier compatibility layer so formatting rules cannot conflict', () => {
    const last = eslintBase.at(-1);

    expect(last?.rules).toBeDefined();
    // eslint-config-prettier disables stylistic core rules by setting them to 'off'.
    expect(Object.values(last?.rules ?? {}).every((value) => value === 'off' || value === 0)).toBe(
      true,
    );
  });

  it('bans implicit `any`, so missing data must be modelled explicitly', () => {
    const rules = eslintBase.flatMap((layer) => Object.entries(layer.rules ?? {}));

    expect(rules).toContainEqual(['@typescript-eslint/no-explicit-any', 'error']);
  });
});

describe('prettier config', () => {
  it('pins the formatting decisions shared by every workspace', () => {
    expect(prettierConfig).toMatchObject({
      printWidth: 100,
      singleQuote: true,
      semi: true,
      trailingComma: 'all',
      endOfLine: 'lf',
    });
  });
});
