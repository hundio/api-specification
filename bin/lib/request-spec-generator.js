const amf = require("amf-client-js")
const util = require("./utilities")

class RequestSpecGenerator {
  constructor(resolved) {
    this.resolved = resolved
    this.schemas = {}
    this.spec = undefined
    this.schemaClient = amf.RAMLConfiguration.RAML10().elementClient()
    this.basePath = new URL(resolved.encodes.servers[0].url.value()).pathname
    this.compileCommonJsonSchema()
  }

  generate() {
    this.spec = this.root(this.operations())
  }

  requestBindings(operation, response, requestBodyInfo) {
    if (!this.supportsRequestBody(operation)) return []

    var paramsBinding, headersBinding = 'headers.merge! "content-type" => "application/json"'

    var requestBody = response.customDomainProperties.find(d => d.name.value() == "specs.requestBody")?.extension?.value?.value(),
        attributesStrategy = this.factoryAttributesStrategy(response),
        factoryName = this.factoryName(response)

    if (!requestBody) {
      paramsBinding = ""
    } else if (requestBody.startsWith("auto:")) {
      var [_, model, ...traits] = requestBody.split(":"),
          bindTraits = traits.length == 0 ? "" : `, ${traits.map(t => ":" + t).join(", ")}`
      paramsBinding = `params = ${attributesStrategy}(:${factoryName || model}${bindTraits})`
    } else {
      paramsBinding = `params = ${requestBody}`
    }

    if (paramsBinding) {
      if (requestBodyInfo.factory) {
        if (requestBodyInfo.mergePath) {
          paramsBinding += `.merge(${requestBodyInfo.mergePath[0]}: ${attributesStrategy}(:${requestBodyInfo.factory}, :${requestBodyInfo.trait}))`
        } else {
          paramsBinding += `.merge(${attributesStrategy}(:${requestBodyInfo.factory}, :${requestBodyInfo.trait}))`
        }
      }

      paramsBinding += ".to_json"
    }

    return [paramsBinding, paramsBinding && headersBinding]
  }

  requestOptions(operation, params) {
    if (!this.supportsRequestBody(operation) || !params) return ", headers: headers"

    return ", params: params, headers: headers"
  }

  apiKeyBinding(response) {
    var permissionLevel = response.customDomainProperties.find(d => d.name.value() == "specs.apiKeyPermissionLevel")

    if (!permissionLevel) return ""

    permissionLevel = permissionLevel.extension.value.value()

    return `let(:api_key) { create :api_key, :${permissionLevel}, user: api_key_user }`
  }

  idBindings(response) {
    var bindIds = response.customDomainProperties.find(d => d.name.value() == "specs.bindIds"),
        factoryStrategy = this.factoryStrategy(response),
        factoryName = this.factoryName(response)

    if (!bindIds) return ""

    return Object.entries(bindIds.extension.properties).map(([model, id]) => {
      var bindName = `${model}_id`, bindValue, idValue = id.value.value()

      if (idValue == "auto" || idValue.startsWith("auto:")) {
        var traits = idValue.split(":").slice(1),
            bindTraits = traits.length == 0 ? "" : `, ${traits.map(t => ":" + t).join(", ")}`
        bindValue = `${factoryStrategy}(:${factoryName || model}${bindTraits}).id.to_s`
      } else {
        bindValue = `"${idValue}"`
      }

      return `let(:${bindName}) { ${bindValue} }`
    }).join("\n")
  }

  testCaseDescription(requestBodyInfo) {
    var description = "returns appropriate body and status code"

    if (requestBodyInfo.factory) {
      description += ` (request body: ${requestBodyInfo.factory}:${requestBodyInfo.trait})`
    }

    return description
  }

  testCaseFlags(requestBodyInfo) {
    var flags = ""

    if (requestBodyInfo.vcr) flags += ", vcr: true"

    return flags
  }

