// scripts/inspectPrismaRuntime.mjs
import '../src/lib/config.ts'; // if needed for env
const { prisma } = await import('../src/lib/prisma.ts');

function listModelNames(runtimeDataModel) {
  if (!runtimeDataModel) return [];
  const m = runtimeDataModel.models;
  if (!m) return [];
  // If it's an array, map normally
  if (Array.isArray(m)) return m.map(x => x.name);
  // If it's an object/dict, return keys or values' names
  if (typeof m === 'object') {
    try {
      // Some runtimes expose as { ModelName: {...} } or { models: { ... } }
      // Prefer property names:
      return Object.keys(m).length ? Object.keys(m) : Object.values(m).map(v => v.name).filter(Boolean);
    } catch (e) {
      return [];
    }
  }
  return [];
}

console.log('Prisma client keys:', Object.keys(prisma));
console.log('prisma._runtimeDataModel keys:', Object.keys(prisma._runtimeDataModel || {}));
console.log('typeof prisma._runtimeDataModel.models:', typeof prisma._runtimeDataModel?.models);
console.log('prisma._runtimeDataModel.models (names):', listModelNames(prisma._runtimeDataModel));
process.exit(0);