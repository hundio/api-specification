class RequestSpecGenerator {
  constructor(resolved) {
    this.resolved = resolved
    this.schemas = {}
    this.spec = undefined
    this.basePath = new URL(resolved.encodes.servers[0].url.value()).pathname
    this.compileCommonJsonSchema()
  }

  generate() {
    this.spec = this.root(this.operations())
  }

  requestBindings(operation, response, requestBodyInfo) {
    if (!this.supportsRequestBody(operation)) return ""

    var paramsBinding, headersBinding = 'headers.merge! "content-type" => "application/json"'

    var requestBody = response.customDomainProperties.find(d => d.name.value() == "specs.requestBody")?.extension?.value?.value()

    if (!requestBody) {
      paramsBinding = ""
    } else if (requestBody.startsWith("auto:")) {
      var [_, model, ...traits] = requestBody.split(":"),
          bindTraits = traits.length == 0 ? "" : `, ${traits.map(t => ":" + t).join(", ")}`
      paramsBinding = `params = op_attributes_for(:${model}${bindTraits})`
    } else {
      paramsBinding = `params = ${requestBody}`
    }

    if (paramsBinding) {
      if (requestBodyInfo.factory) {
        if (requestBodyInfo.mergePath) {
          paramsBinding += `.merge(${requestBodyInfo.mergePath[0]}: op_attributes_for(:${requestBodyInfo.factory}, :${requestBodyInfo.trait}))`
        } else {
          paramsBinding += `.merge(op_attributes_for(:${requestBodyInfo.factory}, :${requestBodyInfo.trait}))`
        }
      }

      paramsBinding += ".to_json"
    }

    return [paramsBinding, headersBinding].join("\n")
  }

  requestOptions(operation) {
    if (!this.supportsRequestBody(operation)) return ", headers: headers"

    return ", params: params, headers: headers"
  }

  apiKeyBinding(response) {
    var permissionLevel = response.customDomainProperties.find(d => d.name.value() == "specs.apiKeyPermissionLevel")

    if (!permissionLevel) return ""

    permissionLevel = permissionLevel.extension.value.value()

    return `let(:api_key) { create :api_key, :${permissionLevel} }`
  }

  idBindings(response) {
    var bindIds = response.customDomainProperties.find(d => d.name.value() == "specs.bindIds")

    if (!bindIds) return ""

    return Object.entries(bindIds.extension.properties).map(([model, id]) => {
      var bindName = `${model}_id`, bindValue, idValue = id.value.value()

      if (idValue == "auto" || idValue.startsWith("auto:")) {
        var traits = idValue.split(":").slice(1),
            bindTraits = traits.length == 0 ? "" : `, ${traits.map(t => ":" + t).join(", ")}`
        bindValue = `op_create(:${model}${bindTraits}).id.to_s`
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

  responseTestCase(endPoint, operation, response, code, idBindings, bodyExpectation, requestBodyInfo = {}) {
    return `
      it "${this.testCaseDescription(requestBodyInfo)}" do
        ${this.requestBindings(operation, response, requestBodyInfo)}
        ${operation.method.value()} "${this.basePath}${this.endPointPath(endPoint, idBindings)}"${this.requestOptions(operation)}

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
        source = config.source.value.value().split("."),
        requestSchema = this.itselfOrTraverseLink(operation.request.payloads[0].schema)

    var shape = source.reduce((s, path) => {
      let pathProp = s.properties.find(n => n.name.value() === path).range
      return this.itselfOrTraverseLink(pathProp)
    }, requestSchema);

    return shape.anyOf.map((subshape) => {
      var trait = subshape.displayName.value().toLowerCase()

      return this.responseTestCase(endPoint, operation, response, code, idBindings, bodyExpectation, {factory: factory, trait: trait, mergePath: mergePath})
    }).join("\n\n");
  }

  opCreateLists(response) {
    var opCreate = response.customDomainProperties.find(d => d.name.value() == "specs.opCreateList")
    if (!opCreate) return ""

    return Object.entries(opCreate.extension.properties).map(([model, options]) => {
      var count = options.properties.count?.value?.value() || 3,
          traits = options.properties.traits?.value?.value()?.split(":") || [],
          traitsSection = traits.length == 0 ? "" : `, ${traits.map(t => ":" + t).join(", ")}`,
          factoryOptions = Object.entries(options.properties.options?.properties || {}),
          factoryOptionsSection = factoryOptions.length == 0 ? "" : `, ${factoryOptions.map(([opt, val]) => `${opt}: ${val.value.value()}`).join(", ")}`

      return `before { op_create_list :${model}, ${count}${traitsSection}${factoryOptionsSection} }`
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

        this.schemas[schemaId] = this.dereferenceJsonSchemaRoot(this.relocateJsonSchemaReferences(payload.schema.buildJsonSchema()), schemaId)

        bodyExpectation = `expect(response.body).to match_json_schema("state/api/v1/latest/${schemaId}")`
      }

      var idBindings = this.idBindings(response)

      return `
      context "${code} (${response.description.value().trim().replace(/\.$/, "")})" do
        ${this.apiKeyBinding(response)}
        ${idBindings}

        ${this.opCreateLists(response)}

        ${this.responseTestCase(endPoint, operation, response, code, idBindings, bodyExpectation)}
        ${this.exhaustiveResponseTestCases(endPoint, operation, response, code, idBindings, bodyExpectation)}
      end
      `
    }, "").join("\n\n")
  }

  operations() {
    return this.resolved.encodes.endPoints.map((endPoint) => {
      return endPoint.operations.map((operation) => {
        return `
        describe "${operation.method.value().toUpperCase()} ${this.basePath}${endPoint.path.value()}" do
          ${this.responses(endPoint, operation)}
        end
        `
      }).join("\n\n")
    }).join("\n\n")
  }

  root(content) {
    return `
    require "rails_helper"

    RSpec.describe "${this.basePath} (version: latest)" do
      before(:example) do
        State::GenericMetricProvider.delete_all
        State::BluthundMetricProvider.delete_all
        State::BluthundWatchdog.delete_all
      end
      let(:api_key) { create :api_key, :write }
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
    return ["post", "put", "patch"].includes(operation.method.value())
  }

  endPointPath(endPoint, upgradeInterpolations) {
    var path = endPoint.path.value()

    return upgradeInterpolations ? path.replace(/\{[A-Za-z0-9_]+\}/g, "#$&") : path
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
      Object.assign(commonSchema.definitions, JSON.parse(shape.buildJsonSchema()).definitions)
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

  itselfOrTraverseLink(linkable) {
    if (linkable.and?.[0]?.isLink) {
      return linkable.and[0].linkTarget
    } else {
      return linkable
    }
  }
}

exports.RequestSpecGenerator = RequestSpecGenerator