  responseTestCase(endPoint, operation, response, code, idBindings, bodyExpectation, requestBodyInfo = {}) {
    var config = response.customDomainProperties.find(c => c.name.value() === "specs.exhaustiveRequestBodies")?.extension?.properties
    if (!requestBodyInfo.factory && config?.excludeBaseCase?.value?.value()) return ""

    const bindings = this.requestBindings(operation, response, requestBodyInfo)

    return `
      it "${this.testCaseDescription(requestBodyInfo)}"${this.testCaseFlags(requestBodyInfo)} do
        ${bindings.join("\n")}
        ${operation.method.value()} "${this.basePath}${this.endPointPath(endPoint, idBindings)}"${this.requestOptions(operation, bindings[0])}

        expect(response).to have_http_status(${code})
        ${bodyExpectation}
      end
    `
  }

  exhaustiveResponseTestCases(endPoint, operation, response, code, idBindings, bodyExpectation) {
    var config = response.customDomainProperties.find(c => c.name.value() === "specs.exhaustiveRequestBodies")?.extension?.properties
    if (!config) return ""

    var factory = config.factory.value.value(),
        mergePath = config.mergePath?.value?.value()?.split("."),
        vcrTraits = config.vcr?.members?.map(m => m.value.value()) || [],
        source = config.source.value.value().split("."),
        requestSchema = util.itselfOrTraverseLink(operation.request.payloads[0].schema)

    var shape = source.reduce((s, path) => {
      let pathProp = path ? s.properties.find(n => n.name.value() === path).range : s
      return util.itselfOrTraverseLink(pathProp)
    }, requestSchema);

    return shape.anyOf.flatMap((subshape) => {
      const subshapes = util.principalType(subshape) === "UnionShape" ?
        util.itselfOrTraverseLink(subshape).anyOf : [subshape]

      return subshapes.map(ss => {
        var trait = util.toSnakeCase(ss.displayName.value()),
        info = {factory: factory, trait: trait, mergePath: mergePath}

        if (vcrTraits.includes(trait)) info.vcr = true

        return this.responseTestCase(endPoint, operation, response, code, idBindings, bodyExpectation, info)
      })
    }).join("\n\n");
  }

  beforeHook(response) {
    var hook = util.findCustomDomainProperty(response, "specs.beforeHook")

    if (!hook) return ""

    return `before { ${hook.extension.value.value()} }`
  }

  createModelsHook(response) {
    var createModels = response.customDomainProperties.find(d => d.name.value() == "specs.createModels")
    if (!createModels) return ""

    var strategy = this.factoryStrategy(response);
    if (!strategy) return ""

    var factoryName = this.factoryName(response);

    return Object.entries(createModels.extension.properties).map(([model, options]) => {
      var count = options.properties.count?.value?.value() || 3,
          traits = options.properties.traits?.value?.value()?.split(":") || [],
          traitsSection = traits.length == 0 ? "" : `, ${traits.map(t => ":" + t).join(", ")}`,
          factoryOptions = Object.entries(options.properties.options?.properties || {}),
          factoryOptionsSection = factoryOptions.length == 0 ? "" : `, ${factoryOptions.map(([opt, val]) => `${opt}: ${val.value.value()}`).join(", ")}`

      return `before { ${strategy}_list :${factoryName || model}, ${count}${traitsSection}${factoryOptionsSection} }`
    }).join("\n")
  }

  responses(endPoint, operation) {
    return operation.responses.map((response) => {
      var code = response.statusCode.value()
      var bodyExpectation

      if (code == 204) {
        bodyExpectation = `expect(response.body).to be_empty`
      } else {
        var payload = response.payloads[0],
            schemaId = this.schemaId(payload.schema)

        this.schemas[schemaId] = this.dereferenceJsonSchemaRoot(this.relocateJsonSchemaReferences(this.toJsonSchema(payload.schema)), schemaId)

        bodyExpectation = `expect(response.body).to match_json_schema("state/api/v1/latest/${schemaId}")`
      }

      var idBindings = this.idBindings(response)

      return `
      context "${code} (${response.description.value().trim().replace(/\.$/, "")})" do
        ${this.apiKeyBinding(response)}
        ${idBindings}

        ${this.beforeHook(response)}
        ${this.createModelsHook(response)}

        ${this.responseTestCase(endPoint, operation, response, code, idBindings, bodyExpectation)}
        ${this.exhaustiveResponseTestCases(endPoint, operation, response, code, idBindings, bodyExpectation)}
      end
      `
    }, "").join("\n\n")
  }

