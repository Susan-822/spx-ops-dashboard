function validateType(value, expected) {
  if (expected.includes("null") && value === null) {
    return true;
  }

  if (expected.includes("array")) {
    return Array.isArray(value);
  }

  if (expected.includes("object")) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  if (expected.includes("number")) {
    return typeof value === "number";
  }

  if (expected.includes("string")) {
    return typeof value === "string";
  }

  if (expected.includes("boolean")) {
    return typeof value === "boolean";
  }

  return false;
}

function validateValue(value, schema, path, errors) {
  if (!schema) {
    return;
  }

  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!validateType(value, expected)) {
      errors.push(`${path} type invalid`);
      return;
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path} must equal ${schema.const}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
  }

  if (value === null) {
    return;
  }

  if (schema.type === "array" && schema.items && Array.isArray(value)) {
    value.forEach((item, index) => {
      validateValue(item, schema.items, `${path}[${index}]`, errors);
    });
    return;
  }

  const isObject = value && typeof value === "object" && !Array.isArray(value);
  if (!isObject) {
    return;
  }

  const required = schema.required || [];
  for (const key of required) {
    if (!(key in value)) {
      errors.push(`${path}.${key} is required`);
    }
  }

  const properties = schema.properties || {};
  for (const [key, childSchema] of Object.entries(properties)) {
    if (key in value) {
      validateValue(value[key], childSchema, `${path}.${key}`, errors);
    }
  }
}

function validateAgainstSchema(value, schema) {
  const errors = [];
  validateValue(value, schema, "$", errors);
  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateAgainstSchema,
};
