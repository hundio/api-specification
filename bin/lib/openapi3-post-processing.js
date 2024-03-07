function normalizeSecuritySchemes(spec) {
  spec = JSON.parse(spec)

  var bearer = spec["components"]["x-amf-securitySchemes"]["bearer"]
  delete spec["components"]["x-amf-securitySchemes"]

  bearer["type"] = "http"
  bearer["scheme"] = "bearer"
  bearer["bearerFormat"] = bearer["x-amf-describedBy"].headers.Authorization.pattern.replace("Bearer ", "^") + "$"
  delete bearer["x-amf-describedBy"]

  spec.components.securitySchemes.bearer = bearer

  return JSON.stringify(spec)
}

function deepRemoveAnnotations(obj, predicate) {
  Object.entries(obj).forEach(([prop, val]) => {
    if (predicate(prop)) {
      delete obj[prop]
    } else if (val && typeof val == "object") {
      deepRemoveAnnotations(val, predicate)
    }
  });
}

function deepNormalizeSecurity(obj) {
  Object.entries(obj).forEach(([_prop, val]) => {
    if (val && typeof val == "object") {
      if (val.hasOwnProperty("x-amf-security")) {
        val.security = val.security.concat(val["x-amf-security"])
        delete val["x-amf-security"]
      }

      deepNormalizeSecurity(val)
    }
  })
}

function removeAnnotations(spec) {
  spec = JSON.parse(spec)

  const annotations = [
    "x-amf-uses",
    "x-amf-is",
    "x-amf-type",
    "x-common",
    "x-prelude.common",
  ]

  deepRemoveAnnotations(spec, (prop) =>
    prop.startsWith("x-specs.") || annotations.includes(prop)
  )
  deepNormalizeSecurity(spec)

  return JSON.stringify(spec)
}

function normalizeLogo(spec) {
  spec = JSON.parse(spec)

  let logo = spec["x-core.logo"]

  if (logo) {
    delete spec["x-core.logo"]
    spec.info["x-logo"] = logo
  }

  return JSON.stringify(spec)
}

function normalizeOpenApi3(spec) {
  return normalizeLogo(removeAnnotations(normalizeSecuritySchemes(spec)))
    .replace(/x-amf-union/g, "anyOf")
    .replace(/x-core\.tags/g, "tags")
    .replace(/x-core\.tagGroups/g, "x-tagGroups")
    .replace(/x-core\.expandable/g, "x-expandable")
    .replace(/("x-expandable":)null/g, "$1true")
    .replace(/x-prelude\.discriminatorJunction/g, "discriminator")
    .replace(/,"anyOf":\[{"\$ref":"[^"]+"}]/g, "")
    // FIXME: the following shouldn't be necessary, but something causes the
    // wrong $ref in usages of the Events union.
    .replace(/"\$ref":"#\/definitions\/([^"]+)"/g, '"$ref":"#/components/schemas/$1"')
    .replace(/#\/definitions\//g, "")
}

function deepCollapsePatternProperties(spec) {
  Object.entries(spec).forEach(([key, val]) => {
    if (val && typeof val === "object") {
      if (val.hasOwnProperty("patternProperties")) {
        const prop = Object.entries(val.patternProperties)[0][1]
        delete val.patternProperties
        val.additionalProperties = prop
      } else {
        deepCollapsePatternProperties(val)
      }
    }
  })
}

exports.normalizeOpenApi3 = normalizeOpenApi3

exports.collapsePatternPropertiesIntoAdditional = function(spec) {
  spec = JSON.parse(spec)

  deepCollapsePatternProperties(spec)

  return JSON.stringify(spec)
}

exports.flattenDiscriminatedUnionRefs = function(spec) {
  spec = JSON.parse(spec)

  Object.entries(spec.components.schemas).forEach(([name, schema]) => {
    if (!schema.discriminator || !schema.anyOf) return

    schema.anyOf = schema.anyOf.map(elem => elem.allOf[0])
  })

  return JSON.stringify(spec)
}
