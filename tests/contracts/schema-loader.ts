import { readFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import Ajv2020, { type AnySchema, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function loadYaml(relPath: string): Record<string, unknown> {
  const full = path.join(REPO_ROOT, relPath);
  return yaml.load(readFileSync(full, 'utf8')) as Record<string, unknown>;
}

let cachedOpenapi: Record<string, unknown> | null = null;
export function loadOpenApi(): Record<string, unknown> {
  if (!cachedOpenapi) cachedOpenapi = loadYaml('specs/api/openapi.yaml');
  return cachedOpenapi;
}

let cachedAsyncapi: Record<string, unknown> | null = null;
export function loadAsyncApi(): Record<string, unknown> {
  if (!cachedAsyncapi) cachedAsyncapi = loadYaml('specs/api/asyncapi.yaml');
  return cachedAsyncapi;
}

let cachedAjv: Ajv2020 | null = null;
function getAjv(): Ajv2020 {
  if (cachedAjv) return cachedAjv;
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: true,
  });
  addFormats(ajv);
  const doc = loadOpenApi() as { components?: { schemas?: Record<string, AnySchema> } };
  const schemas = doc.components?.schemas ?? {};
  for (const [name, schema] of Object.entries(schemas)) {
    ajv.addSchema(schema, `#/components/schemas/${name}`);
  }
  cachedAjv = ajv;
  return ajv;
}

const validators = new Map<string, ValidateFunction>();

export function validateAgainstSchema(
  schemaRef: string,
  value: unknown,
): { valid: boolean; errors: string[] } {
  const ajv = getAjv();
  let validate = validators.get(schemaRef);
  if (!validate) {
    const schema = ajv.getSchema(schemaRef);
    if (!schema) {
      return { valid: false, errors: [`Schema not found: ${schemaRef}`] };
    }
    validate = schema;
    validators.set(schemaRef, validate);
  }
  const ok = validate(value);
  if (ok) return { valid: true, errors: [] };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`,
  );
  return { valid: false, errors };
}
