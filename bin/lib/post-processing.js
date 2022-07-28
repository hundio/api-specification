const amf = require("amf-client-js")
const util = require("./utilities")

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

function commonShapeName(shape) {
  if (isCommon(shape)) {
    return shape.name.value()
  } else if (isCommonMaybe(shape)) {
    let justShape = util.itselfOrTraverseLink(shape.anyOf.find(a => principalType(a) !== "NilShape"))
    return `Maybe(${commonShapeName(justShape)})`
  }
}

function isCommonMaybe(shape) {
  if (principalType(shape) == "UnionShape") {
    return shape.anyOf.length == 2 &&
           !!shape.anyOf.find(a => principalType(a) == "NilShape") &&
           !!shape.anyOf.find(a => isCommon(util.itselfOrTraverseLink(a)))
  } else return false
}

// FIXME: this is required due to a bug in AMF where union customDomainProperties
// overshadow that of an inner shape's
const commonWhitelistHack = [
  "Form/Watchdog/Create",
  "Form/Watchdog/Update",
  "Form/MetricProvider/Create",
  "Form/MetricProvider/Update",
  "Services/Watchdog",
  "Services/MetricProvider",
  "Form/Notifier/Create",
  "Form/Notifier/Update",
  "Form/Subscription/Create",
  "Form/Subscription/Update",
  "Channels/Notifier",
  "Channels/Subscription",
]

function isCommon(shape) {
  let shapeName = shape.name.value()
  return commonWhitelistHack.includes(shapeName) || !!shape.customDomainProperties.find((c) => /^(prelude\.)?common$/.test(c.name.value()))
}

function getDiscriminatorJunction(shape) {
  return shape.customDomainProperties.find((c) => /^(prelude\.)?discriminatorJunction$/.test(c.name.value()))
}

function isDiscriminatorJunction(shape) {
  return !!getDiscriminatorJunction(shape)
}

const hoistedShapes = {}

