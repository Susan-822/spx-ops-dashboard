function validateType(value, expectedTypes) {
  if (expectedTypes.includes('null') && value === null) {
    return true;
  }

  if (expectedTypes.includes('array')) {
    return Array.isArray(value);
  }

  if (expectedTypes.includes('object')) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  if (expectedTypes.includes('number')) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  if (expectedTypes.includes('string')) {
    return typeof value === 'string';
  }

  if (expectedTypes.includes('boolean')) {
    return typeof value === 'boolean';
  }

  return false;
}

function validateValue(value, schema, path, errors) {
  if (!schema) {
    return;
  }

  const expectedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : null;
  if (expectedTypes && !validateType(value, expectedTypes)) {
    errors.push(`${path} type invalid`);
    return;
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path} must equal ${schema.const}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.join(', ')}`);
  }

  if (value == null) {
    return;
  }

  if (Array.isArray(value)) {
    if (schema.items) {
      value.forEach((item, index) => {
        validateValue(item, schema.items, `${path}[${index}]`, errors);
      });
    }
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (!(key in value)) {
      errors.push(`${path}.${key} is required`);
    }
  }

  const properties = schema.properties || {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (key in value) {
      validateValue(value[key], propertySchema, `${path}.${key}`, errors);
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        errors.push(`${path}.${key} is not allowed`);
      }
    }
  }
}

export function validateAgainstSchema(value, schema) {
  const errors = [];
  validateValue(value, schema, '$', errors);
  return {
    valid: errors.length === 0,
    errors
  };
}