  operations() {
    return this.resolved.encodes.endPoints.map((endPoint) => {
      const resourceTag = util.findCustomDomainProperty(endPoint, "core.tags")?.extension?.members?.[0]?.value?.value() || ""

      return endPoint.operations.map((operation) => {
        return `
        describe "${operation.method.value().toUpperCase()} ${this.basePath}${endPoint.path.value()}"${resourceTag && `, resource: "${resourceTag}"`} do
          ${this.responses(endPoint, operation)}
        end
        `
      }).join("\n\n")
    }).join("\n\n")
  }

  root(content) {
    return `
    require "rails_helper"

    RSpec.describe "${this.basePath} (version: latest)", :timeline_simulation do
      before(:example) { DatabaseCleaner.clean }
      let(:api_key_user) { create :user, :admin }
      let(:api_key) { create :api_key, :write, user: api_key_user }
      let(:headers) { { accept: "application/hal+json;variant=compact", authorization: "Bearer #{api_key.token}" } }

      ${content}
    end
    `
  }

  schemaId(schema) {
    return schema.id
      .split("#")[1]
      .replace(/\//g, ".")
      .replace(/^\./, "")
      .replace(/%/g, "_")
  }

  supportsRequestBody(operation) {
    return ["post", "put", "patch", "delete"].includes(operation.method.value())
  }

  endPointPath(endPoint, upgradeInterpolations) {
    var path = endPoint.path.value()

    return upgradeInterpolations ? path.replace(/\{[A-Za-z0-9_]+\}/g, "#$&") : path
  }

  factoryStrategy(response) {
    var prop = util.findCustomDomainProperty(response, "specs.factoryStrategy"),
        value = prop?.extension?.value?.value()

    if (value === "null") return null
    return value || "op_create"
  }

  factoryName(response) {
    var prop = util.findCustomDomainProperty(response, "specs.factoryName"),
        value = prop?.extension?.value?.value()

    return value
  }

  factoryAttributesStrategy(response) {
    const strategy = this.factoryStrategy(response)

    if (!strategy) return null

    return strategy.startsWith("op_") ? "op_attributes_for" : "attributes_for"
  }

  compileCommonJsonSchema() {
    var commonShapes = this.resolved.declares.
      filter(d => d.graph().types().includes("http://a.ml/vocabularies/shapes#AnyShape"))

    var commonSchema = {
      "id": "file:/state/api/v1/latest/common.json#",
      "$schema": "http://json-schema.org/draft-04/schema#",
      "definitions": {}
    }

    commonShapes.forEach((shape) => {
      var schema = JSON.parse(this.toJsonSchema(shape)),
          def = schema.$ref.match(/#\/definitions\/(.+)/)[1]

      commonSchema.definitions[shape.name.value()] = schema.definitions[def]
    })

    this.schemas.common = JSON.stringify(commonSchema, null, 2)
  }

  relocateJsonSchemaReferences(jsonSchema) {
    return jsonSchema.replace(/(?<!"\$schema": "http:\/\/json-schema\.org\/draft-04\/schema#",\s*)("\$ref": ")(#)/g, "$1file:/state/api/v1/latest/common.json$2")
  }

  dereferenceJsonSchemaRoot(jsonSchema, schemaId) {
    var schema = JSON.parse(jsonSchema)
    schema.id = `file:/state/api/v1/latest/${schemaId}.json#`
    if (schema["$ref"]) {
      let entries = Object.entries(schema.definitions)
      if (entries.length > 1) console.warn(`WARN: ${schemaId} contains multiple definitions`)

      let deref = entries[0][1]
      Object.assign(schema, deref)
      delete schema["$ref"]
      delete schema.definitions
    }
    return JSON.stringify(schema, null, 2)
  }

  toJsonSchema(shape) {
    return this.schemaClient.buildJsonSchema(shape)
  }
}

exports.RequestSpecGenerator = RequestSpecGenerator