function hoistType(resolved, shape) {
  let shapeName = commonShapeName(shape)
  let sanitizedName = shapeName.replace(/\//g, "::")
  let outerRef = shape.linkCopy()

  if (!hoistedShapes[sanitizedName]) {
    shape.withName(sanitizedName)
    recursiveHoistProperties(resolved, shape)
    let newId = hoistedId(shape)
    resolved.withDeclaredElement(shape)
    shape.withId(newId)
    hoistedShapes[sanitizedName] = shape
  }

  // actual link to hoisted shape
  let refLabel = principalType(hoistedShapes[sanitizedName]) == "UnionShape" ? `#/definitions/${sanitizedName}` : sanitizedName,
      ref = hoistedShapes[sanitizedName].link(refLabel)

  // wrapping shape to allow setting other properties, overriding those ref'd in
  // by ref
  outerRef.withAnd([ref])
  // do not show extraneous namespacing details in displayNames
  outerRef.withDisplayName(sanitizedName.split("::")[0])
  outerRef.withAnyOf?.([ref])
  outerRef.withDataType?.(shape.dataType.value())

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

function recurseProperties(shape, f) {
  shape.properties?.forEach((prop) => {
    if (prop.range.properties) {
      recurseProperties(prop.range, f)
    }

    f(prop)
  })
}

function recursiveHoistProperties(resolved, shape) {
  recurseProperties(shape, (prop) => {
    var range = util.itselfOrTraverseLink(prop.range)

    if (isCommon(range)) {
      prop.withRange(hoistType(resolved, range))
    }
  })
}

function hoistRecursiveEndPointProperties(resolved) {
  resolved
    .findByType("http://a.ml/vocabularies/apiContract#Payload")
    .forEach(payload => {
      recursiveHoistProperties(resolved, payload.schema)
    })
}

function hoistCommonTypes(resolved) {
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
    .findByType("http://www.w3.org/ns/shacl#PropertyShape")
    .forEach((p) => {
      if (isCommon(p.range) || isCommonMaybe(p.range)) {
        p.withRange(hoistType(resolved, p.range))
      }
    })

  resolved
    .findByType("http://a.ml/vocabularies/shapes#ArrayShape")
    .filter((a) => a.items && isCommon(a.items))
    .forEach((array) => {
      array.withItems(hoistType(resolved, array.items))
    })

  resolved
    .findByType("http://a.ml/vocabularies/apiContract#Payload")
    .filter((p) => isCommon(p.schema))
    .forEach((payload) => payload.withSchema(hoistType(resolved, payload.schema)))

  hoistRecursiveEndPointProperties(resolved)
}

function isolateCommonProperties(_resolved) {
  const knownProperties = ["created_at", "updated_at"]

  Object.entries(hoistedShapes).forEach(([_name, shape]) => {
    let props = shape.properties
    if (!props) return

    shape.properties.forEach((prop, i) => {
      if (!knownProperties.includes(prop.name.value())) return
      let copied = prop.linkCopy(),
          copiedRange = prop.range.linkCopy()

      copiedRange.withAnd(prop.range.and)
      copiedRange.withDisplayName(prop.range.displayName.value())
      copiedRange.withDataType?.(prop.range.dataType.value())

      copied.withName(prop.name.value())
      copied.withRange(copiedRange)
      copied.withMinCount(prop.minCount.value())

      props.splice(i, 1, copied)
    })

    shape.withProperties(props)
  })
}

function copyResourceTagsToMethods(resolved) {
  resolved.encodes.endPoints.forEach((endpoint) => {
    var tags = endpoint.customDomainProperties.find((prop) => prop.name.value() == "core.tags")
    if (!tags) return

    endpoint.operations
      .forEach((operation) => operation.withCustomDomainProperties([tags].concat(operation.customDomainProperties)))
  })
}

function hoistDiscriminatorJunctions(resolved) {
  resolved
  .findByType("http://a.ml/vocabularies/shapes#UnionShape")
  .filter(isDiscriminatorJunction)
  .forEach((union) => {
    var discriminator

    var mapping = new amf.ObjectNode()

    union.anyOf.forEach((t) => {
      var subtype = t.and[0]?.linkTarget;
      if (!subtype) return

      discriminator ??= subtype.discriminator.value()
      var value = subtype.discriminatorValue.value()

      subtype.discriminator.remove()
      subtype.discriminatorValue.remove()
      subtype.withCustomDomainProperties(
        subtype.customDomainProperties.filter((p) => p.name.value() == "core.fieldDescriptions")
      )

      mapping.addProperty(value, new amf.ScalarNode(`#/components/schemas/${subtype.name.value()}`, "string"))
    })

    var junction = getDiscriminatorJunction(union)

    var extension = new amf.ObjectNode()
    extension.addProperty("propertyName", new amf.ScalarNode(discriminator, "string"))
    extension.addProperty("mapping", mapping)
    junction.withExtension(extension)
  })
}

function mergeResourceSpecBindIdsToResponses(resolved) {
  resolved.encodes.endPoints.forEach((endPoint) => {
    var bindIds = endPoint.customDomainProperties.find((prop) => prop.name.value() == "specs.bindIds")
    if (!bindIds) return

    endPoint.operations.forEach((operation) => {
      operation.responses.forEach((response) => {
        let rBindIds = response.customDomainProperties.find((prop) => prop.name.value() == "specs.bindIds")
        if (!rBindIds) {
          response.withCustomDomainProperties([bindIds].concat(response.customDomainProperties))
        } else {
          Object.entries(bindIds.extension.properties).forEach(([name, bind]) => {
            let rBindIdsExt = rBindIds.extension

            if (name in rBindIdsExt.properties) return

            rBindIdsExt.addProperty(name, bind)
          })
        }
      })
    })
  })
}

function mergeResourceSpecFactoryAnnotationsToResponses(resolved) {
  resolved.encodes.endPoints.forEach((endPoint) => {
    var factoryStrategy = util.findCustomDomainProperty(endPoint, "specs.factoryStrategy"),
        factoryName = util.findCustomDomainProperty(endPoint, "specs.factoryName")

    if (!factoryStrategy && !factoryName) return

    endPoint.operations.forEach((operation) => {
      operation.responses.forEach((response) => {
        let rStrategy = util.findCustomDomainProperty(response, "specs.factoryStrategy"),
            rName = util.findCustomDomainProperty(response, "specs.factoryName")

        if (!rStrategy && factoryStrategy) {
          response.withCustomDomainProperties([factoryStrategy].concat(response.customDomainProperties))
        }

        if (!rName && factoryName) {
          response.withCustomDomainProperties([factoryName].concat(response.customDomainProperties))
        }
      })
    })
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

  return overrideIdx < 0 ? true : !property.description.value()
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
        ?.forEach((property) => {
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

function copyObjectDescriptionsToTags(resolved) {
  const tags = util.findCustomDomainProperty(resolved.encodes, "core.tags")
  if (!tags) return

  tags.extension.members.forEach((tag) => {
    let tagName = tag.properties.name.value.value(),
        modelName = util.toCamelCase(tagName),
        model = hoistedShapes[modelName]

    if (!model) return

    tag.addProperty("description", new amf.ScalarNode(model.description.value(), "string"))
  })
}

exports.postProcess = (resolved) => {
  hoistPayloadExamples(resolved)
  hoistCommonTypes(resolved)
  isolateCommonProperties(resolved)
  hoistDiscriminatorJunctions(resolved)
  copyResourceTagsToMethods(resolved)
  moveFieldDescriptionsToProperties(resolved)
  mergeResourceSpecBindIdsToResponses(resolved)
  mergeResourceSpecFactoryAnnotationsToResponses(resolved)
  copyObjectDescriptionsToTags(resolved)
}
