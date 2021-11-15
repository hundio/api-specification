function idBase(id) {
  return id.replace(/#.*/, "")
}

function principalType(shape) {
  return shape.graph().types()[0].split("#")[1]
}

function hoistedId(shape) {
  let name

  if (["NodeShape", "UnionShape"].includes(principalType(shape)))
    name = "/" + shape.name.value()
  else
    name = shape.id.match(/\/[^\/]+\/[^\/]+$/)[0]

  return `${idBase(shape.id)}#/declarations${name}`
}

function isCommon(shape) {
  return !!shape.customDomainProperties.find((c) => /^(prelude\.)?common$/.test(c.name.value()))
}

const hoistedShapes = {}

function hoistType(resolved, shape) {
  let shapeName = shape.name.value()
  let sanitizedName = shapeName.replace(/\//g, "::")
  let ref = shape.linkCopy()
  let outerRef = shape.linkCopy()

  if (!hoistedShapes[sanitizedName]) {
    shape.withName(sanitizedName)
    let newId = hoistedId(shape)
    resolved.withDeclaredElement(shape)
    shape.withId(newId)
    hoistedShapes[sanitizedName] = shape
  }

  // actual link to hoisted shape
  ref.withLinkTarget(hoistedShapes[sanitizedName])
  ref.withLinkLabel(sanitizedName)

  // wrapping shape to allow setting other properties, overriding those ref'd in
  // by ref
  outerRef.withAnd([ref])
  // do not show extraneous namespacing details in displayNames
  outerRef.withDisplayName(sanitizedName.split("::")[0])
  if (outerRef.withAnyOf) outerRef.withAnyOf([ref])
  if (outerRef.withDataType) outerRef.withDataType(shape.dataType.value())

  return outerRef
}

function hoistPayloadExamples(resolved) {
  resolved.encodes.endPoints.forEach((endPoint) => {
    var path = endPoint.path.value()
    endPoint.operations.forEach((operation) => {
      var method = operation.method.value();

      [operation.request, ...operation.responses].filter((p) => p).forEach((payloadable) => {
        var code
        if (payloadable.statusCode) code = payloadable.statusCode.value()

        payloadable.payloads.forEach((payload) => {
          let examples = payload.schema.examples
          let exampleName = `${method.toUpperCase()} ${path}${code ? " ("+code+")" : ""}`
          let exampleIdx = examples.findIndex((ex) => ex.name.value() == exampleName)
          if (exampleIdx < 0) return

          let [example] = examples.splice(exampleIdx, 1)
          payload.schema.withExamples(examples)

          example.withName(null)
          payload.withExamples([example])
        })
      })
    })
  })
}

function hoistCommonTypes(resolved) {
  resolved
    .findByType("http://www.w3.org/ns/shacl#PropertyShape")
    .filter((p) => isCommon(p.range))
    .forEach((property) => property.withRange(hoistType(resolved, property.range)))

  resolved
    .findByType("http://a.ml/vocabularies/shapes#UnionShape")
    .filter((u) => u.anyOf.find(isCommon))
    .forEach((union) => {
      union.withAnyOf(union.anyOf.map((shape) => {
        if (isCommon(shape)) {
          return hoistType(resolved, shape)
        } else return shape
      }))
    })

  resolved
    .findByType("http://a.ml/vocabularies/shapes#ArrayShape")
    .filter((a) => isCommon(a.items))
    .forEach((array) => {
      array.withItems(hoistType(resolved, array.items))
    })

  resolved
    .findByType("http://a.ml/vocabularies/apiContract#Payload")
    .filter((p) => isCommon(p.schema))
    .forEach((payload) => payload.withSchema(hoistType(resolved, payload.schema)))
}

function copyResourceTagsToMethods(resolved) {
  resolved.encodes.endPoints.forEach((endpoint) => {
    var tags = endpoint.customDomainProperties.find((prop) => prop.name.value() == "core.tags")
    if (!tags) return

    endpoint.operations
      .forEach((operation) => operation.withCustomDomainProperties([tags]))
  })
}

function normalizeFieldDescriptions(shape, fieldDescriptions) {
  let normalized

  if (fieldDescriptions.default && fieldDescriptions.default.$classData.name.match(/\.ObjectNode/)) {
    let descsForSpecificType = (fieldDescriptions[shape.name.value().split("::")[0]] || {}).properties || {}
    normalized = Object.assign({}, fieldDescriptions.default.properties, descsForSpecificType)
  } else normalized = fieldDescriptions

  for (let prop in normalized) {
    normalized[prop] = normalized[prop].value.value()
  }

  return normalized
}

function acceptsFieldDescription(property) {
  let customDomainProperties = property.range.customDomainProperties
  let overrideIdx = customDomainProperties.findIndex((prop) => prop.name.value() == "core.overrideFieldDescription")

  if (overrideIdx >= 0) {
    customDomainProperties.splice(overrideIdx, 1)
    property.range.withCustomDomainProperties(customDomainProperties)
  }

  return !property.description.value() && overrideIdx < 0
}

function moveFieldDescriptionsToProperties(resolved) {
  resolved
    .findByType("http://a.ml/vocabularies/shapes#Shape")
    .filter((s) => s.customDomainProperties.find((prop) => prop.name.value() == "core.fieldDescriptions"))
    .forEach((shape) => {
      let ext = shape.customDomainProperties.find((prop) => prop.name.value() == "core.fieldDescriptions").extension
      if (!ext) return
      let fieldDescriptions = normalizeFieldDescriptions(shape, ext.properties)
      shape.properties
        .forEach((property) => {
          if (acceptsFieldDescription(property)) {
            let fieldDescription = fieldDescriptions[property.name.value()]
            if (!fieldDescription) return

            property.withDescription(fieldDescription)
            property.range.withDescription(fieldDescription)
          }
        })

      shape.withCustomDomainProperties(shape.customDomainProperties
        .filter((prop) => prop.name.value() !== "core.fieldDescriptions")
      )
    })
}

exports.postProcess = (resolved) => {
  hoistPayloadExamples(resolved)
  hoistCommonTypes(resolved)
  copyResourceTagsToMethods(resolved)
  moveFieldDescriptionsToProperties(resolved)
}
