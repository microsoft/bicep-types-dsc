// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { get as getReference } from "@hyperjump/json-pointer";
import type { JsonSchemaType } from "@hyperjump/json-schema";
import type {
  JsonSchemaDraft202012,
  JsonSchemaDraft202012Object,
} from "@hyperjump/json-schema/draft-2020-12";
import {
  type ObjectTypeProperty,
  ObjectTypePropertyFlags,
  TypeFactory,
  TypeReference,
} from "bicep-types";
import log from "loglevel";

function getPropertyFlags(
  _title: string,
  schema: JsonSchemaDraft202012,
): ObjectTypePropertyFlags {
  if (typeof schema === "boolean") {
    return ObjectTypePropertyFlags.None;
  }

  // NOTE: In DSC, just about any flag can be an identifier because of the 'get'
  // command. I'm not sure what implications there may be for Bicep, except that
  // it allows it under 'existing' so we can filter.
  const flags = ObjectTypePropertyFlags.Identifier;

  if (schema.readOnly === true) {
    return flags | ObjectTypePropertyFlags.ReadOnly;
  }

  if (schema.writeOnly === true) {
    return flags | ObjectTypePropertyFlags.WriteOnly;
  }

  // TODO: Handled 'required' which is in a different field.
  return flags;
}

function processType(
  factory: TypeFactory,
  rootSchema: JsonSchemaDraft202012,
  title: string,
  schema: JsonSchemaDraft202012Object,
  type: JsonSchemaType,
): TypeReference {
  switch (type) {
    case "null": {
      return factory.addNullType();
    }

    case "boolean": {
      return factory.addBooleanType();
    }

    case "integer":
    case "number": {
      return factory.addIntegerType(schema.minimum, schema.maximum);
    }

    case "string": {
      return factory.addStringType(
        // TODO: What is 'sensitive', maybe case?
        undefined,
        schema.minLength,
        schema.maxLength,
        schema.pattern,
      );
    }

    case "array": {
      const items = schema.items
        ? createType(factory, rootSchema, title, schema.items)
        : factory.addAnyType();

      return factory.addArrayType(items, schema.minLength, schema.maxLength);
    }

    case "object": {
      // TODO: Pattern properties
      if (schema.properties === undefined) {
        return factory.addAnyType();
      }

      const entries = Object.entries(schema.properties);

      // TODO: Double check these with Mikey.
      if (!title || title.trim() === "") {
        if (entries.length > 1) {
          log.warn("Expected only one property when missing title!");
          return factory.addAnyType();
        }
        /* const [key, value] = entries[0];
        log.debug(`Processing object definition for: ${title}`);
        return createType(factory, rootSchema, key, value); */
      }

      // Is this seriously the only way to map one Record into another in TypeScript?!
      const properties: Record<string, ObjectTypeProperty> = Object.fromEntries(
        entries.map(([key, value]) => [
          key,
          {
            type: createType(factory, rootSchema, key, value),
            flags: getPropertyFlags(key, value),
            description:
              typeof value !== "boolean" ? value.description : undefined,
          },
        ]),
      );

      if (Object.keys(properties).length === 0) {
        throw new Error("Object properties were empty!");
      }

      const additionalProperties = schema.additionalProperties
        ? createType(
            factory,
            rootSchema,
            "additionalProperties",
            schema.additionalProperties,
          )
        : undefined;

      return factory.addObjectType(title, properties, additionalProperties);
    }
  }
}

// Recursively maps the resource's schema to Bicep types.
export function createType(
  factory: TypeFactory,
  rootSchema: JsonSchemaDraft202012,
  title: string,
  schema: JsonSchemaDraft202012,
): TypeReference {
  // This is a short circuit indicating any value is valid
  if (typeof schema === "boolean") {
    if (schema) {
      return factory.addAnyType();
    } else {
      throw new Error("Schema was false!");
    }
  }

  log.debug(`Processing schema with title: '${title}'`);

  // TODO: This will only work for root schema references, not references by URI.
  if (schema.$ref) {
    // Slice off the '#'
    const subSchema = getReference(
      schema.$ref.slice(1),
      rootSchema,
    ) as JsonSchemaDraft202012Object;
    log.debug(`Followed reference: '${schema.$ref}'`);
    // TODO: This is a rough resolution, we'll want to merge instead of replace.
    // title = subSchema.title ?? title;
    schema = subSchema;
  }

  if (schema.anyOf) {
    log.debug("Type is: 'anyOf'");
    const elements = schema.anyOf.map((i) =>
      createType(factory, rootSchema, title, i),
    );
    return factory.addUnionType(elements);
  }

  if (schema.oneOf) {
    log.debug("Type is: 'oneOf'");
    const elements = schema.oneOf.map((i) =>
      createType(factory, rootSchema, title, i),
    );
    return factory.addUnionType(elements);
  }

  // TODO: What about 'allOf'?
  if (schema.allOf) {
    log.warn("Returning 'any' type for 'allOf' type!");
    return factory.addAnyType();
  }

  // TODO: What about 'enum', 'const' etc.?
  if (schema.type === undefined) {
    // We're looking at a ref to a definition.
    log.warn("Returning 'any' type for 'undefined' type!");
    return factory.addAnyType();
  }

  if (Array.isArray(schema.type)) {
    log.debug(`Type is an array: ['${schema.type.join("', ")}']`);
    // NOTE: This is a shorthand for 'anyOf'
    const elements = schema.type.map((i) =>
      // TODO: If any of these are references, we need to merge them.
      processType(factory, rootSchema, title, schema, i),
    );
    return factory.addUnionType(elements);
  }

  log.debug(`Switching on type: '${schema.type}'`);
  return processType(factory, rootSchema, title, schema, schema.type);
}
