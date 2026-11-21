#!/usr/bin/env node
// Runs the TypeScript CLI through tsx's loader, resolved from this package (works from any folder).
import { register } from 'tsx/esm/api';

register();
await import('../src/index.ts');
